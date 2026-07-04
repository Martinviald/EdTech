import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { instrumentSections, items, itemTaxonomyTags } from '@soe/db';
import type { RemedialStimulusRef } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import { stimulusTextPreview } from './stimulus.mappers';

/**
 * Recupera los pasajes PUBLICADOS del banco para un nodo (Ola 2.1a). Alimenta el picker
 * de override del docente y el fallback: secciones `kind='passage'` que contienen ítems
 * `status='published'` etiquetados al nodo, del pool visible (`org ∪ oficial`), distinct
 * por sección.
 *
 * `items`/`item_taxonomy_tags`/`instrument_sections` NO están bajo RLS → filtro `orgId`
 * explícito (no requiere `withOrgContext`). Nada hardcodeado a asignatura: por `nodeId`.
 */
@Injectable()
export class BankPassageService {
  constructor(@InjectDb() private readonly db: Database) {}

  async listCandidates(orgId: string, nodeId: string): Promise<RemedialStimulusRef[]> {
    const rows = await this.db
      .select({
        sectionId: instrumentSections.id,
        kind: instrumentSections.kind,
        source: instrumentSections.source,
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
      })
      .from(items)
      .innerJoin(itemTaxonomyTags, eq(itemTaxonomyTags.itemId, items.id))
      .innerJoin(instrumentSections, eq(instrumentSections.id, items.sectionId))
      .where(
        and(
          eq(itemTaxonomyTags.nodeId, nodeId),
          eq(items.status, 'published'),
          isNull(items.deletedAt),
          or(eq(items.orgId, orgId), isNull(items.orgId)),
          eq(instrumentSections.kind, 'passage'),
          or(eq(instrumentSections.orgId, orgId), isNull(instrumentSections.orgId)),
        ),
      );

    // Distinct por sección en JS: el join sección↔ítems↔tags multiplica por ítem.
    const bySection = new Map<string, RemedialStimulusRef>();
    for (const row of rows) {
      if (bySection.has(row.sectionId)) continue;
      bySection.set(row.sectionId, {
        sectionId: row.sectionId,
        kind: row.kind,
        source: row.source,
        title: row.passageTitle ?? null,
        textPreview: stimulusTextPreview(row.passageText),
      });
    }
    return Array.from(bySection.values());
  }
}
