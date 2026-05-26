import { z } from 'zod';

/**
 * Formatos de hoja de respuestas soportados por el módulo de ingesta masiva.
 *
 * - `dia_official`: parser oficial de la Agencia de Calidad (H16.4)
 * - `gradecam_csv`: export estándar de Gradecam (H16.3)
 * - `zipgrade_csv`: export estándar de ZipGrade (H16.3)
 * - `generic_csv`: CSV genérico con columnMapping configurable
 */
export const ANSWER_SHEET_FORMATS = [
  'dia_official',
  'gradecam_csv',
  'zipgrade_csv',
  'generic_csv',
] as const;
export type AnswerSheetFormat = (typeof ANSWER_SHEET_FORMATS)[number];

/** Mapping configurable de columnas CSV → campos esperados (sólo `generic_csv`). */
export const answerSheetColumnMappingSchema = z.object({
  rut: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  /** Prefijo o lista de columnas para ítems. Ej: `Q` o `["Q1","Q2",...]`. */
  questionsPrefix: z.string().optional(),
  questionColumns: z.array(z.string()).optional(),
});
export type AnswerSheetColumnMapping = z.infer<typeof answerSheetColumnMappingSchema>;

/** Metadata enviada en el multipart de upload (campos del form). */
export const answerSheetUploadMetadataSchema = z.object({
  format: z.enum(ANSWER_SHEET_FORMATS),
  instrumentId: z.string().uuid(),
  classGroupId: z.string().uuid().optional(),
  assessmentId: z.string().uuid().optional(),
  assessmentName: z.string().min(1).max(255).optional(),
  /**
   * En multipart los campos llegan como string; el controller debe
   * parsear esto como JSON cuando aplique al format `generic_csv`.
   */
  columnMapping: answerSheetColumnMappingSchema.optional(),
});
export type AnswerSheetUploadMetadata = z.infer<typeof answerSheetUploadMetadataSchema>;

export const answerSheetRowErrorSchema = z.object({
  rowNumber: z.number().int().positive(),
  field: z.string().optional(),
  message: z.string(),
});
export type AnswerSheetRowError = z.infer<typeof answerSheetRowErrorSchema>;

export const answerSheetRowPreviewSchema = z.object({
  rowNumber: z.number().int().positive(),
  studentRut: z.string().nullable(),
  studentFullName: z.string().nullable(),
  studentId: z.string().uuid().nullable(),
  matched: z.boolean(),
  /** itemPosition → key seleccionada (o null si en blanco). */
  answers: z.record(z.string(), z.string().nullable()),
  /** Cantidad de respuestas no en blanco. */
  answeredCount: z.number().int().nonnegative(),
  errors: z.array(answerSheetRowErrorSchema),
});
export type AnswerSheetRowPreview = z.infer<typeof answerSheetRowPreviewSchema>;

export const answerSheetUploadResponseSchema = z.object({
  previewToken: z.string().uuid(),
  format: z.enum(ANSWER_SHEET_FORMATS),
  totalRows: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
});
export type AnswerSheetUploadResponse = z.infer<typeof answerSheetUploadResponseSchema>;

export const answerSheetPreviewResponseSchema = z.object({
  previewToken: z.string().uuid(),
  format: z.enum(ANSWER_SHEET_FORMATS),
  instrumentId: z.string().uuid(),
  totalRows: z.number().int().nonnegative(),
  matchedRows: z.number().int().nonnegative(),
  unmatchedRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  detectedColumns: z.array(z.string()),
  warnings: z.array(z.string()),
  rows: z.array(answerSheetRowPreviewSchema),
  /** Item positions detectadas para el instrumento en el archivo. */
  itemPositions: z.array(z.number().int().positive()),
  /** Items del instrumento que NO aparecieron en ninguna fila. */
  missingItemPositions: z.array(z.number().int().positive()),
});
export type AnswerSheetPreviewResponse = z.infer<typeof answerSheetPreviewResponseSchema>;

export const answerSheetConfirmRequestSchema = z.object({
  previewToken: z.string().uuid(),
  /** Si se especifica, reusa un assessment existente; si no, se crea uno nuevo. */
  assessmentId: z.string().uuid().optional(),
  /** Nombre opcional del assessment a crear. */
  assessmentName: z.string().min(1).max(255).optional(),
  /** Lista de cursos a asignar al assessment (opcional). */
  classGroupIds: z.array(z.string().uuid()).optional(),
  /** Si true, omite filas con errores y persiste sólo las válidas. */
  skipErrorRows: z.boolean().default(false),
});
export type AnswerSheetConfirmRequestDto = z.infer<typeof answerSheetConfirmRequestSchema>;

export const answerSheetConfirmResponseSchema = z.object({
  jobId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  status: z.enum(['completed', 'partial', 'failed']),
  responsesCreated: z.number().int().nonnegative(),
  studentsProcessed: z.number().int().nonnegative(),
  rowsSkipped: z.number().int().nonnegative(),
  errors: z.array(answerSheetRowErrorSchema),
});
export type AnswerSheetConfirmResponse = z.infer<typeof answerSheetConfirmResponseSchema>;

export const answerSheetTemplateSchema = z.object({
  format: z.enum(ANSWER_SHEET_FORMATS),
  name: z.string(),
  description: z.string(),
  fileExtension: z.string(),
  requiredColumns: z.array(z.string()),
  optionalColumns: z.array(z.string()),
  /** Ejemplo de fila (CSV header + 1-2 filas demo) que el frontend puede mostrar. */
  exampleCsv: z.string(),
});
export type AnswerSheetTemplate = z.infer<typeof answerSheetTemplateSchema>;

/** Modelo del import_job en respuestas de API. */
export const importJobModelSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  assessmentId: z.string().uuid().nullable(),
  type: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'partial']),
  fileUrl: z.string().nullable(),
  mappingConfig: z.record(z.unknown()).nullable(),
  result: z
    .object({
      rowsProcessed: z.number().int().optional(),
      errors: z.number().int().optional(),
      warnings: z.number().int().optional(),
    })
    .nullable(),
  errorLog: z.array(z.object({ row: z.number(), message: z.string() })).nullable(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type ImportJobModel = z.infer<typeof importJobModelSchema>;
