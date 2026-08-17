import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { userHasAnyRole } from '@soe/types';
import type { AnalyticsPrincipal } from './analytics-principal';
import { MCP_PROMPT_METADATA, type McpPrompt, type PromptDescriptor } from './mcp-prompt';

@Injectable()
export class PromptRegistry implements OnApplicationBootstrap {
  private readonly promptsByName = new Map<string, McpPrompt>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      if (!this.reflector.get<boolean>(MCP_PROMPT_METADATA, metatype)) continue;

      const prompt = instance as McpPrompt;
      const name = prompt.descriptor?.name;
      if (!name) {
        throw new Error(`Prompt MCP sin descriptor: ${metatype.name}`);
      }
      if (this.promptsByName.has(name)) {
        throw new Error(`Prompt MCP duplicado: ${name}`);
      }
      this.promptsByName.set(name, prompt);
    }
  }

  listVisible(principal: AnalyticsPrincipal): PromptDescriptor[] {
    return Array.from(this.promptsByName.values(), (prompt) => prompt.descriptor).filter(
      (descriptor) =>
        principal.isPlatformAdmin || userHasAnyRole(principal.roles, descriptor.requiredRoles),
    );
  }

  get(name: string): McpPrompt | undefined {
    return this.promptsByName.get(name);
  }
}
