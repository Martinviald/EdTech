import { responseOutcome } from './response-display';

describe('responseOutcome', () => {
  it('sin corregir no es incorrecta', () => {
    expect(responseOutcome({ isCorrect: null, score: null, maxScore: 1, hasAnswer: true })).toBe(
      'ungraded',
    );
  });

  it('sin corregir y sin respuesta es "no respondió"', () => {
    expect(responseOutcome({ isCorrect: null, score: null, maxScore: 1, hasAnswer: false })).toBe(
      'unanswered',
    );
  });

  it('el puntaje máximo es correcta', () => {
    expect(responseOutcome({ isCorrect: true, score: 1, maxScore: 1, hasAnswer: true })).toBe(
      'correct',
    );
  });

  it('un puntaje entre 0 y el máximo es parcial, aunque isCorrect sea false', () => {
    expect(responseOutcome({ isCorrect: false, score: 0.5, maxScore: 1, hasAnswer: true })).toBe(
      'partial',
    );
    expect(responseOutcome({ isCorrect: false, score: 3, maxScore: 4, hasAnswer: true })).toBe(
      'partial',
    );
  });

  it('cero puntos con respuesta es incorrecta', () => {
    expect(responseOutcome({ isCorrect: false, score: 0, maxScore: 1, hasAnswer: true })).toBe(
      'incorrect',
    );
  });

  it('cero puntos sin respuesta es "no respondió"', () => {
    expect(responseOutcome({ isCorrect: false, score: 0, maxScore: 1, hasAnswer: false })).toBe(
      'unanswered',
    );
  });
});
