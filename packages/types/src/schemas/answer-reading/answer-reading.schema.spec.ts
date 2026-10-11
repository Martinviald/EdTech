import {
  CROP_PROFILES,
  DEFAULT_CONSENSUS_POLICY,
  DEFAULT_ORG_ANSWER_READING_SETTINGS,
  REVIEW_MODE_BY_REASON,
  REVIEW_REASONS,
  TRANSCRIPTION_OUTPUT_KEYS,
  consensusPolicySchema,
  cropProfileSchema,
  orgAnswerReadingSettingsSchema,
  responseFormatSchema,
  reviewModeFor,
  submitReviewSchema,
  transcriptionOutputSchema,
} from './index';
import { shortAnswerContentSchema } from '../item-content.schema';
import { scoringConfigSchema } from '../item.schema';

describe('contratos de lectura por visión', () => {
  it('la política por defecto autoacepta correctas e incorrectas con auditoría (D5)', () => {
    expect(consensusPolicySchema.parse(DEFAULT_CONSENSUS_POLICY)).toEqual(DEFAULT_CONSENSUS_POLICY);
    expect(DEFAULT_CONSENSUS_POLICY.autoAcceptOutcomes).toEqual(['correct', 'incorrect']);
    expect(DEFAULT_CONSENSUS_POLICY.requireDistinctFamilies).toBe(true);
    expect(DEFAULT_CONSENSUS_POLICY.auditSampleRate).toBeGreaterThan(0);
  });

  it('el interruptor de imágenes a terceros viene apagado y el dataset es interno (D3, D7)', () => {
    expect(DEFAULT_ORG_ANSWER_READING_SETTINGS.allowExternalVision).toBe(true);
    expect(DEFAULT_ORG_ANSWER_READING_SETTINGS.datasetConsent).toBe('org_internal');
  });

  it('los ajustes por organización rechazan claves desconocidas', () => {
    expect(orgAnswerReadingSettingsSchema.safeParse({ enabled: true, otra: 1 }).success).toBe(
      false,
    );
  });

  it('todos los perfiles de recorte son válidos', () => {
    for (const profile of Object.values(CROP_PROFILES)) {
      expect(cropProfileSchema.safeParse(profile).success).toBe(true);
    }
  });

  it('cada motivo de revisión tiene un modo y la lectura se resuelve antes que la corrección (D8)', () => {
    for (const reason of REVIEW_REASONS) {
      expect(REVIEW_MODE_BY_REASON[reason]).toBeDefined();
    }
    expect(reviewModeFor(['unparsed_format'])).toBe('grading');
    expect(reviewModeFor(['unparsed_format', 'readers_disagree'])).toBe('reading');
  });

  it('el DTO de revisión valida que la acción calce con el modo', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      submitReviewSchema.safeParse({ decisionIds: [id], mode: 'reading', action: 'accept' })
        .success,
    ).toBe(true);
    expect(
      submitReviewSchema.safeParse({ decisionIds: [id], mode: 'reading', action: 'mark_correct' })
        .success,
    ).toBe(false);
    expect(
      submitReviewSchema.safeParse({ decisionIds: [id], mode: 'grading', action: 'edit' }).success,
    ).toBe(false);
    expect(
      submitReviewSchema.safeParse({
        decisionIds: [id],
        mode: 'grading',
        action: 'edit',
        editedLiteral: '3/4',
      }).success,
    ).toBe(true);
  });

  it('la salida del lector pone el análisis por carácter antes del literal', () => {
    expect(Object.keys(transcriptionOutputSchema.shape)).toEqual([...TRANSCRIPTION_OUTPUT_KEYS]);
    expect(TRANSCRIPTION_OUTPUT_KEYS.indexOf('characters')).toBeLessThan(
      TRANSCRIPTION_OUTPUT_KEYS.indexOf('literal'),
    );
  });

  it('el formato de respuesta es opcional en el contenido y estricto en su forma', () => {
    const base = { prompt: '¿Cuánto es 3/4 + 1/4?', acceptedAnswers: ['1'] };
    expect(shortAnswerContentSchema.safeParse(base).success).toBe(true);
    expect(
      shortAnswerContentSchema.safeParse({
        ...base,
        responseFormat: { kind: 'fraction', allowNegative: false, allowMixed: true },
      }).success,
    ).toBe(true);
    expect(
      responseFormatSchema.safeParse({
        kind: 'integer',
        maxChars: 4,
        allowNegative: false,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('las equivalencias y el crédito por componente viajan en scoring_config', () => {
    expect(
      scoringConfigSchema.safeParse({
        points: 1,
        equivalences: { requireSimplified: true },
        componentCredit: { mode: 'per_component', creditPerComponent: [0.5, 0.5] },
      }).success,
    ).toBe(true);
    expect(scoringConfigSchema.safeParse({ equivalences: { desconocida: true } }).success).toBe(
      false,
    );
  });
});
