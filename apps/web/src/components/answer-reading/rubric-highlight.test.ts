import { highlightQuotes } from './rubric-highlight';

describe('highlightQuotes', () => {
  it('marca cada cita encontrada sin distinguir mayúsculas ni espacios', () => {
    expect(
      highlightQuotes('Porque el río se\ndesbordó y tapó las calles', ['El río se desbordó']),
    ).toEqual([
      { text: 'Porque ', highlighted: false },
      { text: 'el río se\ndesbordó', highlighted: true },
      { text: ' y tapó las calles', highlighted: false },
    ]);
  });

  it('une citas que se superponen y escapa caracteres especiales', () => {
    expect(highlightQuotes('x = (3 + 4) * 2', ['(3 + 4)', '4) * 2'])).toEqual([
      { text: 'x = ', highlighted: false },
      { text: '(3 + 4) * 2', highlighted: true },
    ]);
  });

  it('deja el texto intacto si ninguna cita aparece', () => {
    expect(highlightQuotes('sin coincidencias', ['otra cosa', '   '])).toEqual([
      { text: 'sin coincidencias', highlighted: false },
    ]);
  });
});
