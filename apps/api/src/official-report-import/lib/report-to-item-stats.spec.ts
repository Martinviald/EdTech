import { bucketCredit, isCorrectBucket, translateReportToItemStats } from './report-to-item-stats';
import { ITEMS_BY_POSITION, N_3A, TABLA_1, buildReport } from './fixtures/informe-3a-cierre-2025';

const CURSO = 'cg-3a';

describe('isCorrectBucket', () => {
  it('respeta el flag explícito del informe (la negrita de la alternativa)', () => {
    expect(isCorrectBucket({ key: 'C', pct: 90.7, isCorrect: true })).toBe(true);
    expect(isCorrectBucket({ key: 'A', pct: 4.65, isCorrect: false })).toBe(false);
  });

  it('sin flag, RC es la respuesta correcta', () => {
    expect(isCorrectBucket({ key: 'RC', pct: 55.81 })).toBe(true);
  });

  it('RPC NO es correcta: aporta puntaje, no acierto', () => {
    // Espeja el flujo computed, donde responses.is_correct de una parcial es false.
    expect(isCorrectBucket({ key: 'RPC', pct: 41.86 })).toBe(false);
  });
});

describe('bucketCredit', () => {
  it('aplica el crédito parcial 0.5 a RPC', () => {
    expect(bucketCredit({ key: 'RPC', pct: 41.86 })).toBe(0.5);
  });

  it('RC vale entero y RI/N valen cero', () => {
    expect(bucketCredit({ key: 'RC', pct: 55.81 })).toBe(1);
    expect(bucketCredit({ key: 'RI', pct: 2.33 })).toBe(0);
    expect(bucketCredit({ key: 'N', pct: 2.33 })).toBe(0);
  });

  it('una alternativa de selección múltiple vale por su isCorrect', () => {
    expect(bucketCredit({ key: 'C', pct: 90.7, isCorrect: true })).toBe(1);
    expect(bucketCredit({ key: 'A', pct: 4.65, isCorrect: false })).toBe(0);
  });

  it('el bucket puede sobreescribir el crédito sin tocar código', () => {
    // El 0.5 es convención del informe, no del ítem: otro instrumento puede traer otra.
    expect(bucketCredit({ key: 'RPC', pct: 41.86, credit: 0.25 })).toBe(0.25);
  });
});

describe('translateReportToItemStats', () => {
  it('reconstruye los conteos exactos de P4 y los ordena con el blanco al final', () => {
    const out = translateReportToItemStats(buildReport(), ITEMS_BY_POSITION, CURSO);
    const p4 = out.translations.find((t) => t.position === 4)!;

    expect(p4.answerCounts).toEqual([
      { key: 'A', count: 2, isCorrect: false },
      { key: 'B', count: 1, isCorrect: false },
      { key: 'C', count: 39, isCorrect: true },
      // "N" del informe = blanco del read-model, y va al final igual que en `computed`.
      { key: null, count: 1, isCorrect: false },
    ]);
    expect(p4.countsSum).toBe(N_3A);
    expect(p4.countsMatchStudentCount).toBe(true);
  });

  it('los conteos de TODAS las preguntas del informe real suman exactamente N', () => {
    const out = translateReportToItemStats(buildReport(), ITEMS_BY_POSITION, CURSO);
    expect(out.countMismatchPositions).toEqual([]);
    for (const t of out.translations) {
      expect(t.countsSum).toBe(N_3A);
    }
  });

  it('aplica crédito parcial en P14: 24 RC + 18 RPC → scoreSum 33', () => {
    const out = translateReportToItemStats(buildReport(), ITEMS_BY_POSITION, CURSO);
    const p14 = out.itemStats.find((s) => s.itemId === ITEMS_BY_POSITION.get(14)!.id)!;

    expect(p14.correctCount).toBe(24); // solo RC
    expect(p14.scoreSum).toBe(33); // 24*1 + 18*0.5 + 1*0
    expect(p14.maxSum).toBe(43); // N × 1 punto
    expect(p14.responseCount).toBe(43);
    expect(p14.studentCount).toBe(43);
  });

  it('P19: 21 RC + 21 RPC → scoreSum 31.5 (medio punto, con decimal)', () => {
    const out = translateReportToItemStats(buildReport(), ITEMS_BY_POSITION, CURSO);
    const p19 = out.itemStats.find((s) => s.itemId === ITEMS_BY_POSITION.get(19)!.id)!;
    expect(p19.scoreSum).toBe(31.5);
  });

  it('escala el puntaje por los points del ítem, no asume 1', () => {
    const items = new Map([[14, { id: 'i14', position: 14, points: 2 }]]);
    const out = translateReportToItemStats(
      buildReport({ items: [TABLA_1.find((i) => i.position === 14)!] }),
      items,
      CURSO,
    );
    expect(out.itemStats[0]!.scoreSum).toBe(66); // 33 × 2
    expect(out.itemStats[0]!.maxSum).toBe(86); // 43 × 2
  });

  it('reporta la posición sin ítem en el instrumento y no la traduce (gate #2)', () => {
    const items = new Map([[4, ITEMS_BY_POSITION.get(4)!]]);
    const out = translateReportToItemStats(
      buildReport({ items: TABLA_1.filter((i) => i.position === 4 || i.position === 7) }),
      items,
      CURSO,
    );

    expect(out.unresolvedPositions).toEqual([7]);
    expect(out.itemStats).toHaveLength(1);
    expect(out.translations.find((t) => t.position === 7)!.stats).toBeNull();
  });

  it('reporta el descuadre de conteos SIN repartir la diferencia (gate #1)', () => {
    // Porcentajes que reconstruyen 42, no 43: un PDF mal leído. El importador lo
    // delata; "arreglarlo" repartiendo el resto enmascararía el error de extracción.
    const out = translateReportToItemStats(
      buildReport({
        items: [
          {
            position: 4,
            distribution: [
              { key: 'A', pct: 4.65 },
              { key: 'B', pct: 2.33 },
              { key: 'C', pct: 88.37, isCorrect: true },
              { key: 'N', pct: 2.33 },
            ],
          },
        ],
      }),
      ITEMS_BY_POSITION,
      CURSO,
    );

    expect(out.countMismatchPositions).toEqual([4]);
    expect(out.translations[0]!.countsSum).toBe(42);
    expect(out.translations[0]!.countsMatchStudentCount).toBe(false);
  });
});
