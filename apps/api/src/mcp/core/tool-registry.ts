import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { userHasAnyRole } from '@soe/types';
import {
  ANALYTICS_TOOL_METADATA,
  type AnalyticsTool,
  type ToolDescriptor,
} from './analytics-tool';
import type { AnalyticsPrincipal } from './analytics-principal';

export function isToolAllowed(
  descriptor: ToolDescriptor,
  principal: AnalyticsPrincipal,
): boolean {
  if (principal.isPlatformAdmin) return true;
  if (!userHasAnyRole(principal.roles, descriptor.requiredRoles)) return false;
  if (!descriptor.requiredFeature) return true;
  return principal.features.includes(descriptor.requiredFeature);
}

@Injectable()
export class ToolRegistry implements OnApplicationBootstrap {
  private readonly toolsByName = new Map<string, AnalyticsTool>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      if (!this.reflector.get<boolean>(ANALYTICS_TOOL_METADATA, metatype)) continue;

      const tool = instance as AnalyticsTool;
      const name = tool.descriptor?.name;
      if (!name) {
        throw new Error(`Tool analítica sin descriptor: ${metatype.name}`);
      }
      if (this.toolsByName.has(name)) {
        throw new Error(`Tool analítica duplicada: ${name}`);
      }
      this.toolsByName.set(name, tool);
    }
  }

  list(): ToolDescriptor[] {
    return Array.from(this.toolsByName.values(), (tool) => tool.descriptor);
  }

  listVisible(principal: AnalyticsPrincipal): ToolDescriptor[] {
    return this.list().filter((descriptor) => isToolAllowed(descriptor, principal));
  }

  get(name: string): AnalyticsTool | undefined {
    return this.toolsByName.get(name);
  }
}
