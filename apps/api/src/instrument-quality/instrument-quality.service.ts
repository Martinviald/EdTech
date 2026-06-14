import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  assessments,
  classGroups,
  instruments,
  items,
  responses,
  studentEnrollments,
  students,
  subjectClasses,
  teacherAssignments,
  withOrgContext,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  userHasAnyRole,
  type AssessmentReportItemRow,
  type InstrumentQualityQueryDto,
  type InstrumentQualityResponse,
  type InstrumentReliabilityModel,
  type ItemQualityFlag,
  type ItemQualityModel,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { AssessmentReportService } from '../assessment-report/assessment-report.service';
import { InjectDb, type Database } from '../database/database.types';
import { kr20, pointBiserial, type ScoreMatrix } from '../ai-analysis/ai-analysis.metrics';

// ─────────────────────────────────────────────────────────────────────────────
// H20.9 — Calidad de instrumento e ítems (DETERMINISTA, sin IA).
//
// Toda la psicometría se computa en backend: p/D/distractor se reusan del
// AssessmentReportService; KR-20 y punto-biserial se calculan con las funciones
// puras de ai-analysis.metrics sobre la matriz correcto/incorrecto de responses.
// Las banderas y sugerencias son reglas/plantillas deterministas (cero LLM).
//
// Multi-tenancy: org_id SIEMPRE del token; scoping por curso para profesores
// idéntico a ItemAnalysisService / AssessmentReportService. La matriz se arma
// con el MISMO studentFilter que aplica el informe (consistencia de cohorte).
// ─────────────────────────────────────────────────────────────────────────────

// Roles administrativos: ven toda la org. Idéntico a los demás services de
// resultados (AssessmentReportService / ItemAnalysisService).
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

// ── Umbrales de las banderas de calidad (psicometría estándar, no hardcodean
// ningún instrumento; aplicables a cualquier prueba de selección múltiple). ────

/** D < 0.20 → la pregunta no separa a quienes dominan de quienes no. */
const LOW_DISCRIMINATION_MAX = 0.2;
/** punto-biserial < 0.10 (o negativo) → la clave no discrimina / posible clave errónea. */
const AMBIGUOUS_KEY_MAX = 0.1;
/** Un distractor con tasa > 35% del total → distractor demasiado potente. */
const STRONG_DISTRACTOR_RATE = 35;
/** p > 90% → ítem demasiado fácil (no discrimina por techo). */
const TOO_EASY_MAX = 90;

// ── Plantillas deterministas de sugerencias por bandera (español, sin IA). ─────
const FLAG_SUGGESTIONS: Record<ItemQualityFlag, string> = {
  low_discrimination:
    'Baja discriminación: la pregunta no distingue a quienes dominan el contenido. Revisa la redacción y la clave, o considera reformularla o reemplazarla.',
  ambiguous_key:
    'Clave ambigua: la correlación con el puntaje total es baja o negativa. Verifica que la clave esté bien definida y que el enunciado no induzca a confusión.',
  strong_distractor:
    'Distractor potente: una alternativa incorrecta atrae tanto o más que la clave. Revisa si el distractor es defendible como correcto o si refleja una misconcepción extendida.',
  too_easy:
    'Ítem demasiado fácil: casi todos aciertan, aporta poco valor diagnóstico. Considera aumentar la exigencia o moverlo al inicio como pregunta de calentamiento.',
  misaligned:
    'Ítem sin alineación: no tiene etiquetas de taxonomía. Asóciale habilidad/contenido del blueprint para que aporte al diagnóstico por habilidad.',
};

type ScopeResult = { scopeAll: boolean; classGroupIds: string[] };

