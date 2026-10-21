import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from 'openai';

import { DecisionError } from '../contracts';
import { choice, noul, score } from '../questions';
import {
  describe as describeValue,
  mapSdkError,
  parseDecisionResponse,
  toOpenAiInput,
  toOpenAiQuestions,
} from './openai-mapping';

function fixture(name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
  return parsed;
}

function sdkError(status: number, message: string): APIError {
  return APIError.generate(
    status,
    { message, type: 'invalid_request_error' },
    message,
    new Headers(),
  );
}

const judgeQuestions = {
  clave: choice('¿Cuál es la clave?', { A: null, B: null, C: null, D: null }),
  respuesta_unica: noul('¿Tiene una única respuesta correcta?'),
  dificultad: score('¿Qué tan difícil es?', ['baja', 'media', 'alta']),
};

function parseError(questions: Parameters<typeof parseDecisionResponse>[0], raw: unknown) {
  try {
    parseDecisionResponse(questions, raw);
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba que parseDecisionResponse lanzara');
}

describe('toOpenAiQuestions', () => {
  it('traduce noul a predicate con los criterios en las instrucciones', () => {
    const result = toOpenAiQuestions({
      urgente: noul('¿Es urgente?', { true: 'pide ayuda ya', false: 'solo consulta' }),
    });
    expect(result).toEqual([
      {
        type: 'predicate',
        name: 'urgente',
        instructions: '¿Es urgente?\nVerdadero si: pide ayuda ya\nFalso si: solo consulta',
      },
    ]);
  });

  it('deja las instrucciones intactas si noul no trae criterios', () => {
    const [question] = toOpenAiQuestions({ q: noul('¿Sí?') });
    expect(question).toEqual({ type: 'predicate', name: 'q', instructions: '¿Sí?' });
  });

  it('agrega solo el criterio presente', () => {
    const [question] = toOpenAiQuestions({ q: noul('¿Sí?', { false: 'no' }) });
    expect(question).toMatchObject({ instructions: '¿Sí?\nFalso si: no' });
  });

  it('traduce choice a choices y omite description si es null', () => {
    const [question] = toOpenAiQuestions({
      area: choice('¿Qué área?', { billing: 'cobros', tech: null }),
    });
    expect(question).toEqual({
      type: 'choice',
      name: 'area',
      instructions: '¿Qué área?',
      choices: [{ value: 'billing', description: 'cobros' }, { value: 'tech' }],
    });
    const choices = question?.type === 'choice' ? question.choices : [];
    expect(choices[1]).not.toHaveProperty('description');
  });

  it('traduce score a levels con la etiqueta "Nivel i"', () => {
    const [question] = toOpenAiQuestions({ q: score('¿Calidad?', ['mala', 'regular', 'buena']) });
    expect(question).toEqual({
      type: 'score',
      name: 'q',
      instructions: '¿Calidad?',
      levels: [
        { label: 'Nivel 0', description: 'mala' },
        { label: 'Nivel 1', description: 'regular' },
        { label: 'Nivel 2', description: 'buena' },
      ],
    });
  });

  it('serializa las Description en JSON y usa el id como name', () => {
    const result = toOpenAiQuestions({
      uno: choice({ pregunta: '¿Cuál?', datos: ['a'] }, { x: { label: 'X' }, y: ['lista'] }),
    });
    expect(result).toEqual([
      {
        type: 'choice',
        name: 'uno',
        instructions: '{"pregunta":"¿Cuál?","datos":["a"]}',
        choices: [
          { value: 'x', description: '{"label":"X"}' },
          { value: 'y', description: '["lista"]' },
        ],
      },
    ]);
    expect(describeValue('texto')).toBe('texto');
  });
});

describe('toOpenAiInput', () => {
  it('devuelve el string tal cual sin imágenes', () => {
    expect(toOpenAiInput('hola')).toBe('hola');
    expect(toOpenAiInput('hola', [])).toBe('hola');
  });

  it('serializa un estado JSON', () => {
    expect(toOpenAiInput({ a: 1, b: ['x'] })).toBe('{"a":1,"b":["x"]}');
  });

  it('arma un mensaje user con input_text e input_image', () => {
    const input = toOpenAiInput('mira esto', [
      { mimeType: 'image/png', data: 'QUJD' },
      { url: 'https://cdn.test/figura.png?firma=1' },
    ]);
    expect(input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'mira esto' },
          { type: 'input_image', image_url: 'data:image/png;base64,QUJD' },
          { type: 'input_image', image_url: 'https://cdn.test/figura.png?firma=1' },
        ],
      },
    ]);
  });

  it('serializa un estado JSON también junto a imágenes', () => {
    const input = toOpenAiInput({ k: 1 }, [{ url: 'https://cdn.test/a.png' }]);
    expect(input).toMatchObject([{ content: [{ type: 'input_text', text: '{"k":1}' }, {}] }]);
  });
});

