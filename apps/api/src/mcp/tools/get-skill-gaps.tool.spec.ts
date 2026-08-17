import type { DashboardsService } from '../../dashboards/dashboards.service';
import { GetSkillGapsTool } from './get-skill-gaps.tool';
import { makePrincipal } from '../testing/make-principal';

describe('GetSkillGapsTool', () => {
  it('delega en DashboardsService.getSkills con los filtros recibidos', async () => {
    const getSkills = jest.fn().mockResolvedValue({ skills: [{ nodeId: 'n1', achievement: 42 }] });
    const service = { getSkills } as unknown as DashboardsService;
    const tool = new GetSkillGapsTool(service);
    const principal = makePrincipal();
    const filters = { subjectId: ['subj-1'] } as never;

    const result = await tool.execute(principal, filters);

    expect(getSkills).toHaveBeenCalledWith(principal, filters);
    expect(result).toEqual({ skills: [{ nodeId: 'n1', achievement: 42 }] });
  });

  it('usa el set de roles de visualización de dashboards', () => {
    const tool = new GetSkillGapsTool({} as unknown as DashboardsService);
    expect(tool.descriptor.requiredRoles.length).toBeGreaterThan(0);
    expect(tool.descriptor.piiLevel).toBe('aggregate');
  });
});
