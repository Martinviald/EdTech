import type { AnswerSpace, InterpretedReading, ResponseFormat } from '@soe/types';
import type { AcceptanceAgreement } from '../answer-verification/acceptance';
import type { VerifyAnswer } from '../answer-verification/verified-answer';
import {
  applyDecisionTiebreak,
  closedSpaceScoring,
  finalizeInterpretedConsensus,
  planInterpretedConsensus,
  tiebreakCandidatesOf,
  type InterpretedReaderResult,
} from './interpreted-consensus';

const FORMAT: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };
const OPEN: AnswerSpace = { kind: 'open' };
const POLICY = {
  id: 'short-answer-interpreted',
  version: 1,
  autoAccept: true,
  auditSampleRate: 0,
  incorrectVerifier: undefined,
};
const RULE = { minConfidence: 0.9, agreeWithProvider: 'gemini' as const };

function reading(answer: string, confidence = 0.99, literal = answer): InterpretedReading {
  return {
    literal,
    state: answer === '' ? 'blank' : 'answered',
    answer,
    candidates: [],
    confidence,
  };
}

function reader(
  provider: 'gemini' | 'openai',
  value: InterpretedReading | null,
  minConfidence = 0.85,
): InterpretedReaderResult {
  return { readingId: `${provider}-1`, provider, family: provider, minConfidence, reading: value };
}

const verify: VerifyAnswer = ({ reading: value, otherReading }) => {
  const base = { ruleset: 'test@1', trace: [] };
  if (value.state === 'blank') return { ...base, status: 'blank', blankEvidence: 'unverified' };
  const canonical = value.answer.replace(/\D/g, '');
  if (canonical === '') return { ...base, status: 'not_derivable' };
  const supported = otherReading?.literal.replace(/\D/g, '').includes(canonical) ?? false;
  return {
    ...base,
    status: 'unique',
    canonical,
    answerText: canonical,
    strength: value.answer === canonical ? 'direct' : 'inferred',
    crossSupport: otherReading ? (supported ? 'supported' : 'unsupported') : 'no_other',
  };
};

describe('consenso interpretado', () => {
  it('acuerda cuando los dos lectores verifican el mismo canónico sobre su umbral', () => {
    const plan = planInterpretedConsensus({
      readers: [reader('gemini', reading('43 estudiantes')), reader('openai', reading('43'))],
      verify,
      format: FORMAT,
      space: OPEN,
    });
    expect(plan.agreement).toEqual({
      kind: 'answer',
      canonical: '43',
      answerText: '43',
      via: 'consensus',
      strength: 'inferred',
      crossSupport: 'supported',
    });
    expect(plan.tiebreakCandidates).toEqual([]);
  });

  it('sin acuerdo bajo el umbral arma los candidatos sin repetir, en el orden de la ruta', () => {
    const plan = planInterpretedConsensus({
      readers: [
        reader('gemini', reading('A 2', 0.99), 0.95),
        reader('openai', reading('a2', 0.5), 0.85),
      ],
      verify,
      format: FORMAT,
      space: OPEN,
    });
    expect(plan.agreement).toBeNull();
    expect(plan.reasons).toContain('low_confidence');
    expect(tiebreakCandidatesOf(plan.readers)).toEqual([{ text: 'A 2', readerIndexes: [0, 1] }]);
  });

  it('un lector que falló no vota y deja la casilla sin acuerdo', () => {
    const plan = planInterpretedConsensus({
      readers: [reader('gemini', reading('7')), reader('openai', null)],
      verify,
      format: FORMAT,
      space: OPEN,
    });
    expect(plan.agreement).toBeNull();
    expect(plan.reasons).toContain('reader_failed');
  });
});

