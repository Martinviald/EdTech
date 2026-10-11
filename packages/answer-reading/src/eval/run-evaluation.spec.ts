import { DEFAULT_CONSENSUS_POLICY, type ReaderSpec } from '@soe/types';
import { FakeTranscriber, fakeOutput, type FakeReading } from '../fake/fake-transcriber';
import { transcriptionZodSchema } from '../formats/transcription-json-schema';
import { labelAsOutput, labelTruth } from './label';
import { parseEvalManifest, type EvalSample } from './manifest';
import { computeEvalMetrics } from './metrics';
import { runEvaluation, type EvalSampleInput } from './run-evaluation';
import { detectOvercorrection, prepareSample, writtenShape } from './run-sample';

function reader(key: string, family: string): ReaderSpec {
  return {
    key,
    transcriberId: 'fake',
    provider: family === 'claude' ? 'anthropic' : 'gemini',
    family,
    model: `${key}-model`,
    promptRef: 'transcribe.short-answer@2',
    hints: 'format',
    params: { maxOutputTokens: 512, reasoning: 'off', timeoutMs: 1000 },
  };
}

const CLAUDE = reader('claude', 'claude');
const GEMINI = reader('gemini', 'gemini');

function sample(
  id: string,
  format: EvalSample['format'],
  literal: string,
  extra: Partial<EvalSample> = {},
): EvalSample {
  return {
    id,
    image: `${id}.png`,
    format,
    label: { state: literal ? 'answered' : 'blank', literal },
    ...extra,
  };
}

function input(entry: EvalSample): EvalSampleInput {
  return { sample: entry, image: { mimeType: 'image/png', base64: '', sha256: entry.id } };
}

const DECIMAL = { kind: 'decimal', maxChars: 6, allowNegative: false } as const;
const FRACTION = { kind: 'fraction', allowNegative: false, allowMixed: false } as const;

