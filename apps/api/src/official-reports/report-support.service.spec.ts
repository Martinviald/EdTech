import type { Database } from '@soe/db';
import { ReportSupportService, humanizePeriod } from './report-support.service';

// Los métodos aquí probados son puros (no tocan la DB), así que basta con un
// stub de Database.
const service = new ReportSupportService({} as unknown as Database);

describe('ReportSupportService — helpers de presentación', () => {
  describe('resolveVariant', () => {
    it('marca requires_support para momentos diagnósticos', () => {
      expect(service.resolveVariant('diagnostico')).toBe('requires_support');
      expect(service.resolveVariant('Diagnóstico')).toBe('requires_support');
      expect(service.resolveVariant('inicial')).toBe('requires_support');
    });

    it('marca achievement_levels para monitoreo/cierre/otros', () => {
      expect(service.resolveVariant('monitoreo')).toBe('achievement_levels');
      expect(service.resolveVariant('cierre')).toBe('achievement_levels');
      expect(service.resolveVariant('intermedia')).toBe('achievement_levels');
      expect(service.resolveVariant(null)).toBe('achievement_levels');
    });
  });

  describe('resolveDisclaimers (data-driven, sin copy hardcodeado)', () => {
    it('devuelve [] si el instrumento no define advertencias', () => {
      expect(service.resolveDisclaimers({})).toEqual([]);
      expect(service.resolveDisclaimers({ reportDisclaimers: 'no-array' })).toEqual([]);
    });

    it('devuelve sólo strings del config del instrumento', () => {
      const out = service.resolveDisclaimers({
        reportDisclaimers: ['No calificar', 'No comparar cursos', 42],
      });
      expect(out).toEqual(['No calificar', 'No comparar cursos']);
    });
  });

  describe('resolveReflectionPrompts', () => {
    it('usa el set genérico por defecto si el instrumento no lo define', () => {
      expect(service.resolveReflectionPrompts({}).length).toBeGreaterThan(0);
    });

    it('respeta las preguntas configuradas en el instrumento', () => {
      const custom = ['¿Pregunta A?', '¿Pregunta B?'];
      expect(service.resolveReflectionPrompts({ reportReflectionPrompts: custom })).toEqual(
        custom,
      );
    });
  });
});

describe('humanizePeriod', () => {
  it('capitaliza y trimea', () => {
    expect(humanizePeriod('monitoreo')).toBe('Monitoreo');
    expect(humanizePeriod('  cierre ')).toBe('Cierre');
  });

  it('devuelve null para vacío/nulo', () => {
    expect(humanizePeriod(null)).toBeNull();
    expect(humanizePeriod('   ')).toBeNull();
  });
});
