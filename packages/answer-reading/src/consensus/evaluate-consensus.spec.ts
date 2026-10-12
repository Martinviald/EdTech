import {
  DEFAULT_CONSENSUS_POLICY,
  consensusResultSchema,
  getScoringStrategy,
  type ConsensusPolicy,
  type ItemContent,
  type NormalizedAnswer,
  type ReaderSpec,
  type ResponseFormat,
  type TranscriptionOutput,
} from '@soe/types';
import { fakeOutput } from '../fake/fake-transcriber';
import { toScoringInput } from '../formats/registry';
import { isAuditSample } from './audit-sample';
import { evaluateConsensus, needsTiebreak, type ConsensusReading } from './evaluate-consensus';
import { toScoringOutcome } from './scoring-outcome';

const FORMAT: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };
const KEY = '2,5';

function scorer(key: string, format?: ResponseFormat) {
  return (answer: NormalizedAnswer) =>
    toScoringOutcome(
      getScoringStrategy('short_answer').score({
        item: {
          id: 'item',
          type: 'short_answer',
          content: {
            prompt: '¿?',
            acceptedAnswers: [key],
            ...(format ? { responseFormat: format } : {}),
          } as ItemContent,
          maxScore: 1,
        },
        rawAnswer: toScoringInput(answer),
      }),
    );
}

const scoreOf = scorer(KEY);

const POLICY: ConsensusPolicy = { ...DEFAULT_CONSENSUS_POLICY, auditSampleRate: 0 };

function reading(
  readingId: string,
  family: string,
  output: TranscriptionOutput | null,
  extra: Partial<ConsensusReading> = {},
): ConsensusReading {
  return { readingId, family, status: output ? 'ok' : 'error', output, ...extra };
}

const claude = (literal: string, overrides: Partial<TranscriptionOutput> = {}) =>
  reading('r-claude', 'claude', fakeOutput(literal, overrides));
const gemini = (literal: string, overrides: Partial<TranscriptionOutput> = {}) =>
  reading('r-gemini', 'gemini', fakeOutput(literal, overrides));

function evaluate(
  readings: ConsensusReading[],
  policy: ConsensusPolicy = POLICY,
  options: { inkRatio?: number | null; readingKey?: string } = {},
) {
  const result = evaluateConsensus(readings, policy, scoreOf, {
    format: FORMAT,
    readingKey: 'casilla',
    ...options,
  });
  expect(consensusResultSchema.safeParse(result).success).toBe(true);
  return result;
}

