import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { userHasAnyRole } from '@soe/types';
import type { AnalyticsPrincipal } from './analytics-principal';
import {
  MCP_RESOURCE_METADATA,
  type McpResource,
  type ResourceDescriptor,
} from './mcp-resource';

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

function isVisible(descriptor: ResourceDescriptor, principal: AnalyticsPrincipal): boolean {
  return principal.isPlatformAdmin || userHasAnyRole(principal.roles, descriptor.requiredRoles);
}

@Injectable()
export class ResourceRegistry implements OnApplicationBootstrap {
  private readonly resourcesByScheme = new Map<string, McpResource>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      if (!this.reflector.get<boolean>(MCP_RESOURCE_METADATA, metatype)) continue;

      const resource = instance as McpResource;
      const scheme = resource.descriptor?.scheme;
      if (!scheme) {
        throw new Error(`Resource MCP sin descriptor: ${metatype.name}`);
      }
      if (this.resourcesByScheme.has(scheme)) {
        throw new Error(`Resource MCP con esquema duplicado: ${scheme}`);
      }
      this.resourcesByScheme.set(scheme, resource);
    }
  }

  listVisible(principal: AnalyticsPrincipal): ResourceDescriptor[] {
    return Array.from(this.resourcesByScheme.values(), (resource) => resource.descriptor).filter(
      (descriptor) => isVisible(descriptor, principal),
    );
  }

  async read(principal: AnalyticsPrincipal, uri: string): Promise<ResourceContent> {
    const separator = uri.indexOf('://');
    if (separator === -1) {
      throw new NotFoundException(`URI de recurso inválida: ${uri}`);
    }
    const scheme = uri.slice(0, separator);
    const id = uri.slice(separator + 3);
    const resource = this.resourcesByScheme.get(scheme);
    if (!resource || !id) {
      throw new NotFoundException(`Recurso desconocido: ${uri}`);
    }
    if (!isVisible(resource.descriptor, principal)) {
      throw new ForbiddenException(`Sin acceso al recurso ${scheme}`);
    }
    const data = await resource.read(principal, id);
    return { uri, mimeType: resource.descriptor.mimeType, text: JSON.stringify(data) };
  }
}
