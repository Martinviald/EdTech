import type { DashboardsService } from '../../dashboards/dashboards.service';
import type { HeatmapService } from '../../heatmap/heatmap.service';
import type { ItemAnalysisService } from '../../item-analysis/item-analysis.service';
import { GetAssessmentOverviewTool } from './get-assessment-overview.tool';
import { GetSkillHeatmapTool } from './get-skill-heatmap.tool';
import { ListAssessmentsTool } from './list-assessments.tool';
import { makePrincipal } from '../testing/make-principal';

describe('ListAssessmentsTool', () => {
  it('delega en ItemAnalysisService.listAssessments con el principal y filtros', async () => {
    const listAssessments = jest.fn().mockResolvedValue({ data: [], total: 0 });
    const tool = new ListAssessmentsTool({ listAssessments } as unknown as ItemAnalysisService);
    const principal = makePrincipal();
    const input = { subjectId: ['s1'] } as never;

    await tool.execute(principal, input);

    expect(listAssessments).toHaveBeenCalledWith(principal, input);
  });
});

describe('GetAssessmentOverviewTool', () => {
  it('delega en DashboardsService.getOverview', async () => {
    const getOverview = jest.fn().mockResolvedValue({ globalAchievement: 72 });
    const tool = new GetAssessmentOverviewTool({ getOverview } as unknown as DashboardsService);
    const principal = makePrincipal();
    const input = { assessmentId: 'a1' } as never;

    const result = await tool.execute(principal, input);

    expect(getOverview).toHaveBeenCalledWith(principal, input);
    expect(result).toEqual({ globalAchievement: 72 });
  });
});

describe('GetSkillHeatmapTool', () => {
  it('delega en HeatmapService.getHeatmap', async () => {
    const getHeatmap = jest.fn().mockResolvedValue({ rows: [] });
    const tool = new GetSkillHeatmapTool({ getHeatmap } as unknown as HeatmapService);
    const principal = makePrincipal();
    const input = { gradeId: ['g1'] } as never;

    await tool.execute(principal, input);

    expect(getHeatmap).toHaveBeenCalledWith(principal, input);
    expect(tool.descriptor.piiLevel).toBe('aggregate');
  });
});
