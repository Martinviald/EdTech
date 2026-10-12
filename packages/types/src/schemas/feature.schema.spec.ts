import {
  AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE,
  autoAnnulMinConfidence,
  isQuickConfirmEnabled,
  orgConfigSchema,
  resolveAnswerReadingSettings,
} from './feature.schema';

// El default de `quickConfirm` se invirtió: nació apagado "para el primer ciclo",
// nadie lo encendió, y en el primer uso real el revisor tecleó a mano 5 marcas
// cuya alternativa el motor ya había sugerido. Ahora ausente = encendido y sólo
// un `false` explícito lo apaga. Estos casos fijan esa semántica.
describe('isQuickConfirmEnabled', () => {
  it('sin config queda ENCENDIDO', () => {
    expect(isQuickConfirmEnabled(null)).toBe(true);
    expect(isQuickConfirmEnabled(undefined)).toBe(true);
    expect(isQuickConfirmEnabled({})).toBe(true);
  });

  it('con bloque review pero sin la clave queda ENCENDIDO', () => {
    expect(isQuickConfirmEnabled({ review: {} })).toBe(true);
    expect(isQuickConfirmEnabled({ review: { autoAnnulMinConfidence: 0.9 } })).toBe(true);
  });

  it('sólo un false explícito lo apaga', () => {
    expect(isQuickConfirmEnabled({ review: { quickConfirm: false } })).toBe(false);
  });

  it('true explícito lo deja encendido', () => {
    expect(isQuickConfirmEnabled({ review: { quickConfirm: true } })).toBe(true);
  });

  // Un JSONB corrupto no debe degradar la revisión en silencio: el peor caso de
  // tenerlo encendido es una pregunta de más en pantalla.
  it('config que no parsea queda ENCENDIDO', () => {
    expect(isQuickConfirmEnabled({ review: { quickConfirm: 'sí' } })).toBe(true);
  });
});

// La nula automática NO cambia de default: sigue apagada salvo valor explícito.
// Van juntas en el mismo bloque `review` y es fácil confundirlas.
describe('autoAnnulMinConfidence', () => {
  it('ausente = apagada', () => {
    expect(autoAnnulMinConfidence({})).toBeNull();
    expect(autoAnnulMinConfidence({ review: {} })).toBeNull();
    expect(autoAnnulMinConfidence({ review: { quickConfirm: true } })).toBeNull();
  });

  it('devuelve el umbral guardado', () => {
    expect(
      autoAnnulMinConfidence({
        review: { autoAnnulMinConfidence: AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE },
      }),
    ).toBe(0.9);
  });
});

describe('resolveAnswerReadingSettings', () => {
  it('sin config rigen los defaults decididos (D3: se envían recortes; D7: dataset interno)', () => {
    for (const config of [undefined, null, {}]) {
      expect(resolveAnswerReadingSettings(config)).toEqual({
        enabled: true,
        allowExternalVision: true,
        rubricAssistEnabled: false,
        rubricEngine: 'legacy',
        datasetConsent: 'org_internal',
        reviewAll: false,
      });
    }
  });

  it('lo guardado por la org gana sobre el default', () => {
    const resolved = resolveAnswerReadingSettings({
      answerReading: { allowExternalVision: false, allowedProviders: ['anthropic'] },
    });
    expect(resolved.allowExternalVision).toBe(false);
    expect(resolved.allowedProviders).toEqual(['anthropic']);
    expect(resolved.enabled).toBe(true);
    expect(resolved.datasetConsent).toBe('org_internal');
  });

  it('el motor de calificación de desarrollo es legacy salvo que la org elija el nuevo', () => {
    expect(resolveAnswerReadingSettings({}).rubricEngine).toBe('legacy');
    expect(
      resolveAnswerReadingSettings({ answerReading: { rubricEngine: 'rubric_grading' } })
        .rubricEngine,
    ).toBe('rubric_grading');
    expect(
      resolveAnswerReadingSettings({ answerReading: { rubricEngine: 'otro' } }).rubricEngine,
    ).toBe('legacy');
  });

  it('un answerReading corrupto no envía imágenes a terceros', () => {
    const resolved = resolveAnswerReadingSettings({
      answerReading: { allowExternalVision: 'no', claveDesconocida: true },
    });
    expect(resolved.allowExternalVision).toBe(false);
  });

  it('una clave corrupta de otro dominio no afecta la lectura', () => {
    const resolved = resolveAnswerReadingSettings({
      review: { quickConfirm: 'sí' },
      answerReading: { reviewAll: true },
    });
    expect(resolved.reviewAll).toBe(true);
    expect(resolved.allowExternalVision).toBe(true);
  });

  it('orgConfigSchema deja answerReading sin validar y resolveAnswerReadingSettings lo valida', () => {
    const parsed = orgConfigSchema.parse({
      answerReading: { datasetConsent: 'none' },
      otraCosa: 1,
    });
    expect(parsed).toHaveProperty('otraCosa', 1);
    expect(resolveAnswerReadingSettings(parsed).datasetConsent).toBe('none');
    expect(
      orgConfigSchema.safeParse({ answerReading: { allowedProviders: ['otro'] } }).success,
    ).toBe(true);
    expect(
      resolveAnswerReadingSettings({ answerReading: { allowedProviders: ['otro'] } })
        .allowExternalVision,
    ).toBe(false);
  });
});

describe('answerReading corrupto no invalida el resto de la configuración', () => {
  it('conserva features, presupuesto y anulación automática', () => {
    const parsed = orgConfigSchema.safeParse({
      allowedFeatures: ['remedial'],
      aiBudgetUsd: 25,
      answerReading: { allowExternalVision: false, comentario: 'x' },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.aiBudgetUsd).toBe(25);
    expect(
      resolveAnswerReadingSettings({
        answerReading: { allowExternalVision: false, comentario: 'x' },
      }).allowExternalVision,
    ).toBe(false);
  });
});
