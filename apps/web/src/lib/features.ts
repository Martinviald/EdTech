import 'server-only';
import { apiGet } from './api';
import { FEATURE_KEYS, type FeatureKey, type OrgFeaturesResponse } from '@soe/types';

/**
 * Features pagas (H18.1) habilitadas para la org del usuario autenticado.
 * Consulta `GET /organizations/me/features`. Si la consulta falla (sin org,
 * error de red), NO bloquea: devuelve todas habilitadas, consistente con la
 * política de default del backend (`isFeatureAllowed`). El gating real lo
 * impone el backend con `FeatureGuard`; esto es sólo para decidir la UI.
 */
export async function getAllowedFeatures(): Promise<FeatureKey[]> {
  try {
    const res = await apiGet<OrgFeaturesResponse>('/organizations/me/features');
    return res.allowedFeatures;
  } catch {
    return [...FEATURE_KEYS];
  }
}

export async function isFeatureEnabled(feature: FeatureKey): Promise<boolean> {
  const allowed = await getAllowedFeatures();
  return allowed.includes(feature);
}
