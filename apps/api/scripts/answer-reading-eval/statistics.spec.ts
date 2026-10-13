import {
  mcnemarExact,
  normalizeWrittenText,
  proportion,
  textSimilarity,
  wilsonInterval,
} from './statistics';

describe('estadística del arnés', () => {
  it('Wilson da el intervalo conocido para 0/10 y para la línea base 15/72', () => {
    const [low, high] = wilsonInterval(0, 10) ?? [NaN, NaN];
    expect(low).toBe(0);
    expect(high).toBeCloseTo(0.2775, 4);
    const [baseLow, baseHigh] = wilsonInterval(15, 72) ?? [NaN, NaN];
    expect(baseLow).toBeCloseTo(0.1309, 3);
    expect(baseHigh).toBeCloseTo(0.3158, 3);
    expect(wilsonInterval(10, 10)?.[1]).toBeCloseTo(1, 12);
  });

  it('Wilson sin observaciones no da intervalo ni tasa', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(proportion(0, 0)).toEqual({ count: 0, total: 0, rate: null, ci95: null });
  });

  it('McNemar exacto coincide con la binomial bilateral', () => {
    expect(mcnemarExact(0, 0).pValue).toBe(1);
    expect(mcnemarExact(1, 5).pValue).toBeCloseTo(0.21875, 10);
    expect(mcnemarExact(5, 1).pValue).toBeCloseTo(0.21875, 10);
    expect(mcnemarExact(3, 20).pValue).toBeCloseTo((2 * 2048) / 2 ** 23, 12);
    expect(mcnemarExact(4, 4).pValue).toBe(1);
    expect(mcnemarExact(3, 20).discordant).toBe(23);
  });

  it('la similitud de texto ignora tildes, mayúsculas, espacios y la notación de × y ⇒', () => {
    expect(normalizeWrittenText('Triángulo  ⇒ 3 × 2')).toBe('triangulo => 3 x 2');
    expect(textSimilarity('Pago $10.500', 'pago $10.500')).toBe(1);
    expect(textSimilarity('decenes', 'decenas')).toBeCloseTo(1 - 1 / 7, 10);
    expect(textSimilarity('', '')).toBe(1);
    expect(textSimilarity('', 'abc')).toBe(0);
  });
});
