import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { ExpectedScope, ProcessInvariantViolation } from '@soe/types';
import type { Database } from '../client';
import { academicYears } from '../schema/organizations';
import { classGroups } from '../schema/academic';
import { instruments } from '../schema/instruments';
import { assessments, assessmentCourseAssignments } from '../schema/assessments';
import { measurementProcesses } from '../schema/measurement-processes';
import { deriveExpectedScope } from '../lib/config-process-grouping';
import {
  groupByLoadProcessTarget,
  splitLinkableByInvariant,
  type LoadProcessCandidate,
  type LoadProcessGroup,
  type LoadProcessSource,
} from '../lib/load-process-linking';

const CONFIG_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Filas (evaluación × curso asignado) con lo que el agrupador de procesos necesita. Excluye
 * evaluaciones canceladas e instrumentos borrados. `configKey` elige qué valor de
 * `assessments.config` viaja en `configValue` (la tanda: `ensayo`); sin él, va null.
 */
export async function loadProcessCandidateRows(
  db: Database,
  conditions: SQL[],
  configKey: string | null = null,
): Promise<LoadProcessCandidate[]> {
  if (configKey !== null && !CONFIG_KEY_PATTERN.test(configKey)) {
    throw new Error(`Clave de config inválida: ${configKey}`);
  }
  const configValue =
    configKey === null
      ? sql<string | null>`null::text`
      : sql<string | null>`${assessments.config}->>${configKey}`;
  return db
    .select({
      assessmentId: assessments.id,
      orgId: assessments.orgId,
      academicYearId: classGroups.academicYearId,
      year: academicYears.year,
      instrumentId: instruments.id,
      instrumentType: sql<string>`${instruments.type}::text`,
      applicationPeriod: instruments.applicationPeriod,
      gradeId: classGroups.gradeId,
      subjectId: instruments.subjectId,
      trackId: instruments.trackId,
      taxonomyId: instruments.taxonomyId,
      classGroupId: classGroups.id,
      configValue,
      administeredOn: sql<string | null>`to_char(${assessments.administeredAt}, 'YYYY-MM-DD')`,
    })
    .from(assessments)
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(
      assessmentCourseAssignments,
      eq(assessmentCourseAssignments.assessmentId, assessments.id),
    )
    .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
    .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
    .where(and(ne(assessments.status, 'cancelled'), isNull(instruments.deletedAt), ...conditions));
}

export type LoadProcessLinkOutcome = {
  name: string;
  processId: string | null;
  created: boolean;
  linked: string[];
  blocked: string[];
  violations: ProcessInvariantViolation[];
  reason: string | null;
};

export type LoadProcessLinkReport = {
  outcomes: LoadProcessLinkOutcome[];
  withoutTarget: string[];
};

/**
 * Vincula a su proceso de medición las evaluaciones que un cargador acaba de crear, dentro
 * de la MISMA transacción (`tx` debe correr en `withOrgContext` de la org). Crea el proceso
 * si no existe un vigente con el mismo slug, o lo reusa. Antes de vincular valida la
 * invariante contra las evaluaciones que el proceso ya tiene: las que la romperían quedan
 * sin proceso (caen en la toma legacy) y se reportan.
 */
export async function linkLoadedAssessmentsToProcesses(
  tx: Database,
  params: { orgId: string; assessmentIds: readonly string[]; source: LoadProcessSource },
): Promise<LoadProcessLinkReport> {
  if (params.assessmentIds.length === 0) return { outcomes: [], withoutTarget: [] };
  const configKey = params.source.by === 'config' ? params.source.key : null;
  const incoming = await loadProcessCandidateRows(
    tx,
    [
      eq(assessments.orgId, params.orgId),
      inArray(assessments.id, [...params.assessmentIds]),
      isNull(assessments.processId),
    ],
    configKey,
  );
  const grouping = groupByLoadProcessTarget(incoming, params.source);
  const outcomes: LoadProcessLinkOutcome[] = [];
  for (const group of grouping.groups) {
    outcomes.push(await linkGroup(tx, group));
  }
  return { outcomes, withoutTarget: grouping.withoutTarget };
}

