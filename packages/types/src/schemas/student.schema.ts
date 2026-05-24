import { z } from 'zod';

export const studentImportErrorSchema = z.object({
  rowNumber: z.number().int().positive(),
  field: z.string().optional(),
  message: z.string(),
});
export type StudentImportError = z.infer<typeof studentImportErrorSchema>;

export const studentImportClassGroupRefSchema = z.object({
  label: z.string(),
  gradeId: z.string().uuid(),
  gradeName: z.string(),
  section: z.string(),
});
export type StudentImportClassGroupRef = z.infer<typeof studentImportClassGroupRefSchema>;

export const studentImportUnknownGradeSchema = z.object({
  label: z.string(),
  rowNumbers: z.array(z.number().int().positive()),
});
export type StudentImportUnknownGrade = z.infer<typeof studentImportUnknownGradeSchema>;

export const studentImportPreviewResponseSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  errors: z.array(studentImportErrorSchema),
  existingClassGroups: z.array(studentImportClassGroupRefSchema),
  newClassGroups: z.array(studentImportClassGroupRefSchema),
  unknownGrades: z.array(studentImportUnknownGradeSchema),
});
export type StudentImportPreviewResponse = z.infer<typeof studentImportPreviewResponseSchema>;

export const studentImportCommitResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['completed', 'partial', 'failed']),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  classGroupsCreated: z.number().int().nonnegative(),
  errors: z.array(studentImportErrorSchema),
});
export type StudentImportCommitResponse = z.infer<typeof studentImportCommitResponseSchema>;

export const studentImportCommitBodySchema = z.object({
  confirmCreateMissingCourses: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => v === true || v === 'true'),
});
export type StudentImportCommitBody = z.infer<typeof studentImportCommitBodySchema>;
