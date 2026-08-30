import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  assessments,
  gradingScales,
  importJobs,
  instruments,
  items,
  responses,
  withOrgContext,
} from '@soe/db';
import {
  CAPABILITY_UNAVAILABLE_CODE,
  DEFAULT_GRADING_SCALE,
  capabilityUnavailableMessage,
  getScoringStrategy,
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
  type ItemContent,
  type ItemType,
  type ScoringConfig,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import {
  ANSWER_SHEET_IMPORT_POLICY,
  loadResponsesForPersist,
  persistAssessmentResults,
} from '../assessment-results/lib/persist-results';
import { resolveEffectiveBands } from '../performance-bands/lib/resolve-effective-bands';

import { AnswerSheetPreviewStore } from './lib/preview-store';
import { parseGradecamCsv } from './lib/parsers/gradecam-parser';
import { parseZipgradeCsv } from './lib/parsers/zipgrade-parser';
import { parseDiaOfficialCsv } from './lib/parsers/dia-official-parser';
import { parseGenericCsv } from './lib/parsers/generic-csv-parser';
import { getTemplate, listTemplates } from './lib/templates';
import type { ParserResult } from './lib/parsers/parser.types';
import { matchStudents } from './lib/student-matcher';
import {
  buildPrintedLabelIndex,
  resolveRowAnswers,
  toScoringAnswer,
} from './lib/composite-answers';

interface ItemForAssessment {
  id: string;
  position: number;
  /** Número impreso en el cuadernillo, si difiere de `position`. */
  printedNumber: string | null;
  type: ItemType;
  content: ItemContent;
  maxScore: number;
  scoringConfig: ScoringConfig;
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
  async preview(user: JwtPayload, previewToken: string): Promise<AnswerSheetPreviewResponse> {
    const orgId = this.requireOrgId(user);
    const entry = this.previewStore.get(previewToken);
    if (!entry) {
      throw new NotFoundException('Token de previsualización no encontrado o expirado');
    }
    if (entry.orgId !== orgId) {
      throw new ForbiddenException('Este token de previsualización pertenece a otra organización');
    }

    // matchStudents consulta `students` (RLS): correr con contexto de org.
    const matches = await withOrgContext(this.db, orgId, async (tx) =>
      matchStudents(tx, orgId, entry.rows),
    );

    // Resolver las etiquetas del escaneo contra los ítems del instrumento: la
    // hoja numera por el NÚMERO IMPRESO y la BDD por `position`, que no
    // coinciden cuando el cuadernillo sub-numera (ver lib/composite-answers.ts).
    const instrumentItems = await this.loadInstrumentItems(entry.instrumentId);
    const labelIndex = buildPrintedLabelIndex(instrumentItems);

    const coveredPositions = new Set<number>();
    const unmatchedLabels = new Set<string>();
    const unexpectedComposites = new Set<number>();
    for (const row of entry.rows) {
      const resolved = resolveRowAnswers(labelIndex, row.answers);
      for (const position of resolved.byPosition.keys()) coveredPositions.add(position);
      for (const label of resolved.unmatchedLabels) unmatchedLabels.add(label);
      for (const position of resolved.unexpectedCompositePositions) {
        unexpectedComposites.add(position);
      }
    }

    const itemPositions = Array.from(coveredPositions).sort((a, b) => a - b);
    const instrumentPositions = new Set(instrumentItems.map((i) => i.position));
    const missingItemPositions = Array.from(instrumentPositions)
      .filter((p) => !coveredPositions.has(p))
      .sort((a, b) => a - b);

    // Sub-numeración inesperada: el escaneo trae varias sub-columnas para un
    // ítem que la app NO modela como compuesto. Antes se perdían todas las
    // sub-respuestas menos la última, en silencio; ahora se avisa.
    const unexpectedCompositePositions = Array.from(unexpectedComposites).sort((a, b) => a - b);
    const unresolvedScanLabels = Array.from(unmatchedLabels).sort();

    let matchedRows = 0;
    let unmatchedRows = 0;
    let errorRows = 0;
    let bodyMatchedRows = 0;

    const rows: AnswerSheetRowPreview[] = entry.rows.map((row) => {
      const m = matches.get(row.rowNumber);
      const matched = !!m?.matched;
      if (matched) matchedRows++;
      else unmatchedRows++;
      if (matched && m?.matchMethod === 'body') bodyMatchedRows++;

      // Cuenta POSICIONES respondidas, no columnas del archivo: un ítem
      // compuesto que el escaneo sub-numera es una sola pregunta del instrumento.
      const answeredCount = Object.values(row.answers).filter((v) =>
        v !== null && typeof v === 'object' ? Object.keys(v).length > 0 : v !== null,
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
        ...(bodyMatchedRows > 0
          ? [
              `${bodyMatchedRows} alumno(s) se identificaron por el cuerpo del RUT porque el ` +
                'dígito verificador no coincidía (típico de un DV = K capturado como 0 por el escáner). Revísalos antes de confirmar.',
            ]
          : []),
        ...(missingItemPositions.length > 0
          ? [`Faltan respuestas para ${missingItemPositions.length} pregunta(s) del instrumento`]
          : []),
        ...(unexpectedCompositePositions.length > 0
          ? [
              `El escaneo sub-numera la(s) pregunta(s) ${unexpectedCompositePositions.join(', ')}, ` +
                'que en el instrumento son un único ítem no compuesto: se usará la primera sub-respuesta.',
            ]
          : []),
        ...(unresolvedScanLabels.length > 0
          ? [
              `${unresolvedScanLabels.length} columna(s) del archivo no corresponden a ninguna ` +
                `pregunta del instrumento y se ignorarán: ${unresolvedScanLabels.slice(0, 10).join(', ')}`,
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
      throw new NotFoundException('Token de previsualización no encontrado o expirado');
    }
    if (entry.orgId !== orgId) {
      throw new ForbiddenException('Este token de previsualización pertenece a otra organización');
    }

    // 1. Resolver el instrumento (y reusar metadata).
    const instrument = await this.ensureInstrumentVisible(entry.instrumentId, orgId);

    // 2. Cargar items + correctKey. Los tags de habilidad NO se cargan acá: el
    //    recálculo de resultados los resuelve al releer las `responses` persistidas.
    const instrumentItems = await this.loadInstrumentItems(entry.instrumentId);
    if (instrumentItems.length === 0) {
      throw new BadRequestException(
        'El instrumento no tiene ítems configurados — no se pueden ingestar respuestas',
      );
    }
    const labelIndex = buildPrintedLabelIndex(instrumentItems);

    // 3. Re-matchear alumnos (no confiamos en datos del preview).
    //    matchStudents consulta `students` (RLS): correr con contexto de org.
    const matches = await withOrgContext(this.db, orgId, async (tx) =>
      matchStudents(tx, orgId, entry.rows),
    );

    // 4. Construir responses + errores.
    const errors: AnswerSheetRowError[] = [];
    const responseRows: Array<typeof responses.$inferInsert> = [];
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
      //
      // La corrección se delega al registro de estrategias por `item.type`
      // (#1): MCQ/true_false → binaria; matching/ordering/gap_fill →
      // determinística por content; el resto → pendiente (corrección humana/IA),
      // NUNCA 0/incorrecto en silencio.
      // El escaneo numera por el número impreso, no por `position`, y puede traer
      // varias sub-columnas para una sola pregunta (`7B1`…`7B4`). Se resuelve
      // contra los ítems del instrumento antes de corregir.
      const resolvedRow = resolveRowAnswers(labelIndex, row.answers);

      for (const item of instrumentItems) {
        const rawAnswer = toScoringAnswer(item, resolvedRow.byPosition.get(item.position));
        const result = getScoringStrategy(item.type).score({
          item: {
            id: item.id,
            type: item.type,
            content: item.content,
            maxScore: item.maxScore,
            scoringConfig: item.scoringConfig,
          },
          rawAnswer,
        });

        if (result.requiresManualGrading) {
          // Pendiente de corrección humana/IA (F4). NUNCA puntuar 0/incorrecto:
          // scores en null → el calculador puro excluye `isCorrect === null` del
          // denominador, así no contaminan el % de los autocorregidos.
          responseRows.push({
            assessmentId: '', // se completa una vez creado el assessment
            studentId,
            itemId: item.id,
            value: { answer: rawAnswer },
            isCorrect: null,
            rawScore: null,
            maxScore: item.maxScore.toFixed(2),
            finalScore: null,
            scoredBy: 'human',
            scoredAt: null,
          });
          continue;
        }

        const rawScore = result.rawScore ?? 0;
        const finalScore = rawScore;

        responseRows.push({
          assessmentId: '', // se completa una vez creado el assessment
          studentId,
          itemId: item.id,
          value: { answer: rawAnswer },
          isCorrect: result.isCorrect,
          rawScore: rawScore.toFixed(2),
          maxScore: item.maxScore.toFixed(2),
          finalScore: finalScore.toFixed(2),
          scoredBy: 'auto',
          scoredAt: now,
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
          .select({
            id: assessments.id,
            orgId: assessments.orgId,
            dataGranularity: assessments.dataGranularity,
          })
          .from(assessments)
          .where(eq(assessments.id, body.assessmentId));
        if (!existing || existing.orgId !== orgId) {
          throw new ForbiddenException(
            'El assessment indicado no existe o no pertenece a tu organización',
          );
        }
        // Un assessment `aggregate_only` vino de un informe oficial: sus niveles y su
        // read-model son `imported`. Ingestar respuestas encima lo dejaría mitad
        // importado y mitad computado, con el delete + reinsert borrando lo primero.
        if (existing.dataGranularity === 'aggregate_only') {
          throw new ConflictException({
            statusCode: 409,
            error: 'CapabilityUnavailable',
            code: CAPABILITY_UNAVAILABLE_CODE,
            capability: 'answer_sheet_import',
            message: capabilityUnavailableMessage('answer_sheet_import'),
          });
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
      const keepsExistingScore = sql`excluded.final_score IS NULL AND ${responses.finalScore} IS NOT NULL`;
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
            finalScore: sql`CASE WHEN ${keepsExistingScore} THEN ${responses.finalScore} ELSE excluded.final_score END`,
            scoredBy: sql`CASE WHEN ${keepsExistingScore} THEN ${responses.scoredBy} ELSE excluded.scored_by END`,
            scoredAt: sql`CASE WHEN ${keepsExistingScore} THEN ${responses.scoredAt} ELSE excluded.scored_at END`,
            updatedAt: now,
          },
        });

      // Delete + reinsert de assessment_results / skill_results / read-model de
      // cohorte, compartido con `AssessmentResultsService.computeAndPersist`.
      // `ANSWER_SHEET_IMPORT_POLICY` conserva las dos divergencias de este flujo
      // (pendientes fuera del total por alumno; completed_at siempre estampado);
      // están documentadas en persist-results.ts.
      //
      // Se recalcula desde TODAS las `responses` del assessment (ya con el upsert de
      // arriba aplicado), no sólo desde las filas de esta subida: el reemplazo es por
      // assessment, así que alimentarlo con la subida actual borraría los resultados
      // de los cursos cargados antes contra el mismo assessment (permitido más
      // arriba, vía `body.assessmentId`). `responses` es la única fuente completa.
      const allResponses = await loadResponsesForPersist(tx, assessmentId);
      const { bands } = await resolveEffectiveBands(tx, entry.instrumentId);
      await persistAssessmentResults(tx, {
        assessmentId,
        responses: allResponses,
        scale,
        bands,
        now,
        policy: ANSWER_SHEET_IMPORT_POLICY,
      });

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
      errors.length === 0 ? 'completed' : processedStudentIds.size === 0 ? 'failed' : 'partial';

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
          throw new BadRequestException('columnMapping es requerido para el formato generic_csv');
        }
        return parseGenericCsv(buffer, mapping);
      default: {
        // Exhaustiveness: TS marca error si se agrega un format y se olvida acá.
        const _exhaustive: never = format;
        throw new BadRequestException(`Formato no soportado: ${String(_exhaustive)}`);
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
      throw new NotFoundException('Instrumento no encontrado o no visible para tu organización');
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

  private async loadInstrumentItems(instrumentId: string): Promise<ItemForAssessment[]> {
    const rows = await this.db
      .select({
        id: items.id,
        position: items.position,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
      .orderBy(items.position);

    const out: ItemForAssessment[] = [];
    for (const row of rows) {
      const scoringConfig = (row.scoringConfig ?? {}) as ScoringConfig;
      const maxScore = scoringConfig?.points ?? 1;
      // El número impreso sólo se persiste cuando difiere de la posición; es la
      // clave con la que numera la hoja de respuestas escaneada.
      const printedNumber =
        typeof scoringConfig?.printedNumber === 'string' ? scoringConfig.printedNumber : null;
      out.push({
        id: row.id,
        position: row.position,
        printedNumber,
        scoringConfig,
        // `items.type` es un enum de DB tipado como ItemType. El `content`
        // JSONB ya está tipado como ItemContent en el schema Drizzle; lo pasamos
        // a la estrategia de scoring correspondiente a su `type`.
        type: row.type as ItemType,
        content: (row.content ?? {}) as ItemContent,
        maxScore,
      });
    }
    return out;
  }

  private async resolveGradingScale(gradingScaleId: string | null): Promise<GradingScaleParams> {
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
): 'dia_official' | 'gradecam_csv' | 'zipgrade_csv' | 'answer_sheet_csv' {
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
