import {
  DEFAULT_CONSENSUS_POLICY,
  verificationOutputSchema,
  type ConsensusPolicy,
  type ConsensusResult,
  type ReaderSpec,
  type ResponseFormat,
} from '@soe/types';
import { renderTranscriptionPrompt } from '../prompts/registry';
import {
  acceptedAnswersOf,
  agreedReadingOf,
  applyIncorrectVerification,
  needsIncorrectVerification,
  renderVerificationPrompt,
  verifierClears,
} from './verify-incorrect';
import { verificationJsonSchema } from './verification-json-schema';

const VERIFIER: ReaderSpec = {
  key: 'luna-verifier',
  transcriberId: 'llm',
  provider: 'openai',
  family: 'openai-luna',
  model: 'gpt-6-luna',
  promptRef: 'verify.incorrect@1',
  hints: 'format',
  minConfidence: 0.9,
  params: { maxOutputTokens: 1024, reasoning: 'low', timeoutMs: 30000 },
};

const WITH_VERIFIER: ConsensusPolicy = { ...DEFAULT_CONSENSUS_POLICY, incorrectVerifier: VERIFIER };

const SEQUENCE: ResponseFormat = { kind: 'sequence', length: 3 };

function decision(overrides: Partial<ConsensusResult> = {}): ConsensusResult {
  return {
    outcome: 'auto_accepted',
    value: {
      formatKind: 'sequence',
      state: 'answered',
      canonical: 's:8|15|12',
      value: { type: 'sequence', items: [] } as never,
      issues: [],
    },
    scoringOutcome: 'incorrect',
    reasons: [],
    reviewMode: null,
    usedReadingIds: ['a', 'b'],
    policyId: WITH_VERIFIER.id,
    policyVersion: WITH_VERIFIER.version,
    ...overrides,
  };
}

const says = (couldBeKey: boolean, confidence: number) => ({
  status: 'ok' as const,
  output: { notes: 'trazos', differingCharacters: [], couldBeKey, confidence },
});

describe('verificador de incorrectas: cuándo corre', () => {
  it('solo con verificador en la política y una incorrecta o parcial autoaceptada', () => {
    expect(needsIncorrectVerification(decision(), WITH_VERIFIER)).toBe(true);
    expect(needsIncorrectVerification(decision({ scoringOutcome: 'partial' }), WITH_VERIFIER)).toBe(
      true,
    );
    expect(needsIncorrectVerification(decision(), DEFAULT_CONSENSUS_POLICY)).toBe(false);
    expect(needsIncorrectVerification(decision({ scoringOutcome: 'correct' }), WITH_VERIFIER)).toBe(
      false,
    );
    expect(
      needsIncorrectVerification(
        decision({ outcome: 'needs_review', reasons: ['audit_sample'] }),
        WITH_VERIFIER,
      ),
    ).toBe(false);
    expect(needsIncorrectVerification(decision({ outcome: 'auto_blank' }), WITH_VERIFIER)).toBe(
      false,
    );
  });
});

describe('verificador de incorrectas: solo puede mandar a revisión', () => {
  it('"podría ser la clave" manda a revisión de lectura y conserva la propuesta', () => {
    const flagged = applyIncorrectVerification(decision(), WITH_VERIFIER, says(true, 0.95));
    expect(flagged).toMatchObject({
      outcome: 'needs_review',
      reasons: ['verifier_flagged'],
      reviewMode: 'reading',
      scoringOutcome: 'incorrect',
      usedReadingIds: ['a', 'b'],
    });
    expect(flagged.value).toEqual(decision().value);
  });

  it('un "no" con confianza bajo el umbral es una duda del verificador', () => {
    expect(applyIncorrectVerification(decision(), WITH_VERIFIER, says(false, 0.8))).toMatchObject({
      outcome: 'needs_review',
      reasons: ['verifier_flagged'],
      reviewMode: 'reading',
    });
  });

  it('una falla, un plazo vencido o la falta de veredicto mandan a revisión de lectura sin decir que duda', () => {
    for (const verdict of [
      { status: 'error' as const, output: null },
      { status: 'timeout' as const, output: null },
      { status: 'invalid_output' as const, output: null },
      { status: 'refused' as const, output: null },
      null,
    ]) {
      expect(applyIncorrectVerification(decision(), WITH_VERIFIER, verdict)).toMatchObject({
        outcome: 'needs_review',
        reasons: ['verifier_failed'],
        reviewMode: 'reading',
      });
    }
  });

  it('un "no" con confianza suficiente deja la decisión intacta', () => {
    const kept = decision();
    expect(applyIncorrectVerification(kept, WITH_VERIFIER, says(false, 0.9))).toBe(kept);
    expect(verifierClears(says(false, 0.9), 0.9)).toBe(true);
    expect(verifierClears(says(true, 0.99), 0.5)).toBe(false);
  });

  it('nunca convierte en aceptada ni toca una decisión que no necesitaba verificación', () => {
    for (const result of [
      decision({ outcome: 'needs_review', reasons: ['low_confidence'], reviewMode: 'reading' }),
      decision({ scoringOutcome: 'correct' }),
      decision({ outcome: 'auto_blank', scoringOutcome: 'incorrect' }),
    ]) {
      for (const verdict of [says(false, 1), says(true, 1), null]) {
        expect(applyIncorrectVerification(result, WITH_VERIFIER, verdict)).toBe(result);
      }
    }
    const withoutVerifier = decision();
    expect(applyIncorrectVerification(withoutVerifier, DEFAULT_CONSENSUS_POLICY, null)).toBe(
      withoutVerifier,
    );
  });

  it('sin minConfidence propio el verificador usa el umbral de la política', () => {
    const policy = {
      ...WITH_VERIFIER,
      minConfidence: 0.7,
      incorrectVerifier: { ...VERIFIER, minConfidence: undefined },
    };
    expect(applyIncorrectVerification(decision(), policy, says(false, 0.75)).outcome).toBe(
      'auto_accepted',
    );
  });
});

