import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { findMembershipByEmail, listActiveMembershipsForMock, users } from '@soe/db';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class AuthService {
  constructor(@InjectDb() private readonly db: Database) {}

  async validateUser(email: string) {
    const result = await findMembershipByEmail(this.db, email);
    if (!result) throw new NotFoundException('Usuario no encontrado o sin membresía activa');
    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        avatarUrl: result.user.avatarUrl,
        providerId: result.user.providerId,
      },
      membership: {
        userId: result.membership.userId,
        orgId: result.membership.orgId,
        role: result.membership.role,
        isActive: result.membership.isActive,
      },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        type: result.organization.type,
      },
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
    const rows = await listActiveMembershipsForMock(this.db);
    return rows.map((r) => ({
      email: r.user.email,
      name: r.user.name,
      role: r.membership.role,
      orgName: r.organization.name,
    }));
  }
}
