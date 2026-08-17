import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { USER_ROLES } from '@soe/types';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

const whoamiInputSchema = z.object({});

const whoamiOutputSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  orgId: z.string().nullable(),
  orgName: z.string().nullable(),
  roles: z.array(z.string()),
  isPlatformAdmin: z.boolean(),
  features: z.array(z.string()),
  channel: z.string(),
});

type WhoamiOutput = z.infer<typeof whoamiOutputSchema>;

@AnalyticsTool()
@Injectable()
export class WhoamiTool implements AnalyticsTool<Record<string, never>, WhoamiOutput> {
  readonly descriptor: ToolDescriptor = {
    name: 'whoami',
    description:
      'Identidad del usuario autenticado: organización activa, roles y features habilitadas. ' +
      'Úsala para verificar que la conexión al servidor analítico funciona.',
    inputSchema: whoamiInputSchema,
    outputSchema: whoamiOutputSchema,
    requiredRoles: USER_ROLES,
    piiLevel: 'aggregate',
  };

  async execute(principal: AnalyticsPrincipal): Promise<WhoamiOutput> {
    return {
      userId: principal.userId,
      email: principal.email,
      name: principal.name,
      orgId: principal.orgId,
      orgName: principal.orgName ?? null,
      roles: [...principal.roles],
      isPlatformAdmin: principal.isPlatformAdmin,
      features: [...principal.features],
      channel: principal.channel,
    };
  }
}
