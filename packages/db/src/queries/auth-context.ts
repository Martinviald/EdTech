import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { users } from '../schema/users';
import { findMembershipByEmail, type MembershipWithUser } from './memberships';
import { isPlatformAdmin } from './platform-admins';

export type AuthContext = {
  user: typeof users.$inferSelect;
  isPlatformAdmin: boolean;
  membership: MembershipWithUser['membership'] | null;
  organization: MembershipWithUser['organization'] | null;
};

/**
 * Resuelve el contexto de autenticación de un email a partir de:
 *  1. tabla platform_admins (acceso global, sin requerir membership);
 *  2. fallback a findMembershipByEmail (membership de colegio).
 *
 * Retorna null si el email no existe, está soft-deleted, o no es admin ni
 * tiene memberships activos — coherente con el comportamiento previo.
 */
export async function findAuthContextByEmail(
  db: Database,
  email: string,
): Promise<AuthContext | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
    .limit(1);

  if (user) {
    const platformAdmin = await isPlatformAdmin(db, user.id);
    if (platformAdmin) {
      return {
        user,
        isPlatformAdmin: true,
        membership: null,
        organization: null,
      };
    }
  }

  const membership = await findMembershipByEmail(db, email);
  if (!membership) return null;

  return {
    user: membership.user,
    isPlatformAdmin: false,
    membership: membership.membership,
    organization: membership.organization,
  };
}

/**
 * Actualiza last_login_at del usuario tras un login exitoso.
 * Útil para auditar inactividad sin tocar el flow principal.
 */
export async function touchUserLastLogin(db: Database, userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, userId));
}
