import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_TYPE_LABELS,
  PROCESS_KIND_BY_INSTRUMENT_TYPE,
  expandExpectedCells,
  expectedCellKey,
  slugify,
  uniqueSlug,
  type ExpectedScope,
  type ExpectedScopeCell,
  type InstrumentApplicationPeriod,
  type InstrumentType,
  type ProcessKind,
} from '@soe/types';
import { createDbClient } from '../client';
import { academicYears } from '../schema/organizations';
import { classGroups } from '../schema/academic';
import { instruments } from '../schema/instruments';
import { assessments, assessmentCourseAssignments } from '../schema/assessments';
import { measurementProcesses } from '../schema/measurement-processes';

type ScriptOptions = {
  dryRun: boolean;
  orgId: string | null;
};

type AssessmentRow = {
  assessmentId: string;
  orgId: string;
  administeredAt: Date | null;
  instrumentType: InstrumentType;
  applicationPeriod: InstrumentApplicationPeriod | null;
  taxonomyId: string | null;
  subjectId: string | null;
  classGroupId: string;
  academicYearId: string;
  year: number;
};

type ProcessGroup = {
  key: string;
  orgId: string;
  academicYearId: string;
  year: number;
  instrumentType: InstrumentType;
  period: InstrumentApplicationPeriod | null;
  assessmentIds: Set<string>;
  classGroupIds: Set<string>;
  subjectIds: Set<string>;
  observedCellKeys: Set<string>;
  taxonomyIds: Set<string>;
  administeredDates: Date[];
};

function parseArgs(argv: readonly string[]): ScriptOptions {
  const orgFlagIndex = argv.indexOf('--org');
  return {
    dryRun: argv.includes('--dry-run'),
    orgId: orgFlagIndex >= 0 ? (argv[orgFlagIndex + 1] ?? null) : null,
  };
}

function groupKey(row: AssessmentRow): string {
  return [
    row.orgId,
    row.academicYearId,
    row.instrumentType,
    row.applicationPeriod ?? 'sin-momento',
  ].join('|');
}

function processName(group: ProcessGroup): string {
  const typeLabel = INSTRUMENT_TYPE_LABELS[group.instrumentType] ?? group.instrumentType;
  const periodLabel = group.period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[group.period] : null;
  return [typeLabel, periodLabel, group.year].filter(Boolean).join(' ');
}

function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function buildGroups(rows: readonly AssessmentRow[]): {
  groups: ProcessGroup[];
  multiYearAssessmentIds: string[];
} {
  const yearsByAssessment = new Map<string, Set<string>>();
  for (const row of rows) {
    let years = yearsByAssessment.get(row.assessmentId);
    if (!years) {
      years = new Set<string>();
      yearsByAssessment.set(row.assessmentId, years);
    }
    years.add(row.academicYearId);
  }

  const multiYearAssessmentIds: string[] = [];
  for (const [assessmentId, years] of yearsByAssessment) {
    if (years.size > 1) multiYearAssessmentIds.push(assessmentId);
  }
  const excluded = new Set(multiYearAssessmentIds);

  const groups = new Map<string, ProcessGroup>();
  for (const row of rows) {
    if (excluded.has(row.assessmentId)) continue;
    const key = groupKey(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        orgId: row.orgId,
        academicYearId: row.academicYearId,
        year: row.year,
        instrumentType: row.instrumentType,
        period: row.applicationPeriod,
        assessmentIds: new Set(),
        classGroupIds: new Set(),
        subjectIds: new Set(),
        observedCellKeys: new Set(),
        taxonomyIds: new Set(),
        administeredDates: [],
      };
      groups.set(key, group);
    }
    group.assessmentIds.add(row.assessmentId);
    group.classGroupIds.add(row.classGroupId);
    if (row.subjectId) {
      group.subjectIds.add(row.subjectId);
      group.observedCellKeys.add(
        expectedCellKey({ classGroupId: row.classGroupId, subjectId: row.subjectId }),
      );
    }
    if (row.taxonomyId) group.taxonomyIds.add(row.taxonomyId);
    if (row.administeredAt) group.administeredDates.push(row.administeredAt);
  }

  return { groups: Array.from(groups.values()), multiYearAssessmentIds };
}

