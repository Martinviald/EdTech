import { HttpException, Injectable } from '@nestjs/common';
import type { AnyZodObject } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { AnalyticsPrincipal } from '../../mcp/core/analytics-principal';
import { AnalyticsToolsFacade } from '../../mcp/core/analytics-tools.facade';
import type { ToolDescriptor } from '../../mcp/core/analytics-tool';
import { McpPrincipalResolver } from '../../mcp/auth/mcp-principal.resolver';
import type { AssistantTool } from './assistant-tool.types';

const convertZodSchema = zodToJsonSchema as unknown as (
  schema: AnyZodObject,
  options: { $refStrategy: 'none' },
) => Record<string, unknown>;

@Injectable()
export class AnalyticsAssistantBridge {
  constructor(
    private readonly facade: AnalyticsToolsFacade,
    private readonly resolver: McpPrincipalResolver,
  ) {}

  async assistantTools(
    user: JwtPayload,
    existingNames: ReadonlySet<string>,
  ): Promise<AssistantTool[]> {
    const principal = await this.resolver.principalFromJwt(user, 'in-app');
    return this.facade
      .listVisible(principal)
      .filter((descriptor) => !existingNames.has(descriptor.name))
      .map((descriptor) => this.toAssistantTool(descriptor, principal));
  }

  private toAssistantTool(
    descriptor: ToolDescriptor,
    principal: AnalyticsPrincipal,
  ): AssistantTool {
    const facade = this.facade;
    return {
      definition: {
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: convertZodSchema(descriptor.inputSchema, { $refStrategy: 'none' }),
      },
      async execute(input) {
        try {
          const result = await facade.execute(descriptor.name, principal, input);
          return { content: JSON.stringify(result) };
        } catch (error) {
          if (error instanceof HttpException) {
            return { content: JSON.stringify(error.getResponse()), isError: true };
          }
          throw error;
        }
      },
    };
  }
}
