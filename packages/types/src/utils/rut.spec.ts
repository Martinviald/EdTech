import { normalizeRut, rutBodyKey } from './rut';

describe('normalizeRut', () => {
  it('normaliza con y sin formato', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizeRut('123456785')).toBe('12345678-5');
  });

  it('acepta DV = K', () => {
    expect(normalizeRut('24160232-K')).toBe('24160232-K');
    expect(normalizeRut('24160232k')).toBe('24160232-K');
  });

  it('rechaza un DV que no cuadra (K bubbleado como 0)', () => {
    expect(normalizeRut('241602320')).toBeNull();
  });
});

describe('rutBodyKey', () => {
  it('extrae el cuerpo ignorando el DV', () => {
    expect(rutBodyKey('24160232-K')).toBe('24160232');
    expect(rutBodyKey('241602320')).toBe('24160232');
    expect(rutBodyKey('12.345.678-5')).toBe('12345678');
  });

  it('un DV = K bubbleado como 0 comparte cuerpo con el RUT real', () => {
    expect(rutBodyKey('241602320')).toBe(rutBodyKey('24160232-K'));
  });

  it('retorna null para entradas fuera de rango', () => {
    expect(rutBodyKey('')).toBeNull();
    expect(rutBodyKey(null)).toBeNull();
    expect(rutBodyKey('1234')).toBeNull();
    expect(rutBodyKey('abcdefghi')).toBeNull();
  });
});
