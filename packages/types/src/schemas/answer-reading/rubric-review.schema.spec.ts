import { acceptRubricProposalsSchema, rubricApprovalSchema, rubricQueueQuerySchema } from './index';

const DECISION_ID = '11111111-1111-4111-8111-111111111111';
const ASSESSMENT_ID = '22222222-2222-4222-8222-222222222222';

describe('contrato de aprobación con rúbrica', () => {
  it('la aprobación exige decisión y nivel, y rechaza campos de más', () => {
    expect(rubricApprovalSchema.parse({ decisionId: DECISION_ID, levelCode: ' 2 ' })).toEqual({
      decisionId: DECISION_ID,
      levelCode: '2',
    });
    expect(
      rubricApprovalSchema.safeParse({ decisionId: DECISION_ID, levelCode: '2', orgId: 'x' })
        .success,
    ).toBe(false);
    expect(rubricApprovalSchema.safeParse({ decisionId: DECISION_ID, levelCode: '' }).success).toBe(
      false,
    );
  });

  it('aceptar propuestas pide al menos una decisión y no admite un nivel común', () => {
    expect(acceptRubricProposalsSchema.safeParse({ acceptAiProposals: [] }).success).toBe(false);
    expect(
      acceptRubricProposalsSchema.safeParse({ acceptAiProposals: [DECISION_ID], levelCode: '2' })
        .success,
    ).toBe(false);
    expect(acceptRubricProposalsSchema.parse({ acceptAiProposals: [DECISION_ID] })).toEqual({
      acceptAiProposals: [DECISION_ID],
    });
  });

  it('la cola pide una evaluación o un lote y convierte la paginación', () => {
    expect(rubricQueueQuerySchema.parse({ assessmentId: ASSESSMENT_ID, page: '2' })).toEqual({
      assessmentId: ASSESSMENT_ID,
      page: 2,
      pageSize: 20,
    });
    expect(rubricQueueQuerySchema.safeParse({}).success).toBe(false);
    expect(
      rubricQueueQuerySchema.safeParse({ assessmentId: ASSESSMENT_ID, limit: '5' }).success,
    ).toBe(false);
  });
});
