import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { itemTaxonomyTags, taxonomyNodes, withOrgContext } from '@soe/db';
import type { DocumentSpecRow, DocumentSpecificationResponse } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { DocumentsService } from './documents.service';

type SpecAccumulator = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  code: string | null;
  tagType: 'primary' | 'secondary';
  itemIds: Set<string>;
};

@Injectable()
export class DocumentSpecificationService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  async getSpecification(
    user: JwtPayload,
    documentId: string,
  ): Promise<DocumentSpecificationResponse> {
    const orgId = this.documentsService.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.documentsService.findVisibleOrThrow(tx, orgId, user, documentId);

      const positionsByItemId = new Map<string, number[]>();
      let position = 0;
      for (const block of found.document.content.blocks) {
        if (block.type !== 'item') continue;
        position += 1;
        (positionsByItemId.get(block.itemId) ?? this.seed(positionsByItemId, block.itemId)).push(
          position,
        );
      }

      const itemIds = [...positionsByItemId.keys()];
      if (itemIds.length === 0) {
        return {
          documentId,
          totalItems: 0,
          taggedItems: 0,
          untaggedItems: 0,
          rows: [],
        };
      }

      const tagRows = await tx
        .select({
          itemId: itemTaxonomyTags.itemId,
          tagType: itemTaxonomyTags.tagType,
          nodeId: taxonomyNodes.id,
          nodeName: taxonomyNodes.name,
          nodeType: taxonomyNodes.type,
          code: taxonomyNodes.code,
        })
        .from(itemTaxonomyTags)
        .innerJoin(taxonomyNodes, eq(itemTaxonomyTags.nodeId, taxonomyNodes.id))
        .where(inArray(itemTaxonomyTags.itemId, itemIds));

      const byNodeAndTagType = new Map<string, SpecAccumulator>();
      const taggedItemIds = new Set<string>();
      for (const row of tagRows) {
        taggedItemIds.add(row.itemId);
        const key = `${row.nodeId}:${row.tagType}`;
        let accumulator = byNodeAndTagType.get(key);
        if (!accumulator) {
          accumulator = {
            nodeId: row.nodeId,
            nodeName: row.nodeName,
            nodeType: row.nodeType,
            code: row.code,
            tagType: row.tagType,
            itemIds: new Set(),
          };
          byNodeAndTagType.set(key, accumulator);
        }
        accumulator.itemIds.add(row.itemId);
      }

      const rows: DocumentSpecRow[] = [...byNodeAndTagType.values()]
        .map((accumulator) => ({
          nodeId: accumulator.nodeId,
          nodeName: accumulator.nodeName,
          nodeType: accumulator.nodeType,
          code: accumulator.code,
          tagType: accumulator.tagType,
          itemCount: accumulator.itemIds.size,
          itemPositions: [...accumulator.itemIds]
            .flatMap((itemId) => positionsByItemId.get(itemId) ?? [])
            .sort((a, b) => a - b),
        }))
        .sort((a, b) => {
          if (a.tagType !== b.tagType) return a.tagType === 'primary' ? -1 : 1;
          return a.nodeName.localeCompare(b.nodeName, 'es');
        });

      return {
        documentId,
        totalItems: itemIds.length,
        taggedItems: taggedItemIds.size,
        untaggedItems: itemIds.length - taggedItemIds.size,
        rows,
      };
    });
  }

  private seed(map: Map<string, number[]>, itemId: string): number[] {
    const list: number[] = [];
    map.set(itemId, list);
    return list;
  }
}
