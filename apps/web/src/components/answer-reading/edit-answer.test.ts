import { buildEditedLiteral, editShapeFor, initialParts } from './edit-answer';
import { reader, readingGroup } from './test-fixtures';

describe('editShapeFor', () => {
  it('usa dos cajas para una fracción', () => {
    expect(editShapeFor(readingGroup())).toEqual({ kind: 'fraction' });
  });

  it('deduce la aridad del par desde las lecturas y usa 2 por defecto', () => {
    expect(
      editShapeFor(readingGroup({ formatKind: 'ordered_tuple', displayValue: null, readers: [] })),
    ).toEqual({ kind: 'tuple', arity: 2 });
    expect(
      editShapeFor(
        readingGroup({
          formatKind: 'ordered_tuple',
          displayValue: '(1;2)',
          readers: [reader({ literal: '(1;2;3)' })],
        }),
      ),
    ).toEqual({ kind: 'tuple', arity: 3 });
  });

  it('usa una caja por casilla en multicasilla', () => {
    expect(
      editShapeFor(readingGroup({ formatKind: 'multi_box', displayValue: '4|5|6', readers: [] })),
    ).toEqual({ kind: 'multi_box', boxes: 3 });
  });

  it('usa texto libre en los demás formatos', () => {
    expect(editShapeFor(readingGroup({ formatKind: 'short_text' }))).toEqual({
      kind: 'text',
      multiline: false,
    });
    expect(editShapeFor(readingGroup({ formatKind: 'free_text' }))).toEqual({
      kind: 'text',
      multiline: true,
    });
  });
});

describe('initialParts', () => {
  it('separa la propuesta según la forma', () => {
    expect(initialParts({ kind: 'fraction' }, '21/10')).toEqual(['21', '10']);
    expect(initialParts({ kind: 'tuple', arity: 2 }, '(2;-4)')).toEqual(['2', '-4']);
    expect(initialParts({ kind: 'multi_box', boxes: 3 }, '4|5')).toEqual(['4', '5', '']);
    expect(initialParts({ kind: 'integer' }, null)).toEqual(['']);
  });
});

describe('buildEditedLiteral', () => {
  it('arma la fracción y rechaza denominador vacío o 0', () => {
    expect(buildEditedLiteral({ kind: 'fraction' }, ['21', '10'])).toEqual({
      ok: true,
      literal: '21/10',
    });
    expect(buildEditedLiteral({ kind: 'fraction' }, ['21', ''])).toMatchObject({ ok: false });
    expect(buildEditedLiteral({ kind: 'fraction' }, ['21', '0'])).toEqual({
      ok: false,
      message: 'El denominador no puede ser 0',
    });
  });

  it('arma el par con punto y coma y exige todos los componentes', () => {
    expect(buildEditedLiteral({ kind: 'tuple', arity: 2 }, [' 2 ', '-4'])).toEqual({
      ok: true,
      literal: '(2;-4)',
    });
    expect(buildEditedLiteral({ kind: 'tuple', arity: 2 }, ['2', ''])).toEqual({
      ok: false,
      message: 'Completa todos los componentes del par',
    });
  });

  it('arma la multicasilla con barras y exige todas las casillas', () => {
    expect(buildEditedLiteral({ kind: 'multi_box', boxes: 2 }, ['4', 'cinco'])).toEqual({
      ok: true,
      literal: '4|cinco',
    });
    expect(buildEditedLiteral({ kind: 'multi_box', boxes: 2 }, ['4'])).toMatchObject({
      ok: false,
    });
  });

  it('valida enteros y decimales', () => {
    expect(buildEditedLiteral({ kind: 'integer' }, ['-12'])).toEqual({ ok: true, literal: '-12' });
    expect(buildEditedLiteral({ kind: 'integer' }, ['1,5'])).toMatchObject({ ok: false });
    expect(buildEditedLiteral({ kind: 'decimal' }, ['2,5'])).toEqual({ ok: true, literal: '2,5' });
    expect(buildEditedLiteral({ kind: 'decimal' }, ['dos'])).toMatchObject({ ok: false });
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
