import { z } from 'zod';

// Formatos de archivo soportados por la ingesta de hojas de respuesta.
// Cada formato corresponde a un parser específico en `apps/api/src/answer-sheets/lib/`.
export const ANSWER_SHEET_FORMATS = [
  'gradecam_csv',
  'zipgrade_csv',
  'dia_official',
  'generic_csv',
] as const;
export type AnswerSheetFormat = (typeof ANSWER_SHEET_FORMATS)[number];

// Mapeo del tipo enum del schema DB (import_job_type) a los formatos soportados.
// answer_sheet_csv = generic_csv, dia_official, gradecam_csv, zipgrade_csv ya existen.
export const importJobTypeForFormat: Record<AnswerSheetFormat, string> = {
  gradecam_csv: 'gradecam_csv',
  zipgrade_csv: 'zipgrade_csv',
  dia_official: 'dia_official',
  generic_csv: 'answer_sheet_csv',
};

export const IMPORT_JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'partial',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

// ── Upload ───────────────────────────────────────────────────────────────────
// `POST /answer-sheets/upload` (multipart): file + metadata como campos de form.
// Devuelve un previewToken que se usa en /preview y /confirm para evitar re-parsear.

export const answerSheetColumnMappingSchema = z.object({
  rut: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  questionsPrefix: z.string().optional(),
  questionColumns: z.array(z.string()).optional(),
});

export type AnswerSheetColumnMapping = z.infer<typeof answerSheetColumnMappingSchema>;

export const answerSheetUploadMetadataSchema = z.object({
  format: z.enum(ANSWER_SHEET_FORMATS),
  instrumentId: z.string().uuid(),
  classGroupId: z.string().uuid().optional(),
  assessmentId: z.string().uuid().optional(),
  // Mapeo columna → campo cuando el formato es generic_csv.
  columnMapping: answerSheetColumnMappingSchema.optional(),
  // Nombre lógico para el assessment si se crea uno nuevo.
  assessmentName: z.string().min(1).max(300).optional(),
});

export type AnswerSheetUploadMetadataDto = z.infer<typeof answerSheetUploadMetadataSchema>;

// ── Preview ──────────────────────────────────────────────────────────────────
// `POST /answer-sheets/preview` { previewToken } o reusar el upload directamente.

export const answerSheetPreviewRequestSchema = z.object({
  previewToken: z.string().min(1),
});
export type AnswerSheetPreviewRequestDto = z.infer<typeof answerSheetPreviewRequestSchema>;

// ── Confirm ──────────────────────────────────────────────────────────────────

export const answerSheetConfirmRequestSchema = z.object({
  previewToken: z.string().min(1),
  // Permite confirmar la creación de un assessment si no se proveyó uno.
  createAssessment: z.boolean().default(true),
  // Si las filas con errores deben ignorarse (true) o bloquear el commit (false).
  skipErrorRows: z.boolean().default(true),
  // Si el caller quiere asociar la ingesta a un assessment existente.
  assessmentId: z.string().uuid().optional(),
  // Nombre del nuevo assessment cuando createAssessment=true.
  assessmentName: z.string().min(1).max(300).optional(),
});
export type AnswerSheetConfirmRequestDto = z.infer<typeof answerSheetConfirmRequestSchema>;

// ── Row Errors ───────────────────────────────────────────────────────────────

export const answerSheetRowErrorSchema = z.object({
  rowNumber: z.number().int().positive(),
  field: z.string().optional(),
  message: z.string(),
});
export type AnswerSheetRowError = z.infer<typeof answerSheetRowErrorSchema>;

// ── Response Models (API shape) ──────────────────────────────────────────────

export type AnswerSheetRowPreview = {
  rowNumber: number;
  studentRut: string | null;
  studentId: string | null; // null si no se encontró el alumno en la org
  studentFullName: string | null;
  matched: boolean; // true si studentId está presente
  // Mapa de itemPosition → rawAnswer (key seleccionada por el alumno).
  answers: Record<string, string | null>;
  errors: AnswerSheetRowError[];
};

export type AnswerSheetUploadResponse = {
  previewToken: string;
  format: AnswerSheetFormat;
  totalRows: number;
  // Tiempo de expiración del previewToken (ISO timestamp).
  expiresAt: string;
};

export type AnswerSheetPreviewResponse = {
  previewToken: string;
  format: AnswerSheetFormat;
  instrumentId: string;
  // Resumen del instrumento contra el que se importa, para mostrar en UI.
  instrumentName: string;
  // Lista de columnas detectadas en el archivo.
  detectedColumns: string[];
  // Filas parseadas (puede venir truncado a 100 para previsualización).
  rows: AnswerSheetRowPreview[];
  // Estadísticas globales.
  summary: {
    totalRows: number;
    matchedStudents: number;
    unmatchedStudents: number;
    rowsWithErrors: number;
    itemsInInstrument: number;
    itemsCovered: number; // posiciones de ítem detectadas en el archivo
  };
  warnings: string[];
};

export type AnswerSheetConfirmResponse = {
  jobId: string;
  status: ImportJobStatus;
  assessmentId: string;
  responsesCreated: number;
  studentsProcessed: number;
  // Total de resultados (assessment_results) calculados.
  resultsCalculated?: number;
  // Filas saltadas por errores (cuando skipErrorRows = true).
  rowsSkipped?: number;
  errors: AnswerSheetRowError[];
};

// ── Import Job Polling ───────────────────────────────────────────────────────

export type ImportJobModel = {
  id: string;
  orgId: string;
  assessmentId: string | null;
  type: string;
  status: ImportJobStatus;
  fileUrl: string | null;
  mappingConfig: Record<string, unknown> | null;
  result: {
    rowsProcessed?: number;
    errors?: number;
    warnings?: number;
  } | null;
  errorLog: Array<{ row: number; message: string }> | null;
  createdById: string | null;
  createdAt: string | Date;
  completedAt: string | Date | null;
};

// ── Templates (H16.3) ────────────────────────────────────────────────────────

export type AnswerSheetTemplate = {
  format: AnswerSheetFormat;
  label: string;
  description: string;
  requiredColumns: string[];
  optionalColumns: string[];
  sampleCsvUrl: string | null;
  // Opcionales: contenido inline del CSV de ejemplo y extensión del archivo.
  exampleCsv?: string;
  fileExtension?: string;
};
