import type { McpPrincipalResolver } from '../auth/mcp-principal.resolver';
import { ListMyOrgsTool } from './list-my-orgs.tool';
import { makePrincipal } from '../testing/make-principal';

describe('ListMyOrgsTool', () => {
  it('delega en el resolver pasando email y org activa del principal', async () => {
    const orgs = [
      { orgId: 'org-1', name: 'Colegio Test', roles: ['teacher'], isActive: true },
      { orgId: 'org-2', name: 'Colegio Dos', roles: ['school_admin'], isActive: false },
    ];
    const listMyOrgs = jest.fn().mockResolvedValue(orgs);
    const resolver = { listMyOrgs } as unknown as McpPrincipalResolver;
    const tool = new ListMyOrgsTool(resolver);
    const principal = makePrincipal({ orgId: 'org-1' });

    const result = await tool.execute(principal);

    expect(listMyOrgs).toHaveBeenCalledWith('docente@colegio.cl', 'org-1');
    expect(result).toEqual({ orgs });
  });

  it('declara output agregado y roles de cualquier usuario', () => {
    const tool = new ListMyOrgsTool({} as unknown as McpPrincipalResolver);
    expect(tool.descriptor.piiLevel).toBe('aggregate');
    expect(tool.descriptor.requiredRoles.length).toBeGreaterThan(0);
    expect(tool.descriptor.outputSchema).toBeDefined();
  });
});
