import { parsePositionalMatchingAnswer } from './matching-answer';

const LEFT = [{ id: 'B.1' }, { id: 'B.2' }, { id: 'B.3' }, { id: 'B.4' }];
const RIGHT = [{ id: 'A.1' }, { id: 'A.2' }, { id: 'A.3' }, { id: 'A.4' }, { id: 'A.5' }];

describe('parsePositionalMatchingAnswer', () => {
  it('mapea la secuencia posicional al par leftId → rightId', () => {
    expect(parsePositionalMatchingAnswer('2,5,3,4', LEFT, RIGHT)).toEqual({
      'B.1': 'A.2',
      'B.2': 'A.5',
      'B.3': 'A.3',
      'B.4': 'A.4',
    });
  });

  it('acepta los separadores que aparecen en las planillas', () => {
    const expected = { 'B.1': 'A.2', 'B.2': 'A.5', 'B.3': 'A.3', 'B.4': 'A.4' };
    expect(parsePositionalMatchingAnswer('2 5 3 4', LEFT, RIGHT)).toEqual(expected);
    expect(parsePositionalMatchingAnswer('2;5;3;4', LEFT, RIGHT)).toEqual(expected);
    expect(parsePositionalMatchingAnswer('2/5/3/4', LEFT, RIGHT)).toEqual(expected);
  });

  it('descarta el dígito que no corresponde a ninguna columna, y conserva el resto', () => {
    expect(parsePositionalMatchingAnswer('2,5,3,9', LEFT, RIGHT)).toEqual({
      'B.1': 'A.2',
      'B.2': 'A.5',
      'B.3': 'A.3',
    });
  });

  it('acepta una respuesta incompleta sin anular los pares respondidos', () => {
    expect(parsePositionalMatchingAnswer('2,5', LEFT, RIGHT)).toEqual({
      'B.1': 'A.2',
      'B.2': 'A.5',
    });
  });

  it('ignora los sobrantes cuando la celda trae más valores que pares', () => {
    expect(parsePositionalMatchingAnswer('2,5,3,4,1,1', LEFT, RIGHT)).toEqual({
      'B.1': 'A.2',
      'B.2': 'A.5',
      'B.3': 'A.3',
      'B.4': 'A.4',
    });
  });

  it('devuelve null cuando no hay nada utilizable', () => {
    expect(parsePositionalMatchingAnswer(null, LEFT, RIGHT)).toBeNull();
    expect(parsePositionalMatchingAnswer('', LEFT, RIGHT)).toBeNull();
    expect(parsePositionalMatchingAnswer('   ', LEFT, RIGHT)).toBeNull();
    expect(parsePositionalMatchingAnswer('9,9,9,9', LEFT, RIGHT)).toBeNull();
  });

  it('usa el número final del id, no su posición en la lista', () => {
    const right = [{ id: 'A.3' }, { id: 'A.1' }, { id: 'A.2' }];
    expect(parsePositionalMatchingAnswer('1,2,3', LEFT, right)).toEqual({
      'B.1': 'A.1',
      'B.2': 'A.2',
      'B.3': 'A.3',
    });
  });
});
