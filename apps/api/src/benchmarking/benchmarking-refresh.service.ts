import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  benchmarkAggregates,
  instruments,
  organizations,
  orgBenchmarkSettings,
  skillResults,
  taxonomyNodes,
  withOrgContext,
  type NewBenchmarkAggregate,
} from '@soe/db';
import {
  type BenchmarkBandDistribution,
  type BenchmarkRefreshResponse,
  type BenchmarkSkillAggregate,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

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
   */
  private async buildOrgRows(orgId: string): Promise<OrgAggregateRow[]> {
    return withOrgContext(this.db, orgId, async (tx) => {
      // Agregado global por instrumento: conteo de alumnos, % logro promedio y
      // distribución por banda (de performanceLevel).
      const base = await tx
        .select({
          instrumentId: instruments.id,
          gradeId: instruments.gradeId,
          subjectId: instruments.subjectId,
          studentCount: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
          avgAchievement: sql<
            string | null
          >`round(avg(${assessmentResults.percentage}), 2)`,
          insufficient: sql<number>`sum(case when ${assessmentResults.performanceLevel} = 'insufficient' then 1 else 0 end)::int`,
          elementary: sql<number>`sum(case when ${assessmentResults.performanceLevel} = 'elementary' then 1 else 0 end)::int`,
          adequate: sql<number>`sum(case when ${assessmentResults.performanceLevel} = 'adequate' then 1 else 0 end)::int`,
          advanced: sql<number>`sum(case when ${assessmentResults.performanceLevel} = 'advanced' then 1 else 0 end)::int`,
        })
        .from(assessmentResults)
        .innerJoin(assessments, eq(assessmentResults.assessmentId, assessments.id))
        .innerJoin(instruments, eq(assessments.instrumentId, instruments.id))
        .where(eq(assessments.orgId, orgId))
        .groupBy(instruments.id, instruments.gradeId, instruments.subjectId);

      if (base.length === 0) return [];

      // Agregado por habilidad (taxonomy node) por instrumento.
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

      return base.map((row) => {
        const bandDistribution: BenchmarkBandDistribution = {
          insufficient: row.insufficient,
          elementary: row.elementary,
          adequate: row.adequate,
          advanced: row.advanced,
        };
        return {
          instrumentId: row.instrumentId,
          gradeId: row.gradeId,
          subjectId: row.subjectId,
          studentCount: row.studentCount,
          avgAchievement: row.avgAchievement,
          bandDistribution,
          perSkill: perSkillByInstrument.get(row.instrumentId) ?? [],
        };
      });
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
