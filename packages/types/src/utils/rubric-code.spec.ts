import { normalizeRubricCode, sameRubricCode } from './rubric-code';

describe('normalizeRubricCode', () => {
  it('saca el cero a la izquierda de un código numérico', () => {
    expect(normalizeRubricCode('01')).toBe('1');
    expect(normalizeRubricCode('02')).toBe('2');
    expect(normalizeRubricCode('007')).toBe('7');
  });

  it('no convierte el cero en vacío', () => {
    expect(normalizeRubricCode('0')).toBe('0');
    expect(normalizeRubricCode('00')).toBe('0');
  });

  it('deja intacto lo que no es un número entero', () => {
    expect(normalizeRubricCode('NR')).toBe('NR');
    expect(normalizeRubricCode('0A')).toBe('0A');
    expect(normalizeRubricCode('0.5')).toBe('0.5');
  });

  it('recorta espacios', () => {
    expect(normalizeRubricCode('  02  ')).toBe('2');
  });
});

describe('sameRubricCode', () => {
  it('"01" es el mismo nivel que "1"', () => {
    expect(sameRubricCode('1', '01')).toBe(true);
    expect(sameRubricCode('02', '2')).toBe(true);
  });

  it('"12" NO es el nivel 1 ni el 2', () => {
    expect(sameRubricCode('1', '12')).toBe(false);
    expect(sameRubricCode('2', '12')).toBe(false);
  });

  it('no confunde niveles distintos', () => {
    expect(sameRubricCode('1', '2')).toBe(false);
    expect(sameRubricCode('0', '1')).toBe(false);
  });

  it('ignora mayúsculas en códigos no numéricos', () => {
    expect(sameRubricCode('NR', 'nr')).toBe(true);
  });
});
