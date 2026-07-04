import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  instrumentSections,
  items,
  itemTaxonomyTags,
  responses,
  withOrgContext,
} from '@soe/db';
import type { StimulusKind, StimulusSource } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';

/**
 * Pasaje fallado recuperado: el estímulo (texto completo) de los ítems del nodo con
 * mayor brecha en una evaluación, ya deduplicado por sección. Interface backend-interna
 * (no en `@soe/types`, como `RemedialBrief`): alimenta el picker (modo A) y la
 * resolución del estímulo. `gap` es el agregado por sección (0–100); `source` se
 * propaga desde la sección para poder hidratar el estímulo final sin recargarla.
 */
export interface FailedStimulus {
  sectionId: string;
  kind: StimulusKind;
  source: StimulusSource;
  title: string | null;
  text: string | null;
  textType: string | null; // passage_format (plain | markdown | html)
  itemPositions: number[]; // posiciones de los ítems fallados que comparten el pasaje
  gap: number; // brecha agregada del pasaje (0–100)
}

/**
 * Recupera los pasajes fallados de una evaluación para un nodo (Ola 2.1a, común A/B).
 *
 * Reusa el retrieval de pasaje de `item-analysis` (`items.sectionId → instrument_sections`)
 * y el cálculo de brecha por ítem de `item-analysis` (`responses`: `100 - %acierto`).
 * Deduplica por `sectionId` (varios ítems comparten pasaje) agregando la brecha (peor
 * ítem del pasaje) y ordena por brecha desc.
 *
 * Multi-tenancy (CLAUDE.md §5.2): `responses` está bajo RLS → se lee dentro de
 * `withOrgContext` con `tx`. `items`/`item_taxonomy_tags`/`instrument_sections` NO están
 * bajo RLS → filtro `orgId` explícito del pool visible (`org_id = :org ∪ org_id IS NULL`).
 * Nada hardcodeado a asignatura: todo se deriva del `nodeId`.
 */
@Injectable()
export class FailedStimulusService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(
    orgId: string,
    assessmentId: string,
    nodeId: string,
  ): Promise<FailedStimulus[]> {
    return withOrgContext(this.db, orgId, async (tx) => {
      // 1. Ítems etiquetados al nodo, del pool visible (org ∪ oficial), no borrados.
      const taggedItems = await tx
        .select({
          itemId: items.id,
          position: items.position,
          sectionId: items.sectionId,
        })
        .from(items)
        .innerJoin(itemTaxonomyTags, eq(itemTaxonomyTags.itemId, items.id))
        .where(
          and(
            eq(itemTaxonomyTags.nodeId, nodeId),
            or(eq(items.orgId, orgId), isNull(items.orgId)),
            isNull(items.deletedAt),
          ),
        );

      // Solo ítems anclados a una sección (los autocontenidos no tienen estímulo).
      const withSection = taggedItems.filter(
        (row): row is { itemId: string; position: number; sectionId: string } =>
          row.sectionId !== null,
      );
      if (withSection.length === 0) return [];

      const itemIds = withSection.map((row) => row.itemId);

      // 2. Brecha por ítem desde `responses` de ESTA evaluación (RLS → tx).
      //    gap = 100 - %acierto. Solo cuentan los ítems con respuestas en la evaluación.
      const rateRows = await tx
        .select({
          itemId: responses.itemId,
          total: sql<number>`count(*)::int`,
          correct: sql<number>`sum(case when ${responses.isCorrect} = true then 1 else 0 end)::int`,
        })
        .from(responses)
        .where(
          and(
            eq(responses.assessmentId, assessmentId),
            inArray(responses.itemId, itemIds),
          ),
        )
        .groupBy(responses.itemId);

      const gapByItem = new Map<string, number>();
      for (const row of rateRows) {
        const total = Number(row.total);
        if (total === 0) continue;
        const correctRate = (Number(row.correct) / total) * 100;
        gapByItem.set(row.itemId, 100 - correctRate);
      }
      if (gapByItem.size === 0) return [];

      // 3. Secciones de esos ítems que son PASAJES visibles (org ∪ oficial). Sin RLS →
      //    filtro `orgId` explícito.
      const sectionIds = Array.from(
        new Set(
          withSection
            .filter((row) => gapByItem.has(row.itemId))
            .map((row) => row.sectionId),
        ),
      );
      if (sectionIds.length === 0) return [];

      const sections = await tx
        .select({
          id: instrumentSections.id,
          kind: instrumentSections.kind,
          source: instrumentSections.source,
          passageTitle: instrumentSections.passageTitle,
          passageText: instrumentSections.passageText,
          passageFormat: instrumentSections.passageFormat,
        })
        .from(instrumentSections)
        .where(
          and(
            inArray(instrumentSections.id, sectionIds),
            eq(instrumentSections.kind, 'passage'),
            or(
              eq(instrumentSections.orgId, orgId),
              isNull(instrumentSections.orgId),
            ),
          ),
        );
      const sectionById = new Map(sections.map((section) => [section.id, section]));

      // 4. Dedup por sección: agrega brecha (peor ítem del pasaje) + posiciones.
      const grouped = new Map<string, { positions: number[]; worstGap: number }>();
      for (const row of withSection) {
        const gap = gapByItem.get(row.itemId);
        if (gap === undefined) continue; // sin respuestas en esta evaluación
        if (!sectionById.has(row.sectionId)) continue; // no es pasaje / no visible
        const entry = grouped.get(row.sectionId) ?? { positions: [], worstGap: 0 };
        entry.positions.push(row.position);
        entry.worstGap = Math.max(entry.worstGap, gap);
        grouped.set(row.sectionId, entry);
      }

      // 5. Arma los FailedStimulus y ordena por brecha desc.
      const result: FailedStimulus[] = [];
      for (const [sectionId, agg] of grouped) {
        const section = sectionById.get(sectionId);
        if (!section) continue; // defensivo: grouped solo tiene secciones válidas
        result.push({
          sectionId,
          kind: section.kind,
          source: section.source,
          title: section.passageTitle ?? null,
          text: section.passageText ?? null,
          textType: section.passageFormat ?? null,
          itemPositions: [...agg.positions].sort((a, b) => a - b),
          gap: agg.worstGap,
        });
      }
      result.sort((a, b) => b.gap - a.gap);
      return result;
    });
  }
}
