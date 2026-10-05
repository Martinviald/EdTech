/**
 * Refresh del read-model de benchmarking (`benchmark_aggregates`, F2 S4 — H7.1).
 *
 * Vive en `packages/db/queries` y no en `apps/api` por la misma razón que
 * `cohort-stats`: tiene consumidores que no comparten proceso. La API lo expone en
 * `POST /api/benchmarking/refresh` y el CLI `src/scripts/refresh-benchmark-aggregates.ts`
 * lo corre en el deploy de backend y en el job programado. Antes sólo existía el
 * endpoint y nadie lo llamaba: el read-model se quedaba con lo que dejó el seed y los
 * colegios con resultados reales veían "Aún no hay instrumentos para comparar".
 *
 * Estrategia anti-leak (CLAUDE.md §5.2): la FUENTE (`assessment_results`,
 * `skill_results` — bajo RLS) se lee SIEMPRE dentro de `withOrgContext(orgId)`, org
 * por org. El destino (`benchmark_aggregates`, SIN RLS) se escribe cross-tenant con
 * `db`. El read-model nunca contiene PII: sólo agregados por (org × instrumento ×
 * nivel × asignatura).
 *
 * Es upsert puro: nunca borra filas. Los fixtures de `seed/benchmark-demo.ts` se
 * insertan directo en el read-model sin resultados detrás, y un refresh que borrara
 * lo que no recalcula los haría desaparecer.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  bandToLegacyLevel,
  classifyByBands,
  percentageToPerformanceLevel,
  type BenchmarkBandCount,
  type BenchmarkBandDistribution,
  type BenchmarkSkillAggregate,
  type PerformanceBandInput,
  type PerformanceLevel,
} from '@soe/types';
import type { Database } from '../client';
import { assessments } from '../schema/assessments';
import {
  benchmarkAggregates,
  benchmarkItemAggregates,
  orgBenchmarkSettings,
} from '../schema/benchmark';
import { gradingScales, instruments } from '../schema/instruments';
import { organizations } from '../schema/organizations';
import { assessmentItemStats, assessmentResults, skillResults } from '../schema/results';
import { taxonomyNodes } from '../schema/taxonomy';
import { withOrgContext } from '../with-org-context';
import { resolveEffectiveBandsForInstruments, type EffectiveBands } from './effective-bands';

export type BenchmarkRefreshSummary = {
  refreshedOrgs: number;
  refreshedRows: number;
  refreshedItemRows: number;
};

/** Postgres topa en 65535 parámetros por statement; una fila por ítem usa ~10. */
const ITEM_UPSERT_CHUNK = 500;

export type RefreshBenchmarkAggregatesOptions = {
  /** Sólo esta org. Sin él, recorre todos los colegios no eliminados. */
  orgId?: string;
};

/** Fila agregada de una org para el read-model (sin PII). */
type OrgAggregateRow = {
  instrumentId: string;
  gradeId: string | null;
  subjectId: string | null;
  studentCount: number;
  avgAchievement: string | null;
  bandDistribution: BenchmarkBandDistribution;
  bandCounts: BenchmarkBandCount[];
  perSkill: BenchmarkSkillAggregate[];
};

/** Acumulador en memoria por instrumento durante el agregado de una org. */
type InstrumentAccumulator = {
  gradeId: string | null;
  subjectId: string | null;
  students: Set<string>;
  pctSum: number;
  pctCount: number;
  bandDistribution: BenchmarkBandDistribution;
  bandCounts: Map<string, BenchmarkBandCount>;
};

/**
 * Clasificador de bandas de un instrumento pre-indexado UNA vez: guarda las bandas
 * y el nivel legacy ya resuelto por banda, para clasificar cada `percentage` en
 * O(bandas) sin recalcular la proyección por fila. Sin bandas efectivas
 * (`source: 'none'`) queda `bands` vacío y se cae a `percentageToPerformanceLevel`.
 */
type BandClassifier = {
  bands: PerformanceBandInput[];
  bandById: Map<string, PerformanceBandInput>;
  legacyByBandId: Map<string, PerformanceLevel>;
};

/**
 * Reconstruye el read-model: para cada colegio agrega su fuente bajo
 * `withOrgContext` y hace upsert por (orgId, instrumentId, gradeId, subjectId).
 * Snapshotea `optOutGlobalPool` y las dimensiones de cohorte
 * (`dependence/region/commune/networkOrgId = organizations.parent_id`).
 * Idempotente: correrlo dos veces deja el mismo estado.
 */