describe('parseDecisionResponse', () => {
  it('parsea la respuesta real de texto (choice, predicate y score)', () => {
    const parsed = parseDecisionResponse(judgeQuestions, fixture('texto_juez.json'));
    const clave: 'A' | 'B' | 'C' | 'D' = parsed.answers.clave.choice;

    expect(parsed.model).toBe('gpt-6-luna');
    expect(parsed.usage).toEqual({ inputTokens: 498, outputTokens: 0 });
    expect(clave).toBe('B');
    expect(parsed.answers.clave).toEqual({
      type: 'choice',
      choice: 'B',
      probabilities: { A: 0, B: 1, C: 0, D: 0 },
      confidence: 1,
    });
    expect(parsed.answers.respuesta_unica).toEqual({ type: 'noul', probability: 1 });
    expect(parsed.answers.dificultad).toEqual({
      type: 'score',
      score: 0.01,
      level: 0,
      probabilities: [0.99, 0.01, 0],
      confidence: 0.99,
    });
  });

  it('parsea la respuesta real con imagen', () => {
    const parsed = parseDecisionResponse(
      {
        es_triangulo: noul('¿Es un triángulo?'),
        tipo_figura: choice('¿Qué tipo?', { geometrica: null, grafico: null, fotografia: null }),
      },
      fixture('imagen_data_url.json'),
    );
    expect(parsed.answers.es_triangulo.probability).toBe(1);
    expect(parsed.answers.tipo_figura.choice).toBe('geometrica');
    expect(parsed.usage.inputTokens).toBe(438);
  });

  it('lanza refused y menciona el id rechazado (refusal.json)', () => {
    const error = parseError(
      {
        instrucciones_completas: noul('¿Están completas?'),
        mejor_precursor: choice('¿Cuál?', { a: null, b: null }),
      },
      fixture('refusal.json'),
    );
    expect(error).toBeInstanceOf(DecisionError);
    expect(error).toMatchObject({ code: 'refused' });
    expect(error instanceof Error && error.message).toContain('"mejor_precursor"');
    expect(error instanceof Error && error.message).not.toContain('instrucciones_completas');
  });

  it('lanza refused si todas las respuestas son refusal', () => {
    const error = parseError({ a: noul('?') }, fixture('ambigua_nombre_normal.json'));
    expect(error).toMatchObject({ code: 'refused' });
    expect(error instanceof Error && error.message).toContain('"a"');
  });

  it('deja en 0 las opciones ausentes en probabilities', () => {
    const parsed = parseDecisionResponse(
      { q: choice('?', { a: null, b: null, c: null }) },
      {
        model: 'gpt-6-luna',
        answers: [
          {
            type: 'choice',
            name: 'q',
            choice: 'a',
            probabilities: [{ value: 'a', probability: 0.7 }],
            confidence: 0.5,
          },
        ],
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    );
    expect(parsed.answers.q.probabilities).toEqual({ a: 0.7, b: 0, c: 0 });
  });

  it('calcula level como el argmax de las probabilidades', () => {
    const parsed = parseDecisionResponse(
      { q: score('?', ['a', 'b', 'c']) },
      {
        model: 'gpt-6-luna',
        answers: [
          {
            type: 'score',
            name: 'q',
            score: 1.6,
            probabilities: [
              { value: 0, label: 'Nivel 0', probability: 0.1 },
              { value: 2, label: 'Nivel 2', probability: 0.6 },
            ],
            confidence: 0.4,
          },
        ],
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    );
    expect(parsed.answers.q).toMatchObject({ level: 2, probabilities: [0.1, 0, 0.6] });
  });

  describe('respuestas malformadas', () => {
    const questions = { q: noul('?') };
    const usage = { input_tokens: 1, output_tokens: 0 };
    const okAnswer = { type: 'predicate', name: 'q', probability: 0.5 };

    it.each<[string, unknown]>([
      ['el cuerpo no es un objeto', 'texto'],
      ['null', null],
      ['falta model', { answers: [okAnswer], usage }],
      ['model vacío', { model: '', answers: [okAnswer], usage }],
      ['falta answers', { model: 'm', usage }],
      ['falta la respuesta a la pregunta', { model: 'm', answers: [], usage }],
      [
        'name repetido',
        { model: 'm', answers: [okAnswer, { ...okAnswer, probability: 0.1 }], usage },
      ],
      [
        'respuesta sin name',
        { model: 'm', answers: [{ type: 'predicate', probability: 1 }], usage },
      ],
      ['respuesta que no es objeto', { model: 'm', answers: ['x'], usage }],
      [
        'tipo equivocado',
        { model: 'm', answers: [{ type: 'score', name: 'q', probability: 0.5 }], usage },
      ],
      [
        'probabilidad no numérica',
        { model: 'm', answers: [{ type: 'predicate', name: 'q', probability: 'alta' }], usage },
      ],
      ['falta usage', { model: 'm', answers: [okAnswer] }],
      [
        'usage sin tokens numéricos',
        { model: 'm', answers: [okAnswer], usage: { input_tokens: 'x' } },
      ],
    ])('%s → upstream', (_label, raw) => {
      const error = parseError(questions, raw);
      expect(error).toBeInstanceOf(DecisionError);
      expect(error).toMatchObject({ code: 'upstream' });
    });

    it('choice inexistente → upstream', () => {
      const error = parseError(
        { q: choice('?', { a: null, b: null }) },
        {
          model: 'm',
          answers: [
            {
              type: 'choice',
              name: 'q',
              choice: 'z',
              probabilities: [{ value: 'a', probability: 1 }],
              confidence: 1,
            },
          ],
          usage,
        },
      );
      expect(error).toMatchObject({ code: 'upstream' });
    });

    it('probabilidad de una opción no numérica → upstream', () => {
      const error = parseError(
        { q: choice('?', { a: null, b: null }) },
        {
          model: 'm',
          answers: [
            {
              type: 'choice',
              name: 'q',
              choice: 'a',
              probabilities: [{ value: 'a', probability: 'x' }],
              confidence: 1,
            },
          ],
          usage,
        },
      );
      expect(error).toMatchObject({ code: 'upstream' });
    });

    it('score sin probabilities → upstream', () => {
      const error = parseError(
        { q: score('?', ['a', 'b']) },
        {
          model: 'm',
          answers: [{ type: 'score', name: 'q', score: 0.5, confidence: 1 }],
          usage,
        },
      );
      expect(error).toMatchObject({ code: 'upstream' });
    });
  });
});

describe('mapSdkError', () => {
  it('genera instancias reales de las clases del SDK', () => {
    expect(sdkError(401, 'x')).toBeInstanceOf(AuthenticationError);
    expect(sdkError(403, 'x')).toBeInstanceOf(PermissionDeniedError);
    expect(sdkError(429, 'x')).toBeInstanceOf(RateLimitError);
    expect(sdkError(400, 'x')).toBeInstanceOf(BadRequestError);
    expect(sdkError(404, 'x')).toBeInstanceOf(NotFoundError);
    expect(sdkError(422, 'x')).toBeInstanceOf(UnprocessableEntityError);
    expect(sdkError(500, 'x')).toBeInstanceOf(InternalServerError);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [400, 'invalid_request'],
    [404, 'invalid_request'],
    [422, 'invalid_request'],
    [500, 'upstream'],
    [503, 'upstream'],
  ])('traduce el status %i a %s y conserva la causa', (status, code) => {
    const original = sdkError(status, 'falla simulada');
    const mapped = mapSdkError(original);
    expect(mapped).toBeInstanceOf(DecisionError);
    expect(mapped.code).toBe(code);
    expect(mapped.cause).toBe(original);
  });

  it('traduce un 400 por límite de tokens a context_exceeded', () => {
    const mapped = mapSdkError(sdkError(400, 'Decision input exceeds the token limit.'));
    expect(mapped.code).toBe('context_exceeded');
  });

  it('traduce el timeout y la cancelación', () => {
    expect(mapSdkError(new APIConnectionTimeoutError()).code).toBe('timeout');
    expect(mapSdkError(new APIUserAbortError()).code).toBe('aborted');
  });

  it('traduce un Error genérico y un valor no-Error a upstream', () => {
    expect(mapSdkError(new Error('boom'))).toMatchObject({ code: 'upstream' });
    expect(mapSdkError('raro')).toMatchObject({ code: 'upstream' });
    expect(mapSdkError(new Error('boom')).message).toContain('boom');
  });

  it('pasa un DecisionError tal cual', () => {
    const original = new DecisionError('refused', 'no');
    expect(mapSdkError(original)).toBe(original);
  });
});
