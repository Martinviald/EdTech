/**
 * Crea procesos de medición por tanda desde `assessments.config.<clave>` y vincula las
 * evaluaciones que aún no tienen proceso. Pensado para los ensayos PAES (`config.ensayo`),
 * donde el backfill por período deja todo ambiguo porque `application_period` es null.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:backfill:processes:paes \
 *     --org <uuid> [--year 2026] [--type paes] [--key ensayo] [--commit]
 *
 * Dry-run por defecto. Idempotente: reusa el proceso vigente con el mismo slug y solo
 * vincula evaluaciones con `process_id` null. Excluye evaluaciones canceladas y las de
 * instrumentos borrados. Valida la invariante (un instrumento por grado y prueba) antes de
 * crear cada proceso; el grupo que la viola se reporta y no se toca. Nombre del proceso:
 * "<tipo> <valor> <año>", p. ej. "Ensayo PAES 3 2026".
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { academicYears } from '../schema/organizations';
import { classGroups } from '../schema/academic';
import { instruments } from '../schema/instruments';
import { assessments, assessmentCourseAssignments } from '../schema/assessments';
import { measurementProcesses } from '../schema/measurement-processes';
import {
  groupCandidatesByConfigValue,
  type ConfigProcessCandidate,
  type ConfigProcessPlan,
} from '../lib/config-process-grouping';

type Options = {
  orgId: string;
  year: number | null;
  instrumentType: string;
  configKey: string;
  commit: boolean;
};

function parseArgs(argv: readonly string[]): Options {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const orgId = value('org');
  if (!orgId) throw new Error('Falta --org <uuid>');
  const yearArg = value('year');
  const configKey = value('key') ?? 'ensayo';
  if (!/^[a-zA-Z0-9_]+$/.test(configKey)) throw new Error(`Clave de config inválida: ${configKey}`);
  return {
    orgId,
    year: yearArg ? Number(yearArg) : null,
    instrumentType: value('type') ?? 'paes',
    configKey,
    commit: argv.includes('--commit'),
  };
}

async function loadCandidates(db: Database, options: Options): Promise<ConfigProcessCandidate[]> {
  const configValue = sql<string>`${assessments.config}->>${options.configKey}`;
  const conditions: SQL[] = [
    eq(assessments.orgId, options.orgId),
    isNull(assessments.processId),
    ne(assessments.status, 'cancelled'),
    isNull(instruments.deletedAt),
    sql`${instruments.type}::text = ${options.instrumentType}`,
    sql`${configValue} is not null`,
  ];
  if (options.year !== null) conditions.push(eq(academicYears.year, options.year));

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
    .where(and(...conditions));
}

async function applyPlan(
  db: Database,
  plan: ConfigProcessPlan,
): Promise<{ processId: string; created: boolean; linked: number }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: measurementProcesses.id })
      .from(measurementProcesses)
      .where(
        and(
          eq(measurementProcesses.orgId, plan.orgId),
          eq(measurementProcesses.slug, plan.slug),
          isNull(measurementProcesses.deletedAt),
        ),
      )
      .limit(1);

    let processId = existing?.id;
    if (!processId) {
      const [inserted] = await tx
        .insert(measurementProcesses)
        .values({
          orgId: plan.orgId,
          academicYearId: plan.academicYearId,
          name: plan.name,
          slug: plan.slug,
          kind: plan.kind,
          period: plan.period,
          taxonomyId: plan.taxonomyId,
          status: 'closed',
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
          expectedScope: plan.expectedScope,
        })
        .returning({ id: measurementProcesses.id });
      if (!inserted) throw new Error(`No se pudo crear el proceso "${plan.name}"`);
      processId = inserted.id;
    }

    const linked = await tx
      .update(assessments)
      .set({ processId, updatedAt: new Date() })
      .where(and(inArray(assessments.id, plan.assessmentIds), isNull(assessments.processId)))
      .returning({ id: assessments.id });

    return { processId, created: !existing, linked: linked.length };
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  const db = createDbClient(databaseUrl, { maxConnections: 1 });

  try {
    console.log(
      options.commit
        ? 'Modo --commit: se crean procesos y se vinculan evaluaciones.'
        : 'Modo dry-run: no se escribe nada. Usa --commit para crear y vincular.',
    );
    const candidates = await loadCandidates(db, options);
    const { plans, ambiguous, multiYearAssessmentIds } = groupCandidatesByConfigValue(candidates);
    console.log(
      `\n${plans.length} proceso(s) por config.${options.configKey} (${options.instrumentType}), ` +
        `${plans.reduce((sum, plan) => sum + plan.assessmentIds.length, 0)} evaluación(es) sin proceso.\n`,
    );

    let created = 0;
    let linked = 0;
    for (const plan of plans) {
      const line = `${plan.name} — ${plan.assessmentIds.length} evaluación(es), ${plan.startsOn ?? '¿?'} → ${plan.endsOn ?? '¿?'}`;
      if (!options.commit) {
        console.log(`· [dry-run] ${line}`);
        continue;
      }
      const result = await applyPlan(db, plan);
      if (result.created) created += 1;
      linked += result.linked;
      console.log(
        `✓ ${line} ${result.created ? '(nuevo)' : '(reusado)'} · ${result.linked} vinculada(s)`,
      );
    }
    if (options.commit) {
      console.log(`\nCreados ${created} proceso(s); vinculadas ${linked} evaluación(es).`);
    }

    if (ambiguous.length > 0) {
      console.log(`\n⚠️ ${ambiguous.length} grupo(s) violan la invariante y quedaron SIN proceso:`);
      for (const plan of ambiguous) {
        console.log(
          `   · ${plan.name} — ${plan.violations.length} (grado, prueba) con más de un instrumento`,
        );
      }
    }
    if (multiYearAssessmentIds.length > 0) {
      console.log(
        `\n⚠️ ${multiYearAssessmentIds.length} evaluación(es) abarcan cursos de más de un año y NO se asignaron.`,
      );
    }
    if (ambiguous.length > 0 || multiYearAssessmentIds.length > 0) process.exitCode = 2;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[backfill-processes-by-config] falló:', error);
  process.exit(1);
});
