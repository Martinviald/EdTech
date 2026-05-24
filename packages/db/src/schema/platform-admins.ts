import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
  notes: text('notes'),
});

export const platformAdminsRelations = relations(platformAdmins, ({ one }) => ({
  user: one(users, { fields: [platformAdmins.userId], references: [users.id] }),
  grantedBy: one(users, {
    fields: [platformAdmins.grantedByUserId],
    references: [users.id],
    relationName: 'platform_admin_granted_by',
  }),
}));

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type NewPlatformAdmin = typeof platformAdmins.$inferInsert;
