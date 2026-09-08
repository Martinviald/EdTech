import 'reflect-metadata';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from '@soe/db';
import { comparableOverviewQuerySchema } from '@soe/types';
import type { JwtPayload } from '../src/auth/jwt-payload.types';
import type { Database } from '../src/database/database.types';
import { ComparableAlertsService } from '../src/dashboards/comparable-alerts.service';
import { ComparableOverviewService } from '../src/dashboards/comparable-overview.service';
import { ComparableUnitAssembler } from '../src/dashboards/comparable/comparable-unit.assembler';
import { DashboardsService } from '../src/dashboards/dashboards.service';

const CSCJ = 'c5c10000-0000-0000-0000-000000000001';
const COLEGIO_DEMO = 'dec00000-0000-0000-0000-000000000001';
const CSCJ_ADMIN = 'd3e00000-0000-0000-0000-000000000002';
const CSCJ_TEACHER = '0c5390dc-57c1-4f5c-a5d0-1cae29b6f257';
const CSCJ_YEAR_2026 = '496635f6-20f5-4578-a1fd-091e61406233';
const CSCJ_CLASS_GROUP = '5afaab05-7b32-4976-8ff6-08425b8cba22';

const NON_DETERMINISTIC_ID_ARRAYS = ['assessmentIds'];

type Scope = {
  key: string;
  exercises: string;
  user: JwtPayload;
  query: Record<string, string>;
};

function adminUser(orgId: string, userId: string): JwtPayload {
  return {
    userId,
    orgId,
    email: 'snapshot@local',
    name: 'Snapshot',
    isPlatformAdmin: false,
    roles: ['school_admin'],
    activeRole: 'school_admin',
    role: 'school_admin',
  };
}

function teacherUser(orgId: string, userId: string): JwtPayload {
  return {
    userId,
    orgId,
    email: 'snapshot-teacher@local',
    name: 'Snapshot Teacher',
    isPlatformAdmin: false,
    roles: ['teacher'],
    activeRole: 'teacher',
    role: 'teacher',
  };
}

const SCOPES: Scope[] = [
  {
    key: '01-cscj-sin-filtros',
    exercises: 'el alcance completo de la org, el que se ve al entrar al panorama',
    user: adminUser(CSCJ, CSCJ_ADMIN),
    query: {},
  },
  {
    key: '02-cscj-paes',
    exercises: 'instrumentos sin bandas de desempeño configuradas',
    user: adminUser(CSCJ, CSCJ_ADMIN),
    query: { instrumentType: 'paes' },
  },
  {
    key: '03-cscj-dia',
    exercises: 'instrumentos con bandas y con read-model de cohorte',
    user: adminUser(CSCJ, CSCJ_ADMIN),
    query: { instrumentType: 'dia' },
  },
  {
    key: '04-cscj-dia-2026',
    exercises: 'el filtro de año académico',
    user: adminUser(CSCJ, CSCJ_ADMIN),
    query: { instrumentType: 'dia', academicYearId: CSCJ_YEAR_2026 },
  },
  {
    key: '05-cscj-un-curso',
    exercises: 'la rama con classGroupIds acotado',
    user: adminUser(CSCJ, CSCJ_ADMIN),
    query: { classGroupId: CSCJ_CLASS_GROUP },
  },
  {
    key: '06-colegio-demo',
    exercises: 'una org con baselines entre años',
    user: adminUser(COLEGIO_DEMO, CSCJ_ADMIN),
    query: {},
  },
  {
    key: '07-cscj-profesor',
    exercises: 'la rama isTeacherScope',
    user: teacherUser(CSCJ, CSCJ_TEACHER),
    query: {},
  },
];

