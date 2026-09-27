import { buildJudgeDecision } from './judge-decision';

const item = {
  stem: '  ¿Qué producen las abejas?  ',
  alternatives: [
    { key: 'A', text: 'Miel' },
    { key: 'B', text: 'Lana' },
  ],
};

describe('buildJudgeDecision', () => {
  it('con pasaje, el estado lo incluye y las preguntas lo nombran', () => {
    const { state, questions } = buildJudgeDecision(
      { title: 'Las abejas', text: ' Producen miel. ' },
      item,
    );

    expect(state).toEqual({
      pasaje: { titulo: 'Las abejas', texto: 'Producen miel.' },
      pregunta: '¿Qué producen las abejas?',
      alternativas: { A: 'Miel', B: 'Lana' },
    });
    expect(questions.clave.criteria).toEqual({ A: 'Miel', B: 'Lana' });
    expect(questions.clave.instructions).toContain('`pasaje`');
    expect(questions.habilidad.instructions).toContain('`pasaje`');
  });

  it('sin pasaje (o con pasaje vacío), el estado no lo trae y ninguna pregunta lo nombra', () => {
    for (const stimulus of [null, { title: 'x', text: '   ' }]) {
      const { state, questions } = buildJudgeDecision(stimulus, item);

      expect(state).toEqual({
        pregunta: '¿Qué producen las abejas?',
        alternativas: { A: 'Miel', B: 'Lana' },
      });
      expect(JSON.stringify(questions)).not.toContain('`pasaje`');
    }
  });

  it('arma las cuatro preguntas con sus tipos', () => {
    const { questions } = buildJudgeDecision(null, item);

    expect(questions.clave.type).toBe('choice');
    expect(questions.respuesta_unica.type).toBe('noul');
    expect(questions.factual.type).toBe('noul');
    expect(questions.habilidad.type).toBe('noul');
  });
});
