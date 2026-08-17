import type { ItemAnalysisService } from '../../item-analysis/item-analysis.service';
import { GetItemStatisticsTool } from './get-item-statistics.tool';
import { makePrincipal } from '../testing/make-principal';

const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const ASSESSMENT_ID = '33333333-3333-4333-8333-333333333333';

describe('GetItemStatisticsTool', () => {
  it('separa el itemId y delega el resto de filtros en getQuestionAnalysis', async () => {
    const getQuestionAnalysis = jest.fn().mockResolvedValue({ correctRate: 0.94, alternatives: [] });
    const service = { getQuestionAnalysis } as unknown as ItemAnalysisService;
    const tool = new GetItemStatisticsTool(service);
    const principal = makePrincipal();

    const result = await tool.execute(principal, {
      itemId: ITEM_ID,
      assessmentId: ASSESSMENT_ID,
    });

    expect(getQuestionAnalysis).toHaveBeenCalledWith(principal, ITEM_ID, {
      assessmentId: ASSESSMENT_ID,
    });
    expect(result).toEqual({ correctRate: 0.94, alternatives: [] });
  });
});
