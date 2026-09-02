import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { USER_ROLES, mcpListMyOrgsOutputSchema, type McpListMyOrgsOutput } from '@soe/types';
import { McpPrincipalResolver } from '../auth/mcp-principal.resolver';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

const listMyOrgsInputSchema = z.object({});

@AnalyticsTool()
@Injectable()
export class ListMyOrgsTool
  implements AnalyticsTool<Record<string, never>, McpListMyOrgsOutput>
{
  readonly descriptor: ToolDescriptor = {
    name: 'list_my_orgs',
    description:
      'Lista las organizaciones (colegios) a las que el usuario tiene acceso, con sus roles en cada ' +
      'una y cuál está activa. Usa set_active_org para cambiar sobre cuál operan las demás tools.',
    inputSchema: listMyOrgsInputSchema,
    outputSchema: mcpListMyOrgsOutputSchema,
    requiredRoles: USER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly resolver: McpPrincipalResolver) {}

  async execute(principal: AnalyticsPrincipal): Promise<McpListMyOrgsOutput> {
    const orgs = await this.resolver.listMyOrgs(principal.email, principal.orgId);
    return { orgs };
  }
}
