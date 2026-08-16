import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@soe/db';
import { FEATURE_KEYS, resolveAllowedFeatures, type FeatureKey } from '@soe/types';
import { AuthService } from '../../auth/auth.service';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import { InjectDb, type Database } from '../../database/database.types';
import type { AnalyticsChannel, AnalyticsPrincipal } from '../core/analytics-principal';

@Injectable()
export class McpPrincipalResolver {
  constructor(
    private readonly authService: AuthService,
    @InjectDb() private readonly db: Database,
  ) {}

  async resolve(email: string): Promise<AnalyticsPrincipal> {
    let result: Awaited<ReturnType<AuthService['validateUser']>>;
    try {
      result = await this.authService.validateUser(email);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ForbiddenException('Usuario sin acceso a AcademOS');
      }
      throw error;
    }

    if (result.isPending || !result.user) {
      throw new ForbiddenException(
        'Usuario pendiente de activación: inicia sesión en la aplicación web antes de conectar el MCP',
      );
    }

    const orgId = result.organization?.id ?? null;

    return {
      userId: result.user.id,
      orgId,
      orgName: result.orgName ?? null,
      orgs: result.orgs,
      email: result.user.email,
      name: result.user.name,
      isPlatformAdmin: result.isPlatformAdmin,
      roles: result.roles,
      activeRole: result.activeRole,
      role: result.activeRole,
      features: await this.resolveFeatures(orgId, result.isPlatformAdmin),
      channel: 'mcp-external',
    };
  }

  async principalFromJwt(
    user: JwtPayload,
    channel: AnalyticsChannel,
  ): Promise<AnalyticsPrincipal> {
    return {
      ...user,
      features: await this.resolveFeatures(user.orgId, user.isPlatformAdmin),
      channel,
    };
  }

  private async resolveFeatures(
    orgId: string | null,
    isPlatformAdmin: boolean,
  ): Promise<FeatureKey[]> {
    if (!orgId) {
      return isPlatformAdmin ? [...FEATURE_KEYS] : [];
    }
    const [org] = await this.db
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return resolveAllowedFeatures(org?.config ?? null);
  }
}