export async function refreshBenchmarkAggregates(
  db: Database,
  options: RefreshBenchmarkAggregatesOptions = {},
): Promise<BenchmarkRefreshSummary> {
  const conditions = [eq(organizations.type, 'school'), isNull(organizations.deletedAt)];
  if (options.orgId) conditions.push(eq(organizations.id, options.orgId));

  // `organizations` no tiene RLS → query directa. Sólo colegios.
  const orgs = await db
    .select({
      id: organizations.id,
      parentId: organizations.parentId,
      dependence: organizations.dependence,
      region: organizations.region,
      commune: organizations.commune,
    })
    .from(organizations)
    .where(and(...conditions));

  let refreshedOrgs = 0;
  let refreshedRows = 0;
  const optOutByOrg = new Map<string, boolean>();

  for (const org of orgs) {
    const networkOrgId = await deriveNetworkOrgId(db, org.parentId);
    const optOutGlobalPool = await readOptOut(db, org.id);
    optOutByOrg.set(org.id, optOutGlobalPool);
    const rows = await buildOrgRows(db, org.id);

    if (rows.length === 0) continue;

    const now = new Date();
    for (const row of rows) {
      const value = {
        orgId: org.id,
        instrumentId: row.instrumentId,
        gradeId: row.gradeId,
        subjectId: row.subjectId,
        dependence: org.dependence,
        region: org.region,
        commune: org.commune,
        networkOrgId,
        studentCount: row.studentCount,
        avgAchievement: row.avgAchievement,
        bandDistribution: row.bandDistribution,
        bandCounts: row.bandCounts,
        perSkill: row.perSkill,
        optOutGlobalPool,
        refreshedAt: now,
        updatedAt: now,
      };
      // Upsert en el read-model (sin contexto: la tabla NO tiene RLS).
      await db
        .insert(benchmarkAggregates)
        .values(value)
        .onConflictDoUpdate({
          target: [
            benchmarkAggregates.orgId,
            benchmarkAggregates.instrumentId,
            benchmarkAggregates.gradeId,
            benchmarkAggregates.subjectId,
          ],
          set: {
            dependence: value.dependence,
            region: value.region,
            commune: value.commune,
            networkOrgId: value.networkOrgId,
            studentCount: value.studentCount,
            avgAchievement: value.avgAchievement,
            bandDistribution: value.bandDistribution,
            bandCounts: value.bandCounts,
            perSkill: value.perSkill,
            optOutGlobalPool: value.optOutGlobalPool,
            refreshedAt: value.refreshedAt,
            updatedAt: value.updatedAt,
          },
        });
    }

    refreshedOrgs += 1;
    refreshedRows += rows.length;
  }

  let refreshedItemRows = 0;
  for (const [orgId, optOutGlobalPool] of optOutByOrg) {
    refreshedItemRows += await refreshOrgItemAggregates(db, orgId, optOutGlobalPool);
  }

  return { refreshedOrgs, refreshedRows, refreshedItemRows };
}

/**
 * Aciertos y respuestas por (org × ítem) desde `assessment_item_stats` (RLS → bajo
 * `withOrgContext`), upsert en `benchmark_item_aggregates` (sin RLS) por lotes.
 */
