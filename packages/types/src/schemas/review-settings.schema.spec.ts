import {
  AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE,
  REVIEW_SETTINGS_ROLES,
  SHEET_MANAGEMENT_ROLES,
  updateOrgReviewSettingsSchema,
} from '../index';

describe('updateOrgReviewSettingsSchema', () => {
  it('acepta un cuerpo vacío (PATCH parcial sin cambios)', () => {
    expect(updateOrgReviewSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('acepta encender quickConfirm y fijar el umbral recomendado', () => {
    const parsed = updateOrgReviewSettingsSchema.safeParse({
      quickConfirm: true,
      autoAnnulMinConfidence: AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ quickConfirm: true, autoAnnulMinConfidence: 0.9 });
    }
  });

  it('acepta autoAnnulMinConfidence null para apagar la nula automática', () => {
    const parsed = updateOrgReviewSettingsSchema.safeParse({ autoAnnulMinConfidence: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.autoAnnulMinConfidence).toBeNull();
  });

  it('acepta los extremos 0 y 1 del umbral', () => {
    expect(updateOrgReviewSettingsSchema.safeParse({ autoAnnulMinConfidence: 0 }).success).toBe(
      true,
    );
    expect(updateOrgReviewSettingsSchema.safeParse({ autoAnnulMinConfidence: 1 }).success).toBe(
      true,
    );
  });

  it('rechaza un umbral fuera de 0–1', () => {
    expect(updateOrgReviewSettingsSchema.safeParse({ autoAnnulMinConfidence: 1.2 }).success).toBe(
      false,
    );
    expect(
      updateOrgReviewSettingsSchema.safeParse({ autoAnnulMinConfidence: -0.1 }).success,
    ).toBe(false);
  });

  it('rechaza quickConfirm que no sea booleano', () => {
    expect(updateOrgReviewSettingsSchema.safeParse({ quickConfirm: 'sí' }).success).toBe(false);
  });
});

describe('REVIEW_SETTINGS_ROLES', () => {
  it('es el mismo público que la gestión de hojas', () => {
    expect(REVIEW_SETTINGS_ROLES).toEqual(SHEET_MANAGEMENT_ROLES);
  });
});
