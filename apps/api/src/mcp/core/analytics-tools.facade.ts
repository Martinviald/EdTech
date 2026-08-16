import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AnalyticsPrincipal } from './analytics-principal';
import type { ToolDescriptor } from './analytics-tool';
import { ToolRegistry, isToolAllowed } from './tool-registry';

@Injectable()
export class AnalyticsToolsFacade {
  constructor(private readonly registry: ToolRegistry) {}

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

    return tool.execute(principal, parsed.data);
  }
}
