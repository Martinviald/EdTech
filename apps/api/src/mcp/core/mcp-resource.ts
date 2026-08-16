import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@soe/types';
import type { AnalyticsPrincipal } from './analytics-principal';

export interface ResourceDescriptor {
  scheme: string;
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
  requiredRoles: readonly UserRole[];
}

export interface McpResource {
  readonly descriptor: ResourceDescriptor;
  read(principal: AnalyticsPrincipal, id: string): Promise<unknown>;
}

export const MCP_RESOURCE_METADATA = 'soe:mcp-resource';

export const McpResourceProvider = () => SetMetadata(MCP_RESOURCE_METADATA, true);
