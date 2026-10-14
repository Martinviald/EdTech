import {
  DEFAULT_CONSENSUS_POLICY,
  consensusResultSchema,
  getScoringStrategy,
  readingAuditOutputSchema,
  type ConsensusPolicy,
  type ConsensusResult,
  type ItemContent,
  type NormalizedAnswer,
  type ReaderSpec,
  type ReadingAuditor,
  type ResponseFormat,
  type TranscriptionOutput,
} from '@soe/types';
import { evaluateConsensus, type ConsensusReading } from '../consensus/evaluate-consensus';
import { toScoringOutcome } from '../consensus/scoring-outcome';
import { fakeOutput } from '../fake/fake-transcriber';
import { toScoringInput } from '../formats/registry';
import { renderTranscriptionPrompt } from '../prompts/registry';
import { readingAuditJsonSchema } from './reading-audit-json-schema';
import {
  applyReadingAudit,
  describeAuditCandidate,
  itemStemOf,
  needsReadingAudit,
  readingAuditCandidate,
  renderReadingAuditPrompt,
} from './reading-audit';

const FORMAT: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };
const KEY = '3,75';

const scoreOf = (answer: NormalizedAnswer) =>
  toScoringOutcome(
    getScoringStrategy('short_answer').score({
      item: {
        id: 'item',
        type: 'short_answer',
        content: { prompt: 'Calcula 2,5 + 1,25', acceptedAnswers: [KEY] } as ItemContent,
        maxScore: 1,
      },
      rawAnswer: toScoringInput(answer),
    }),
  );

const AUDITOR_READER: ReaderSpec = {
  key: 'gemini-3.8-flash-auditor',
  transcriberId: 'llm',
  provider: 'gemini',
  family: 'gemini-flash',
  model: 'gemini-3.8-flash',
  promptRef: 'audit.reading@1',
  hints: 'format',
  params: { maxOutputTokens: 4096, reasoning: 'off', mediaResolution: 'medium', timeoutMs: 90000 },
};
const AUDITOR: ReadingAuditor = {
  reader: AUDITOR_READER,
  minConfidence: 0.9,
  candidate: 'agreement_or_top',
};
const BASE: ConsensusPolicy = { ...DEFAULT_CONSENSUS_POLICY, auditSampleRate: 0 };
const POLICY: ConsensusPolicy = { ...BASE, readingAuditor: AUDITOR };
const OPTIONS = { format: FORMAT, readingKey: 'casilla' };

function reading(
  readingId: string,
  provider: string,
  literal: string,
  overrides: Partial<TranscriptionOutput> = {},
  extra: Partial<ConsensusReading> = {},
): ConsensusReading {
  return {
    readingId,
    family: readingId,
    provider,
    status: 'ok',
    output: fakeOutput(literal, overrides),
    role: 'primary',
    ...extra,
  };
}

const approve = (confidence: number) => ({
  status: 'ok' as const,
  output: { notes: 'trazos', suspiciousCharacters: [], verdict: 'approve' as const, confidence },
});
const reject = (confidence: number) => ({
  status: 'ok' as const,
  output: {
    notes: 'trazos',
    suspiciousCharacters: ['3 → 5'],
    verdict: 'reject' as const,
    confidence,
  },
});

function inReview(readings: ConsensusReading[], policy: ConsensusPolicy = POLICY): ConsensusResult {
  const result = evaluateConsensus(readings, policy, scoreOf, OPTIONS);
  expect(result.outcome).toBe('needs_review');
  return result;
}

function audit(
  readings: ConsensusReading[],
  verdict: Parameters<typeof applyReadingAudit>[3],
  policy: ConsensusPolicy = POLICY,
): ConsensusResult {
  const result = inReview(readings, policy);
  const candidate = readingAuditCandidate(readings, FORMAT);
  const audited = applyReadingAudit(result, policy, candidate, verdict, scoreOf, OPTIONS);
  expect(consensusResultSchema.safeParse(audited).success).toBe(true);
  return audited;
}

const lowConfidencePair = () => [
  reading('flash', 'gemini', '2,75', { confidence: 0.95 }, { minConfidence: 0.97 }),
  reading('luna', 'openai', '2,75', { confidence: 0.84 }, { minConfidence: 0.85 }),
];

