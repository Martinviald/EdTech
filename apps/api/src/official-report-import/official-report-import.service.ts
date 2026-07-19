import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentLevelStats,
  assessmentResults,
  assessmentSkillStats,
  assessments,
  classGroups,
  importJobs,
  itemTaxonomyTags,
  items,
  instruments,
  studentEnrollments,
  students,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  buildLevelStatCounts,
  officialReportImportFileSchema,
  type ImportJobStatus,
  type ItemCohortStats,
  type OfficialReportImportConfirmRequestDto,
  type OfficialReportImportConfirmResponse,
  type OfficialReportImportFile,
  type OfficialReportImportPreviewResponse,
  type OfficialReportImportUploadMetadataDto,
  type OfficialReportImportUploadResponse,
  type PerformanceBandInput,
  type SkillCohortStats,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';
import { evaluateGates, resolveLevelBand, type GateContext } from './lib/evaluate-gates';
import { OfficialReportPreviewStore } from './lib/preview-store';
import type { InstrumentItemForImport } from './lib/report-to-item-stats';
import type { StudentForMatch } from './lib/student-name-matcher';

/**
 * Importador de informes oficiales de resultados (§6 del plan).
 *
 * Escribe el read-model de cohorte (`assessment_item_stats` / `assessment_skill_stats`)
 * con `source='imported'` — el segundo escritor, en paralelo al cálculo desde `responses`.
 * NO escribe `responses`: un informe agregado no las tiene y reconstruirlas sería ficción
 * (§8.7). Vive fuera de `dia-ingestion/`, que importa bancos de preguntas, no resultados.
 *
 * Flujo `upload → preview → confirm`, síncrono, calcado de `answer-sheets`: token de un
 * solo uso en memoria y `import_jobs` escrito ya `completed`/`partial` dentro de la misma
 * transacción (es auditoría, no una cola).
 */
