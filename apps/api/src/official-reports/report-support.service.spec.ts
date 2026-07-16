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
      expect(service.resolveReflectionPrompts({ reportReflectionPrompts: custom })).toEqual(custom);
    });
  });
});

// El mapeo scope → class_groups que alimenta el read-model de cohorte. Debe seguir
// rama por rama a resolveAccessibleStudentIds: es su primera mitad, sin la
// expansión a alumnos.
describe('ReportSupportService.resolveAccessibleClassGroupIds', () => {
  const CG_A = 'cg-a';
  const CG_B = 'cg-b';

  it('admin sin filtro → null (sin filtro de curso)', () => {
    // ⚠️ null, NO []: es lo que habilita el atajo de references.org en item-analysis
    // (sin filtro → la población visible ya es todo el colegio).
    expect(
      service.resolveAccessibleClassGroupIds({ scopeAll: true, classGroupIds: [] }, undefined),
    ).toBeNull();
  });

  it('admin con filtro por curso → ese único curso', () => {
    expect(
      service.resolveAccessibleClassGroupIds({ scopeAll: true, classGroupIds: [] }, CG_A),
    ).toEqual([CG_A]);
  });

  it('profesor sin filtro → todos sus cursos (se recombinan sumando)', () => {
    expect(
      service.resolveAccessibleClassGroupIds(
        { scopeAll: false, classGroupIds: [CG_A, CG_B] },
        undefined,
      ),
    ).toEqual([CG_A, CG_B]);
  });

  it('profesor con filtro dentro de su scope → ese curso', () => {
    expect(
      service.resolveAccessibleClassGroupIds(
        { scopeAll: false, classGroupIds: [CG_A, CG_B] },
        CG_A,
      ),
    ).toEqual([CG_A]);
  });

  it('profesor pidiendo un curso fuera de su scope → [] (no null: filtra a nada)', () => {
    expect(
      service.resolveAccessibleClassGroupIds({ scopeAll: false, classGroupIds: [CG_A] }, CG_B),
    ).toEqual([]);
  });

  it('profesor sin cursos → [] (no null)', () => {
    expect(
      service.resolveAccessibleClassGroupIds({ scopeAll: false, classGroupIds: [] }, undefined),
    ).toEqual([]);
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
