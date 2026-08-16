import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  documents,
  instrumentSections,
  instruments,
  itemTaxonomyTags,
  items,
  withOrgContext,
  type Item,
} from '@soe/db';
import type { DocumentModel } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { DocumentsService } from './documents.service';
import { buildItemSnapshot, collectItemBlockIds } from './documents.helpers';

@Injectable()
export class DocumentPromotionService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  async promoteToInstrument(user: JwtPayload, documentId: string): Promise<DocumentModel> {
    const orgId = this.documentsService.requireOrgId(user);

    await withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.documentsService.findVisibleOrThrow(tx, orgId, user, documentId);
      this.documentsService.assertOwner(found.document, user);

      if (found.document.instrumentId) return;

      const orderedItemIds = this.itemIdsInBlockOrder(found.document.content.blocks);
      if (orderedItemIds.length === 0) {
        throw new BadRequestException(
          'El material no tiene preguntas. Agrega ítems del banco antes de prepararlo para aplicar.',
        );
      }

      const [instrument] = await tx
        .insert(instruments)
        .values({
          orgId,
          name: found.document.title,
          type: 'custom',
          status: 'draft',
          isOfficial: false,
          subjectId: found.document.subjectId,
          gradeId: found.document.gradeId,
          createdById: user.userId,
        })
        .returning();
      if (!instrument) throw new Error('No se pudo crear el instrumento');

      const [section] = await tx
        .insert(instrumentSections)
        .values({
          instrumentId: instrument.id,
          orgId,
          name: 'Preguntas',
          type: 'mixed',
          order: 0,
        })
        .returning();
      if (!section) throw new Error('No se pudo crear la sección del instrumento');

      const rows = await tx
        .select()
        .from(items)
        .where(
          and(
            inArray(items.id, orderedItemIds),
            or(eq(items.orgId, orgId), isNull(items.orgId)),
            isNull(items.deletedAt),
          ),
        );
      const rowsById = new Map(rows.map((row) => [row.id, row]));

      const replacementByItemId = new Map<string, Item>();
      let position = 0;
      for (const itemId of orderedItemIds) {
        const item = rowsById.get(itemId);
        if (!item) {
          throw new BadRequestException(
            'El material referencia ítems que ya no existen. Ábrelo en el editor y elimínalos.',
          );
        }
        position += 1;
        const attachable = item.orgId === orgId && item.instrumentId === null;
        const linked = attachable
          ? await this.attachToInstrument(tx, item, instrument.id, section.id, position)
          : await this.cloneIntoInstrument(tx, item, instrument.id, section.id, position, orgId, user);
        replacementByItemId.set(itemId, linked);
      }

      const blocks = found.document.content.blocks.map((block) => {
        if (block.type !== 'item') return block;
        const linked = replacementByItemId.get(block.itemId);
        if (!linked || linked.id === block.itemId) return block;
        return { ...block, itemId: linked.id, snapshot: buildItemSnapshot(linked) };
      });
      const nextContent = { ...found.document.content, blocks };

      await tx
        .update(documents)
        .set({ instrumentId: instrument.id, content: nextContent, updatedAt: new Date() })
        .where(eq(documents.id, documentId));
      await this.documentsService.syncItemRefs(
        tx,
        documentId,
        found.document.orgId,
        collectItemBlockIds(nextContent),
      );
    });

    return this.documentsService.get(user, documentId);
  }

  private itemIdsInBlockOrder(blocks: Array<{ type: string }>): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const block of blocks) {
      if (block.type !== 'item') continue;
      const itemBlock = block as { type: 'item'; itemId: string };
      if (seen.has(itemBlock.itemId)) continue;
      seen.add(itemBlock.itemId);
      ordered.push(itemBlock.itemId);
    }
    return ordered;
  }

  private async attachToInstrument(
    tx: Database,
    item: Item,
    instrumentId: string,
    sectionId: string,
    position: number,
  ): Promise<Item> {
    const [updated] = await tx
      .update(items)
      .set({ instrumentId, sectionId, position, updatedAt: new Date() })
      .where(eq(items.id, item.id))
      .returning();
    if (!updated) throw new Error('No se pudo vincular el ítem al instrumento');
    return updated;
  }

  private async cloneIntoInstrument(
    tx: Database,
    original: Item,
    instrumentId: string,
    sectionId: string,
    position: number,
    orgId: string,
    user: JwtPayload,
  ): Promise<Item> {
    const [clone] = await tx
      .insert(items)
      .values({
        orgId,
        instrumentId,
        sectionId,
        position,
        type: original.type,
        content: original.content,
        scoringConfig: original.scoringConfig ?? {},
        status: 'draft',
        source: 'custom',
        difficulty: original.difficulty,
        createdById: user.userId,
      })
      .returning();
    if (!clone) throw new Error('No se pudo copiar el ítem al instrumento');

    const tags = await tx
      .select()
      .from(itemTaxonomyTags)
      .where(eq(itemTaxonomyTags.itemId, original.id));
    if (tags.length > 0) {
      await tx.insert(itemTaxonomyTags).values(
        tags.map((tag) => ({
          itemId: clone.id,
          nodeId: tag.nodeId,
          tagType: tag.tagType,
          confidence: tag.confidence,
          taggedBy: tag.taggedBy,
        })),
      );
    }
    return clone;
  }
}