async function linkGroup(tx: Database, group: LoadProcessGroup): Promise<LoadProcessLinkOutcome> {
  const { target } = group;
  const incomingIds = Array.from(new Set(group.candidates.map((c) => c.assessmentId))).sort();
  const [existing] = await tx
    .select({
      id: measurementProcesses.id,
      academicYearId: measurementProcesses.academicYearId,
      expectedScope: measurementProcesses.expectedScope,
      startsOn: measurementProcesses.startsOn,
      endsOn: measurementProcesses.endsOn,
    })
    .from(measurementProcesses)
    .where(
      and(
        eq(measurementProcesses.orgId, target.orgId),
        eq(measurementProcesses.slug, target.slug),
        isNull(measurementProcesses.deletedAt),
      ),
    )
    .limit(1);

  if (existing && existing.academicYearId !== target.academicYearId) {
    return {
      name: target.name,
      processId: existing.id,
      created: false,
      linked: [],
      blocked: incomingIds,
      violations: [],
      reason: 'el proceso con ese nombre es de otro año académico',
    };
  }

  const linked = existing
    ? await loadProcessCandidateRows(tx, [eq(assessments.processId, existing.id)])
    : [];
  const split = splitLinkableByInvariant(group.candidates, linked);
  const outcome: LoadProcessLinkOutcome = {
    name: target.name,
    processId: existing?.id ?? null,
    created: false,
    linked: split.linkable,
    blocked: split.blocked,
    violations: split.violations,
    reason:
      split.blocked.length > 0 ? 'dos instrumentos distintos para el mismo nivel y prueba' : null,
  };
  if (split.linkable.length === 0) return outcome;

  const linkable = new Set(split.linkable);
  const linkedRows = group.candidates.filter((c) => linkable.has(c.assessmentId));
  const dates = [...linked, ...linkedRows]
    .map((c) => c.administeredOn)
    .filter((d): d is string => d !== null)
    .sort();
  const startsOn = minDate(existing?.startsOn ?? null, dates[0] ?? null);
  const endsOn = maxDate(existing?.endsOn ?? null, dates[dates.length - 1] ?? null);

  let processId = existing?.id;
  if (!existing) {
    const taxonomyIds = new Set(linkedRows.map((c) => c.taxonomyId).filter((t) => t !== null));
    const [inserted] = await tx
      .insert(measurementProcesses)
      .values({
        orgId: target.orgId,
        academicYearId: target.academicYearId,
        name: target.name,
        slug: target.slug,
        kind: target.kind,
        period: target.period,
        taxonomyId: taxonomyIds.size === 1 ? (Array.from(taxonomyIds)[0] ?? null) : null,
        status: 'closed',
        startsOn,
        endsOn,
        expectedScope: deriveExpectedScope(linkedRows),
      })
      .returning({ id: measurementProcesses.id });
    if (!inserted) throw new Error(`No se pudo crear el proceso "${target.name}"`);
    processId = inserted.id;
    outcome.created = true;
  } else {
    const scope = existing.expectedScope as ExpectedScope;
    await tx
      .update(measurementProcesses)
      .set({
        startsOn,
        endsOn,
        ...(scope.derived
          ? { expectedScope: deriveExpectedScope([...linked, ...linkedRows]) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(measurementProcesses.id, existing.id));
  }
  outcome.processId = processId ?? null;

  await tx
    .update(assessments)
    .set({ processId, updatedAt: new Date() })
    .where(and(inArray(assessments.id, split.linkable), isNull(assessments.processId)));
  return outcome;
}

function minDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export function formatLoadProcessLinkReport(report: LoadProcessLinkReport): string[] {
  const lines: string[] = [];
  for (const outcome of report.outcomes) {
    const verb = outcome.created ? 'nuevo' : 'existente';
    lines.push(
      `  proceso "${outcome.name}" (${verb}): ${outcome.linked.length} vinculada(s)` +
        (outcome.blocked.length > 0
          ? ` · ${outcome.blocked.length} SIN proceso (${outcome.reason})`
          : ''),
    );
  }
  if (report.withoutTarget.length > 0) {
    lines.push(
      `  ${report.withoutTarget.length} evaluación(es) sin proceso destino (sin tanda o con cursos de varios años)`,
    );
  }
  return lines;
}