describe('evaluateConsensus (diseño §8.2)', () => {
  it('11. dos familias coinciden con confianza alta → auto_accepted (correcta)', () => {
    const result = evaluate([claude('2,5'), gemini('2.50')]);
    expect(result).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'correct',
      reasons: [],
      reviewMode: null,
      usedReadingIds: ['r-claude', 'r-gemini'],
      policyId: POLICY.id,
      policyVersion: POLICY.version,
    });
    expect(result.value?.canonical).toBe('n:5/2');
  });

  it('11. también autoacepta incorrectas (D5)', () => {
    expect(evaluate([claude('3,5'), gemini('3,5')])).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'incorrect',
    });
  });

  it('1. tinta bajo el umbral → auto_blank sin lecturas', () => {
    const result = evaluate([], { ...POLICY, blankByInkBelow: 0.01 }, { inkRatio: 0.001 });
    expect(result).toMatchObject({
      outcome: 'auto_blank',
      scoringOutcome: 'incorrect',
      usedReadingIds: [],
    });
    expect(result.value?.state).toBe('blank');
  });

  it('sin lecturas → not_read con el motivo dado', () => {
    expect(evaluate([])).toMatchObject({
      outcome: 'not_read',
      reasons: ['insufficient_readers'],
      reviewMode: 'reading',
    });
    const disabled = evaluateConsensus([], POLICY, scoreOf, {
      format: FORMAT,
      readingKey: 'casilla',
      notReadReason: 'external_vision_disabled',
    });
    expect(disabled.reasons).toEqual(['external_vision_disabled']);
  });

  it('2. un lector falló → needs_review [reader_failed]', () => {
    const result = evaluate([claude('2,5'), reading('r-gemini', 'gemini', null)]);
    expect(result).toMatchObject({ outcome: 'needs_review', reasons: ['reader_failed'] });
    expect(result.value?.canonical).toBe('n:5/2');
  });

  it('2. menos lectores que el mínimo → needs_review [insufficient_readers]', () => {
    expect(evaluate([claude('2,5')]).reasons).toEqual(['insufficient_readers']);
  });

  it('3. dos lectores de la misma familia no bastan', () => {
    const twin = reading('r-claude-2', 'claude', fakeOutput('2,5'));
    expect(evaluate([claude('2,5'), twin]).reasons).toEqual(['insufficient_readers']);
    expect(
      evaluate([claude('2,5'), twin], { ...POLICY, requireDistinctFamilies: false }).outcome,
    ).toBe('auto_accepted');
  });

  it('4. todas en blanco → auto_blank; sin autoaceptación → revisión', () => {
    const blanks = [claude('', { state: 'blank' }), gemini('', { state: 'blank' })];
    expect(evaluate(blanks)).toMatchObject({ outcome: 'auto_blank', scoringOutcome: 'incorrect' });
    expect(evaluate(blanks, { ...POLICY, autoAccept: false })).toMatchObject({
      outcome: 'needs_review',
      reasons: ['policy_requires_review'],
    });
  });

  it('10. un blanco tampoco se autoacepta si la política no autoacepta incorrectas', () => {
    const onlyCorrect = { ...POLICY, autoAcceptOutcomes: ['correct' as const] };
    const blanks = [claude('', { state: 'blank' }), gemini('', { state: 'blank' })];
    expect(evaluate(blanks, onlyCorrect)).toMatchObject({
      outcome: 'needs_review',
      reasons: ['policy_requires_review'],
      scoringOutcome: 'incorrect',
    });
  });

  it('4. ilegible, varias respuestas o tachado → revisión de lectura', () => {
    expect(evaluate([claude('', { state: 'illegible' }), gemini('2,5')])).toMatchObject({
      outcome: 'needs_review',
      reasons: ['illegible', 'readers_disagree'],
      reviewMode: 'reading',
    });
    expect(
      evaluate([
        claude('', { state: 'multiple_answers' }),
        gemini('', { state: 'multiple_answers' }),
      ]).reasons,
    ).toEqual(['multiple_answers']);
    expect(
      evaluate([
        claude('', { state: 'crossed_out_only' }),
        gemini('', { state: 'crossed_out_only' }),
      ]).reasons,
    ).toEqual(['crossed_out']);
    expect(evaluate([claude('', { state: 'blank' }), gemini('2,5')]).reasons).toEqual([
      'readers_disagree',
    ]);
  });

  it('4b. un lector pide revisión aunque la confianza sea alta', () => {
    expect(evaluate([claude('2,5', { reviewRequested: true }), gemini('2,5')])).toMatchObject({
      outcome: 'needs_review',
      reasons: ['reader_requested_review'],
    });
  });

  it('4c. la propuesta es la mejor lectura, no la del primer lector de la ruta', () => {
    const result = evaluate([
      claude('7', { reviewRequested: true, confidence: 0.45 }),
      gemini('2,5', { confidence: 0.95 }),
    ]);
    expect(result).toMatchObject({ outcome: 'needs_review', reasons: ['reader_requested_review'] });
    expect(result.value?.value).toMatchObject({ written: '2,5' });
  });

  it('4d. si todos piden revisión, propone la lectura interpretable de mayor confianza', () => {
    const result = evaluate([
      claude('γ', { reviewRequested: true, confidence: 0.95 }),
      gemini('7', { reviewRequested: true, confidence: 0.4 }),
      reading('r-third', 'third', fakeOutput('2,5', { reviewRequested: true, confidence: 0.7 })),
    ]);
    expect(result.value?.value).toMatchObject({ written: '2,5' });
  });

  it('5. no convertible al formato → revisión de corrección, nunca incorrecta', () => {
    const result = evaluate([claude('γ,5'), gemini('γ,5')]);
    expect(result).toMatchObject({
      outcome: 'needs_review',
      reasons: ['unparsed_format'],
      reviewMode: 'grading',
      scoringOutcome: null,
    });
  });

  it('6. lecturas distintas → revisión [readers_disagree] sin valor', () => {
    expect(evaluate([claude('2,5'), gemini('3,5')])).toMatchObject({
      outcome: 'needs_review',
      reasons: ['readers_disagree'],
      value: null,
      scoringOutcome: null,
    });
  });

  it('6. agreeOn scoring_outcome acepta lecturas distintas con el mismo resultado', () => {
    const policy = { ...POLICY, agreeOn: 'scoring_outcome' as const };
    expect(evaluate([claude('3,5'), gemini('4,5')], policy)).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'incorrect',
    });
  });

  it('6. desempate: el lector de desempate forma mayoría', () => {
    const tiebreakReader: ReaderSpec = {
      key: 'tb',
      transcriberId: 'fake',
      provider: 'openai',
      family: 'gpt',
      model: 'm',
      promptRef: 'transcribe.short-answer@2',
      hints: 'none',
      params: { maxOutputTokens: 100, reasoning: 'off', timeoutMs: 1000 },
    };
    const policy = { ...POLICY, onDisagreement: 'tiebreak_reader' as const, tiebreakReader };
    const primaries = [claude('2,5'), gemini('3,5')];
    const first = evaluate(primaries, policy);
    expect(first.reasons).toEqual(['readers_disagree']);
    expect(needsTiebreak(first, primaries, policy)).toBe(true);
    expect(needsTiebreak(first, primaries, POLICY)).toBe(false);

    const tiebreak = reading('r-gpt', 'gpt', fakeOutput('2,5'), { role: 'tiebreak' });
    const second = evaluate([...primaries, tiebreak], policy);
    expect(second).toMatchObject({
      outcome: 'auto_accepted',
      usedReadingIds: ['r-claude', 'r-gpt'],
    });
    expect(needsTiebreak(second, [...primaries, tiebreak], policy)).toBe(false);

    const noMajority = reading('r-gpt', 'gpt', fakeOutput('9'), { role: 'tiebreak' });
    expect(evaluate([...primaries, noMajority], policy).reasons).toEqual(['readers_disagree']);
  });

  it('7. confianza bajo el mínimo → revisión [low_confidence] con el valor acordado', () => {
    const result = evaluate([claude('2,5', { confidence: 0.6 }), gemini('2,5')]);
    expect(result).toMatchObject({ outcome: 'needs_review', reasons: ['low_confidence'] });
    expect(result.value?.canonical).toBe('n:5/2');
  });

  it('8. una alternativa plausible que cambia el resultado → revisión', () => {
    const flipping = claude('3,5', {
      alternativeReadings: [{ literal: '2,5', parts: null, plausibility: 0.3 }],
    });
    expect(evaluate([flipping, gemini('3,5')]).reasons).toEqual(['alternative_flips_outcome']);
  });

  it('8. una alternativa que no cambia el resultado no necesita humano', () => {
    const harmless = claude('3,9', {
      alternativeReadings: [{ literal: '3,4', parts: null, plausibility: 0.4 }],
    });
    expect(evaluate([harmless, gemini('3,9')]).outcome).toBe('auto_accepted');
  });

  it('8. alternativas bajo el piso de plausibilidad se ignoran', () => {
    const faint = claude('3,5', {
      alternativeReadings: [{ literal: '2,5', parts: null, plausibility: 0.1 }],
    });
    expect(evaluate([faint, gemini('3,5')]).outcome).toBe('auto_accepted');
  });

  it('8. una alternativa no interpretable (8 leído como γ) cuenta como cambio', () => {
    const letter = claude('2,5', {
      alternativeReadings: [{ literal: 'γ,5', parts: null, plausibility: 0.3 }],
    });
    expect(evaluate([letter, gemini('2,5')]).reasons).toEqual(['alternative_flips_outcome']);
  });

  it('9. corrección indecidible → revisión de corrección', () => {
    const result = evaluate([claude('2.500'), gemini('2.500')]);
    expect(result).toMatchObject({
      outcome: 'needs_review',
      reasons: ['undecidable'],
      reviewMode: 'grading',
      scoringOutcome: 'undecidable',
    });
  });

  it('10. la política no autoacepta ese resultado → revisión', () => {
    expect(
      evaluate([claude('3,5'), gemini('3,5')], { ...POLICY, autoAcceptOutcomes: ['correct'] }),
    ).toMatchObject({ outcome: 'needs_review', reasons: ['policy_requires_review'] });
    expect(
      evaluate([claude('2,5'), gemini('2,5')], { ...POLICY, autoAccept: false }).reasons,
    ).toEqual(['policy_requires_review']);
  });

  it('auditoría: lo muestreado va a revisión conservando el valor propuesto', () => {
    const policy = { ...POLICY, auditSampleRate: 0.5 };
    const keys = Array.from({ length: 40 }, (_, index) => `casilla-${index}`);
    const sampled = keys.find((key) => isAuditSample(key, 0.5));
    const kept = keys.find((key) => !isAuditSample(key, 0.5));
    if (!sampled || !kept) throw new Error('muestra degenerada');
    const audited = evaluate([claude('2,5'), gemini('2,5')], policy, { readingKey: sampled });
    expect(audited).toMatchObject({
      outcome: 'needs_review',
      reasons: ['audit_sample'],
      reviewMode: 'reading',
      scoringOutcome: 'correct',
    });
    expect(audited.value?.canonical).toBe('n:5/2');
    expect(evaluate([claude('2,5'), gemini('2,5')], policy, { readingKey: kept }).outcome).toBe(
      'auto_accepted',
    );
  });

  describe('revisión F2', () => {
    const blanks = (overrides: Partial<TranscriptionOutput> = {}) => [
      claude('', { state: 'blank', ...overrides }),
      gemini('', { state: 'blank' }),
    ];
    const always = { ...POLICY, auditSampleRate: 1 };

    it('hallazgo 1: un blanco con petición de revisión o confianza baja no se autoacepta', () => {
      expect(evaluate(blanks({ reviewRequested: true }))).toMatchObject({
        outcome: 'needs_review',
        reasons: ['reader_requested_review'],
        scoringOutcome: 'incorrect',
      });
      expect(evaluate(blanks({ confidence: 0.2 }))).toMatchObject({
        outcome: 'needs_review',
        reasons: ['low_confidence'],
      });
    });

    it('hallazgo 1: auto_blank también pasa por la auditoría muestral', () => {
      const audited = evaluate(blanks(), always);
      expect(audited).toMatchObject({ outcome: 'needs_review', reasons: ['audit_sample'] });
      expect(audited.value?.state).toBe('blank');
      expect(evaluate([], { ...always, blankByInkBelow: 0.01 }, { inkRatio: 0.001 })).toMatchObject(
        { outcome: 'needs_review', reasons: ['audit_sample'] },
      );
    });

    const evaluateFor = (
      format: ResponseFormat,
      key: string,
      readings: ConsensusReading[],
      policy: ConsensusPolicy = POLICY,
    ) => {
      const result = evaluateConsensus(readings, policy, scorer(key, format), {
        format,
        readingKey: 'casilla',
      });
      expect(consensusResultSchema.safeParse(result).success).toBe(true);
      return result;
    };

    it('hallazgo 2: partes que contradicen el literal → revisión [format_mismatch]', () => {
      const pair: ResponseFormat = { kind: 'ordered_tuple', arity: 2, componentKind: 'integer' };
      const parts = { c1: '3', c2: '7' };
      expect(
        evaluateFor(pair, '(7;3)', [claude('(7;3)', { parts }), gemini('(7;3)', { parts })]),
      ).toMatchObject({ outcome: 'needs_review', reasons: ['format_mismatch'] });
    });

    it('hallazgo 2: un valor fuera del formato → revisión [format_mismatch]', () => {
      const integer: ResponseFormat = { kind: 'integer', maxChars: 6, allowNegative: false };
      expect(evaluateFor(integer, '35', [claude('-35'), gemini('-35')])).toMatchObject({
        outcome: 'needs_review',
        reasons: ['format_mismatch'],
        reviewMode: 'reading',
      });
      expect(evaluateFor(integer, '35', [claude('3,5'), gemini('3,5')]).reasons).toEqual([
        'format_mismatch',
      ]);
    });

    it('hallazgo 2: miles/decimal sin resolver → [undecidable]; resuelto por formato o clave → se acepta', () => {
      const decimal: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };
      const integer: ResponseFormat = { kind: 'integer', maxChars: 6, allowNegative: false };
      expect(evaluateFor(decimal, '1,5', [claude('1.500'), gemini('1.500')])).toMatchObject({
        outcome: 'needs_review',
        reasons: ['undecidable'],
      });
      expect(evaluateFor(decimal, '1,500', [claude('1.500'), gemini('1.500')])).toMatchObject({
        outcome: 'auto_accepted',
        scoringOutcome: 'correct',
      });
      expect(evaluateFor(integer, '1500', [claude('1.500'), gemini('1.500')])).toMatchObject({
        outcome: 'auto_accepted',
        scoringOutcome: 'correct',
      });
    });
  });
});

