import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Database } from '../database/database.types';
import { MeasurementProcessesService } from './measurement-processes.service';
import type { ProcessCoverageService } from './process-coverage.service';

const ORG = 'org-1';
const PROCESS_ID = 'p-1';
const YEAR_2026 = 'ay-2026';
const YEAR_2025 = 'ay-2025';

type Chain = {
  [key: string]: unknown;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

function chainResolving(rows: unknown[]): Chain {
  const chain: Chain = {
    then: (resolve) => Promise.resolve(rows).then(resolve),
  };
  for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset']) {
    chain[method] = () => chain;
  }
  return chain;
}

function makeDb(selectResults: unknown[][]) {
  let selectIdx = 0;
  const updates: string[][] = [];
  const db = {
    select: () => chainResolving(selectResults[selectIdx++] ?? []),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const ids = ['linked'];
            updates.push(ids);
            return ids.map((id) => ({ id }));
          },
        }),
      }),
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as unknown as Database, updates };
}

function processRow() {
  return {
    process: {
      id: PROCESS_ID,
      orgId: ORG,
      academicYearId: YEAR_2026,
      name: 'DIA Intermedio 2026',
      slug: 'dia-intermedio-2026',
      kind: 'dia',
      period: 'intermedio',
      taxonomyId: null,
      status: 'closed',
      startsOn: null,
      endsOn: null,
      expectedScope: {},
      ownerId: null,
      notes: null,
      deletedAt: null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    },
    academicYear: 2026,
    taxonomyName: null,
  };
}

function linkRow(overrides: Record<string, unknown>) {
  return {
    assessmentId: 'a-1',
    orgId: ORG,
    academicYearId: YEAR_2026,
    instrumentId: 'i-lang-4b',
    instrumentType: 'dia',
    applicationPeriod: 'intermedio',
    gradeId: 'g-4b',
    subjectId: 'lang',
    ...overrides,
  };
}

function makeUser(): JwtPayload {
  return { userId: 'u-1', orgId: ORG, roles: ['school_admin'] } as unknown as JwtPayload;
}

function makeService(db: Database) {
  return new MeasurementProcessesService(db, {} as ProcessCoverageService);
}

describe('MeasurementProcessesService.linkAssessments', () => {
  it('acepta una vinculación parcial: no exige vincular las evaluaciones hermanas', async () => {
    const { db, updates } = makeDb([
      [processRow()],
      [linkRow({ assessmentId: 'a-1' }), linkRow({ assessmentId: 'a-1', gradeId: 'g-4b' })],
    ]);

    const result = await makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
      assessmentIds: ['a-1'],
      action: 'link',
    });

    expect(result).toEqual({ processId: PROCESS_ID, linked: 1, unlinked: 0 });
    expect(updates).toHaveLength(1);
  });

  it('acepta un recuperativo del mismo instrumento junto a las ya vinculadas', async () => {
    const { db } = makeDb([
      [processRow()],
      [linkRow({ assessmentId: 'a-ya-vinculada' }), linkRow({ assessmentId: 'a-recuperativo' })],
    ]);

    await expect(
      makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
        assessmentIds: ['a-recuperativo'],
        action: 'link',
      }),
    ).resolves.toEqual({ processId: PROCESS_ID, linked: 1, unlinked: 0 });
  });

  it('rechaza una evaluación de cursos de otro año académico', async () => {
    const { db, updates } = makeDb([
      [processRow()],
      [linkRow({ assessmentId: 'a-2025', academicYearId: YEAR_2025 })],
    ]);

    await expect(
      makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
        assessmentIds: ['a-2025'],
        action: 'link',
      }),
    ).rejects.toThrow(/otro año académico/);
    expect(updates).toHaveLength(0);
  });

  it('rechaza una evaluación que no está en la organización', async () => {
    const { db, updates } = makeDb([[processRow()], [linkRow({ assessmentId: 'a-propia' })]]);

    const promise = makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
      assessmentIds: ['a-propia', 'a-de-otra-org'],
      action: 'link',
    });

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow(/no existe en esta organización/);
    expect(updates).toHaveLength(0);
  });

  it('rechaza una evaluación sin cursos asignados', async () => {
    const { db } = makeDb([
      [processRow()],
      [linkRow({ assessmentId: 'a-sin-curso', academicYearId: null, gradeId: null })],
    ]);

    await expect(
      makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
        assessmentIds: ['a-sin-curso'],
        action: 'link',
      }),
    ).rejects.toThrow(/no tienen cursos asignados/);
  });

  it('rechaza mezclar dos instrumentos distintos para el mismo nivel y prueba', async () => {
    const { db, updates } = makeDb([
      [processRow()],
      [
        linkRow({ assessmentId: 'a-ensayo-1', instrumentId: 'i-ensayo-1' }),
        linkRow({ assessmentId: 'a-ensayo-2', instrumentId: 'i-ensayo-2' }),
      ],
    ]);

    await expect(
      makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
        assessmentIds: ['a-ensayo-2'],
        action: 'link',
      }),
    ).rejects.toThrow(/dos instrumentos distintos para el mismo nivel y prueba/);
    expect(updates).toHaveLength(0);
  });

  it('responde 404 si el proceso no existe en la organización', async () => {
    const { db } = makeDb([[]]);

    await expect(
      makeService(db).linkAssessments(makeUser(), PROCESS_ID, {
        assessmentIds: ['a-1'],
        action: 'link',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
