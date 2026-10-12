import {
  canonicalKey,
  compareCanonical,
  compareShortText,
  compareWordLists,
  normalizeShortText,
  parseShortText,
  parseWordListText,
  isParsed,
  parseCanonicalKey,
  parseFractionText,
  parseNumberText,
  parseOrderedTupleText,
  parseScalarText,
  parseSequenceText,
  primaryReading,
  resolveEquivalences,
  resolveNumberConvention,
  uniqueReading,
  type CanonicalParse,
} from './answer-canonical';

const keyOf = (parse: CanonicalParse) => parseCanonicalKey(parse);

describe('parseNumberText', () => {
  it.each([
    ['2,5', 'n:5/2'],
    ['2.5', 'n:5/2'],
    ['2,50', 'n:5/2'],
    ['02,5', 'n:5/2'],
    ['1 500', 'n:1500'],
    ['1.500.000', 'n:1500000'],
    ['1.500,25', 'n:6001/4'],
    ['-5', 'n:-5'],
    ['−5', 'n:-5'],
    ['– 5', 'n:-5'],
    ['(-5)', 'n:-5'],
    ['( −2,5 )', 'n:-5/2'],
    ['+7', 'n:7'],
    ['.5', 'n:1/2'],
    ['0,025', 'n:1/40'],
    ['0.500', 'n:1/2'],
    ['1.82', 'n:91/50'],
    ['-0', 'n:0'],
  ])('%s → %s', (text, key) => {
    expect(keyOf(parseNumberText(text))).toBe(key);
  });

  it('conserva lo escrito y la cantidad de decimales', () => {
    const value = uniqueReading(parseNumberText('02,50'));
    expect(value).toEqual({
      type: 'number',
      value: { numerator: '5', denominator: '2' },
      written: '02,50',
      decimalPlaces: 2,
    });
  });

  it('declara la ambigüedad miles/decimal en vez de adivinar', () => {
    const parse = parseNumberText('1.500');
    expect(parse.issues).toContain('ambiguous_thousands_or_decimal');
    expect(uniqueReading(parse)).toBeNull();
    expect(parse.readings.decimal[0]?.value).toEqual({ numerator: '3', denominator: '2' });
    expect(parse.readings.thousands[0]?.value).toEqual({ numerator: '1500', denominator: '1' });
    expect(keyOf(parse)).toBe('amb:n:1500||n:3/2');
    expect(primaryReading(parse)?.value).toEqual({ numerator: '3', denominator: '2' });
  });

  it.each(['abc', '5,', '2,5-2', '1 4', '3 45', '1,234.5', '--5', '(5,6)', 'γ', '0=16.5'])(
    '%s no es un número',
    (text) => {
      const parse = parseNumberText(text);
      expect(isParsed(parse)).toBe(false);
      expect(parse.issues).toContain('non_numeric_in_numeric');
    },
  );

  it('no confunde dígitos de la infancia: 8 leído como γ no se interpreta', () => {
    expect(isParsed(parseNumberText('γ2'))).toBe(false);
    expect(keyOf(parseNumberText('82'))).toBe('n:82');
  });

  it('el punto con un solo grupo que empieza en 0 es decimal', () => {
    expect(keyOf(parseNumberText('0.250'))).toBe('n:1/4');
  });
});

describe('parseFractionText', () => {
  it('fracción simple, con espacios y negativa', () => {
    expect(keyOf(parseFractionText('3/4'))).toBe('f:3/4');
    expect(keyOf(parseFractionText('3 / 4'))).toBe('f:3/4');
    expect(keyOf(parseFractionText('-3/4'))).toBe('f:-3/4');
    expect(keyOf(parseFractionText('(−3/4)'))).toBe('f:-3/4');
  });

  it('número mixto', () => {
    const value = uniqueReading(parseFractionText('1 1/2'));
    expect(value).toMatchObject({
      type: 'fraction',
      value: { numerator: '3', denominator: '2' },
      written: { whole: '1', numerator: '1', denominator: '2' },
      isSimplified: true,
    });
    expect(keyOf(parseFractionText('-1 1/2'))).toBe('f:-1 1/2');
    expect(uniqueReading(parseFractionText('-1 1/2'))?.value).toEqual({
      numerator: '-3',
      denominator: '2',
    });
  });

  it('isSimplified', () => {
    expect(uniqueReading(parseFractionText('6/8'))).toMatchObject({ isSimplified: false });
    expect(uniqueReading(parseFractionText('3/4'))).toMatchObject({ isSimplified: true });
    expect(uniqueReading(parseFractionText('1 3/2'))).toMatchObject({ isSimplified: false });
  });

  it('denominador 0 no se interpreta', () => {
    expect(isParsed(parseFractionText('3/0'))).toBe(false);
  });

  it('equivalentes de distinta escritura tienen claves distintas', () => {
    expect(keyOf(parseFractionText('6/8'))).not.toBe(keyOf(parseFractionText('3/4')));
    expect(keyOf(parseFractionText('03/4'))).toBe('f:3/4');
  });
});

