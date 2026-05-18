import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations, academicYears } from './organizations';

export const grades = pgTable('grades', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  code: text('code').notNull().unique(),
  cycle: integer('cycle').notNull(),
  order: integer('order').notNull(),
});

export const subjects = pgTable('subjects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  code: text('code').notNull().unique(),
  minedlucCode: text('mineduc_code'),
});

export const classGroups = pgTable('class_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  academicYearId: uuid('academic_year_id')
    .notNull()
    .references(() => academicYears.id),
  gradeId: uuid('grade_id')
    .notNull()
    .references(() => grades.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const subjectClasses = pgTable(
  'subject_classes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.classGroupId, table.subjectId, table.academicYearId)],
);

export const gradesRelations = relations(grades, ({ many }) => ({
  classGroups: many(classGroups),
}));

export const subjectsRelations = relations(subjects, ({ many }) => ({
  subjectClasses: many(subjectClasses),
}));

export const classGroupsRelations = relations(classGroups, ({ one, many }) => ({
  org: one(organizations, { fields: [classGroups.orgId], references: [organizations.id] }),
  academicYear: one(academicYears, {
    fields: [classGroups.academicYearId],
    references: [academicYears.id],
  }),
  grade: one(grades, { fields: [classGroups.gradeId], references: [grades.id] }),
  subjectClasses: many(subjectClasses),
}));

export const subjectClassesRelations = relations(subjectClasses, ({ one }) => ({
  classGroup: one(classGroups, {
    fields: [subjectClasses.classGroupId],
    references: [classGroups.id],
  }),
  subject: one(subjects, { fields: [subjectClasses.subjectId], references: [subjects.id] }),
  academicYear: one(academicYears, {
    fields: [subjectClasses.academicYearId],
    references: [academicYears.id],
  }),
}));

export type Grade = typeof grades.$inferSelect;
export type NewGrade = typeof grades.$inferInsert;
export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;
export type ClassGroup = typeof classGroups.$inferSelect;
export type NewClassGroup = typeof classGroups.$inferInsert;
export type SubjectClass = typeof subjectClasses.$inferSelect;
export type NewSubjectClass = typeof subjectClasses.$inferInsert;
