import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  findAuthContextByEmail,
  listActiveMembershipsForMock,
  listPlatformAdmins,
  users,
} from '@soe/db';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class AuthService {
  constructor(@InjectDb() private readonly db: Database) {}

  async validateUser(email: string) {
    const ctx = await findAuthContextByEmail(this.db, email);
    if (!ctx) throw new NotFoundException('Usuario no encontrado o sin acceso activo');

    return {
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        avatarUrl: ctx.user.avatarUrl,
        providerId: ctx.user.providerId,
      },
      isPlatformAdmin: ctx.isPlatformAdmin,
      membership: ctx.membership
        ? {
            userId: ctx.membership.userId,
            orgId: ctx.membership.orgId,
            role: ctx.isPlatformAdmin ? 'platform_admin' : ctx.membership.role,
            isActive: ctx.membership.isActive,
          }
        : ctx.isPlatformAdmin
          ? {
              userId: ctx.user.id,
              orgId: null,
              role: 'platform_admin' as const,
              isActive: true,
            }
          : null,
      organization: ctx.organization
        ? { id: ctx.organization.id, name: ctx.organization.name, type: ctx.organization.type }
        : null,
    };
  }

  async syncUser(params: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    provider: 'google' | 'microsoft';
    providerId: string;
  }): Promise<void> {
    await this.db
      .update(users)
      .set({
        name: params.name,
        avatarUrl: params.avatarUrl,
        provider: params.provider,
        providerId: params.providerId,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.userId));
  }

  async listMockUsers(authMode: string | undefined) {
    if (authMode !== 'mock') {
      throw new ForbiddenException('Solo disponible en AUTH_MODE=mock');
    }
    const memberships = await listActiveMembershipsForMock(this.db);
    const admins = await listPlatformAdmins(this.db);

    const fromMemberships = memberships.map((r) => ({
      email: r.user.email,
      name: r.user.name,
      role: r.membership.role,
      orgName: r.organization.name,
      isPlatformAdmin: false,
    }));

    const adminEmails = new Set(fromMemberships.map((u) => u.email.toLowerCase()));
    const fromAdmins = admins
      .filter((a) => !adminEmails.has(a.user.email.toLowerCase()))
      .map((a) => ({
        email: a.user.email,
        name: a.user.name,
        role: 'platform_admin' as const,
        orgName: null,
        isPlatformAdmin: true,
      }));

    return [...fromAdmins, ...fromMemberships];
  }
}

