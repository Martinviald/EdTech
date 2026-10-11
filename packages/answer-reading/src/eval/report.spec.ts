import { DEFAULT_CONSENSUS_POLICY, type ReaderSpec } from '@soe/types';
import { percentile, rate } from './metrics';
import {
  buildEvalReport,
  compareEvalReports,
  renderEvalMarkdown,
  type EvalReportMeta,
} from './report';
import type { EvalDecisionRecord, EvalReadingRecord, EvalSampleResult } from './run-sample';

const READER: ReaderSpec = {
  key: 'claude',
  transcriberId: 'llm',
  provider: 'anthropic',
  family: 'claude',
  model: 'claude-haiku-5-5',
  promptRef: 'transcribe.short-answer@2',
  hints: 'format',
  params: { maxOutputTokens: 512, reasoning: 'off', timeoutMs: 1000 },
};

const META: EvalReportMeta = {
  datasetName: 'prueba',
  datasetVersion: '1',
  routeId: '00000000-0000-4000-8000-000000000001',
  routeVersion: 1,
  readers: [READER],
  policy: DEFAULT_CONSENSUS_POLICY,
  repetitions: 1,
  dryRun: true,
  budgetUsd: 0.5,
  stoppedByBudget: false,
  startedAt: '2026-10-11T00:00:00.000Z',
  finishedAt: '2026-10-11T00:01:00.000Z',
};

function reading(literal: string, correct: boolean, latencyMs: number): EvalReadingRecord {
  return {
    readerKey: 'claude',
    family: 'claude',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    promptRef: 'transcribe.short-answer@2',
    promptHash: null,
    role: 'primary',
    repetition: 1,
    status: 'ok',
    errorCode: null,
    state: 'answered',
    literal,
    canonical: `n:${literal}`,
    confidence: 0.9,
    reviewRequested: false,
    alternatives: [],
    transcriptionCorrect: correct,
    overcorrection: null,
    scoringOutcome: correct ? 'correct' : 'incorrect',
    costUsd: 0.001,
    latencyMs,
    providerModel: 'claude-haiku-5-5',
  };
}

function decision(outcome: EvalDecisionRecord['outcome'], correct: boolean): EvalDecisionRecord {
  return {
    repetition: 1,
    outcome,
    reasons: outcome === 'needs_review' ? ['readers_disagree'] : [],
    reviewMode: outcome === 'needs_review' ? 'reading' : null,
    canonical: null,
    valueState: outcome === 'needs_review' ? null : 'answered',
    decisionCorrect: correct,
    scoringOutcome: null,
    gradingCorrect: null,
    readersAgree: outcome !== 'needs_review',
    usedTiebreak: false,
  };
}

function sample(
  id: string,
  literal: string,
  read: EvalReadingRecord,
  made: EvalDecisionRecord,
): EvalSampleResult {
  return {
    id,
    image: `${id}.png`,
    format: { kind: 'integer', maxChars: 4, allowNegative: false },
    tags: {},
    gradeName: null,
    truth: { state: 'answered', literal, canonical: `n:${literal}` },
    expectedScoringOutcome: null,
    skipped: null,
    skipDetail: null,
    readings: [read],
    decisions: [made],
  };
}

describe('métricas auxiliares', () => {
  it('calcula percentiles por rango más cercano', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([300, 100, 200, 400], 50)).toBe(200);
    expect(percentile([300, 100, 200, 400], 95)).toBe(400);
  });

  it('devuelve tasa nula sin denominador', () => {
    expect(rate(0, 0).rate).toBeNull();
  });
});

describe('informe y comparación', () => {
  const before = buildEvalReport(META, [
    sample('a', '12', reading('12', true, 100), decision('auto_accepted', true)),
    sample('b', '7', reading('1', false, 300), decision('auto_accepted', false)),
  ]);
  const after = buildEvalReport({ ...META, finishedAt: '2026-10-12T00:00:00.000Z' }, [
    sample('a', '12', reading('12', true, 120), decision('auto_accepted', true)),
    sample('b', '7', reading('7', true, 200), decision('needs_review', false)),
  ]);

  it('resume la precisión de lo autoaceptado y el costo', () => {
    expect(before.metrics.autoAcceptedPrecision.rate).toBe(0.5);
    expect(before.metrics.cost.perCropUsd).toBeCloseTo(0.001);
    expect(before.metrics.latencyMs).toEqual({ p50: 100, p95: 300 });
  });

  it('muestra deltas por métrica y las muestras que cambiaron', () => {
    const comparison = compareEvalReports(before, after);
    const precision = comparison.deltas.find((d) => d.metric === 'Precisión de lo autoaceptado');
    expect(precision).toMatchObject({ previous: 0.5, current: 1, delta: 0.5 });
    const accuracy = comparison.deltas.find((d) => d.metric === 'Exactitud claude');
    expect(accuracy?.delta).toBe(0.5);
    expect(comparison.changedSamples.map((c) => c.id)).toEqual(['b']);
  });

  it('genera el resumen en Markdown con la comparación', () => {
    const markdown = renderEvalMarkdown(after, compareEvalReports(before, after));
    expect(markdown).toContain('Precisión de lo autoaceptado');
    expect(markdown).toContain('## Comparación con la corrida anterior');
    expect(markdown).toContain('| b |');
    expect(markdown).toContain('+50,0 pp');
  });
});