@Injectable()
export class InstrumentQualityService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly reportService: AssessmentReportService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/instrument-quality
  // ───────────────────────────────────────────────────────────────────────────

  async getQuality(
    user: JwtPayload,
    dto: InstrumentQualityQueryDto,
  ): Promise<InstrumentQualityResponse> {
    const orgId = this.requireOrgId(user);

    // El informe valida pertenencia a la org y el scope del profesor (lanza
    // NotFound/Forbidden) y entrega p/D/distractor por ítem + nombres.
    const report = await this.reportService.getReport(user, {
      assessmentId: dto.assessmentId,
      classGroupId: dto.classGroupId,
    });

    // Matriz correcto/incorrecto (por la misma cohorte del informe) e instrumentId.
    const { matrix, instrumentId } = await withOrgContext(this.db, orgId, async (tx) => {
      const instrumentId = await this.resolveInstrumentId(tx, dto.assessmentId);
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      const studentFilter = await this.resolveAccessibleStudentIds(
        tx,
        orgId,
        scope,
        dto.classGroupId,
      );
      const matrix = await this.buildScoreMatrix(
        tx,
        dto.assessmentId,
        report.items,
        studentFilter,
      );
      return { matrix, instrumentId };
    });

    // El orden de columnas de la matriz sigue el orden de report.items.
    const items: ItemQualityModel[] = report.items.map((row, columnIndex) => {
      const pBiserial = pointBiserial(matrix, columnIndex);
      return this.buildItemQuality(row, pBiserial);
    });

    const reliability = this.buildReliability(matrix, items.length);
    const flaggedCount = items.filter((i) => i.flags.length > 0).length;

    return {
      assessmentId: dto.assessmentId,
      assessmentName: report.meta.assessmentName,
      instrumentId,
      instrumentName: report.meta.instrumentName,
      reliability,
      items,
      flaggedCount,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Banderas + sugerencias deterministas por ítem
  // ───────────────────────────────────────────────────────────────────────────

  /** Deriva banderas + sugerencias de un ítem a partir de su psicometría. */
  private buildItemQuality(
    row: AssessmentReportItemRow,
    pBiserial: number | null,
  ): ItemQualityModel {
    const hasTags = row.skillName !== null || row.contentName !== null;
    const flags = this.deriveFlags(row, pBiserial, hasTags);
    const suggestions = flags.map((flag) => FLAG_SUGGESTIONS[flag]);

    return {
      itemId: row.itemId,
      position: row.position,
      skillName: row.skillName,
      contentName: row.contentName,
      correctKey: row.correctKey,
      difficulty: row.difficulty,
      discrimination: row.discrimination,
      pointBiserial: pBiserial,
      dominantDistractor: row.topDistractorKey,
      dominantDistractorRate: row.topDistractorRate,
      flags,
      suggestions,
    };
  }

  private deriveFlags(
    row: AssessmentReportItemRow,
    pBiserial: number | null,
    hasTags: boolean,
  ): ItemQualityFlag[] {
    const flags: ItemQualityFlag[] = [];

    // low_discrimination: D < 0.20.
    if (row.discrimination !== null && row.discrimination < LOW_DISCRIMINATION_MAX) {
      flags.push('low_discrimination');
    }

    // ambiguous_key: punto-biserial < 0.10 o negativo.
    if (pBiserial !== null && pBiserial < AMBIGUOUS_KEY_MAX) {
      flags.push('ambiguous_key');
    }

    // strong_distractor: un distractor ≥ la clave (tasa distractor ≥ p) o > 35%.
    if (row.topDistractorRate !== null) {
      const distractorBeatsKey =
        row.difficulty !== null && row.topDistractorRate >= row.difficulty;
      if (distractorBeatsKey || row.topDistractorRate > STRONG_DISTRACTOR_RATE) {
        flags.push('strong_distractor');
      }
    }

    // too_easy: p > 90%.
    if (row.difficulty !== null && row.difficulty > TOO_EASY_MAX) {
      flags.push('too_easy');
    }

    // misaligned: ítem sin tags de taxonomía.
    if (!hasTags) {
      flags.push('misaligned');
    }

    return flags;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Confiabilidad (KR-20 + interpretación determinista por rangos)
  // ───────────────────────────────────────────────────────────────────────────

  private buildReliability(
    matrix: ScoreMatrix,
    itemsAnalyzed: number,
  ): InstrumentReliabilityModel {
    const value = kr20(matrix);
    return {
      kr20: value,
      interpretation: this.interpretKr20(value),
      itemsAnalyzed,
      studentsAnalyzed: matrix.length,
    };
  }

  /** Interpretación determinista de KR-20 por rangos (sin IA). */
  private interpretKr20(value: number | null): string {
    if (value === null) return 'No calculable';
    if (value >= 0.9) return 'Excelente';
    if (value >= 0.8) return 'Buena';
    if (value >= 0.7) return 'Aceptable';
    if (value >= 0.6) return 'Cuestionable';
    return 'Pobre';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Construcción de la matriz correcto/incorrecto (sin N+1, sin PII)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Matriz booleana (alumno × ítem) de aciertos, en el mismo orden de columnas
   * que `report.items`. Una respuesta inexistente o no correcta cuenta como
   * incorrecta (false). 1 sola query agregada (sin N+1). No incluye PII: las
   * filas son anónimas y las columnas son posiciones de ítem.
   */
  private async buildScoreMatrix(
    tx: Database,
    assessmentId: string,
    itemRows: AssessmentReportItemRow[],
    studentFilter: string[] | null,
  ): Promise<ScoreMatrix> {
    const itemIds = itemRows.map((i) => i.itemId);
    if (itemIds.length === 0) return [];
    if (studentFilter !== null && studentFilter.length === 0) return [];

    const columnIndexByItem = new Map<string, number>();
    itemIds.forEach((itemId, index) => columnIndexByItem.set(itemId, index));

    const conditions = [
      eq(responses.assessmentId, assessmentId),
      inArray(responses.itemId, itemIds),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(responses.studentId, studentFilter));
    }

    const rows = await tx
      .select({
        studentId: responses.studentId,
        itemId: responses.itemId,
        isCorrect: responses.isCorrect,
      })
      .from(responses)
      .where(and(...conditions));

    // Agrupar por alumno → fila de booleanos del largo del nº de ítems.
    const rowByStudent = new Map<string, boolean[]>();
    for (const r of rows) {
      const columnIndex = columnIndexByItem.get(r.itemId);
      if (columnIndex === undefined) continue;
      let studentRow = rowByStudent.get(r.studentId);
      if (!studentRow) {
        studentRow = new Array<boolean>(itemIds.length).fill(false);
        rowByStudent.set(r.studentId, studentRow);
      }
      studentRow[columnIndex] = r.isCorrect === true;
    }

    return Array.from(rowByStudent.values());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Resolución de instrumento + scoping & multi-tenancy
  // (replican AssessmentReportService / ItemAnalysisService)
  // ───────────────────────────────────────────────────────────────────────────

  /** instrumentId de la evaluación (ya validada por el informe). */
  private async resolveInstrumentId(
    tx: Database,
    assessmentId: string,
  ): Promise<string> {
    const [row] = await tx
      .select({ instrumentId: assessments.instrumentId })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(eq(assessments.id, assessmentId), isNull(instruments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Evaluación no encontrada');
    return row.instrumentId;
  }

  /** `org_id` SIEMPRE del token. */
  private requireOrgId(user: JwtPayload): string {
    if (user.orgId) return user.orgId;
    throw new ForbiddenException('Usuario sin organización asociada');
  }

  private async getAccessibleClassGroupIds(
    tx: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<ScopeResult> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };
    if (userHasAnyRole(user.roles, ADMIN_LIKE_ROLES)) {
      return { scopeAll: true, classGroupIds: [] };
    }
    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await tx
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(
        and(
          eq(teacherAssignments.userId, user.userId),
          eq(classGroups.orgId, orgId),
        ),
      );

    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  /**
   * studentIds visibles combinando scope + filtro por classGroupId. `null` =
   * scopeAll sin filtro (sin filtro extra de student). Idéntico al informe para
   * que la matriz analice exactamente la misma cohorte.
   */
  private async resolveAccessibleStudentIds(
    tx: Database,
    orgId: string,
    scope: ScopeResult,
    classGroupId: string | undefined,
  ): Promise<string[] | null> {
    if (scope.scopeAll && !classGroupId) return null;

    let allowedClassGroupIds: string[];
    if (scope.scopeAll) {
      allowedClassGroupIds = [classGroupId!];
    } else if (classGroupId) {
      if (!scope.classGroupIds.includes(classGroupId)) return [];
      allowedClassGroupIds = [classGroupId];
    } else {
      allowedClassGroupIds = scope.classGroupIds;
    }
    if (allowedClassGroupIds.length === 0) return [];

    const rows = await tx
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, allowedClassGroupIds),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );
    return Array.from(new Set(rows.map((r) => r.studentId)));
  }
}
