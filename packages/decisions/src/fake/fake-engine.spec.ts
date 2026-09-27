import { DecisionError } from '../contracts';
import { choice, noul, score } from '../questions';
import { FAKE_MODEL, FakeDecisionEngine } from './fake-engine';

const questions = {
  urgente: noul('¿Es urgente?'),
  area: choice('¿Qué área?', { billing: null, tech: null, sales: null }),
  calidad: score('¿Calidad?', ['mala', 'regular', 'buena']),
};

describe('FakeDecisionEngine', () => {
  it('responde defaults neutros por tipo', async () => {
    const engine = new FakeDecisionEngine();
    const result = await engine.evaluate({ state: 'estado', questions });

    expect(result.engine).toBe('fake');
    expect(result.model).toBe(FAKE_MODEL);
    expect(result.answers.urgente).toEqual({ type: 'noul', probability: 0.5 });
    expect(result.answers.area).toEqual({
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 1 / 3, tech: 1 / 3, sales: 1 / 3 },
      confidence: 0,
    });
    expect(result.answers.calidad).toEqual({
      type: 'score',
      score: 1,
      level: 0,
      probabilities: [1 / 3, 1 / 3, 1 / 3],
      confidence: 0,
    });
  });

  it('usa respuestas programadas fijas y por función, y tipa la opción elegida', async () => {
    const engine = new FakeDecisionEngine({
      answers: {
        urgente: { type: 'noul', probability: 0.97 },
        area: (state) => ({
          type: 'choice',
          choice: state === 'me cobraron dos veces' ? 'billing' : 'tech',
          probabilities: { billing: 0.9, tech: 0.05, sales: 0.05 },
          confidence: 0.8,
        }),
      },
    });

    const result = await engine.evaluate({ state: 'me cobraron dos veces', questions });
    const area: 'billing' | 'tech' | 'sales' = result.answers.area.choice;

    expect(result.answers.urgente.probability).toBe(0.97);
    expect(area).toBe('billing');
    expect(result.answers.area.confidence).toBe(0.8);
  });

  it('registra cada llamada, también las que fallan', async () => {
    const engine = new FakeDecisionEngine();
    await engine.evaluate({ state: 'uno', questions, model: 'fake-2' });
    await expect(engine.evaluate({ state: 'dos', questions: {} })).rejects.toMatchObject({
      code: 'invalid_request',
    });

    expect(engine.calls.map((c) => c.state)).toEqual(['uno', 'dos']);
    expect(engine.calls[0]?.model).toBe('fake-2');
    engine.reset();
    expect(engine.calls).toHaveLength(0);
  });

  it('valida los límites igual que el motor real', async () => {
    const tooMany: Record<string, null> = {};
    for (let i = 0; i < 256; i += 1) tooMany[`o${i}`] = null;
    const engine = new FakeDecisionEngine();

    await expect(
      engine.evaluate({ state: 's', questions: { q: choice('?', tooMany) } }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      engine.evaluate({ state: 's', questions: { q: score('?', ['uno']) } }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('lanza unavailable cuando se marca no disponible', async () => {
    const engine = new FakeDecisionEngine({ available: false });
    expect(engine.isAvailable()).toBe(false);
    await expect(engine.evaluate({ state: 's', questions })).rejects.toMatchObject({
      code: 'unavailable',
    });

    engine.available = true;
    await expect(engine.evaluate({ state: 's', questions })).resolves.toBeDefined();
  });

  it('lanza el error programado', async () => {
    const error = new DecisionError('rate_limited', 'simulado');
    const engine = new FakeDecisionEngine({ error });
    await expect(engine.evaluate({ state: 's', questions })).rejects.toBe(error);

    engine.error = undefined;
    await expect(engine.evaluate({ state: 's', questions })).resolves.toBeDefined();
  });

  it('rechaza con upstream una respuesta programada de otro tipo u opción inexistente', async () => {
    const wrongType = new FakeDecisionEngine({
      answers: {
        urgente: { type: 'noul', probability: 1 },
        area: { type: 'noul', probability: 1 },
      },
    });
    await expect(wrongType.evaluate({ state: 's', questions })).rejects.toMatchObject({
      code: 'upstream',
    });

    const wrongOption = new FakeDecisionEngine({
      answers: {
        area: {
          type: 'choice',
          choice: 'marketing',
          probabilities: { marketing: 1 },
          confidence: 1,
        },
      },
    });
    await expect(wrongOption.evaluate({ state: 's', questions })).rejects.toMatchObject({
      code: 'upstream',
    });
  });
});
