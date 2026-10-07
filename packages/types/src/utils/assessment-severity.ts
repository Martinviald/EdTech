import {
  bandForAchievement,
  compareSeverity,
  severityFromAverageBand,
  type SeverityBand,
} from '../comparability';
import type { AssessmentOption } from '../schemas/item-analysis.schema';
import type {
  ComparableUnitAssessment,
  ComparableUnitSummary,
  UnitSeverity,
} from '../schemas/comparable-overview.schema';
import type { PerformanceBandView } from '../schemas/performance-band.schema';

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
  /** Por qué la evaluación tiene esa gravedad, en una frase. Null si no hay severidad. */
  severityReason: string | null;
  unitKey: string | null;
};

export const SEVERITY_LABELS: Record<UnitSeverity, string> = {
  high: 'Grave',
  medium: 'Atención',
  low: 'Leve',
};

export type SeverityExplanationInput = {
  severity: UnitSeverity | null;
  averageAchievement: number | null; // 0..100
  bands: readonly PerformanceBandView[] | null;
  studentsAssessed: number;
  lowestBandCount: number | null;
};

function formatPercent(value: number): string {
  return `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

function bandsWithThresholds(bands: readonly PerformanceBandView[] | null): SeverityBand[] | null {
  if (!bands || bands.length < 2) return null;
  const complete: SeverityBand[] = [];
  for (const band of bands) {
    if (band.minThreshold == null || band.maxThreshold == null) return null;
    complete.push({
      key: band.key,
      label: band.label,
      order: band.order,
      minThreshold: band.minThreshold,
      maxThreshold: band.maxThreshold,
    });
  }
  return complete.sort((a, b) => a.order - b.order);
}

/**
 * Explica la gravedad de una evaluación: en qué banda de SU instrumento cae el
 * promedio, cuál es el corte, y cuántos alumnos quedaron en la banda inferior.
 *
 * Existe para que el badge no aparezca solo junto a un promedio que parece bueno:
 * un 71% es "Grave" si el instrumento corta en 79%, y eso hay que decirlo. Devuelve
 * `null` cuando no hay severidad o las bandas no traen sus umbrales.
 */
export function describeSeverity(input: SeverityExplanationInput): string | null {
  const bands = bandsWithThresholds(input.bands);
  if (!input.severity || input.averageAchievement == null || !bands) return null;
  const band = bandForAchievement(input.averageAchievement, bands);
  if (!band) return null;

  const lowest = bands[0]!;
  const cutFrom = formatPercent(band.minThreshold * 100);
  const cutTo = formatPercent(band.maxThreshold * 100);
  const position =
    input.severity === 'high'
      ? `la banda más baja del instrumento (bajo ${cutTo})`
      : input.severity === 'low'
        ? `la banda más alta del instrumento (desde ${cutFrom})`
        : `una banda intermedia del instrumento (entre ${cutFrom} y ${cutTo})`;

  const sentences = [
    `El logro promedio (${formatPercent(input.averageAchievement)}) cae en «${band.label}», ${position}.`,
  ];
  if (input.lowestBandCount != null && input.studentsAssessed > 0) {
    sentences.push(
      `${input.lowestBandCount} de ${input.studentsAssessed} alumnos quedaron en «${lowest.label}».`,
    );
  }
  return sentences.join(' ');
}

function recencyRank(value: string | Date | null): number {
  if (!value) return 0;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export type AssessmentSeverityExplanation = {
  severity: UnitSeverity;
  reason: string;
};

/**
 * Gravedad y explicación de una evaluación a partir de su promedio y las bandas de
 * su instrumento. Es la misma regla que aplica la API (`severityFromAverageBand`),
 * para las vistas que tienen el informe en la mano pero no la unidad comparable.
 */
export function explainAssessmentSeverity(
  input: Omit<SeverityExplanationInput, 'severity'>,
): AssessmentSeverityExplanation | null {
  const severity = severityFromAverageBand(
    input.averageAchievement,
    bandsWithThresholds(input.bands),
  );
  if (!severity) return null;
  const reason = describeSeverity({ ...input, severity });
  return reason ? { severity, reason } : null;
}

/**
 * Cuelga de cada evaluación SU propia severidad, la de su aplicación dentro de la
 * unidad comparable (`ComparableUnitSummary.byAssessment`), no la de la unidad
 * completa: el badge del 7°B habla del 7°B aunque el 7°A haya rendido la misma
 * prueba.
 *
 * Una evaluación que no aparezca en ninguna unidad del alcance queda con
 * `severity: null` — pasa cuando el instrumento no tiene bandas configuradas.
 */
export function attachSeverity(
  assessments: readonly AssessmentOption[],
  units: readonly ComparableUnitSummary[],
): AssessmentWithSeverity[] {
  const unitByAssessment = new Map<string, ComparableUnitSummary>();
  const applicationById = new Map<string, ComparableUnitAssessment>();
  for (const unit of units) {
    for (const id of unit.assessmentIds) unitByAssessment.set(id, unit);
    for (const entry of unit.byAssessment) applicationById.set(entry.assessmentId, entry);
  }
  return assessments.map((assessment) => {
    const unit = unitByAssessment.get(assessment.assessmentId);
    const application = applicationById.get(assessment.assessmentId);
    if (!unit || !application) {
      return {
        ...assessment,
        severity: null,
        lowestBandShare: null,
        severityReason: null,
        unitKey: unit?.key ?? null,
      };
    }
    return {
      ...assessment,
      severity: application.severity,
      lowestBandShare: application.lowestBandShare,
      severityReason: describeSeverity({
        severity: application.severity,
        averageAchievement: application.averageAchievement,
        bands: unit.bands,
        studentsAssessed: application.studentsAssessed,
        lowestBandCount: application.lowestBandCount,
      }),
      unitKey: unit.key,
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
