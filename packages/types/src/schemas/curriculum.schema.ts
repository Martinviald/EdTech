import { z } from 'zod';

export const MINEDUC_SUBJECT_CODES = ['LANG', 'MATH'] as const;
export const MINEDUC_GRADE_CODES = [
  '1B',
  '2B',
  '3B',
  '4B',
  '5B',
  '6B',
  '7B',
  '8B',
  '1M',
  '2M',
  '3M',
  '4M',
] as const;

export const mineducObjectiveSchema = z.object({
  code: z.string().regex(/^\d+$/, 'OA code must be a positive integer string'),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const mineducAxisSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(8)
    .regex(/^[A-Z]+$/, 'Axis code must be uppercase letters'),
  name: z.string().min(1),
  objectives: z.array(mineducObjectiveSchema),
});

export const mineducGradeSchema = z.object({
  code: z.enum(MINEDUC_GRADE_CODES),
  axes: z.array(mineducAxisSchema),
});

export const mineducSubjectSchema = z.object({
  code: z.enum(MINEDUC_SUBJECT_CODES),
  name: z.string().min(1),
  grades: z.array(mineducGradeSchema),
});

export const mineducCurriculumSchema = z.object({
  version: z.string().min(1),
  issuedBy: z.array(z.string().min(1)),
  source: z.string().url(),
  subjects: z.array(mineducSubjectSchema),
});

export type MineducObjective = z.infer<typeof mineducObjectiveSchema>;
export type MineducAxis = z.infer<typeof mineducAxisSchema>;
export type MineducGrade = z.infer<typeof mineducGradeSchema>;
export type MineducSubject = z.infer<typeof mineducSubjectSchema>;
export type MineducCurriculum = z.infer<typeof mineducCurriculumSchema>;
export type MineducSubjectCode = (typeof MINEDUC_SUBJECT_CODES)[number];
export type MineducGradeCode = (typeof MINEDUC_GRADE_CODES)[number];
