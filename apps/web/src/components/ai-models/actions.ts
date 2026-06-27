'use server';

import { revalidatePath } from 'next/cache';
import {
  llmFeatureSchema,
  updateLlmSettingSchema,
  type LlmSettingsResponse,
  type UpdateLlmSettingDto,
} from '@soe/types';
import { apiPatch } from '@/lib/api';

/**
 * Fija el proveedor + modelo GLOBAL de una funcionalidad de IA. Sólo platform_admin
 * (gate en el backend). Devuelve la config efectiva actualizada de todas las features.
 * Revalida ambos hogares del panel: el del área admin y el de configuración.
 */
export async function updateLlmModelAction(
  feature: string,
  input: UpdateLlmSettingDto,
): Promise<LlmSettingsResponse> {
  const parsedFeature = llmFeatureSchema.parse(feature);
  const validated = updateLlmSettingSchema.parse(input);
  const updated = await apiPatch<LlmSettingsResponse>(
    `/llm-settings/${parsedFeature}`,
    validated,
  );
  revalidatePath('/admin/modelos-ia');
  revalidatePath('/configuracion/modelos-ia');
  return updated;
}
