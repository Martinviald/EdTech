import { BadRequestException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { CompareInstrumentsDto, UserRole } from '@soe/types';
import { AiAnalysisService } from './ai-analysis.service';

// ──────────────────────────────────────────────────────────────────────────────
// Tests de la lógica de comparabilidad de instrumentos (TKT-23). Se mockea el db
// con un chain que soporta joins/groupBy además de los métodos usados por el
// service; cada `select()` consume el siguiente set de filas de `selectResults`.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(): JwtPayload {
  const role: UserRole = 'academic_director';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: false,
    roles: [role],
    activeRole: role,
    role,
  };
}

type Chain = Record<string, (...args: unknown[]) => unknown>;

function makeDb(selectResults: unknown[][], insertReturning: unknown[][] = []) {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserted: Array<Record<string, unknown>> = [];

  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      const chain: Chain = {};
      for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'groupBy']) {
        chain[m] = () => chain;
      }
      chain.limit = () => Promise.resolve(rows);
      return chain;
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        const ret = insertReturning[insertIdx] ?? [{ ...row, id: 'new-id' }];
        insertIdx++;
        return { returning: () => Promise.resolve(ret) };
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __inserted: inserted,
  } as unknown as Database & { __inserted: Array<Record<string, unknown>> };

  return db;
}

function makeService(db: Database): AiAnalysisService {
  return new (AiAnalysisService as new (db: Database) => AiAnalysisService)(db);
}

function instr(overrides: Record<string, unknown>) {
  return {
    instrumentId: 'i-1',
    type: 'dia',
    gradeId: 'g-1',
    subjectId: 's-1',
    ...overrides,
  };
}

const dto: CompareInstrumentsDto = {
  baseAssessmentId: '11111111-1111-1111-1111-111111111111',
  comparisonAssessmentId: '22222222-2222-2222-2222-222222222222',
  audience: 'general',
  force: false,
};

describe('AiAnalysisService.createComparison', () => {
  it('rechaza instrumentos de distinto tipo/grado/asignatura', async () => {
    const db = makeDb([
      [instr({ instrumentId: 'i-1', gradeId: 'g-1' })],
      [instr({ instrumentId: 'i-2', gradeId: 'g-OTRO' })],
    ]);
    const service = makeService(db);

    await expect(service.createComparison(makeUser(), dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.__inserted).toHaveLength(0);
  });

  it('rechaza cuando ambas evaluaciones usan el mismo instrumento', async () => {
    const db = makeDb([[instr({ instrumentId: 'i-SAME' })], [instr({ instrumentId: 'i-SAME' })]]);
    const service = makeService(db);

    await expect(service.createComparison(makeUser(), dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.__inserted).toHaveLength(0);
  });

  it('crea un registro pending para instrumentos comparables sin caché', async () => {
    const db = makeDb(
      [
        [instr({ instrumentId: 'i-1' })], // base
        [instr({ instrumentId: 'i-2' })], // comparison (mismo tipo/grado/asignatura)
        [], // cache miss
      ],
      [
        [
          {
            id: 'cmp-1',
            orgId: 'org-1',
            assessmentId: dto.baseAssessmentId,
            analysisType: 'instrument_comparison',
            audience: 'general',
            status: 'pending',
            model: null,
            promptVersion: null,
            output: null,
            costUsd: null,
            error: null,
            createdAt: new Date('2025-01-01T00:00:00Z'),
            completedAt: null,
          },
        ],
      ],
    );
    const service = makeService(db);

    const result = await service.createComparison(makeUser(), dto);

    expect(result.fromCache).toBe(false);
    expect(result.analysis.status).toBe('pending');
    expect(result.analysis.analysisType).toBe('instrument_comparison');
    expect(db.__inserted).toHaveLength(1);
    const row = db.__inserted[0]!;
    expect(row.analysisType).toBe('instrument_comparison');
    expect(row.assessmentId).toBe(dto.baseAssessmentId);
    expect(row.input).toEqual({
      baseAssessmentId: dto.baseAssessmentId,
      comparisonAssessmentId: dto.comparisonAssessmentId,
      baseInstrumentId: 'i-1',
      comparisonInstrumentId: 'i-2',
    });
  });
});