describe('auditor de lectura: cuándo corre', () => {
  it('solo con auditor en la política y una revisión solo por motivos de lectura', () => {
    const lowConfidence = inReview(lowConfidencePair());
    expect(lowConfidence.reasons).toEqual(['low_confidence']);
    expect(needsReadingAudit(lowConfidence, POLICY, FORMAT)).toBe(true);
    expect(needsReadingAudit(lowConfidence, BASE, FORMAT)).toBe(false);
    expect(needsReadingAudit(lowConfidence, { ...POLICY, autoAccept: false }, FORMAT)).toBe(false);
    for (const reasons of [
      ['readers_disagree'],
      ['reader_requested_review'],
      ['low_confidence', 'reader_requested_review'],
    ] as const) {
      expect(needsReadingAudit({ ...lowConfidence, reasons: [...reasons] }, POLICY, FORMAT)).toBe(
        true,
      );
    }
    for (const reasons of [
      ['unparsed_format'],
      ['format_mismatch'],
      ['undecidable'],
      ['audit_sample'],
      ['verifier_flagged'],
      ['verifier_failed'],
      ['alternative_flips_outcome'],
      ['illegible'],
      ['low_confidence', 'undecidable'],
      [],
    ] as const) {
      expect(needsReadingAudit({ ...lowConfidence, reasons: [...reasons] }, POLICY, FORMAT)).toBe(
        false,
      );
    }
    expect(needsReadingAudit({ ...lowConfidence, outcome: 'auto_accepted' }, POLICY, FORMAT)).toBe(
      false,
    );
    expect(needsReadingAudit(lowConfidence, POLICY, { kind: 'free_text', lines: 4 })).toBe(false);
  });
});

describe('auditor de lectura: la candidata', () => {
  it('es la canónica en que coinciden dos lectores, con el literal del de mayor confianza', () => {
    const readings = [
      reading('flash', 'gemini', '2,73', { confidence: 0.85, reviewRequested: true }),
      reading('luna', 'openai', '2,75', { confidence: 0.84 }),
      reading('sol', 'openai', '2.75', { confidence: 0.94 }, { role: 'tiebreak' }),
    ];
    const candidate = readingAuditCandidate(readings, FORMAT);
    expect(candidate?.answer.canonical).toBe('n:11/4');
    expect(candidate?.literal).toBe('2.75');
    expect(candidate?.readingIds).toEqual(['sol', 'luna']);
  });

  it('sin coincidencias es la lectura contestada de mayor confianza', () => {
    const readings = [
      reading('flash', 'gemini', '2,75', { confidence: 0.95 }),
      reading('luna', 'openai', '12,75', { confidence: 0.65, reviewRequested: true }),
      reading('nada', 'openai', '', { state: 'illegible', confidence: 0.99 }),
    ];
    expect(readingAuditCandidate(readings, FORMAT)).toMatchObject({
      literal: '2,75',
      readingIds: ['flash'],
    });
  });

  it('a igual confianza gana el orden de la ruta; sin lecturas contestadas no hay candidata', () => {
    expect(
      readingAuditCandidate(
        [
          reading('flash', 'gemini', '2,75', { confidence: 0.9 }),
          reading('luna', 'openai', '2,73', { confidence: 0.9 }),
        ],
        FORMAT,
      )?.readingIds,
    ).toEqual(['flash']);
    expect(
      readingAuditCandidate(
        [
          reading('flash', 'gemini', '', { state: 'illegible' }),
          { readingId: 'x', family: 'x', status: 'error', output: null },
        ],
        FORMAT,
      ),
    ).toBeNull();
  });

  it('el texto candidato replica el del experimento, con las casillas cuando hay varias', () => {
    expect(describeAuditCandidate('2,75', null)).toBe('2,75');
    expect(describeAuditCandidate('2,75', { v: '2,75' })).toBe('2,75');
    expect(
      describeAuditCandidate('triángulo, rectángulo', { w1: 'triángulo', w2: 'rectángulo' }),
    ).toBe('triángulo, rectángulo   (por casilla: w1: "triángulo"; w2: "rectángulo")');
  });
});

describe('auditor de lectura: solo acepta con un approve confiable', () => {
  it('approve con confianza suficiente autoacepta la candidata y la corrige', () => {
    const result = audit(lowConfidencePair(), approve(0.9));
    expect(result).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'incorrect',
      reasons: [],
      reviewMode: null,
      usedReadingIds: ['flash', 'luna'],
    });
    expect(result.value?.canonical).toBe('n:11/4');
  });

  it('un approve bajo el umbral, un reject o una falla dejan la revisión original', () => {
    const original = inReview(lowConfidencePair());
    for (const verdict of [
      approve(0.89),
      reject(0.99),
      { status: 'error' as const, output: null },
      { status: 'timeout' as const, output: null },
      { status: 'invalid_output' as const, output: null },
      null,
    ]) {
      expect(audit(lowConfidencePair(), verdict)).toEqual(original);
    }
  });

  it('lo indecidible nunca se acepta: queda en revisión', () => {
    const undecidable = (answer: NormalizedAnswer) =>
      answer.canonical === 'n:11/4' ? ('undecidable' as const) : scoreOf(answer);
    const readings = lowConfidencePair();
    const result = evaluateConsensus(readings, POLICY, undecidable, OPTIONS);
    const candidate = readingAuditCandidate(readings, FORMAT);
    expect(applyReadingAudit(result, POLICY, candidate, approve(1), undecidable, OPTIONS)).toBe(
      result,
    );
  });

  it('respeta los resultados que la política autoacepta y la muestra de auditoría', () => {
    const correctOnly = { ...POLICY, autoAcceptOutcomes: ['correct' as const] };
    expect(audit(lowConfidencePair(), approve(1), correctOnly).outcome).toBe('needs_review');
    const audited = audit(lowConfidencePair(), approve(1), { ...POLICY, auditSampleRate: 1 });
    expect(audited).toMatchObject({
      outcome: 'needs_review',
      reasons: ['audit_sample'],
      reviewMode: 'reading',
      scoringOutcome: 'incorrect',
    });
  });

  it('sin auditor en la política la decisión no cambia', () => {
    const result = inReview(lowConfidencePair(), BASE);
    const candidate = readingAuditCandidate(lowConfidencePair(), FORMAT);
    expect(applyReadingAudit(result, BASE, candidate, approve(1), scoreOf, OPTIONS)).toBe(result);
  });

  it('una candidata que no calza con el formato nunca se acepta', () => {
    const readings = [
      reading('flash', 'gemini', '2,75', { confidence: 0.95, parts: { v: '2,7' } }),
      reading('luna', 'openai', 'abc', { confidence: 0.6 }),
    ];
    const result = evaluateConsensus(readings, POLICY, scoreOf, OPTIONS);
    const candidate = readingAuditCandidate(readings, FORMAT);
    expect(applyReadingAudit(result, POLICY, candidate, approve(1), scoreOf, OPTIONS)).toBe(result);
  });
});

