import { z } from 'zod';

/**
 * Motor de decisiones (`@soe/decisions`) — tipos compartidos FE/BE/BD.
 *
 * Un motor de decisiones (hoy Jev, de TypeSafe AI) evalúa un estado contra
 * preguntas tipadas (Noul / Choice / Score) y devuelve respuestas con
 * probabilidades y confianza calibrada. Este archivo fija lo que se PERSISTE y
 * se configura: funcionalidades, modos, umbrales de enrutamiento y la forma de
 * las respuestas guardadas en `decision_calls.answers`. Contrato completo en
 * `docs/plan-integracion-jev.md`.
 */

// ── Funcionalidades ──────────────────────────────────────────────────────────
// Cada funcionalidad es un punto de llamada al motor. Se amplía agregando valores.
export const DECISION_FEATURES = ['remedial_judge'] as const;
export type DecisionFeature = (typeof DECISION_FEATURES)[number];
export const decisionFeatureSchema = z.enum(DECISION_FEATURES);

// ── Modos ────────────────────────────────────────────────────────────────────
// `off`: no corre. `shadow`: corre y registra, pero no decide. `live`: decide.
export const DECISION_MODES = ['off', 'shadow', 'live'] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];
export const decisionModeSchema = z.enum(DECISION_MODES);

// ── Motores ──────────────────────────────────────────────────────────────────
export const decisionEngineIdSchema = z.enum(['jev']);
export type DecisionEngineId = z.infer<typeof decisionEngineIdSchema>;

// ── Umbrales de enrutamiento ─────────────────────────────────────────────────
// Umbrales por id de pregunta. Choice/Score usan { auto, review }; Noul usa { yes, no }.
const probabilitySchema = z.number().min(0).max(1);

/** Choice/Score: `>= auto` decide solo; `>= review` pasa a revisión; si no, se rechaza. */
export const confidenceThresholdsSchema = z
  .object({ auto: probabilitySchema, review: probabilitySchema })
  .strict()
  .refine((t) => t.review <= t.auto, {
    message: 'El umbral de revisión no puede ser mayor que el umbral automático',
    path: ['review'],
  });
export type ConfidenceThresholds = z.infer<typeof confidenceThresholdsSchema>;

/** Noul: `>= yes` es sí; `<= no` es no; entre ambos queda incierto. */
export const noulThresholdsSchema = z
  .object({ yes: probabilitySchema, no: probabilitySchema })
  .strict()
  .refine((t) => t.no < t.yes, {
    message: 'El umbral de "no" debe ser estrictamente menor que el umbral de "sí"',
    path: ['no'],
  });
export type NoulThresholds = z.infer<typeof noulThresholdsSchema>;

export const decisionThresholdsSchema = z.record(
  z.string(),
  z.union([confidenceThresholdsSchema, noulThresholdsSchema]),
);
export type DecisionThresholds = z.infer<typeof decisionThresholdsSchema>;

// ── Respuesta persistida ─────────────────────────────────────────────────────
// Respuesta tal como se PERSISTE en decision_calls.answers (forma no genérica).
export const decisionAnswerRecordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), probability: z.number() }).strict(),
  z
    .object({
      type: z.literal('choice'),
      choice: z.string(),
      probabilities: z.record(z.string(), z.number()),
      confidence: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('score'),
      score: z.number(),
      level: z.number().int(),
      probabilities: z.array(z.number()),
      confidence: z.number(),
    })
    .strict(),
]);
export type DecisionAnswerRecord = z.infer<typeof decisionAnswerRecordSchema>;

// ── Defaults de código (fallback cuando no hay fila en decision_settings) ────
export interface DecisionFeatureDefault {
  engine: DecisionEngineId;
  /** Versión fijada (no el alias `jev-latest`): los umbrales se calibran contra ella. */
  model: string;
  mode: DecisionMode;
  thresholds: DecisionThresholds;
}

/** Default `off`: activar una funcionalidad es una decisión explícita de configuración. */
export const DECISION_FEATURE_DEFAULTS: Record<DecisionFeature, DecisionFeatureDefault> = {
  remedial_judge: { engine: 'jev', model: 'jev-1.13.0', mode: 'off', thresholds: {} },
};
