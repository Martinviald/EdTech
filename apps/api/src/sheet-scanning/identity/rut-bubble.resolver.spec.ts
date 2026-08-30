import type { Database } from '@soe/db';
import type { ScannedPage } from '@soe/types';
import { RutBubbleResolver } from './rut-bubble.resolver';

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  innerJoin: (..._: unknown[]) => QueryBuilder;
  leftJoin: (..._: unknown[]) => QueryBuilder;
  limit: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

type DbMock = Database & { __selectCount: () => number };

function makeDb(selectResults: unknown[][]): DbMock {
  let selectIdx = 0;

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      limit: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __selectCount: () => selectIdx,
  } as unknown as DbMock;

  return db;
}

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const CONTEXT = { printRunId: RUN_ID };

function makePage(raw: string | null, confidence = 0.9): ScannedPage {
  return {
    pageIndex: 0,
    imageSha256: 'a'.repeat(64),
    quality: { ok: true, sharpness: 0.8, glare: 0.05, fiducialsFound: 4, rejectReason: null },
    identity: { mode: 'rut_bubbles', raw, confidence },
    marks: [],
    pageThumbJpegBase64: null,
  };
}

function rosterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'student-1',
    rut: '12.345.678-5',
    firstName: 'Ana',
    lastName: 'Pérez',
    ...overrides,
  };
}

describe('RutBubbleResolver', () => {
  it('expone mode rut_bubbles', () => {
    expect(new RutBubbleResolver(makeDb([])).mode).toBe('rut_bubbles');
  });

  it('match exacto contra el roster: candidato con studentId y la confianza de la lectura', async () => {
    const resolver = new RutBubbleResolver(makeDb([[rosterRow()]]));

    const candidate = await resolver.resolve('org-1', makePage('123456785', 0.87), CONTEXT);

    expect(candidate).toEqual({
      printedSheetId: null,
      studentId: 'student-1',
      confidence: 0.87,
      evidence: { rut: '12345678-5', alumno: 'Ana Pérez' },
      needsHumanConfirmation: false,
      batchRejection: null,
    });
  });

  it('raw null: cola manual sin consultar la base', async () => {
    const db = makeDb([]);
    const resolver = new RutBubbleResolver(db);

    const candidate = await resolver.resolve('org-1', makePage(null), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.batchRejection).toBeNull();
    expect(candidate.evidence).toEqual({ motivo: 'rut_ilegible', rut: null });
    expect(db.__selectCount()).toBe(0);
  });

  it('raw con caracteres fuera de dígitos/K: cola manual sin consultar la base', async () => {
    const db = makeDb([]);
    const resolver = new RutBubbleResolver(db);

    const candidate = await resolver.resolve('org-1', makePage('12A45678K'), CONTEXT);

    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence.motivo).toBe('rut_ilegible');
    expect(db.__selectCount()).toBe(0);
  });

  it('DV inválido (módulo 11): cola manual sin consultar la base', async () => {
    const db = makeDb([]);
    const resolver = new RutBubbleResolver(db);

    const candidate = await resolver.resolve('org-1', makePage('123456780'), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toEqual({ motivo: 'rut_dv_invalido', rut: '123456780' });
    expect(db.__selectCount()).toBe(0);
  });

  it('RUT válido sin match en el roster del curso: cola manual, JAMÁS matching difuso', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[rosterRow({ rut: '9.876.543-3', id: 'student-otro' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toEqual({ motivo: 'rut_sin_match', rut: '12345678-5' });
  });

  it('acepta el DV K, incluso en minúscula en la lectura', async () => {
    const resolver = new RutBubbleResolver(makeDb([[rosterRow({ rut: '20930578-K' })]]));

    const candidate = await resolver.resolve('org-1', makePage('20930578k'), CONTEXT);

    expect(candidate.studentId).toBe('student-1');
    expect(candidate.evidence.rut).toBe('20930578-K');
  });

  it('RUT de 7 dígitos marcado con cero a la izquierda hace match con el roster', async () => {
    const resolver = new RutBubbleResolver(makeDb([[rosterRow({ rut: '9876543-3' })]]));

    const candidate = await resolver.resolve('org-1', makePage('098765433'), CONTEXT);

    expect(candidate.studentId).toBe('student-1');
    expect(candidate.evidence.rut).toBe('9876543-3');
  });

  it('dos alumnos con el mismo RUT en el roster: cola manual con evidencia del conflicto', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[rosterRow(), rosterRow({ id: 'student-2', firstName: 'Beto' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toEqual({ motivo: 'rut_duplicado_en_roster', rut: '12345678-5' });
  });

  it('un RUT mal escrito en el roster no impide el match exacto con el resto', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[rosterRow({ id: 'student-sucio', rut: 'RUT PENDIENTE' }), rosterRow()]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.studentId).toBe('student-1');
  });
});
