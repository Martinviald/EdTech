import type {
  AnswerSpace,
  InterpretedReading,
  RecoveryRules,
  ResponseFormat,
  ScoringOutcome,
} from '@soe/types';
import type { AcceptanceAgreement } from '../answer-verification/acceptance';
import type { VerifyAnswer } from '../answer-verification/verified-answer';
import { verifyAnswer } from '../answer-verification/verify-answer';
import { planInterpretedConsensus, type InterpretedReaderResult } from './interpreted-consensus';
import { recoverAgreement, recoveryRulesOf } from './recovery-rules';

const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };
const SHORT: ResponseFormat = { kind: 'short_text', maxWords: 4 };
const OPEN: AnswerSpace = { kind: 'open' };
const DIGESTION: AnswerSpace = {
  kind: 'matching',
  codes: ['Intestino grueso', 'Esófago', 'Estómago', 'Hígado'].map((text, position) => ({
    code: `A.${position + 1}`,
    column: 'A',
    index: String(position + 1),
    text,
  })),
};
const ALL_RULES: RecoveryRules = { matchingColumn: true, keyAnchor: { provider: 'gemini' } };

function reading(
  answer: string,
  confidence = 0.99,
  extra: Partial<InterpretedReading> = {},
): InterpretedReading {
  return { literal: answer, state: 'answered', answer, candidates: [], confidence, ...extra };
}

function reader(
  provider: 'gemini' | 'openai',
  value: InterpretedReading | null,
  minConfidence: number,
): InterpretedReaderResult {
  return { readingId: `${provider}-1`, provider, family: provider, minConfidence, reading: value };
}

const digitsOnly: VerifyAnswer = ({ reading: value, otherReading }) => {
  const base = { ruleset: 'test@1', trace: [] };
  if (value.state === 'blank') return { ...base, status: 'blank', blankEvidence: 'unverified' };
  const canonical = value.answer.replace(/\D/g, '');
  if (canonical === '') return { ...base, status: 'not_derivable' };
  return {
    ...base,
    status: 'unique',
    canonical,
    answerText: canonical,
    strength: 'direct',
    crossSupport: otherReading ? 'unsupported' : 'no_other',
  };
};

function scoreAgainst(key: string) {
  return (agreement: AcceptanceAgreement): ScoringOutcome | null =>
    agreement.kind === 'answer' ? (agreement.canonical === key ? 'correct' : 'incorrect') : null;
}

function integerPlan(gemini: InterpretedReading | null, openai: InterpretedReading | null) {
  return planInterpretedConsensus({
    readers: [reader('gemini', gemini, 0.95), reader('openai', openai, 0.85)],
    verify: digitsOnly,
    format: INTEGER,
    space: OPEN,
  });
}

function recoverInteger(
  gemini: InterpretedReading | null,
  openai: InterpretedReading | null,
  key: string,
  rules: RecoveryRules = ALL_RULES,
) {
  return recoverAgreement(integerPlan(gemini, openai), rules, {
    verify: digitsOnly,
    format: INTEGER,
    space: OPEN,
    scoreOf: scoreAgainst(key),
  });
}

function matchingPlan(gemini: InterpretedReading, openai: InterpretedReading) {
  return planInterpretedConsensus({
    readers: [reader('gemini', gemini, 0.95), reader('openai', openai, 0.85)],
    verify: verifyAnswer,
    format: SHORT,
    space: DIGESTION,
  });
}

function recoverMatching(
  gemini: InterpretedReading,
  openai: InterpretedReading,
  space: AnswerSpace = DIGESTION,
  rules: RecoveryRules = { matchingColumn: true, keyAnchor: null },
) {
  return recoverAgreement(matchingPlan(gemini, openai), rules, {
    verify: verifyAnswer,
    format: SHORT,
    space,
    scoreOf: () => 'incorrect',
  });
}

describe('recoveryRulesOf', () => {
  it('sin reglas declaradas las prende con el ancla del desempate', () => {
    expect(
      recoveryRulesOf({
        readMode: 'interpreted',
        decisionTiebreak: { minConfidence: 0.9, agreeWithProvider: 'gemini' },
      }),
    ).toEqual(ALL_RULES);
  });

  it('sin desempate no hay ancla, pero el pareo por columna sigue prendido', () => {
    expect(recoveryRulesOf({ readMode: 'interpreted' })).toEqual({
      matchingColumn: true,
      keyAnchor: null,
    });
  });

  it('respeta las reglas declaradas en la política', () => {
    const off: RecoveryRules = { matchingColumn: false, keyAnchor: null };
    expect(recoveryRulesOf({ readMode: 'interpreted', recoveryRules: off })).toEqual(off);
  });

  it('en la lectura literal no aplica ninguna', () => {
    expect(recoveryRulesOf({ readMode: 'literal', recoveryRules: ALL_RULES })).toEqual({
      matchingColumn: false,
      keyAnchor: null,
    });
  });
});

