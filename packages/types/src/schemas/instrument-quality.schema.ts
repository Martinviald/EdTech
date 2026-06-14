import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// F2 S2 — H20.9: Calidad de instrumento e ítems (DETERMINISTA, sin IA).
// Módulo backend: apps/api/src/instrument-quality/ (ruta base /api/instrument-quality)
//
// Distingue una BRECHA DE APRENDIZAJE de un DEFECTO DE INSTRUMENTO (capa 3 de la
// metodología §3 de la planificación F2). Toda la psicometría se computa en
// backend (reusa AssessmentReportService para p/D/distractores + las funciones
// puras kr20()/pointBiserial() de ai-analysis.metrics.ts). Las sugerencias de
// corrección son DETERMINISTAS por flag (reglas/plantillas), no generadas por IA.
//
// Multi-tenancy: org_id SIEMPRE del token; scoping por curso para profesores lo
// aplica el service (igual que ItemAnalysisService / AssessmentReportService).
// Unidades: difficulty (p) en 0..100 (% de aciertos, igual que AssessmentReport);
// discrimination (D) y pointBiserial en [-1, 1].
// ─────────────────────────────────────────────────────────────────────────────

/** Filtro del análisis de calidad: una evaluación concreta. */
export const instrumentQualityQuerySchema = z.object({
  assessmentId: z.string().uuid(),
  classGroupId: z.string().uuid().optional(), // acota la cohorte a un curso
});
export type InstrumentQualityQueryDto = z.infer<typeof instrumentQualityQuerySchema>;

/**
 * Banderas de calidad de un ítem (deterministas). Cada una deriva una sugerencia.
 * Umbrales de referencia (ajustables en el service, documentar en el código):
 *  - low_discrimination: D < 0.20
 *  - ambiguous_key: point-biserial < 0.10 o negativo (la clave no discrimina / posible clave errónea)
 *  - strong_distractor: un distractor lo eligen ≥ que la clave, o > 35% del total
 *  - too_easy: p > 90% (no discrimina por techo)
 *  - misaligned: ítem sin tags de taxonomía (no alineado al blueprint)
 */
export const itemQualityFlagSchema = z.enum([
  'low_discrimination',
  'ambiguous_key',
  'strong_distractor',
  'too_easy',
  'misaligned',
]);
export type ItemQualityFlag = z.infer<typeof itemQualityFlagSchema>;

/** Calidad psicométrica de un ítem con sus banderas y sugerencias deterministas. */
export const itemQualityModelSchema = z.object({
  itemId: z.string().uuid(),
  position: z.number().int(),
  skillName: z.string().nullable(),
  contentName: z.string().nullable(),
  correctKey: z.string().nullable(),
  difficulty: z.number().nullable(), // p, 0..100
  discrimination: z.number().nullable(), // D, [-1, 1]
  pointBiserial: z.number().nullable(), // [-1, 1]
  dominantDistractor: z.string().nullable(),
  dominantDistractorRate: z.number().nullable(), // 0..100
  flags: z.array(itemQualityFlagSchema),
  suggestions: z.array(z.string()), // deterministas por flag (sin IA)
});
export type ItemQualityModel = z.infer<typeof itemQualityModelSchema>;

/** Confiabilidad del instrumento (KR-20 + interpretación determinista por rangos). */
export const instrumentReliabilityModelSchema = z.object({
  kr20: z.number().nullable(),
  interpretation: z.string(), // determinista: excelente/buena/aceptable/cuestionable/pobre/no calculable
  itemsAnalyzed: z.number().int(),
  studentsAnalyzed: z.number().int(),
});
export type InstrumentReliabilityModel = z.infer<typeof instrumentReliabilityModelSchema>;

/** Respuesta del análisis de calidad de un instrumento/evaluación. */
export const instrumentQualityResponseSchema = z.object({
  assessmentId: z.string().uuid(),
  assessmentName: z.string().nullable(),
  instrumentId: z.string().uuid(),
  instrumentName: z.string(),
  reliability: instrumentReliabilityModelSchema,
  items: z.array(itemQualityModelSchema),
  flaggedCount: z.number().int(), // nº de ítems con ≥1 flag
});
export type InstrumentQualityResponse = z.infer<typeof instrumentQualityResponseSchema>;
