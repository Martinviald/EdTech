import {
  aggregateCohortSkillStats,
  aggregateItemStats,
  classifyDevelopmentResponse,
  deriveSkillStatsFromItemStats,
  extractRawAnswer,
  mergeAnswerCounts,
  reconstructCountsFromPercentages,
  type ItemCohortStats,
  type ResponseForItemStats,
} from './item-stats-calculator';

const CURSO_A = 'cg-a';
const CURSO_B = 'cg-b';

function resp(over: Partial<ResponseForItemStats> & Pick<ResponseForItemStats, 'studentId'>) {
  return {
    itemId: 'i1',
    value: { raw: 'A' },
    isCorrect: true,
    rawScore: 1,
    maxScore: 1,
    hasAlternatives: true,
    ...over,
  } satisfies ResponseForItemStats;
}

/** Respuesta a un ítem de desarrollo: sin alternativas, se bucketiza por puntaje. */
function devResp(studentId: string, score: number | null, maxScore = 2): ResponseForItemStats {
  return {
    studentId,
    itemId: 'dev1',
    value: {},
    isCorrect: score != null && score >= maxScore,
    rawScore: score,
    maxScore,
    hasAlternatives: false,
  };
}

describe('extractRawAnswer', () => {
  // Réplica de nullif(coalesce(value->>'raw', value->>'key', value->>'answer'), '').
  // Si esta precedencia se mueve, la distribución y las celdas de la matriz dejan de
  // reportar la misma alternativa.
  it('respeta la precedencia raw > key > answer', () => {
    expect(extractRawAnswer({ raw: 'A', key: 'B', answer: 'C' })).toBe('A');
    expect(extractRawAnswer({ key: 'B', answer: 'C' })).toBe('B');
    expect(extractRawAnswer({ answer: 'C' })).toBe('C');
  });

  it('cae al siguiente campo con null, igual que coalesce', () => {
    expect(extractRawAnswer({ raw: null, key: 'B' })).toBe('B');
    expect(extractRawAnswer({ raw: undefined, key: 'B' })).toBe('B');
  });

  it('castea no-strings a texto, como ->>', () => {
    expect(extractRawAnswer({ raw: 3 })).toBe('3');
    expect(extractRawAnswer({ raw: false })).toBe('false');
  });

  it("trata el string vacío como blanco, igual que nullif(..., '')", () => {
    expect(extractRawAnswer({ raw: '' })).toBeNull();
  });

  it('devuelve null para value ausente o vacío', () => {
    expect(extractRawAnswer(null)).toBeNull();
    expect(extractRawAnswer(undefined)).toBeNull();
    expect(extractRawAnswer({})).toBeNull();
  });
});

describe('aggregateItemStats', () => {
  const enrollment = new Map([
    ['s1', CURSO_A],
    ['s2', CURSO_A],
    ['s3', CURSO_A],
  ]);

  it('cuenta correctas, respuestas y buckets por alternativa', () => {
    const out = aggregateItemStats(
      [
        resp({ studentId: 's1', value: { raw: 'A' }, isCorrect: true }),
        resp({ studentId: 's2', value: { raw: 'B' }, isCorrect: false, rawScore: 0 }),
        resp({ studentId: 's3', value: { raw: 'A' }, isCorrect: true }),
      ],
      enrollment,
    );

    expect(out).toHaveLength(1);
    const st = out[0]!;
    expect(st.classGroupId).toBe(CURSO_A);
    expect(st.responseCount).toBe(3);
    expect(st.correctCount).toBe(2);
    expect(st.studentCount).toBe(3);
    expect(st.scoreSum).toBe(2);
    expect(st.maxSum).toBe(3);
    expect(st.answerCounts).toEqual([
      { key: 'A', count: 2, isCorrect: true },
      { key: 'B', count: 1, isCorrect: false },
    ]);
  });

  it('agrupa los blancos en un bucket key=null y los ordena al final', () => {
    const out = aggregateItemStats(
      [
        resp({ studentId: 's1', value: {}, isCorrect: false, rawScore: 0 }),
        resp({ studentId: 's2', value: { raw: '' }, isCorrect: false, rawScore: 0 }),
        resp({ studentId: 's3', value: { raw: 'A' }, isCorrect: true }),
      ],
      enrollment,
    );

    expect(out[0]!.answerCounts).toEqual([
      { key: 'A', count: 1, isCorrect: true },
      { key: null, count: 2, isCorrect: false },
    ]);
    // El blanco entra en el denominador — igual que el totalResponses actual.
    expect(out[0]!.responseCount).toBe(3);
  });

  it('separa por curso y mantiene el N de cada cohorte', () => {
    const out = aggregateItemStats(
      [resp({ studentId: 's1' }), resp({ studentId: 's2' }), resp({ studentId: 'x1' })],
      new Map([
        ['s1', CURSO_A],
        ['s2', CURSO_A],
        ['x1', CURSO_B],
      ]),
    );

    expect(out).toHaveLength(2);
    expect(out.find((o) => o.classGroupId === CURSO_A)!.studentCount).toBe(2);
    expect(out.find((o) => o.classGroupId === CURSO_B)!.studentCount).toBe(1);
  });

  it('el N de la cohorte es constante entre ítems del mismo curso', () => {
    // s3 solo respondió i1. El N del curso sigue siendo 3 en ambos ítems, pero el
    // responseCount de i2 baja a 2. Esa distinción es la razón de tener dos campos.
    const out = aggregateItemStats(
      [
        resp({ studentId: 's1', itemId: 'i1' }),
        resp({ studentId: 's2', itemId: 'i1' }),
        resp({ studentId: 's3', itemId: 'i1' }),
        resp({ studentId: 's1', itemId: 'i2' }),
        resp({ studentId: 's2', itemId: 'i2' }),
      ],
      enrollment,
    );

    const i2 = out.find((o) => o.itemId === 'i2')!;
    expect(i2.studentCount).toBe(3);
    expect(i2.responseCount).toBe(2);
  });

  it('descarta respuestas de alumnos sin matrícula (no se les puede asignar cohorte)', () => {
    const out = aggregateItemStats([resp({ studentId: 'fantasma' })], enrollment);
    expect(out).toEqual([]);
  });

  it('finalScore tiene precedencia sobre rawScore', () => {
    const out = aggregateItemStats(
      [resp({ studentId: 's1', rawScore: 0, finalScore: 1 })],
      enrollment,
    );
    expect(out[0]!.scoreSum).toBe(1);
  });

  it('una respuesta sin puntaje cuenta 0, no rompe', () => {
    const out = aggregateItemStats(
      [resp({ studentId: 's1', rawScore: null, finalScore: null, isCorrect: null })],
      enrollment,
    );
    expect(out[0]!.scoreSum).toBe(0);
    expect(out[0]!.correctCount).toBe(0);
  });
});

