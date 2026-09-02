import type { McpPrincipalResolver } from '../auth/mcp-principal.resolver';
import { SetActiveOrgTool } from './set-active-org.tool';
import { makePrincipal } from '../testing/make-principal';

describe('SetActiveOrgTool', () => {
  it('delega en el resolver con userId, email y orgId de entrada', async () => {
    const output = {
      orgId: 'org-2',
      orgName: 'Colegio Dos',
      roles: ['school_admin'],
      activeRole: 'school_admin',
    };
    const setActiveOrg = jest.fn().mockResolvedValue(output);
    const resolver = { setActiveOrg } as unknown as McpPrincipalResolver;
    const tool = new SetActiveOrgTool(resolver);
    const principal = makePrincipal({ userId: 'user-1', email: 'docente@colegio.cl' });

    const result = await tool.execute(principal, { orgId: 'org-2' });

    expect(setActiveOrg).toHaveBeenCalledWith('user-1', 'docente@colegio.cl', 'org-2');
    expect(result).toEqual(output);
  });

  it('exige un orgId uuid en la entrada', () => {
    const tool = new SetActiveOrgTool({} as unknown as McpPrincipalResolver);
    expect(tool.descriptor.inputSchema.safeParse({}).success).toBe(false);
    expect(tool.descriptor.inputSchema.safeParse({ orgId: 'no-uuid' }).success).toBe(false);
    expect(
      tool.descriptor.inputSchema.safeParse({
        orgId: '11111111-1111-1111-1111-111111111111',
      }).success,
    ).toBe(true);
  });
});
