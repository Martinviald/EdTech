import { z } from 'zod';

export const teacherAssignmentRoleEnum = z.enum(['primary', 'assistant']);
export type TeacherAssignmentRole = z.infer<typeof teacherAssignmentRoleEnum>;

export const createTeacherAssignmentSchema = z.object({
  userId: z.string().uuid(),
  subjectClassId: z.string().uuid(),
  role: teacherAssignmentRoleEnum.default('primary'),
});
export type CreateTeacherAssignmentDto = z.infer<typeof createTeacherAssignmentSchema>;

export const listTeacherAssignmentsQuerySchema = z.object({
  classGroupId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});
export type ListTeacherAssignmentsQuery = z.infer<typeof listTeacherAssignmentsQuerySchema>;

export type TeacherAssignmentSummary = {
  id: string;
  role: TeacherAssignmentRole;
  createdAt: string;
  teacher: { id: string; name: string; email: string };
  subjectClass: {
    id: string;
    classGroup: { id: string; name: string; gradeShortName: string };
    subject: { id: string; name: string; shortName: string };
  };
};

export type PrimaryExistsErrorBody = {
  statusCode: 409;
  error: 'Conflict';
  code: 'PRIMARY_EXISTS';
  message: string;
  currentPrimary: { id: string; name: string };
};
