import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { orgMemberships, users } from '../schema/users';
import { organizations } from '../schema/organizations';

export type MembershipWithUser = {
  user: typeof users.$inferSelect;
  membership: typeof orgMemberships.$inferSelect;
  organization: typeof organizations.$inferSelect;
};

/**
 * Lookup de whitelist para el flujo de SSO/Mock.
 *
 * Retorna el primer membership activo del usuario cuyo email coincide (case-insensitive).
 * Soft-deleted users y memberships inactivos se excluyen.
 *
 * La HU explicita: "para este ticket inicial tomaremos el primer registro por defecto"
 * cuando un usuario pertenece a varias organizaciones. El selector multi-org es una HU
 * separada.
 */
export async function findMembershipByEmail(
  db: Database,
  email: string,
): Promise<MembershipWithUser | null> {
  const rows = await db
    .select({
      user: users,
      membership: orgMemberships,
      organization: organizations,
    })
    .from(users)
    .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(
      and(
        sql`lower(${users.email}) = lower(${email})`,
        isNull(users.deletedAt),
        eq(orgMemberships.isActive, true),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Lista todos los memberships activos para popular la UI del mock auth.
 * Solo debe llamarse cuando AUTH_MODE=mock; no exponer en producción.
 */
export async function listActiveMembershipsForMock(
  db: Database,
): Promise<MembershipWithUser[]> {
  return db
    .select({
      user: users,
      membership: orgMemberships,
      organization: organizations,
    })
    .from(users)
    .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(and(isNull(users.deletedAt), eq(orgMemberships.isActive, true)));
}
