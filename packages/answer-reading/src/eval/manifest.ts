import { readingStateSchema, responseFormatSchema, scoringConfigSchema } from '@soe/types';
import { z } from 'zod';

// Dataset etiquetado del arnés de evaluación offline (diseño §12). Un directorio
// con `manifest.json` y las imágenes que referencia. Sin datos personales: solo
// el recorte, el formato, la etiqueta y contexto del ítem.

export const EVAL_MANIFEST_VERSION = 1;

export const evalLabelSchema = z
  .object({
    state: readingStateSchema,
    literal: z.string(),
    /** Clave canónica esperada; si falta se calcula con el normalizador del formato. */
    canonical: z.string().nullable().optional(),
  })
  .strict();
export type EvalLabel = z.infer<typeof evalLabelSchema>;

export const evalSampleSchema = z
  .object({
    id: z.string().min(1),
    image: z.string().min(1),
    format: responseFormatSchema,
    label: evalLabelSchema,
    acceptedAnswers: z.array(z.string().min(1)).min(1).optional(),
    scoringConfig: scoringConfigSchema.optional(),
    gradeName: z.string().min(1).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type EvalSample = z.infer<typeof evalSampleSchema>;

export const evalManifestSchema = z
  .object({
    manifestVersion: z.literal(EVAL_MANIFEST_VERSION),
    name: z.string().min(1),
    datasetVersion: z.string().min(1),
    description: z.string().optional(),
    samples: z.array(evalSampleSchema).min(1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.samples.forEach((sample, index) => {
      if (seen.has(sample.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['samples', index, 'id'],
          message: `Id de muestra repetido: ${sample.id}`,
        });
      }
      seen.add(sample.id);
      const hasLiteral = sample.label.literal.trim().length > 0;
      if (sample.label.state === 'answered' && !hasLiteral) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['samples', index, 'label', 'literal'],
          message: 'Una muestra respondida necesita el literal',
        });
      }
      if (sample.label.state === 'blank' && hasLiteral) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['samples', index, 'label', 'literal'],
          message: 'Una muestra en blanco no lleva literal',
        });
      }
      if (sample.image.startsWith('/') || sample.image.split(/[\\/]/).includes('..')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['samples', index, 'image'],
          message: 'La imagen debe ser una ruta relativa dentro del dataset',
        });
      }
    });
  });
export type EvalManifest = z.infer<typeof evalManifestSchema>;

/** Valida un manifest y devuelve los errores en texto legible. */
export function parseEvalManifest(
  raw: unknown,
): { ok: true; manifest: EvalManifest } | { ok: false; errors: string[] } {
  const parsed = evalManifestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`,
    ),
  };
}
