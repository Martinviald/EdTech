import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  items,
  itemTaxonomyTags,
  responses,
  skillResults,
  students,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import type {
  AiAnalysisSnapshot,
  SnapshotItem,
  SnapshotSkill,
  UserRole,
  AssessmentReportItemRow,
  AssessmentReportResponse,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { AssessmentReportService } from '../assessment-report/assessment-report.service';
import type { SnapshotBuilder, SnapshotBuildOptions } from './snapshot.port';

/**
 * Umbral de logro (%) por debajo del cual un alumno se cuenta en
 * `studentsBelowThreshold` de una habilidad. Determina `remedialGroupSize` aguas
 * abajo. Es convención pedagógica estándar (nivel "adecuado" arranca en 60%), no
 * hardcodea un instrumento: aplica a cualquier prueba expresada en % de logro.
 */
const SKILL_REMEDIAL_THRESHOLD = 60;

/** Tipos de nodo que cuentan como "habilidad" evaluada (no contenido). */
const SKILL_NODE_TYPES: readonly string[] = ['skill', 'competency', 'dimension'];

/**
 * Ensamblador del snapshot DETERMINISTA que consume el prompt del informe IA
 * (H20.1). Reúsa `AssessmentReportService.getReport()` para el % de logro por
 * ítem y por habilidad, los distractores y la cobertura, y añade el nodo de
 * habilidad, el enunciado y la cobertura blueprint de cada ítem.
 *
 * Multi-tenancy: el `orgId` proviene del token (lo pasa el runner). Toda query a
 * tablas con RLS corre dentro de `withOrgContext`. El snapshot NUNCA contiene PII
 * de alumnos (sin nombres ni RUT): solo agregados + el enunciado (`stem`) de cada
 * ítem.
 */
@Injectable()
export class SnapshotService implements SnapshotBuilder {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly reportService: AssessmentReportService,
  ) {}

  async build(
    assessmentId: string,
    orgId: string,
    opts?: SnapshotBuildOptions,
  ): Promise<AiAnalysisSnapshot> {
    // El informe ya encapsula % de logro / distractores / cobertura, con scoping por
    // rol. El snapshot es una vista org-wide determinista, así que se ejecuta con un
    // contexto sintético admin-like ligado al `orgId` del token.
    const report = await this.reportService.getReport(this.orgScopedUser(orgId), {
      assessmentId,
      classGroupId: opts?.classGroupId,
    });

    // Datos que el informe no expone: nodeId + stem por ítem y conteo de alumnos
    // bajo umbral por habilidad.
    const { itemMeta, belowThresholdByNode } = await withOrgContext(
      this.db,
      orgId,
      async (tx) => {
        const itemMeta = await this.loadItemMeta(tx, report.meta.instrumentName, assessmentId);
        const belowThresholdByNode = await this.loadStudentsBelowThreshold(
          tx,
          assessmentId,
          orgId,
        );
        return { itemMeta, belowThresholdByNode };
      },
    );

    const items = this.assembleItems(report.items, itemMeta);
    const skills = this.assembleSkills(report, itemMeta, belowThresholdByNode);

    return {
      assessmentId,
      instrumentName: report.meta.instrumentName ?? null,
      gradeName: report.meta.gradeName ?? null,
      subjectName: report.meta.subjectName ?? null,
      evaluated: report.summary.studentsEvaluated,
      enrolled: report.summary.studentsEnrolled,
      items,
      skills,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ensamblado (puro, sobre datos ya cargados)
  // ───────────────────────────────────────────────────────────────────────────

  private assembleItems(
    reportItems: AssessmentReportItemRow[],
    itemMeta: ItemMeta[],
  ): SnapshotItem[] {
    const metaById = new Map(itemMeta.map((m) => [m.itemId, m]));

    return reportItems.map((row) => {
      const meta = metaById.get(row.itemId);

      return {
        position: row.position,
        skillName: row.skillName,
        nodeId: meta?.skillNodeId ?? null,
        difficulty: row.difficulty === null ? null : row.difficulty / 100, // % → 0..1
        correctLabel: row.correctKey,
        dominantDistractor: row.topDistractorKey,
        distribution: meta?.distribution ?? {},
        stem: meta?.stem ?? null,
      };
    });
  }

  private assembleSkills(
    report: AssessmentReportResponse,
    itemMeta: ItemMeta[],
    belowThresholdByNode: Map<string, number>,
  ): SnapshotSkill[] {
    // Cobertura blueprint: nº de ítems que mapean a cada nodo (desde tags).
    const itemCountByNode = new Map<string, number>();
    for (const m of itemMeta) {
      if (!m.skillNodeId) continue;
      itemCountByNode.set(m.skillNodeId, (itemCountByNode.get(m.skillNodeId) ?? 0) + 1);
    }

    // El informe ya filtró/ordenó las habilidades por logro; reusamos esos nodos.
    return report.skills
      .filter((s) => SKILL_NODE_TYPES.includes(s.nodeType) || itemCountByNode.has(s.nodeId))
      .map((s) => ({
        nodeId: s.nodeId,
        nodeName: s.nodeName,
        achievement: s.averageAchievement,
        itemCount: itemCountByNode.get(s.nodeId) ?? 0,
        // F1 no almacena un blueprint con conteo esperado por nodo; se deja null
        // (el punto de extensión queda documentado, sin inventar el dato).
        expectedItemCount: null,
        studentsBelowThreshold: belowThresholdByNode.get(s.nodeId) ?? 0,
      }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries (dentro de withOrgContext)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Ítems del instrumento de la evaluación + enunciado (stem), nodo de habilidad
   * representativo y distribución de respuestas por alternativa. El instrumento
   * se resuelve desde el assessment (1 query) para no depender del nombre.
   */
  private async loadItemMeta(
    tx: Database,
    _instrumentName: string | null,
    assessmentId: string,
  ): Promise<ItemMeta[]> {
    // Ítems efectivamente respondidos en la evaluación (= instrumento aplicado),
    // con su contenido para extraer el stem. Evita acoplar al nombre del
    // instrumento y respeta soft-delete.
    const rows = await tx
      .select({
        itemId: items.id,
        position: items.position,
        content: items.content,
      })
      .from(items)
      .innerJoin(
        responses,
        and(
          eq(responses.itemId, items.id),
          eq(responses.assessmentId, assessmentId),
        ),
      )
      .where(isNull(items.deletedAt))
      .groupBy(items.id, items.position, items.content)
      .orderBy(asc(items.position));

    const itemIds = rows.map((r) => r.itemId);
    const [skillByItem, distributionByItem] = await Promise.all([
      this.loadSkillNodeByItem(tx, itemIds),
      this.loadDistributionByItem(tx, assessmentId, itemIds),
    ]);

    return rows.map((r) => ({
      itemId: r.itemId,
      position: r.position,
      stem: extractStem(r.content),
      skillNodeId: skillByItem.get(r.itemId) ?? null,
      distribution: distributionByItem.get(r.itemId) ?? {},
    }));
  }

  /** Nodo de habilidad representativo por ítem (primer tag de tipo habilidad). */
  private async loadSkillNodeByItem(
    tx: Database,
    itemIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (itemIds.length === 0) return map;

    const rows = await tx
      .select({
        itemId: itemTaxonomyTags.itemId,
        nodeId: taxonomyNodes.id,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
      .where(inArray(itemTaxonomyTags.itemId, itemIds))
      .orderBy(asc(itemTaxonomyTags.tagType));

    for (const r of rows) {
      if (map.has(r.itemId)) continue;
      if (SKILL_NODE_TYPES.includes(r.nodeType)) {
        map.set(r.itemId, r.nodeId);
      }
    }
    // Fallback: si un ítem no tiene tag de habilidad, usa cualquier nodo tageado.
    for (const r of rows) {
      if (!map.has(r.itemId)) map.set(r.itemId, r.nodeId);
    }
    return map;
  }

  /** Distribución label → nº de respuestas por ítem (sin PII). */
  private async loadDistributionByItem(
    tx: Database,
    assessmentId: string,
    itemIds: string[],
  ): Promise<Map<string, Record<string, number>>> {
    const map = new Map<string, Record<string, number>>();
    if (itemIds.length === 0) return map;

    const answerExpr = sql<
      string | null
    >`nullif(coalesce(${responses.value}->>'raw', ${responses.value}->>'key', ${responses.value}->>'answer'), '')`;

    const rows = await tx
      .select({
        itemId: responses.itemId,
        answer: answerExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, assessmentId),
          inArray(responses.itemId, itemIds),
        ),
      )
      .groupBy(responses.itemId, answerExpr);

    for (const r of rows) {
      const label = r.answer ?? '(blank)';
      const entry = map.get(r.itemId) ?? {};
      entry[label] = (entry[label] ?? 0) + Number(r.count);
      map.set(r.itemId, entry);
    }
    return map;
  }


  /** Nº de alumnos bajo el umbral remedial por nodo (determinista, sin PII). */
  private async loadStudentsBelowThreshold(
    tx: Database,
    assessmentId: string,
    orgId: string,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();

    const rows = await tx
      .select({
        nodeId: skillResults.nodeId,
        count: sql<number>`count(distinct ${skillResults.studentId})::int`,
      })
      .from(skillResults)
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .where(
        and(
          eq(skillResults.assessmentId, assessmentId),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
          sql`${skillResults.percentage}::numeric < ${SKILL_REMEDIAL_THRESHOLD}`,
        ),
      )
      .groupBy(skillResults.nodeId);

    for (const r of rows) {
      map.set(r.nodeId, Number(r.count));
    }
    return map;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Usuario sintético admin-like ligado al `orgId` del token. El snapshot es una
   * vista org-wide; se delega el scoping a `AssessmentReportService` que lo trata
   * como directivo (toda la org). El `orgId` NUNCA viene del body — lo pasa el
   * runner desde el JWT.
   */
  private orgScopedUser(orgId: string): JwtPayload {
    const role: UserRole = 'academic_director';
    return {
      userId: 'ai-analysis-snapshot',
      orgId,
      email: 'snapshot@internal',
      name: 'AI Analysis Snapshot',
      isPlatformAdmin: false,
      roles: [role],
      activeRole: role,
      role,
    };
  }
}

// ── Tipos internos ────────────────────────────────────────────────────────────

type ItemMeta = {
  itemId: string;
  position: number;
  stem: string | null;
  skillNodeId: string | null;
  distribution: Record<string, number>;
};

/** Extrae `content.stem` de forma defensiva (contenido polimórfico por type). */
function extractStem(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const stem = (content as { stem?: unknown }).stem;
  return typeof stem === 'string' && stem.length > 0 ? stem : null;
}
