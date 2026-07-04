import type { Database } from '@soe/db';
import { BankPassageService } from './bank-passage.service';

/** Mock de `Database`: cada `await` de la cadena consume el siguiente resultado de `queue`. */
function makeDb(queue: unknown[][]): Database {
  const pending = [...queue];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    chain[m] = () => chain;
  }
  (chain as { then?: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(pending.shift() ?? []).then(resolve, reject);

  return { select: () => chain } as unknown as Database;
}

describe('BankPassageService', () => {
  it('distinct por sección sobre el join sección↔ítems↔tags + preview de texto', async () => {
    // El join multiplica S1 por sus dos ítems publicados; debe colapsar a una ref.
    const rows = [
      {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        passageTitle: 'Lectura 1',
        passageText: 'contenido del pasaje uno',
      },
      {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        passageTitle: 'Lectura 1',
        passageText: 'contenido del pasaje uno',
      },
      {
        sectionId: 'S2',
        kind: 'passage',
        source: 'ai_generated',
        passageTitle: null,
        passageText: null,
      },
    ];

    const result = await new BankPassageService(makeDb([rows])).listCandidates(
      'org-1',
      'node-1',
    );

    expect(result).toEqual([
      {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        title: 'Lectura 1',
        textPreview: 'contenido del pasaje uno',
      },
      {
        sectionId: 'S2',
        kind: 'passage',
        source: 'ai_generated',
        title: null,
        textPreview: null,
      },
    ]);
  });

  it('devuelve [] si el nodo no tiene pasajes publicados', async () => {
    const result = await new BankPassageService(makeDb([[]])).listCandidates(
      'org-1',
      'node-1',
    );
    expect(result).toEqual([]);
  });
});
