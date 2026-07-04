import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Estímulo (Ola 2.1a) — concepto genérico del material sobre el que se ancla una
// pregunta remedial. Hoy: pasaje de lectura (texto oficial). Extensible a figura,
// tabla o dataset sin cambiar el modelo. Los estímulos viven en `instrument_sections`
// (store de estímulos) y se referencian ligero desde `remedial_materials.content.stimuli`.
// ─────────────────────────────────────────────────────────────────────────────

export const stimulusKindSchema = z.enum(['passage', 'figure', 'table', 'dataset']);
export type StimulusKind = z.infer<typeof stimulusKindSchema>;

export const stimulusSourceSchema = z.enum(['official', 'ai_generated']);
export type StimulusSource = z.infer<typeof stimulusSourceSchema>;

/** Ref ligera al estímulo (vive en `remedial_materials.content.stimuli`). */
export const remedialStimulusRefSchema = z.object({
  sectionId: z.string().uuid(),
  kind: stimulusKindSchema,
  source: stimulusSourceSchema,
  title: z.string().nullable(),
  textPreview: z.string().nullable(),
});
export type RemedialStimulusRef = z.infer<typeof remedialStimulusRefSchema>;

/** Estímulo hidratado on-read (para la respuesta; incluye el texto completo del pasaje). */
export const remedialStimulusSchema = z.object({
  sectionId: z.string().uuid(),
  kind: stimulusKindSchema,
  source: stimulusSourceSchema,
  title: z.string().nullable(),
  text: z.string().nullable(),
});
export type RemedialStimulus = z.infer<typeof remedialStimulusSchema>;