@Injectable()
export class OfficialReportImportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly previewStore: OfficialReportPreviewStore,
  ) {}

  /**
   * Valida el JSON contra el contrato y lo deja en memoria. NO persiste nada ni
   * corre los gates todavía (esos dependen de la BD y los corre el preview).
   */
  async upload(
    user: JwtPayload,
    file: { buffer: Buffer; originalname?: string },
    metadata: OfficialReportImportUploadMetadataDto,
  ): Promise<OfficialReportImportUploadResponse> {
    const orgId = this.requireOrgId(user);
    const parsed = this.parseReportFile(file.buffer);

    // Hardstop temprano: no guardar un informe contra un instrumento o curso ajenos.
    await this.ensureInstrumentVisible(metadata.instrumentId, orgId);
    await this.ensureClassGroup(metadata.classGroupId, orgId);

    const entry = this.previewStore.set({
      orgId,
      userId: user.userId,
      instrumentId: metadata.instrumentId,
      classGroupId: metadata.classGroupId,
      assessmentId: metadata.assessmentId ?? null,
      assessmentName: metadata.assessmentName ?? null,
      file: parsed,
    });

    return {
      previewToken: entry.previewToken,
      sourceFile: parsed.source.file,
      totalItems: parsed.items.length,
      totalStudents: parsed.students?.length ?? 0,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }

  /** Corre los 5 gates contra la BD y devuelve el veredicto. No persiste nada. */
  async preview(
    user: JwtPayload,
    previewToken: string,
  ): Promise<OfficialReportImportPreviewResponse> {
    const orgId = this.requireOrgId(user);
    const entry = this.requireEntry(previewToken, orgId);

    const ctx = await this.buildGateContext(
      orgId,
      entry.instrumentId,
      entry.classGroupId,
      entry.file,
    );
    const evaluation = evaluateGates(ctx);

    const instrumentName = await this.loadInstrumentName(entry.instrumentId);
    const classGroupName = await this.loadClassGroupName(entry.classGroupId);

    return {
      previewToken: entry.previewToken,
      instrumentId: entry.instrumentId,
      instrumentName,
      classGroupId: entry.classGroupId,
      classGroupName,
      report: entry.file.report,
      gates: evaluation.gates,
      canConfirm: evaluation.canConfirm,
      items: evaluation.items,
      skillAxes: evaluation.skillAxes,
      levelDistribution: evaluation.levelDistribution,
      students: evaluation.students,
      warnings: [...evaluation.warnings, ...this.metadataWarnings(entry.file, classGroupName)],
    };
  }

  /**
   * Persiste el informe. Todo en UNA transacción con contexto de org (RLS).
   *
   * Los gates se recalculan acá: no se confía en el veredicto del preview.
   */
  async confirm(
    user: JwtPayload,
    body: OfficialReportImportConfirmRequestDto,
  ): Promise<OfficialReportImportConfirmResponse> {
    const orgId = this.requireOrgId(user);
    const entry = this.requireEntry(body.previewToken, orgId);
    const { file, instrumentId, classGroupId } = entry;

    const ctx = await this.buildGateContext(orgId, instrumentId, classGroupId, file);
    const evaluation = evaluateGates(ctx);
    if (!evaluation.canConfirm) {
      const blocking = evaluation.gates.filter((g) => g.blocking && g.status === 'failed');
      throw new BadRequestException({
        message: 'El informe no pasó las validaciones de integridad y no se puede importar.',
        gates: blocking,
      });
    }

    const approved = this.resolveApprovedStudents(file, body, ctx);
    const now = new Date();
    const targetAssessmentId = body.assessmentId ?? entry.assessmentId;

    const result = await withOrgContext(this.db, orgId, async (tx) => {
      const assessmentId = await this.resolveAssessment(tx, {
        orgId,
        userId: user.userId,
        assessmentId: targetAssessmentId,
        assessmentName: body.assessmentName ?? entry.assessmentName,
        instrumentId,
        file,
        now,
      });

      await tx
        .insert(assessmentCourseAssignments)
        .values({ assessmentId, classGroupId })
        .onConflictDoNothing();

      // Reimportar el mismo curso reemplaza sus filas; las de los OTROS cursos del
      // assessment no se tocan (el grano del read-model es por curso).
      await tx
        .delete(assessmentItemStats)
        .where(
          and(
            eq(assessmentItemStats.assessmentId, assessmentId),
            eq(assessmentItemStats.classGroupId, classGroupId),
          ),
        );
      await tx
        .delete(assessmentSkillStats)
        .where(
          and(
            eq(assessmentSkillStats.assessmentId, assessmentId),
            eq(assessmentSkillStats.classGroupId, classGroupId),
          ),
        );

      if (evaluation.itemStats.length > 0) {
        await tx
          .insert(assessmentItemStats)
          .values(evaluation.itemStats.map((s) => toItemStatsRow(s, assessmentId, now)));
      }
      if (evaluation.skillStats.length > 0) {
        await tx
          .insert(assessmentSkillStats)
          .values(evaluation.skillStats.map((s) => toSkillStatsRow(s, assessmentId, now)));
      }

      // Distribución por nivel (Gráfico 1 del informe): conteos enteros por banda,
      // reconstruidos del % + N con el helper puro. Delete+reinsert por curso, igual
      // que item/skill stats. Si el informe no trae Gráfico 1 (`levelDistribution`
      // vacío) o algún nivel no matchea una única banda, el helper devuelve [] y no
      // se escribe nada (solo se limpian filas viejas del reimport).
      const levelStatRows = buildLevelStatCounts({
        levelDistribution: file.levelDistribution,
        studentCount: file.report.studentCount,
        bands: ctx.bands,
      });
      await tx
        .delete(assessmentLevelStats)
        .where(
          and(
            eq(assessmentLevelStats.assessmentId, assessmentId),
            eq(assessmentLevelStats.classGroupId, classGroupId),
          ),
        );
      if (levelStatRows.length > 0) {
        await tx.insert(assessmentLevelStats).values(
          levelStatRows.map((r) => ({
            assessmentId,
            classGroupId,
            performanceBandId: r.performanceBandId,
            studentCount: r.studentCount,
            source: 'imported' as const,
            computedAt: now,
          })),
        );
      }

      // Nivel por alumno. `percentage` va NULL a propósito: el informe entrega el
      // nivel, no el % del alumno — inventarlo contaminaría dashboards y benchmarking.
      if (approved.length > 0) {
        await tx
          .insert(assessmentResults)
          .values(
            approved.map((a) => ({
              assessmentId,
              studentId: a.studentId,
              totalScore: null,
              maxScore: null,
              percentage: null,
              grade: null,
              metricType: 'band' as const,
              bandLabel: a.band.label,
              performanceBandId: a.band.id,
              performanceLevel: null,
              isComplete: true,
              completedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [assessmentResults.assessmentId, assessmentResults.studentId],
            set: {
              totalScore: sql`excluded.total_score`,
              maxScore: sql`excluded.max_score`,
              percentage: sql`excluded.percentage`,
              grade: sql`excluded.grade`,
              metricType: sql`excluded.metric_type`,
              bandLabel: sql`excluded.band_label`,
              performanceBandId: sql`excluded.performance_band_id`,
              performanceLevel: sql`excluded.performance_level`,
              isComplete: sql`excluded.is_complete`,
              completedAt: sql`excluded.completed_at`,
              updatedAt: now,
            },
          });
      }

      const reportedStudents = file.students?.length ?? 0;
      const skipped = reportedStudents - approved.length;
      const status: ImportJobStatus = skipped > 0 ? 'partial' : 'completed';

      const [job] = await tx
        .insert(importJobs)
        .values({
          orgId,
          assessmentId,
          type: 'dia_official_report',
          status,
          fileUrl: null,
          mappingConfig: {
            instrumentId,
            classGroupId,
            sourceFile: file.source.file,
            schemaVersion: file.schemaVersion,
            report: file.report,
          },
          result: {
            rowsProcessed: evaluation.itemStats.length,
            errors: 0,
            warnings: evaluation.warnings.length,
          },
          errorLog: evaluation.gates
            .filter((g) => g.status !== 'passed')
            .map((g) => ({ row: 0, message: `[${g.gate}] ${g.message}` })),
          createdById: user.userId,
          completedAt: now,
        })
        .returning({ id: importJobs.id });
      if (!job) throw new Error('No se pudo crear el import_job');

      return { assessmentId, jobId: job.id, status, skipped };
    });

    // El token es de un solo uso.
    this.previewStore.delete(body.previewToken);

    return {
      jobId: result.jobId,
      assessmentId: result.assessmentId,
      status: result.status,
      itemStatsWritten: evaluation.itemStats.length,
      skillStatsWritten: evaluation.skillStats.length,
      studentResultsWritten: approved.length,
      studentsSkipped: result.skipped,
      warnings: evaluation.warnings,
    };
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

  private requireEntry(previewToken: string, orgId: string) {
    const entry = this.previewStore.get(previewToken);
    if (!entry) {
      throw new NotFoundException('Token de previsualización no encontrado o expirado');
    }
    if (entry.orgId !== orgId) {
      throw new ForbiddenException('Este token de previsualización pertenece a otra organización');
    }
    return entry;
  }

  private parseReportFile(buffer: Buffer): OfficialReportImportFile {
    let raw: unknown;
    try {
      raw = JSON.parse(buffer.toString('utf-8'));
    } catch {
      throw new BadRequestException('El archivo no es un JSON válido');
    }
    const parsed = officialReportImportFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'El informe no cumple el contrato de importación',
        issues: parsed.error.flatten(),
      });
    }
    return parsed.data;
  }

  /**
   * `report.courseLabel` / `rbd` NO resuelven nada: el usuario eligió curso e
   * instrumento. Solo se advierte si no se parecen, para atajar el informe pegado
   * en el curso equivocado.
   */
  private metadataWarnings(file: OfficialReportImportFile, classGroupName: string): string[] {
    const out: string[] = [];
    const normalize = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
    if (
      classGroupName.length > 0 &&
      normalize(file.report.courseLabel) !== normalize(classGroupName)
    ) {
      out.push(
        `El informe dice "${file.report.courseLabel}" pero el curso seleccionado es "${classGroupName}". Verifica que sea el correcto.`,
      );
    }
    return out;
  }

  private async buildGateContext(
    orgId: string,
    instrumentId: string,
    classGroupId: string,
    file: OfficialReportImportFile,
  ): Promise<GateContext> {
    await this.ensureInstrumentVisible(instrumentId, orgId);
    await this.ensureClassGroup(classGroupId, orgId);

    const instrumentItems = await this.loadInstrumentItems(instrumentId);
    if (instrumentItems.length === 0) {
      throw new BadRequestException(
        'El instrumento no tiene ítems configurados — no se puede importar el informe',
      );
    }
    const itemsByPosition = new Map(instrumentItems.map((i) => [i.position, i]));

    const itemIds = instrumentItems.map((i) => i.id);
    const tags = await this.db
      .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
      .from(itemTaxonomyTags)
      .where(inArray(itemTaxonomyTags.itemId, itemIds));

    const tagsByItem = new Map<string, string[]>();
    for (const t of tags) {
      const list = tagsByItem.get(t.itemId) ?? [];
      list.push(t.nodeId);
      tagsByItem.set(t.itemId, list);
    }

    const nodeNameById = new Map<string, string>();
    const nodeIds = [...new Set(tags.map((t) => t.nodeId))];
    if (nodeIds.length > 0) {
      const nodes = await this.db
        .select({ id: taxonomyNodes.id, name: taxonomyNodes.name })
        .from(taxonomyNodes)
        .where(inArray(taxonomyNodes.id, nodeIds));
      for (const n of nodes) nodeNameById.set(n.id, n.name);
    }

    // `students` y `performance_bands` tienen RLS → contexto de org obligatorio.
    const { roster, bands } = await withOrgContext(this.db, orgId, async (tx) => ({
      roster: await this.loadRoster(tx, orgId, classGroupId),
      bands: await loadInstrumentBands(tx, instrumentId),
    }));

    return { file, classGroupId, itemsByPosition, tagsByItem, nodeNameById, bands, roster };
  }

  /**
   * Nómina del curso desde `student_enrollments` — el MISMO camino que usa el scope
   * de roles para resolver alumnos. Usar `assessment_course_assignments` movería
   * alumnos de cohorte (§2.4).
   */
  private async loadRoster(
    tx: Database,
    orgId: string,
    classGroupId: string,
  ): Promise<StudentForMatch[]> {
    const rows = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, students.id))
      .where(
        and(
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
          eq(studentEnrollments.classGroupId, classGroupId),
          eq(studentEnrollments.status, 'active'),
        ),
      );
    return rows;
  }

  /**
   * Traduce el veredicto humano a filas escribibles. **Nunca** usa la propuesta del
   * matcher: solo los pares que vinieron en el body (CLAUDE.md §8.3). Un alumno del
   * informe que no esté aprobado queda fuera y se cuenta como `studentsSkipped`.
   */
  private resolveApprovedStudents(
    file: OfficialReportImportFile,
    body: OfficialReportImportConfirmRequestDto,
    ctx: GateContext,
  ): Array<{ studentId: string; band: PerformanceBandInput }> {
    const reported = file.students ?? [];
    if (body.studentMatches.length === 0) return [];
    if (reported.length === 0) {
      throw new BadRequestException(
        'El informe no trae niveles por estudiante: no se pueden aprobar matches.',
      );
    }

    const rosterIds = new Set(ctx.roster.map((s) => s.id));
    const seenStudents = new Set<string>();
    const seenIndexes = new Set<number>();
    const out: Array<{ studentId: string; band: PerformanceBandInput }> = [];

    for (const match of body.studentMatches) {
      const student = reported[match.reportIndex];
      if (!student) {
        throw new BadRequestException(
          `El informe no tiene un estudiante en la posición ${match.reportIndex}.`,
        );
      }
      if (seenIndexes.has(match.reportIndex)) {
        throw new BadRequestException(
          `El estudiante "${student.name}" del informe está asignado más de una vez.`,
        );
      }
      seenIndexes.add(match.reportIndex);

      if (!rosterIds.has(match.studentId)) {
        throw new BadRequestException(
          `El estudiante asignado a "${student.name}" no está matriculado en el curso del informe.`,
        );
      }
      if (seenStudents.has(match.studentId)) {
        throw new BadRequestException(
          `Un mismo estudiante del curso está asignado a más de una fila del informe (${student.name}).`,
        );
      }
      seenStudents.add(match.studentId);

      const band = resolveLevelBand(student.level, ctx.bands);
      if (!band) {
        throw new BadRequestException(
          `El nivel "${student.level}" de "${student.name}" no corresponde a ninguna banda de logro del instrumento.`,
        );
      }
      out.push({ studentId: match.studentId, band });
    }
    return out;
  }

  /**
   * Crea el assessment `aggregate_only` o reusa uno existente.
   *
   * ⚠️ Reusar uno `item_level` es 409: en conflicto gana el dato granular (§9.3).
   * Sobreescribir su read-model con agregados importados lo degradaría en silencio.
   */
  private async resolveAssessment(
    tx: Database,
    input: {
      orgId: string;
      userId: string;
      assessmentId: string | null | undefined;
      assessmentName: string | null | undefined;
      instrumentId: string;
      file: OfficialReportImportFile;
      now: Date;
    },
  ): Promise<string> {
    if (input.assessmentId) {
      const [existing] = await tx
        .select({
          id: assessments.id,
          orgId: assessments.orgId,
          dataGranularity: assessments.dataGranularity,
        })
        .from(assessments)
        .where(eq(assessments.id, input.assessmentId));
      if (!existing || existing.orgId !== input.orgId) {
        throw new ForbiddenException(
          'El assessment indicado no existe o no pertenece a tu organización',
        );
      }
      if (existing.dataGranularity === 'item_level') {
        throw new ConflictException({
          message:
            'Esta evaluación ya tiene respuestas por estudiante. El dato granular es más completo que un informe agregado, así que el informe no se importa sobre ella. Crea una evaluación nueva si necesitas cargarlo.',
          assessmentId: existing.id,
          dataGranularity: existing.dataGranularity,
        });
      }
      return existing.id;
    }

    const { file, now } = input;
    const name =
      input.assessmentName ??
      `${file.report.subjectCode} ${file.report.period} ${file.report.year} — ${file.report.courseLabel}`;
    const [created] = await tx
      .insert(assessments)
      .values({
        orgId: input.orgId,
        instrumentId: input.instrumentId,
        name,
        mode: 'paper',
        status: 'completed',
        dataGranularity: 'aggregate_only',
        administeredAt: now,
        administeredById: input.userId,
        config: {
          source: 'dia_official_report',
          sourceFile: file.source.file,
          rbd: file.report.rbd,
          period: file.report.period,
          year: file.report.year,
          courseLabel: file.report.courseLabel,
        },
      })
      .returning({ id: assessments.id });
    if (!created) throw new Error('No se pudo crear el assessment');
    return created.id;
  }

  private async ensureInstrumentVisible(instrumentId: string, orgId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: instruments.id })
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
  }

  private async ensureClassGroup(classGroupId: string, orgId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)));
    if (!row) {
      throw new NotFoundException('Curso no encontrado en tu organización');
    }
  }

  private async loadInstrumentName(instrumentId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: instruments.name })
      .from(instruments)
      .where(eq(instruments.id, instrumentId));
    return row?.name ?? '';
  }

  private async loadClassGroupName(classGroupId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: classGroups.name })
      .from(classGroups)
      .where(eq(classGroups.id, classGroupId));
    return row?.name ?? '';
  }

  private async loadInstrumentItems(instrumentId: string): Promise<InstrumentItemForImport[]> {
    const rows = await this.db
      .select({
        id: items.id,
        position: items.position,
        scoringConfig: items.scoringConfig,
        content: items.content,
      })
      .from(items)
      .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
      .orderBy(items.position);

    return rows.map((row) => ({
      id: row.id,
      position: row.position,
      points: row.scoringConfig?.points ?? 1,
      correctKey: deriveCorrectKey(row.content),
    }));
  }
}

