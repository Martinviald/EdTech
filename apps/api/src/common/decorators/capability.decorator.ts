import { SetMetadata } from '@nestjs/common';
import type { AnalyticsCapability } from '@soe/types';

export const CAPABILITY_KEY = 'requiredCapability';

/**
 * Marca una ruta como dependiente de una capacidad de analítica, es decir, de la
 * granularidad del dato de la evaluación (`assessments.data_granularity`).
 *
 * Verificada por `CapabilityGuard`. Solo aplica a rutas donde el `assessmentId` es
 * resoluble desde el path o el query. Donde es opcional (ej. `/item-analysis/questions/:itemId`,
 * que agrega across assessments), la decisión va en el service: ahí mezclar
 * granularidades es legítimo porque el read-model es homogéneo.
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md §4.
 */
export const RequireCapability = (capability: AnalyticsCapability) =>
  SetMetadata(CAPABILITY_KEY, capability);
