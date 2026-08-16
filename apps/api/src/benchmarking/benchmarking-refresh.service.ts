import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  benchmarkAggregates,
  gradingScales,
  instruments,
  organizations,
  orgBenchmarkSettings,
  skillResults,
  taxonomyNodes,
  withOrgContext,
  type NewBenchmarkAggregate,
} from '@soe/db';
import {
  bandToLegacyLevel,
  classifyByBands,
  percentageToPerformanceLevel,
  type BenchmarkBandDistribution,
  type BenchmarkRefreshResponse,
  type BenchmarkSkillAggregate,
  type PerformanceBandInput,
  type PerformanceLevel,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import {
  resolveEffectiveBandsForInstruments,
  type EffectiveBands,
} from '../performance-bands/lib/resolve-effective-bands';

/**
 * H7.1 — Refresh del read-model `benchmark_aggregates`.
 *
 * Estrategia anti-leak (CLAUDE.md §5.2): la FUENTE (`assessment_results`,
 * `skill_results` — bajo RLS) se lee SIEMPRE dentro de `withOrgContext(orgId)`,
 * **org por org**. El read-model destino (`benchmark_aggregates`, SIN RLS) se
 * escribe cross-tenant con `this.db`. Así el aislamiento se respeta en la lectura
 * y el read-model se puede construir/consultar cross-tenant en el motor de
 * comparación.
 *
 * El read-model **nunca** contiene PII: solo agregados por (org × instrumento ×
 * nivel × asignatura) — conteos, % logro, distribución por banda y % por habilidad.
 * Snapshotea `optOutGlobalPool` (de `org_benchmark_settings`) y las dimensiones de
 * cohorte (`dependence/region/commune/networkOrgId = organizations.parent_id`).
 *
 * `gradeId`/`subjectId` se derivan del propio instrumento (cada instrumento es de
 * un nivel/asignatura). No se hardcodea ningún instrumento.
 */
@Injectable()
export class BenchmarkingRefreshService {
  private readonly logger = new Logger(BenchmarkingRefreshService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * POST /api/benchmarking/refresh — reconstruye el read-model completo.
   * Itera todas las orgs no eliminadas; para cada una agrega su fuente bajo
   * `withOrgContext` y hace upsert por (orgId, instrumentId, gradeId, subjectId).
   * Volumen piloto → ejecución síncrona.
   */
  async refresh(): Promise<BenchmarkRefreshResponse> {
    // `organizations` no tiene RLS → query directa. Solo colegios (no plataforma
    // ni fundaciones, que no rinden evaluaciones).
    const orgs = await this.db
      .select({
        id: organizations.id,
        parentId: organizations.parentId,
        dependence: organizations.dependence,
        region: organizations.region,
        commune: organizations.commune,
      })
      .from(organizations)
      .where(and(eq(organizations.type, 'school'), isNull(organizations.deletedAt)));

    let refreshedOrgs = 0;
    let refreshedRows = 0;

    for (const org of orgs) {
      const networkOrgId = await this.deriveNetworkOrgId(org.parentId);
      const optOutGlobalPool = await this.readOptOut(org.id);
      const rows = await this.buildOrgRows(org.id);

      if (rows.length === 0) continue;

      const values: NewBenchmarkAggregate[] = rows.map((row) => ({
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
        perSkill: row.perSkill,
        optOutGlobalPool,
        refreshedAt: new Date(),
        updatedAt: new Date(),
      }));

      // Upsert en el read-model (sin contexto: la tabla NO tiene RLS).
      for (const value of values) {
        await this.db
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
              perSkill: value.perSkill,
              optOutGlobalPool: value.optOutGlobalPool,
              refreshedAt: value.refreshedAt,
              updatedAt: value.updatedAt,
            },
          });
      }

      refreshedOrgs += 1;
      refreshedRows += values.length;
    }

    this.logger.log(
      `Benchmark read-model refreshed: ${refreshedOrgs} orgs, ${refreshedRows} rows`,
    );

    return {
      refreshedOrgs,
      refreshedRows,
      refreshedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Agregación de la fuente de UNA org (DENTRO de withOrgContext)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Agrega `assessment_results` + `skill_results` de la org bajo `withOrgContext`.
   * Agrupa por (instrumentId, gradeId, subjectId) — gradeId/subjectId vienen del
   * instrumento. Devuelve filas sin PII listas para el read-model.
   *
   * La distribución por banda NO sale de la columna legacy `performanceLevel`: se
   * clasifica el `percentage` de cada resultado con las bandas EFECTIVAS del
   * instrumento (propias → versión anterior de su familia → legacy 40/70/85 sólo
   * como último recurso, ver `resolveEffectiveBands`) y se proyecta al enum de 4
   * niveles con `bandToLegacyLevel`. Cuando el instrumento no tiene bandas
   * efectivas (`source: 'none'`) se cae al corte legacy vía
   * `percentageToPerformanceLevel`. Las filas band-only (informe oficial:
   * `percentage` NULL, `performanceLevel` ya persistido) se cuentan por su nivel
   * persistido, como antes.
   */
  private async buildOrgRows(orgId: string): Promise<OrgAggregateRow[]> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const resultRows = await tx
        .select({
          instrumentId: instruments.id,
          gradeId: instruments.gradeId,
          subjectId: instruments.subjectId,
          gradingScaleConfig: gradingScales.config,
          studentId: assessmentResults.studentId,
          percentage: assessmentResults.percentage,
          performanceLevel: assessmentResults.performanceLevel,
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
          };
          accByInstrument.set(row.instrumentId, acc);
        }
        acc.students.add(row.studentId);
        const pct = row.percentage === null ? null : Number(row.percentage);
        if (pct !== null) {
          acc.pctSum += pct;
          acc.pctCount += 1;
        }
        const level = classifyResultLevel(
          pct,
          row.performanceLevel,
          bandClassifiers.get(row.instrumentId),
          row.gradingScaleConfig,
        );
        if (level !== null) acc.bandDistribution[level] += 1;
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
        const avgAchievement =
          acc.pctCount === 0 ? null : (acc.pctSum / acc.pctCount).toFixed(2);
        rows.push({
          instrumentId,
          gradeId: acc.gradeId,
          subjectId: acc.subjectId,
          studentCount: acc.students.size,
          avgAchievement,
          bandDistribution: acc.bandDistribution,
          perSkill: perSkillByInstrument.get(instrumentId) ?? [],
        });
      }
      return rows;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Snapshots de dimensiones / opt-out
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Lee `optOutGlobalPool` de `org_benchmark_settings` (RLS → withOrgContext).
   * Si la org no tiene fila aún, default opt-in (false).
   */
  private async readOptOut(orgId: string): Promise<boolean> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .select({ optOut: orgBenchmarkSettings.optOutGlobalPool })
        .from(orgBenchmarkSettings)
        .where(eq(orgBenchmarkSettings.orgId, orgId))
        .limit(1);
      return row?.optOut ?? false;
    });
  }

  /**
   * Deriva la red/sostenedor: `networkOrgId = parentId` solo si el padre es una
   * `foundation`. `organizations` NO tiene RLS → query directa con `this.db`.
   * Idéntica semántica a BenchmarkSettingsService.deriveNetworkOrgId.
   */
  private async deriveNetworkOrgId(parentId: string | null): Promise<string | null> {
    if (!parentId) return null;
    const [parent] = await this.db
      .select({ id: organizations.id, type: organizations.type })
      .from(organizations)
      .where(eq(organizations.id, parentId))
      .limit(1);
    return parent && parent.type === 'foundation' ? parent.id : null;
  }
}

