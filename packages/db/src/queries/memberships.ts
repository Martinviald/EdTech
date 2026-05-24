import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { orgMemberships, users } from '../schema/users';
import { organizations } from '../schema/organizations';

export type MembershipWithUser = {
  user: typeof users.$inferSelect;
  membership: typeof orgMemberships.$inferSelect;
  organization: typeof organizations.$inferSelect;
  isPending: false;
};

export type PendingMembership = {
  user: null;
  membership: typeof orgMemberships.$inferSelect;
  organization: typeof organizations.$inferSelect;
  isPending: true;
};

export type MembershipLookup = MembershipWithUser | PendingMembership;

/**
 * Lookup de whitelist para el flujo de SSO/Mock.
 *
 * Retorna:
 *  - Membership real (con `user`) si el email matchea un users.email activo (case-insensitive).
 *  - Membership pendiente (sin `user`) si hay un org_memberships con user_id NULL + email
 *    matcheando (case-insensitive). Este caso se genera por la HU de whitelist (Equipo).
 *  - null si ningún caso aplica.
 *
 * Soft-deleted users y memberships inactivos se excluyen.
 *
 * Cuando un usuario pertenece a varias organizaciones tomamos el primer registro:
 * el selector multi-org es una HU separada.
 */
export async function findMembershipByEmail(
  db: Database,
  email: string,
): Promise<MembershipLookup | null> {
  // 1) Match con user real
  const realRows = await db
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

  if (realRows[0]) {
    return { ...realRows[0], isPending: false };
  }

  // 2) Match con invitación pendiente (user_id NULL + email guardado)
  const pendingRows = await db
    .select({
      membership: orgMemberships,
      organization: organizations,
    })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(
      and(
        isNull(orgMemberships.userId),
        sql`lower(${orgMemberships.email}) = lower(${email})`,
        eq(orgMemberships.isActive, true),
      ),
    )
    .limit(1);

  if (pendingRows[0]) {
    return { ...pendingRows[0], user: null, isPending: true };
  }

  return null;
}

/**
 * Lista todos los memberships activos para popular la UI del mock auth.
 * Solo debe llamarse cuando AUTH_MODE=mock; no exponer en producción.
 *
 * Solo retorna memberships con user real (no pendings — el mock no puede simular
 * primer login desde un pending sin agregar UX adicional).
 */
export async function listActiveMembershipsForMock(db: Database): Promise<
  Array<{
    user: typeof users.$inferSelect;
    membership: typeof orgMemberships.$inferSelect;
    organization: typeof organizations.$inferSelect;
  }>
> {
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