describe('auditor de lectura: lo que ve', () => {
  it('recibe la candidata, el formato, el curso y el enunciado; nunca la clave', () => {
    const { prompt, outputSchema } = renderReadingAuditPrompt({
      reader: AUDITOR_READER,
      format: FORMAT,
      candidate: { literal: '2,75', parts: null },
      stem: 'Calcula 2,5 + 1,25',
      gradeName: '6° Básico',
    });
    expect(prompt.ref).toBe('audit.reading@1');
    expect(prompt.system).toMatch(
      /^Eres un auditor de transcripciones de respuestas manuscritas de estudiantes de 6° Básico\. /,
    );
    expect(prompt.user).toBe(
      [
        'FORMATO DE LA CASILLA: número decimal',
        '',
        'ENUNCIADO DE LA PREGUNTA (solo como contexto; no sabes cuál es la respuesta correcta): Calcula 2,5 + 1,25',
        '',
        'TRANSCRIPCIÓN CANDIDATA, entre las marcas <<< y >>>',
        '<<<',
        '2,75',
        '>>>',
        '',
        '¿La candidata reproduce exactamente lo escrito a mano? Sigue las instrucciones.',
      ].join('\n'),
    );
    expect(`${prompt.system}${prompt.user}`).not.toMatch(/3,75/);
    expect(`${prompt.system}${prompt.user}`).not.toMatch(/\b(vos|tenés|podés|marcá|fijate)\b/);
    expect(outputSchema.propertyOrder).toEqual([
      'notes',
      'suspiciousCharacters',
      'verdict',
      'confidence',
    ]);
  });

  it('sin curso, enunciado ni pistas de formato omite esas líneas', () => {
    const { prompt } = renderReadingAuditPrompt({
      reader: { ...AUDITOR_READER, hints: 'none' },
      format: FORMAT,
      candidate: { literal: '2,75', parts: null },
      stem: null,
      gradeName: null,
    });
    expect(prompt.system).toMatch(
      /^Eres un auditor de transcripciones de respuestas manuscritas de estudiantes\. /,
    );
    expect(prompt.user.startsWith('TRANSCRIPCIÓN CANDIDATA')).toBe(true);
  });

  it('rechaza un prompt que no audita el formato', () => {
    const input = {
      reader: AUDITOR_READER,
      format: FORMAT,
      candidate: { literal: '1', parts: null },
      stem: null,
    };
    expect(() =>
      renderReadingAuditPrompt({
        ...input,
        reader: { ...AUDITOR_READER, promptRef: 'verify.incorrect@1' },
      }),
    ).toThrow(/no audita/);
    expect(() =>
      renderReadingAuditPrompt({ ...input, format: { kind: 'free_text', lines: 4 } }),
    ).toThrow(/no audita/);
    expect(() =>
      renderTranscriptionPrompt({ promptRef: 'audit.reading@1', hints: 'none' }, FORMAT),
    ).toThrow(/no sirve/);
  });

  it('el enunciado sale del contenido del ítem', () => {
    expect(itemStemOf({ prompt: 'Calcula 2,5 + 1,25', acceptedAnswers: ['3,75'] })).toBe(
      'Calcula 2,5 + 1,25',
    );
    expect(itemStemOf({ prompt: '  ' })).toBeNull();
    expect(itemStemOf({ textWithGaps: '___' })).toBeNull();
    expect(itemStemOf(null)).toBeNull();
  });

  it('el esquema JSON y el de Zod piden las mismas claves', () => {
    const { schema } = readingAuditJsonSchema();
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(readingAuditOutputSchema.shape).sort(),
    );
  });
});
