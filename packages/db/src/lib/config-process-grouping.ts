/**
 * Agrupa evaluaciones sin proceso en procesos de medición a partir de un valor de su
 * `assessments.config` (la tanda de un ensayo: `config.ensayo`). Es la regla del backfill
 * `db:backfill:processes:paes`, genérica para cualquier tipo de instrumento que se aplica
 * varias veces en el año (ensayos PAES, SIMCE, mocks).
 *
 * Un grupo = (org, año académico, tipo de instrumento, valor de config). Antes de crear el
 * proceso se valida la misma invariante del agrupador por período: un proceso no puede
 * contener dos instrumentos distintos para el mismo (grado del curso, prueba). Un grupo
 * que la viola queda ambiguo y no se asigna.
 */
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_TYPE_LABELS,
  PROCESS_KIND_BY_INSTRUMENT_TYPE,
  expectedCellKey,
  findProcessInvariantViolations,
  slugify,
  type ExpectedScope,
  type ExpectedScopeCell,
  type InstrumentApplicationPeriod,
  type InstrumentType,
  type ProcessCandidate,
  type ProcessInvariantViolation,
  type ProcessKind,
} from '@soe/types';

export type ConfigProcessCandidate = ProcessCandidate & {
  configValue: string;
  year: number;
  classGroupId: string;
  administeredOn: string | null;
  taxonomyId: string | null;
};

export type ConfigProcessPlan = {
  key: string;
  orgId: string;
  academicYearId: string;
  instrumentType: string;
  configValue: string;
  name: string;
  slug: string;
  kind: ProcessKind;
  period: InstrumentApplicationPeriod | null;
  taxonomyId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  assessmentIds: string[];
  expectedScope: ExpectedScope;
  violations: ProcessInvariantViolation[];
};

export type ConfigProcessGrouping = {
  plans: ConfigProcessPlan[];
  ambiguous: ConfigProcessPlan[];
  multiYearAssessmentIds: string[];
};

function compareConfigValues(a: string, b: string): number {
  const numericA = Number(a);
  const numericB = Number(b);
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
  return a.localeCompare(b, 'es');
}

export function buildConfigProcessName(
  instrumentType: string,
  configValue: string,
  year: number,
): string {
  const typeLabel = INSTRUMENT_TYPE_LABELS[instrumentType as InstrumentType] ?? instrumentType;
  return `${typeLabel} ${configValue} ${year}`;
}

/** Nombre del proceso por período: "<tipo> <momento> <año>", p. ej. "DIA Monitoreo 2026". */
export function buildPeriodProcessName(
  instrumentType: string,
  period: InstrumentApplicationPeriod | null,
  year: number,
): string {
  const typeLabel = INSTRUMENT_TYPE_LABELS[instrumentType as InstrumentType] ?? instrumentType;
  const periodLabel = period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[period] : null;
  return [typeLabel, periodLabel, year].filter(Boolean).join(' ');
}

/**
 * Alcance esperado derivado de lo que ya está cargado: los cursos y asignaturas observados,
 * con los pares (curso, asignatura) que nunca se aplicaron en `excludedCells`.
 */
export function deriveExpectedScope(
  cells: readonly { classGroupId: string; subjectId: string | null }[],
): ExpectedScope {
  const classGroupIds = new Set<string>();
  const subjectIds = new Set<string>();
  const observed = new Set<string>();
  for (const cell of cells) {
    classGroupIds.add(cell.classGroupId);
    if (!cell.subjectId) continue;
    subjectIds.add(cell.subjectId);
    observed.add(expectedCellKey({ classGroupId: cell.classGroupId, subjectId: cell.subjectId }));
  }
  const excludedCells: ExpectedScopeCell[] = [];
  for (const classGroupId of classGroupIds) {
    for (const subjectId of subjectIds) {
      const cell = { classGroupId, subjectId };
      if (!observed.has(expectedCellKey(cell))) excludedCells.push(cell);
    }
  }
  return {
    classGroupIds: Array.from(classGroupIds),
    subjectIds: Array.from(subjectIds),
    excludedCells,
    derived: true,
  };
}

function buildPlan(key: string, candidates: readonly ConfigProcessCandidate[]): ConfigProcessPlan {
  const first = candidates[0];
  if (!first) throw new Error(`Grupo vacío: ${key}`);

  const assessmentIds = new Set<string>();
  const periods = new Set<InstrumentApplicationPeriod | null>();
  const taxonomyIds = new Set<string>();
  const dates: string[] = [];
  for (const candidate of candidates) {
    assessmentIds.add(candidate.assessmentId);
    periods.add(candidate.applicationPeriod as InstrumentApplicationPeriod | null);
    if (candidate.taxonomyId) taxonomyIds.add(candidate.taxonomyId);
    if (candidate.administeredOn) dates.push(candidate.administeredOn);
  }
  dates.sort();
  const name = buildConfigProcessName(first.instrumentType, first.configValue, first.year);

  return {
    key,
    orgId: first.orgId,
    academicYearId: first.academicYearId,
    instrumentType: first.instrumentType,
    configValue: first.configValue,
    name,
    slug: slugify(name),
    kind: PROCESS_KIND_BY_INSTRUMENT_TYPE[first.instrumentType as InstrumentType] ?? 'custom',
    period: periods.size === 1 ? (Array.from(periods)[0] ?? null) : null,
    taxonomyId: taxonomyIds.size === 1 ? (Array.from(taxonomyIds)[0] ?? null) : null,
    startsOn: dates[0] ?? null,
    endsOn: dates[dates.length - 1] ?? null,
    assessmentIds: Array.from(assessmentIds).sort(),
    expectedScope: deriveExpectedScope(candidates),
    violations: findProcessInvariantViolations(candidates),
  };
}

export function groupCandidatesByConfigValue(
  candidates: readonly ConfigProcessCandidate[],
): ConfigProcessGrouping {
  const yearsByAssessment = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    let years = yearsByAssessment.get(candidate.assessmentId);
    if (!years) {
      years = new Set();
      yearsByAssessment.set(candidate.assessmentId, years);
    }
    years.add(candidate.academicYearId);
  }
  const multiYearAssessmentIds: string[] = [];
  for (const [assessmentId, years] of yearsByAssessment) {
    if (years.size > 1) multiYearAssessmentIds.push(assessmentId);
  }
  const excluded = new Set(multiYearAssessmentIds);

  const byKey = new Map<string, ConfigProcessCandidate[]>();
  for (const candidate of candidates) {
    if (excluded.has(candidate.assessmentId)) continue;
    const key = [
      candidate.orgId,
      candidate.academicYearId,
      candidate.instrumentType,
      candidate.configValue,
    ].join('|');
    const bucket = byKey.get(key);
    if (bucket) bucket.push(candidate);
    else byKey.set(key, [candidate]);
  }

  const plans: ConfigProcessPlan[] = [];
  const ambiguous: ConfigProcessPlan[] = [];
  for (const [key, bucket] of byKey) {
    const plan = buildPlan(key, bucket);
    if (plan.violations.length > 0) ambiguous.push(plan);
    else plans.push(plan);
  }
  const byOrder = (a: ConfigProcessPlan, b: ConfigProcessPlan) =>
    a.academicYearId.localeCompare(b.academicYearId) ||
    a.instrumentType.localeCompare(b.instrumentType) ||
    compareConfigValues(a.configValue, b.configValue);
  plans.sort(byOrder);
  ambiguous.sort(byOrder);

  return { plans, ambiguous, multiYearAssessmentIds: multiYearAssessmentIds.sort() };
}