/** Fila agregada de una org para el read-model (sin PII). */
interface OrgAggregateRow {
  instrumentId: string;
  gradeId: string | null;
  subjectId: string | null;
  studentCount: number;
  avgAchievement: string | null;
  bandDistribution: BenchmarkBandDistribution;
  perSkill: BenchmarkSkillAggregate[];
}

/** Acumulador en memoria por instrumento durante el agregado de una org. */
interface InstrumentAccumulator {
  gradeId: string | null;
  subjectId: string | null;
  students: Set<string>;
  pctSum: number;
  pctCount: number;
  bandDistribution: BenchmarkBandDistribution;
}

/**
 * Clasificador de bandas de un instrumento pre-indexado UNA vez: guarda las bandas
 * ordenadas por `order` y el nivel legacy ya resuelto por banda, para clasificar
 * cada `percentage` en O(bandas) sin recalcular la proyección por fila. Cuando el
 * instrumento no tiene bandas efectivas (`source: 'none'`) queda `bands` vacío y el
 * caller cae a `percentageToPerformanceLevel`.
 */
interface BandClassifier {
  bands: PerformanceBandInput[];
  legacyByBandId: Map<string, PerformanceLevel>;
}

function buildBandClassifier(effective: EffectiveBands): BandClassifier {
  const bands = effective.bands;
  const legacyByBandId = new Map<string, PerformanceLevel>();
  for (const band of bands) {
    legacyByBandId.set(band.id, bandToLegacyLevel(band, bands));
  }
  return { bands, legacyByBandId };
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
