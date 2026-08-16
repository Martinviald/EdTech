import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  documentItemRefs,
  documents,
  itemTaxonomyTags,
  items,
  withOrgContext,
  type Item,
} from '@soe/db';
import {
  ITEM_CONTENT_SCHEMAS,
  type CustomizeDocumentItemDto,
  type DocumentModel,
  type ItemContent,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { DocumentsService } from './documents.service';
import { buildItemSnapshot, collectItemBlockIds } from './documents.helpers';

@Injectable()
export class DocumentItemsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  async customize(
    user: JwtPayload,
    documentId: string,
    itemId: string,
    dto: CustomizeDocumentItemDto,
  ): Promise<DocumentModel> {
    const orgId = this.documentsService.requireOrgId(user);

    await withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.documentsService.findVisibleOrThrow(tx, orgId, user, documentId);
      this.documentsService.assertOwner(found.document, user);

      const block = found.document.content.blocks.find(
        (candidate) => candidate.type === 'item' && candidate.id === dto.blockId,
      );
      if (!block || block.type !== 'item' || block.itemId !== itemId) {
        throw new BadRequestException('El bloque indicado no referencia ese ítem.');
      }

      const [item] = await tx
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            or(eq(items.orgId, orgId), isNull(items.orgId)),
            isNull(items.deletedAt),
          ),
        )
        .limit(1);
      if (!item) throw new NotFoundException('Ítem no encontrado');

      const content = this.parseContent(item, dto.content);
      const nextItem = (await this.isOwnDraftOnlyUsedHere(tx, item, orgId, user, documentId))
        ? await this.updateInPlace(tx, item, content)
        : await this.cloneAsDraft(tx, item, content, orgId, user);

      const blocks = found.document.content.blocks.map((candidate) =>
        candidate.type === 'item' && candidate.id === dto.blockId
          ? { ...candidate, itemId: nextItem.id, snapshot: buildItemSnapshot(nextItem) }
          : candidate,
      );
      const nextContent = { ...found.document.content, blocks };

      await tx
        .update(documents)
        .set({ content: nextContent, updatedAt: new Date() })
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

  private parseContent(item: Item, raw: Record<string, unknown>): ItemContent {
    const schema = ITEM_CONTENT_SCHEMAS[item.type];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'El contenido del ítem no es válido.',
      );
    }
    return parsed.data as ItemContent;
  }

  private async isOwnDraftOnlyUsedHere(
    tx: Database,
    item: Item,
    orgId: string,
    user: JwtPayload,
    documentId: string,
  ): Promise<boolean> {
    const isOwnDraft =
      item.orgId === orgId &&
      item.createdById === user.userId &&
      item.instrumentId === null &&
      item.status === 'draft';
    if (!isOwnDraft) return false;

    const refs = await tx
      .select({ documentId: documentItemRefs.documentId })
      .from(documentItemRefs)
      .where(eq(documentItemRefs.itemId, item.id));
    return refs.every((ref) => ref.documentId === documentId);
  }

  private async updateInPlace(tx: Database, item: Item, content: ItemContent): Promise<Item> {
    const [updated] = await tx
      .update(items)
      .set({ content, version: item.version + 1, updatedAt: new Date() })
      .where(eq(items.id, item.id))
      .returning();
    if (!updated) throw new Error('No se pudo actualizar el ítem');
    return updated;
  }

  private async cloneAsDraft(
    tx: Database,
    original: Item,
    content: ItemContent,
    orgId: string,
    user: JwtPayload,
  ): Promise<Item> {
    const [clone] = await tx
      .insert(items)
      .values({
        orgId,
        instrumentId: null,
        sectionId: null,
        position: 0,
        type: original.type,
        content,
        scoringConfig: original.scoringConfig ?? {},
        status: 'draft',
        source: 'custom',
        difficulty: original.difficulty,
        createdById: user.userId,
      })
      .returning();
    if (!clone) throw new Error('No se pudo crear la copia del ítem');

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