describe('parseOrderedTupleText', () => {
  it.each(['(7;3)', '(7,3)', '7;3', '7 3', '[7#3]', '( 7 ; 3 )', '{7|3}'])('%s → t:7|3', (text) => {
    expect(keyOf(parseOrderedTupleText(text, 2))).toBe('t:7|3');
  });

  it('sin aridad, `7,3` sin envoltura es un decimal y no un par', () => {
    expect(isParsed(parseOrderedTupleText('7,3'))).toBe(false);
    expect(keyOf(parseOrderedTupleText('7,3', 2))).toBe('t:7|3');
  });

  it('el separador explícito manda: en (2,5;3) la coma es decimal', () => {
    expect(keyOf(parseOrderedTupleText('(2,5;3)'))).toBe('t:2.5|3');
    expect(keyOf(parseOrderedTupleText('[2,5#3]', 2))).toBe('t:2.5|3');
  });

  it('con solo comas, la aridad resuelve; si no alcanza, declara ambigüedad', () => {
    expect(keyOf(parseOrderedTupleText('(2,5,3)', 3))).toBe('t:2|5|3');
    const ambiguous = parseOrderedTupleText('(2,5,3)', 2);
    expect(uniqueReading(ambiguous)).toBeNull();
    expect(keyOf(ambiguous)).toBe('amb:t:2.5|3||t:2|5.3');
  });

  it('componentes negativos y fracciones', () => {
    expect(keyOf(parseOrderedTupleText('(2, -4)'))).toBe('t:2|-4');
    expect(keyOf(parseOrderedTupleText('[0#-2]'))).toBe('t:0|-2');
    expect(keyOf(parseOrderedTupleText('(1/2; 3)'))).toBe('t:1/2|3');
  });

  it('marca la aridad distinta a la esperada', () => {
    const parse = parseOrderedTupleText('[7#3#1]', 2);
    expect(keyOf(parse)).toBe('t:7|3|1');
    expect(parse.issues).toContain('format_mismatch');
  });

  it('un valor suelto no es un par', () => {
    expect(isParsed(parseOrderedTupleText('73', 2))).toBe(false);
    expect(isParsed(parseOrderedTupleText('(a;3)', 2))).toBe(false);
  });
});

describe('parseSequenceText', () => {
  it.each(['3-1-4-2', '3,1,4,2', '3 1 4 2', '3 – 1 – 4 – 2', '3; 1; 4; 2', '(3,1,4,2)'])(
    '%s → s:3|1|4|2',
    (text) => {
      expect(keyOf(parseSequenceText(text))).toBe('s:3|1|4|2');
    },
  );

  it('separa las casillas pegadas solo si el largo coincide y se permite', () => {
    expect(keyOf(parseSequenceText('3142', { expectedLength: 4, allowPasted: true }))).toBe(
      's:3|1|4|2',
    );
    expect(keyOf(parseSequenceText('3142', { expectedLength: 4 }))).toBe('s:3142');
    expect(keyOf(parseSequenceText('31424', { expectedLength: 4, allowPasted: true }))).toBe(
      's:31424',
    );
  });

  it('el guion es signo solo cuando abre el elemento', () => {
    expect(keyOf(parseSequenceText('(-3,2)'))).toBe('s:-3|2');
    expect(keyOf(parseSequenceText('3-2'))).toBe('s:3|2');
  });

  it('letras sin distinguir mayúsculas y ceros a la izquierda sin valor', () => {
    expect(keyOf(parseSequenceText('A-c-B'))).toBe('s:a|c|b');
    expect(keyOf(parseSequenceText('03-1'))).toBe('s:3|1');
  });

  it('marca el largo distinto', () => {
    expect(parseSequenceText('3,1,4', { expectedLength: 4 }).issues).toContain('format_mismatch');
  });
});

