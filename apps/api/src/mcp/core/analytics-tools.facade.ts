import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { TelemetryService } from '../../telemetry/telemetry.service';
import type { AnalyticsPrincipal } from './analytics-principal';
import type { ToolDescriptor } from './analytics-tool';
import { McpAuditLogger } from './mcp-audit-logger';
import { ToolRegistry, isToolAllowed } from './tool-registry';

@Injectable()
export class AnalyticsToolsFacade {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: McpAuditLogger,
    private readonly telemetry: TelemetryService,
  ) {}

  listVisible(principal: AnalyticsPrincipal): ToolDescriptor[] {
    return this.registry.listVisible(principal);
  }

  async execute(
    name: string,
    principal: AnalyticsPrincipal,
    input: unknown,
  ): Promise<unknown> {
    const tool = this.registry.get(name);
    if (!tool) {
      throw new NotFoundException(`Herramienta desconocida: ${name}`);
    }
    if (!isToolAllowed(tool.descriptor, principal)) {
      throw new ForbiddenException(`Rol insuficiente para la herramienta ${name}`);
    }

    const parsed = tool.descriptor.inputSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: `Argumentos inválidos para la herramienta ${name}`,
        issues: parsed.error.issues,
      });
    }

    let ok = false;
    const start = Date.now();
    try {
      const result = await tool.execute(principal, parsed.data);
      ok = true;
      return result;
    } finally {
      const durationMs = Date.now() - start;
      await this.audit.record({
        orgId: principal.orgId,
        userId: principal.userId,
        tool: name,
        argsHash: this.hashArgs(parsed.data),
        channel: principal.channel,
        ok,
      });
      this.telemetry.trackServer(
        { orgId: principal.orgId, userId: principal.userId, role: principal.activeRole },
        'mcp.tool_invoked',
        { tool: name, channel: principal.channel, ok, durationMs },
      );
    }
  }

  private hashArgs(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex');
  }
}
