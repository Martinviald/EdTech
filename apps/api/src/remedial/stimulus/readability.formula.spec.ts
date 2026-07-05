import { countWords, FernandezHuertaFormula } from './readability.formula';

// Texto simple: palabras cortas + oraciones cortas (baja densidad silábica).
const SIMPLE_TEXT = 'El sol brilla. La flor crece. El niño ríe. La casa es azul. El pan es rico.';
// Texto complejo: palabras largas + una sola oración (alta densidad silábica).
const COMPLEX_TEXT =
  'La interdependencia socioeconómica caracteriza las civilizaciones contemporáneas ' +
  'mediante estructuras institucionales profundamente jerarquizadas.';

describe('FernandezHuertaFormula', () => {
  const formula = new FernandezHuertaFormula();

  it('es monotónica: un texto simple puntúa MÁS ALTO que uno complejo', () => {
    const simple = formula.score(SIMPLE_TEXT);
    const complex = formula.score(COMPLEX_TEXT);

    expect(simple.value).toBeGreaterThan(complex.value);
  });

  it('estima un grado escolar MENOR (más fácil) para el texto simple', () => {
    const simple = formula.score(SIMPLE_TEXT);
    const complex = formula.score(COMPLEX_TEXT);

    expect(simple.gradeEstimate).not.toBeNull();
    expect(complex.gradeEstimate).not.toBeNull();
    expect(simple.gradeEstimate!).toBeLessThan(complex.gradeEstimate!);
  });

  it('mapea índices altos a grados iniciales (texto muy simple ≈ grado 2)', () => {
    const simple = formula.score(SIMPLE_TEXT);
    expect(simple.value).toBeGreaterThanOrEqual(90);
    expect(simple.gradeEstimate).toBe(2);
  });

  it('texto vacío → value 0 y gradeEstimate null (no se puede medir)', () => {
    expect(formula.score('')).toEqual({ value: 0, gradeEstimate: null });
    expect(formula.score('   \n  ')).toEqual({ value: 0, gradeEstimate: null });
  });

  it('el índice es determinista (misma entrada → misma salida)', () => {
    expect(formula.score(SIMPLE_TEXT)).toEqual(formula.score(SIMPLE_TEXT));
  });
});

describe('countWords', () => {
  it('cuenta tokens de letras, ignorando puntuación y espacios', () => {
    expect(countWords('Hola mundo cruel')).toBe(3);
    expect(countWords('uno, dos; tres.')).toBe(3);
    expect(countWords('  cañón  árbol  ')).toBe(2);
  });

  it('texto sin palabras → 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('123 !!! ...')).toBe(0);
  });
});
