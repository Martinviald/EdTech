import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_TYPE_LABELS,
  PROCESS_KIND_BY_INSTRUMENT_TYPE,
  slugify,
  uniqueSlug,
  type ExpectedScope,
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
        taxonomyIds: new Set(),
        administeredDates: [],
      };
      groups.set(key, group);
    }
    group.assessmentIds.add(row.assessmentId);
    group.classGroupIds.add(row.classGroupId);
    if (row.subjectId) group.subjectIds.add(row.subjectId);
    if (row.taxonomyId) group.taxonomyIds.add(row.taxonomyId);
    if (row.administeredAt) group.administeredDates.push(row.administeredAt);
  }

  return { groups: Array.from(groups.values()), multiYearAssessmentIds };
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
    const cells = group.classGroupIds.size * group.subjectIds.size;
    const flags: string[] = [];
    if (group.assessmentIds.size === 1) flags.push('⚠️ una sola celda');
    if (group.subjectIds.size === 0) flags.push('⚠️ sin asignatura en el instrumento');
    if (cells > 0 && group.assessmentIds.size > cells) flags.push('⚠️ más evaluaciones que celdas');
    if (!group.period) flags.push('sin momento');

    console.log(
      `${dryRun ? '· [dry-run]' : '✓'} ${name} — ${group.assessmentIds.size} evaluación(es), ` +
        `${group.classGroupIds.size} curso(s) × ${group.subjectIds.size} asignatura(s)` +
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
  console.log('cargado, así que su cobertura siempre da 100%. No lo uses para procesos vivos.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill de procesos de medición falló:', err);
  process.exit(1);
});
