import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  instruments,
  instrumentSections,
  items,
  withOrgContext,
} from '@soe/db';
import type {
  AiAnalysisSnapshot,
  ComparisonAlternative,
  ComparisonItem,
  ComparisonPassage,
  ComparisonSide,
  InstrumentComparisonSnapshot,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { SNAPSHOT_BUILDER, type SnapshotBuilder } from './snapshot.port';

// ── Topes de truncado (control de payload al LLM) ────────────────────────────
// El contenido de dos instrumentos completos puede ser grande; se trunca el texto
// (no el número de ítems) para acotar tokens sin perder la señal de contenido.
const STEM_MAX_CHARS = 280;
const ALT_MAX_CHARS = 160;
const PASSAGE_MAX_CHARS = 600;

/**
 * Ensamblador del snapshot DETERMINISTA de la comparación de DOS instrumentos
 * (TKT-23). Para cada lado reusa el snapshot de evaluación ya existente
 * (`SnapshotBuilder`: contenido + psicometría anonimizada) y lo enriquece con:
 *  - metadatos del instrumento (año, tipo) resueltos desde el assessment,
 *  - % de logro global (avg de `assessment_results.percentage`),
 *  - alternativas y pasaje/sección por ítem (para el análisis de CONTENIDO).
 *
 * Multi-tenancy: el `orgId` proviene SIEMPRE del token (lo pasa el runner). Toda
 * query corre dentro de `withOrgContext` (RLS por org_id). El snapshot NUNCA
 * contiene PII: solo agregados + contenido de ítems/pasajes.
 */
@Injectable()
export class InstrumentComparisonSnapshotService {
  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(SNAPSHOT_BUILDER) private readonly snapshot: SnapshotBuilder,
  ) {}

  async build(
    baseAssessmentId: string,
    comparisonAssessmentId: string,
    orgId: string,
  ): Promise<InstrumentComparisonSnapshot> {
    // Los dos lados son independientes → se ensamblan en paralelo.
    const [base, comparison] = await Promise.all([
      this.buildSide(baseAssessmentId, orgId),
      this.buildSide(comparisonAssessmentId, orgId),
    ]);
    return { base, comparison };
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async buildSide(assessmentId: string, orgId: string): Promise<ComparisonSide> {
    // 1) Snapshot de evaluación reusado (contenido stem + p/D/distribución + skills).
    const snap: AiAnalysisSnapshot = await this.snapshot.build(assessmentId, orgId);

    // 2) Enriquecimiento: instrumento (año/tipo), % logro global, alternativas y pasajes.
    const enrichment = await withOrgContext(this.db, orgId, async (tx) => {
      const meta = await this.loadInstrumentMeta(tx, assessmentId);
      const [averageAchievement, content] = await Promise.all([
        this.loadAverageAchievement(tx, assessmentId),
        this.loadItemContent(tx, meta.instrumentId),
      ]);
      return { meta, averageAchievement, content };
    });

    const items: ComparisonItem[] = snap.items.map((it) => {
      const extra = enrichment.content.byPosition.get(it.position);
      return {
        position: it.position,
        skillName: it.skillName,
        nodeId: it.nodeId,
        stem: truncate(it.stem, STEM_MAX_CHARS),
        alternatives: extra?.alternatives ?? [],
        difficulty: it.difficulty,
        discrimination: it.discrimination,
        correctLabel: it.correctLabel,
        dominantDistractor: it.dominantDistractor,
        distribution: it.distribution,
        passageTitle: extra?.passageTitle ?? null,
      };
    });

    return {
      assessmentId,
      instrumentId: enrichment.meta.instrumentId,
      instrumentName: snap.instrumentName,
      instrumentType: enrichment.meta.instrumentType,
      year: enrichment.meta.year,
      gradeName: snap.gradeName,
      subjectName: snap.subjectName,
      studentsEvaluated: snap.evaluated,
      studentsEnrolled: snap.enrolled,
      averageAchievement: enrichment.averageAchievement,
      reliabilityKr20: snap.reliability.kr20,
      items,
      skills: snap.skills.map((s) => ({
        nodeId: s.nodeId,
        nodeName: s.nodeName,
        achievement: s.achievement,
        itemCount: s.itemCount,
      })),
      passages: enrichment.content.passages,
    };
  }

  // ── Queries (dentro de withOrgContext) ──────────────────────────────────────

  /** Instrumento aplicado por el assessment (id, tipo, año). */
  private async loadInstrumentMeta(
    tx: Database,
    assessmentId: string,
  ): Promise<{ instrumentId: string; instrumentType: string | null; year: number | null }> {
    const [row] = await tx
      .select({
        instrumentId: instruments.id,
        instrumentType: sql<string>`${instruments.type}::text`,
        year: instruments.year,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(eq(assessments.id, assessmentId))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Evaluación o instrumento no encontrado');
    }
    return { instrumentId: row.instrumentId, instrumentType: row.instrumentType, year: row.year };
  }

  /** % de logro global de la evaluación (avg de assessment_results.percentage). */
  private async loadAverageAchievement(tx: Database, assessmentId: string): Promise<number | null> {
    const [row] = await tx
      .select({ avg: sql<number | null>`avg(${assessmentResults.percentage})::float` })
      .from(assessmentResults)
      .where(eq(assessmentResults.assessmentId, assessmentId));
    const avg = row?.avg ?? null;
    return avg === null ? null : round1(avg);
  }

  /**
   * Contenido del instrumento para el análisis cualitativo: alternativas y
   * pasaje/sección por posición de ítem + lista de pasajes únicos. Contenido
   * polimórfico (`items.content`), extraído de forma defensiva.
   */
  private async loadItemContent(
    tx: Database,
    instrumentId: string,
  ): Promise<{
    byPosition: Map<number, { alternatives: ComparisonAlternative[]; passageTitle: string | null }>;
    passages: ComparisonPassage[];
  }> {
    const rows = await tx
      .select({
        position: items.position,
        content: items.content,
        sectionId: items.sectionId,
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
      })
      .from(items)
      .leftJoin(instrumentSections, eq(instrumentSections.id, items.sectionId))
      .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
      .orderBy(asc(items.position));

    const byPosition = new Map<
      number,
      { alternatives: ComparisonAlternative[]; passageTitle: string | null }
    >();
    const passageByKey = new Map<string, ComparisonPassage>();

    for (const r of rows) {
      byPosition.set(r.position, {
        alternatives: extractAlternatives(r.content),
        passageTitle: r.passageTitle ?? null,
      });
      // Pasaje único por sección (dedupe): título + excerpt truncado.
      if (r.sectionId && r.passageText && !passageByKey.has(r.sectionId)) {
        passageByKey.set(r.sectionId, {
          title: r.passageTitle ?? null,
          excerpt: truncate(r.passageText, PASSAGE_MAX_CHARS),
        });
      }
    }

    return { byPosition, passages: [...passageByKey.values()] };
  }
}

// ── Helpers puros ──────────────────────────────────────────────────────────

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Extrae las alternativas de un contenido polimórfico (MC / listening) de forma
 * defensiva. Si el ítem no tiene alternativas (abierto, verdadero/falso, etc.)
 * devuelve []. El texto se trunca para acotar payload.
 */
function extractAlternatives(content: unknown): ComparisonAlternative[] {
  if (!content || typeof content !== 'object') return [];
  const raw = (content as { alternatives?: unknown }).alternatives;
  if (!Array.isArray(raw)) return [];
  const result: ComparisonAlternative[] = [];
  for (const alt of raw) {
    if (!alt || typeof alt !== 'object') continue;
    const key = (alt as { key?: unknown }).key;
    if (typeof key !== 'string') continue;
    const text = (alt as { text?: unknown }).text;
    const isCorrect = (alt as { isCorrect?: unknown }).isCorrect;
    result.push({
      key,
      text: typeof text === 'string' ? truncate(text, ALT_MAX_CHARS) : null,
      isCorrect: isCorrect === true,
    });
  }
  return result;
}