function buildExcludedCells(group: ProcessGroup): ExpectedScopeCell[] {
  const excluded: ExpectedScopeCell[] = [];
  for (const classGroupId of group.classGroupIds) {
    for (const subjectId of group.subjectIds) {
      const cell = { classGroupId, subjectId };
      if (group.observedCellKeys.has(expectedCellKey(cell))) continue;
      excluded.push(cell);
    }
  }
  return excluded;
}

type Database = ReturnType<typeof createDbClient>;

function sameCellSet(a: readonly ExpectedScopeCell[], b: ReadonlySet<string>): boolean {
  if (a.length !== b.size) return false;
  return a.every((cell) => b.has(expectedCellKey(cell)));
}

/**
 * Un `expected_scope` derivado describe lo que YA está cargado, así que su cobertura
 * debe dar 100%. La primera versión del backfill guardaba sólo `classGroupIds` y
 * `subjectIds`, y el denominador salía del producto cartesiano: los pares (curso,
 * asignatura) que nunca se aplicaron aparecían como celdas faltantes. Esta pasada
 * recalcula el alcance de todo proceso derivado a partir de sus evaluaciones
 * enlazadas y anota los pares no observados en `excludedCells`.
 */
async function repairDerivedScopes(
  db: Database,
  orgId: string | null,
  dryRun: boolean,
): Promise<void> {
  const conditions = [
    isNull(measurementProcesses.deletedAt),
    sql`${measurementProcesses.expectedScope}->>'derived' = 'true'`,
  ];
  if (orgId) conditions.push(eq(measurementProcesses.orgId, orgId));

  const derived = await db
    .select({
      id: measurementProcesses.id,
      name: measurementProcesses.name,
      expectedScope: measurementProcesses.expectedScope,
    })
    .from(measurementProcesses)
    .where(and(...conditions));
  if (derived.length === 0) return;

  const cellRows = await db
    .select({
      processId: assessments.processId,
      classGroupId: assessmentCourseAssignments.classGroupId,
      subjectId: instruments.subjectId,
    })
    .from(assessments)
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(
      assessmentCourseAssignments,
      eq(assessmentCourseAssignments.assessmentId, assessments.id),
    )
    .where(
      and(
        inArray(
          assessments.processId,
          derived.map((p) => p.id),
        ),
        isNull(instruments.deletedAt),
      ),
    );

  const observedByProcess = new Map<string, Set<string>>();
  const classGroupsByProcess = new Map<string, Set<string>>();
  const subjectsByProcess = new Map<string, Set<string>>();
  for (const row of cellRows) {
    if (!row.processId || !row.subjectId) continue;
    let observed = observedByProcess.get(row.processId);
    if (!observed) {
      observed = new Set();
      observedByProcess.set(row.processId, observed);
      classGroupsByProcess.set(row.processId, new Set());
      subjectsByProcess.set(row.processId, new Set());
    }
    observed.add(expectedCellKey({ classGroupId: row.classGroupId, subjectId: row.subjectId }));
    classGroupsByProcess.get(row.processId)?.add(row.classGroupId);
    subjectsByProcess.get(row.processId)?.add(row.subjectId);
  }

  let repaired = 0;
  for (const process of derived) {
    const observed = observedByProcess.get(process.id) ?? new Set<string>();
    if (sameCellSet(expandExpectedCells(process.expectedScope), observed)) continue;

    const classGroupIds = Array.from(classGroupsByProcess.get(process.id) ?? []);
    const subjectIds = Array.from(subjectsByProcess.get(process.id) ?? []);
    const excludedCells: ExpectedScopeCell[] = [];
    for (const classGroupId of classGroupIds) {
      for (const subjectId of subjectIds) {
        const cell = { classGroupId, subjectId };
        if (observed.has(expectedCellKey(cell))) continue;
        excludedCells.push(cell);
      }
    }

    repaired += 1;
    console.log(
      `${dryRun ? '· [dry-run]' : '✓'} alcance derivado corregido: ${process.name} — ` +
        `${observed.size} celda(s) reales, ${excludedCells.length} excluida(s)`,
    );
    if (dryRun) continue;

    await db
      .update(measurementProcesses)
      .set({
        expectedScope: { classGroupIds, subjectIds, excludedCells, derived: true },
        updatedAt: new Date(),
      })
      .where(eq(measurementProcesses.id, process.id));
  }

  if (repaired > 0) {
    console.log(
      `\n${dryRun ? 'Se corregiría(n)' : 'Se corrigió(eron)'} ${repaired} alcance(s) derivado(s).\n`,
    );
  }
}

