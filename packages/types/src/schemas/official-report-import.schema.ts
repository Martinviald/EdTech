import { z } from 'zod';
import type { AnswerCount } from '../utils/item-stats-calculator';
import type { ImportJobStatus } from './answer-sheet.schema';

/**
 * Contrato de importación de informes oficiales de resultados (PDF → JSON).
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md §6.
 *
 * Formato INTERMEDIO: el PDF lo extrae un pipeline aparte (visión + OCR para la
 * figura de niveles por alumno) y deja este JSON. El importador nunca lee el PDF.
 *
 * A diferencia de `answer-sheet.schema.ts`, acá NO hay respuestas alumno×pregunta:
 * el informe entrega porcentajes por alternativa a nivel de CURSO más el N de la
 * cohorte. `round(pct/100 × N)` reconstruye el conteo entero exacto — que la suma
 * dé N es la validación de integridad dura del importador (§2.2).
 *
 * `students` es OPCIONAL a propósito: la tabla de ítems y la figura de niveles son
 * dos pipelines de extracción independientes (el segundo es el frágil), y un informe
 * puede cargarse solo con datos de cohorte.
 */

export const OFFICIAL_REPORT_IMPORT_SCHEMA_VERSION = '1.0';

/**
 * Clave reservada para "no responde" en la tabla del informe. Se normaliza a
 * `key: null` en `assessment_item_stats.answerCounts`, que es la representación
 * del blanco en el read-model (idéntica a la que produce el flujo `computed`).
 */
export const OFFICIAL_REPORT_BLANK_KEY = 'N';

/**
 * Crédito por defecto de cada categoría de respuesta, como fracción del puntaje
 * del ítem (`items.scoring_config.points`).
 *
 * ⚠️ Por qué vive acá y no en `items.scoring_config`: el schema de scoring solo
 * expresa `points` y `partialCredit: boolean` — dice SI hay crédito parcial, no
 * CUÁNTO vale. El 0.5 de una respuesta parcialmente correcta es una convención del
 * informe, no del ítem. Cualquier bucket puede sobreescribirlo con `credit` sin
 * tocar código, así el contrato no queda atado a estas tres categorías.
 *
 * El gate del eje de habilidad (§6.2 #3) valida esta convención contra el número
 * que el propio informe reporta: si el crédito estuviera mal, el eje no cuadraría.
 */
export const OFFICIAL_REPORT_CATEGORY_CREDIT: Readonly<Record<string, number>> = {
  RC: 1, // Respuesta Correcta
  RPC: 0.5, // Respuesta Parcialmente Correcta
  RI: 0, // Respuesta Incorrecta
  [OFFICIAL_REPORT_BLANK_KEY]: 0, // No responde
};

/** Tolerancia del cotejo de porcentajes, en puntos porcentuales (§2.3: delta real < 0.005 pp). */
export const OFFICIAL_REPORT_PCT_TOLERANCE_PP = 0.01;

// ── Archivo de entrada ───────────────────────────────────────────────────────

/**
 * Un bucket de la distribución de respuestas de una pregunta.
 *
 * - `key`: alternativa (`A`, `B`, …), categoría de desarrollo (`RC`, `RPC`, `RI`)
 *   o `N` (no responde). Sin vocabulario cerrado: el instrumento define el suyo.
 * - `pct`: porcentaje del curso, tal como lo imprime el informe (2 decimales).
 * - `isCorrect`: marca la alternativa correcta (la negrita del informe). Si no
 *   viene, se deriva de la categoría (`RC` = correcta).
 * - `credit`: override del crédito (0..1) sobre `OFFICIAL_REPORT_CATEGORY_CREDIT`.
 */
export const officialReportDistributionBucketSchema = z.object({
  key: z.string().min(1).max(8),
  pct: z.number().min(0).max(100),
  isCorrect: z.boolean().optional(),
  credit: z.number().min(0).max(1).optional(),
});
export type OfficialReportDistributionBucket = z.infer<
  typeof officialReportDistributionBucketSchema
>;

export const officialReportItemSchema = z
  .object({
    /** N° de pregunta en el instrumento. Resuelve a `items.position` (gate #2). */
    position: z.number().int().positive(),
    distribution: z.array(officialReportDistributionBucketSchema).min(1),
  })
  .refine(
    (item) => new Set(item.distribution.map((b) => b.key)).size === item.distribution.length,
    { message: 'Las claves de la distribución deben ser únicas dentro de una pregunta' },
  );
export type OfficialReportItem = z.infer<typeof officialReportItemSchema>;

/**
 * Metadatos de portada del PDF de origen. Sirven para cotejar contra lo que eligió el
 * usuario, no para resolver nada.
 *
 * `SourceMeta` y no `Meta`: `OfficialReportMeta` ya existe en
 * `official-report-common.schema.ts` y es otra cosa — el encabezado de un informe que
 * NOSOTROS generamos (org, director, instrumento). Éste describe el informe que
 * ENTRA.
 */
