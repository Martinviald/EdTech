import {
  MARK_AI_VERDICTS,
  markAiResolutionSchema,
  markAnswerToReview,
  reviewToMarkAnswer,
} from '../index';

const VALID = {
  version: 'mark-disambiguation-v1',
  mode: 'live',
  verdict: 'agree',
  route: 'auto',
  value: 'B',
  applied: true,
  engines: [
    {
      feature: 'mark_disambiguation_jev',
      engine: 'jev',
      model: 'jev-1.14.0',
      choice: 'B',
      confidence: 0.95,
      errorCode: null,
    },
    {
      feature: 'mark_disambiguation_openai',
      engine: 'openai',
      model: 'gpt-6-luna',
      choice: 'B',
      confidence: 0.9,
      errorCode: null,
    },
  ],
  thresholds: {
    jev: { agree: 0.6, solo: 0.85, unsure: 0.5 },
    openai: { agree: 0.5, solo: 0.8, unsure: 0.5 },
  },
  decidedAt: '2026-10-22T12:00:00.000Z',
};

describe('markAiResolutionSchema', () => {
  it('acepta la evidencia completa', () => {
    expect(markAiResolutionSchema.safeParse(VALID).success).toBe(true);
  });

  it('acepta umbrales nulos y los veredictos propios del dominio', () => {
    for (const verdict of ['audit_sample', 'vetoed', 'no_thresholds']) {
      expect(
        markAiResolutionSchema.safeParse({
          ...VALID,
          verdict,
          route: 'review',
          applied: false,
          thresholds: { jev: null, openai: null },
        }).success,
      ).toBe(true);
    }
    expect(MARK_AI_VERDICTS).toContain('engine_failed');
  });

  it('rechaza una versión, un modo o un veredicto desconocidos', () => {
    expect(markAiResolutionSchema.safeParse({ ...VALID, version: 'v2' }).success).toBe(false);
    expect(markAiResolutionSchema.safeParse({ ...VALID, mode: 'off' }).success).toBe(false);
    expect(markAiResolutionSchema.safeParse({ ...VALID, verdict: 'otro' }).success).toBe(false);
  });
});

describe('traducción respuesta ↔ decisión de la marca', () => {
  it('opción → option, blank → blank, null → annulled', () => {
    expect(markAnswerToReview('C')).toEqual({ reviewDecision: 'option', reviewedValue: 'C' });
    expect(markAnswerToReview('blank')).toEqual({ reviewDecision: 'blank', reviewedValue: null });
    expect(markAnswerToReview('null')).toEqual({ reviewDecision: 'annulled', reviewedValue: null });
  });

  it('la inversa reconstruye la respuesta', () => {
    expect(reviewToMarkAnswer('option', 'C')).toBe('C');
    expect(reviewToMarkAnswer('blank', null)).toBe('blank');
    expect(reviewToMarkAnswer('annulled', null)).toBe('null');
    expect(reviewToMarkAnswer(null, null)).toBeNull();
  });
});
