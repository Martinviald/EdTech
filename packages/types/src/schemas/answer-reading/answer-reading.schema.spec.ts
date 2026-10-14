import {
  CROP_PROFILES,
  DEFAULT_CONSENSUS_POLICY,
  DEFAULT_ORG_ANSWER_READING_SETTINGS,
  READING_AUDIT_REASONS,
  REVIEW_MODE_BY_REASON,
  REVIEW_REASONS,
  TRANSCRIPTION_OUTPUT_KEYS,
  consensusPolicySchema,
  cropProfileSchema,
  orgAnswerReadingSettingsSchema,
  promptVersionSchema,
  readerSpecSchema,
  responseFormatSchema,
  reviewModeFor,
  readingAuditOutputSchema,
  reviewQueueQuerySchema,
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

  it('el umbral de confianza del lector es opcional y está entre 0 y 1 (E1-1)', () => {
    const reader = {
      key: 'flash',
      transcriberId: 'gemini',
      provider: 'gemini',
      family: 'gemini',
      model: 'gemini-3.5-flash',
      promptRef: 'transcribe.short-answer@2',
      hints: 'none',
      params: { maxOutputTokens: 512, reasoning: 'off', timeoutMs: 30000 },
    };
    expect(readerSpecSchema.safeParse(reader).success).toBe(true);
    expect(readerSpecSchema.parse({ ...reader, minConfidence: 0.97 }).minConfidence).toBe(0.97);
    expect(readerSpecSchema.safeParse({ ...reader, minConfidence: 1.2 }).success).toBe(false);
  });

  it('el verificador de incorrectas es opcional en la política y sus motivos se revisan como lectura (T4)', () => {
    const verifier = {
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
    expect(consensusPolicySchema.parse(DEFAULT_CONSENSUS_POLICY).incorrectVerifier).toBeUndefined();
    expect(
      consensusPolicySchema.parse({ ...DEFAULT_CONSENSUS_POLICY, incorrectVerifier: verifier })
        .incorrectVerifier?.key,
    ).toBe('luna-verifier');
    expect(REVIEW_MODE_BY_REASON.verifier_flagged).toBe('reading');
    expect(REVIEW_MODE_BY_REASON.verifier_failed).toBe('reading');
    expect(reviewModeFor(['verifier_flagged'])).toBe('reading');
    expect(reviewModeFor(['verifier_failed'])).toBe('reading');
    expect(reviewModeFor(['policy_requires_review', 'verifier_flagged'])).toBe('reading');
    expect(REVIEW_MODE_BY_REASON.scoring_changed).toBe('reading');
  });

  it('el escalamiento del desempate es opcional y acotado a motivos de lectura', () => {
    expect(consensusPolicySchema.parse(DEFAULT_CONSENSUS_POLICY).tiebreakOn).toBeUndefined();
    const escalation = {
      ...DEFAULT_CONSENSUS_POLICY,
      tiebreakOn: ['readers_disagree', 'low_confidence', 'reader_requested_review'],
      tiebreakAgreeWith: 'other_provider',
    };
    expect(consensusPolicySchema.parse(escalation)).toMatchObject({
      tiebreakOn: ['readers_disagree', 'low_confidence', 'reader_requested_review'],
      tiebreakAgreeWith: 'other_provider',
    });
    expect(consensusPolicySchema.safeParse({ ...escalation, tiebreakOn: [] }).success).toBe(false);
    expect(
      consensusPolicySchema.safeParse({ ...escalation, tiebreakOn: ['undecidable'] }).success,
    ).toBe(false);
    expect(
      consensusPolicySchema.safeParse({ ...escalation, tiebreakAgreeWith: 'same_family' }).success,
    ).toBe(false);
  });

  it('el auditor de lectura es opcional, acotado y con su propio umbral', () => {
    const auditor = {
      reader: {
        key: 'gemini-3.8-flash-auditor',
        transcriberId: 'llm',
        provider: 'gemini',
        family: 'gemini-flash',
        model: 'gemini-3.8-flash',
        promptRef: 'audit.reading@1',
        hints: 'format',
        params: { maxOutputTokens: 4096, reasoning: 'off', timeoutMs: 90000 },
      },
      minConfidence: 0.9,
      candidate: 'agreement_or_top',
    };
    expect(consensusPolicySchema.parse(DEFAULT_CONSENSUS_POLICY).readingAuditor).toBeUndefined();
    expect(
      consensusPolicySchema.parse({ ...DEFAULT_CONSENSUS_POLICY, readingAuditor: auditor })
        .readingAuditor,
    ).toEqual(auditor);
    const withAuditor = (readingAuditor: unknown) =>
      consensusPolicySchema.safeParse({ ...DEFAULT_CONSENSUS_POLICY, readingAuditor }).success;
    expect(withAuditor({ ...auditor, minConfidence: 1.2 })).toBe(false);
    expect(withAuditor({ ...auditor, candidate: 'any' })).toBe(false);
    expect(withAuditor({ ...auditor, extra: true })).toBe(false);
    expect(withAuditor({ ...auditor, reader: { ...auditor.reader, minConfidence: 0.5 } })).toBe(
      false,
    );
    expect(READING_AUDIT_REASONS).toEqual([
      'readers_disagree',
      'low_confidence',
      'reader_requested_review',
    ]);
    expect(
      readingAuditOutputSchema.safeParse({
        notes: 'trazos',
        suspiciousCharacters: ['3 → 5'],
        verdict: 'reject',
        confidence: 0.9,
      }).success,
    ).toBe(true);
    expect(
      readingAuditOutputSchema.safeParse({
        notes: '',
        suspiciousCharacters: [],
        verdict: 'maybe',
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('un prompt de auditoría de lectura nunca declara la clave ni la lectura acordada', () => {
    const prompt = {
      id: 'audit.reading',
      version: 9,
      purpose: 'reading_audit',
      formatKinds: ['integer'],
      outputSchemaId: 'reading-audit-output@1',
      variables: ['gradeName', 'formatLabel', 'stem', 'transcription'],
      system: 'x',
      user: 'y',
      status: 'draft',
    };
    expect(promptVersionSchema.safeParse(prompt).success).toBe(true);
    for (const forbidden of ['acceptedAnswers', 'agreedReading']) {
      expect(
        promptVersionSchema.safeParse({ ...prompt, variables: [...prompt.variables, forbidden] })
          .success,
      ).toBe(false);
    }
  });

  it('la clave y la lectura acordada solo se declaran en prompts de verificación (T4)', () => {
    const prompt = {
      id: 'verify.incorrect',
      version: 9,
      purpose: 'verification',
      formatKinds: ['integer'],
      outputSchemaId: 'verification-output@1',
      variables: ['agreedReading', 'acceptedAnswers'],
      system: 'x',
      user: 'y',
      status: 'draft',
    };
    expect(promptVersionSchema.safeParse(prompt).success).toBe(true);
    for (const purpose of ['transcription', 'rubric_grading']) {
      for (const variables of [['acceptedAnswers'], ['agreedReading']]) {
        expect(promptVersionSchema.safeParse({ ...prompt, purpose, variables }).success).toBe(
          false,
        );
      }
    }
    expect(
      promptVersionSchema.safeParse({
        ...prompt,
        purpose: 'transcription',
        variables: ['transcription'],
      }).success,
    ).toBe(false);
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

  it('las casillas múltiples aceptan un signo de operación impreso antes de la casilla', () => {
    const boxes = [
      { partId: 'a', label: 'Sumando', kind: 'integer' },
      { partId: 'b', label: 'Sumando', kind: 'integer', operatorBefore: '+' },
      { partId: 'c', label: 'Total', kind: 'integer', operatorBefore: '=' },
    ];
    expect(responseFormatSchema.safeParse({ kind: 'multi_box', boxes }).success).toBe(true);
    expect(
      responseFormatSchema.safeParse({
        kind: 'multi_box',
        boxes: [boxes[0], { ...boxes[1], operatorBefore: '√' }],
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

describe('contrato de la cola de revisión', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('exige una evaluación o un lote, no ambos', () => {
    expect(reviewQueueQuerySchema.safeParse({ assessmentId: id }).success).toBe(true);
    expect(reviewQueueQuerySchema.safeParse({}).success).toBe(false);
    expect(reviewQueueQuerySchema.safeParse({ assessmentId: id, batchId: id }).success).toBe(false);
  });

  it('lee includeAudit=false como falso y rechaza claves desconocidas', () => {
    const parsed = reviewQueueQuerySchema.parse({ batchId: id, includeAudit: 'false' });
    expect(parsed.includeAudit).toBe(false);
    expect(reviewQueueQuerySchema.safeParse({ batchId: id, limit: '10' }).success).toBe(false);
  });
});