function resolveSlug(orgId: string, baseSlug: string, takenSlugs: Set<string>): string {
  const orgScopedTaken = new Set(
    Array.from(takenSlugs)
      .filter((entry) => entry.startsWith(`${orgId}|`))
      .map((entry) => entry.slice(orgId.length + 1)),
  );
  const slug = uniqueSlug(baseSlug, orgScopedTaken);
  takenSlugs.add(`${orgId}|${slug}`);
  return slug;
}

async function main(): Promise<void> {
  const { dryRun, orgId } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  await repairDerivedScopes(db, orgId, dryRun);

  const baseConditions = [isNull(assessments.processId), isNull(instruments.deletedAt)];
  if (orgId) baseConditions.push(eq(assessments.orgId, orgId));

  const rows = (await db
    .select({
      assessmentId: assessments.id,
      orgId: assessments.orgId,
      administeredAt: assessments.administeredAt,
      instrumentType: instruments.type,
      applicationPeriod: instruments.applicationPeriod,
      taxonomyId: instruments.taxonomyId,
      subjectId: instruments.subjectId,
      classGroupId: classGroups.id,
      academicYearId: classGroups.academicYearId,
      year: academicYears.year,
    })
    .from(assessments)
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(
      assessmentCourseAssignments,
      eq(assessmentCourseAssignments.assessmentId, assessments.id),
    )
    .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
    .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
    .where(and(...baseConditions))) as AssessmentRow[];

  const orphanConditions = [isNull(assessments.processId)];
  if (orgId) orphanConditions.push(eq(assessments.orgId, orgId));
  const allPending = await db
    .select({ id: assessments.id, name: assessments.name })
    .from(assessments)
    .where(and(...orphanConditions));

  if (allPending.length === 0) {
    console.log('✅ No hay evaluaciones sin proceso asignado.');
    process.exit(0);
  }

  const { groups, multiYearAssessmentIds } = buildGroups(rows);
  const assignable = new Set(groups.flatMap((g) => Array.from(g.assessmentIds)));
  const withoutCourse = allPending.filter(
    (a) => !assignable.has(a.id) && !multiYearAssessmentIds.includes(a.id),
  );

  const existing = await db
    .select({
      id: measurementProcesses.id,
      orgId: measurementProcesses.orgId,
      slug: measurementProcesses.slug,
    })
    .from(measurementProcesses);
  const existingBySlug = new Map(existing.map((p) => [`${p.orgId}|${p.slug}`, p.id]));
  const takenSlugs = new Set(existingBySlug.keys());

  console.log(
    `\n${groups.length} proceso(s) derivado(s) de ${assignable.size} evaluación(es) pendiente(s).\n`,
  );

  let createdCount = 0;
  let reusedCount = 0;
  let linkedCount = 0;

  for (const group of groups.sort((a, b) => processName(a).localeCompare(processName(b)))) {
    const name = processName(group);
    const baseSlug = slugify(name);
    const existingId = existingBySlug.get(`${group.orgId}|${baseSlug}`);
    const gridCells = group.classGroupIds.size * group.subjectIds.size;
    const observedCells = group.observedCellKeys.size;
    const flags: string[] = [];
    if (group.assessmentIds.size === 1) flags.push('⚠️ una sola celda');
    if (group.subjectIds.size === 0) flags.push('⚠️ sin asignatura en el instrumento');
    if (observedCells > 0 && group.assessmentIds.size > observedCells) {
      flags.push('⚠️ más evaluaciones que celdas');
    }
    if (gridCells > observedCells) {
      flags.push(`${gridCells - observedCells} celda(s) de la grilla excluida(s)`);
    }
    if (!group.period) flags.push('sin momento');

    console.log(
      `${dryRun ? '· [dry-run]' : '✓'} ${name} — ${group.assessmentIds.size} evaluación(es), ` +
        `${group.classGroupIds.size} curso(s) × ${group.subjectIds.size} asignatura(s) ` +
        `→ ${observedCells} celda(s)` +
        (flags.length > 0 ? `  ${flags.join(' · ')}` : ''),
    );

    if (dryRun) {
      if (existingId) reusedCount += 1;
      else createdCount += 1;
      linkedCount += group.assessmentIds.size;
      continue;
    }

    const dates = group.administeredDates.sort((a, b) => a.getTime() - b.getTime());
    const expectedScope: ExpectedScope = {
      classGroupIds: Array.from(group.classGroupIds),
      subjectIds: Array.from(group.subjectIds),
      excludedCells: buildExcludedCells(group),
      derived: true,
    };
    const kind: ProcessKind = PROCESS_KIND_BY_INSTRUMENT_TYPE[group.instrumentType] ?? 'custom';

    let processId = existingId;
    if (processId) {
      reusedCount += 1;
    } else {
      const slug = resolveSlug(group.orgId, baseSlug, takenSlugs);
      const [inserted] = await db
        .insert(measurementProcesses)
        .values({
          orgId: group.orgId,
          academicYearId: group.academicYearId,
          name,
          slug,
          kind,
          period: group.period,
          taxonomyId: group.taxonomyIds.size === 1 ? Array.from(group.taxonomyIds)[0] : null,
          status: 'closed',
          startsOn: toDateOnly(dates[0] ?? null),
          endsOn: toDateOnly(dates[dates.length - 1] ?? null),
          expectedScope,
        })
        .returning({ id: measurementProcesses.id });
      if (!inserted) throw new Error(`No se pudo crear el proceso "${name}".`);
      processId = inserted.id;
      existingBySlug.set(`${group.orgId}|${slug}`, processId);
      createdCount += 1;
    }

    const ids = Array.from(group.assessmentIds);
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      await db
        .update(assessments)
        .set({ processId, updatedAt: new Date() })
        .where(and(inArray(assessments.id, batch), isNull(assessments.processId)));
      linkedCount += batch.length;
    }
  }

  console.log(
    `\n${dryRun ? 'Se crearían' : 'Creados'} ${createdCount} proceso(s)` +
      (reusedCount > 0 ? `, ${reusedCount} reutilizado(s) por slug existente` : '') +
      `; ${dryRun ? 'se vincularían' : 'vinculadas'} ${linkedCount} evaluación(es).`,
  );

  if (multiYearAssessmentIds.length > 0) {
    console.log(
      `\n⚠️ ${multiYearAssessmentIds.length} evaluación(es) abarcan cursos de más de un año académico y NO se asignaron.`,
    );
    console.log('   Un proceso pertenece a un año: revisa esas evaluaciones a mano.');
    for (const id of multiYearAssessmentIds.slice(0, 20)) console.log(`   · ${id}`);
  }

  if (withoutCourse.length > 0) {
    console.log(
      `\n⚠️ ${withoutCourse.length} evaluación(es) sin curso asignado quedaron sin proceso.`,
    );
    console.log('   Sin curso no hay año académico del que derivar el proceso.');
    for (const a of withoutCourse.slice(0, 20))
      console.log(`   · ${a.name ?? '(sin nombre)'} (${a.id})`);
  }

  console.log(
    '\nNota: el expected_scope derivado se marca `derived: true` — describe lo que ya estaba',
  );
  console.log(
    'cargado, no lo que se esperaba rendir. Los pares (curso, asignatura) que nunca se aplicaron',
  );
  console.log(
    'quedan en `excludedCells`, así que su cobertura da 100%. No lo uses para procesos vivos:',
  );
  console.log('declara el alcance a mano para que las celdas faltantes se puedan medir.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill de procesos de medición falló:', err);
  process.exit(1);
});