describe('verificador de incorrectas: lo que ve', () => {
  it('la lectura acordada sale del primer lector usado por el consenso', () => {
    const output = {
      characters: [],
      state: 'answered' as const,
      literal: '8, 15, 12',
      parts: { e1: '8', e2: '15', e3: '12' },
      alternativeReadings: [],
      confidence: 0.98,
      reviewRequested: false,
      notes: '',
    };
    const readings = [
      {
        readingId: 'z',
        family: 'x',
        status: 'ok' as const,
        output: { ...output, literal: 'otra' },
      },
      { readingId: 'a', family: 'gemini', status: 'ok' as const, output },
    ];
    expect(agreedReadingOf(decision(), readings)).toEqual({
      literal: '8, 15, 12',
      parts: { e1: '8', e2: '15', e3: '12' },
    });
    expect(agreedReadingOf(decision({ usedReadingIds: [] }), readings)).toBeNull();
  });

  it('las respuestas correctas salen de la clave del ítem', () => {
    expect(
      acceptedAnswersOf({
        type: 'short_answer',
        content: { prompt: 'p', acceptedAnswers: ['8, 10, 12'] },
      }),
    ).toEqual(['8, 10, 12']);
    expect(
      acceptedAnswersOf({
        type: 'gap_fill',
        content: {
          textWithGaps: '___ + ___',
          gaps: [
            { position: 0, label: 'Decenas:', acceptedAnswers: ['40'] },
            { position: 1, acceptedAnswers: ['7', 'siete'] },
          ],
        },
      }),
    ).toEqual(['Decenas: "40" · Espacio 2: "7" o "siete"']);
    expect(acceptedAnswersOf({ type: 'rubric_scored', content: { levels: [] } })).toEqual([]);
  });

  it('el prompt de verificación recibe la clave y la lectura; el de transcripción nunca', () => {
    const { prompt, outputSchema } = renderVerificationPrompt({
      reader: VERIFIER,
      format: SEQUENCE,
      agreedReading: { literal: '8, 15, 12', parts: { e1: '8', e2: '15', e3: '12' } },
      acceptedAnswers: ['8, 10, 12'],
      gradeName: '6° Básico',
    });
    expect(prompt.ref).toBe('verify.incorrect@1');
    expect(prompt.user).toMatch(/8, 15, 12/);
    expect(prompt.user).toMatch(/Por casilla: e1 = "8"; e2 = "15"; e3 = "12"/);
    expect(prompt.user).toMatch(/- 8, 10, 12/);
    expect(prompt.user).toMatch(/FORMATO DE LA CASILLA: /);
    expect(prompt.system).toMatch(/6° Básico/);
    expect(prompt.system).toMatch(/escéptico/);
    expect(`${prompt.system}${prompt.user}`).not.toMatch(/\b(vos|tenés|podés|marcá|fijate)\b/);
    expect(outputSchema.propertyOrder).toEqual([
      'notes',
      'differingCharacters',
      'couldBeKey',
      'confidence',
    ]);
    const transcription = renderTranscriptionPrompt(
      { promptRef: 'transcribe.short-answer@2', hints: 'format' },
      SEQUENCE,
      { gradeName: '6° Básico' },
    );
    expect(`${transcription.prompt.system}${transcription.prompt.user}`).not.toMatch(/8, 10, 12/);
  });

  it('rechaza un prompt que no es de verificación, un formato de rúbrica o un ítem sin clave', () => {
    const input = {
      reader: VERIFIER,
      format: SEQUENCE,
      agreedReading: { literal: '1', parts: null },
      acceptedAnswers: ['2'],
    };
    expect(() =>
      renderVerificationPrompt({
        ...input,
        reader: { ...VERIFIER, promptRef: 'transcribe.short-answer@2' },
      }),
    ).toThrow(/no verifica/);
    expect(() =>
      renderVerificationPrompt({ ...input, format: { kind: 'free_text', lines: 4 } }),
    ).toThrow(/no verifica/);
    expect(() => renderVerificationPrompt({ ...input, acceptedAnswers: [] })).toThrow(
      /clave|correcta/,
    );
    expect(() =>
      renderTranscriptionPrompt({ promptRef: 'verify.incorrect@1', hints: 'none' }, SEQUENCE),
    ).toThrow(/no sirve/);
  });

  it('el esquema JSON y el de Zod piden las mismas claves', () => {
    const { schema } = verificationJsonSchema();
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(verificationOutputSchema.shape).sort(),
    );
  });
});
