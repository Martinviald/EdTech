import { ManualIdentityResolver } from './manual-identity.resolver';

describe('ManualIdentityResolver', () => {
  it('expone mode none', () => {
    expect(new ManualIdentityResolver().mode).toBe('none');
  });

  it('siempre devuelve un candidato vacío que exige asignación manual', async () => {
    const candidate = await new ManualIdentityResolver().resolve();

    expect(candidate).toEqual({
      printedSheetId: null,
      studentId: null,
      confidence: 0,
      evidence: { motivo: 'asignacion_manual' },
      needsHumanConfirmation: true,
      batchRejection: null,
    });
  });
});
