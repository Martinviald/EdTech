import { DecisionError } from './contracts';
import { assertValidThresholds, routeByConfidence, routeNoul } from './routing';

describe('routeByConfidence', () => {
  const t = { auto: 0.8, review: 0.5 };

  it('clasifica en los bordes (>= es inclusivo)', () => {
    expect(routeByConfidence(0.8, t)).toBe('auto');
    expect(routeByConfidence(1, t)).toBe('auto');
    expect(routeByConfidence(0.7999, t)).toBe('review');
    expect(routeByConfidence(0.5, t)).toBe('review');
    expect(routeByConfidence(0.4999, t)).toBe('reject');
    expect(routeByConfidence(0, t)).toBe('reject');
  });

  it('con review == auto no existe la franja de revisión', () => {
    expect(routeByConfidence(0.6, { auto: 0.6, review: 0.6 })).toBe('auto');
    expect(routeByConfidence(0.59, { auto: 0.6, review: 0.6 })).toBe('reject');
  });

  it('rechaza umbrales inválidos', () => {
    expect(() => routeByConfidence(0.5, { auto: 0.5, review: 0.8 })).toThrow(DecisionError);
  });
});

describe('routeNoul', () => {
  const t = { yes: 0.9, no: 0.1 };

  it('clasifica en los bordes', () => {
    expect(routeNoul(0.9, t)).toBe('yes');
    expect(routeNoul(0.8999, t)).toBe('uncertain');
    expect(routeNoul(0.5, t)).toBe('uncertain');
    expect(routeNoul(0.1001, t)).toBe('uncertain');
    expect(routeNoul(0.1, t)).toBe('no');
    expect(routeNoul(0, t)).toBe('no');
  });
});

describe('assertValidThresholds', () => {
  const invalid = (t: Parameters<typeof assertValidThresholds>[0]): string | undefined => {
    try {
      assertValidThresholds(t);
      return undefined;
    } catch (error) {
      return error instanceof DecisionError ? error.code : 'otro-error';
    }
  };

  it('acepta los extremos válidos', () => {
    expect(invalid({ auto: 1, review: 0 })).toBeUndefined();
    expect(invalid({ auto: 0.7, review: 0.7 })).toBeUndefined();
    expect(invalid({ yes: 1, no: 0 })).toBeUndefined();
  });

  it('rechaza con invalid_request lo que viola la invariante', () => {
    expect(invalid({ auto: 0.5, review: 0.6 })).toBe('invalid_request');
    expect(invalid({ auto: 1.1, review: 0.5 })).toBe('invalid_request');
    expect(invalid({ auto: 0.9, review: -0.1 })).toBe('invalid_request');
    expect(invalid({ auto: Number.NaN, review: 0.5 })).toBe('invalid_request');
    expect(invalid({ yes: 0.5, no: 0.5 })).toBe('invalid_request');
    expect(invalid({ yes: 0.4, no: 0.6 })).toBe('invalid_request');
    expect(invalid({ yes: 0.9, no: -0.01 })).toBe('invalid_request');
  });
});
