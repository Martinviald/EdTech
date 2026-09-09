import { z } from 'zod';
import type { ExpectedScope, ExpectedScopeCell } from '../utils/expected-scope';
import type { InstrumentType } from '../enums';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  type InstrumentApplicationPeriod,
} from './instrument.schema';

export const PROCESS_KINDS = [
  'dia',
  'simce_ensayo',
  'paes_ensayo',
  'evaluacion_interna',
  'cambridge_mock',
  'custom',
] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];

export const PROCESS_KIND_LABELS: Record<ProcessKind, string> = {
  dia: 'DIA',
  simce_ensayo: 'Ensayo SIMCE',
  paes_ensayo: 'Ensayo PAES',
  evaluacion_interna: 'Evaluación interna',
  cambridge_mock: 'Ensayo Cambridge',
  custom: 'Otro',
};

export const PROCESS_STATUSES = [
  'planned',
  'in_progress',
  'loading',
  'closed',
  'archived',
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const PROCESS_STATUS_LABELS: Record<ProcessStatus, string> = {
  planned: 'Planificado',
  in_progress: 'En aplicación',
  loading: 'Cargando respuestas',
  closed: 'Cerrado',
  archived: 'Archivado',
};

export const PROCESS_COVERAGE_CELL_STATUSES = [
  'missing',
  'scheduled',
  'partial',
  'complete',
] as const;
export type ProcessCoverageCellStatus = (typeof PROCESS_COVERAGE_CELL_STATUSES)[number];

export const PROCESS_COVERAGE_CELL_STATUS_LABELS: Record<ProcessCoverageCellStatus, string> = {
  missing: 'Sin evaluación',
  scheduled: 'Sin respuestas',
  partial: 'Carga incompleta',
  complete: 'Completa',
};

export const PROCESS_KIND_BY_INSTRUMENT_TYPE: Record<InstrumentType, ProcessKind> = {
  dia: 'dia',
  simce: 'simce_ensayo',
  paes: 'paes_ensayo',
  cambridge_mock: 'cambridge_mock',
  custom: 'evaluacion_interna',
  aptus: 'custom',
  desafio: 'custom',
  pal: 'custom',
};

const processKindSchema = z.enum(PROCESS_KINDS);
const processStatusSchema = z.enum(PROCESS_STATUSES);
const processPeriodSchema = z.enum(INSTRUMENT_APPLICATION_PERIODS);
const isoDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export const expectedScopeCellSchema: z.ZodType<ExpectedScopeCell> = z.object({
  classGroupId: z.string().uuid(),
  subjectId: z.string().uuid(),
});

export const expectedScopeSchema: z.ZodType<ExpectedScope> = z.object({
  classGroupIds: z.array(z.string().uuid()).optional(),
  subjectIds: z.array(z.string().uuid()).optional(),
  excludedCells: z.array(expectedScopeCellSchema).optional(),
  derived: z.boolean().optional(),
});

export const createMeasurementProcessSchema = z.object({
  name: z.string().trim().min(3).max(160),
  academicYearId: z.string().uuid(),
  kind: processKindSchema,
  period: processPeriodSchema.nullish(),
  taxonomyId: z.string().uuid().nullish(),
  status: processStatusSchema.optional(),
  startsOn: isoDateOnlySchema.nullish(),
  endsOn: isoDateOnlySchema.nullish(),
  expectedScope: expectedScopeSchema.optional(),
  notes: z.string().trim().max(2000).nullish(),
});
export type CreateMeasurementProcessDto = z.infer<typeof createMeasurementProcessSchema>;

export const updateMeasurementProcessSchema = createMeasurementProcessSchema
  .partial()
  .omit({ academicYearId: true })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });
export type UpdateMeasurementProcessDto = z.infer<typeof updateMeasurementProcessSchema>;

export const measurementProcessListQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  kind: processKindSchema.optional(),
  status: processStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MeasurementProcessListQuery = z.infer<typeof measurementProcessListQuerySchema>;

export const linkProcessAssessmentsSchema = z.object({
  assessmentIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['link', 'unlink']).default('link'),
});
export type LinkProcessAssessmentsDto = z.infer<typeof linkProcessAssessmentsSchema>;

export type ProcessCoverageTotals = {
  expected: number;
  missing: number;
  scheduled: number;
  partial: number;
  complete: number;
};

export type MeasurementProcessModel = {
  id: string;
  name: string;
  slug: string;
  kind: ProcessKind;
  period: InstrumentApplicationPeriod | null;
  status: ProcessStatus;
  academicYearId: string;
  academicYear: number | null;
  taxonomyId: string | null;
  taxonomyName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
  expectedScope: ExpectedScope;
  scopeDefined: boolean;
  scopeDerived: boolean;
  assessmentCount: number;
  studentsAssessed: number;
  coverage: ProcessCoverageTotals | null;
  createdAt: string;
  updatedAt: string;
};

export type MeasurementProcessListResponse = {
  data: MeasurementProcessModel[];
  total: number;
  page: number;
  limit: number;
};

export type ProcessCoverageCell = {
  classGroupId: string;
  classGroupName: string;
  gradeShortName: string;
  gradeOrder: number;
  subjectId: string;
  subjectName: string;
  subjectShortName: string;
  status: ProcessCoverageCellStatus;
  assessmentId: string | null;
  assessmentName: string | null;
  studentsExpected: number;
  studentsWithResults: number;
};

export type ProcessCoverageResponse = {
  processId: string;
  scopeDefined: boolean;
  scopeDerived: boolean;
  totals: ProcessCoverageTotals;
  cells: ProcessCoverageCell[];
  unexpectedCells: ProcessCoverageCell[];
};

export type ProcessCandidateAssessment = {
  assessmentId: string;
  assessmentName: string | null;
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  applicationPeriod: InstrumentApplicationPeriod | null;
  subjectId: string | null;
  subjectName: string | null;
  administeredAt: string | null;
  classGroupNames: string[];
  currentProcessId: string | null;
};

export type ProcessCandidatesResponse = {
  data: ProcessCandidateAssessment[];
  total: number;
};
