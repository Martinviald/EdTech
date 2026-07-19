import { normalizeClassGroupSection, parseCursoLabel } from './curso-parser';

describe('normalizeClassGroupSection', () => {
  // El nivel vive en `grade_id`: guardarlo también dentro del nombre produjo en
  // demo cursos "4B A" conviviendo con "A" para el mismo nivel.
  it.each([
    ['6B A', 'A'],
    ['4B B', 'B'],
    ['3° Básico A', 'A'],
    ['1° Medio B', 'B'],
    ['Pre-Kinder A', 'A'],
  ])('extrae la sección de %s → %s', (input, expected) => {
    expect(normalizeClassGroupSection(input)).toBe(expected);
  });

  it('deja la sección tal cual cuando ya viene sola', () => {
    expect(normalizeClassGroupSection('A')).toBe('A');
    expect(normalizeClassGroupSection('  C  ')).toBe('C');
  });

  it('normaliza a mayúscula una sección de una letra', () => {
    expect(normalizeClassGroupSection('a')).toBe('A');
  });

  it('respeta nombres de sección no literales', () => {
    // Hay colegios que nombran las secciones por color/nombre; no se inventa nada.
    expect(normalizeClassGroupSection('Azul')).toBe('Azul');
  });
});

describe('parseCursoLabel', () => {
  it('no confunde una sección suelta con un curso', () => {
    expect(parseCursoLabel('A')).toBeNull();
  });
});
