import { isAuditSample } from './audit-sample';

describe('isAuditSample', () => {
  it('es determinístico', () => {
    for (let index = 0; index < 20; index++) {
      const key = `mark-${index}`;
      expect(isAuditSample(key, 0.1)).toBe(isAuditSample(key, 0.1));
    }
  });

  it('respeta los extremos', () => {
    expect(isAuditSample('cualquiera', 0)).toBe(false);
    expect(isAuditSample('cualquiera', 1)).toBe(true);
  });

  it('la proporción muestreada se acerca a la tasa', () => {
    const keys = Array.from({ length: 5000 }, (_, index) => `reading-${index}`);
    const share = keys.filter((key) => isAuditSample(key, 0.1)).length / keys.length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.12);
  });

  it('una tasa mayor incluye lo que muestrea una menor', () => {
    const keys = Array.from({ length: 500 }, (_, index) => `r-${index}`);
    for (const key of keys.filter((k) => isAuditSample(k, 0.05))) {
      expect(isAuditSample(key, 0.2)).toBe(true);
    }
  });
});
