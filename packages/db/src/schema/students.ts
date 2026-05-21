import {
  boolean,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { enrollmentStatusEnum, genderEnum } from './enums';
import { organizations, academicYears } from './organizations';
import { classGroups } from './academic';
import { users } from './users';

export const students = pgTable('students', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  rut: text('rut').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  birthDate: date('birth_date'),
  gender: genderEnum('gender').default('unspecified'),
  profile: jsonb('profile').$type<{
    nee?: string[];
    careerInterest?: string;
    targetUniversity?: string;
    sensitiveNotes?: string;
  }>(),
  isAnonymized: boolean('is_anonymized').default(false).notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const studentEnrollments = pgTable(
  'student_enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    status: enrollmentStatusEnum('status').default('active').notNull(),
    enrolledAt: date('enrolled_at').defaultNow().notNull(),
    withdrawnAt: date('withdrawn_at'),
  },
  (table) => [unique().on(table.studentId, table.academicYearId)],
);

export const studentsRelations = relations(students, ({ one, many }) => ({
  org: one(organizations, { fields: [students.orgId], references: [organizations.id] }),
  user: one(users, { fields: [students.userId], references: [users.id] }),
  enrollments: many(studentEnrollments),
}));

export const studentEnrollmentsRelations = relations(studentEnrollments, ({ one }) => ({
  student: one(students, { fields: [studentEnrollments.studentId], references: [students.id] }),
  classGroup: one(classGroups, {
    fields: [studentEnrollments.classGroupId],
    references: [classGroups.id],
  }),
  academicYear: one(academicYears, {
    fields: [studentEnrollments.academicYearId],
    references: [academicYears.id],
  }),
}));

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type StudentEnrollment = typeof studentEnrollments.$inferSelect;
export type NewStudentEnrollment = typeof studentEnrollments.$inferInsert;