describe('manifest del dataset', () => {
  it('acepta un manifest válido y rechaza ids repetidos y rutas absolutas', () => {
    const base = { manifestVersion: 1, name: 'x', datasetVersion: '1' };
    expect(parseEvalManifest({ ...base, samples: [sample('a', DECIMAL, '2,5')] }).ok).toBe(true);
    const invalid = parseEvalManifest({
      ...base,
      samples: [sample('a', DECIMAL, '2,5'), { ...sample('a', DECIMAL, '1'), image: '/etc/x.png' }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.join(' ')).toContain('Id de muestra repetido');
      expect(invalid.errors.join(' ')).toContain('ruta relativa');
    }
  });

  it('exige literal en las respondidas y ninguno en las en blanco', () => {
    const result = parseEvalManifest({
      manifestVersion: 1,
      name: 'x',
      datasetVersion: '1',
      samples: [
        { id: 'a', image: 'a.png', format: DECIMAL, label: { state: 'answered', literal: ' ' } },
        { id: 'b', image: 'b.png', format: DECIMAL, label: { state: 'blank', literal: '3' } },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe('etiqueta como salida de lector', () => {
  it('cumple el esquema del formato, también con partes de fracción', () => {
    for (const entry of [
      sample('f', FRACTION, '3/4'),
      sample('d', DECIMAL, '2,5'),
      sample('b', DECIMAL, ''),
    ]) {
      expect(transcriptionZodSchema(entry.format).safeParse(labelAsOutput(entry)).success).toBe(
        true,
      );
    }
  });

  it('normaliza la etiqueta con el registro de producción', () => {
    expect(labelTruth(sample('d', DECIMAL, '02,5')).canonical).toBe(
      labelTruth(sample('e', DECIMAL, '2.5')).canonical,
    );
  });
});

describe('sobrecorrección', () => {
  const truthOf = (entry: EvalSample) => prepareSample(entry).truth;

  it('detecta cambio de separador, ceros y fracción simplificada', () => {
    const decimal = truthOf(sample('d', DECIMAL, '02,5'));
    const answer = (literal: string, format: EvalSample['format']) =>
      prepareSample(sample('x', format, literal)).truth.normalized!;
    expect(detectOvercorrection(decimal, null, '2.5', answer('2.5', DECIMAL), 'correct')).toBe(
      'equivalent_rewrite',
    );
    expect(
      detectOvercorrection(decimal, null, '02,5', answer('02,5', DECIMAL), 'correct'),
    ).toBeNull();
    const fraction = truthOf(sample('f', FRACTION, '2/4'));
    expect(detectOvercorrection(fraction, null, '1/2', answer('1/2', FRACTION), 'incorrect')).toBe(
      'equivalent_rewrite',
    );
    expect(
      detectOvercorrection(fraction, null, '3/4', answer('3/4', FRACTION), 'incorrect'),
    ).toBeNull();
  });

  it('detecta la lectura que arregla una respuesta incorrecta hacia la clave', () => {
    const truth = truthOf(sample('d', DECIMAL, '2,4'));
    const answer = prepareSample(sample('x', DECIMAL, '2,5')).truth.normalized!;
    expect(detectOvercorrection(truth, 'incorrect', '2,5', answer, 'correct')).toBe('fixed_to_key');
  });

  it('compara la forma escrita sin espacios', () => {
    expect(writtenShape(' 1 / 2 ')).toBe(writtenShape('1/2'));
  });
});

describe('runEvaluation', () => {
  const policy = { ...DEFAULT_CONSENSUS_POLICY };

  function transcriberWith(byReader: Record<string, Record<string, FakeReading>>) {
    const fake = new FakeTranscriber({ byReader });
    return { fake, transcriberFor: () => fake };
  }

  it('autoacepta con consenso y mide la precisión de lo autoaceptado', async () => {
    const samples = [
      sample('ok', DECIMAL, '2,5'),
      sample('mala', DECIMAL, '3,5'),
      sample('vacía', DECIMAL, ''),
    ];
    const blank = labelAsOutput(samples[2]!);
    const { transcriberFor } = transcriberWith({
      claude: { ok: fakeOutput('2,5'), mala: fakeOutput('8,5'), vacía: blank },
      gemini: { ok: fakeOutput('2,5'), mala: fakeOutput('8,5'), vacía: blank },
    });
    const result = await runEvaluation({
      samples: samples.map(input),
      readers: [CLAUDE, GEMINI],
      policy: { ...policy, auditSampleRate: 1 },
      repetitions: 1,
      concurrency: 2,
      transcriberFor,
    });
    const metrics = computeEvalMetrics(result.samples);
    expect(metrics.autoAccepted.rate).toBe(1);
    expect(metrics.autoAcceptedPrecision).toEqual({ count: 2, total: 3, rate: 2 / 3 });
    expect(metrics.autoAcceptedErrors).toEqual(['mala#1']);
    expect(metrics.agreement.rate).toBe(1);
    expect(metrics.promotion.meetsTarget).toBe(false);
  });

  it('acepta lecturas con el mismo valor y cuenta la sobrecorrección del lector que normalizó', async () => {
    const entry = sample('s', DECIMAL, '02,5');
    const { transcriberFor } = transcriberWith({
      claude: { s: fakeOutput('02,5') },
      gemini: { s: fakeOutput('2.5') },
    });
    const result = await runEvaluation({
      samples: [input(entry)],
      readers: [CLAUDE, GEMINI],
      policy,
      repetitions: 2,
      concurrency: 1,
      transcriberFor,
    });
    const metrics = computeEvalMetrics(result.samples);
    expect(metrics.decisions).toBe(2);
    expect(metrics.autoAccepted.rate).toBe(1);
    const gemini = metrics.readers.find((r) => r.readerKey === 'gemini')!;
    expect(gemini.accuracy.rate).toBe(1);
    expect(gemini.overcorrection.rate).toBe(1);
    expect(gemini.stability?.rate).toBe(1);
  });

  it('marca desacuerdo cuando los lectores leen valores distintos', async () => {
    const entry = sample('s', FRACTION, '3/4');
    const { transcriberFor } = transcriberWith({
      claude: { s: labelAsOutput(entry) },
      gemini: { s: labelAsOutput(sample('s', FRACTION, '2/4')) },
    });
    const result = await runEvaluation({
      samples: [input(entry)],
      readers: [CLAUDE, GEMINI],
      policy,
      repetitions: 1,
      concurrency: 1,
      transcriberFor,
    });
    const metrics = computeEvalMetrics(result.samples);
    expect(metrics.review.rate).toBe(1);
    expect(metrics.reviewByReason.readers_disagree?.count).toBe(1);
    expect(metrics.agreement.rate).toBe(0);
  });

  it('corrige con la estrategia de producción cuando hay clave', async () => {
    const entry = sample('k', DECIMAL, '2,4', { acceptedAnswers: ['2,5'] });
    const { transcriberFor } = transcriberWith({
      claude: { k: fakeOutput('2,4') },
      gemini: { k: fakeOutput('2,4') },
    });
    const result = await runEvaluation({
      samples: [input(entry)],
      readers: [CLAUDE, GEMINI],
      policy,
      repetitions: 1,
      concurrency: 1,
      transcriberFor,
    });
    expect(result.samples[0]!.expectedScoringOutcome).toBe('incorrect');
    const metrics = computeEvalMetrics(result.samples);
    expect(metrics.grading?.accuracy.rate).toBe(1);
    expect(metrics.grading?.autoAcceptedResultError.rate).toBe(0);
  });

  it('omite formatos sin registro y corta antes de superar el presupuesto', async () => {
    const text = sample('t', { kind: 'short_text', maxWords: 4 }, 'a^2');
    const numbers = [
      sample('a', DECIMAL, '1'),
      sample('b', DECIMAL, '2'),
      sample('c', DECIMAL, '3'),
    ];
    const fake = new FakeTranscriber({
      bySha256: Object.fromEntries(numbers.map((entry) => [entry.id, labelAsOutput(entry)])),
    });
    const result = await runEvaluation({
      samples: [text, ...numbers].map(input),
      readers: [CLAUDE, GEMINI],
      policy,
      repetitions: 1,
      concurrency: 1,
      transcriberFor: () => ({
        id: 'fake',
        supports: () => true,
        transcribe: async (request) => ({ ...(await fake.transcribe(request)), costUsd: 0.02 }),
      }),
      budget: { limitUsd: 0.07, estimateCallUsd: () => 0.01 },
    });
    expect(result.stoppedByBudget).toBe(true);
    expect(result.unitsRun).toBe(2);
    expect(result.spentUsd).toBeCloseTo(0.08);
    expect(result.samples.map((s) => s.skipped)).toEqual([
      'unsupported_format',
      null,
      null,
      'budget_exceeded',
    ]);
  });

  it('registra la falla de un lector sin transcriptor', async () => {
    const entry = sample('a', DECIMAL, '1');
    const result = await runEvaluation({
      samples: [input(entry)],
      readers: [CLAUDE, GEMINI],
      policy,
      repetitions: 1,
      concurrency: 1,
      transcriberFor: () => null,
    });
    const metrics = computeEvalMetrics(result.samples);
    expect(metrics.readers.every((r) => r.failuresByStatus.error === 1)).toBe(true);
    expect(metrics.review.rate).toBe(1);
  });
});
