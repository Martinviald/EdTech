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

  it('sin flag del informe, la correcta la da la PAUTA DEL INSTRUMENTO (selección múltiple)', () => {
    // El caso real: la negrita no es recuperable, así que el informe NO trae isCorrect.
    // La clave viene del instrumento. Sin esto, ningún bucket MC matchearía → 0 aciertos.
    expect(isCorrectBucket({ key: 'C', pct: 90.7 }, 'C')).toBe(true);
    expect(isCorrectBucket({ key: 'A', pct: 4.65 }, 'C')).toBe(false);
    // El flag explícito del informe, si viniera, sigue teniendo precedencia sobre la pauta.
    expect(isCorrectBucket({ key: 'A', pct: 4.65, isCorrect: true }, 'C')).toBe(true);
  });

  it('bucketCredit da 1 a la alternativa correcta del instrumento y 0 al distractor', () => {
    expect(bucketCredit({ key: 'C', pct: 90.7 }, 'C')).toBe(1);
    expect(bucketCredit({ key: 'A', pct: 4.65 }, 'C')).toBe(0);
  });
});

describe('translateReportToItemStats — clave desde el instrumento (sin negrita en el informe)', () => {
  it('reproduce correctCount/scoreSum usando la pauta del instrumento, no el flag del informe', () => {
    // Informe SIN isCorrect en los buckets (como los JSON reales que extrae la skill),
    // e instrumento CON la pauta. El resultado debe ser idéntico al del informe que sí
    // trae la negrita: la clave la pone el instrumento.
    const sinNegrita = TABLA_1.map((item) => ({
      ...item,
      distribution: item.distribution.map(({ isCorrect: _drop, ...b }) => b),
    }));
    const conInstrumento = translateReportToItemStats(
      buildReport({ items: sinNegrita }),
      ITEMS_BY_POSITION,
      CURSO,
    );
    const conNegrita = translateReportToItemStats(buildReport(), ITEMS_BY_POSITION, CURSO);

    // Fila a fila: mismo correctCount y scoreSum por ambos caminos.
    for (const a of conInstrumento.itemStats) {
      const b = conNegrita.itemStats.find((s) => s.itemId === a.itemId)!;
      expect(a.correctCount).toBe(b.correctCount);
      expect(a.scoreSum).toBe(b.scoreSum);
    }
    // Y no es trivialmente cero: P4 (C correcta, 90.70%) → 39 aciertos sobre 43.
    const p4 = conInstrumento.itemStats.find((s) => s.itemId === ITEMS_BY_POSITION.get(4)!.id)!;
    expect(p4.correctCount).toBe(39);
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
    const items = new Map([[14, { id: 'i14', position: 14, points: 2, correctKey: null }]]);
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
