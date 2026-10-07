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
 * `assessment_skill_stats`, `assessment_item_stats` — bajo RLS) se lee SIEMPRE dentro de `withOrgContext(orgId)`, org
 * por org. El destino (`benchmark_aggregates`, SIN RLS) se escribe cross-tenant con
 * `db`. El read-model nunca contiene PII: sólo agregados por (org × instrumento ×
 * nivel × asignatura).
 *
 * Es upsert puro: nunca borra filas. Los fixtures de `seed/benchmark-demo.ts` se
 * insertan directo en el read-model sin resultados detrás, y un refresh que borrara
 * lo que no recalcula los haría desaparecer.
 */
import { and, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  achievementPct,
  classifyByBands,
  emptyTally,
  round2,
  tallyOf,
  type AchievementTally,
  type BenchmarkBandCount,
  type BenchmarkSkillAggregate,
  type PerformanceBandInput,
} from '@soe/types';
import type { Database } from '../client';
import { assessments } from '../schema/assessments';
import {
  benchmarkAggregates,
  benchmarkItemAggregates,
  orgBenchmarkSettings,
} from '../schema/benchmark';
import { instruments } from '../schema/instruments';
import { organizations } from '../schema/organizations';
import { assessmentItemStats, assessmentResults, assessmentSkillStats } from '../schema/results';
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
  tally: AchievementTally;
  bandCounts: BenchmarkBandCount[];
  perSkill: BenchmarkSkillAggregate[];
};

/** Acumulador en memoria por instrumento durante el agregado de una org. */
type InstrumentAccumulator = {
  gradeId: string | null;
  subjectId: string | null;
  students: Set<string>;
  bandCounts: Map<string, BenchmarkBandCount>;
};

/**
 * Bandas efectivas de un instrumento indexadas UNA vez por id, para resolver la banda
 * persistida de las filas band-only sin recorrer el set por fila. Sin bandas efectivas
 * (`source: 'none'`) queda `bands` vacío y el resultado no suma a `band_counts`.
 */
