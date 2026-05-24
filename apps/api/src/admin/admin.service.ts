import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  auditLogs,
  grantPlatformAdmin as grantPlatformAdminQuery,
  isPlatformAdmin as isPlatformAdminQuery,
  listPlatformAdmins,
  orgMemberships,
  organizations,
  revokePlatformAdmin as revokePlatformAdminQuery,
  searchUsersByEmail,
  users,
} from '@soe/db';
import type {
  AdminCreateOrganizationDto,
  AdminCreateUserDto,
  GrantMembershipDto,
  GrantPlatformAdminDto,
  ListOrganizationsQueryDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class AdminService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ── Organizations ─────────────────────────────────────────────

  async listOrganizations(query: ListOrganizationsQueryDto) {
    const where = and(
      isNull(organizations.deletedAt),
      eq(organizations.type, 'school'),
      query.q ? ilike(organizations.name, `%${query.q}%`) : undefined,
    );

    const [rows, totalRow] = await Promise.all([
      this.db
        .select({
          id: organizations.id,
          name: organizations.name,
          rbd: organizations.rbd,
          commune: organizations.commune,
          region: organizations.region,
          dependence: organizations.dependence,
          createdAt: organizations.createdAt,
        })
        .from(organizations)
        .where(where)
        .orderBy(desc(organizations.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(organizations)
        .where(where),
    ]);

    return {
      items: rows,
      total: totalRow[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async createOrganization(dto: AdminCreateOrganizationDto, actingUserId: string) {
    const [existing] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.rbd, dto.rbd), isNull(organizations.deletedAt)))
      .limit(1);
    if (existing) throw new ConflictException(`Ya existe un colegio con RBD ${dto.rbd}`);

    const [org] = await this.db
      .insert(organizations)
      .values({
        type: 'school',
        name: dto.name,
        rbd: dto.rbd,
        commune: dto.commune ?? null,
        region: dto.region ?? null,
        dependence: dto.dependence ?? null,
      })
      .returning();
    if (!org) throw new Error('Failed to create organization');

    await this.db.insert(auditLogs).values({
      userId: actingUserId,
      orgId: org.id,
      action: 'admin.org.create',
      resourceType: 'organizations',
      resourceFilter: { rbd: dto.rbd, name: dto.name },
      recordCount: 1,
    });

    return org;
  }

  async getOrganizationDetail(orgId: string) {
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .limit(1);
    if (!org) throw new NotFoundException('Colegio no encontrado');

    const [{ membershipCount } = { membershipCount: 0 }] = await this.db
      .select({ membershipCount: count() })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.isActive, true)));

    return { ...org, membershipCount };
  }

  // ── Memberships ───────────────────────────────────────────────

  async listMemberships(orgId: string) {
    return this.db
      .select({
        membership: orgMemberships,
        user: { id: users.id, email: users.email, name: users.name },
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.isActive, true),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(orgMemberships.role, users.email);
  }

  async grantMembership(orgId: string, dto: GrantMembershipDto, actingUserId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, dto.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const [org] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .limit(1);
    if (!org) throw new NotFoundException('Colegio no encontrado');

    await this.db
      .insert(orgMemberships)
      .values({ userId: dto.userId, orgId, role: dto.role, isActive: true })
      .onConflictDoUpdate({
        target: [orgMemberships.userId, orgMemberships.orgId, orgMemberships.role],
        set: { isActive: true },
      });

    await this.db.insert(auditLogs).values({
      userId: actingUserId,
      orgId,
      action: 'admin.membership.grant',
      resourceType: 'org_memberships',
      resourceFilter: { userId: dto.userId, role: dto.role },
      recordCount: 1,
    });

    return { ok: true };
  }

  async revokeMembership(orgId: string, userId: string, role: string, actingUserId: string) {
    const result = await this.db
      .update(orgMemberships)
      .set({ isActive: false })
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.userId, userId),
          eq(orgMemberships.role, role as never),
        ),
      )
      .returning({ id: orgMemberships.id });
    if (result.length === 0) throw new NotFoundException('Membership no encontrado');

    await this.db.insert(auditLogs).values({
      userId: actingUserId,
      orgId,
      action: 'admin.membership.revoke',
      resourceType: 'org_memberships',
      resourceFilter: { userId, role },
      recordCount: 1,
    });

    return { ok: true };
  }

  // ── Users ─────────────────────────────────────────────────────

  async searchUsers(q: string) {
    return searchUsersByEmail(this.db, q, 20);
  }

  async createUser(dto: AdminCreateUserDto, actingUserId: string) {
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${dto.email})`)
      .limit(1);
    if (existing) throw new ConflictException('Ya existe un usuario con ese email');

    const [user] = await this.db
      .insert(users)
      .values({
        email: dto.email,
        name: dto.name,
        provider: dto.provider,
        providerId: `pending-${Date.now()}`, // se completa en el primer login real
      })
      .returning();
    if (!user) throw new Error('Failed to create user');

    await this.db.insert(auditLogs).values({
      userId: actingUserId,
      orgId: null,
      action: 'admin.user.create',
      resourceType: 'users',
      resourceFilter: { email: dto.email },
      recordCount: 1,
    });

    return user;
  }

  // ── Platform admins ───────────────────────────────────────────

  async listPlatformAdmins() {
    const rows = await listPlatformAdmins(this.db);
    return rows.map((r) => ({
      id: r.admin.id,
      userId: r.admin.userId,
      grantedAt: r.admin.grantedAt,
      notes: r.admin.notes,
      user: { id: r.user.id, email: r.user.email, name: r.user.name },
    }));
  }

  async grantPlatformAdmin(dto: GrantPlatformAdminDto, actingUserId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, dto.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (await isPlatformAdminQuery(this.db, dto.userId)) {
      throw new ConflictException('El usuario ya es platform admin');
    }

    const admin = await grantPlatformAdminQuery(this.db, {
      userId: dto.userId,
      grantedByUserId: actingUserId,
      notes: dto.notes ?? null,
    });

    await this.db.insert(auditLogs).values({
      userId: actingUserId,
      orgId: null,
      action: 'admin.platform_admin.grant',
      resourceType: 'platform_admins',
      resourceFilter: { userId: dto.userId },
      recordCount: 1,
    });

    return admin;
  }

  async revokePlatformAdmin(userId: string, actingUserId: string) {
    if (userId === actingUserId) {
      throw new BadRequestException('No puedes revocarte a ti mismo');
    }
    await revokePlatformAdminQuery(this.db, userId);

    await this.db.insert(auditLogs).values({
      userId: actingUserId,
      orgId: null,
      action: 'admin.platform_admin.revoke',
      resourceType: 'platform_admins',
      resourceFilter: { userId },
      recordCount: 1,
    });

    return { ok: true };
  }
}

// Imports usados solo para narrowing TypeScript.
void or;
