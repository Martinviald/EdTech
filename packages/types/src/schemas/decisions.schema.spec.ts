import {
  confidenceThresholdsSchema,
  DECISION_FEATURE_DEFAULTS,
  DECISION_FEATURES,
  decisionAnswerRecordSchema,
  decisionFeatureSchema,
  decisionModeSchema,
  decisionThresholdsSchema,
  MARK_DISAMBIGUATION_FEATURES,
  MARK_DISAMBIGUATION_QUESTION_ID,
  noulThresholdsSchema,
  pairThresholdsSchema,
} from '../index';

describe('pairThresholdsSchema', () => {
  it('acepta unsure <= agree <= solo', () => {
    expect(pairThresholdsSchema.safeParse({ agree: 0.6, solo: 0.85, unsure: 0.5 }).success).toBe(
      true,
    );
    expect(pairThresholdsSchema.safeParse({ agree: 0.5, solo: 0.5, unsure: 0.5 }).success).toBe(
      true,
    );
  });

  it('rechaza la invariante violada, valores fuera de 0–1 y claves extra', () => {
    expect(pairThresholdsSchema.safeParse({ agree: 0.4, solo: 0.85, unsure: 0.5 }).success).toBe(
      false,
    );
    expect(pairThresholdsSchema.safeParse({ agree: 0.9, solo: 0.85, unsure: 0.5 }).success).toBe(
      false,
    );
    expect(pairThresholdsSchema.safeParse({ agree: 0.6, solo: 1.2, unsure: 0.5 }).success).toBe(
      false,
    );
    expect(
      pairThresholdsSchema.safeParse({ agree: 0.6, solo: 0.85, unsure: 0.5, auto: 1 }).success,
    ).toBe(false);
  });

  it('entra en decisionThresholdsSchema bajo el id de la pregunta sin chocar con los otros', () => {
    const parsed = decisionThresholdsSchema.safeParse({
      respuesta: { agree: 0.5, solo: 0.8, unsure: 0.5 },
      clave: { auto: 0.9, review: 0.6 },
      unica: { yes: 0.8, no: 0.2 },
    });
    expect(parsed.success).toBe(true);
    expect(
      decisionThresholdsSchema.safeParse({ respuesta: { agree: 0.9, solo: 0.8, unsure: 0.5 } })
        .success,
    ).toBe(false);
  });
});