describe('canonicalKey', () => {
  it('es estable por tipo', () => {
    expect(
      canonicalKey({
        type: 'number',
        value: { numerator: '5', denominator: '2' },
        written: '2,5',
        decimalPlaces: 1,
      }),
    ).toBe('n:5/2');
    expect(canonicalKey({ type: 'word_list', words: ['sol', 'luna'] })).toBe('w:sol|luna');
    expect(canonicalKey({ type: 'text', text: 'hola' })).toBe('x:hola');
  });
});

describe('compareCanonical', () => {
  const scalar = (text: string) => parseScalarText(text);

  it('números: coma, punto y ceros sin valor', () => {
    expect(compareCanonical(scalar('2,50'), [scalar('2.5')], 'decimal')).toEqual({
      outcome: 'correct',
      credit: 1,
    });
    expect(compareCanonical(scalar('02,5'), [scalar('2,5')], 'decimal').outcome).toBe('correct');
    expect(compareCanonical(scalar('25'), [scalar('2,5')], 'decimal').outcome).toBe('incorrect');
  });

  it('ambigüedad miles/decimal: indecidible solo si las lecturas cambian el resultado', () => {
    expect(compareCanonical(scalar('1.500'), [scalar('1500')], null).outcome).toBe('undecidable');
    expect(compareCanonical(scalar('1.500'), [scalar('1500')], 'integer').outcome).toBe('correct');
    expect(compareCanonical(scalar('1.500'), [scalar('7')], 'integer').outcome).toBe('incorrect');
    expect(compareCanonical(scalar('250.000'), [scalar('250.000')], 'integer').outcome).toBe(
      'correct',
    );
  });

  it('requireExactDecimals y tolerance', () => {
    expect(
      compareCanonical(scalar('2,50'), [scalar('2,5')], 'decimal', { requireExactDecimals: true })
        .outcome,
    ).toBe('incorrect');
    expect(
      compareCanonical(scalar('3,14'), [scalar('3,1416')], 'decimal', { tolerance: 0.01 }).outcome,
    ).toBe('correct');
    expect(
      compareCanonical(scalar('3,1'), [scalar('3,1416')], 'decimal', { tolerance: 0.01 }).outcome,
    ).toBe('incorrect');
  });

  it('fracciones equivalentes por defecto; requireSimplified las rechaza', () => {
    expect(compareCanonical(scalar('6/8'), [scalar('3/4')], 'fraction').outcome).toBe('correct');
    expect(
      compareCanonical(scalar('6/8'), [scalar('3/4')], 'fraction', { requireSimplified: true })
        .outcome,
    ).toBe('incorrect');
    expect(
      compareCanonical(scalar('6/8'), [scalar('3/4')], 'fraction', {
        acceptEquivalentFractions: false,
      }).outcome,
    ).toBe('incorrect');
    expect(
      compareCanonical(scalar('1 1/2'), [scalar('3/2')], 'fraction', {
        acceptEquivalentFractions: false,
      }).outcome,
    ).toBe('correct');
  });

  it('decimal ↔ fracción: apagado en el formato fracción salvo que la pauta lo permita', () => {
    expect(compareCanonical(scalar('0,75'), [scalar('3/4')], 'fraction').outcome).toBe('incorrect');
    expect(
      compareCanonical(scalar('0,75'), [scalar('3/4')], 'fraction', {
        acceptDecimalEquivalent: true,
      }).outcome,
    ).toBe('correct');
    expect(compareCanonical(scalar('0,75'), [scalar('3/4')], null).outcome).toBe('correct');
  });

  it('pares: el orden importa y sin componentCredit es todo o nada', () => {
    const key = parseOrderedTupleText('(7;3)');
    expect(compareCanonical(parseOrderedTupleText('[7#3]', 2), [key], 'ordered_tuple')).toEqual({
      outcome: 'correct',
      credit: 1,
    });
    expect(compareCanonical(parseOrderedTupleText('[3#7]', 2), [key], 'ordered_tuple')).toEqual({
      outcome: 'incorrect',
      credit: 0,
    });
    const half = parseOrderedTupleText('[2#4]', 2);
    const expected = parseOrderedTupleText('(2,-4)');
    expect(compareCanonical(half, [expected], 'ordered_tuple').outcome).toBe('incorrect');
    expect(
      compareCanonical(half, [expected], 'ordered_tuple', undefined, {
        mode: 'per_component',
        creditPerComponent: [0.5, 0.5],
      }),
    ).toEqual({ outcome: 'partial', credit: 0.5 });
  });

  it('par con lecturas ambiguas que cambian el resultado → indecidible', () => {
    expect(
      compareCanonical(
        parseOrderedTupleText('(2,5,3)', 2),
        [parseOrderedTupleText('(2,5;3)')],
        'ordered_tuple',
      ).outcome,
    ).toBe('undecidable');
  });

  it('secuencias por posición; `unordered` las compara como conjunto', () => {
    const key = parseSequenceText('3-1-4-2');
    expect(compareCanonical(parseSequenceText('3 1 4 2'), [key], 'sequence').outcome).toBe(
      'correct',
    );
    expect(compareCanonical(parseSequenceText('1 3 4 2'), [key], 'sequence').outcome).toBe(
      'incorrect',
    );
    expect(
      compareCanonical(parseSequenceText('1 3 4 2'), [key], 'sequence', { unordered: true })
        .outcome,
    ).toBe('correct');
  });

  it('gana la mejor clave; sin claves interpretables es indecidible', () => {
    expect(compareCanonical(scalar('5'), [scalar('4'), scalar('5')], 'integer').outcome).toBe(
      'correct',
    );
    expect(compareCanonical(scalar('5'), [scalar('abc')], 'integer').outcome).toBe('undecidable');
  });

  it('distinto tipo es incorrecta', () => {
    expect(
      compareCanonical(scalar('7'), [parseOrderedTupleText('(7;3)')], 'ordered_tuple').outcome,
    ).toBe('incorrect');
  });
});

