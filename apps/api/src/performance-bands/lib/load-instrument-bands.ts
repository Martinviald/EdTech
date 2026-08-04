// Carga las bandas de logro (performance_bands) de un instrumento para el
// scoring. Reutilizado por AssessmentResults y AnswerSheets (DRY). DEBE correr
// dentro de un `withOrgContext(...)` para que RLS devuelva las bandas globales
// (org_id NULL) más las de la org activa; sin contexto, RLS devuelve 0 filas.
//
// Precedencia: si la org tiene un override propio del set del instrumento
// (filas con org_id = org activa), esas ganan sobre el catálogo global. Si no,
// se usan las globales (org_id NULL, ej. cortes oficiales DIA).

import { and, asc, eq, isNull } from 'drizzle-orm';
import { performanceBands } from '@soe/db';
import type { PerformanceBandInput } from '@soe/types';
import type { Database } from '../../database/database.types';

export async function loadInstrumentBands(
  tx: Database,
  instrumentId: string,
): Promise<PerformanceBandInput[]> {
  const rows = await tx
    .select({
      id: performanceBands.id,
      orgId: performanceBands.orgId,
      key: performanceBands.key,
      label: performanceBands.label,
      order: performanceBands.order,
      minThreshold: performanceBands.minThreshold,
      maxThreshold: performanceBands.maxThreshold,
      color: performanceBands.color,
    })
    .from(performanceBands)
    .where(
      and(eq(performanceBands.instrumentId, instrumentId), isNull(performanceBands.deletedAt)),
    )
    .orderBy(asc(performanceBands.order));

  if (rows.length === 0) return [];

  // Override por org sobre global: si hay filas de la org (org_id no NULL, que
  // bajo RLS sólo puede ser la org activa), usar sólo esas; si no, las globales.
  const orgRows = rows.filter((r) => r.orgId !== null);
  const effective = orgRows.length > 0 ? orgRows : rows.filter((r) => r.orgId === null);

  return effective.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    order: r.order,
    minThreshold: Number(r.minThreshold),
    maxThreshold: Number(r.maxThreshold),
    color: r.color,
  }));
}
