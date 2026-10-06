import { buildContainsPattern, escapeLikePattern } from './search-term';
import { MAX_SEARCH_TERM_LENGTH, searchTermSchema } from '../schemas/common.schema';

describe('escapeLikePattern', () => {
  it('deja intacto un término sin metacaracteres', () => {
    expect(escapeLikePattern('matematica')).toBe('matematica');
    expect(escapeLikePattern('Monitoreo Intermedio 2026')).toBe('Monitoreo Intermedio 2026');
  });

  it('escapa el comodín de porcentaje', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapa el comodín de un carácter', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapa la barra ANTES que el resto, sin re-escapar lo ya escapado', () => {
    expect(escapeLikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });

  it('escapa todas las apariciones, no sólo la primera', () => {
    expect(escapeLikePattern('%%__')).toBe('\\%\\%\\_\\_');
  });
});

describe('buildContainsPattern', () => {
  it('envuelve el término en comodines de "contiene"', () => {
    expect(buildContainsPattern('matematica')).toBe('%matematica%');
  });

  it('envuelve el término YA escapado', () => {
    expect(buildContainsPattern('100%')).toBe('%100\\%%');
  });
});

describe('searchTermSchema', () => {
  const parse = (value: unknown): string | undefined => searchTermSchema.parse(value);

  it('devuelve undefined cuando no hay término', () => {
    expect(parse(undefined)).toBeUndefined();
  });

  it('devuelve undefined con un término vacío o sólo espacios', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('   ')).toBeUndefined();
  });

  it('devuelve undefined por debajo del mínimo de caracteres', () => {
    expect(parse('a')).toBeUndefined();
  });

  it('acepta el término desde el mínimo', () => {
    expect(parse('ab')).toBe('ab');
  });

  it('recorta los espacios de los extremos', () => {
    expect(parse('  hola  ')).toBe('hola');
  });

  it('trunca al máximo en vez de rechazar', () => {
    expect(parse('x'.repeat(150))).toBe('x'.repeat(MAX_SEARCH_TERM_LENGTH));
  });

  it('con el parámetro repetido se queda con el primero', () => {
    expect(parse(['matematica', 'x'])).toBe('matematica');
    expect(parse(['a', 'bb'])).toBeUndefined();
  });

  it('nunca lanza con una entrada inválida de la query string', () => {
    expect(() => parse('   ')).not.toThrow();
    expect(() => parse([])).not.toThrow();
  });
});
