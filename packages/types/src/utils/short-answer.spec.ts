import {
  creditForAcceptedAnswer,
  inferComparisonMode,
  matchesAcceptedAnswer,
} from './short-answer';

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
    expect(matchesAcceptedAnswer('119m', ['119'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('120m', ['119'])).toBe('mismatch');
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

describe('matchesAcceptedAnswer — secuencias (comparison: sequence)', () => {
  const opts = { comparison: 'sequence' as const };

  it('un orden vale con cualquier separador', () => {
    for (const given of ['3-1-4-2', '3,1,4,2', '3 1 4 2', '3 – 1 – 4 – 2', '3; 1; 4; 2']) {
      expect(matchesAcceptedAnswer(given, ['3-1-4-2'], opts)).toBe('match');
    }
    expect(matchesAcceptedAnswer('2-4-3-1', ['2 – 4 – 3 – 1'], opts)).toBe('match');
  });

  it('un par ordenado vale con coma o punto y coma, con o sin paréntesis', () => {
    for (const given of ['(5,6)', '(5;6)', '5,6', '( 5 , 6 )']) {
      expect(matchesAcceptedAnswer(given, ['(5,6)'], opts)).toBe('match');
    }
    expect(matchesAcceptedAnswer('(0,4)', ['(0;4)'], opts)).toBe('match');
  });

  it('el orden importa: un par invertido es incorrecto', () => {
    expect(matchesAcceptedAnswer('(6,5)', ['(5,6)'], opts)).toBe('mismatch');
    expect(matchesAcceptedAnswer('3,1,2,4', ['3-1-4-2'], opts)).toBe('mismatch');
  });

  it('sobrar o faltar un número es incorrecto', () => {
    expect(matchesAcceptedAnswer('3,1,4', ['3-1-4-2'], opts)).toBe('mismatch');
    expect(matchesAcceptedAnswer('31424', ['3-1-4-2'], opts)).toBe('mismatch');
  });

  it('acepta las casillas pegadas por el escáner sólo si calzan en cantidad', () => {
    expect(matchesAcceptedAnswer('3142', ['3-1-4-2'], opts)).toBe('match');
    expect(matchesAcceptedAnswer('3124', ['3-1-4-2'], opts)).toBe('mismatch');
    expect(matchesAcceptedAnswer('56', ['(5,6)'], opts)).toBe('mismatch');
  });

  it('el guion es signo sólo cuando abre el número', () => {
    expect(matchesAcceptedAnswer('(-3,2)', ['(-3,2)'], opts)).toBe('match');
    expect(matchesAcceptedAnswer('(3,2)', ['(-3,2)'], opts)).toBe('mismatch');
  });

  it('sin números es incorrecto', () => {
    expect(matchesAcceptedAnswer('no sé', ['3-1-4-2'], opts)).toBe('mismatch');
  });
});

// Casos reales de la DIA: clave como la escribe la ficha técnica y respuesta como
// la entrega la digitalización de GradeCam, que concatena las casillas.
describe('inferComparisonMode — pares ordenados', () => {
  it('reconoce el par por su envoltura o su separador explícito', () => {
    expect(inferComparisonMode(['(7;3)'])).toBe('ordered_tuple');
    expect(inferComparisonMode(['(2, -4)'])).toBe('ordered_tuple');
    expect(inferComparisonMode(['7;3'])).toBe('ordered_tuple');
  });

  it('un negativo entre paréntesis sigue siendo una cantidad', () => {
    expect(inferComparisonMode(['(-5)'])).toBe('numeric');
    expect(inferComparisonMode(['-12'])).toBe('numeric');
  });

  it('un texto con espacios no es un par', () => {
    expect(inferComparisonMode(['Santiago de Chile'])).toBe('text');
  });
});

describe('creditForAcceptedAnswer — par ordenado', () => {
  it('acierta con la clave escrita distinto que la respuesta', () => {
    expect(matchesAcceptedAnswer('[7#3]', ['(7;3)'])).toBe('match');
    expect(matchesAcceptedAnswer('[2#-4]', ['(2, -4)'])).toBe('match');
    expect(matchesAcceptedAnswer('[0#-2]', ['(0;-2)'])).toBe('match');
    expect(matchesAcceptedAnswer('7 3', ['(7;3)'])).toBe('match');
    expect(matchesAcceptedAnswer('[7,0#3]', ['(7;3)'])).toBe('match');
    expect(matchesAcceptedAnswer('[2,5#3]', ['(2,5; 3)'])).toBe('match');
  });

  it('invertir las coordenadas es incorrecto', () => {
    expect(creditForAcceptedAnswer('[3#7]', ['(7;3)'])).toEqual({
      outcome: 'incorrect',
      credit: 0,
    });
  });

  it('media coordenada bien: crédito solo si la pauta declara componentCredit', () => {
    expect(creditForAcceptedAnswer('[2#4]', ['(2, -4)'])).toEqual({
      outcome: 'incorrect',
      credit: 0,
    });
    const componentCredit = { mode: 'per_component' as const, creditPerComponent: [0.5, 0.5] };
    expect(creditForAcceptedAnswer('[2#4]', ['(2, -4)'], { componentCredit })).toEqual({
      outcome: 'partial',
      credit: 0.5,
    });
    expect(matchesAcceptedAnswer('[2#4]', ['(2, -4)'], { componentCredit })).toBe('mismatch');
  });

  it('distinta aridad o un valor pegado no aciertan', () => {
    expect(matchesAcceptedAnswer('[7#3#1]', ['(7;3)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('73', ['(7;3)'])).toBe('mismatch');
  });

  it('una clave que no se entiende como par deja la respuesta indecidible', () => {
    expect(matchesAcceptedAnswer('(7;3)', ['siete'], { comparison: 'ordered_tuple' })).toBe(
      'undecidable',
    );
  });
});

describe('matchesAcceptedAnswer — equivalencias de §5.5', () => {
  it('miles, signos y números mixtos', () => {
    expect(matchesAcceptedAnswer('1 500', ['1500'])).toBe('match');
    expect(matchesAcceptedAnswer('−5', ['-5'])).toBe('match');
    expect(matchesAcceptedAnswer('(-5)', ['-5'])).toBe('match');
    expect(matchesAcceptedAnswer('1 1/2', ['3/2'])).toBe('match');
  });

  it('un número ambiguo miles/decimal queda indecidible si cambia el resultado', () => {
    expect(matchesAcceptedAnswer('1.500', ['1500'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('1.500', ['1,5'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('1.500', ['8'])).toBe('mismatch');
  });

  it('la pauta del ítem manda: formato fracción sin decimal equivalente', () => {
    expect(matchesAcceptedAnswer('0,75', ['3/4'], { formatKind: 'fraction' })).toBe('mismatch');
    expect(
      matchesAcceptedAnswer('0,75', ['3/4'], {
        formatKind: 'fraction',
        equivalences: { acceptDecimalEquivalent: true },
      }),
    ).toBe('match');
    expect(
      matchesAcceptedAnswer('6/8', ['3/4'], { equivalences: { requireSimplified: true } }),
    ).toBe('mismatch');
  });
});

describe('revisión F2 — secuencias numéricas (hallazgo 4)', () => {
  const sequence = { comparison: 'sequence' as const };

  it('solo los números cuentan cuando la clave es numérica, como antes de F2', () => {
    expect(matchesAcceptedAnswer('R: 3-1-4-2', ['3-1-4-2'], sequence)).toBe('match');
    expect(matchesAcceptedAnswer('3-1-4-2', ['P3-P1-P4-P2'], sequence)).toBe('match');
    expect(matchesAcceptedAnswer('P3-P1-P4-P2', ['3-1-4-2'], sequence)).toBe('match');
    expect(matchesAcceptedAnswer('3142', ['P3-P1-P4-P2'], sequence)).toBe('match');
    expect(matchesAcceptedAnswer('3,1,4,2', ['P3-P1-P4-P2'], sequence)).toBe('match');
  });

  it('una clave de palabras se compara por palabras', () => {
    expect(matchesAcceptedAnswer('Rojo - azul - verde', ['rojo-azul-verde'], sequence)).toBe(
      'match',
    );
    expect(matchesAcceptedAnswer('azul-rojo-verde', ['rojo-azul-verde'], sequence)).toBe(
      'mismatch',
    );
  });
});

describe('revisión F2 — ambigüedad miles/decimal (hallazgos 5 y 6)', () => {
  it('la misma escritura con otro separador coincide con la clave ambigua', () => {
    expect(matchesAcceptedAnswer('2,125', ['2.125'])).toBe('match');
    expect(matchesAcceptedAnswer('2.125', ['2,125'])).toBe('match');
    expect(matchesAcceptedAnswer('250,000', ['250.000'])).toBe('match');
  });

  it('otra clave aceptada desambigua la clave', () => {
    expect(matchesAcceptedAnswer('2125', ['2.125', '2,125'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('1,5', ['1.500', '1500'])).toBe('mismatch');
  });

  it('formato entero: el punto separa miles y no hay indecidible', () => {
    const integer = { formatKind: 'integer' as const };
    expect(matchesAcceptedAnswer('1.500', ['1500'], integer)).toBe('match');
    expect(matchesAcceptedAnswer('1500', ['1.500'], integer)).toBe('match');
    expect(matchesAcceptedAnswer('1.500', ['1,5'], integer)).toBe('mismatch');
    expect(matchesAcceptedAnswer('1', ['1.000'], integer)).toBe('mismatch');
  });

  it('formato decimal: la clave con tres decimales se lee como decimal', () => {
    const decimal = { formatKind: 'decimal' as const };
    expect(matchesAcceptedAnswer('2,125', ['2.125'], decimal)).toBe('match');
    expect(matchesAcceptedAnswer('2125', ['2.125'], decimal)).toBe('mismatch');
  });

  it('sin formato ni otra clave, la ambigüedad real sigue yendo a revisión', () => {
    expect(matchesAcceptedAnswer('1', ['1.000'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('1.000', ['1'])).toBe('undecidable');
    expect(matchesAcceptedAnswer('1,5', ['1.500'])).toBe('undecidable');
  });
});

describe('revisión F2 — pares ordenados (hallazgos 8 y 9)', () => {
  it('la barra y el punto no separan componentes', () => {
    expect(matchesAcceptedAnswer('3/2', ['(3,2)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('7.3', ['(7;3)'])).toBe('mismatch');
    expect(matchesAcceptedAnswer('7-3', ['(7;3)'])).toBe('match');
  });

  it('paréntesis con dos componentes es un par, aunque abra con signo', () => {
    expect(inferComparisonMode(['(-3,2)'])).toBe('ordered_tuple');
    expect(matchesAcceptedAnswer('(-3;2)', ['(-3,2)'])).toBe('match');
    expect(matchesAcceptedAnswer('(-3, 2)', ['(-3,2)'])).toBe('match');
    expect(matchesAcceptedAnswer('-3,2', ['(-3,2)'])).toBe('match');
    expect(matchesAcceptedAnswer('(3;-2)', ['(-3,2)'])).toBe('mismatch');
  });
});

describe('revisión F2 — fracción y decimal equivalentes (hallazgo 10)', () => {
  it('formato fracción con clave decimal: depende de acceptDecimalEquivalent', () => {
    expect(
      matchesAcceptedAnswer('1/2', ['0,5'], {
        formatKind: 'fraction',
        equivalences: { acceptDecimalEquivalent: true },
      }),
    ).toBe('match');
    expect(matchesAcceptedAnswer('1/2', ['0,5'], { formatKind: 'fraction' })).toBe('undecidable');
    expect(matchesAcceptedAnswer('1/3', ['0,5'], { formatKind: 'fraction' })).toBe('mismatch');
    expect(matchesAcceptedAnswer('0,5', ['1/2'], { formatKind: 'fraction' })).toBe('mismatch');
  });
});

describe('revisión F2 — unidades y texto (hallazgo 14)', () => {
  it('la unidad esperada se ignora, escrita o no; otra unidad va a revisión', () => {
    expect(matchesAcceptedAnswer('149 m', ['149'], { unit: 'm' })).toBe('match');
    expect(matchesAcceptedAnswer('149', ['149'], { unit: 'm' })).toBe('match');
    expect(matchesAcceptedAnswer('149 cm', ['149'], { unit: 'm' })).toBe('undecidable');
    expect(matchesAcceptedAnswer('149 m', ['149'])).toBe('undecidable');
  });

  it('ignoreUnit: false exige la unidad declarada', () => {
    const strict = { unit: 'm', equivalences: { ignoreUnit: false } };
    expect(matchesAcceptedAnswer('149 m', ['149'], strict)).toBe('match');
    expect(matchesAcceptedAnswer('149', ['149'], strict)).toBe('mismatch');
    expect(matchesAcceptedAnswer('149 km', ['149'], strict)).toBe('undecidable');
    expect(matchesAcceptedAnswer('150 km', ['149'], strict)).toBe('mismatch');
  });

  it('en modo texto se ignoran tildes y mayúsculas', () => {
    expect(matchesAcceptedAnswer('telefono', ['Teléfono'])).toBe('match');
    expect(matchesAcceptedAnswer('ÁRBOL', ['arbol'])).toBe('match');
    expect(matchesAcceptedAnswer('Teléfono', ['teléfono'], { caseSensitive: true })).toBe(
      'mismatch',
    );
  });
});