export const officialReportSourceMetaSchema = z.object({
  rbd: z.string().min(1).max(20),
  courseLabel: z.string().min(1).max(50),
  period: z.string().min(1).max(50),
  year: z.number().int().min(2000).max(2100),
  subjectCode: z.string().min(1).max(50),
  gradeCode: z.string().min(1).max(50),
  /** "Cantidad de estudiantes que considera este informe". Es el N de la cohorte. */
  studentCount: z.number().int().positive(),
});
export type OfficialReportSourceMeta = z.infer<typeof officialReportSourceMetaSchema>;

/**
 * % de logro por eje reportado por el informe. **Es validación, no input** (§2.3):
 * el eje se deriva de los conteos y se cotea contra este número.
 */
export const officialReportSkillAxisSchema = z.object({
  name: z.string().min(1).max(200),
  pct: z.number().min(0).max(100),
});
export type OfficialReportSkillAxis = z.infer<typeof officialReportSkillAxisSchema>;

/** Distribución de niveles reportada. También es validación, no input. */
export const officialReportLevelShareSchema = z.object({
  level: z.string().min(1).max(50),
  pct: z.number().min(0).max(100),
});
export type OfficialReportLevelShare = z.infer<typeof officialReportLevelShareSchema>;

/**
 * Un alumno según la figura del informe. El nombre viene de OCR (prefijo truncado).
 *
 * Dos formas según el momento del informe, ambas compatibles:
 *  - **Monitoreo/Cierre**: `level` — el nivel de logro discreto (I/II/III…) que
 *    imprime la figura. Señal confiable.
 *  - **Diagnóstico**: NO clasifica por niveles I/II/III, sino binario `requiresSupport`
 *    ("requiere mayor apoyo", sí/no) — el lado del umbral, la señal CONFIABLE — más
 *    `scorePct`, una posición/score APROXIMADO (0..100) sólo para mostrar la posición
 *    del alumno. La banda importada manda sobre el % aproximado (§5 del plan).
 *
 * Los tres campos de clasificación son opcionales para no atar el contrato a un
 * momento: un informe de Monitoreo trae `level`, uno de Diagnóstico `requiresSupport`
 * (+ `scorePct`). El importador ramifica por cuál viene.
 */
export const officialReportStudentSchema = z.object({
  listNumber: z.string().max(10).optional(),
  name: z.string().min(1).max(200),
  /** Monitoreo/Cierre: nivel de logro discreto de la figura (I/II/III…). */
  level: z.string().min(1).max(50).optional(),
  /**
   * Cierre: nivel PREVIO del alumno en el Monitoreo Intermedio (I/II/III…). La figura
   * "Estudiantes que muestran avance o mejora" del informe de Cierre lista el SUBCONJUNTO
   * que avanzó, cada uno con su nivel de Monitoreo (`priorLevel`) y su nivel de Cierre
   * (`level`). Sólo presente en Cierre; el importador lo resuelve a la banda previa.
   */
  priorLevel: z.string().min(1).max(50).optional(),
  /** Diagnóstico: "requiere mayor apoyo" (lado del umbral). Señal confiable. */
  requiresSupport: z.boolean().optional(),
  /** Diagnóstico: posición/score aproximado (0..100). Sólo para mostrar. */
  scorePct: z.number().min(0).max(100).optional(),
});
export type OfficialReportStudent = z.infer<typeof officialReportStudentSchema>;

export const officialReportImportFileSchema = z.object({
  schemaVersion: z.literal(OFFICIAL_REPORT_IMPORT_SCHEMA_VERSION),
  source: z.object({ file: z.string().min(1).max(500) }),
  report: officialReportSourceMetaSchema,
  items: z.array(officialReportItemSchema).min(1),
  skillAxes: z.array(officialReportSkillAxisSchema).default([]),
  levelDistribution: z.array(officialReportLevelShareSchema).default([]),
  /** Opcional: un informe puede cargarse solo con datos de cohorte (§6.4). */
  students: z.array(officialReportStudentSchema).optional(),
});
export type OfficialReportImportFile = z.infer<typeof officialReportImportFileSchema>;

// ── Upload / Preview / Confirm ───────────────────────────────────────────────

/**
 * El instrumento y el curso se eligen explícitamente en la UI, NO se adivinan desde
 * `report.courseLabel` / `report.rbd`: esos se usan solo para cotejar y advertir.
 * Resolver un curso por texto sería inventar dato.
 */
export const officialReportImportUploadMetadataSchema = z.object({
  instrumentId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  /** Reusar un assessment existente. Si es `item_level` → 409 (§9.3: gana el granular). */
  assessmentId: z.string().uuid().optional(),
  assessmentName: z.string().min(1).max(300).optional(),
});
export type OfficialReportImportUploadMetadataDto = z.infer<
  typeof officialReportImportUploadMetadataSchema
>;

export const officialReportImportPreviewRequestSchema = z.object({
  previewToken: z.string().uuid(),
});
export type OfficialReportImportPreviewRequestDto = z.infer<
  typeof officialReportImportPreviewRequestSchema
>;

