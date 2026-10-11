import { buildEditedLiteral, editShapeFor, initialParts, type EditShape } from './edit-answer';

const FRACTION: EditShape = { kind: 'fraction', allowNegative: false, mixed: false };
const MIXED: EditShape = { kind: 'fraction', allowNegative: false, mixed: true };
const PAIR: EditShape = { kind: 'tuple', arity: 2, componentKind: 'integer' };
const BOXES: EditShape = {
  kind: 'multi_box',
  boxes: [
    { label: 'a', kind: 'integer' },
    { label: 'b', kind: 'short_text' },
  ],
};

describe('editShapeFor', () => {
  it('toma la forma del responseFormat del ítem', () => {
    expect(editShapeFor({ kind: 'fraction', allowNegative: true, allowMixed: true })).toEqual({
      kind: 'fraction',
      allowNegative: true,
      mixed: true,
    });
    expect(editShapeFor({ kind: 'ordered_tuple', arity: 3, componentKind: 'decimal' })).toEqual({
      kind: 'tuple',
      arity: 3,
      componentKind: 'decimal',
    });
    expect(
      editShapeFor({
        kind: 'multi_box',
        boxes: [
          { partId: 'x', label: 'x', kind: 'integer' },
          { partId: 'y', label: 'y', kind: 'fraction' },
        ],
      }),
    ).toEqual({
      kind: 'multi_box',
      boxes: [
        { label: 'x', kind: 'integer' },
        { label: 'y', kind: 'fraction' },
      ],
    });
  });

  it('usa texto libre en los demás formatos', () => {
    expect(editShapeFor({ kind: 'short_text', maxWords: 3 })).toEqual({
      kind: 'text',
      multiline: false,
    });
    expect(editShapeFor({ kind: 'free_text', lines: 4 })).toEqual({
      kind: 'text',
      multiline: true,
    });
  });
});

describe('initialParts', () => {
  it('separa la propuesta según la forma', () => {
    expect(initialParts(FRACTION, '21/10')).toEqual(['21', '10']);
    expect(initialParts(MIXED, '2 1/10')).toEqual(['2', '1', '10']);
    expect(initialParts(MIXED, '21/10')).toEqual(['', '21', '10']);
    expect(initialParts(PAIR, '(2;-4)')).toEqual(['2', '-4']);
    expect(initialParts(BOXES, '4')).toEqual(['4', '']);
    expect(initialParts({ kind: 'integer', allowNegative: true }, null)).toEqual(['']);
  });
});

describe('buildEditedLiteral', () => {
  it('arma la fracción y rechaza denominador vacío, 0 o negativos no admitidos', () => {
    expect(buildEditedLiteral(FRACTION, ['21', '10'])).toEqual({ ok: true, literal: '21/10' });
    expect(buildEditedLiteral(FRACTION, ['21', ''])).toMatchObject({ ok: false });
    expect(buildEditedLiteral(FRACTION, ['21', '0'])).toEqual({
      ok: false,
      message: 'El denominador no puede ser 0',
    });
    expect(buildEditedLiteral(FRACTION, ['-1', '2'])).toEqual({
      ok: false,
      message: 'Esta pregunta no admite números negativos',
    });
  });

  it('arma el número mixto solo si hay parte entera', () => {
    expect(buildEditedLiteral(MIXED, ['2', '1', '10'])).toEqual({ ok: true, literal: '2 1/10' });
    expect(buildEditedLiteral(MIXED, ['', '21', '10'])).toEqual({ ok: true, literal: '21/10' });
  });

  it('arma el par con punto y coma y valida el tipo de componente', () => {
    expect(buildEditedLiteral(PAIR, [' 2 ', '-4'])).toEqual({ ok: true, literal: '(2;-4)' });
    expect(buildEditedLiteral(PAIR, ['2', ''])).toEqual({
      ok: false,
      message: 'Completa todos los componentes del par',
    });
    expect(buildEditedLiteral(PAIR, ['2', 'x'])).toEqual({
      ok: false,
      message: 'Cada componente del par debe ser un número entero',
    });
  });

  it('arma la multicasilla con barras y valida cada casilla según su tipo', () => {
    expect(buildEditedLiteral(BOXES, ['4', 'cinco'])).toEqual({ ok: true, literal: '4|cinco' });
    expect(buildEditedLiteral(BOXES, ['4'])).toEqual({
      ok: false,
      message: 'Completa todas las casillas',
    });
    expect(buildEditedLiteral(BOXES, ['cuatro', 'cinco'])).toEqual({
      ok: false,
      message: 'La casilla «a» debe ser un número entero',
    });
  });

  it('valida enteros y decimales', () => {
    const integer: EditShape = { kind: 'integer', allowNegative: true };
    const decimal: EditShape = { kind: 'decimal', allowNegative: false };
    expect(buildEditedLiteral(integer, ['-12'])).toEqual({ ok: true, literal: '-12' });
    expect(buildEditedLiteral(integer, ['1,5'])).toMatchObject({ ok: false });
    expect(buildEditedLiteral(decimal, ['2,5'])).toEqual({ ok: true, literal: '2,5' });
    expect(buildEditedLiteral(decimal, ['-2,5'])).toMatchObject({ ok: false });
    expect(buildEditedLiteral(decimal, ['dos'])).toMatchObject({ ok: false });
  });

  it('exige texto y respeta el máximo del contrato', () => {
    expect(buildEditedLiteral({ kind: 'text', multiline: false }, ['  '])).toMatchObject({
      ok: false,
    });
    expect(buildEditedLiteral({ kind: 'text', multiline: true }, ['a'.repeat(501)])).toMatchObject({
      ok: false,
    });
  });
});
