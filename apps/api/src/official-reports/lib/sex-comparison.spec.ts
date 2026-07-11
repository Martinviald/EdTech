import { compareSexes, MIN_GROUP_N } from './sex-comparison';

describe('compareSexes (TKT-25 Tablas 1.5–1.8)', () => {
  const big = (v: number, n = MIN_GROUP_N) => Array.from({ length: n }, () => v);

  it('marca insufficient_sample cuando un grupo no alcanza el mínimo', () => {
    const out = compareSexes(big(80, MIN_GROUP_N - 1), big(50));
    expect(out.result).toBe('insufficient_sample');
    // Aun así reporta los promedios y N calculables.
    expect(out.femaleN).toBe(MIN_GROUP_N - 1);
    expect(out.maleN).toBe(MIN_GROUP_N);
  });

  it('marca insufficient_sample cuando ambos grupos están vacíos', () => {
    const out = compareSexes([], []);
    expect(out.result).toBe('insufficient_sample');
    expect(out.femaleAvg).toBeNull();
    expect(out.maleAvg).toBeNull();
  });

  it('detecta diferencia significativa a favor de mujeres (+M)', () => {
    // Mujeres claramente por encima, con dispersión pequeña → t alto.
    const female = [88, 90, 92, 89, 91, 90, 93];
    const male = [60, 62, 58, 61, 59, 60, 57];
    const out = compareSexes(female, male);
    expect(out.result).toBe('more_female');
    expect(out.femaleAvg).toBeGreaterThan(out.maleAvg!);
  });

  it('detecta diferencia significativa a favor de hombres (+H)', () => {
    const female = [55, 57, 54, 56, 55, 58, 53];
    const male = [85, 88, 90, 86, 87, 89, 91];
    const out = compareSexes(female, male);
    expect(out.result).toBe('more_male');
  });

  it('no marca diferencia cuando los grupos son estadísticamente similares', () => {
    const female = [70, 72, 68, 71, 69, 73, 70];
    const male = [71, 69, 72, 70, 68, 71, 70];
    const out = compareSexes(female, male);
    expect(out.result).toBe('no_difference');
  });

  it('con medias idénticas y sin dispersión → no_difference', () => {
    const out = compareSexes(big(75), big(75));
    expect(out.result).toBe('no_difference');
  });
});
