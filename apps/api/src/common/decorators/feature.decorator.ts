import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@soe/types';

export const FEATURE_KEY = 'requiredFeature';

/**
 * Marca una ruta (o controller) como gobernada por una feature paga de F2.
 * Verificada por `FeatureGuard`: el acceso depende de que la org del usuario
 * tenga la feature habilitada en `organizations.config.allowedFeatures`.
 * F1 (ingesta + dashboards) NO usa este decorador — es siempre gratis.
 */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);
