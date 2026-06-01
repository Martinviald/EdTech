import { z } from 'zod';
import { paginationSchema } from '@soe/types';

// ── Instrument Type / Status enums ──────────────────────────────────────────
const INSTRUMENT_TYPES = [
  'dia',
  'simce',
  'paes',
  'cambridge_mock',
  'aptus',
  'desafio',
  'pal',
  'custom',
] as const;

const INSTRUMENT_STATUSES = ['draft', 'published', 'archived'] as const;

const SECTION_TYPES = [
  'multiple_choice',
  'open_ended',
  'oral_reading',
  'oral_expression',
  'writing',
  'listening',
  'matching',
  'mixed',
] as const;

// ── Section DTOs ────────────────────────────────────────────────────────────
export const createSectionSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(SECTION_TYPES),
  order: z.number().int().min(0).default(0),
  maxPoints: z.coerce.string().optional(),
  timeLimitMin: z.number().int().min(0).optional(),
  instructions: z.string().max(2000).optional(),
  config: z.record(z.unknown()).optional(),
});

export const updateSectionSchema = createSectionSchema.partial();

// ── Instrument DTOs ─────────────────────────────────────────────────────────
export const createInstrumentSchema = z.object({
  curriculumId: z.string().uuid().optional(),
  name: z.string().min(1).max(300),
  shortName: z.string().max(50).optional(),
  type: z.enum(INSTRUMENT_TYPES),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  version: z.string().max(50).optional(),
  isOfficial: z.boolean().default(false),
  status: z.enum(INSTRUMENT_STATUSES).default('draft'),
  gradingScaleId: z.string().uuid().optional(),
  config: z.record(z.unknown()).optional(),
  sections: z.array(createSectionSchema).optional(),
});

export const updateInstrumentSchema = createInstrumentSchema
  .omit({ sections: true })
  .partial();

export const listInstrumentsQuerySchema = paginationSchema.extend({
  type: z.enum(INSTRUMENT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  status: z.enum(INSTRUMENT_STATUSES).optional(),
  isOfficial: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
});

// ── Inferred types ──────────────────────────────────────────────────────────
export type CreateInstrumentDto = z.infer<typeof createInstrumentSchema>;
export type UpdateInstrumentDto = z.infer<typeof updateInstrumentSchema>;
export type ListInstrumentsQueryDto = z.infer<typeof listInstrumentsQuerySchema>;
export type CreateSectionDto = z.infer<typeof createSectionSchema>;
export type UpdateSectionDto = z.infer<typeof updateSectionSchema>;
