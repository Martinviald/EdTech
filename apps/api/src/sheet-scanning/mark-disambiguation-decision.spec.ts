import { PAIR_VERDICT_VALUES } from '@soe/decisions';
import { PAIR_VERDICTS, type LayoutField } from '@soe/types';
import {
  buildMarkDisambiguationDecision,
  collidesWithReservedAnswers,
  markDisambiguationChoiceKeys,
  markDisambiguationOptions,
  MARK_DISAMBIGUATION_DECISION_VERSION,
} from './mark-disambiguation-decision';

function field(bubbles: Array<{ value: string; x: number }>): Pick<LayoutField, 'bubbles'> {
  return {
    bubbles: bubbles.map((bubble) => ({
      value: bubble.value,
      center: { x: bubble.x, y: 0.5 },
      radius: 0.01,
    })),
  };
}

describe('mark-disambiguation-decision', () => {
  it('los veredictos persistidos de @soe/types son los mismos del combinador', () => {
    expect([...PAIR_VERDICTS]).toEqual([...PAIR_VERDICT_VALUES]);
  });

  it('toma las opciones de las burbujas del campo, ordenadas por x', () => {
    expect(
      markDisambiguationOptions(
        field([
          { value: 'C', x: 0.3 },
          { value: 'A', x: 0.1 },
          { value: 'D', x: 0.4 },
          { value: 'B', x: 0.2 },
        ]),
      ),
    ).toEqual(['A', 'B', 'C', 'D']);
  });

  it('agrega blank y null a las claves de la pregunta', () => {
    const decision = buildMarkDisambiguationDecision(['V', 'F']);
    expect(Object.keys(decision.questions.respuesta.criteria)).toEqual(['V', 'F', 'blank', 'null']);
    expect(markDisambiguationChoiceKeys(['V', 'F'])).toEqual(['V', 'F', 'blank', 'null']);
  });

  it('describe los rótulos en orden y no lleva datos del alumno en el estado', () => {
    const decision = buildMarkDisambiguationDecision(['A', 'B', 'C', 'D']);
    expect(decision.state).toEqual({ descripcion: expect.stringContaining('rótulos A, B, C, D') });
    expect(Object.keys(decision.state as Record<string, unknown>)).toEqual(['descripcion']);
    expect(decision.questions.respuesta.type).toBe('choice');
    expect(MARK_DISAMBIGUATION_DECISION_VERSION).toBe('mark-disambiguation-v1');
  });

  it('detecta y rechaza rótulos que chocan con blank o null', () => {
    expect(collidesWithReservedAnswers(['A', 'blank'])).toBe(true);
    expect(collidesWithReservedAnswers(['null', 'B'])).toBe(true);
    expect(collidesWithReservedAnswers(['A', 'B'])).toBe(false);
    expect(() => buildMarkDisambiguationDecision(['A', 'null'])).toThrow();
    expect(() => buildMarkDisambiguationDecision([])).toThrow();
  });
});
