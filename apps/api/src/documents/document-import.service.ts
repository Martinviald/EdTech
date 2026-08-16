import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  documents,
  instrumentSections,
  instruments,
  items,
  remedialMaterials,
  taxonomyNodes,
  withOrgContext,
  type RemedialMaterial,
} from '@soe/db';
import {
  DOCUMENT_CONTENT_VERSION,
  type Block,
  type DocumentItemSnapshot,
  type DocumentModel,
  type DocumentType,
  type RemedialGuideContent,
  type RemedialPlanContent,
  type RemedialPracticeContent,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { DocumentsService } from './documents.service';
import { buildItemSnapshot, collectItemBlockIds } from './documents.helpers';
import {
  instrumentSectionsToBlocks,
  remedialGuideToBlocks,
  remedialPlanToBlocks,
  remedialPracticeToBlocks,
} from './document-import.helpers';

const REMEDIAL_TYPE_TO_DOCUMENT_TYPE: Record<RemedialMaterial['type'], DocumentType> = {
  guide: 'guide',
  practice_set: 'worksheet',
  group_plan: 'guide',
};

@Injectable()
export class DocumentImportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  async fromRemedial(user: JwtPayload, remedialId: string): Promise<DocumentModel> {
    const orgId = this.documentsService.requireOrgId(user);

    const documentId = await withOrgContext(this.db, orgId, async (tx) => {
      const [material] = await tx
        .select()
        .from(remedialMaterials)
        .where(and(eq(remedialMaterials.id, remedialId), isNull(remedialMaterials.deletedAt)))
        .limit(1);

      if (!material) throw new NotFoundException('Material remedial no encontrado');
      if (material.status !== 'ready' && material.status !== 'approved') {
        throw new BadRequestException(
          'El material remedial aún no está listo. Espera a que termine la generación.',
        );
      }
      const effectiveContent = material.editedContent ?? material.content;
      if (!effectiveContent) {
        throw new BadRequestException('El material remedial no tiene contenido.');
      }

      const blocks = await this.remedialBlocks(tx, orgId, material, effectiveContent);
      const node = material.nodeId ? await this.findNode(tx, material.nodeId) : null;

      const [inserted] = await tx
        .insert(documents)
        .values({
          orgId,
          createdById: user.userId,
          title: material.title ?? `Material remedial — ${node?.name ?? 'refuerzo'}`,
          type: REMEDIAL_TYPE_TO_DOCUMENT_TYPE[material.type],
          content: { version: DOCUMENT_CONTENT_VERSION, blocks },
          source: { kind: 'remedial', refId: material.id },
          nodeId: material.nodeId,
          subjectId: node?.subjectId ?? null,
          gradeId: node?.gradeId ?? null,
        })
        .returning();

      if (!inserted) throw new Error('No se pudo crear el material');
      await this.documentsService.syncItemRefs(
        tx,
        inserted.id,
        inserted.orgId,
        collectItemBlockIds(inserted.content),
      );
      return inserted.id;
    });

    return this.documentsService.get(user, documentId);
  }

  async fromInstrument(user: JwtPayload, instrumentId: string): Promise<DocumentModel> {
    const orgId = this.documentsService.requireOrgId(user);

    const documentId = await withOrgContext(this.db, orgId, async (tx) => {
      const [instrument] = await tx
        .select()
        .from(instruments)
        .where(
          and(
            eq(instruments.id, instrumentId),
            or(
              eq(instruments.orgId, orgId),
              isNull(instruments.orgId),
              eq(instruments.isOfficial, true),
            ),
            isNull(instruments.deletedAt),
          ),
        )
        .limit(1);
      if (!instrument) throw new NotFoundException('Instrumento no encontrado');

      const [sections, instrumentItems] = await Promise.all([
        tx
          .select()
          .from(instrumentSections)
          .where(eq(instrumentSections.instrumentId, instrument.id))
          .orderBy(asc(instrumentSections.order)),
        tx
          .select()
          .from(items)
          .where(and(eq(items.instrumentId, instrument.id), isNull(items.deletedAt)))
          .orderBy(asc(items.position)),
      ]);
      if (instrumentItems.length === 0) {
        throw new BadRequestException(
          'El instrumento no tiene preguntas. Crea los ítems antes de generar el material.',
        );
      }

      const itemsBySection = new Map<
        string | null,
        Array<{ id: string; snapshot: DocumentItemSnapshot }>
      >();
      for (const item of instrumentItems) {
        const key = item.sectionId ?? null;
        const bucket = itemsBySection.get(key) ?? [];
        bucket.push({ id: item.id, snapshot: buildItemSnapshot(item) });
        itemsBySection.set(key, bucket);
      }

      const sectionInputs = sections
        .map((section) => ({
          id: section.id,
          name: section.name,
          instructions: section.instructions,
          passageTitle: section.passageTitle,
          passageText: section.passageText,
          items: itemsBySection.get(section.id) ?? [],
        }))
        .filter((section) => section.items.length > 0 || section.passageText);

      const orphanItems = itemsBySection.get(null) ?? [];
      if (orphanItems.length > 0) {
        sectionInputs.push({
          id: instrument.id,
          name: 'Preguntas',
          instructions: null,
          passageTitle: null,
          passageText: null,
          items: orphanItems,
        });
      }

      const blocks = instrumentSectionsToBlocks(sectionInputs);

      const [inserted] = await tx
        .insert(documents)
        .values({
          orgId,
          createdById: user.userId,
          title: instrument.name,
          type: 'assessment',
          content: { version: DOCUMENT_CONTENT_VERSION, blocks },
          source: { kind: 'instrument', refId: instrument.id },
          instrumentId: instrument.id,
          subjectId: instrument.subjectId,
          gradeId: instrument.gradeId,
        })
        .returning();

      if (!inserted) throw new Error('No se pudo crear el material');
      await this.documentsService.syncItemRefs(
        tx,
        inserted.id,
        inserted.orgId,
        collectItemBlockIds(inserted.content),
      );
      return inserted.id;
    });

    return this.documentsService.get(user, documentId);
  }

  private async remedialBlocks(
    tx: Database,
    orgId: string,
    material: RemedialMaterial,
    content: NonNullable<RemedialMaterial['content']>,
  ): Promise<Block[]> {
    if (material.type === 'guide') {
      return remedialGuideToBlocks(content as RemedialGuideContent);
    }
    if (material.type === 'group_plan') {
      return remedialPlanToBlocks(content as RemedialPlanContent);
    }

    const practice = content as RemedialPracticeContent;
    const itemIds = practice.items.map((ref) => ref.itemId);
    const stimulusSectionIds = (practice.stimuli ?? []).map((ref) => ref.sectionId);

    const [liveItems, passages] = await Promise.all([
      itemIds.length > 0
        ? tx
            .select()
            .from(items)
            .where(
              and(
                inArray(items.id, itemIds),
                or(eq(items.orgId, orgId), isNull(items.orgId)),
                isNull(items.deletedAt),
              ),
            )
        : Promise.resolve([]),
      stimulusSectionIds.length > 0
        ? tx
            .select()
            .from(instrumentSections)
            .where(
              and(
                inArray(instrumentSections.id, stimulusSectionIds),
                or(eq(instrumentSections.orgId, orgId), isNull(instrumentSections.orgId)),
              ),
            )
        : Promise.resolve([]),
    ]);

    const snapshotsByItemId = new Map(
      liveItems.map((item) => [item.id, buildItemSnapshot(item)]),
    );
    const passagesBySectionId = new Map(
      passages.map((section) => [
        section.id,
        { passageTitle: section.passageTitle, passageText: section.passageText },
      ]),
    );
    return remedialPracticeToBlocks(practice, snapshotsByItemId, passagesBySectionId);
  }

  private async findNode(tx: Database, nodeId: string) {
    const [node] = await tx
      .select({
        name: taxonomyNodes.name,
        subjectId: taxonomyNodes.subjectId,
        gradeId: taxonomyNodes.gradeId,
      })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.id, nodeId))
      .limit(1);
    return node ?? null;
  }
}