/**
 * Alternativa correcta de un ítem: `content.correctKey` explícito o, como fallback,
 * la primera alternativa con `isCorrect`. `null` en ítems de desarrollo (sin
 * alternativas). Misma lógica que `ItemAnalysisService.deriveCorrectKey`.
 *
 * Toma `unknown` y castea adentro: `content` es un JSONB polimórfico (`ItemContent` es
 * una unión por tipo de ítem), así que se lee de forma defensiva, igual que item-analysis.
 */
function deriveCorrectKey(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as { correctKey?: unknown; alternatives?: unknown };
  if (typeof c.correctKey === 'string' && c.correctKey.length > 0) return c.correctKey;
  if (!Array.isArray(c.alternatives)) return null;
  for (const raw of c.alternatives) {
    if (raw && typeof raw === 'object') {
      const alt = raw as { key?: unknown; isCorrect?: unknown };
      if (alt.isCorrect === true && typeof alt.key === 'string') return alt.key;
    }
  }
  return null;
}

function toItemStatsRow(stats: ItemCohortStats, assessmentId: string, now: Date) {
  return {
    assessmentId,
    classGroupId: stats.classGroupId,
    itemId: stats.itemId,
    studentCount: stats.studentCount,
    responseCount: stats.responseCount,
    correctCount: stats.correctCount,
    answerCounts: stats.answerCounts,
    scoreSum: stats.scoreSum.toFixed(2),
    maxSum: stats.maxSum.toFixed(2),
    source: 'imported' as const,
    computedAt: now,
  };
}

function toSkillStatsRow(stats: SkillCohortStats, assessmentId: string, now: Date) {
  return {
    assessmentId,
    classGroupId: stats.classGroupId,
    nodeId: stats.nodeId,
    studentCount: stats.studentCount,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    // Model contract: `percentage` en la BD es 0..100; el calculador puro devuelve 0..1.
    percentage: stats.percentage != null ? (stats.percentage * 100).toFixed(2) : null,
    source: 'imported' as const,
    computedAt: now,
  };
}
