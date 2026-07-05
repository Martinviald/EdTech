import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  assessments,
  instrumentSections,
  instruments,
  items,
  itemTaxonomyTags,
  withOrgContext,
} from '@soe/db';
import type { RemedialStimulusRef } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import { stimulusTextPreview } from './stimulus.mappers';

/**
 * Recupera los pasajes PUBLICADOS del banco para un nodo, acotados al MISMO NIVEL (grado)
 * que el instrumento evaluado (Ola 2.1a). Alimenta el picker de override del docente y el
 * fallback: secciones `kind='passage'` que contienen ítems `status='published'` etiquetados
 * al nodo, del pool visible (`org ∪ oficial`), distinct por sección, y del grado del
 * instrumento del assessment — para NO ofrecer lecturas de otros cursos.
 *
 * El grado objetivo se deriva de `assessments` (SÍ bajo RLS) → toda la lectura corre dentro
 * de `withOrgContext`; el aislamiento del pool de contenido (no-RLS) se mantiene con el filtro
 * `orgId` explícito (`org ∪ oficial`). Nada hardcodeado a asignatura: por `nodeId`.
 */
@Injectable()
export class BankPassageService {
  constructor(@InjectDb() private readonly db: Database) {}

  async listCandidates(
    orgId: string,
    nodeId: string,
    assessmentId: string,
  ): Promise<RemedialStimulusRef[]> {
    return withOrgContext(this.db, orgId, async (tx) => {
      // Grado objetivo = el del instrumento evaluado (assessments → instruments). `assessments`
      // está bajo RLS: se lee dentro de `withOrgContext`. `null` si no se puede derivar → no se
      // filtra por nivel (defensivo, evita vaciar el picker por datos incompletos).
      let gradeId: string | null = null;
      const [assessment] = await tx
        .select({ instrumentId: assessments.instrumentId })
        .from(assessments)
        .where(and(eq(assessments.id, assessmentId), eq(assessments.orgId, orgId)))
        .limit(1);
      if (assessment?.instrumentId) {
        const [instrument] = await tx
          .select({ gradeId: instruments.gradeId })
          .from(instruments)
          .where(eq(instruments.id, assessment.instrumentId))
          .limit(1);
        gradeId = instrument?.gradeId ?? null;
      }

      const rows = await tx
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
        .innerJoin(instruments, eq(instruments.id, instrumentSections.instrumentId))
        .where(
          and(
            eq(itemTaxonomyTags.nodeId, nodeId),
            eq(items.status, 'published'),
            isNull(items.deletedAt),
            or(eq(items.orgId, orgId), isNull(items.orgId)),
            eq(instrumentSections.kind, 'passage'),
            or(eq(instrumentSections.orgId, orgId), isNull(instrumentSections.orgId)),
            // Mismo nivel que el instrumento evaluado (si se pudo derivar).
            gradeId ? eq(instruments.gradeId, gradeId) : undefined,
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
    });
  }
}
