import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema, withOrgContext } from '@soe/db';
import type { InstrumentApplicationPeriod } from '@soe/types';
import type { JwtPayload } from '../src/auth/jwt-payload.types';
import type { Database } from '../src/database/database.types';
import { MasterBoardService } from '../src/master-board/master-board.service';
import { loadMatrixRows } from '../src/master-board/queries/matrix-rows.query';

config({ path: resolve(__dirname, '../../../.env') });

const DEFAULT_GOLDEN = resolve(__dirname, '../../../docs/golden/master-board-local.json');

type GoldenCell = {
  stableKey: string;
  instruments: string[];
  scoreSum: string | null;
  maxSum: string | null;
  studentsAssessed: number;
};

type GoldenTake = {
  key: string;
  label: string;
  academicYearId: string;
  instrumentType: string;
  applicationPeriod: InstrumentApplicationPeriod | null;
  assessmentCount: number;
  assessmentIds: string[];
  cells: GoldenCell[];
};

type Golden = { orgId: string; takes: GoldenTake[] };

type ObservedCell = {
  rows: number;
  instruments: string;
  scoreSum: string | null;
  maxSum: string | null;
  studentsAssessed: number;
};

type Codes = {
  gradeCode: Map<string, string>;
  subjectCode: Map<string, string>;
  instrumentName: Map<string, string>;
};

class RollbackSignal extends Error {}

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function adminUser(orgId: string): JwtPayload {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    orgId,
    email: 'golden@local',
    name: 'Golden',
    isPlatformAdmin: false,
    roles: ['school_admin'],
    activeRole: 'school_admin',
    role: 'school_admin',
  };
}

async function assertF0State(tx: Database): Promise<void> {
  const [row] = await tx.execute<{ electives: number }>(
    sql`select count(*)::int as electives from instrument_sections s join instruments i on i.id = s.instrument_id where s.role = 'elective' and i.deleted_at is null`,
  );
  if (Number(row?.electives ?? 0) > 0) {
    throw new Error(
      'La BDD tiene Ciencias migrada a secciones electivas: el golden es del modelo legacy. ' +
        'Corre db:migrate:cie-electivas --rollback --commit o recrea el banco con scripts/tablero/crear-bd-pruebas.sh.',
    );
  }
}

async function neutralizeTracksAndProcesses(
  tx: Database,
): Promise<{ tracks: number; links: number; processes: number }> {
  const tracks = await tx.execute(
    sql`update instruments set track_id = null where track_id is not null`,
  );
  const links = await tx.execute(
    sql`update assessments set process_id = null where process_id is not null`,
  );
  const processes = await tx.execute(
    sql`update measurement_processes set deleted_at = now() where deleted_at is null`,
  );
  return {
    tracks: tracks.count ?? 0,
    links: links.count ?? 0,
    processes: processes.count ?? 0,
  };
}

async function loadCodes(tx: Database): Promise<Codes> {
  const gradeRows = await tx.execute<{ id: string; code: string }>(
    sql`select id, code from grades`,
  );
  const subjectRows = await tx.execute<{ id: string; code: string }>(
    sql`select id, code from subjects`,
  );
  const instrumentRows = await tx.execute<{ id: string; name: string }>(
    sql`select id, name from instruments`,
  );
  return {
    gradeCode: new Map(gradeRows.map((row) => [row.id, row.code])),
    subjectCode: new Map(subjectRows.map((row) => [row.id, row.code])),
    instrumentName: new Map(instrumentRows.map((row) => [row.id, row.name])),
  };
}

function stableKeyOf(
  codes: Codes,
  gradeId: string,
  classGroupName: string,
  subjectId: string,
): string {
  return `${codes.gradeCode.get(gradeId) ?? gradeId}:${classGroupName}:${codes.subjectCode.get(subjectId) ?? subjectId}`;
}

