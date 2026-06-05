import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  gradingScales,
  importJobs,
  instruments,
  itemTaxonomyTags,
  items,
  responses,
  skillResults,
  withOrgContext,
} from '@soe/db';
import {
  DEFAULT_GRADING_SCALE,
  aggregateSkillResults,
  aggregateStudentResults,
  type AnswerSheetColumnMapping,
  type AnswerSheetConfirmRequestDto,
  type AnswerSheetConfirmResponse,
  type AnswerSheetFormat,
  type AnswerSheetPreviewResponse,
  type AnswerSheetRowError,
  type AnswerSheetRowPreview,
  type AnswerSheetTemplate,
  type AnswerSheetUploadResponse,
  type GradingScaleParams,
  type GradingScaleType,
  type ImportJobModel,
  type ResponseForCalculation,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { AnswerSheetPreviewStore } from './lib/preview-store';
import { parseGradecamCsv } from './lib/parsers/gradecam-parser';
import { parseZipgradeCsv } from './lib/parsers/zipgrade-parser';
import { parseDiaOfficialCsv } from './lib/parsers/dia-official-parser';
import { parseGenericCsv } from './lib/parsers/generic-csv-parser';
import { getTemplate, listTemplates } from './lib/templates';
import type { ParserResult } from './lib/parsers/parser.types';
import { matchStudents } from './lib/student-matcher';

interface MultipleChoiceItemContent {
  stem?: string;
  correctKey?: string;
  alternatives?: Array<{ key: string; text?: string; isCorrect?: boolean }>;
  [k: string]: unknown;
}

interface ItemForAssessment {
  id: string;
  position: number;
  correctKey: string;
  maxScore: number;
}

interface UploadMetadataInput {
  format: AnswerSheetFormat;
  instrumentId: string;
  classGroupId?: string | null;
  assessmentId?: string | null;
  assessmentName?: string | null;
  columnMapping?: AnswerSheetColumnMapping | null;
}

@Injectable()
export class AnswerSheetsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly previewStore: AnswerSheetPreviewStore,
  ) {}

  /**
   * Parsea el archivo según el `format`, valida que el instrumento sea
   * visible para el caller, y guarda el resultado en memoria. NO persiste
   * a la BD todavía.
   */
  async upload(
    user: JwtPayload,
    file: { buffer: Buffer; originalname?: string },
    metadata: UploadMetadataInput,
  ): Promise<AnswerSheetUploadResponse> {
    const orgId = this.requireOrgId(user);

    // Validar que el instrumento existe y es visible para esta org (oficial
    // o propia). Hardstop temprano para no parsear archivos contra
    // instrumentos prohibidos.
    await this.ensureInstrumentVisible(metadata.instrumentId, orgId);

    const parserResult = this.runParser(
      metadata.format,
      file.buffer,
      metadata.columnMapping ?? null,
    );

    const entry = this.previewStore.set({
      orgId,
      userId: user.userId,
      format: metadata.format,
      instrumentId: metadata.instrumentId,
      classGroupId: metadata.classGroupId ?? null,
      assessmentId: metadata.assessmentId ?? null,
      assessmentName: metadata.assessmentName ?? null,
      columnMapping: metadata.columnMapping ?? null,
      rows: parserResult.rows,
      detectedColumns: parserResult.detectedColumns,
      warnings: parserResult.warnings,
    });

    return {
      previewToken: entry.previewToken,
      format: entry.format,
      totalRows: entry.rows.length,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }

  /**
   * Devuelve la previsualización de un upload previo: matchea alumnos por
   * RUT contra la org del caller y lista warnings, errores y filas.
   */
  async preview(
    user: JwtPayload,
    previewToken: string,
  ): Promise<AnswerSheetPreviewResponse> {
    const orgId = this.requireOrgId(user);
    const entry = this.previewStore.get(previewToken);
    if (!entry) {
      throw new NotFoundException(
        'Token de previsualización no encontrado o expirado',
      );
    }
    if (entry.orgId !== orgId) {
      throw new ForbiddenException(
        'Este token de previsualización pertenece a otra organización',
      );
    }

    // matchStudents consulta `students` (RLS): correr con contexto de org.
    const matches = await withOrgContext(this.db, orgId, async (tx) =>
      matchStudents(tx, orgId, entry.rows),
    );

    // Posiciones detectadas (todas las preguntas que aparecieron en alguna fila).
    const positionSet = new Set<string>();
    for (const row of entry.rows) {
      for (const pos of Object.keys(row.answers)) positionSet.add(pos);
    }
    const itemPositions = Array.from(positionSet)
      .map((p) => parseInt(p, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    // Comparar con los items del instrumento.
    const instrumentItems = await this.loadInstrumentItems(entry.instrumentId);
    const instrumentPositions = new Set(instrumentItems.map((i) => i.position));
    const missingItemPositions = Array.from(instrumentPositions)
      .filter((p) => !positionSet.has(String(p)))
      .sort((a, b) => a - b);

    let matchedRows = 0;
    let unmatchedRows = 0;
    let errorRows = 0;

    const rows: AnswerSheetRowPreview[] = entry.rows.map((row) => {
      const m = matches.get(row.rowNumber);
      const matched = !!m?.matched;
      if (matched) matchedRows++;
      else unmatchedRows++;

      const answeredCount = Object.values(row.answers).filter(
        (v) => v !== null,
      ).length;

      const errors = [...row.errors];
      if (!matched && m && !m.rutNormalized) {
        errors.push({
          rowNumber: row.rowNumber,
          field: 'studentRut',
          message: `RUT inválido: "${row.studentRut ?? ''}"`,
        });
      } else if (!matched) {
        errors.push({
          rowNumber: row.rowNumber,
          field: 'studentRut',
          message: `No se encontró un alumno con RUT ${m?.rutNormalized ?? row.studentRut ?? ''} en esta organización`,
        });
      }

      if (errors.length > 0) errorRows++;

      return {
        rowNumber: row.rowNumber,
        studentRut: m?.rutNormalized ?? row.studentRut,
        studentFullName: m?.studentFullName ?? row.studentFullName,
        studentId: m?.studentId ?? null,
        matched,
        answers: row.answers,
        answeredCount,
        errors,
      };
    });

    const instrumentName = await this.loadInstrumentName(entry.instrumentId);

    return {
      previewToken: entry.previewToken,
      format: entry.format,
      instrumentId: entry.instrumentId,
      instrumentName,
      detectedColumns: entry.detectedColumns,
      rows,
      summary: {
        totalRows: entry.rows.length,
        matchedStudents: matchedRows,
        unmatchedStudents: unmatchedRows,
        rowsWithErrors: errorRows,
        itemsInInstrument: instrumentPositions.size,
        itemsCovered: itemPositions.length,
      },
      warnings: [
        ...entry.warnings,
        ...(missingItemPositions.length > 0
          ? [
              `Faltan respuestas para ${missingItemPositions.length} pregunta(s) del instrumento`,
            ]
          : []),
      ],
    };
  }

  /**
   * Confirma la ingesta: persiste responses, agrega resultados y registra
   * el import_job. Todo en una sola transacción.
   */
  async confirm(
    user: JwtPayload,
    body: AnswerSheetConfirmRequestDto,
  ): Promise<AnswerSheetConfirmResponse> {
    const orgId = this.requireOrgId(user);
    const entry = this.previewStore.get(body.previewToken);
    if (!entry) {
      throw new NotFoundException(
        'Token de previsualización no encontrado o expirado',
      );
    }
    if (entry.orgId !== orgId) {
      throw new ForbiddenException(
        'Este token de previsualización pertenece a otra organización',
      );
    }

    // 1. Resolver el instrumento (y reusar metadata).
    const instrument = await this.ensureInstrumentVisible(entry.instrumentId, orgId);

    // 2. Cargar items + correctKey + tags.
    const instrumentItems = await this.loadInstrumentItems(entry.instrumentId);
    if (instrumentItems.length === 0) {
      throw new BadRequestException(
        'El instrumento no tiene ítems configurados — no se pueden ingestar respuestas',
      );
    }
    const itemByPosition = new Map<number, ItemForAssessment>();
    for (const it of instrumentItems) itemByPosition.set(it.position, it);

    const itemIds = instrumentItems.map((it) => it.id);
    const tags = await this.db
      .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
      .from(itemTaxonomyTags)
      .where(inArray(itemTaxonomyTags.itemId, itemIds));
    const tagsByItemId = new Map<string, string[]>();
    for (const t of tags) {
      const list = tagsByItemId.get(t.itemId) ?? [];
      list.push(t.nodeId);
      tagsByItemId.set(t.itemId, list);
    }

    // 3. Re-matchear alumnos (no confiamos en datos del preview).
    //    matchStudents consulta `students` (RLS): correr con contexto de org.
    const matches = await withOrgContext(this.db, orgId, async (tx) =>
      matchStudents(tx, orgId, entry.rows),
    );

    // 4. Construir responses + errores.
    const errors: AnswerSheetRowError[] = [];
    const responseRows: Array<typeof responses.$inferInsert> = [];
    const calcResponses: ResponseForCalculation[] = [];
    const processedStudentIds = new Set<string>();
    let rowsSkipped = 0;
    const now = new Date();

    for (const row of entry.rows) {
      const match = matches.get(row.rowNumber);
      const rowErrors = [...row.errors];
      if (!match?.matched || !match.studentId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'studentRut',
          message: !match?.rutNormalized
            ? `RUT inválido: "${row.studentRut ?? ''}"`
            : `No se encontró un alumno con RUT ${match.rutNormalized}`,
        });
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        if (body.skipErrorRows) {
          rowsSkipped++;
          continue;
        }
        // Si no se saltan, la fila no se puede ingestar si no hay studentId.
        if (!match?.studentId) {
          rowsSkipped++;
          continue;
        }
      }

      const studentId = match!.studentId!;
      processedStudentIds.add(studentId);

      // Crear una response por ítem del instrumento (incluye los items que
      // el alumno no contestó: rawScore = 0). Esto garantiza que el calculador
      // pueda derivar % real (con totalQuestions del instrumento).
      for (const item of instrumentItems) {
        const rawAnswer = row.answers[String(item.position)] ?? null;
        const isCorrect =
          rawAnswer === null
            ? false
            : rawAnswer.toUpperCase() === item.correctKey.toUpperCase();
        const rawScore = isCorrect ? item.maxScore : 0;
        const finalScore = rawScore;

        responseRows.push({
          assessmentId: '', // se completa una vez creado el assessment
          studentId,
          itemId: item.id,
          value: { answer: rawAnswer },
          isCorrect,
          rawScore: rawScore.toFixed(2),
          maxScore: item.maxScore.toFixed(2),
          finalScore: finalScore.toFixed(2),
          scoredBy: 'auto',
          scoredAt: now,
        });

        calcResponses.push({
          studentId,
          itemId: item.id,
          itemPosition: item.position,
          rawScore,
          maxScore: item.maxScore,
          finalScore,
          isCorrect,
          taxonomyNodeIds: tagsByItemId.get(item.id) ?? [],
        });
      }
    }

    if (responseRows.length === 0) {
      throw new BadRequestException(
        'No hay filas válidas para ingestar. Revisa los errores de matching antes de confirmar.',
      );
    }

    // 5. Resolver grading scale del instrumento.
    const scale = await this.resolveGradingScale(instrument.gradingScaleId);

    // 6. Transacción: crear/reusar assessment + responses + results + import_job.
    //    Toca assessments/responses/assessment_results/skill_results/import_jobs
    //    (todas con RLS): withOrgContext fija el contexto de org en la transacción.
    const transactionResult = await withOrgContext(this.db, orgId, async (tx) => {
      // Crear o reusar assessment.
      let assessmentId: string;
      if (body.assessmentId) {
        const [existing] = await tx
          .select({ id: assessments.id, orgId: assessments.orgId })
          .from(assessments)
          .where(eq(assessments.id, body.assessmentId));
        if (!existing || existing.orgId !== orgId) {
          throw new ForbiddenException(
            'El assessment indicado no existe o no pertenece a tu organización',
          );
        }
        assessmentId = existing.id;
      } else {
        const name =
          body.assessmentName ??
          entry.assessmentName ??
          `Ingesta ${entry.format} ${now.toISOString().slice(0, 10)}`;
        const [created] = await tx
          .insert(assessments)
          .values({
            orgId,
            instrumentId: entry.instrumentId,
            name,
            mode: 'paper',
            status: 'completed',
            administeredAt: now,
            administeredById: user.userId,
            config: { source: entry.format },
          })
          .returning({ id: assessments.id });
        if (!created) throw new Error('No se pudo crear el assessment');
        assessmentId = created.id;
      }

      // Asignar assessmentId a todas las responses pendientes.
      const responsesWithAssessment = responseRows.map((r) => ({
        ...r,
        assessmentId,
      }));

      // Batch insert con upsert (assessmentId, studentId, itemId).
      await tx
        .insert(responses)
        .values(responsesWithAssessment)
        .onConflictDoUpdate({
          target: [responses.assessmentId, responses.studentId, responses.itemId],
          set: {
            value: sql`excluded.value`,
            isCorrect: sql`excluded.is_correct`,
            rawScore: sql`excluded.raw_score`,
            maxScore: sql`excluded.max_score`,
            finalScore: sql`excluded.final_score`,
            scoredBy: sql`excluded.scored_by`,
            scoredAt: sql`excluded.scored_at`,
            updatedAt: now,
          },
        });

      // Limpiar resultados previos del assessment para reinsertar agregados.
      await tx
        .delete(assessmentResults)
        .where(eq(assessmentResults.assessmentId, assessmentId));
      await tx.delete(skillResults).where(eq(skillResults.assessmentId, assessmentId));

      // Llamar al calculador puro.
      const studentAgg = aggregateStudentResults(calcResponses, scale);
      const skillAgg = aggregateSkillResults(calcResponses, scale);

      if (studentAgg.length > 0) {
        await tx.insert(assessmentResults).values(
          studentAgg.map((a) => ({
            assessmentId,
            studentId: a.studentId,
            totalScore: a.totalScore.toFixed(2),
            maxScore: a.maxScore.toFixed(2),
            // Model contract: percentage es 0..100 (decimal string)
            percentage: (a.percentage * 100).toFixed(2),
            grade: a.grade.toFixed(2),
            performanceLevel: a.performanceLevel,
            isComplete: a.isComplete,
            completedAt: now,
          })),
        );
      }

      if (skillAgg.length > 0) {
        await tx.insert(skillResults).values(
          skillAgg.map((a) => ({
            assessmentId,
            studentId: a.studentId,
            nodeId: a.nodeId,
            correctCount: a.correctCount,
            totalCount: a.totalCount,
            // Model contract: percentage es 0..100
            percentage: (a.percentage * 100).toFixed(2),
            performanceLevel: a.performanceLevel,
          })),
        );
      }

      // Crear el import_job.
      const importType = mapFormatToImportJobType(entry.format);
      const status: 'completed' | 'partial' = errors.length > 0 ? 'partial' : 'completed';
      const [job] = await tx
        .insert(importJobs)
        .values({
          orgId,
          assessmentId,
          type: importType,
          status,
          fileUrl: null,
          mappingConfig: {
            format: entry.format,
            instrumentId: entry.instrumentId,
            columnMapping: entry.columnMapping ?? null,
          },
          result: {
            rowsProcessed: entry.rows.length - rowsSkipped,
            errors: errors.length,
            warnings: entry.warnings.length,
          },
          errorLog: errors.map((e) => ({ row: e.rowNumber, message: e.message })),
          createdById: user.userId,
          completedAt: now,
        })
        .returning({ id: importJobs.id });

      if (!job) throw new Error('No se pudo crear el import_job');

      return { assessmentId, jobId: job.id, responsesCreated: responsesWithAssessment.length };
    });

    // 7. Limpiar el preview store: el token es de un solo uso.
    this.previewStore.delete(body.previewToken);

    const status: AnswerSheetConfirmResponse['status'] =
      errors.length === 0
        ? 'completed'
        : processedStudentIds.size === 0
          ? 'failed'
          : 'partial';

    return {
      jobId: transactionResult.jobId,
      assessmentId: transactionResult.assessmentId,
      status,
      responsesCreated: transactionResult.responsesCreated,
      studentsProcessed: processedStudentIds.size,
      rowsSkipped,
      errors,
    };
  }

  async getJob(user: JwtPayload, jobId: string): Promise<ImportJobModel> {
    const orgId = this.requireOrgId(user);
    // importJobs tiene RLS: correr el SELECT con contexto de org.
    const [row] = await withOrgContext(this.db, orgId, async (tx) =>
      tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.id, jobId), eq(importJobs.orgId, orgId))),
    );
    if (!row) throw new NotFoundException('Import job no encontrado');
    return {
      id: row.id,
      orgId: row.orgId,
      assessmentId: row.assessmentId,
      type: row.type,
      status: row.status,
      fileUrl: row.fileUrl,
      mappingConfig: (row.mappingConfig as Record<string, unknown> | null) ?? null,
      result: row.result ?? null,
      errorLog: row.errorLog ?? null,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }

  listTemplates(): AnswerSheetTemplate[] {
    return listTemplates();
  }

  getTemplate(format: AnswerSheetFormat): AnswerSheetTemplate | null {
    return getTemplate(format);
  }

  // ---------- helpers ----------

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }

  private runParser(
    format: AnswerSheetFormat,
    buffer: Buffer,
    mapping: AnswerSheetColumnMapping | null,
  ): ParserResult {
    switch (format) {
      case 'dia_official':
        return parseDiaOfficialCsv(buffer);
      case 'gradecam_csv':
        return parseGradecamCsv(buffer);
      case 'zipgrade_csv':
        return parseZipgradeCsv(buffer);
      case 'generic_csv':
        if (!mapping) {
          throw new BadRequestException(
            'columnMapping es requerido para el formato generic_csv',
          );
        }
        return parseGenericCsv(buffer, mapping);
      default: {
        // Exhaustiveness: TS marca error si se agrega un format y se olvida acá.
        const _exhaustive: never = format;
        throw new BadRequestException(
          `Formato no soportado: ${String(_exhaustive)}`,
        );
      }
    }
  }

  private async ensureInstrumentVisible(
    instrumentId: string,
    orgId: string,
  ): Promise<{ id: string; gradingScaleId: string | null }> {
    const [row] = await this.db
      .select({
        id: instruments.id,
        orgId: instruments.orgId,
        gradingScaleId: instruments.gradingScaleId,
      })
      .from(instruments)
      .where(
        and(
          eq(instruments.id, instrumentId),
          isNull(instruments.deletedAt),
          or(eq(instruments.orgId, orgId), isNull(instruments.orgId)),
        ),
      );
    if (!row) {
      throw new NotFoundException(
        'Instrumento no encontrado o no visible para tu organización',
      );
    }
    return { id: row.id, gradingScaleId: row.gradingScaleId ?? null };
  }

  private async loadInstrumentName(instrumentId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: instruments.name })
      .from(instruments)
      .where(eq(instruments.id, instrumentId));
    return row?.name ?? '';
  }

  private async loadInstrumentItems(
    instrumentId: string,
  ): Promise<ItemForAssessment[]> {
    const rows = await this.db
      .select({
        id: items.id,
        position: items.position,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
      .orderBy(items.position);

    const out: ItemForAssessment[] = [];
    for (const row of rows) {
      const correctKey = this.extractCorrectKey(row.content as MultipleChoiceItemContent);
      const scoringConfig = (row.scoringConfig ?? {}) as { points?: number };
      const maxScore = scoringConfig.points ?? 1;
      out.push({
        id: row.id,
        position: row.position,
        correctKey,
        maxScore,
      });
    }
    return out;
  }

  /**
   * Acepta dos shapes:
   *  - `{ correctKey: "A" }` (formato dia-ingestion actual)
   *  - `{ alternatives: [{ key: "A", isCorrect: true }] }` (formato extensible)
   */
  private extractCorrectKey(content: MultipleChoiceItemContent): string {
    if (typeof content.correctKey === 'string' && content.correctKey) {
      return content.correctKey.toUpperCase();
    }
    if (Array.isArray(content.alternatives)) {
      const correct = content.alternatives.find((a) => a.isCorrect === true);
      if (correct && typeof correct.key === 'string') {
        return correct.key.toUpperCase();
      }
    }
    // Si no hay clave, retornar "" y dejar que el cálculo marque todas como incorrectas.
    return '';
  }

  private async resolveGradingScale(
    gradingScaleId: string | null,
  ): Promise<GradingScaleParams> {
    if (!gradingScaleId) return DEFAULT_GRADING_SCALE;
    const [row] = await this.db
      .select()
      .from(gradingScales)
      .where(eq(gradingScales.id, gradingScaleId));
    if (!row) return DEFAULT_GRADING_SCALE;
    const config = (row.config ?? {}) as {
      performanceThresholds?: GradingScaleParams['performanceThresholds'];
    };
    return {
      type: row.type as GradingScaleType,
      minGrade: Number(row.minGrade),
      maxGrade: Number(row.maxGrade),
      passingGrade: Number(row.passingGrade),
      passingThreshold: Number(row.passingThreshold),
      performanceThresholds: config.performanceThresholds,
    };
  }
}

function mapFormatToImportJobType(
  format: AnswerSheetFormat,
):
  | 'dia_official'
  | 'gradecam_csv'
  | 'zipgrade_csv'
  | 'answer_sheet_csv' {
  switch (format) {
    case 'dia_official':
      return 'dia_official';
    case 'gradecam_csv':
      return 'gradecam_csv';
    case 'zipgrade_csv':
      return 'zipgrade_csv';
    case 'generic_csv':
      return 'answer_sheet_csv';
  }
}
