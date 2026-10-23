import type { AcceptanceAgreement, AcceptanceInput } from './acceptance';
import { decideAcceptance } from './decide-acceptance';

function answer(
  overrides: Partial<Extract<AcceptanceAgreement, { kind: 'answer' }>> = {},
): AcceptanceAgreement {
  return {
    kind: 'answer',
    canonical: 'n:65',
    answerText: '65',
    via: 'consensus',
    strength: 'direct',
    crossSupport: 'supported',
    ...overrides,
  };
}

function input(overrides: Partial<AcceptanceInput>): AcceptanceInput {
  return { verified: [], agreement: answer(), scoring: 'incorrect', readings: [], ...overrides };
}

describe('decideAcceptance', () => {
  it('una correcta acordada se acepta, aunque sea inferida o venga del desempate', () => {
    for (const agreement of [
      answer(),
      answer({ strength: 'inferred' }),
      answer({ via: 'tiebreak' }),
    ]) {
      expect(decideAcceptance(input({ agreement, scoring: 'correct' }))).toEqual({
        action: 'accept',
      });
    }
  });

  it('una incorrecta directa, respaldada y sin dígitos dudosos se acepta', () => {
    expect(decideAcceptance(input({}))).toEqual({ action: 'accept' });
  });

  it('una incorrecta con 1, 7 o 4 pasa por el verificador', () => {
    expect(decideAcceptance(input({ agreement: answer({ answerText: '27/10' }) }))).toEqual({
      action: 'verify_incorrect',
      because: ['doubtful_digit'],
    });
  });

  it('una incorrecta inferida o resuelta por desempate pasa por el verificador', () => {
    expect(
      decideAcceptance(input({ agreement: answer({ strength: 'inferred', via: 'tiebreak' }) })),
    ).toEqual({ action: 'verify_incorrect', because: ['inferred', 'tiebreak'] });
  });

  it('una selección incorrecta va a revisión', () => {
    expect(decideAcceptance(input({ agreement: answer({ strength: 'selection' }) }))).toEqual({
      action: 'review',
      reasons: ['selection_incorrect'],
    });
  });

  it('una incorrecta que el otro literal no sostiene va a revisión', () => {
    expect(decideAcceptance(input({ agreement: answer({ crossSupport: 'unsupported' }) }))).toEqual(
      { action: 'review', reasons: ['answer_not_derivable'] },
    );
  });

  it('sin corrección posible va a revisión', () => {
    expect(decideAcceptance(input({ scoring: 'undecidable' }))).toEqual({
      action: 'review',
      reasons: ['undecidable'],
    });
  });

  it('un blanco solo se acepta con evidencia de que no hay tinta', () => {
    expect(
      decideAcceptance(input({ agreement: { kind: 'blank', blankEvidence: 'ink_absent' } })),
    ).toEqual({ action: 'accept_blank' });
    expect(
      decideAcceptance(input({ agreement: { kind: 'blank', blankEvidence: 'unverified' } })),
    ).toEqual({ action: 'review', reasons: ['blank_unverified'] });
  });

  it('sin acuerdo, los motivos salen de lo que pasó en la verificación', () => {
    const decision = decideAcceptance(
      input({
        agreement: null,
        verified: [
          { ruleset: 'verify@1', status: 'out_of_space', trace: [] },
          { ruleset: 'verify@1', status: 'blank', blankEvidence: 'unverified', trace: [] },
        ],
      }),
    );
    expect(decision).toEqual({
      action: 'review',
      reasons: ['answer_out_of_space', 'blank_unverified'],
    });
  });

  it('sin acuerdo y con dos respuestas válidas distintas, los lectores no coinciden', () => {
    expect(decideAcceptance(input({ agreement: null }))).toEqual({
      action: 'review',
      reasons: ['readers_disagree'],
    });
  });
});