function normalizeSortingOnlyNonDeterministicArrays(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeSortingOnlyNonDeterministicArrays(item));
    if (key && NON_DETERMINISTIC_ID_ARRAYS.includes(key)) {
      return [...items].sort((a, b) => String(a).localeCompare(String(b)));
    }
    return items;
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => {
        return [
          entryKey,
          normalizeSortingOnlyNonDeterministicArrays(entryValue, entryKey),
        ] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

type Metrics = { scope: string; queries: number; ms: number; bytes: number };

async function captureSnapshots(
  outDir: string,
  only: string | null,
  verifyAlertsEndpoint: boolean,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let queryCount = 0;
  const queryClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    debug: () => {
      queryCount += 1;
    },
  });
  const db = drizzle(queryClient, { schema, logger: false }) as unknown as Database;

  const dashboards = new DashboardsService(db);
  const assembler = new ComparableUnitAssembler();
  const alerts = new ComparableAlertsService();
  const overview = new ComparableOverviewService(db, dashboards, alerts, assembler);

  mkdirSync(outDir, { recursive: true });
  const metrics: Metrics[] = [];

  for (const scope of SCOPES) {
    if (only && scope.key !== only) continue;
    const dto = comparableOverviewQuerySchema.parse(scope.query);

    queryCount = 0;
    const startedAt = Date.now();
    const response = await overview.getComparableOverview(scope.user, dto);
    const ms = Date.now() - startedAt;
    const queries = queryCount;

    if (verifyAlertsEndpoint) {
      const alertsOnly = await overview.getComparableAlerts(scope.user, dto);
      const fromFullEndpoint = JSON.stringify({
        alerts: response.alerts,
        alertsTotal: response.alertsTotal,
      });
      if (JSON.stringify(alertsOnly) !== fromFullEndpoint) {
        throw new Error(
          `${scope.key}: el endpoint de alertas no devuelve lo mismo que el panorama completo`,
        );
      }
    }

    const payload = JSON.stringify(normalizeSortingOnlyNonDeterministicArrays(response), null, 2);
    writeFileSync(join(outDir, `${scope.key}.json`), `${payload}\n`);
    metrics.push({ scope: scope.key, queries, ms, bytes: Buffer.byteLength(payload) });
    console.log(
      `  ${scope.key.padEnd(24)} ${String(queries).padStart(4)} queries · ${String(ms).padStart(6)} ms · ${(Buffer.byteLength(payload) / 1024).toFixed(1)} KB`,
    );
  }

  await queryClient.end();
  writeFileSync(join(outDir, '_metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`\nSnapshots en ${outDir}`);
}

type DiffOptions = { expectTruncatedAlerts: number | null };

function diffSnapshotDirs(dirA: string, dirB: string, options: DiffOptions): string[] {
  const files = readdirSync(dirA).filter(
    (file) => file.endsWith('.json') && file !== '_metrics.json',
  );
  const problems: string[] = [];

  for (const file of files) {
    const rawA = readFileSync(join(dirA, file), 'utf8');
    let rawB: string;
    try {
      rawB = readFileSync(join(dirB, file), 'utf8');
    } catch {
      problems.push(`${file}: falta en ${dirB}`);
      continue;
    }
    if (rawA === rawB) continue;

    const baseline = JSON.parse(rawA) as Record<string, unknown>;
    const current = JSON.parse(rawB) as Record<string, unknown>;

    if (options.expectTruncatedAlerts !== null) {
      problems.push(
        ...diffAgainstTruncatedAlerts(file, baseline, current, options.expectTruncatedAlerts),
      );
      continue;
    }
    problems.push(...describeTopLevelDiff(file, baseline, current, []));
  }
  return problems;
}

function diffAgainstTruncatedAlerts(
  file: string,
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  limit: number,
): string[] {
  const problems: string[] = [];
  const baselineAlerts = (baseline.alerts ?? []) as unknown[];
  const currentAlerts = (current.alerts ?? []) as unknown[];

  if (JSON.stringify(currentAlerts) !== JSON.stringify(baselineAlerts.slice(0, limit))) {
    problems.push(`${file} › alerts: no son las ${limit} primeras del baseline, en el mismo orden`);
  }
  if (current.alertsTotal !== baselineAlerts.length) {
    problems.push(
      `${file} › alertsTotal: ${String(current.alertsTotal)} pero el baseline traía ${baselineAlerts.length} alertas`,
    );
  }
  problems.push(...describeTopLevelDiff(file, baseline, current, ['alerts', 'alertsTotal']));
  return problems;
}

function describeTopLevelDiff(
  file: string,
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  ignoredKeys: string[],
): string[] {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const key of keys) {
    if (ignoredKeys.includes(key)) continue;
    const left = JSON.stringify(baseline[key]);
    const right = JSON.stringify(current[key]);
    if (left === right) continue;
    problems.push(
      `${file} › ${key}: difiere\n    baseline: ${truncateForDisplay(left)}\n    actual:   ${truncateForDisplay(right)}`,
    );
  }
  return problems;
}

function truncateForDisplay(value: string | undefined, max = 220): string {
  if (value === undefined) return '(ausente)';
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValue = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };

  const diffIndex = argv.indexOf('--diff');
  if (diffIndex >= 0) {
    const dirA = argv[diffIndex + 1];
    const dirB = argv[diffIndex + 2];
    if (!dirA || !dirB) throw new Error('--diff necesita dos directorios');
    const truncated = flagValue('--expect-truncated-alerts');
    const problems = diffSnapshotDirs(resolve(dirA), resolve(dirB), {
      expectTruncatedAlerts: truncated === null ? null : Number(truncated),
    });
    if (problems.length === 0) {
      console.log('✓ Sin diff: el resultado es exactamente el mismo.');
      return;
    }
    console.error(`✗ ${problems.length} diferencia(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  const out = flagValue('--out');
  if (!out) throw new Error('Falta --out <dir> (o --diff <a> <b>)');
  const outDir = resolve(out);
  mkdirSync(dirname(outDir), { recursive: true });
  await captureSnapshots(outDir, flagValue('--only'), argv.includes('--verify-alerts-endpoint'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
