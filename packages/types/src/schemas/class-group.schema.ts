import { z } from 'zod';
import { teacherAssignmentRoleEnum } from './teacher-assignment.schema';

export const enrollmentStatusEnum = z.enum([
  'active',
  'transferred',
  'graduated',
  'withdrawn',
]);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusEnum>;

export const classGroupStudentSchema = z.object({
  studentId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  rut: z.string(),
  enrollmentStatus: enrollmentStatusEnum,
});
export type ClassGroupStudent = z.infer<typeof classGroupStudentSchema>;

export const classGroupSubjectTeacherSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  role: teacherAssignmentRoleEnum,
});
export type ClassGroupSubjectTeacher = z.infer<typeof classGroupSubjectTeacherSchema>;

export const classGroupSubjectSchema = z.object({
  subjectClassId: z.string().uuid(),
  subjectId: z.string().uuid(),
  subjectName: z.string(),
  subjectShortName: z.string(),
  teachers: z.array(classGroupSubjectTeacherSchema),
});
export type ClassGroupSubject = z.infer<typeof classGroupSubjectSchema>;

export const classGroupDetailResponseSchema = z.object({
  classGroup: z.object({
    id: z.string().uuid(),
    name: z.string(),
    gradeShortName: z.string(),
    gradeName: z.string(),
    academicYear: z.number().int(),
  }),
  students: z.array(classGroupStudentSchema),
  subjects: z.array(classGroupSubjectSchema),
});
export type ClassGroupDetailResponse = z.infer<typeof classGroupDetailResponseSchema>;
