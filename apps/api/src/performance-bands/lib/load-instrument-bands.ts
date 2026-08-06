// Carga las bandas de logro (performance_bands) de un instrumento para el
// scoring. Reutilizado por AssessmentResults y AnswerSheets (DRY). DEBE correr
// dentro de un `withOrgContext(...)` para que RLS devuelva las bandas globales
// (org_id NULL) más las de la org activa; sin contexto, RLS devuelve 0 filas.
//
// Precedencia: si la org tiene un override propio del set del instrumento
// (filas con org_id = org activa), esas ganan sobre el catálogo global. Si no,
// se usan las globales (org_id NULL, ej. cortes oficiales DIA).

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { performanceBands } from '@soe/db';
import type { PerformanceBandInput } from '@soe/types';
import type { Database } from '../../database/database.types';

type BandRow = {
  id: string;
  orgId: string | null;
  key: string;
  label: string;
  order: number;
  minThreshold: string;
  maxThreshold: string;
  color: string | null;
};

const BAND_COLUMNS = {
  id: performanceBands.id,
  orgId: performanceBands.orgId,
  key: performanceBands.key,
  label: performanceBands.label,
  order: performanceBands.order,
  minThreshold: performanceBands.minThreshold,
  maxThreshold: performanceBands.maxThreshold,
  color: performanceBands.color,
};

function toEffectiveBands(rows: BandRow[]): PerformanceBandInput[] {
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

export async function loadInstrumentBands(
  tx: Database,
  instrumentId: string,
): Promise<PerformanceBandInput[]> {
  const rows = await tx
    .select(BAND_COLUMNS)
    .from(performanceBands)
    .where(and(eq(performanceBands.instrumentId, instrumentId), isNull(performanceBands.deletedAt)))
    .orderBy(asc(performanceBands.order));

  if (rows.length === 0) return [];
  return toEffectiveBands(rows);
}

export async function loadBandsForInstruments(
  tx: Database,
  instrumentIds: readonly string[],
): Promise<Map<string, PerformanceBandInput[]>> {
  const byInstrument = new Map<string, PerformanceBandInput[]>();
  if (instrumentIds.length === 0) return byInstrument;

  const rows = await tx
    .select({ ...BAND_COLUMNS, instrumentId: performanceBands.instrumentId })
    .from(performanceBands)
    .where(
      and(
        inArray(performanceBands.instrumentId, [...instrumentIds]),
        isNull(performanceBands.deletedAt),
      ),
    )
    .orderBy(asc(performanceBands.order));

  const grouped = new Map<string, BandRow[]>();
  for (const row of rows) {
    if (row.instrumentId === null) continue;
    const bucket = grouped.get(row.instrumentId);
    if (bucket) bucket.push(row);
    else grouped.set(row.instrumentId, [row]);
  }

  for (const [instrumentId, group] of grouped) {
    byInstrument.set(instrumentId, toEffectiveBands(group));
  }
  return byInstrument;
}