describe('confidenceThresholdsSchema', () => {
  it('acepta review menor o igual que auto', () => {
    expect(confidenceThresholdsSchema.safeParse({ auto: 0.9, review: 0.6 }).success).toBe(true);
    expect(confidenceThresholdsSchema.safeParse({ auto: 0.8, review: 0.8 }).success).toBe(true);
  });

  it('acepta los extremos 0 y 1', () => {
    expect(confidenceThresholdsSchema.safeParse({ auto: 1, review: 0 }).success).toBe(true);
  });

  it('rechaza review mayor que auto, con mensaje en review', () => {
    const parsed = confidenceThresholdsSchema.safeParse({ auto: 0.5, review: 0.7 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['review']);
      expect(parsed.error.issues[0]?.message).toMatch(/revisión/);
    }
  });

  it('rechaza valores fuera de 0–1', () => {
    expect(confidenceThresholdsSchema.safeParse({ auto: 1.1, review: 0.5 }).success).toBe(false);
    expect(confidenceThresholdsSchema.safeParse({ auto: 0.9, review: -0.1 }).success).toBe(false);
  });

  it('rechaza claves extra', () => {
    expect(confidenceThresholdsSchema.safeParse({ auto: 0.9, review: 0.5, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('noulThresholdsSchema', () => {
  it('acepta no estrictamente menor que yes', () => {
    expect(noulThresholdsSchema.safeParse({ yes: 0.8, no: 0.2 }).success).toBe(true);
  });

  it('rechaza no igual a yes', () => {
    const parsed = noulThresholdsSchema.safeParse({ yes: 0.5, no: 0.5 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['no']);
  });

  it('rechaza no mayor que yes', () => {
    expect(noulThresholdsSchema.safeParse({ yes: 0.3, no: 0.7 }).success).toBe(false);
  });

  it('rechaza claves extra', () => {
    expect(noulThresholdsSchema.safeParse({ yes: 0.8, no: 0.2, auto: 0.9 }).success).toBe(false);
  });
});

describe('decisionThresholdsSchema', () => {
  it('acepta un mapa vacío', () => {
    expect(decisionThresholdsSchema.safeParse({}).success).toBe(true);
  });

  it('acepta umbrales de ambos tipos por id de pregunta', () => {
    const parsed = decisionThresholdsSchema.safeParse({
      clave: { auto: 0.9, review: 0.6 },
      factual: { yes: 0.85, no: 0.15 },
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza una mezcla de claves de ambos tipos', () => {
    expect(
      decisionThresholdsSchema.safeParse({ clave: { auto: 0.9, review: 0.6, yes: 0.8 } }).success,
    ).toBe(false);
  });

  it('rechaza un umbral inválido dentro del mapa', () => {
    expect(decisionThresholdsSchema.safeParse({ clave: { auto: 0.4, review: 0.6 } }).success).toBe(
      false,
    );
  });
});

describe('decisionAnswerRecordSchema', () => {
  it('acepta una respuesta noul', () => {
    expect(decisionAnswerRecordSchema.safeParse({ type: 'noul', probability: 0.92 }).success).toBe(
      true,
    );
  });

  it('acepta una respuesta choice', () => {
    const parsed = decisionAnswerRecordSchema.safeParse({
      type: 'choice',
      choice: 'B',
      probabilities: { A: 0.1, B: 0.85, C: 0.05 },
      confidence: 0.85,
    });
    expect(parsed.success).toBe(true);
  });

  it('acepta una respuesta score', () => {
    const parsed = decisionAnswerRecordSchema.safeParse({
      type: 'score',
      score: 2.4,
      level: 2,
      probabilities: [0.05, 0.15, 0.6, 0.2],
      confidence: 0.6,
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza un type desconocido', () => {
    expect(decisionAnswerRecordSchema.safeParse({ type: 'text', value: 'x' }).success).toBe(false);
  });

  it('rechaza campos de otra variante (noul con choice)', () => {
    expect(
      decisionAnswerRecordSchema.safeParse({ type: 'noul', probability: 0.5, choice: 'A' }).success,
    ).toBe(false);
  });

  it('rechaza un score con level no entero', () => {
    expect(
      decisionAnswerRecordSchema.safeParse({
        type: 'score',
        score: 1.5,
        level: 1.5,
        probabilities: [0.5, 0.5],
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });

  it('rechaza un choice sin confidence', () => {
    expect(
      decisionAnswerRecordSchema.safeParse({ type: 'choice', choice: 'A', probabilities: { A: 1 } })
        .success,
    ).toBe(false);
  });
});

describe('enums y defaults', () => {
  it('valida funcionalidades y modos', () => {
    expect(decisionFeatureSchema.safeParse('remedial_judge').success).toBe(true);
    expect(decisionFeatureSchema.safeParse('mark_disambiguation_jev').success).toBe(true);
    expect(decisionFeatureSchema.safeParse('mark_disambiguation_openai').success).toBe(true);
    expect(decisionFeatureSchema.safeParse('otra').success).toBe(false);
    expect(decisionModeSchema.options).toEqual(['off', 'shadow', 'live']);
  });

  it('cada funcionalidad tiene modelo fijado y umbrales válidos', () => {
    for (const feature of DECISION_FEATURES) {
      const def = DECISION_FEATURE_DEFAULTS[feature];
      expect(def.model).not.toBe('jev-latest');
      expect(decisionThresholdsSchema.safeParse(def.thresholds).success).toBe(true);
    }
  });

  it('solo la desambiguación de marcas y el desempate de lectura llegan prendidos; el resto queda en off', () => {
    const live = DECISION_FEATURES.filter(
      (feature) => DECISION_FEATURE_DEFAULTS[feature].mode !== 'off',
    );

    expect(live).toEqual([
      MARK_DISAMBIGUATION_FEATURES.jev,
      MARK_DISAMBIGUATION_FEATURES.openai,
      'answer_reading_tiebreak',
    ]);
    expect(DECISION_FEATURE_DEFAULTS.remedial_judge.mode).toBe('off');
  });

  it('las features de marcas llegan en live con los umbrales provisorios del diseño', () => {
    expect(DECISION_FEATURE_DEFAULTS.mark_disambiguation_jev).toMatchObject({
      mode: 'live',
      thresholds: { [MARK_DISAMBIGUATION_QUESTION_ID]: { agree: 0.6, solo: 0.85, unsure: 0.5 } },
    });
    expect(DECISION_FEATURE_DEFAULTS.mark_disambiguation_openai).toMatchObject({
      mode: 'live',
      thresholds: { [MARK_DISAMBIGUATION_QUESTION_ID]: { agree: 0.5, solo: 0.8, unsure: 0.5 } },
    });
    for (const feature of Object.values(MARK_DISAMBIGUATION_FEATURES)) {
      const thresholds = DECISION_FEATURE_DEFAULTS[feature].thresholds;
      expect(Object.keys(thresholds)).toEqual([MARK_DISAMBIGUATION_QUESTION_ID]);
      expect(
        pairThresholdsSchema.safeParse(thresholds[MARK_DISAMBIGUATION_QUESTION_ID]).success,
      ).toBe(true);
    }
  });

  it('cada feature de marcas fija su motor', () => {
    expect(DECISION_FEATURE_DEFAULTS.mark_disambiguation_jev).toMatchObject({
      engine: 'jev',
      model: 'jev-1.14.0',
    });
    expect(DECISION_FEATURE_DEFAULTS.mark_disambiguation_openai).toMatchObject({
      engine: 'openai',
      model: 'gpt-6-luna',
    });
  });
});
