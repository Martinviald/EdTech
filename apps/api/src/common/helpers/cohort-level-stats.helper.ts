/**
 * Lectura del read-model de distribución por nivel (`assessment_level_stats`).
 *
 * Hermano de `cohort-item-stats.helper.ts` / `cohort-skill-stats.helper.ts`. Un
 * informe oficial cargado en modo `aggregate_only` no tiene filas por alumno, así
 * que la "distribución por nivel de desempeño" (torta I/II/III) y el conteo
 * "requiere apoyo" no salen de `assessment_results`. Sí salen de este read-model,
 * que el importador escribe con `source='imported'` desde el Gráfico 1 del informe.
 *
 * ── Grano y recombinación ────────────────────────────────────────────────────────
 * El grano es `(assessment_id, class_group_id, performance_band_id)` con CONTEOS
 * enteros de alumnos. Recombinar cursos es una SUMA exacta (cada alumno cuenta una
 * vez, en un único curso y banda), por eso se agrega con `sum(student_count)`.
 *
 * Debe correr dentro de `withOrgContext` (el `tx` de la transacción):
 * `assessment_level_stats` tiene FORCE RLS vía `EXISTS` sobre `assessments`.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { assessmentLevelStats } from '@soe/db';
import {
  bandToLegacyLevel,
  type PerformanceBandDistributionBucket,
  type PerformanceBandInput,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
} from '@soe/types';
import type { Database } from '../../database/database.types';

// Orden legacy de 4 niveles (igual que dashboards/assessment-report).
const LEGACY_LEVEL_ORDER: readonly PerformanceLevel[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

/** Conteo de alumnos por banda, sumado sobre los cursos del scope. */
export type CohortLevelCount = {
  performanceBandId: string;
  count: number;
};

/**
 * Lee los conteos por banda para una evaluación, opcionalmente acotado a cursos.
 * `classGroupFilter === null` = todos los cursos (scopeAll); `[]` = ningún curso
 * accesible → `[]`.
 *
 * Devuelve solo conteos por `performanceBandId`; la metadata de banda (key/label/
 * order/color) la aporta el caller con las bandas del instrumento ya cargadas
 * (`loadInstrumentBands`), única fuente de verdad de esa metadata.
 */
export async function loadCohortLevelCounts(
  db: Database,
  assessmentId: string,
  classGroupFilter: string[] | null,
): Promise<CohortLevelCount[]> {
  if (classGroupFilter !== null && classGroupFilter.length === 0) return [];

  const conditions = [eq(assessmentLevelStats.assessmentId, assessmentId)];
  if (classGroupFilter !== null) {
    conditions.push(inArray(assessmentLevelStats.classGroupId, classGroupFilter));
  }

  const rows = await db
    .select({
      performanceBandId: assessmentLevelStats.performanceBandId,
      count: sql<number>`sum(${assessmentLevelStats.studentCount})::int`,
    })
    .from(assessmentLevelStats)
    .where(and(...conditions))
    .groupBy(assessmentLevelStats.performanceBandId);

  return rows.map((r) => ({
    performanceBandId: r.performanceBandId,
    count: Number(r.count),
  }));
}

/**
 * Distribución por banda del instrumento (N niveles data-driven, ej. DIA I/II/III).
 * Itera TODAS las bandas del instrumento —incluidas las de conteo 0— para una torta
 * estable, igual que `AssessmentReportService.buildBandDistribution`.
 */
export function levelCountsToBandDistribution(
  counts: readonly CohortLevelCount[],
  bands: readonly PerformanceBandInput[],
): PerformanceBandDistributionBucket[] {
  const byBand = new Map(counts.map((c) => [c.performanceBandId, c.count]));
  const total = counts.reduce((acc, c) => acc + c.count, 0);
  return [...bands]
    .sort((a, b) => a.order - b.order)
    .map((b) => {
      const count = byBand.get(b.id) ?? 0;
      return {
        key: b.key,
        label: b.label,
        order: b.order,
        color: b.color ?? null,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      };
    });
}

/**
 * Distribución en los 4 niveles legacy, mapeando cada banda a su nivel con
 * `bandToLegacyLevel` (posición relativa del `order` dentro del set completo de
 * bandas). Para DIA (3 bandas) I→insuficiente, II→adecuado, III→avanzado.
 */
export function levelCountsToLegacyDistribution(
  counts: readonly CohortLevelCount[],
  bands: readonly PerformanceBandInput[],
): PerformanceDistributionBucket[] {
  const byBandId = new Map(bands.map((b) => [b.id, b]));
  const byLevel = new Map<PerformanceLevel, number>();
  let total = 0;
  for (const c of counts) {
    const band = byBandId.get(c.performanceBandId);
    if (!band) continue;
    const level = bandToLegacyLevel(band, bands);
    byLevel.set(level, (byLevel.get(level) ?? 0) + c.count);
    total += c.count;
  }
  return LEGACY_LEVEL_ORDER.map((level) => {
    const count = byLevel.get(level) ?? 0;
    return { level, count, percentage: total > 0 ? (count / total) * 100 : 0 };
  });
}
