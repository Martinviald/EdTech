import { Injectable } from '@nestjs/common';
import { DASHBOARD_VIEWER_ROLES } from '@soe/types';
import { PerformanceBandsService } from '../../performance-bands/performance-bands.service';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import {
  McpResourceProvider,
  type McpResource,
  type ResourceDescriptor,
} from '../core/mcp-resource';

@McpResourceProvider()
@Injectable()
export class PerformanceBandsResource implements McpResource {
  readonly descriptor: ResourceDescriptor = {
    scheme: 'performance-bands',
    uriTemplate: 'performance-bands://{instrumentId}',
    name: 'Bandas de desempeño',
    description:
      'Definición de bandas de desempeño y sus umbrales para un instrumento. Da el significado de ' +
      'cada nivel (p. ej. qué % implica "adecuado") para interpretar logros y brechas.',
    mimeType: 'application/json',
    requiredRoles: DASHBOARD_VIEWER_ROLES,
  };

  constructor(private readonly performanceBands: PerformanceBandsService) {}

  read(_principal: AnalyticsPrincipal, instrumentId: string): Promise<unknown> {
    return this.performanceBands.listByInstrument(instrumentId);
  }
}
