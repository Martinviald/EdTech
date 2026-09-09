import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from '@soe/db';
import {
  comparableOverviewQuerySchema,
  comparableTrajectoryQuerySchema,
  studentComparisonsQuerySchema,
} from '@soe/types';
import type { JwtPayload } from '../src/auth/jwt-payload.types';
import type { Database } from '../src/database/database.types';
import { ComparableTrajectoryService } from '../src/analytics/comparable-trajectory.service';
import { ComparableAlertsService } from '../src/dashboards/comparable-alerts.service';
import { ComparableOverviewService } from '../src/dashboards/comparable-overview.service';
import { ComparableUnitAssembler } from '../src/dashboards/comparable/comparable-unit.assembler';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { StudentComparisonsService } from '../src/students/student-comparisons.service';

const CSCJ = 'c5c10000-0000-0000-0000-000000000001';
const COLEGIO_DEMO = 'dec00000-0000-0000-0000-000000000001';
const CSCJ_ADMIN = 'd3e00000-0000-0000-0000-000000000002';
const CSCJ_TEACHER = '0c5390dc-57c1-4f5c-a5d0-1cae29b6f257';
const CSCJ_YEAR_2026 = '496635f6-20f5-4578-a1fd-091e61406233';
const CSCJ_CLASS_GROUP = '5afaab05-7b32-4976-8ff6-08425b8cba22';
const GRADE_5_BASICO = 'cc7fe54f-adac-4e14-85a4-07adc684063a';
const SUBJECT_MATEMATICAS = 'c7bfda12-19fe-4e5c-893e-be3c8be037b3';
const GRADE_6_BASICO = '447450b6-3e7b-44ae-8a45-1416bbf337e6';
const SUBJECT_LENGUAJE = '4dc924bf-1d11-4609-8c80-58a6958368f9';
const STUDENT_WITH_HISTORY = '5129bfe7-4c39-417e-b344-e3ee81fa905b';

const NON_DETERMINISTIC_ID_ARRAYS = ['assessmentIds', 'instrumentIds'];

type Services = {
  overview: ComparableOverviewService;
  trajectory: ComparableTrajectoryService;
  comparisons: StudentComparisonsService;
};

type Case = {
  key: string;
  run: (services: Services) => Promise<unknown>;
};

function adminUser(orgId: string, userId: string): JwtPayload {
  return {
    userId,
    orgId,
    email: 'bench@local',
    name: 'Bench',
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
    email: 'bench-teacher@local',
    name: 'Bench Teacher',
    isPlatformAdmin: false,
    roles: ['teacher'],
    activeRole: 'teacher',
    role: 'teacher',
  };
}

const CSCJ_ADMIN_USER = adminUser(CSCJ, CSCJ_ADMIN);

function panoramaCase(key: string, user: JwtPayload, query: Record<string, string>): Case {
  return {
    key,
    run: ({ overview }) =>
      overview.getComparableOverview(user, comparableOverviewQuerySchema.parse(query)),
  };
}

const CASES: Case[] = [
  panoramaCase('01-panorama-cscj-sin-filtros', CSCJ_ADMIN_USER, {}),
  panoramaCase('02-panorama-cscj-paes', CSCJ_ADMIN_USER, { instrumentType: 'paes' }),
  panoramaCase('03-panorama-cscj-dia', CSCJ_ADMIN_USER, { instrumentType: 'dia' }),
  panoramaCase('04-panorama-cscj-dia-2026', CSCJ_ADMIN_USER, {
    instrumentType: 'dia',
    academicYearId: CSCJ_YEAR_2026,
  }),
  panoramaCase('05-panorama-cscj-un-curso', CSCJ_ADMIN_USER, {
    classGroupId: CSCJ_CLASS_GROUP,
  }),
  panoramaCase('06-panorama-colegio-demo', adminUser(COLEGIO_DEMO, CSCJ_ADMIN), {}),
  panoramaCase('07-panorama-cscj-profesor', teacherUser(CSCJ, CSCJ_TEACHER), {}),
  {
    key: '08-trayectoria-matematica-5-basico',
    run: ({ trajectory }) =>
      trajectory.trajectory(
        CSCJ_ADMIN_USER,
        comparableTrajectoryQuerySchema.parse({
          gradeId: GRADE_5_BASICO,
          subjectId: SUBJECT_MATEMATICAS,
          instrumentType: 'dia',
        }),
      ),
  },
  {
    key: '09-trayectoria-lenguaje-6-basico',
    run: ({ trajectory }) =>
      trajectory.trajectory(
        CSCJ_ADMIN_USER,
        comparableTrajectoryQuerySchema.parse({
          gradeId: GRADE_6_BASICO,
          subjectId: SUBJECT_LENGUAJE,
          instrumentType: 'dia',
        }),
      ),
  },
  {
    key: '10-comparaciones-alumno',
    run: ({ comparisons }) =>
      comparisons.getComparisons(
        CSCJ_ADMIN_USER,
        STUDENT_WITH_HISTORY,
        studentComparisonsQuerySchema.parse({}),
      ),
  },
  {
    key: '11-comparaciones-alumno-todos-los-anios',
    run: ({ comparisons }) =>
      comparisons.getComparisons(
        CSCJ_ADMIN_USER,
        STUDENT_WITH_HISTORY,
        studentComparisonsQuerySchema.parse({ allYears: 'true' }),
      ),
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

type Measurement = {
  case: string;
  queries: number;
  msRuns: number[];
  msMin: number;
  bytes: number;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValue = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };

  const out = flagValue('--out');
  if (!out) throw new Error('Falta --out <dir>');
  const outDir = resolve(out);
  const repeat = Number(flagValue('--repeat') ?? 1);
  const only = flagValue('--only');

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

  const assembler = new ComparableUnitAssembler();
  const services: Services = {
    overview: new ComparableOverviewService(
      db,
      new DashboardsService(db),
      new ComparableAlertsService(),
      assembler,
    ),
    trajectory: new ComparableTrajectoryService(db, assembler),
    comparisons: new StudentComparisonsService(db, assembler),
  };

  await queryClient`select 1`;

  mkdirSync(outDir, { recursive: true });
  const measurements: Measurement[] = [];

  for (const testCase of CASES) {
    if (only && testCase.key !== only) continue;

    const msRuns: number[] = [];
    let queries = 0;
    let response: unknown;
    for (let attempt = 0; attempt < repeat; attempt += 1) {
      queryCount = 0;
      const startedAt = Date.now();
      response = await testCase.run(services);
      msRuns.push(Date.now() - startedAt);
      queries = queryCount;
    }

    const payload = JSON.stringify(normalizeSortingOnlyNonDeterministicArrays(response), null, 2);
    writeFileSync(join(outDir, `${testCase.key}.json`), `${payload}\n`);
    const measurement: Measurement = {
      case: testCase.key,
      queries,
      msRuns,
      msMin: Math.min(...msRuns),
      bytes: Buffer.byteLength(payload),
    };
    measurements.push(measurement);
    console.log(
      `  ${testCase.key.padEnd(36)} ${String(queries).padStart(4)} q · min ${String(measurement.msMin).padStart(6)} ms · ${(measurement.bytes / 1024).toFixed(1)} KB · corridas ${msRuns.join('/')}`,
    );
  }

  await queryClient.end();
  writeFileSync(join(outDir, '_bench.json'), `${JSON.stringify(measurements, null, 2)}\n`);
  console.log(`\nResultados en ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