describe('regla key_anchor', () => {
  it('recupera la respuesta del ancla sobre su umbral cuando es correcta', () => {
    const recovered = recoverInteger(reading('43', 0.97), reading('48', 0.6), '43');
    expect(recovered).toEqual({
      rule: 'key_anchor',
      agreement: {
        kind: 'answer',
        canonical: '43',
        answerText: '43',
        via: 'tiebreak',
        strength: 'inferred',
        crossSupport: 'unsupported',
      },
    });
  });

  it('recupera aunque el otro lector haya fallado', () => {
    expect(recoverInteger(reading('43', 0.97), null, '43')?.rule).toBe('key_anchor');
  });

  it('rechaza si el otro lector leyó una variante confundible de un dígito', () => {
    expect(recoverInteger(reading('17', 0.97), reading('77', 0.9), '17')).toBeNull();
    expect(recoverInteger(reading('41', 0.97), reading('44', 0.9), '41')).toBeNull();
  });

  it('rechaza si el ancla está bajo su umbral', () => {
    expect(recoverInteger(reading('43', 0.9), reading('48', 0.9), '43')).toBeNull();
  });

  it('rechaza si la respuesta del ancla es incorrecta', () => {
    expect(recoverInteger(reading('43', 0.97), reading('48', 0.9), '48')).toBeNull();
  });

  it('rechaza si la respuesta del ancla no es única', () => {
    expect(recoverInteger(reading('sin número', 0.97), reading('43', 0.9), '43')).toBeNull();
  });

  it('no actúa si la política la apaga', () => {
    expect(
      recoverInteger(reading('43', 0.97), reading('48', 0.6), '43', {
        matchingColumn: true,
        keyAnchor: null,
      }),
    ).toBeNull();
  });

  it('no recupera nada si el plan ya trae acuerdo', () => {
    const plan = integerPlan(reading('43', 0.99), reading('43', 0.99));
    expect(plan.agreement).not.toBeNull();
    expect(
      recoverAgreement(plan, ALL_RULES, {
        verify: digitsOnly,
        format: INTEGER,
        space: OPEN,
        scoreOf: scoreAgainst('43'),
      }),
    ).toBeNull();
  });
});

describe('regla matching_column', () => {
  it('acuerda cuando cada lector apunta a un único código y es el mismo', () => {
    const recovered = recoverMatching(
      reading('A.2', 0.9),
      reading('Esófago', 0.7, { literal: 'Esófago' }),
    );
    expect(recovered).toEqual({
      rule: 'matching_column',
      agreement: {
        kind: 'answer',
        canonical: 'A.2',
        answerText: 'A.2',
        via: 'consensus',
        strength: 'inferred',
        crossSupport: 'supported',
      },
    });
  });

  it('rechaza si un lector apunta a más de un código', () => {
    expect(
      recoverMatching(reading('A.2', 0.9), reading('A.2', 0.7, { candidates: ['A.3'] })),
    ).toBeNull();
  });

  it('rechaza si los lectores apuntan a códigos distintos', () => {
    expect(recoverMatching(reading('A.2', 0.9), reading('A.3', 0.7))).toBeNull();
  });

  it('no actúa en un espacio abierto', () => {
    expect(recoverMatching(reading('A.2', 0.9), reading('A.2', 0.7), OPEN)).toBeNull();
  });

  it('no actúa si la política la apaga', () => {
    expect(
      recoverMatching(reading('A.2', 0.9), reading('Esófago', 0.7), DIGESTION, {
        matchingColumn: false,
        keyAnchor: null,
      }),
    ).toBeNull();
  });

  it('va antes que key_anchor', () => {
    const recovered = recoverAgreement(
      matchingPlan(reading('A.2', 0.97), reading('Esófago', 0.7)),
      ALL_RULES,
      { verify: verifyAnswer, format: SHORT, space: DIGESTION, scoreOf: () => 'correct' },
    );
    expect(recovered?.rule).toBe('matching_column');
  });
});