describe('ítems de desarrollo — buckets RC/RPC/RI/N', () => {
  const enrollment = new Map([
    ['s1', CURSO_A],
    ['s2', CURSO_A],
    ['s3', CURSO_A],
    ['s4', CURSO_A],
  ]);

  it('replica el case SQL de loadDevelopmentDistributions', () => {
    // score null → N (null) · <= 0 → RI · >= max → RC · resto → RPC.
    expect(
      classifyDevelopmentResponse({ rawScore: null, finalScore: null, maxScore: 2 }),
    ).toBeNull();
    expect(classifyDevelopmentResponse({ rawScore: 0, finalScore: null, maxScore: 2 })).toBe('RI');
    expect(classifyDevelopmentResponse({ rawScore: 2, finalScore: null, maxScore: 2 })).toBe('RC');
    expect(classifyDevelopmentResponse({ rawScore: 1, finalScore: null, maxScore: 2 })).toBe('RPC');
    // finalScore gana sobre rawScore, igual que el coalesce del SQL.
    expect(classifyDevelopmentResponse({ rawScore: 0, finalScore: 2, maxScore: 2 })).toBe('RC');
  });

  it('separa RC/RPC/RI/N en answerCounts en vez de colapsarlos en blancos', () => {
    // Es la razón de ser de `hasAlternatives`: sin él, extractRawAnswer devolvería
    // null para los cuatro y todo el desarrollo caería en un único bucket.
    const out = aggregateItemStats(
      [devResp('s1', 2), devResp('s2', 1), devResp('s3', 0), devResp('s4', null)],
      enrollment,
    );

    expect(out[0]!.answerCounts).toEqual([
      { key: 'RC', count: 1, isCorrect: true },
      { key: 'RI', count: 1, isCorrect: false },
      { key: 'RPC', count: 1, isCorrect: false },
      { key: null, count: 1, isCorrect: false },
    ]);
  });

  it('desambigua lo que scoreSum/maxSum no puede: 3 RC + 3 RI vs 6 RPC', () => {
    // Ambos escenarios dan scoreSum=3, maxSum=6, responseCount=6. Los marginales
    // coinciden y la distribución no: por eso los buckets categóricos son
    // necesarios y no un lujo.
    const seisEstudiantes = new Map(
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((s) => [s, CURSO_A] as const),
    );

    const rcRi = aggregateItemStats(
      [
        devResp('a1', 1, 1),
        devResp('a2', 1, 1),
        devResp('a3', 1, 1),
        devResp('a4', 0, 1),
        devResp('a5', 0, 1),
        devResp('a6', 0, 1),
      ],
      seisEstudiantes,
    )[0]!;

    const todosRpc = aggregateItemStats(
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((s) => devResp(s, 0.5, 1)),
      seisEstudiantes,
    )[0]!;

    // Marginales idénticos...
    expect(rcRi.scoreSum).toBe(3);
    expect(todosRpc.scoreSum).toBe(3);
    expect(rcRi.maxSum).toBe(todosRpc.maxSum);
    expect(rcRi.responseCount).toBe(todosRpc.responseCount);
    // ...distribuciones distintas.
    expect(rcRi.answerCounts).not.toEqual(todosRpc.answerCounts);
    expect(todosRpc.answerCounts).toEqual([{ key: 'RPC', count: 6, isCorrect: false }]);
  });
});

