/**
 * Proceso de medición destino de una evaluación recién cargada, y qué evaluaciones se pueden
 * vincular sin romper la invariante del agrupador. Lógica pura: la usan los cargadores de
 * respuestas (`import-paes-2026-responses`, `import-dia-2026-responses`) y la migración de
 * Ciencias a electivas a través de `linkLoadedAssessmentsToProcesses`.
 *
 * El destino sale de la misma regla que los backfills, así un cargador y un backfill nunca
 * crean dos procesos distintos para la misma aplicación:
 *  - por config (`by: 'config'`, ensayos PAES): "<tipo> <config.ensayo> <año>", como
 *    `db:backfill:processes:paes`;
 *  - por período (`by: 'period'`, DIA): "<tipo> <momento> <año>", como `db:backfill:processes`.
 * El proceso se identifica por su slug dentro de la org.
 */
import {
  PROCESS_KIND_BY_INSTRUMENT_TYPE,
  findProcessInvariantViolations,
  slugify,
  trackOrSubjectTestKey,
  type InstrumentApplicationPeriod,
  type InstrumentType,
  type ProcessCandidate,
  type ProcessInvariantViolation,
  type ProcessKind,
} from '@soe/types';
import { buildConfigProcessName, buildPeriodProcessName } from './config-process-grouping';

export type LoadProcessSource = { by: 'config'; key: string } | { by: 'period' };

export type LoadProcessCandidate = ProcessCandidate & {
  year: number;
  classGroupId: string;
  configValue: string | null;
  administeredOn: string | null;
  taxonomyId: string | null;
};

export type LoadProcessTarget = {
  orgId: string;
  academicYearId: string;
  name: string;
  slug: string;
  kind: ProcessKind;
  period: InstrumentApplicationPeriod | null;
};

export type LoadProcessGroup = {
  target: LoadProcessTarget;
  candidates: LoadProcessCandidate[];
};

export type LoadProcessGrouping = {
  groups: LoadProcessGroup[];
  withoutTarget: string[];
};

export type LoadProcessLinkSplit = {
  linkable: string[];
  blocked: string[];
  violations: ProcessInvariantViolation[];
};

export function resolveLoadProcessTarget(
  candidate: LoadProcessCandidate,
  source: LoadProcessSource,
): LoadProcessTarget | null {
  const period = candidate.applicationPeriod as InstrumentApplicationPeriod | null;
  let name: string;
  if (source.by === 'config') {
    const value = candidate.configValue?.trim();
    if (!value) return null;
    name = buildConfigProcessName(candidate.instrumentType, value, candidate.year);
  } else {
    name = buildPeriodProcessName(candidate.instrumentType, period, candidate.year);
  }
  return {
    orgId: candidate.orgId,
    academicYearId: candidate.academicYearId,
    name,
    slug: slugify(name),
    kind: PROCESS_KIND_BY_INSTRUMENT_TYPE[candidate.instrumentType as InstrumentType] ?? 'custom',
    period: source.by === 'period' ? period : null,
  };
}

/**
 * Agrupa las filas (evaluación × curso) por proceso destino. Una evaluación sin destino (sin
 * valor de config) o con cursos que apuntan a destinos distintos (cursos de dos años) queda
 * en `withoutTarget` y no se vincula.
 */
export function groupByLoadProcessTarget(
  candidates: readonly LoadProcessCandidate[],
  source: LoadProcessSource,
): LoadProcessGrouping {
  const targetSlugsByAssessment = new Map<string, Set<string | null>>();
  const resolved: { candidate: LoadProcessCandidate; target: LoadProcessTarget | null }[] = [];
  for (const candidate of candidates) {
    const target = resolveLoadProcessTarget(candidate, source);
    resolved.push({ candidate, target });
    const key = target ? `${target.academicYearId}|${target.slug}` : null;
    let keys = targetSlugsByAssessment.get(candidate.assessmentId);
    if (!keys) {
      keys = new Set();
      targetSlugsByAssessment.set(candidate.assessmentId, keys);
    }
    keys.add(key);
  }

  const withoutTarget = new Set<string>();
  for (const [assessmentId, keys] of targetSlugsByAssessment) {
    if (keys.size !== 1 || keys.has(null)) withoutTarget.add(assessmentId);
  }

  const byKey = new Map<string, LoadProcessGroup>();
  for (const { candidate, target } of resolved) {
    if (!target || withoutTarget.has(candidate.assessmentId)) continue;
    const key = `${target.orgId}|${target.slug}`;
    const group = byKey.get(key);
    if (group) group.candidates.push(candidate);
    else byKey.set(key, { target, candidates: [candidate] });
  }
  return { groups: Array.from(byKey.values()), withoutTarget: Array.from(withoutTarget).sort() };
}

/**
 * Qué evaluaciones nuevas se pueden sumar a un proceso que ya contiene `linked`. Una
 * evaluación queda bloqueada si alguna de sus filas cae en un (grado del curso, prueba) que
 * con ella tendría dos instrumentos distintos; la prueba es la línea o, sin línea, la
 * asignatura (`trackOrSubjectTestKey`). Las demás se vinculan aunque otras del mismo lote
 * queden fuera.
 */
export function splitLinkableByInvariant(
  incoming: readonly LoadProcessCandidate[],
  linked: readonly ProcessCandidate[],
): LoadProcessLinkSplit {
  const violations = findProcessInvariantViolations(
    [...linked, ...incoming],
    trackOrSubjectTestKey,
  );
  const blockedCells = new Set(violations.map((v) => `${v.gradeId}|${v.testKey ?? ''}`));
  const blocked = new Set<string>();
  const incomingIds = new Set<string>();
  for (const candidate of incoming) {
    incomingIds.add(candidate.assessmentId);
    const cell = `${candidate.gradeId}|${trackOrSubjectTestKey(candidate) ?? ''}`;
    if (blockedCells.has(cell)) blocked.add(candidate.assessmentId);
  }
  const linkable = Array.from(incomingIds).filter((id) => !blocked.has(id));
  return { linkable: linkable.sort(), blocked: Array.from(blocked).sort(), violations };
}
