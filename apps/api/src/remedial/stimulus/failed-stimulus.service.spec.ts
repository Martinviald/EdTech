import type { Database } from '@soe/db';
import { FailedStimulusService } from './failed-stimulus.service';

/**
 * Mock de `Database` para tests unitarios (sin DATABASE_URL). Cada `await` de una query
 * encadenada consume el siguiente resultado de `queue` en orden. `transaction` ejecuta el
 * callback con el mismo mock (así `withOrgContext` corre en memoria) y expone un spy.
 */
function makeDb(queue: unknown[][]): { db: Database; transaction: jest.Mock } {
  const pending = [...queue];
  const chain: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'where',
    'groupBy',
    'orderBy',
    'limit',
    'offset',
  ]) {
    chain[m] = () => chain;
  }
  (chain as { then?: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(pending.shift() ?? []).then(resolve, reject);

  const db: Record<string, unknown> = {
    select: () => chain,
    execute: async () => [],
  };
  const transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  db.transaction = transaction;
  return { db: db as unknown as Database, transaction };
}

describe('FailedStimulusService', () => {
  it('dedup por sección (peor ítem) + orden por brecha desc + posiciones ordenadas', async () => {
    const taggedItems = [
      { itemId: 'iA', position: 2, sectionId: 'S1' },
      { itemId: 'iB', position: 1, sectionId: 'S1' },
      { itemId: 'iC', position: 3, sectionId: 'S2' },
    ];
    const rateRows = [
      { itemId: 'iA', total: 10, correct: 2 }, // gap 80
      { itemId: 'iB', total: 10, correct: 5 }, // gap 50
      { itemId: 'iC', total: 10, correct: 9 }, // gap 10
    ];
    const sections = [
      {
        id: 'S1',
        kind: 'passage',
        source: 'official',
        passageTitle: 'T1',
        passageText: 'texto uno',
        passageFormat: 'plain',
      },
      {
        id: 'S2',
        kind: 'passage',
        source: 'official',
        passageTitle: 'T2',
        passageText: 'texto dos',
        passageFormat: 'markdown',
      },
    ];
    const { db, transaction } = makeDb([taggedItems, rateRows, sections]);

    const result = await new FailedStimulusService(db).list('org-1', 'assess-1', 'node-1');

    expect(result).toEqual([
      {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        title: 'T1',
        text: 'texto uno',
        textType: 'plain',
        itemPositions: [1, 2], // agregadas de iA(2) + iB(1), ordenadas
        gap: 80, // peor ítem del pasaje (max de 80/50)
      },
      {
        sectionId: 'S2',
        kind: 'passage',
        source: 'official',
        title: 'T2',
        text: 'texto dos',
        textType: 'markdown',
        itemPositions: [3],
        gap: 10,
      },
    ]);
    // Las respuestas se leyeron bajo withOrgContext (una transacción).
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('excluye ítems sin respuestas en la evaluación y secciones que no son pasaje', async () => {
    const taggedItems = [
      { itemId: 'iA', position: 1, sectionId: 'S1' }, // pasaje, con respuestas
      { itemId: 'iD', position: 2, sectionId: 'S3' }, // sin respuestas → excluido
      { itemId: 'iE', position: 3, sectionId: 'S4' }, // con respuestas pero S4 no es pasaje
      { itemId: 'iF', position: 4, sectionId: null }, // autocontenido → excluido
    ];
    const rateRows = [
      { itemId: 'iA', total: 10, correct: 3 }, // gap 70
      { itemId: 'iE', total: 10, correct: 4 }, // gap 60 (pero S4 no vuelve como pasaje)
    ];
    // La query de secciones (kind='passage') no devuelve S4 ni S3.
    const sections = [
      {
        id: 'S1',
        kind: 'passage',
        source: 'official',
        passageTitle: 'T1',
        passageText: 'texto uno',
        passageFormat: 'plain',
      },
    ];
    const { db } = makeDb([taggedItems, rateRows, sections]);

    const result = await new FailedStimulusService(db).list('org-1', 'assess-1', 'node-1');

    expect(result).toEqual([
      {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        title: 'T1',
        text: 'texto uno',
        textType: 'plain',
        itemPositions: [1],
        gap: 70,
      },
    ]);
  });

  it('devuelve [] si el nodo no tiene ítems con sección', async () => {
    const { db } = makeDb([[]]); // taggedItems vacío
    const result = await new FailedStimulusService(db).list('org-1', 'assess-1', 'node-1');
    expect(result).toEqual([]);
  });

  it('devuelve [] si ningún ítem tiene respuestas en la evaluación', async () => {
    const taggedItems = [{ itemId: 'iA', position: 1, sectionId: 'S1' }];
    const { db } = makeDb([taggedItems, []]); // rateRows vacío
    const result = await new FailedStimulusService(db).list('org-1', 'assess-1', 'node-1');
    expect(result).toEqual([]);
  });
});