describe('mergeAnswerCounts', () => {
  it('SUMA conteos entre cohortes; no promedia porcentajes', () => {
    // 2 cursos de N distinto: 30/40 y 15/60. Agregado real = 45/100 = 45%.
    // El promedio de porcentajes daría (75 + 25) / 2 = 50%, que no corresponde a
    // ninguna población real. Por eso el read-model guarda conteos.
    const merged = mergeAnswerCounts([
      [
        { key: 'A', count: 30, isCorrect: true },
        { key: 'B', count: 10, isCorrect: false },
      ],
      [
        { key: 'A', count: 15, isCorrect: true },
        { key: 'B', count: 45, isCorrect: false },
      ],
    ]);

    expect(merged).toEqual([
      { key: 'A', count: 45, isCorrect: true },
      { key: 'B', count: 55, isCorrect: false },
    ]);
    const total = merged.reduce((a, b) => a + b.count, 0);
    const correct = merged.filter((b) => b.isCorrect).reduce((a, b) => a + b.count, 0);
    expect((correct / total) * 100).toBe(45);
  });

  it('mantiene separados los buckets con la misma clave y distinto isCorrect', () => {
    const merged = mergeAnswerCounts([
      [{ key: 'A', count: 2, isCorrect: true }],
      [{ key: 'A', count: 3, isCorrect: false }],
    ]);
    expect(merged).toHaveLength(2);
  });

  it('los blancos se recombinan y quedan al final', () => {
    const merged = mergeAnswerCounts([
      [{ key: null, count: 2, isCorrect: false }],
      [
        { key: null, count: 1, isCorrect: false },
        { key: 'A', count: 5, isCorrect: true },
      ],
    ]);
    expect(merged).toEqual([
      { key: 'A', count: 5, isCorrect: true },
      { key: null, count: 3, isCorrect: false },
    ]);
  });
});

describe('aggregateCohortSkillStats', () => {
  const enrollment = new Map([
    ['s1', CURSO_A],
    ['s2', CURSO_A],
  ]);

  it('promedia los porcentajes POR ALUMNO (decisión §9.2: no mover números vivos)', () => {
    const out = aggregateCohortSkillStats(
      [
        { studentId: 's1', nodeId: 'n1', correctCount: 4, totalCount: 4, percentage: 1 },
        { studentId: 's2', nodeId: 'n1', correctCount: 1, totalCount: 4, percentage: 0.25 },
      ],
      enrollment,
    );

    expect(out).toHaveLength(1);
    // Media de porcentajes por alumno = (1 + 0.25) / 2 = 0.625.
    // La tasa agrupada daría 5/8 = 0.625 también acá; divergen cuando los
    // denominadores por alumno difieren (ver el test siguiente).
    expect(out[0]!.percentage).toBeCloseTo(0.625, 6);
    expect(out[0]!.correctCount).toBe(5);
    expect(out[0]!.totalCount).toBe(8);
    expect(out[0]!.studentCount).toBe(2);
  });

  it('diverge de la tasa agrupada cuando los alumnos responden distinta cantidad', () => {
    const out = aggregateCohortSkillStats(
      [
        { studentId: 's1', nodeId: 'n1', correctCount: 1, totalCount: 1, percentage: 1 },
        { studentId: 's2', nodeId: 'n1', correctCount: 1, totalCount: 4, percentage: 0.25 },
      ],
      enrollment,
    );
    // Media por alumno = 0.625. Tasa agrupada sería 2/5 = 0.4. Documentamos que
    // conservamos la primera a propósito.
    expect(out[0]!.percentage).toBeCloseTo(0.625, 6);
  });

  it('ignora percentage null al promediar', () => {
    const out = aggregateCohortSkillStats(
      [
        { studentId: 's1', nodeId: 'n1', correctCount: 1, totalCount: 1, percentage: 1 },
        { studentId: 's2', nodeId: 'n1', correctCount: 0, totalCount: 0, percentage: null },
      ],
      enrollment,
    );
    expect(out[0]!.percentage).toBe(1);
  });
});