async function refreshOrgItemAggregates(
  db: Database,
  orgId: string,
  optOutGlobalPool: boolean,
): Promise<number> {
  const rows = await withOrgContext(db, orgId, async (tx) =>
    tx
      .select({
        instrumentId: assessments.instrumentId,
        itemId: assessmentItemStats.itemId,
        correctCount: sql<number>`sum(${assessmentItemStats.correctCount})::int`,
        responseCount: sql<number>`sum(${assessmentItemStats.responseCount})::int`,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessmentItemStats.assessmentId, assessments.id))
      .where(eq(assessments.orgId, orgId))
      .groupBy(assessments.instrumentId, assessmentItemStats.itemId),
  );
  if (rows.length === 0) return 0;

  const now = new Date();
  for (let i = 0; i < rows.length; i += ITEM_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + ITEM_UPSERT_CHUNK).map((row) => ({
      orgId,
      instrumentId: row.instrumentId,
      itemId: row.itemId,
      correctCount: Number(row.correctCount),
      responseCount: Number(row.responseCount),
      optOutGlobalPool,
      refreshedAt: now,
      updatedAt: now,
    }));
    await db
      .insert(benchmarkItemAggregates)
      .values(chunk)
      .onConflictDoUpdate({
        target: [benchmarkItemAggregates.orgId, benchmarkItemAggregates.itemId],
        set: {
          instrumentId: sql`excluded.instrument_id`,
          correctCount: sql`excluded.correct_count`,
          responseCount: sql`excluded.response_count`,
          optOutGlobalPool: sql`excluded.opt_out_global_pool`,
          refreshedAt: sql`excluded.refreshed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return rows.length;
}

/**
 * Agrega `assessment_results` + `skill_results` de la org bajo `withOrgContext`.
 * Agrupa por instrumento; gradeId/subjectId vienen del instrumento.
 *
 * La distribución por banda NO sale de la columna legacy `performanceLevel`: se
 * clasifica el `percentage` de cada resultado con las bandas EFECTIVAS del
 * instrumento (propias → versión anterior de su familia, ver `effective-bands`) y se
 * proyecta al enum de 4 niveles con `bandToLegacyLevel`. Sin bandas efectivas se cae
 * al corte legacy vía `percentageToPerformanceLevel`. Las filas band-only (informe
 * oficial: `percentage` NULL, `performanceLevel` ya persistido) se cuentan por su
 * nivel persistido.
 *
 * `bandCounts` cuenta por la banda PROPIA del instrumento (clave/etiqueta/orden), sin
 * proyectar: es lo que se pone al lado de las vistas de resultados. Las filas band-only
 * cuentan por su `performance_band_id` persistido; sin banda (o sin bandas efectivas)
 * no suman.
 */
async function buildOrgRows(db: Database, orgId: string): Promise<OrgAggregateRow[]> {
  return withOrgContext(db, orgId, async (tx) => {
    const resultRows = await tx
      .select({
        instrumentId: instruments.id,
        gradeId: instruments.gradeId,
        subjectId: instruments.subjectId,
        gradingScaleConfig: gradingScales.config,
        studentId: assessmentResults.studentId,
        percentage: assessmentResults.percentage,
        performanceLevel: assessmentResults.performanceLevel,
        performanceBandId: assessmentResults.performanceBandId,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessmentResults.assessmentId, assessments.id))
      .innerJoin(instruments, eq(assessments.instrumentId, instruments.id))
      .leftJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(eq(assessments.orgId, orgId));

    if (resultRows.length === 0) return [];

    const instrumentIds = Array.from(new Set(resultRows.map((r) => r.instrumentId)));
    const effectiveBands = await resolveEffectiveBandsForInstruments(tx, instrumentIds);
    const bandClassifiers = new Map<string, BandClassifier>();
    for (const [instrumentId, effective] of effectiveBands) {
      bandClassifiers.set(instrumentId, buildBandClassifier(effective));
    }

    const accByInstrument = new Map<string, InstrumentAccumulator>();
    for (const row of resultRows) {
      let acc = accByInstrument.get(row.instrumentId);
      if (!acc) {
        acc = {
          gradeId: row.gradeId,
          subjectId: row.subjectId,
          students: new Set<string>(),
          pctSum: 0,
          pctCount: 0,
          bandDistribution: { insufficient: 0, elementary: 0, adequate: 0, advanced: 0 },
          bandCounts: new Map<string, BenchmarkBandCount>(),
        };
        accByInstrument.set(row.instrumentId, acc);
      }
      acc.students.add(row.studentId);
      const pct = row.percentage === null ? null : Number(row.percentage);
      if (pct !== null) {
        acc.pctSum += pct;
        acc.pctCount += 1;
      }
      const classifier = bandClassifiers.get(row.instrumentId);
      const level = classifyResultLevel(
        pct,
        row.performanceLevel,
        classifier,
        row.gradingScaleConfig,
      );
      if (level !== null) acc.bandDistribution[level] += 1;
      const band = classifyResultBand(pct, row.performanceBandId ?? null, classifier);
      if (band) countBand(acc.bandCounts, band);
    }

    const perSkillRows = await tx
      .select({
        instrumentId: instruments.id,
        nodeId: skillResults.nodeId,
        nodeName: taxonomyNodes.name,
        achievement: sql<string | null>`round(avg(${skillResults.percentage}), 2)`,
        studentCount: sql<number>`count(distinct ${skillResults.studentId})::int`,
      })
      .from(skillResults)
      .innerJoin(assessments, eq(skillResults.assessmentId, assessments.id))
      .innerJoin(instruments, eq(assessments.instrumentId, instruments.id))
      .innerJoin(taxonomyNodes, eq(skillResults.nodeId, taxonomyNodes.id))
      .where(eq(assessments.orgId, orgId))
      .groupBy(instruments.id, skillResults.nodeId, taxonomyNodes.name);

    const perSkillByInstrument = new Map<string, BenchmarkSkillAggregate[]>();
    for (const row of perSkillRows) {
      const list = perSkillByInstrument.get(row.instrumentId) ?? [];
      list.push({
        nodeId: row.nodeId,
        nodeName: row.nodeName,
        achievement: row.achievement === null ? null : Number(row.achievement),
        studentCount: row.studentCount,
      });
      perSkillByInstrument.set(row.instrumentId, list);
    }

    const rows: OrgAggregateRow[] = [];
    for (const [instrumentId, acc] of accByInstrument) {
      rows.push({
        instrumentId,
        gradeId: acc.gradeId,
        subjectId: acc.subjectId,
        studentCount: acc.students.size,
        avgAchievement: acc.pctCount === 0 ? null : (acc.pctSum / acc.pctCount).toFixed(2),
        bandDistribution: acc.bandDistribution,
        bandCounts: Array.from(acc.bandCounts.values()).sort((a, b) => a.order - b.order),
        perSkill: perSkillByInstrument.get(instrumentId) ?? [],
      });
    }
    return rows;
  });
}

/**
 * `optOutGlobalPool` de `org_benchmark_settings` (RLS → withOrgContext). Sin fila,
 * default opt-in (false).
 */
async function readOptOut(db: Database, orgId: string): Promise<boolean> {
  return withOrgContext(db, orgId, async (tx) => {
    const [row] = await tx
      .select({ optOut: orgBenchmarkSettings.optOutGlobalPool })
      .from(orgBenchmarkSettings)
      .where(eq(orgBenchmarkSettings.orgId, orgId))
      .limit(1);
    return row?.optOut ?? false;
  });
}

/**
 * Red/sostenedor: `networkOrgId = parentId` sólo si el padre es una `foundation`.
 * `organizations` NO tiene RLS → query directa.
 */
async function deriveNetworkOrgId(db: Database, parentId: string | null): Promise<string | null> {
  if (!parentId) return null;
  const [parent] = await db
    .select({ id: organizations.id, type: organizations.type })
    .from(organizations)
    .where(eq(organizations.id, parentId))
    .limit(1);
  return parent && parent.type === 'foundation' ? parent.id : null;
}

function buildBandClassifier(effective: EffectiveBands): BandClassifier {
  const bands = effective.bands;
  const legacyByBandId = new Map<string, PerformanceLevel>();
  const bandById = new Map<string, PerformanceBandInput>();
  for (const band of bands) {
    legacyByBandId.set(band.id, bandToLegacyLevel(band, bands));
    bandById.set(band.id, band);
  }
  return { bands, bandById, legacyByBandId };
}

function classifyResultBand(
  percentage: number | null,
  persistedBandId: string | null,
  classifier: BandClassifier | undefined,
): PerformanceBandInput | null {
  if (!classifier || classifier.bands.length === 0) return null;
  if (percentage === null) {
    return persistedBandId ? (classifier.bandById.get(persistedBandId) ?? null) : null;
  }
  return classifyByBands(percentage / 100, classifier.bands) ?? null;
}

function countBand(counts: Map<string, BenchmarkBandCount>, band: PerformanceBandInput): void {
  const current = counts.get(band.key);
  if (current) current.count += 1;
  else counts.set(band.key, { bandKey: band.key, label: band.label, order: band.order, count: 1 });
}

function classifyResultLevel(
  percentage: number | null,
  persistedLevel: PerformanceLevel | null,
  classifier: BandClassifier | undefined,
  gradingScaleConfig: unknown,
): PerformanceLevel | null {
  if (percentage === null) return persistedLevel;
  if (classifier && classifier.bands.length > 0) {
    const band = classifyByBands(percentage / 100, classifier.bands);
    if (band) return classifier.legacyByBandId.get(band.id) ?? null;
    return null;
  }
  return percentageToPerformanceLevel(percentage / 100, {
    config: gradingScaleConfig as never,
  });
}
