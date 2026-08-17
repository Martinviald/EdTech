import { Injectable, NotFoundException } from '@nestjs/common';
import { assessments, withOrgContext } from '@soe/db';
import { DASHBOARD_VIEWER_ROLES, capabilitiesFor } from '@soe/types';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../../database/database.types';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import {
  McpResourceProvider,
  type McpResource,
  type ResourceDescriptor,
} from '../core/mcp-resource';

@McpResourceProvider()
@Injectable()
export class AnalyticsCapabilitiesResource implements McpResource {
  readonly descriptor: ResourceDescriptor = {
    scheme: 'analytics-capabilities',
    uriTemplate: 'analytics-capabilities://{assessmentId}',
    name: 'Capacidades analíticas',
    description:
      'Qué análisis es posible para una evaluación según su granularidad de datos ' +
      '(item_level vs aggregate_only). Consúltalo antes de pedir estadística por ítem o detalle ' +
      'por alumno, para no pedir un análisis que la evaluación no soporta.',
    mimeType: 'application/json',
    requiredRoles: DASHBOARD_VIEWER_ROLES,
  };

  constructor(@InjectDb() private readonly db: Database) {}

  async read(principal: AnalyticsPrincipal, assessmentId: string): Promise<unknown> {
    if (!principal.orgId) {
      throw new NotFoundException('Evaluación no encontrada');
    }
    const granularity = await withOrgContext(this.db, principal.orgId, async (tx) => {
      const [row] = await tx
        .select({ dataGranularity: assessments.dataGranularity })
        .from(assessments)
        .where(eq(assessments.id, assessmentId))
        .limit(1);
      return row?.dataGranularity;
    });

    if (!granularity) {
      throw new NotFoundException('Evaluación no encontrada');
    }

    return {
      assessmentId,
      dataGranularity: granularity,
      capabilities: capabilitiesFor(granularity),
    };
  }
}