describe('reconstructCountsFromPercentages', () => {
  // Datos REALES del informe oficial RBD25520_DIA_LECTURA_3_A_..._Cierre_2025.pdf,
  // Tabla 1, N=43. Es la premisa que sostiene todo el importador: si los conteos
  // reconstruidos no suman N, el informe está mal leído. Ver §2.2 del plan.
  const N = 43;
  const TABLA_1: Record<string, number[]> = {
    'P4 (MC)': [4.65, 2.33, 90.7, 2.33],
    'P7 (MC)': [81.4, 9.3, 9.3, 0.0],
    'P8 (MC)': [30.23, 11.63, 55.81, 2.33],
    'P1 (MC)': [97.67, 0.0, 2.33, 0.0],
    'P11 (MC)': [20.93, 18.6, 58.14, 2.33],
    'P22 (desarrollo)': [83.72, 16.28],
    'P14 (desarrollo)': [55.81, 41.86, 2.33],
    'P19 (desarrollo)': [48.84, 48.84, 2.33],
  };

  it.each(Object.entries(TABLA_1))('reconstruye %s sumando exactamente N', (_label, pcts) => {
    const counts = reconstructCountsFromPercentages(pcts, N);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(N);
  });

  it('reconstruye los conteos exactos de P4', () => {
    expect(reconstructCountsFromPercentages(TABLA_1['P4 (MC)']!, N)).toEqual([2, 1, 39, 1]);
  });
});

describe('deriveSkillStatsFromItemStats', () => {
  function stat(over: Partial<ItemCohortStats> & Pick<ItemCohortStats, 'itemId'>): ItemCohortStats {
    return {
      classGroupId: CURSO_A,
      studentCount: 43,
      responseCount: 43,
      correctCount: 0,
      answerCounts: [],
      scoreSum: 0,
      maxSum: 43,
      ...over,
    };
  }

  it('reproduce el eje Localizar del informe oficial 3°A Cierre 2025 (77.67%)', () => {
    // Localizar = P4, P7, P8, P9, P15. Conteos de correctas reconstruidos de la Tabla 1.
    const itemStats = [
      stat({ itemId: 'p4', correctCount: 39, scoreSum: 39 }),
      stat({ itemId: 'p7', correctCount: 35, scoreSum: 35 }),
      stat({ itemId: 'p8', correctCount: 24, scoreSum: 24 }),
      stat({ itemId: 'p9', correctCount: 39, scoreSum: 39 }),
      stat({ itemId: 'p15', correctCount: 30, scoreSum: 30 }),
    ];
    const tags = new Map([
      ['p4', ['localizar']],
      ['p7', ['localizar']],
      ['p8', ['localizar']],
      ['p9', ['localizar']],
      ['p15', ['localizar']],
    ]);

    const out = deriveSkillStatsFromItemStats(itemStats, tags);
    expect(out).toHaveLength(1);
    // El informe reporta 77.67. 167/215 = 0.77674...
    expect(out[0]!.percentage! * 100).toBeCloseTo(77.67, 1);
    expect(out[0]!.studentCount).toBe(43);
  });

  it('reproduce el eje Reflexionar con crédito parcial RPC=0.5 (75.00%)', () => {
    // Reflexionar = P14 y P19, ambas de desarrollo. P14: RC 24, RPC 18 → 24 + 9 = 33.
    // P19: RC 21, RPC 21 → 21 + 10.5 = 31.5. Total 64.5 / 86 = 75.00% exacto.
    // Que esto cuadre es lo que valida, de una sola vez, el etiquetado de taxonomía,
    // el scoring config y la reconstrucción de conteos.
    const itemStats = [
      stat({ itemId: 'p14', correctCount: 24, scoreSum: 33 }),
      stat({ itemId: 'p19', correctCount: 21, scoreSum: 31.5 }),
    ];
    const tags = new Map([
      ['p14', ['reflexionar']],
      ['p19', ['reflexionar']],
    ]);

    const out = deriveSkillStatsFromItemStats(itemStats, tags);
    expect(out[0]!.percentage! * 100).toBeCloseTo(75.0, 2);
  });

  it('un ítem con N tags suma a los N ejes', () => {
    const out = deriveSkillStatsFromItemStats(
      [stat({ itemId: 'p1', correctCount: 40, scoreSum: 40 })],
      new Map([['p1', ['eje-a', 'eje-b']]]),
    );
    expect(out.map((o) => o.nodeId).sort()).toEqual(['eje-a', 'eje-b']);
  });

  it('ignora ítems sin tags', () => {
    const out = deriveSkillStatsFromItemStats([stat({ itemId: 'sin-tag' })], new Map());
    expect(out).toEqual([]);
  });

  it('devuelve percentage null si no hay puntaje posible', () => {
    const out = deriveSkillStatsFromItemStats(
      [stat({ itemId: 'p1', maxSum: 0, scoreSum: 0 })],
      new Map([['p1', ['n1']]]),
    );
    expect(out[0]!.percentage).toBeNull();
  });
});
