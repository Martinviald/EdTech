import type { Database } from '@soe/db';
import { aggregateItemStats, type ResponseForItemStats } from '@soe/types';
import { loadDevelopmentDistributions, loadItemDistributions } from './item-report-data';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: `select()` consume la siguiente respuesta de `selectResults`.
// Mismo estilo que item-analysis.service.spec.ts.
// ──────────────────────────────────────────────────────────────────────────────

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(selectResults: unknown[][]): Database {
  let idx = 0;
  function chain(rows: unknown[]): QueryBuilder {
    const c: QueryBuilder = {
      from: () => c,
      where: () => c,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return c;
  }
  return {
    select: () => chain(selectResults[idx++] ?? []),
  } as unknown as Database;
}

const ASSESSMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEV_ITEM = '11111111-1111-1111-1111-111111111111';
const CURSO_A = 'cg-a';
const CURSO_B = 'cg-b';

// ──────────────────────────────────────────────────────────────────────────────
// PARIDAD DE DESARROLLO — test diferencial contra el `case` SQL que reemplazamos.
//
// Referencia literal del SQL viejo de loadDevelopmentDistributions:
//   case
//     when coalesce(final_score, raw_score) is null then 'N'
//     when coalesce(final_score, raw_score) <= 0     then 'RI'
//     when coalesce(final_score, raw_score) >= max_score then 'RC'
//     else 'RPC'
//   end
// El orden de las ramas importa y se replica tal cual. Esto NO llama al código de
// producción: es la especificación vieja, escrita a mano, contra la que comparamos.
// ──────────────────────────────────────────────────────────────────────────────

type DevDist = { rc: number; rpc: number; ri: number; n: number };

function oldSqlDevelopmentDistribution(responses: readonly ResponseForItemStats[]): DevDist {
  const out: DevDist = { rc: 0, rpc: 0, ri: 0, n: 0 };
  for (const r of responses) {
    const score = r.finalScore ?? r.rawScore; // coalesce(final_score, raw_score)
    if (score == null) out.n += 1;
    else if (score <= 0) out.ri += 1;
    else if (score >= r.maxScore) out.rc += 1;
    else out.rpc += 1;
  }
  return out;
}

/** Ítem de desarrollo: sin alternativas → el read-model lo bucketiza por puntaje. */
function devResp(
  over: Partial<ResponseForItemStats> & { studentId: string },
): ResponseForItemStats {
  return {
    itemId: DEV_ITEM,
    value: { answer: null },
    isCorrect: null,
    rawScore: null,
    finalScore: null,
    maxScore: 2,
    hasAlternatives: false,
    ...over,
  };
}

/**
 * Corre el pipeline REAL de punta a punta: el escritor puro (`aggregateItemStats`)
 * produce las filas del read-model, se sirven por el mock de DB tal como saldrían de
 * `assessment_item_stats`, y el lector las recombina. Si el escritor y el lector
 * divergen en la semántica de los buckets, este helper lo delata.
 */
async function throughReadModel(
  responses: readonly ResponseForItemStats[],
  enrollment: ReadonlyMap<string, string>,
): Promise<DevDist> {
  const stats = aggregateItemStats(responses, enrollment);
  const rows = stats.map((s) => ({
    itemId: s.itemId,
    responseCount: s.responseCount,
    correctCount: s.correctCount,
    answerCounts: s.answerCounts,
  }));
  const db = makeDb([rows]);
  const dist = await loadDevelopmentDistributions(db, ASSESSMENT, [DEV_ITEM], null);
  return dist.get(DEV_ITEM) ?? { rc: 0, rpc: 0, ri: 0, n: 0 };
}

describe('loadDevelopmentDistributions — paridad con el `case` SQL viejo', () => {
  const enrollment = new Map([
    ['s1', CURSO_A],
    ['s2', CURSO_A],
    ['s3', CURSO_A],
    ['s4', CURSO_A],
    ['s5', CURSO_A],
    ['s6', CURSO_A],
    ['s7', CURSO_A],
  ]);

  // Cada caso cubre una rama distinta del case, incluidos los bordes.
  const responses: ResponseForItemStats[] = [
    devResp({ studentId: 's1', finalScore: 2 }), // score == max        → RC
    devResp({ studentId: 's2', finalScore: 3 }), // score > max          → RC
    devResp({ studentId: 's3', finalScore: 1 }), // 0 < score < max      → RPC
    devResp({ studentId: 's4', finalScore: 0 }), // score == 0           → RI
    devResp({ studentId: 's5', finalScore: -1 }), // score < 0           → RI
    devResp({ studentId: 's6' }), // sin puntaje                         → N
    devResp({ studentId: 's7', rawScore: 2, finalScore: null }), // cae a rawScore → RC
  ];

  it('coincide fila a fila con el case SQL en todas sus ramas', async () => {
    const expected = oldSqlDevelopmentDistribution(responses);
    expect(expected).toEqual({ rc: 3, rpc: 1, ri: 2, n: 1 });
    await expect(throughReadModel(responses, enrollment)).resolves.toEqual(expected);
  });

  it('finalScore gana sobre rawScore, igual que el coalesce(final, raw)', async () => {
    // El SQL coalesce toma final_score aunque raw_score diga otra cosa.
    const rs = [devResp({ studentId: 's1', rawScore: 0, finalScore: 2 })]; // → RC, no RI
    const expected = oldSqlDevelopmentDistribution(rs);
    expect(expected).toEqual({ rc: 1, rpc: 0, ri: 0, n: 0 });
    await expect(throughReadModel(rs, enrollment)).resolves.toEqual(expected);
  });

  it('maxScore 0: score 0 cae en RI antes que en RC (el orden del case manda)', async () => {
    const rs = [
      devResp({ studentId: 's1', finalScore: 0, maxScore: 0 }), // <= 0 gana → RI
      devResp({ studentId: 's2', finalScore: 1, maxScore: 0 }), // >= max    → RC
    ];
    const expected = oldSqlDevelopmentDistribution(rs);
    expect(expected).toEqual({ rc: 1, rpc: 0, ri: 1, n: 0 });
    await expect(throughReadModel(rs, enrollment)).resolves.toEqual(expected);
  });

  it('recombina cohortes sumando: el total por categoría es el del curso completo', async () => {
    // Dos cursos de N distinto. El SQL viejo agregaba sin distinguir curso, así que
    // la suma de las dos cohortes debe darle exactamente lo mismo.
    const rs = [
      devResp({ studentId: 'a1', finalScore: 2 }),
      devResp({ studentId: 'a2', finalScore: 1 }),
      devResp({ studentId: 'a3', finalScore: 0 }),
      devResp({ studentId: 'b1', finalScore: 2 }),
      devResp({ studentId: 'b2' }),
    ];
    const twoCourses = new Map([
      ['a1', CURSO_A],
      ['a2', CURSO_A],
      ['a3', CURSO_A],
      ['b1', CURSO_B],
      ['b2', CURSO_B],
    ]);
    const expected = oldSqlDevelopmentDistribution(rs);
    expect(expected).toEqual({ rc: 2, rpc: 1, ri: 1, n: 1 });
    await expect(throughReadModel(rs, twoCourses)).resolves.toEqual(expected);
  });

  it('rc+rpc+ri+n == responseCount (el denominador del caller no se descuadra)', async () => {
    const dist = await throughReadModel(responses, enrollment);
    expect(dist.rc + dist.rpc + dist.ri + dist.n).toBe(responses.length);
  });

  it('sin filas en el read-model → el ítem queda ausente (el caller pone su default)', async () => {
    const db = makeDb([[]]);
    const dist = await loadDevelopmentDistributions(db, ASSESSMENT, [DEV_ITEM], null);
    expect(dist.get(DEV_ITEM)).toBeUndefined();
  });

  it('filtro de cursos vacío → sin query y sin resultados', async () => {
    const db = makeDb([
      [{ itemId: DEV_ITEM, responseCount: 9, correctCount: 9, answerCounts: [] }],
    ]);
    const dist = await loadDevelopmentDistributions(db, ASSESSMENT, [DEV_ITEM], []);
    expect(dist.size).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// loadItemDistributions — selección múltiple
// ──────────────────────────────────────────────────────────────────────────────

describe('loadItemDistributions', () => {
  const MC_ITEM = '22222222-2222-2222-2222-222222222222';

  it('recombina cohortes sumando conteos, no promediando porcentajes', async () => {
    const db = makeDb([
      [
        // Curso grande: 9/10 correctas.
        {
          itemId: MC_ITEM,
          responseCount: 10,
          correctCount: 9,
          answerCounts: [
            { key: 'B', isCorrect: true, count: 9 },
            { key: 'A', isCorrect: false, count: 1 },
          ],
        },
        // Curso chico: 0/2 correctas, con un blanco.
        {
          itemId: MC_ITEM,
          responseCount: 2,
          correctCount: 0,
          answerCounts: [
            { key: 'A', isCorrect: false, count: 1 },
            { key: null, isCorrect: false, count: 1 },
          ],
        },
      ],
    ]);

    const dist = await loadItemDistributions(db, ASSESSMENT, [MC_ITEM], null);
    const d = dist.get(MC_ITEM)!;

    expect(d.totalResponses).toBe(12); // suma, incluye el blanco en el denominador
    expect(d.correctCount).toBe(9);
    expect(d.answeredCount).toBe(11); // 12 − 1 blanco
    expect(d.byAnswer.get('B')).toBe(9);
    expect(d.byAnswer.get('A')).toBe(2); // 1 + 1, sumados entre cohortes
    // El caller deriva blankCount = totalResponses − answeredCount = 1.
  });

  it('suma las variantes de isCorrect de una misma clave', async () => {
    // Dato inconsistente: la misma alternativa marcada correcta e incorrecta. El
    // `group by answer, is_correct` viejo también las traía separadas.
    const db = makeDb([
      [
        {
          itemId: MC_ITEM,
          responseCount: 5,
          correctCount: 3,
          answerCounts: [
            { key: 'A', isCorrect: true, count: 3 },
            { key: 'A', isCorrect: false, count: 2 },
          ],
        },
      ],
    ]);
    const d = (await loadItemDistributions(db, ASSESSMENT, [MC_ITEM], null)).get(MC_ITEM)!;
    expect(d.byAnswer.get('A')).toBe(5);
    expect(d.answeredCount).toBe(5);
    expect(d.correctCount).toBe(3);
  });

  it('sin ítems → sin query', async () => {
    const db = makeDb([[{ itemId: MC_ITEM, responseCount: 1, correctCount: 1, answerCounts: [] }]]);
    expect((await loadItemDistributions(db, ASSESSMENT, [], null)).size).toBe(0);
  });
});