describe('formatos de rúbrica: nunca se autoaceptan', () => {
  const FREE_TEXT: ResponseFormat = { kind: 'free_text', lines: 6 };
  const neverScored = () => {
    throw new Error('un ítem de rúbrica no se corrige contra una clave');
  };
  const evaluateText = (readings: ConsensusReading[], options: { inkRatio?: number } = {}) => {
    const result = evaluateConsensus(readings, { ...POLICY, blankByInkBelow: 0.01 }, neverScored, {
      format: FREE_TEXT,
      readingKey: 'desarrollo',
      ...options,
    });
    expect(consensusResultSchema.safeParse(result).success).toBe(true);
    return result;
  };

  it('lecturas que coinciden van a revisión con motivo rubric_item, sin resultado', () => {
    const result = evaluateText([claude('El agua se evapora'), gemini('El agua  se evapora')]);
    expect(result.outcome).toBe('needs_review');
    expect(result.reasons).toEqual(['rubric_item']);
    expect(result.reviewMode).toBe('grading');
    expect(result.scoringOutcome).toBeNull();
    expect(result.value?.canonical).toBe('x:El agua se evapora');
  });

  it('un desacuerdo de transcripción se revisa primero como lectura', () => {
    const result = evaluateText([claude('El agua se evapora'), gemini('El agua se evaporó')]);
    expect(result.reasons).toEqual(['readers_disagree', 'rubric_item']);
    expect(result.reviewMode).toBe('reading');
  });

  it('confianza baja se suma a los motivos', () => {
    const result = evaluateText([
      claude('El agua [ilegible]', { confidence: 0.6 }),
      gemini('El agua [ilegible]'),
    ]);
    expect(result.reasons).toEqual(['low_confidence', 'rubric_item']);
  });

  it('en blanco tampoco se autoacepta: ni por tinta ni por los lectores', () => {
    const byInk = evaluateText([], { inkRatio: 0 });
    expect(byInk.outcome).toBe('needs_review');
    expect(byInk.reasons).toEqual(['rubric_item']);
    const byReaders = evaluateText([
      claude('', { state: 'blank' }),
      gemini('', { state: 'blank' }),
    ]);
    expect(byReaders.outcome).toBe('needs_review');
    expect(byReaders.value?.state).toBe('blank');
    expect(byReaders.scoringOutcome).toBeNull();
  });

  it('ilegible sigue siendo un motivo de lectura', () => {
    const result = evaluateText([claude('', { state: 'illegible' }), gemini('x')]);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['illegible', 'readers_disagree', 'rubric_item']),
    );
    expect(result.reviewMode).toBe('reading');
  });
});

