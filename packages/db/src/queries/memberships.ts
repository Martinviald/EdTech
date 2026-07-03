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

export type MembershipsWithUser = {
  user: typeof users.$inferSelect;
  organization: typeof organizations.$inferSelect;
  memberships: Array<typeof orgMemberships.$inferSelect>;
  isPending: false;
};

export type PendingMemberships = {
  user: null;
  organization: typeof organizations.$inferSelect;
  memberships: [typeof orgMemberships.$inferSelect];
  isPending: true;
};

export type MembershipsLookup = MembershipsWithUser | PendingMemberships;

/**
 * Lookup multi-rol del usuario por email.
 *
 * Retorna TODOS los memberships activos del usuario (no `.limit(1)`).
 * Si por edge case hay memberships en más de una org, conservamos el criterio
 * actual: tomamos la primera org encontrada y filtramos solo sus roles. El
 * selector multi-org es una HU separada.
 *
 *  - Caso real: usuario con N memberships activos en una org → memberships[].
 *  - Caso pending: invitación con user_id NULL → memberships con un único item.
 *  - null si nada matchea.
 *
 * Soft-deleted users y memberships inactivos se excluyen.
 */
export async function listActiveMembershipsByEmail(
  db: Database,
  email: string,
): Promise<MembershipsLookup | null> {
  // 1) Match con user real — traemos todos sus memberships activos.
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
    );

  if (realRows.length > 0) {
    const first = realRows[0]!;
    // Si hubiera memberships en otras orgs por accidente, nos quedamos con
    // los de la primera org encontrada — mismo criterio que el flujo legacy.
    const targetOrgId = first.organization.id;
    const sameOrg = realRows.filter((r) => r.organization.id === targetOrgId);
    return {
      user: first.user,
      organization: first.organization,
      memberships: sameOrg.map((r) => r.membership),
      isPending: false,
    };
  }

  // 2) Match con invitación pendiente (user_id NULL + email guardado).
  // Por construcción del partial unique, no debería haber duplicados por
  // (org, email, role), pero podría haber distintos roles pending para el
  // mismo email: el primer login promueve uno a la vez. Tomamos el primero.
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
    return {
      user: null,
      organization: pendingRows[0].organization,
      memberships: [pendingRows[0].membership],
      isPending: true,
    };
  }

  return null;
}

/** Una org del usuario con todos sus memberships activos en ella. */
export type OrgWithMemberships = {
  organization: typeof organizations.$inferSelect;
  memberships: Array<typeof orgMemberships.$inferSelect>;
};

export type OrgsWithUser = {
  user: typeof users.$inferSelect;
  orgs: OrgWithMemberships[];
  isPending: false;
};

export type PendingOrgs = {
  user: null;
  orgs: [OrgWithMemberships];
  isPending: true;
};

export type OrgsLookup = OrgsWithUser | PendingOrgs;

/**
 * Lookup multi-org + multi-rol del usuario por email.
 *
 * A diferencia de `listActiveMembershipsByEmail` (que colapsa a la primera
 * org), agrupa TODOS los memberships activos por org, permitiendo el selector
 * multi-org. Las orgs se ordenan por nombre para un orden estable.
 *
 *  - Caso real: usuario con memberships en 1+ orgs → orgs[] con sus roles.
 *  - Caso pending: invitación con user_id NULL → una sola org pending.
 *  - null si nada matchea.
 *
 * Soft-deleted users y memberships inactivos se excluyen.
 */
export async function listActiveOrgsWithMembershipsByEmail(
  db: Database,
  email: string,
): Promise<OrgsLookup | null> {
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
    );

  if (realRows.length > 0) {
    const byOrg = new Map<string, OrgWithMemberships>();
    for (const row of realRows) {
      const existing = byOrg.get(row.organization.id);
      if (existing) {
        existing.memberships.push(row.membership);
      } else {
        byOrg.set(row.organization.id, {
          organization: row.organization,
          memberships: [row.membership],
        });
      }
    }
    const orgs = Array.from(byOrg.values()).sort((a, b) =>
      a.organization.name.localeCompare(b.organization.name),
    );
    return { user: realRows[0]!.user, orgs, isPending: false };
  }

  // Match con invitación pendiente (mismo criterio que listActiveMembershipsByEmail).
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
    return {
      user: null,
      orgs: [
        {
          organization: pendingRows[0].organization,
          memberships: [pendingRows[0].membership],
        },
      ],
      isPending: true,
    };
  }

  return null;
}

/**
 * Trae los memberships activos de un usuario real en UNA org específica.
 * Usado por el flujo switch-org: revalida contra la BD (isActive) que el
 * usuario sigue teniendo acceso a la org destino y devuelve sus roles frescos.
 * Retorna null si el usuario no tiene ningún membership activo en esa org.
 */
export async function getActiveMembershipsForEmailAndOrg(
  db: Database,
  email: string,
  orgId: string,
): Promise<OrgWithMemberships | null> {
  const rows = await db
    .select({
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
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.isActive, true),
      ),
    );

  if (rows.length === 0) return null;
  return {
    organization: rows[0]!.organization,
    memberships: rows.map((r) => r.membership),
  };
}

/**
 * @deprecated Usar `listActiveMembershipsByEmail` que retorna todos los
 * memberships activos. Esta función toma sólo el primero (no determinista)
 * y existe para callers legacy que aún no migraron al flujo multi-rol.
 */
export async function findMembershipByEmail(
  db: Database,
  email: string,
): Promise<MembershipLookup | null> {
  const lookup = await listActiveMembershipsByEmail(db, email);
  if (!lookup) return null;

  const first = lookup.memberships[0]!;
  if (lookup.isPending) {
    return {
      user: null,
      membership: first,
      organization: lookup.organization,
      isPending: true,
    };
  }
  return {
    user: lookup.user,
    membership: first,
    organization: lookup.organization,
    isPending: false,
  };
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
