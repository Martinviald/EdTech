import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  getActiveMembershipsForEmailAndOrg,
  listActiveOrgsWithMembershipsByEmail,
  mcpUserActiveOrg,
  organizations,
} from '@soe/db';
import {
  FEATURE_KEYS,
  pickDefaultActiveRole,
  resolveAllowedFeatures,
  type FeatureKey,
  type McpOrgSummary,
  type McpSetActiveOrgOutput,
  type UserRole,
} from '@soe/types';
import { AuthService } from '../../auth/auth.service';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import { InjectDb, type Database } from '../../database/database.types';
import type { AnalyticsChannel, AnalyticsPrincipal } from '../core/analytics-principal';

interface ResolvedOrgContext {
  orgId: string | null;
  orgName: string | null;
  roles: UserRole[];
  activeRole: UserRole;
}

type ValidatedUser = Awaited<ReturnType<AuthService['validateUser']>>;

@Injectable()
export class McpPrincipalResolver {
  constructor(
    private readonly authService: AuthService,
    @InjectDb() private readonly db: Database,
  ) {}

  async resolve(email: string): Promise<AnalyticsPrincipal> {
    const result = await this.validateOrForbid(email);
    if (result.isPending || !result.user) {
      throw new ForbiddenException(
        'Usuario pendiente de activación: inicia sesión en la aplicación web antes de conectar el MCP',
      );
    }

    const defaultOrgId = result.organization?.id ?? null;
    const context = await this.resolveOrgContext(result, defaultOrgId);

    return {
      userId: result.user.id,
      orgId: context.orgId,
      orgName: context.orgName,
      orgs: result.orgs,
      email: result.user.email,
      name: result.user.name,
      isPlatformAdmin: result.isPlatformAdmin,
      roles: context.roles,
      activeRole: context.activeRole,
      role: context.activeRole,
      features: await this.resolveFeatures(context.orgId, result.isPlatformAdmin),
      channel: 'mcp-external',
    };
  }

  async listMyOrgs(email: string, activeOrgId: string | null): Promise<McpOrgSummary[]> {
    const lookup = await listActiveOrgsWithMembershipsByEmail(this.db, email);
    if (!lookup || lookup.isPending) {
      return [];
    }
    return lookup.orgs.map((org) => ({
      orgId: org.organization.id,
      name: org.organization.name,
      roles: org.memberships.map((m) => m.role),
      isActive: org.organization.id === activeOrgId,
    }));
  }

  async setActiveOrg(
    userId: string,
    email: string,
    orgId: string,
  ): Promise<McpSetActiveOrgOutput> {
    const membership = await getActiveMembershipsForEmailAndOrg(this.db, email, orgId);
    if (!membership || membership.memberships.length === 0) {
      throw new ForbiddenException('Sin acceso activo a esta organización');
    }

    await this.db
      .insert(mcpUserActiveOrg)
      .values({ userId, orgId })
      .onConflictDoUpdate({
        target: mcpUserActiveOrg.userId,
        set: { orgId, updatedAt: new Date() },
      });

    const roles = membership.memberships.map((m) => m.role);
    return {
      orgId,
      orgName: membership.organization.name,
      roles,
      activeRole: pickDefaultActiveRole(roles),
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

  private async validateOrForbid(email: string): Promise<ValidatedUser> {
    try {
      return await this.authService.validateUser(email);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ForbiddenException('Usuario sin acceso a AcademOS');
      }
      throw error;
    }
  }

  private async resolveOrgContext(
    result: ValidatedUser,
    defaultOrgId: string | null,
  ): Promise<ResolvedOrgContext> {
    const fallback: ResolvedOrgContext = {
      orgId: defaultOrgId,
      orgName: result.orgName ?? null,
      roles: result.roles,
      activeRole: result.activeRole,
    };

    const userId = result.user?.id;
    if (!userId) {
      return fallback;
    }

    const persistedOrgId = await this.readActiveOrgId(userId);
    if (!persistedOrgId || persistedOrgId === defaultOrgId) {
      return fallback;
    }

    const membership = await getActiveMembershipsForEmailAndOrg(
      this.db,
      result.user!.email,
      persistedOrgId,
    );
    if (!membership || membership.memberships.length === 0) {
      await this.clearActiveOrg(userId);
      return fallback;
    }

    const roles = membership.memberships.map((m) => m.role);
    return {
      orgId: persistedOrgId,
      orgName: membership.organization.name,
      roles,
      activeRole: pickDefaultActiveRole(roles),
    };
  }

  private async readActiveOrgId(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ orgId: mcpUserActiveOrg.orgId })
      .from(mcpUserActiveOrg)
      .where(eq(mcpUserActiveOrg.userId, userId))
      .limit(1);
    return row?.orgId ?? null;
  }

  private async clearActiveOrg(userId: string): Promise<void> {
    await this.db.delete(mcpUserActiveOrg).where(eq(mcpUserActiveOrg.userId, userId));
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
