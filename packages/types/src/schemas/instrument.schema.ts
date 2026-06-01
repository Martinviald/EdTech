import { z } from 'zod';
import { INSTRUMENT_TYPES, type InstrumentType } from '../enums';

export const INSTRUMENT_STATUS = ['draft', 'published', 'archived'] as const;
export type InstrumentStatus = (typeof INSTRUMENT_STATUS)[number];

export const SECTION_TYPES = [
  'multiple_choice',
  'open_ended',
  'oral_reading',
  'oral_expression',
  'writing',
  'listening',
  'matching',
  'mixed',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const GRADING_SCALE_TYPES = [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
] as const;
export type GradingScaleType = (typeof GRADING_SCALE_TYPES)[number];

const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const instrumentStatusSchema = z.enum(INSTRUMENT_STATUS);
const sectionTypeSchema = z.enum(SECTION_TYPES);
const gradingScaleTypeSchema = z.enum(GRADING_SCALE_TYPES);

// ── Grading Scales ───────────────────────────────────────────────────────────

export const createGradingScaleSchema = z.object({
  name: z.string().min(2).max(200),
  type: gradingScaleTypeSchema,
  minGrade: z.coerce.number().min(0).max(100).default(1),
  maxGrade: z.coerce.number().min(1).max(100).default(7),
  passingGrade: z.coerce.number().min(0).max(100).default(4),
  passingThreshold: z.coerce.number().min(0).max(1).default(0.6),
  config: z.record(z.unknown()).optional(),
});

export const updateGradingScaleSchema = createGradingScaleSchema.partial();

export type CreateGradingScaleDto = z.infer<typeof createGradingScaleSchema>;
export type UpdateGradingScaleDto = z.infer<typeof updateGradingScaleSchema>;

// ── Instrument Sections ──────────────────────────────────────────────────────

export const createInstrumentSectionSchema = z.object({
  name: z.string().min(1).max(200),
  type: sectionTypeSchema,
  order: z.number().int().min(0).default(0),
  maxPoints: z.coerce.number().min(0).optional(),
  timeLimitMin: z.number().int().min(0).optional(),
  instructions: z.string().max(2000).optional(),
  config: z.record(z.unknown()).optional(),
});

export const updateInstrumentSectionSchema = createInstrumentSectionSchema.partial();

export type CreateInstrumentSectionDto = z.infer<typeof createInstrumentSectionSchema>;
export type UpdateInstrumentSectionDto = z.infer<typeof updateInstrumentSectionSchema>;

// ── Instruments ──────────────────────────────────────────────────────────────

export const createInstrumentSchema = z.object({
  taxonomyId: z.string().uuid().optional(),
  name: z.string().min(2).max(300),
  shortName: z.string().max(50).optional(),
  type: instrumentTypeSchema,
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  version: z.string().max(50).optional(),
  isOfficial: z.boolean().default(false),
  status: instrumentStatusSchema.default('draft'),
  gradingScaleId: z.string().uuid().optional(),
  config: z.record(z.unknown()).optional(),
  sections: z.array(createInstrumentSectionSchema).optional(),
});

export const updateInstrumentSchema = createInstrumentSchema
  .omit({ sections: true })
  .partial();

export const listInstrumentsQuerySchema = z.object({
  type: instrumentTypeSchema.optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  status: instrumentStatusSchema.optional(),
  isOfficial: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateInstrumentDto = z.infer<typeof createInstrumentSchema>;
export type UpdateInstrumentDto = z.infer<typeof updateInstrumentSchema>;
export type ListInstrumentsQueryDto = z.infer<typeof listInstrumentsQuerySchema>;

// ── Response Models (API shape) ──────────────────────────────────────────────

export type InstrumentSectionModel = {
  id: string;
  instrumentId: string;
  name: string;
  type: SectionType;
  order: number;
  maxPoints: string | null;
  timeLimitMin: number | null;
  instructions: string | null;
  config: Record<string, unknown>;
};

export type InstrumentModel = {
  id: string;
  orgId: string | null;
  taxonomyId: string | null;
  name: string;
  shortName: string | null;
  type: InstrumentType;
  subjectId: string | null;
  gradeId: string | null;
  year: number | null;
  version: string | null;
  isOfficial: boolean;
  status: InstrumentStatus;
  gradingScaleId: string | null;
  config: Record<string, unknown>;
  createdById: string | null;
  deletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  sections?: InstrumentSectionModel[];
};

export type GradingScaleModel = {
  id: string;
  orgId: string | null;
  name: string;
  type: GradingScaleType;
  minGrade: string;
  maxGrade: string;
  passingGrade: string;
  passingThreshold: string;
  config: Record<string, unknown>;
  createdAt: string | Date;
};
