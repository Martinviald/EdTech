import 'server-only';
import type { AnalyticsCapability, AssessmentReportResponse } from '@soe/types';
import { apiGet } from './api';

/**
 * ¿Esta evaluación soporta esta capacidad de analítica?
 *
 * Lee `meta.capabilities` de `/analytics/assessment-report`, el mismo payload que
 * ya carga el layout del hub (`evaluaciones/[assessmentId]/layout.tsx`), así que
 * en la práctica no agrega un round-trip: React memoiza el `fetch` GET dentro del
 * mismo render. Las capacidades vienen servidas por el backend; la web no las
 * deriva de `dataGranularity` ni de `instrumentType`.
 *
 * **Falla en abierto** (`true` si el informe no carga): la barrera real es el
 * `CapabilityGuard` del backend, que responde 409 con el motivo. Este chequeo solo
 * existe para no gatillar un fetch condenado y para explicar antes de pedirlo. Si
 * cerrara por un error de red, escondería una superficie que sí funciona.
 */
export async function assessmentSupports(
  assessmentId: string,
  capability: AnalyticsCapability,
): Promise<boolean> {
  const report = await apiGet<AssessmentReportResponse>(
    `/analytics/assessment-report?assessmentId=${assessmentId}`,
  ).catch((): null => null);
  if (!report) return true;
  return report.meta.capabilities.includes(capability);
}
