import { Injectable } from '@nestjs/common';
import {
  USER_ROLES,
  mcpSetActiveOrgInputSchema,
  mcpSetActiveOrgOutputSchema,
  type McpSetActiveOrgInput,
  type McpSetActiveOrgOutput,
} from '@soe/types';
import { McpPrincipalResolver } from '../auth/mcp-principal.resolver';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

@AnalyticsTool()
@Injectable()
export class SetActiveOrgTool
  implements AnalyticsTool<McpSetActiveOrgInput, McpSetActiveOrgOutput>
{
  readonly descriptor: ToolDescriptor = {
    name: 'set_active_org',
    description:
      'Cambia la organización (colegio) activa del usuario. AFECTA A TODAS LAS LLAMADAS ' +
      'SIGUIENTES: las demás tools operan sobre la org activa con los roles del usuario en ella. ' +
      'Usa list_my_orgs para ver los orgId disponibles. Falla si el usuario no es miembro de la org.',
    inputSchema: mcpSetActiveOrgInputSchema,
    outputSchema: mcpSetActiveOrgOutputSchema,
    requiredRoles: USER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly resolver: McpPrincipalResolver) {}

  async execute(
    principal: AnalyticsPrincipal,
    input: McpSetActiveOrgInput,
  ): Promise<McpSetActiveOrgOutput> {
    return this.resolver.setActiveOrg(principal.userId, principal.email, input.orgId);
  }
}
