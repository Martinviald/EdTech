import { z } from 'zod';
import { visionProviderSchema } from './reader.schema';

// Ajustes por organización (diseño §14.3). Defaults decididos:
// D3 → el interruptor "no enviar imágenes a terceros" viene APAGADO, es decir,
//      allowExternalVision = true.
// D7 → el dataset de evaluación es solo interno de la organización.

export const DATASET_CONSENT = ['none', 'org_internal', 'platform_eval'] as const;
export type DatasetConsent = (typeof DATASET_CONSENT)[number];

export const orgAnswerReadingSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowExternalVision: z.boolean().optional(),
    allowedProviders: z.array(visionProviderSchema).optional(),
    rubricAssistEnabled: z.boolean().optional(),
    datasetConsent: z.enum(DATASET_CONSENT).optional(),
    reviewAll: z.boolean().optional(),
    monthlyBudgetUsd: z.number().nonnegative().optional(),
  })
  .strict();
export type OrgAnswerReadingSettings = z.infer<typeof orgAnswerReadingSettingsSchema>;

export const DEFAULT_ORG_ANSWER_READING_SETTINGS: Required<
  Omit<OrgAnswerReadingSettings, 'allowedProviders' | 'monthlyBudgetUsd'>
> = {
  enabled: true,
  allowExternalVision: true,
  rubricAssistEnabled: false,
  datasetConsent: 'org_internal',
  reviewAll: false,
};
