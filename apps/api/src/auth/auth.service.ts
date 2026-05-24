import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  findMembershipByEmail,
  isPlatformAdmin as isPlatformAdminQuery,
  listActiveMembershipsForMock,
  listPlatformAdmins,
  orgMemberships,
  users,
} from '@soe/db';
import { InjectDb, type Database } from '../database/database.types';

interface PromoteInvitationDto {
  membershipId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: 'google' | 'microsoft';
  providerId: string;
}

@Injectable()
export class AuthService {
  constructor(@InjectDb() private readonly db: Database) {}

  async validateUser(email: string) {
    const normalized = email.trim().toLowerCase();

    // 1) ¿Es platform_admin? Resolver primero (acceso global, sin membership requerido).
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${normalized}`, isNull(users.deletedAt)))
      .limit(1);

    if (user) {
      const isAdmin = await isPlatformAdminQuery(this.db, user.id);
      if (isAdmin) {
        return {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            providerId: user.providerId,
          },
          isPlatformAdmin: true as const,
          isPending: false as const,
          membership: {
            id: '',
            userId: user.id,
            orgId: null,
            role: 'platform_admin' as const,
            isActive: true,
          },
          organization: null,
        };
      }
    }

    // 2) Buscar membership real o pendiente.
    const lookup = await findMembershipByEmail(this.db, normalized);
    if (!lookup) {
      throw new NotFoundException('Usuario no encontrado o sin acceso activo');
    }

    if (lookup.isPending) {
      // El user aún no existe — primer login pendiente de promoción.
      return {
        user: null,
        isPlatformAdmin: false as const,
        isPending: true as const,
        membership: {
          id: lookup.membership.id,
          userId: null,
          orgId: lookup.membership.orgId,
          role: lookup.membership.role,
          isActive: lookup.membership.isActive,
        },
        organization: {
          id: lookup.organization.id,
          name: lookup.organization.name,
          type: lookup.organization.type,
        },
      };
    }

    return {
      user: {
        id: lookup.user.id,
        email: lookup.user.email,
        name: lookup.user.name,
        avatarUrl: lookup.user.avatarUrl,
        providerId: lookup.user.providerId,
      },
      isPlatformAdmin: false as const,
      isPending: false as const,
      membership: {
        id: lookup.membership.id,
        userId: lookup.membership.userId,
        orgId: lookup.membership.orgId,
        role: lookup.membership.role,
        isActive: lookup.membership.isActive,
      },
      organization: {
        id: lookup.organization.id,
        name: lookup.organization.name,
        type: lookup.organization.type,
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

  /**
   * Promueve una invitación pendiente: crea (o restaura) el users row con datos
   * del SSO y rellena user_id en el membership. Idempotente: si otra request ya
   * promovió, retorna el estado actual sin error.
   */
  async promoteInvitation(dto: PromoteInvitationDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // 1) Buscar (o crear/restaurar) el users row.
    let userId: string;
    const [existing] = await this.db
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existing) {
      userId = existing.id;
      await this.db
        .update(users)
        .set({
          deletedAt: null,
          name: dto.name,
          avatarUrl: dto.avatarUrl,
          provider: dto.provider,
          providerId: dto.providerId,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      const [created] = await this.db
        .insert(users)
        .values({
          email: normalizedEmail,
          name: dto.name,
          avatarUrl: dto.avatarUrl,
          provider: dto.provider,
          providerId: dto.providerId,
          lastLoginAt: new Date(),
        })
        .returning({ id: users.id });
      if (!created) throw new ConflictException('No se pudo crear el usuario');
      userId = created.id;
    }

    // 2) Cargar el membership pending objetivo.
    const [pending] = await this.db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.id, dto.membershipId))
      .limit(1);

    if (!pending) throw new NotFoundException('Invitación no encontrada');

    // Si ya fue promovido por una request concurrente, devolver estado actual.
    if (pending.userId !== null) {
      return {
        userId: pending.userId,
        membershipId: pending.id,
        orgId: pending.orgId,
        role: pending.role,
      };
    }

    // 3) Verificar choque con UNIQUE(user_id, org_id, role).
    // Si el user ya tenía un membership activo con misma terna (caso raro: invitado por email
    // pero ya había sido agregado por user_id), borrar este pending y usar el existente.
    const [collision] = await this.db
      .select({ id: orgMemberships.id })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.userId, userId),
          eq(orgMemberships.orgId, pending.orgId),
          eq(orgMemberships.role, pending.role),
        ),
      )
      .limit(1);

    if (collision) {
      await this.db.delete(orgMemberships).where(eq(orgMemberships.id, pending.id));
      return {
        userId,
        membershipId: collision.id,
        orgId: pending.orgId,
        role: pending.role,
      };
    }

    // 4) Promover: setear user_id, limpiar email.
    await this.db
      .update(orgMemberships)
      .set({ userId, email: null })
      .where(and(eq(orgMemberships.id, pending.id), isNull(orgMemberships.userId)));

    return {
      userId,
      membershipId: pending.id,
      orgId: pending.orgId,
      role: pending.role,
    };
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
