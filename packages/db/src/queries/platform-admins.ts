import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { platformAdmins } from '../schema/platform-admins';
import { users } from '../schema/users';

export type PlatformAdminWithUser = {
  admin: typeof platformAdmins.$inferSelect;
  user: typeof users.$inferSelect;
};

export async function isPlatformAdmin(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), isNull(platformAdmins.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

export async function listPlatformAdmins(db: Database): Promise<PlatformAdminWithUser[]> {
  return db
    .select({ admin: platformAdmins, user: users })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(and(isNull(platformAdmins.revokedAt), isNull(users.deletedAt)))
    .orderBy(asc(platformAdmins.grantedAt));
}

export async function grantPlatformAdmin(
  db: Database,
  params: { userId: string; grantedByUserId: string | null; notes?: string | null },
): Promise<typeof platformAdmins.$inferSelect> {
  const [row] = await db
    .insert(platformAdmins)
    .values({
      userId: params.userId,
      grantedByUserId: params.grantedByUserId ?? null,
      notes: params.notes ?? null,
    })
    .onConflictDoUpdate({
      target: platformAdmins.userId,
      set: {
        revokedAt: null,
        grantedByUserId: params.grantedByUserId ?? null,
        grantedAt: sql`now()`,
        notes: params.notes ?? null,
      },
    })
    .returning();
  if (!row) throw new Error('Failed to grant platform admin');
  return row;
}

export async function revokePlatformAdmin(
  db: Database,
  userId: string,
): Promise<void> {
  await db
    .update(platformAdmins)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(platformAdmins.userId, userId), isNull(platformAdmins.revokedAt)));
}

export async function searchUsersByEmail(
  db: Database,
  query: string,
  limit = 20,
): Promise<Array<{ id: string; email: string; name: string }>> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)),
      ),
    )
    .orderBy(asc(users.email))
    .limit(limit);
}
