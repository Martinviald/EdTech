import type { Database } from '@soe/db';
import { BankPassageService } from './bank-passage.service';

/**
 * Mock de `Database` (sin DATABASE_URL). Cada `await` de una query encadenada consume el
 * siguiente resultado de `queue`. `transaction` ejecuta el callback con el mismo mock (así
 * `withOrgContext` corre en memoria) y expone un spy. Orden de consumo en `listCandidates`:
 * [assessment, instrument, pasajes-del-banco].
 */
function makeDb(queue: unknown[][]): { db: Database; transaction: jest.Mock } {
  const pending = [...queue];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
    chain[m] = () => chain;
  }
  (chain as { then?: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(pending.shift() ?? []).then(resolve, reject);

  const db: Record<string, unknown> = { select: () => chain, execute: async () => [] };
  const transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  db.transaction = transaction;
  return { db: db as unknown as Database, transaction };
}

describe('BankPassageService', () => {
  it('distinct por sección + preview, filtrando por el grado del instrumento evaluado', async () => {
    // El join multiplica S1 por sus dos ítems publicados; debe colapsar a una ref.
    const bankRows = [
      { sectionId: 'S1', kind: 'passage', source: 'official', passageTitle: 'Lectura 1', passageText: 'contenido del pasaje uno' },
      { sectionId: 'S1', kind: 'passage', source: 'official', passageTitle: 'Lectura 1', passageText: 'contenido del pasaje uno' },
      { sectionId: 'S2', kind: 'passage', source: 'official', passageTitle: null, passageText: null },
    ];
    // Queue: assessment (instrumentId) → instrument (gradeId) → pasajes del banco.
    const { db, transaction } = makeDb([[{ instrumentId: 'inst-1' }], [{ gradeId: 'grade-2b' }], bankRows]);

    const result = await new BankPassageService(db).listCandidates('org-1', 'node-1', 'assess-1');

    expect(result).toEqual([
      { sectionId: 'S1', kind: 'passage', source: 'official', title: 'Lectura 1', textPreview: 'contenido del pasaje uno' },
      { sectionId: 'S2', kind: 'passage', source: 'official', title: null, textPreview: null },
    ]);
    // La lectura del grado (assessments, RLS) corre bajo withOrgContext (una transacción).
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('devuelve [] si no hay pasajes del banco en ese nivel', async () => {
    const { db } = makeDb([[{ instrumentId: 'inst-1' }], [{ gradeId: 'grade-2b' }], []]);
    const result = await new BankPassageService(db).listCandidates('org-1', 'node-1', 'assess-1');
    expect(result).toEqual([]);
  });

  it('sin grado derivable (assessment no visible) → no filtra por nivel y devuelve los del banco', async () => {
    const bankRows = [
      { sectionId: 'S1', kind: 'passage', source: 'official', passageTitle: 'Lectura 1', passageText: 'texto uno' },
    ];
    // assessment vacío → se omite la lectura del instrumento → el siguiente await es el banco.
    const { db } = makeDb([[], bankRows]);
    const result = await new BankPassageService(db).listCandidates('org-1', 'node-1', 'assess-1');
    expect(result).toEqual([
      { sectionId: 'S1', kind: 'passage', source: 'official', title: 'Lectura 1', textPreview: 'texto uno' },
    ]);
  });
});
