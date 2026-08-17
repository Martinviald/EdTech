import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  documentItemRefs,
  documents,
  items,
  users,
  withOrgContext,
  type Document,
} from '@soe/db';
import {
  DOCUMENT_CONTENT_VERSION,
  type CreateDocumentDto,
  type DocumentContent,
  type DocumentListItem,
  type DocumentListQueryDto,
  type DocumentListResponse,
  type DocumentModel,
  type UpdateDocumentDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { collectItemBlockIds, summarizeContent } from './documents.helpers';

type DocumentWithAuthor = { document: Document; createdByName: string | null };

@Injectable()
export class DocumentsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(user: JwtPayload, query: DocumentListQueryDto): Promise<DocumentListResponse> {
    const orgId = this.requireOrgId(user);
    const { page, pageSize } = query;

    return withOrgContext(this.db, orgId, async (tx) => {
      const conditions = [
        isNull(documents.deletedAt),
        this.visibleCondition(orgId, user.userId),
      ];
      if (query.type) conditions.push(eq(documents.type, query.type));
      if (query.status) conditions.push(eq(documents.status, query.status));
      if (query.visibility) conditions.push(eq(documents.visibility, query.visibility));
      if (query.subjectId) conditions.push(eq(documents.subjectId, query.subjectId));
      if (query.gradeId) conditions.push(eq(documents.gradeId, query.gradeId));
      if (query.mine) conditions.push(eq(documents.createdById, user.userId));
      if (query.q) conditions.push(ilike(documents.title, `%${query.q}%`));

      const where = and(...conditions);
      const [rows, totalResult] = await Promise.all([
        tx
          .select({ document: documents, createdByName: users.name })
          .from(documents)
          .leftJoin(users, eq(documents.createdById, users.id))
          .where(where)
          .orderBy(desc(documents.updatedAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(documents).where(where),
      ]);

      return {
        data: rows.map((row) => this.toListItem(row.document, row.createdByName)),
        total: totalResult[0]?.total ?? 0,
        page,
        limit: pageSize,
      };
    });
  }

  async create(user: JwtPayload, dto: CreateDocumentDto): Promise<DocumentModel> {
    const orgId = this.requireOrgId(user);
    const content: DocumentContent =
      dto.content ?? { version: DOCUMENT_CONTENT_VERSION, blocks: [] };

    return withOrgContext(this.db, orgId, async (tx) => {
      const itemIds = collectItemBlockIds(content);
      await this.assertItemsUsable(tx, orgId, itemIds);

      const [inserted] = await tx
        .insert(documents)
        .values({
          orgId,
          createdById: user.userId,
          title: dto.title,
          type: dto.type,
          content,
          ...(dto.visibility ? { visibility: dto.visibility } : {}),
          subjectId: dto.subjectId ?? null,
          gradeId: dto.gradeId ?? null,
          nodeId: dto.nodeId ?? null,
          source: { kind: 'blank', refId: null },
        })
        .returning();

      if (!inserted) {
        throw new Error('No se pudo crear el material');
      }
      await this.syncItemRefs(tx, inserted.id, inserted.orgId, itemIds);
      return this.toModel(inserted, user.name);
    });
  }

  async get(user: JwtPayload, id: string): Promise<DocumentModel> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.findVisibleOrThrow(tx, orgId, user, id);
      return this.toModel(found.document, found.createdByName);
    });
  }

  async update(user: JwtPayload, id: string, dto: UpdateDocumentDto): Promise<DocumentModel> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.findVisibleOrThrow(tx, orgId, user, id);
      this.assertOwner(found.document, user);

      const patch: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.status !== undefined) patch.status = dto.status;
      if (dto.visibility !== undefined) patch.visibility = dto.visibility;
      if (dto.subjectId !== undefined) patch.subjectId = dto.subjectId;
      if (dto.gradeId !== undefined) patch.gradeId = dto.gradeId;
      if (dto.nodeId !== undefined) patch.nodeId = dto.nodeId;

      let itemIds: string[] | null = null;
      if (dto.content !== undefined) {
        itemIds = collectItemBlockIds(dto.content);
        await this.assertItemsUsable(tx, orgId, itemIds);
        patch.content = dto.content;
      }

      const [updated] = await tx
        .update(documents)
        .set(patch)
        .where(eq(documents.id, id))
        .returning();
      if (!updated) {
        throw new Error('No se pudo actualizar el material');
      }

      if (itemIds !== null) {
        await this.syncItemRefs(tx, updated.id, updated.orgId, itemIds);
      }
      return this.toModel(updated, found.createdByName);
    });
  }

  async remove(user: JwtPayload, id: string): Promise<void> {
    const orgId = this.requireOrgId(user);
    await withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.findVisibleOrThrow(tx, orgId, user, id);
      this.assertOwner(found.document, user);

      await tx
        .update(documents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(documents.id, id));
    });
  }

  async duplicate(user: JwtPayload, id: string): Promise<DocumentModel> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.findVisibleOrThrow(tx, orgId, user, id);
      const original = found.document;

      const [copy] = await tx
        .insert(documents)
        .values({
          orgId,
          createdById: user.userId,
          title: `${original.title} (copia)`,
          type: original.type,
          status: 'draft',
          visibility: 'org',
          subjectId: original.subjectId,
          gradeId: original.gradeId,
          nodeId: original.nodeId,
          instrumentId: null,
          content: original.content,
          source: { kind: 'document', refId: original.id },
          branding: null,
        })
        .returning();

      if (!copy) {
        throw new Error('No se pudo duplicar el material');
      }
      await this.syncItemRefs(tx, copy.id, copy.orgId, collectItemBlockIds(copy.content));
      return this.toModel(copy, user.name);
    });
  }

  requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }

  private visibleCondition(orgId: string, userId: string) {
    return or(
      eq(documents.createdById, userId),
      and(eq(documents.orgId, orgId), ne(documents.visibility, 'private')),
      and(isNull(documents.orgId), eq(documents.visibility, 'platform')),
    );
  }

  private isVisible(row: Document, orgId: string, userId: string): boolean {
    if (row.createdById === userId) return true;
    if (row.orgId === orgId && row.visibility !== 'private') return true;
    return row.orgId === null && row.visibility === 'platform';
  }

  async findVisibleOrThrow(
    tx: Database,
    orgId: string,
    user: JwtPayload,
    id: string,
  ): Promise<DocumentWithAuthor> {
    const [found] = await tx
      .select({ document: documents, createdByName: users.name })
      .from(documents)
      .leftJoin(users, eq(documents.createdById, users.id))
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);

    if (!found || !this.isVisible(found.document, orgId, user.userId)) {
      throw new NotFoundException('Material no encontrado');
    }
    return found;
  }

  assertOwner(row: Document, user: JwtPayload): void {
    if (row.createdById === user.userId || user.isPlatformAdmin) return;
    throw new ForbiddenException(
      'Solo el creador puede editar este material. Duplícalo para hacer tu propia versión.',
    );
  }

  private async assertItemsUsable(
    tx: Database,
    orgId: string,
    itemIds: string[],
  ): Promise<void> {
    if (itemIds.length === 0) return;

    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          inArray(items.id, itemIds),
          or(eq(items.orgId, orgId), isNull(items.orgId)),
          isNull(items.deletedAt),
        ),
      );
    const foundIds = new Set(rows.map((row) => row.id));
    const missing = itemIds.filter((itemId) => !foundIds.has(itemId));
    if (missing.length > 0) {
      throw new BadRequestException(
        `El contenido referencia ítems inexistentes o no visibles para tu organización: ${missing.join(', ')}`,
      );
    }
  }

  async syncItemRefs(
    tx: Database,
    documentId: string,
    docOrgId: string | null,
    itemIds: string[],
  ): Promise<void> {
    await tx.delete(documentItemRefs).where(eq(documentItemRefs.documentId, documentId));
    if (itemIds.length === 0) return;
    await tx
      .insert(documentItemRefs)
      .values(itemIds.map((itemId) => ({ orgId: docOrgId, documentId, itemId })));
  }

  private toModel(row: Document, createdByName: string | null): DocumentModel {
    return {
      ...this.toSharedFields(row, createdByName),
      content: row.content,
      branding: row.branding ?? null,
    };
  }

  private toListItem(row: Document, createdByName: string | null): DocumentListItem {
    return {
      ...this.toSharedFields(row, createdByName),
      ...summarizeContent(row.content),
    };
  }

  private toSharedFields(row: Document, createdByName: string | null) {
    return {
      id: row.id,
      orgId: row.orgId,
      createdById: row.createdById,
      createdByName,
      title: row.title,
      type: row.type,
      status: row.status,
      visibility: row.visibility,
      subjectId: row.subjectId,
      gradeId: row.gradeId,
      nodeId: row.nodeId,
      instrumentId: row.instrumentId,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
