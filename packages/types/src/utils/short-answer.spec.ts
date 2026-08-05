import { inferComparisonMode, matchesAcceptedAnswer } from './short-answer';

describe('inferComparisonMode', () => {
  it('es numérico cuando todas las claves parsean como número o fracción', () => {
    expect(inferComparisonMode(['21/10'])).toBe('numeric');
    expect(inferComparisonMode(['24', '24.0'])).toBe('numeric');
    expect(inferComparisonMode(['0,025'])).toBe('numeric');
  });

  it('es texto si alguna clave no es numérica', () => {
    expect(inferComparisonMode(['Santiago'])).toBe('text');
    expect(inferComparisonMode(['24', 'veinticuatro'])).toBe('text');
  });
});

describe('matchesAcceptedAnswer — tolerancia de forma', () => {
  it('acepta el separador decimal en cualquiera de sus dos formas', () => {
    expect(matchesAcceptedAnswer('5,6', ['5.6'])).toBe('match');
    expect(matchesAcceptedAnswer('5.6', ['5,6'])).toBe('match');
  });

  it('acepta una fracción equivalente a la clave decimal y viceversa', () => {
    expect(matchesAcceptedAnswer('21/10', ['2,1'])).toBe('match');
    expect(matchesAcceptedAnswer('2.1', ['21/10'])).toBe('match');
    expect(matchesAcceptedAnswer('10/4', ['5/2'])).toBe('match');
  });

  it('no depende del punto flotante: 21/10 y 2.1 son el mismo racional', () => {
    expect(matchesAcceptedAnswer('0.1', ['1/10'])).toBe('match');
    expect(matchesAcceptedAnswer('0,3', ['3/10'])).toBe('match');
  });

  it('ignora espacios sobrantes', () => {
    expect(matchesAcceptedAnswer('  24 ', ['24'])).toBe('match');
    expect(matchesAcceptedAnswer('21 / 10', ['2,1'])).toBe('match');
  });

  it('acepta la unidad declarada como sufijo, pero no la inventa', () => {
    expect(matchesAcceptedAnswer('119m', ['119'], { unit: 'm' })).toBe('match');
    expect(matchesAcceptedAnswer('119 m', ['119'], { unit: 'm' })).toBe('match');
    expect(matchesAcceptedAnswer('119m', ['119'])).toBe('mismatch');
  });

  it('en modo texto compara sin distinguir mayúsculas salvo que se pida', () => {
    expect(matchesAcceptedAnswer('santiago', ['Santiago'])).toBe('match');
    expect(matchesAcceptedAnswer('santiago', ['Santiago'], { caseSensitive: true })).toBe(
      'mismatch',
    );
  });
});

describe('matchesAcceptedAnswer — lo que NO se tolera', () => {
  it('no inventa el separador decimal perdido', () => {
    expect(matchesAcceptedAnswer('56', ['5,6'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('0025', ['0,025'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('1112', ['11,5'])).toBe('mismatch');
  });

  it('otra cantidad es incorrecta, no tolerable', () => {
    expect(matchesAcceptedAnswer('1/10', ['21/10'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('14/15', ['21/10'])).toBe('mismatch');
  });

  it('un texto donde se esperaba un número es incorrecto', () => {
    expect(matchesAcceptedAnswer('no sé', ['24'])).toBe('mismatch');
  });

  it('la respuesta vacía es incorrecta, no indecidible', () => {
    expect(matchesAcceptedAnswer('', ['24'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('   ', ['24'])).toBe('mismatch');
  });
});

describe('matchesAcceptedAnswer — indecidibles', () => {
  it('marca indecidible lo que trae más de un valor candidato', () => {
    expect(matchesAcceptedAnswer('0=16.5', ['16,5'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('1 4', ['14'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('0 4', ['4'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('2,5-2', ['2,5'])).toBe('undecidable');
  });

  it('una fracción no es ambigua aunque tenga un signo', () => {
    expect(matchesAcceptedAnswer('-3/4', ['-0,75'])).toBe('match');
  });

  it('no es string → indecidible', () => {
    expect(matchesAcceptedAnswer(null, ['24'])).toBe('undecidable');
    expect(matchesAcceptedAnswer(42, ['42'])).toBe('undecidable');
  });

  it('sin claves declaradas no se puede decidir', () => {
    expect(matchesAcceptedAnswer('24', [])).toBe('undecidable');
  });
});

describe('comparación por secuencia (coordenadas y órdenes)', () => {
  it('infiere secuencia sólo cuando la clave lo declara', () => {
    expect(inferComparisonMode(['(5,6)'])).toBe('sequence');
    expect(inferComparisonMode(['(0;4)'])).toBe('sequence');
    expect(inferComparisonMode(['3-1-4-2'])).toBe('sequence');
    expect(inferComparisonMode(['(2, -4)'])).toBe('sequence');
  });

  it('un decimal con coma NO es una secuencia', () => {
    expect(inferComparisonMode(['11,5'])).toBe('numeric');
    expect(inferComparisonMode(['2,5'])).toBe('numeric');
    expect(matchesAcceptedAnswer('11.5', ['11,5'])).toBe('match');
  });

  it('acepta la coordenada escrita de todas las formas de la hoja', () => {
    for (const raw of ['(5,6)', '5,6', '5;6', '5 6', '56']) {
      expect(matchesAcceptedAnswer(raw, ['(5,6)'])).toBe('match');
    }
  });

  it('el punto separa coordenadas cuando la clave son enteros', () => {
    expect(matchesAcceptedAnswer('1.5', ['(1;5)'])).toBe('match');
    expect(matchesAcceptedAnswer('3.3', ['(1;5)'])).toBe('mismatch');
  });

  it('respeta los negativos en vez de partirlos por el guion', () => {
    expect(matchesAcceptedAnswer('-3,-2', ['(-3;-2)'])).toBe('match');
    expect(matchesAcceptedAnswer('4,-3', ['(4;-3)'])).toBe('match');
  });

  it('lee el orden con y sin separadores', () => {
    for (const raw of ['3142', '3-1-4-2', '3,1,4,2', '3 1 4 2']) {
      expect(matchesAcceptedAnswer(raw, ['3-1-4-2'])).toBe('match');
    }
    expect(matchesAcceptedAnswer('4132', ['3-1-4-2'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('4-2-3-1', ['3-1-4-2'])).toBe('mismatch');
  });

  it('no inventa una lectura cuando la cantidad de números no calza', () => {
    expect(matchesAcceptedAnswer('5645', ['(5,6)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('(3,1)(2,3)', ['(1;5)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('no visto en clases', ['(1;5)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('14', ['3-1-4-2'])).toBe('mismatch');
  });

  it('el orden importa', () => {
    expect(matchesAcceptedAnswer('65', ['(5,6)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('6,5', ['(5,6)'])).toBe('mismatch');
  });
});
