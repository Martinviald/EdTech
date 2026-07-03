import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  getActiveMembershipsForEmailAndOrg,
  isPlatformAdmin as isPlatformAdminQuery,
  listActiveMembershipsByEmail,
  listActiveMembershipsForMock,
  listActiveOrgsWithMembershipsByEmail,
  listPlatformAdmins,
  orgMemberships,
  users,
} from '@soe/db';
import {
  pickDefaultActiveOrg,
  pickDefaultActiveRole,
  userHasRole,
  type UserRole,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import type { JwtPayload } from './jwt-payload.types';

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
        const roles: UserRole[] = ['platform_admin'];
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
          roles,
          activeRole: pickDefaultActiveRole(roles),
          /** @deprecated mantener durante migración multi-rol. */
          membership: {
            id: '',
            userId: user.id,
            orgId: null,
            role: 'platform_admin' as const,
            isActive: true,
          },
          memberships: [
            {
              id: '',
              userId: user.id,
              orgId: null,
              role: 'platform_admin' as UserRole,
              isActive: true,
            },
          ],
          organization: null,
          orgs: [] as Array<{ id: string; name: string }>,
          orgName: null,
        };
      }
    }

    // 2) Buscar memberships reales (todas las orgs activas) o invitación pendiente.
    const lookup = await listActiveOrgsWithMembershipsByEmail(this.db, normalized);
    if (!lookup) {
      throw new NotFoundException('Usuario no encontrado o sin acceso activo');
    }

    if (lookup.isPending) {
      // El user aún no existe — primer login pendiente de promoción.
      const pendingOrg = lookup.orgs[0];
      const pending = pendingOrg.memberships[0]!;
      const roles: UserRole[] = [pending.role];
      return {
        user: null,
        isPlatformAdmin: false as const,
        isPending: true as const,
        roles,
        activeRole: pickDefaultActiveRole(roles),
        /** @deprecated mantener durante migración multi-rol. */
        membership: {
          id: pending.id,
          userId: null,
          orgId: pending.orgId,
          role: pending.role,
          isActive: pending.isActive,
        },
        memberships: [
          {
            id: pending.id,
            userId: null,
            orgId: pending.orgId,
            role: pending.role,
            isActive: pending.isActive,
          },
        ],
        organization: {
          id: pendingOrg.organization.id,
          name: pendingOrg.organization.name,
          type: pendingOrg.organization.type,
        },
        orgs: [{ id: pendingOrg.organization.id, name: pendingOrg.organization.name }],
        orgName: pendingOrg.organization.name,
      };
    }

    // Usuario real multi-org: elegir org activa por defecto (mayor jerarquía de
    // rol) y derivar roles/activeRole de ESA org. `orgs` lista todas para el selector.
    const activeOrg = pickDefaultActiveOrg(lookup.orgs);
    const roles: UserRole[] = activeOrg.memberships.map((m) => m.role);
    const first = activeOrg.memberships[0]!;
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
      roles,
      activeRole: pickDefaultActiveRole(roles),
      /** @deprecated mantener durante migración multi-rol — primer membership de la org activa. */
      membership: {
        id: first.id,
        userId: first.userId,
        orgId: first.orgId,
        role: first.role,
        isActive: first.isActive,
      },
      memberships: activeOrg.memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        orgId: m.orgId,
        role: m.role,
        isActive: m.isActive,
      })),
      organization: {
        id: activeOrg.organization.id,
        name: activeOrg.organization.name,
        type: activeOrg.organization.type,
      },
      orgs: lookup.orgs.map((o) => ({ id: o.organization.id, name: o.organization.name })),
      orgName: activeOrg.organization.name,
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
   *
   * Tras promover, re-consulta los memberships activos del usuario para que el
   * frontend pueble la sesión con `roles[]` y `activeRole` desde el primer login.
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
    let resolvedMembershipId = pending.id;
    if (pending.userId !== null) {
      resolvedMembershipId = pending.id;
    } else {
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
        resolvedMembershipId = collision.id;
      } else {
        // 4) Promover: setear user_id, limpiar email.
        await this.db
          .update(orgMemberships)
          .set({ userId, email: null })
          .where(and(eq(orgMemberships.id, pending.id), isNull(orgMemberships.userId)));
        resolvedMembershipId = pending.id;
      }
    }

    // 5) Releer todos los memberships activos del usuario para devolver
    // `roles[]` y `activeRole`. Esto cubre el caso (raro) en que el usuario
    // ya tuviera otro membership previo en la misma org.
    const lookup = await listActiveMembershipsByEmail(this.db, normalizedEmail);
    const roles: UserRole[] =
      lookup && !lookup.isPending ? lookup.memberships.map((m) => m.role) : [pending.role];
    const activeRole = pickDefaultActiveRole(roles);

    return {
      userId,
      membershipId: resolvedMembershipId,
      orgId: pending.orgId,
      role: pending.role,
      roles,
      activeRole,
    };
  }

  /**
   * Cambia el rol activo del usuario validando que esté entre sus memberships.
   * No re-emite el token directamente — el caller (frontend) usa NextAuth
   * `update()` para refrescar la sesión con el nuevo `activeRole`.
   */
  switchActiveRole(user: JwtPayload, role: UserRole): { activeRole: UserRole; roles: UserRole[] } {
    if (!userHasRole(user.roles, role)) {
      throw new ForbiddenException('Rol no asignado al usuario');
    }
    return { activeRole: role, roles: user.roles };
  }

  /**
   * Cambia la org activa del usuario. Revalida contra la BD que el usuario
   * tenga un membership activo en la org destino (no confía sólo en el token,
   * que podría estar cacheado tras una revocación) y recalcula roles +
   * activeRole para esa org — los roles son por-org, así que cambian al saltar.
   *
   * No re-emite el token: el frontend usa NextAuth `update()` con el resultado.
   */
  async switchActiveOrg(
    user: JwtPayload,
    orgId: string,
  ): Promise<{ orgId: string; orgName: string; roles: UserRole[]; activeRole: UserRole }> {
    if (!(user.orgs ?? []).some((o) => o.id === orgId)) {
      throw new ForbiddenException('Organización no asignada al usuario');
    }

    const result = await getActiveMembershipsForEmailAndOrg(this.db, user.email, orgId);
    if (!result || result.memberships.length === 0) {
      throw new ForbiddenException('Sin acceso activo a esta organización');
    }

    const roles: UserRole[] = result.memberships.map((m) => m.role);
    return {
      orgId,
      orgName: result.organization.name,
      roles,
      activeRole: pickDefaultActiveRole(roles),
    };
  }

  /**
   * Lista usuarios para popular el MockLoginForm. Agrupa por email para que
   * un usuario multi-rol aparezca una sola vez; tras el login el RoleSwitcher
   * permite cambiar entre roles.
   */
  async listMockUsers(authMode: string | undefined) {
    if (authMode !== 'mock') {
      throw new ForbiddenException('Solo disponible en AUTH_MODE=mock');
    }
    const memberships = await listActiveMembershipsForMock(this.db);
    const admins = await listPlatformAdmins(this.db);

    // Agrupar memberships por email; cada user aparece una sola vez con la
    // lista de sus roles. El "role" mostrado es el de mayor jerarquía.
    const byEmail = new Map<
      string,
      { email: string; name: string; roles: UserRole[]; orgName: string }
    >();
    for (const r of memberships) {
      const key = r.user.email.toLowerCase();
      const existing = byEmail.get(key);
      if (existing) {
        if (!existing.roles.includes(r.membership.role)) existing.roles.push(r.membership.role);
      } else {
        byEmail.set(key, {
          email: r.user.email,
          name: r.user.name,
          roles: [r.membership.role],
          orgName: r.organization.name,
        });
      }
    }

    const fromMemberships = Array.from(byEmail.values()).map((u) => ({
      email: u.email,
      name: u.name,
      role: pickDefaultActiveRole(u.roles),
      roles: u.roles,
      orgName: u.orgName,
      isPlatformAdmin: false,
    }));

    const adminEmails = new Set(fromMemberships.map((u) => u.email.toLowerCase()));
    const fromAdmins = admins
      .filter((a) => !adminEmails.has(a.user.email.toLowerCase()))
      .map((a) => ({
        email: a.user.email,
        name: a.user.name,
        role: 'platform_admin' as const,
        roles: ['platform_admin' as UserRole],
        orgName: null,
        isPlatformAdmin: true,
      }));

    return [...fromAdmins, ...fromMemberships];
  }
}
