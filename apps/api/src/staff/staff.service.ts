import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { auditLogs, orgMemberships, users } from '@soe/db';
import type {
  BulkInviteMembersDto,
  BulkInviteResponse,
  InviteMemberDto,
  MemberModel,
  SkipReason,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

interface InviteSuccess {
  ok: true;
  member: MemberModel;
}

interface InviteFailure {
  ok: false;
  reason: SkipReason;
  message: string;
}

type InviteResult = InviteSuccess | InviteFailure;

@Injectable()
export class StaffService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Lista miembros del colegio: activos (con user) + pending (sin user, con email). */
  async list(orgId: string): Promise<MemberModel[]> {
    const rows = await this.db
      .select({
        id: orgMemberships.id,
        orgId: orgMemberships.orgId,
        userId: orgMemberships.userId,
        role: orgMemberships.role,
        isActive: orgMemberships.isActive,
        invitedAt: orgMemberships.invitedAt,
        createdAt: orgMemberships.createdAt,
        pendingEmail: orgMemberships.email,
        userEmail: users.email,
        userName: users.name,
        userDeletedAt: users.deletedAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(orgMemberships)
      .leftJoin(users, eq(users.id, orgMemberships.userId))
      .where(eq(orgMemberships.orgId, orgId))
      .orderBy(orgMemberships.role, orgMemberships.createdAt);

    return (
      rows
        // Excluir users soft-deleted (membership "huérfano" después de borrar user)
        .filter((r) => r.userId === null || r.userDeletedAt === null)
        .map((r) => ({
          id: r.id,
          orgId: r.orgId,
          userId: r.userId,
          email: r.userEmail ?? r.pendingEmail ?? '',
          name: r.userName,
          role: r.role,
          // "Pendiente" = todavía no inició sesión, NO "no tiene fila en users".
          // Desde que invitar con nombre crea el `users` row de una vez, la señal vieja
          // (`user_id`) marcaría como activo a alguien que nunca entró. `last_login_at`
          // se escribe en el login y en la promoción (auth.service), así que es la señal
          // correcta — y además arregla el caso viejo de los usuarios creados desde el
          // panel de admin, que figuraban como activos sin haber entrado nunca.
          status: r.lastLoginAt ? ('active' as const) : ('pending' as const),
          isActive: r.isActive,
          lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
          invitedAt: r.invitedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }))
    );
  }

  /**
   * Invita un miembro al colegio del usuario actuante.
   * - Si el email ya existe en `users` y no está en otra org → crea membership con user_id rellenado.
   * - Si el email no existe → crea membership pendiente (user_id NULL + email).
   * - Bloquea cross-org y duplicados en mi org.
   */
  async invite(user: JwtPayload, dto: InviteMemberDto): Promise<MemberModel> {
    const result = await this.inviteInternal(user, dto);
    if (!result.ok) {
      throw new ConflictException(result.message);
    }
    return result.member;
  }

  /** Misma lógica pero no lanza; útil para bulk para acumular errores. */
  private async inviteInternal(user: JwtPayload, dto: InviteMemberDto): Promise<InviteResult> {
    // El controller garantiza user.orgId != null antes de llamar al service.
    const orgId = user.orgId!;
    const email = dto.email; // ya viene normalizado por Zod
    const role = dto.role;
    const name = dto.name?.trim();

    // 1) Cross-org check: ¿este email ya pertenece a OTRA org?
    const crossOrg = await this.db
      .select({ id: orgMemberships.id })
      .from(orgMemberships)
      .leftJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          ne(orgMemberships.orgId, orgId),
          sql`(lower(${orgMemberships.email}) = ${email} OR lower(${users.email}) = ${email})`,
        ),
      )
      .limit(1);

    if (crossOrg.length > 0) {
      return {
        ok: false,
        reason: 'cross_org_conflict',
        message: 'Este correo ya pertenece a otra organización',
      };
    }

    // 2) ¿Existe un user real con ese email?
    const [existingUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
      .limit(1);

    // 3) Dedup en mi org según el caso
    if (existingUser) {
      // Caso: user existe, ¿ya tiene membership con mismo rol en mi org?
      const [dup] = await this.db
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            eq(orgMemberships.userId, existingUser.id),
            eq(orgMemberships.role, role),
          ),
        )
        .limit(1);

      if (dup) {
        return {
          ok: false,
          reason: 'duplicate_in_org',
          message: 'Este correo ya tiene ese rol en tu colegio',
        };
      }

      const [created] = await this.db
        .insert(orgMemberships)
        .values({
          userId: existingUser.id,
          orgId: orgId,
          role,
          invitedAt: new Date(),
          invitedByUserId: user.userId,
          isActive: true,
        })
        .returning({ id: orgMemberships.id });

      if (!created) {
        return { ok: false, reason: 'duplicate_in_org', message: 'No se pudo crear el miembro' };
      }

      await this.logAudit(user, 'invite_member', { email, role }, 1);
      return { ok: true, member: await this.readMember(created.id) };
    }

    // Caso: user no existe.
    //
    // CON NOMBRE → creamos la fila en `users` acá mismo, con `provider_id` placeholder
    // que el primer login real reemplaza. Es el mismo patrón que ya usa
    // `AdminService.createUser`. Sirve para algo concreto: `teacher_assignments.user_id`
    // es NOT NULL contra `users.id`, así que sin fila en `users` el invitado NO puede
    // recibir carga académica — era la razón por la que no aparecía en el selector de
    // /organizacion/asignaciones.
    //
    // SIN NOMBRE (import masivo por CSV, que sólo trae email,role) → membership
    // pendiente con `user_id NULL`, exactamente como antes.
    if (name) {
      // Reusar un pending previo del mismo email+rol en vez de chocar contra el partial
      // unique: invitar de nuevo agregando el nombre es la forma de COMPLETAR una
      // invitación vieja que quedó sin usuario, no un duplicado.
      const [pendingSameRole] = await this.db
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            eq(orgMemberships.role, role),
            isNull(orgMemberships.userId),
            sql`lower(${orgMemberships.email}) = ${email}`,
          ),
        )
        .limit(1);

      const [createdUser] = await this.db
        .insert(users)
        .values({
          email,
          name,
          provider: 'google',
          // Se completa en el primer login real (auth.service.promoteInvitation /
          // el upsert del login). Mismo placeholder que AdminService.createUser.
          providerId: `pending-${Date.now()}`,
        })
        .returning({ id: users.id });

      if (!createdUser) {
        return { ok: false, reason: 'duplicate_in_org', message: 'No se pudo crear el usuario' };
      }

      if (pendingSameRole) {
        await this.db
          .update(orgMemberships)
          .set({ userId: createdUser.id, email: null })
          .where(eq(orgMemberships.id, pendingSameRole.id));
        await this.logAudit(user, 'invite_member', { email, role, completed: true }, 1);
        return { ok: true, member: await this.readMember(pendingSameRole.id) };
      }

      const [created] = await this.db
        .insert(orgMemberships)
        .values({
          userId: createdUser.id,
          orgId,
          role,
          invitedAt: new Date(),
          invitedByUserId: user.userId,
          isActive: true,
        })
        .returning({ id: orgMemberships.id });

      if (!created) {
        return { ok: false, reason: 'duplicate_in_org', message: 'No se pudo crear el miembro' };
      }

      await this.logAudit(user, 'invite_member', { email, role }, 1);
      return { ok: true, member: await this.readMember(created.id) };
    }

    // Partial unique resuelve "pending duplicado mismo rol".
    // Omitimos userId para que quede NULL (Drizzle insert no acepta null literal en columnas typed).
    try {
      const [created] = await this.db
        .insert(orgMemberships)
        .values({
          orgId: orgId,
          role,
          email,
          invitedAt: new Date(),
          invitedByUserId: user.userId,
          isActive: true,
        })
        .returning({ id: orgMemberships.id });

      if (!created) {
        return { ok: false, reason: 'duplicate_in_org', message: 'No se pudo crear la invitación' };
      }

      await this.logAudit(user, 'invite_member', { email, role }, 1);
      return { ok: true, member: await this.readMember(created.id) };
    } catch (err) {
      // Unique violation del partial index → pending duplicado para mismo (org, email, role)
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        return {
          ok: false,
          reason: 'duplicate_in_org',
          message: 'Este correo ya tiene una invitación pendiente con ese rol',
        };
      }
      throw err;
    }
  }

  /**
   * Invita varios miembros en serie. Acumula resultados.
   * Optimización a N+1 → 1 query: ver "Riesgos" en el plan (deuda).
   */
  async bulkInvite(user: JwtPayload, dto: BulkInviteMembersDto): Promise<BulkInviteResponse> {
    let created = 0;
    const skipped: BulkInviteResponse['skipped'] = [];

    for (const member of dto.members) {
      const result = await this.inviteInternal(user, member);
      if (result.ok) created += 1;
      else {
        skipped.push({
          email: member.email,
          role: member.role,
          reason: result.reason,
          message: result.message,
        });
      }
    }

    await this.logAudit(user, 'bulk_invite_members', { total: dto.members.length }, created);

    return { created, skipped };
  }

  /** Revoca un membership con hard delete. Protege al último school_admin. */
  async revoke(user: JwtPayload, membershipId: string): Promise<void> {
    const orgId = user.orgId!;
    const [membership] = await this.db
      .select({
        id: orgMemberships.id,
        orgId: orgMemberships.orgId,
        userId: orgMemberships.userId,
        role: orgMemberships.role,
        email: orgMemberships.email,
      })
      .from(orgMemberships)
      .where(eq(orgMemberships.id, membershipId))
      .limit(1);

    // No exponer existencia de memberships de otras orgs.
    if (!membership || membership.orgId !== orgId) {
      throw new NotFoundException('Miembro no encontrado');
    }

    // Last-admin protection: no permitir eliminar el último school_admin activo.
    if (membership.role === 'school_admin' && membership.userId !== null) {
      const [{ activeAdmins }] = await this.db
        .select({ activeAdmins: sql<number>`count(*)::int` })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            eq(orgMemberships.role, 'school_admin'),
            sql`${orgMemberships.userId} IS NOT NULL`,
          ),
        );
      if (activeAdmins <= 1) {
        throw new ForbiddenException('No puedes eliminar al último administrador del colegio');
      }
    }

    await this.db.delete(orgMemberships).where(eq(orgMemberships.id, membershipId));

    await this.logAudit(
      user,
      'revoke_membership',
      { membershipId, role: membership.role, email: membership.email ?? undefined },
      1,
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Re-lee un membership por id y lo proyecta como MemberModel. */
  private async readMember(membershipId: string): Promise<MemberModel> {
    const list = await this.list(
      // Necesitamos el orgId; lo sacamos del membership recién creado.
      (
        await this.db
          .select({ orgId: orgMemberships.orgId })
          .from(orgMemberships)
          .where(eq(orgMemberships.id, membershipId))
          .limit(1)
      )[0].orgId,
    );
    const found = list.find((m) => m.id === membershipId);
    if (!found) throw new NotFoundException('Miembro no encontrado tras crear');
    return found;
  }

  private async logAudit(
    user: JwtPayload,
    action: string,
    filter: Record<string, unknown>,
    recordCount: number,
  ): Promise<void> {
    await this.db.insert(auditLogs).values({
      userId: user.userId,
      orgId: user.orgId ?? undefined,
      action: `staff.${action}`,
      resourceType: 'org_memberships',
      resourceFilter: filter,
      recordCount,
    });
  }
}