async function compareTake(
  tx: Database,
  service: MasterBoardService,
  user: JwtPayload,
  orgId: string,
  codes: Codes,
  take: GoldenTake,
): Promise<{ compared: number; differences: string[] }> {
  const differences: string[] = [];
  const matrix = await service.getMatrix(user, {
    academicYearId: take.academicYearId,
    instrumentType: take.instrumentType,
    applicationPeriod: take.applicationPeriod ?? undefined,
  });
  const resolved = [...matrix.take.assessmentIds].sort();
  if (resolved.length !== take.assessmentIds.length) {
    differences.push(
      `${take.label}: evaluaciones resueltas ${resolved.length} vs golden ${take.assessmentIds.length}`,
    );
  }
  if (matrix.redirectProcessId !== null) {
    differences.push(`${take.label}: redirectProcessId inesperado ${matrix.redirectProcessId}`);
  }

  const rows = await withOrgContext(tx, orgId, (orgTx) =>
    loadMatrixRows(orgTx, { assessmentIds: resolved, scopedClassGroupIds: null }),
  );
  const observed = new Map<string, ObservedCell>();
  for (const row of rows) {
    const key = stableKeyOf(codes, row.gradeId, row.classGroupName, row.subjectId);
    const instrumentNames = row.instrumentIds
      .map((id) => codes.instrumentName.get(id) ?? id)
      .sort()
      .join(' | ');
    const current = observed.get(key);
    if (current) {
      current.rows += 1;
      current.scoreSum = String(Number(current.scoreSum ?? 0) + Number(row.scoreSum ?? 0));
      current.maxSum = String(Number(current.maxSum ?? 0) + Number(row.maxSum ?? 0));
      current.studentsAssessed = Math.max(current.studentsAssessed, Number(row.studentsAssessed));
    } else {
      observed.set(key, {
        rows: 1,
        instruments: instrumentNames,
        scoreSum: row.scoreSum,
        maxSum: row.maxSum,
        studentsAssessed: Number(row.studentsAssessed),
      });
    }
  }

  const courseCellByKey = new Map<string, { studentsAssessed: number; value: number | null }>();
  for (const grade of matrix.grades) {
    for (const course of grade.courses) {
      for (const cell of course.cells) {
        courseCellByKey.set(stableKeyOf(codes, grade.gradeId, course.name, cell.subjectId), {
          studentsAssessed: cell.studentsAssessed,
          value: cell.metrics[0]?.value ?? null,
        });
      }
    }
  }

  for (const cell of take.cells) {
    const key = cell.stableKey;
    const found = observed.get(key);
    if (!found) {
      differences.push(`${take.label} ${cell.stableKey}: falta la celda`);
      continue;
    }
    observed.delete(key);
    if (found.rows !== 1) {
      differences.push(`${take.label} ${cell.stableKey}: ${found.rows} columnas (esperado 1)`);
    }
    if (found.instruments !== [...cell.instruments].sort().join(' | ')) {
      differences.push(`${take.label} ${cell.stableKey}: instrumentos ${found.instruments}`);
    }
    if (found.scoreSum !== cell.scoreSum) {
      differences.push(
        `${take.label} ${cell.stableKey}: score_sum ${found.scoreSum} vs ${cell.scoreSum}`,
      );
    }
    if (found.maxSum !== cell.maxSum) {
      differences.push(
        `${take.label} ${cell.stableKey}: max_sum ${found.maxSum} vs ${cell.maxSum}`,
      );
    }
    if (found.studentsAssessed !== cell.studentsAssessed) {
      differences.push(
        `${take.label} ${cell.stableKey}: student_count ${found.studentsAssessed} vs ${cell.studentsAssessed}`,
      );
    }
    const served = courseCellByKey.get(key);
    const expectedValue =
      Number(cell.maxSum ?? 0) > 0 ? (Number(cell.scoreSum) / Number(cell.maxSum)) * 100 : null;
    if (
      !served ||
      served.studentsAssessed !== cell.studentsAssessed ||
      served.value !== expectedValue
    ) {
      differences.push(`${take.label} ${cell.stableKey}: la celda que sirve getMatrix no calza`);
    }
  }
  for (const key of observed.keys()) differences.push(`${take.label} ${key}: celda sobrante`);

  return { compared: take.cells.length, differences };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  const golden = JSON.parse(readFileSync(arg('golden') ?? DEFAULT_GOLDEN, 'utf8')) as Golden;
  const orgId = golden.orgId;
  const user = adminUser(orgId);

  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema, logger: false }) as unknown as Database;

  let compared = 0;
  const differences: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const outer = tx as unknown as Database;
      await assertF0State(outer);
      const neutralized = await neutralizeTracksAndProcesses(outer);
      console.log(
        `[golden] en la transacción: ${neutralized.tracks} instrumento(s) sin línea, ${neutralized.links} evaluación(es) sin proceso, ${neutralized.processes} proceso(s) borrado(s) (se revierte al final)`,
      );

      const service = new MasterBoardService(outer);
      const codes = await loadCodes(outer);
      const takes = await service.getTakes(user, {});
      const servedKeys = new Map(takes.takes.map((take) => [take.key, take]));
      for (const take of golden.takes) {
        const served = servedKeys.get(`legacy:${take.key}`);
        if (!served) differences.push(`toma ${take.label}: getTakes no la devuelve`);
        else if (served.assessmentCount !== take.assessmentCount) {
          differences.push(
            `toma ${take.label}: ${served.assessmentCount} evaluaciones vs golden ${take.assessmentCount}`,
          );
        }
        const result = await compareTake(outer, service, user, orgId, codes, take);
        compared += result.compared;
        differences.push(...result.differences);
        console.log(
          `[golden] ${take.label}: ${result.compared} celdas, ${result.differences.length} diferencia(s)`,
        );
      }
      if (takes.takes.length !== golden.takes.length) {
        differences.push(
          `getTakes devuelve ${takes.takes.length} tomas vs golden ${golden.takes.length}`,
        );
      }
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  } finally {
    await client.end({ timeout: 5 });
  }

  console.log(
    `[golden] ${golden.takes.length} tomas · ${compared} celdas comparadas · ${differences.length} diferencia(s)`,
  );
  for (const difference of differences.slice(0, 50)) console.log(`  ✗ ${difference}`);
  if (differences.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('[golden] falló:', error);
  process.exit(1);
});