describe('resolveNumberConvention', () => {
  it('el formato entero lee el punto como miles; el decimal solo fija la clave', () => {
    const ambiguous = parseNumberText('2.125');
    expect(keyOf(resolveNumberConvention(ambiguous, 'integer', 'answer'))).toBe('n:2125');
    expect(keyOf(resolveNumberConvention(ambiguous, 'decimal', 'key'))).toBe('n:17/8');
    expect(resolveNumberConvention(ambiguous, 'decimal', 'answer')).toBe(ambiguous);
    expect(resolveNumberConvention(ambiguous, null, 'key')).toBe(ambiguous);
    expect(resolveNumberConvention(ambiguous, 'integer', 'answer').issues).not.toContain(
      'ambiguous_thousands_or_decimal',
    );
  });
});

describe('resolveEquivalences', () => {
  it('la pauta manda sobre el valor por defecto y lo indefinido no pisa', () => {
    expect(resolveEquivalences('fraction', { requireSimplified: undefined })).toMatchObject({
      requireSimplified: false,
      acceptDecimalEquivalent: false,
      acceptEquivalentFractions: true,
    });
    expect(resolveEquivalences('decimal').acceptDecimalEquivalent).toBe(true);
    expect(resolveEquivalences('fraction', { acceptDecimalEquivalent: true })).toMatchObject({
      acceptDecimalEquivalent: true,
    });
  });
});

describe('parseWordListText', () => {
  it.each([
    ['Cabeza, tórax, abdomen', 'w:cabeza|torax|abdomen'],
    ['cabeza; TÓRAX y abdomen.', 'w:cabeza|torax|abdomen'],
    ['- cabeza\n- tórax\n- abdomen', 'w:cabeza|torax|abdomen'],
    ['cabeza\ntórax\nabdomen', 'w:cabeza|torax|abdomen'],
    ['cabeza - tórax - abdomen', 'w:cabeza|torax|abdomen'],
    ['ex-presidente, “ciudad”', 'w:ex-presidente|ciudad'],
    ['Abdomen / vientre', 'w:abdomen/vientre'],
  ])('%j → %s', (text, key) => {
    expect(keyOf(parseWordListText(text))).toBe(key);
  });

  it('vacío no se interpreta; palabras de más se marcan', () => {
    expect(isParsed(parseWordListText(' , ; '))).toBe(false);
    expect(parseWordListText(' , ').issues).toContain('empty_part');
    expect(parseWordListText('a, b, c, d', { expectedCount: 3 }).issues).toContain('extra_tokens');
  });
});