describe('desempate con el motor de decisiones', () => {
  const plan = planInterpretedConsensus({
    readers: [
      reader('gemini', reading('27', 0.99), 0.95),
      reader('openai', reading('21', 0.99, '27 o 21')),
    ],
    verify,
    format: FORMAT,
    space: OPEN,
  });

  it('vale si elige la respuesta de Gemini sobre su umbral, y nunca queda como directa', () => {
    expect(
      applyDecisionTiebreak(plan, { kind: 'candidate', text: '27', confidence: 0.95 }, RULE),
    ).toEqual(expect.objectContaining({ canonical: '27', via: 'tiebreak', strength: 'inferred' }));
  });

  it('no vale si lo que eligió no se desprende del literal del otro lector', () => {
    const unsupported = planInterpretedConsensus({
      readers: [reader('gemini', reading('27', 0.99), 0.95), reader('openai', reading('21', 0.99))],
      verify,
      format: FORMAT,
      space: OPEN,
    });
    expect(
      applyDecisionTiebreak(unsupported, { kind: 'candidate', text: '27', confidence: 0.99 }, RULE),
    ).toBeNull();
  });

  it('no vale si elige una respuesta que Gemini no propuso', () => {
    expect(
      applyDecisionTiebreak(plan, { kind: 'candidate', text: '21', confidence: 0.99 }, RULE),
    ).toBeNull();
  });

  it('no vale bajo su umbral ni cuando elige otra cosa', () => {
    expect(
      applyDecisionTiebreak(plan, { kind: 'candidate', text: '27', confidence: 0.8 }, RULE),
    ).toBeNull();
    expect(applyDecisionTiebreak(plan, { kind: 'other', confidence: 0.99 }, RULE)).toBeNull();
  });

  it('un «en blanco» elegido por el motor no se acepta sin evidencia de que no hay tinta', () => {
    expect(applyDecisionTiebreak(plan, { kind: 'blank', confidence: 0.99 }, RULE)).toBeNull();
  });
});

describe('corrección en un espacio cerrado', () => {
  const matching: AnswerSpace = {
    kind: 'matching',
    codes: [
      { code: 'A.1', column: 'A', index: '1', text: 'Osmosis' },
      { code: 'A.2', column: 'A', index: '2', text: 'Turgencia' },
    ],
  };
  const codeVerify: VerifyAnswer = ({ reading: value }) => ({
    ruleset: 'test@1',
    trace: [],
    status: 'unique',
    canonical: value.answer.toUpperCase().replace(/^A\.?\s*/, 'A.'),
    answerText: value.answer,
    strength: 'direct',
    crossSupport: 'no_other',
  });
  const agreement: AcceptanceAgreement = {
    kind: 'answer',
    canonical: 'A.2',
    answerText: 'A.2',
    via: 'consensus',
    strength: 'direct',
    crossSupport: 'supported',
  };

  it('compara con la clave en el mismo canónico', () => {
    expect(closedSpaceScoring(agreement, ['a2'], codeVerify, FORMAT, matching)).toBe('correct');
    expect(closedSpaceScoring(agreement, ['A.1'], codeVerify, FORMAT, matching)).toBe('incorrect');
  });

  it('no decide en un espacio abierto', () => {
    expect(closedSpaceScoring(agreement, ['A.2'], codeVerify, FORMAT, OPEN)).toBeNull();
  });
});

describe('resultado del consenso interpretado', () => {
  const plan = planInterpretedConsensus({
    readers: [reader('gemini', reading('5')), reader('openai', reading('5'))],
    verify,
    format: FORMAT,
    space: OPEN,
  });
  const base = {
    plan,
    agreement: plan.agreement,
    value: null,
    scoring: 'incorrect' as const,
    policy: POLICY,
    readingKey: 'clave',
  };

  it('lo aceptado queda autoaceptado y usa las lecturas que coincidieron', () => {
    const result = finalizeInterpretedConsensus({ ...base, decision: { action: 'accept' } });
    expect(result.outcome).toBe('auto_accepted');
    expect(result.usedReadingIds).toEqual(['gemini-1', 'openai-1']);
  });

  it('pedir el verificador sin verificador en la ruta manda a revisión, nunca a autoaceptar', () => {
    const result = finalizeInterpretedConsensus({
      ...base,
      decision: { action: 'verify_incorrect', because: ['doubtful_digit'] },
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reasons).toEqual(['verifier_failed']);
  });

  it('la revisión conserva los motivos de la política', () => {
    const result = finalizeInterpretedConsensus({
      ...base,
      decision: { action: 'review', reasons: ['selection_incorrect'] },
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reasons).toEqual(['selection_incorrect']);
  });
});
