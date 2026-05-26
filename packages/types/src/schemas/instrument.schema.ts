import { z } from 'zod';
import { INSTRUMENT_TYPES } from '../enums';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
export const instrumentStatusSchema = z.enum(['draft', 'published', 'archived']);
export const sectionTypeSchema = z.enum([
  'multiple_choice',
  'open_ended',
  'oral',
  'listening',
  'mixed',
]);

export const createInstrumentSectionSchema = z.object({
  name: z.string().min(1).max(200),
  type: sectionTypeSchema,
  order: z.number().int().min(0).default(0),
  maxPoints: z.number().min(0).optional(),
  timeLimitMin: z.number().int().min(0).optional(),
  instructions: z.string().max(2000).optional(),
});

export const createInstrumentSchema = z.object({
  name: z.string().min(2).max(300),
  type: instrumentTypeSchema,
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  curriculumId: z.string().uuid().optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  version: z.string().max(50).optional(),
  isOfficial: z.boolean().default(false),
  gradingScaleId: z.string().uuid().optional(),
  sections: z.array(createInstrumentSectionSchema).optional(),
});

export const updateInstrumentSchema = createInstrumentSchema.partial();

export const listInstrumentsQuerySchema = z.object({
  type: instrumentTypeSchema.optional(),
  status: instrumentStatusSchema.optional(),
  year: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateInstrumentDto = z.infer<typeof createInstrumentSchema>;
export type UpdateInstrumentDto = z.infer<typeof updateInstrumentSchema>;
export type CreateInstrumentSectionDto = z.infer<typeof createInstrumentSectionSchema>;
export type ListInstrumentsQueryDto = z.infer<typeof listInstrumentsQuerySchema>;

// ── Modelos (response shapes de la API) ──────────────────────────────────────

export type InstrumentSectionModel = {
  id: string;
  instrumentId: string;
  name: string;
  type: string;
  order: number;
  maxPoints: string | null;
  timeLimitMin: number | null;
  instructions: string | null;
  config: Record<string, unknown>;
};

export type GradingScaleModel = {
  id: string;
  orgId: string | null;
  name: string;
  type: string;
  minGrade: string;
  maxGrade: string;
  passingGrade: string;
  passingThreshold: string;
  config: Record<string, unknown>;
  createdAt: string | Date;
};

export type InstrumentModel = {
  id: string;
  orgId: string | null;
  curriculumId: string | null;
  name: string;
  shortName: string | null;
  type: string;
  subjectId: string | null;
  gradeId: string | null;
  year: number | null;
  version: string | null;
  isOfficial: boolean;
  status: 'draft' | 'published' | 'archived';
  gradingScaleId: string | null;
  config: Record<string, unknown>;
  createdById: string | null;
  deletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  // Relations (optional, present when eagerly loaded)
  sections?: InstrumentSectionModel[];
  gradingScale?: GradingScaleModel | null;
  itemCount?: number;
  subject?: { id: string; name: string } | null;
  grade?: { id: string; name: string; code: string } | null;
};