/**
 * `studentMatches` es el veredicto HUMANO sobre el gate #5 (CLAUDE.md §8.3: la IA
 * propone, el humano aprueba). El importador nunca usa su propia propuesta de match:
 * solo escribe los pares que el usuario confirmó explícitamente. Un alumno del informe
 * que no aparezca acá queda fuera y se reporta — nunca se crea ni se inventa.
 */
export const officialReportImportConfirmRequestSchema = z.object({
  previewToken: z.string().uuid(),
  assessmentId: z.string().uuid().optional(),
  assessmentName: z.string().min(1).max(300).optional(),
  studentMatches: z
    .array(
      z.object({
        /** Índice en `students[]` del archivo. Estable y sin ambigüedad de nombres. */
        reportIndex: z.number().int().min(0),
        studentId: z.string().uuid(),
      }),
    )
    .default([]),
});
export type OfficialReportImportConfirmRequestDto = z.infer<
  typeof officialReportImportConfirmRequestSchema
>;

// ── Gates (§6.2) ─────────────────────────────────────────────────────────────

export const OFFICIAL_REPORT_GATES = [
  /** #1 `round(pct/100 × N)` suma exactamente N en cada ítem. Rechazo duro. */
  'counts',
  /** #2 Cada `position` resuelve a un ítem del instrumento. Rechazo duro. */
  'items',
  /** #3 Eje derivado ≈ eje reportado. Rechazo duro; valida taxonomía + scoring + conteos. */
  'skill_axes',
  /** #4 Distribución de niveles derivada ≈ reportada. Advertencia. */
  'level_distribution',
  /** #5 Match difuso de alumnos. Advertencia + confirmación humana obligatoria. */
  'students',
] as const;
export type OfficialReportGate = (typeof OFFICIAL_REPORT_GATES)[number];

export type OfficialReportGateStatus = 'passed' | 'warning' | 'failed';

export type OfficialReportGateResult = {
  gate: OfficialReportGate;
  status: OfficialReportGateStatus;
  /** Si `true` y `status === 'failed'`, el confirm se rechaza. */
  blocking: boolean;
  message: string;
  details: string[];
};

// ── Response Models (API shape) ──────────────────────────────────────────────

export type OfficialReportItemPreview = {
  position: number;
  /** null si la posición no resuelve a un ítem del instrumento (gate #2). */
  itemId: string | null;
  studentCount: number;
  responseCount: number;
  correctCount: number;
  scoreSum: number;
  maxSum: number;
  answerCounts: AnswerCount[];
  /** Suma de los conteos reconstruidos. Debe ser exactamente `studentCount` (gate #1). */
  countsSum: number;
  countsMatchStudentCount: boolean;
};

export type OfficialReportAxisPreview = {
  name: string;
  nodeId: string | null;
  reportedPct: number;
  derivedPct: number | null;
  /** |derivado − reportado| en puntos porcentuales. */
  deltaPp: number | null;
  ok: boolean;
};

export type OfficialReportLevelPreview = {
  level: string;
  reportedPct: number;
  /** Derivado de `students[]`. null si el informe no los trae. */
  derivedPct: number | null;
  deltaPp: number | null;
  /** Banda del instrumento a la que resuelve el nivel. null = sin resolver. */
  performanceBandId: string | null;
  bandLabel: string | null;
};

export type OfficialReportStudentCandidate = {
  studentId: string;
  studentName: string;
  /** 0..1. */
  confidence: number;
};

export type OfficialReportStudentProposal = {
  reportIndex: number;
  listNumber: string | null;
  /** Nombre tal como lo leyó el OCR. */
  name: string;
  /** Nivel de la figura (Monitoreo/Cierre). null en Diagnóstico (no clasifica por nivel). */
  level: string | null;
  /** Propuesta del matcher. Requiere confirmación humana para escribirse. */
  proposedStudentId: string | null;
  proposedStudentName: string | null;
  confidence: number;
  /** Dos candidatos empatados → no se propone ninguno. */
  ambiguous: boolean;
  candidates: OfficialReportStudentCandidate[];
};

export type OfficialReportImportUploadResponse = {
  previewToken: string;
  sourceFile: string;
  totalItems: number;
  totalStudents: number;
  expiresAt: string;
};

export type OfficialReportImportPreviewResponse = {
  previewToken: string;
  instrumentId: string;
  instrumentName: string;
  classGroupId: string;
  classGroupName: string;
  report: OfficialReportSourceMeta;
  /** Resultado de los 5 gates. El preview NO persiste nada. */
  gates: OfficialReportGateResult[];
  /** false si algún gate bloqueante falló. */
  canConfirm: boolean;
  items: OfficialReportItemPreview[];
  skillAxes: OfficialReportAxisPreview[];
  levelDistribution: OfficialReportLevelPreview[];
  students: OfficialReportStudentProposal[];
  warnings: string[];
};

export type OfficialReportImportConfirmResponse = {
  jobId: string;
  assessmentId: string;
  status: ImportJobStatus;
  itemStatsWritten: number;
  skillStatsWritten: number;
  studentResultsWritten: number;
  /** Alumnos del informe que el humano no aprobó (o no cruzaron). Quedan fuera. */
  studentsSkipped: number;
  warnings: string[];
};
