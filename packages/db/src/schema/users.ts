import { boolean, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ssoProviderEnum, userRoleEnum } from './enums';
import { organizations } from './organizations';
import { subjectClasses } from './academic';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  provider: ssoProviderEnum('provider').notNull(),
  providerId: text('provider_id').notNull(),
  lastLoginAt: timestamp('last_login_at'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    scope: jsonb('scope').$type<{
      gradeIds?: string[];
      subjectIds?: string[];
      classGroupIds?: string[];
    }>(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.orgId, table.role)],
);

export const teacherAssignments = pgTable(
  'teacher_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectClassId: uuid('subject_class_id').notNull(),
    role: text('role').notNull().default('primary'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.subjectClassId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(orgMemberships),
  teacherAssignments: many(teacherAssignments),
}));

export const orgMembershipsRelations = relations(orgMemberships, ({ one }) => ({
  user: one(users, { fields: [orgMemberships.userId], references: [users.id] }),
  org: one(organizations, { fields: [orgMemberships.orgId], references: [organizations.id] }),
}));

export const teacherAssignmentsRelations = relations(teacherAssignments, ({ one }) => ({
  user: one(users, { fields: [teacherAssignments.userId], references: [users.id] }),
  subjectClass: one(subjectClasses, {
    fields: [teacherAssignments.subjectClassId],
    references: [subjectClasses.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OrgMembership = typeof orgMemberships.$inferSelect;
export type NewOrgMembership = typeof orgMemberships.$inferInsert;
export type TeacherAssignment = typeof teacherAssignments.$inferSelect;
export type NewTeacherAssignment = typeof teacherAssignments.$inferInsert;