type BandClassifier = {
  bands: PerformanceBandInput[];
  bandById: Map<string, PerformanceBandInput>;
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
        scoreSum: row.tally.scoreSum.toFixed(2),
        maxSum: row.tally.maxSum.toFixed(2),
        avgAchievement: toAchievementColumn(row.tally),
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
            scoreSum: value.scoreSum,
            maxSum: value.maxSum,
            avgAchievement: value.avgAchievement,
            bandCounts: value.bandCounts,
            perSkill: value.perSkill,
            optOutGlobalPool: value.optOutGlobalPool,
            refreshedAt: value.refreshedAt,
            updatedAt: value.updatedAt,
          },
        });
    }

    // Poda de la corrida anterior. El UNIQUE de dimensiones no puede atrapar las filas
    // con `grade_id`/`subject_id` NULL —en Postgres dos NULL no son iguales, y
    // `NULLS NOT DISTINCT` pide PG15 mientras demo corre PG14—, así que el
    // `onConflictDoUpdate` no las encuentra y cada corrida insertaría una fila más para
    // el mismo (org, instrumento) sin asignatura o sin grado. Dos filas de UN colegio
    // alcanzan para que la muestra lo acepte como cohorte con k=2 y se le devuelvan sus
    // propios datos como contraste. Borrar lo anterior a esta corrida también descarta
    // las dimensiones que la org dejó de tener (una evaluación borrada, por ejemplo).
    await db
      .delete(benchmarkAggregates)
      .where(and(eq(benchmarkAggregates.orgId, org.id), lt(benchmarkAggregates.refreshedAt, now)));

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
        scoreSum: sql<string>`coalesce(sum(${assessmentItemStats.scoreSum}), 0)`,
        maxSum: sql<string>`coalesce(sum(${assessmentItemStats.maxSum}), 0)`,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessmentItemStats.assessmentId, assessments.id))
      .where(and(eq(assessments.orgId, orgId), preferComputedOverImported(assessmentItemStats)))
      .groupBy(assessments.instrumentId, assessmentItemStats.itemId),
  );
  const now = new Date();
  if (rows.length === 0) {
    // Sin stats en la fuente, lo que haya quedado del read-model ya no se sostiene.
    await db.delete(benchmarkItemAggregates).where(eq(benchmarkItemAggregates.orgId, orgId));
    return 0;
  }

  for (let i = 0; i < rows.length; i += ITEM_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + ITEM_UPSERT_CHUNK).map((row) => ({
      orgId,
      instrumentId: row.instrumentId,
      itemId: row.itemId,
      correctCount: Number(row.correctCount),
      responseCount: Number(row.responseCount),
      scoreSum: Number(row.scoreSum).toFixed(2),
      maxSum: Number(row.maxSum).toFixed(2),
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
          scoreSum: sql`excluded.score_sum`,
          maxSum: sql`excluded.max_sum`,
          optOutGlobalPool: sql`excluded.opt_out_global_pool`,
          refreshedAt: sql`excluded.refreshed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  await db
    .delete(benchmarkItemAggregates)
    .where(
      and(eq(benchmarkItemAggregates.orgId, orgId), lt(benchmarkItemAggregates.refreshedAt, now)),
    );

  return rows.length;
}

/**
 * Descarta la fila importada de una celda (instrumento × curso × nodo) cuando esa celda
 * también tiene la calculada.
 *
 * La importación del informe oficial DIA crea su propia evaluación, así que un instrumento
 * con respuestas cargadas Y su informe importado tiene las dos: sumar ambas cuenta a cada
 * alumno dos veces. Medido en demo: `DIA Matemática 6° Básico 2025 — Intermedio` reportaba
 * 162 alumnos por nodo sobre 81 reales, en 6 celdas (3 instrumentos × 2 cursos).
 *
 * No alcanza con quedarse con UNA fila por celda: una celda puede tener dos filas
 * `computed` de evaluaciones distintas y ser correcto sumarlas, porque son alumnos
 * disjuntos — en CSCJ hay una evaluación por curso y un alumno que rindió con el otro
 * curso aparece en la evaluación ajena bajo su curso real. Ahí el total es la suma (42 + 1)
 * y quedarse con una perdería al alumno cruzado.
 *
 * Por eso el criterio es por FUENTE, no por fila: si la celda tiene algo calculado desde
 * respuestas reales, lo importado no aporta; si no lo tiene (colegio que sólo subió su
 * informe), lo importado es todo lo que hay y cuenta.
 */
export function preferComputedOverImported(stats: typeof assessmentSkillStats): SQL;
export function preferComputedOverImported(stats: typeof assessmentItemStats): SQL;
export function preferComputedOverImported(
  stats: typeof assessmentSkillStats | typeof assessmentItemStats,
): SQL {
  const dimension = 'nodeId' in stats ? stats.nodeId : stats.itemId;
  return sql`not (${stats.source} = 'imported' and exists (
      select 1
      from ${stats} dup_stats
      join ${assessments} dup_assessments on dup_assessments.id = dup_stats.assessment_id
      where dup_assessments.instrument_id = ${assessments.instrumentId}
        and dup_assessments.org_id = ${assessments.orgId}
        and dup_stats.class_group_id = ${stats.classGroupId}
        and dup_stats.${sql.raw(dimension.name)} = ${dimension}
        and dup_stats.source = 'computed'
    ))`;
}

/**
 * Agrega la fuente de la org bajo `withOrgContext`, agrupada por instrumento (gradeId/subjectId
 * vienen del instrumento):
 *  · alumnos y bandas desde `assessment_results`;
 *  · el tally del colegio (`score_sum` / `max_sum`) desde `assessment_item_stats`, y el logro por
 *    nodo desde los tallies de `assessment_skill_stats`. Es la misma regla que usan las vistas
 *    del colegio (docs/diseno-logro-unificado-y-cohorte.md §3.1), incluido el colegio que sólo
 *    subió su informe oficial.
 *
 * `bandCounts` cuenta por la banda PROPIA del instrumento (clave/etiqueta/orden): se
 * clasifica el `percentage` de cada resultado con las bandas EFECTIVAS del instrumento
 * (propias → versión anterior de su familia, ver `effective-bands`). Las filas band-only
 * (informe oficial: `percentage` NULL) cuentan por su `performance_band_id` persistido;
 * sin banda, o sin bandas efectivas, no suman. Nunca se proyecta a la escala legacy de
 * 4 niveles: es lo que se pone al lado de las vistas de resultados.
 */
async function buildOrgRows(db: Database, orgId: string): Promise<OrgAggregateRow[]> {
  return withOrgContext(db, orgId, async (tx) => {
    const resultRows = await tx
      .select({
        instrumentId: instruments.id,
        gradeId: instruments.gradeId,
        subjectId: instruments.subjectId,
        studentId: assessmentResults.studentId,
        percentage: assessmentResults.percentage,
        performanceBandId: assessmentResults.performanceBandId,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessmentResults.assessmentId, assessments.id))
      .innerJoin(instruments, eq(assessments.instrumentId, instruments.id))
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
          bandCounts: new Map<string, BenchmarkBandCount>(),
        };
        accByInstrument.set(row.instrumentId, acc);
      }
      acc.students.add(row.studentId);
      const pct = row.percentage === null ? null : Number(row.percentage);
      const band = classifyResultBand(
        pct,
        row.performanceBandId ?? null,
        bandClassifiers.get(row.instrumentId),
      );
      if (band) countBand(acc.bandCounts, band);
    }

    const perSkillRows = await tx
      .select({
        instrumentId: instruments.id,
        nodeId: assessmentSkillStats.nodeId,
        nodeName: taxonomyNodes.name,
        scoreSum: sql<string>`coalesce(sum(${assessmentSkillStats.scoreSum}), 0)`,
        maxSum: sql<string>`coalesce(sum(${assessmentSkillStats.maxSum}), 0)`,
        studentCount: sql<number>`sum(${assessmentSkillStats.studentCount})::int`,
      })
      .from(assessmentSkillStats)
      .innerJoin(assessments, eq(assessmentSkillStats.assessmentId, assessments.id))
      .innerJoin(instruments, eq(assessments.instrumentId, instruments.id))
      .innerJoin(taxonomyNodes, eq(assessmentSkillStats.nodeId, taxonomyNodes.id))
      .where(and(eq(assessments.orgId, orgId), preferComputedOverImported(assessmentSkillStats)))
      .groupBy(instruments.id, assessmentSkillStats.nodeId, taxonomyNodes.name);

    const tallyRows = await tx
      .select({
        instrumentId: assessments.instrumentId,
        scoreSum: sql<string>`coalesce(sum(${assessmentItemStats.scoreSum}), 0)`,
        maxSum: sql<string>`coalesce(sum(${assessmentItemStats.maxSum}), 0)`,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessmentItemStats.assessmentId, assessments.id))
      .where(and(eq(assessments.orgId, orgId), preferComputedOverImported(assessmentItemStats)))
      .groupBy(assessments.instrumentId);
    const tallyByInstrument = new Map(
      tallyRows.map((r) => [r.instrumentId, tallyOf([{ scoreSum: r.scoreSum, maxSum: r.maxSum }])]),
    );

    const perSkillByInstrument = new Map<string, BenchmarkSkillAggregate[]>();
    for (const row of perSkillRows) {
      const list = perSkillByInstrument.get(row.instrumentId) ?? [];
      const tally = tallyOf([{ scoreSum: row.scoreSum, maxSum: row.maxSum }]);
      const pct = achievementPct(tally);
      list.push({
        nodeId: row.nodeId,
        nodeName: row.nodeName,
        achievement: pct === null ? null : round2(pct),
        studentCount: row.studentCount,
        scoreSum: round2(tally.scoreSum),
        maxSum: round2(tally.maxSum),
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
        tally: tallyByInstrument.get(instrumentId) ?? emptyTally(),
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
  return { bands, bandById: new Map(bands.map((band) => [band.id, band])) };
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

function toAchievementColumn(tally: AchievementTally): string | null {
  const pct = achievementPct(tally);
  return pct === null ? null : pct.toFixed(2);
}

function countBand(counts: Map<string, BenchmarkBandCount>, band: PerformanceBandInput): void {
  const current = counts.get(band.key);
  if (current) current.count += 1;
  else counts.set(band.key, { bandKey: band.key, label: band.label, order: band.order, count: 1 });
}