describe('compareWordLists', () => {
  const list = (text: string) => {
    const value = primaryReading(parseWordListText(text));
    if (value === null || value.type !== 'word_list') throw new Error(text);
    return value;
  };
  const key = list('Cabeza, tórax, abdomen');
  const thirds = { mode: 'per_component' as const, creditPerComponent: [1 / 3, 1 / 3, 1 / 3] };

  it('igual en orden es correcta; el orden importa salvo unordered', () => {
    expect(compareWordLists(list('cabeza, torax, abdomen'), key, false).outcome).toBe('correct');
    expect(compareWordLists(list('torax, cabeza, abdomen'), key, false).outcome).toBe('incorrect');
    expect(compareWordLists(list('torax, cabeza, abdomen'), key, true).outcome).toBe('correct');
  });

  it('alternativas de la clave valen; una palabra con barra del alumno va a revisión', () => {
    const withSynonym = list('cabeza, tórax, abdomen/vientre');
    expect(compareWordLists(list('cabeza, torax, vientre'), withSynonym, false).outcome).toBe(
      'correct',
    );
    expect(compareWordLists(list('cabeza, torax, abdomen/panza'), key, false).outcome).toBe(
      'undecidable',
    );
  });

  it('falta pequeña en palabra de 5+ letras → revisión; en palabra corta → incorrecta', () => {
    expect(compareWordLists(list('cabeza, torax, abdomem'), key, false).outcome).toBe(
      'undecidable',
    );
    expect(compareWordLists(list('cabeza, torax, abdmen'), key, false).outcome).toBe('undecidable');
    expect(compareWordLists(list('cabeza, torax, abdomenes'), key, false).outcome).toBe(
      'incorrect',
    );
    const short = list('sol, mar');
    expect(compareWordLists(list('sol, mal'), short, false).outcome).toBe('incorrect');
  });

  it('todas las palabras y otras de más va a revisión; faltar una es incorrecta', () => {
    expect(compareWordLists(list('cabeza, torax, abdomen, patas'), key, false).outcome).toBe(
      'undecidable',
    );
    expect(compareWordLists(list('cabeza, torax'), key, false).outcome).toBe('incorrect');
  });

  it('crédito por palabra solo con componentCredit', () => {
    expect(compareWordLists(list('cabeza, torax, patas'), key, false).outcome).toBe('incorrect');
    const partial = compareWordLists(list('cabeza, torax, patas'), key, false, thirds);
    expect(partial.outcome).toBe('partial');
    expect(partial.credit).toBeCloseTo(2 / 3);
    const unordered = compareWordLists(list('patas, cabeza, torax'), key, true, thirds);
    expect(unordered.credit).toBeCloseTo(2 / 3);
    expect(compareWordLists(list('cabeza, torax, abdomem'), key, false, thirds).outcome).toBe(
      'undecidable',
    );
    expect(compareWordLists(list('ala, pata, ojo'), key, false, thirds).outcome).toBe('incorrect');
  });

  it('pesos distintos por palabra eligen la asignación de mayor crédito', () => {
    const weighted = { mode: 'per_component' as const, creditPerComponent: [0.2, 0.2, 0.6] };
    const result = compareWordLists(list('abdomen, ala'), key, true, weighted);
    expect(result.credit).toBeCloseTo(0.6);
  });

  it('compareCanonical usa unordered y componentCredit de la pauta', () => {
    expect(
      compareCanonical(parseWordListText('torax, cabeza, abdomen'), [key], 'word_list', {
        unordered: true,
      }).outcome,
    ).toBe('correct');
  });
});

describe('texto corto', () => {
  it('normaliza espacios, comillas, mayúsculas y puntuación final; conserva tildes', () => {
    expect(normalizeShortText('  “Pedro   is cooking.” ')).toBe('pedro is cooking');
    expect(normalizeShortText('¿Dónde está?')).toBe('dónde está');
    expect(normalizeShortText('Pedro’s car')).toBe("pedro's car");
    expect(normalizeShortText('Pedro', true)).toBe('Pedro');
    expect(keyOf(parseShortText('Pedro is cooking.'))).toBe('x:pedro is cooking');
    expect(isParsed(parseShortText(' ... '))).toBe(false);
  });

  it('exacto normalizado es correcto; cualquier otra diferencia es indecidible', () => {
    expect(compareShortText('pedro is cooking', ['Pedro is cooking.']).outcome).toBe('correct');
    expect(compareShortText('Pedro cooks', ['Pedro is cooking.']).outcome).toBe('undecidable');
    expect(compareShortText('esta', ['está']).outcome).toBe('undecidable');
    expect(compareShortText('   ', ['está']).outcome).toBe('incorrect');
  });
});