describe('fotos reales: formatos con partes', () => {
  const pair: ResponseFormat = { kind: 'ordered_tuple', arity: 2, componentKind: 'integer' };
  const evaluatePair = (readings: ConsensusReading[]) => {
    const result = evaluateConsensus(readings, POLICY, scorer('(3;5)', pair), {
      format: pair,
      readingKey: 'casilla',
    });
    expect(consensusResultSchema.safeParse(result).success).toBe(true);
    return result;
  };
  const parts = { c1: '3', c2: '5' };

  it('un literal incompleto con partes completas no impide autoaceptar', () => {
    expect(evaluatePair([claude('3;5', { parts }), gemini('3', { parts })])).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'correct',
    });
  });

  it('un literal que contradice las partes va a revisión de lectura, no a unparsed_format', () => {
    expect(
      evaluatePair([claude('productos', { parts }), gemini('(3;5)', { parts })]),
    ).toMatchObject({
      outcome: 'needs_review',
      reasons: ['format_mismatch'],
      reviewMode: 'reading',
    });
  });
});

describe('evaluateConsensus: umbral de confianza por lector (E1-1)', () => {
  const flash = (literal: string, overrides: Partial<TranscriptionOutput> = {}) =>
    reading('r-flash', 'gemini', fakeOutput(literal, overrides), { minConfidence: 0.97 });
  const luna = (literal: string, overrides: Partial<TranscriptionOutput> = {}) =>
    reading('r-luna', 'gpt', fakeOutput(literal, overrides), { minConfidence: 0.85 });

  it('cada lectura se compara con el umbral de su lector', () => {
    expect(
      evaluate([flash('2,5', { confidence: 0.96 }), luna('2,5', { confidence: 0.86 })]),
    ).toMatchObject({ outcome: 'needs_review', reasons: ['low_confidence'] });
    expect(
      evaluate([flash('2,5', { confidence: 0.98 }), luna('2,5', { confidence: 0.86 })]),
    ).toMatchObject({ outcome: 'auto_accepted', scoringOutcome: 'correct' });
    expect(
      evaluate([flash('2,5', { confidence: 0.98 }), luna('2,5', { confidence: 0.84 })]),
    ).toMatchObject({ outcome: 'needs_review', reasons: ['low_confidence'] });
  });

  it('el umbral del lector reemplaza al de la política, también hacia abajo', () => {
    const strict = { ...POLICY, minConfidence: 0.9 };
    expect(
      evaluate([flash('2,5', { confidence: 0.98 }), luna('2,5', { confidence: 0.86 })], strict),
    ).toMatchObject({ outcome: 'auto_accepted' });
    expect(
      evaluate([flash('2,5', { confidence: 0.98 }), claude('2,5', { confidence: 0.86 })], strict),
    ).toMatchObject({ outcome: 'needs_review', reasons: ['low_confidence'] });
  });

  it('los blancos respetan el umbral de cada lector', () => {
    const blank = (confidence: number) => ({ state: 'blank' as const, confidence });
    expect(evaluate([flash('', blank(0.96)), luna('', blank(0.86))])).toMatchObject({
      outcome: 'needs_review',
      reasons: ['low_confidence'],
    });
    expect(evaluate([flash('', blank(0.98)), luna('', blank(0.86))])).toMatchObject({
      outcome: 'auto_blank',
    });
  });

  it('el desempate respeta el umbral del lector de desempate', () => {
    const policy = { ...POLICY, onDisagreement: 'tiebreak_reader' as const };
    const primaries = [claude('2,5'), gemini('3,5')];
    const tiebreak = (confidence: number) =>
      reading('r-tb', 'gpt', fakeOutput('2,5', { confidence }), {
        role: 'tiebreak',
        minConfidence: 0.97,
      });
    expect(evaluate([...primaries, tiebreak(0.96)], policy)).toMatchObject({
      outcome: 'needs_review',
      reasons: ['low_confidence'],
      usedReadingIds: ['r-claude', 'r-tb'],
    });
    expect(evaluate([...primaries, tiebreak(0.98)], policy)).toMatchObject({
      outcome: 'auto_accepted',
    });
  });

  it('la propuesta de revisión prefiere la lectura que supera el umbral de su lector', () => {
    const result = evaluate([
      flash('7', { reviewRequested: true, confidence: 0.96 }),
      luna('2,5', { reviewRequested: true, confidence: 0.9 }),
    ]);
    expect(result).toMatchObject({ outcome: 'needs_review', reasons: ['reader_requested_review'] });
    expect(result.value?.value).toMatchObject({ written: '2,5' });
  });

  it('en formatos de rúbrica la confianza también se mide por lector', () => {
    const freeText: ResponseFormat = { kind: 'free_text', lines: 3 };
    const evaluateText = (readings: ConsensusReading[]) =>
      evaluateConsensus(readings, POLICY, scoreOf, { format: freeText, readingKey: 'casilla' });
    expect(
      evaluateText([flash('hola', { confidence: 0.96 }), luna('hola', { confidence: 0.86 })])
        .reasons,
    ).toEqual(['low_confidence', 'rubric_item']);
    expect(
      evaluateText([flash('hola', { confidence: 0.98 }), luna('hola', { confidence: 0.86 })])
        .reasons,
    ).toEqual(['rubric_item']);
  });
});
