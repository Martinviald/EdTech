import { compareSeverity } from '../comparability';
import type { AssessmentOption } from '../schemas/item-analysis.schema';
import type { ComparableUnitSummary } from '../schemas/comparable-overview.schema';

export const ASSESSMENT_SORTS = ['severity', 'recent'] as const;
export type AssessmentSort = (typeof ASSESSMENT_SORTS)[number];

export const ASSESSMENT_SORT_LABELS: Record<AssessmentSort, string> = {
  severity: 'Gravedad',
  recent: 'Fecha de aplicación',
};

/**
 * Una evaluación con la gravedad que hereda de su unidad comparable.
 *
 * `severity: null` significa "no clasificable" —el instrumento no define bandas,
 * o no hay con qué compararlo—, NO "está bien". La UI tiene que distinguirlos:
 * sin insignia, nunca una insignia verde.
 */
export type AssessmentWithSeverity = AssessmentOption & {
  severity: ComparableUnitSummary['severity'];
  lowestBandShare: number | null;
  unitKey: string | null;
};

function recencyRank(value: string | Date | null): number {
  if (!value) return 0;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * Cuelga de cada evaluación la severidad de su unidad comparable.
 *
 * El puente es `ComparableUnitSummary.assessmentIds`: la unidad ya sabe qué
 * aplicaciones agrupa. Una evaluación que no aparezca en ninguna unidad del
 * alcance queda con `severity: null` — pasa cuando el instrumento no tiene
 * bandas configuradas, que hoy es el caso de 8 de los 10 instrumentos de la base
 * de desarrollo.
 */
export function attachSeverity(
  assessments: readonly AssessmentOption[],
  units: readonly ComparableUnitSummary[],
): AssessmentWithSeverity[] {
  const byAssessment = new Map<string, ComparableUnitSummary>();
  for (const unit of units) {
    for (const id of unit.assessmentIds) byAssessment.set(id, unit);
  }
  return assessments.map((assessment) => {
    const unit = byAssessment.get(assessment.assessmentId);
    return {
      ...assessment,
      severity: unit?.severity ?? null,
      lowestBandShare: unit?.lowestBandShare ?? null,
      unitKey: unit?.key ?? null,
    };
  });
}

/**
 * Ordena por gravedad, y dentro de la misma gravedad por alumnos afectados y
 * después por recencia.
 *
 * El desempate por alumnos importa: dos unidades igual de graves no piden la
 * misma atención si una afecta a 30 alumnos y la otra a 3. `compareSeverity` ya
 * manda las no clasificables al final, que es donde deben ir — no arriba (no se
 * sabe que estén mal) ni mezcladas (no son comparables con las que sí tienen
 * corte).
 *
 * NO ordena por porcentaje de logro: promediar instrumentos de distinta
 * dificultad no produce un número comparable (#1C), y usarlo como criterio de
 * orden reintroduce ese error por la puerta de atrás.
 */
export function sortAssessments(
  assessments: readonly AssessmentWithSeverity[],
  sort: AssessmentSort,
): AssessmentWithSeverity[] {
  const rows = [...assessments];
  if (sort === 'recent') {
    return rows.sort((a, b) => recencyRank(b.administeredAt) - recencyRank(a.administeredAt));
  }
  return rows.sort((a, b) => {
    const bySeverity = compareSeverity(a.severity, b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byStudents = b.studentsCount - a.studentsCount;
    if (byStudents !== 0) return byStudents;
    return recencyRank(b.administeredAt) - recencyRank(a.administeredAt);
  });
}
