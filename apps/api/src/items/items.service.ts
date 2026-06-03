import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  items,
  itemTaxonomyTags,
  itemVersions,
  taxonomyNodes,
  type Item,
} from '@soe/db';
import { userHasRole, validateItemContent } from '@soe/types';
import type { ItemContent, ItemType } from '@soe/types';
import { ZodError } from 'zod';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import type {
  CreateItemDto,
  UpdateItemDto,
  ListItemsQueryDto,
  CreateTagDto,
  BatchTagDto,
  CreateVersionDto,
} from './dto/item.dto';

@Injectable()
export class ItemsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ── Items ───────────────────────────────────────────────────────────────

  async list(user: JwtPayload, query: ListItemsQueryDto) {
    const { page, pageSize, ...filters } = query;
    const conditions = this.buildVisibilityConditions(user);

    if (filters.instrumentId) {
      conditions.push(eq(items.instrumentId, filters.instrumentId));
    }
    if (filters.sectionId) {
      conditions.push(eq(items.sectionId, filters.sectionId));
    }
    if (filters.type) {
      conditions.push(eq(items.type, filters.type));
    }
    if (filters.status) {
      conditions.push(eq(items.status, filters.status));
    }
    if (filters.source) {
      conditions.push(eq(items.source, filters.source));
    }

    // Filter by taxonomy node: find items that have a tag pointing to this node.
    if (filters.taxonomyNodeId) {
      const taggedItemIds = await this.db
        .select({ itemId: itemTaxonomyTags.itemId })
        .from(itemTaxonomyTags)
        .where(eq(itemTaxonomyTags.nodeId, filters.taxonomyNodeId));

      const ids = taggedItemIds.map((t) => t.itemId);
      if (ids.length === 0) {
        return { data: [], total: 0, page, limit: pageSize };
      }
      conditions.push(inArray(items.id, ids));
    }

    const where = and(...conditions);
    const offset = (page - 1) * pageSize;

    const [data, totalResult] = await Promise.all([
      this.db
        .select()
        .from(items)
        .where(where)
        .orderBy(items.position, items.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(items).where(where),
    ]);

    const total = totalResult[0]?.total ?? 0;

    if (data.length === 0) return { data: [], total, page, limit: pageSize };

    const allTags = await this.db
      .select({
        id: itemTaxonomyTags.id,
        itemId: itemTaxonomyTags.itemId,
        nodeId: itemTaxonomyTags.nodeId,
        tagType: itemTaxonomyTags.tagType,
        confidence: itemTaxonomyTags.confidence,
        taggedBy: itemTaxonomyTags.taggedBy,
        taggedAt: itemTaxonomyTags.taggedAt,
        node: {
          id: taxonomyNodes.id,
          name: taxonomyNodes.name,
          code: taxonomyNodes.code,
          type: taxonomyNodes.type,
          taxonomyId: taxonomyNodes.taxonomyId,
        },
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(itemTaxonomyTags.nodeId, taxonomyNodes.id))
      .where(inArray(itemTaxonomyTags.itemId, data.map((i) => i.id)));

    const tagsByItem = new Map<string, typeof allTags>();
    for (const tag of allTags) {
      const list = tagsByItem.get(tag.itemId) ?? [];
      list.push(tag);
      tagsByItem.set(tag.itemId, list);
    }

    const dataWithTags = data.map((item) => ({
      ...item,
      tags: tagsByItem.get(item.id) ?? [],
    }));

    return { data: dataWithTags, total, page, limit: pageSize };
  }

  async getById(id: string, user: JwtPayload) {
    const [row] = await this.db
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)));

    if (!row) throw new NotFoundException('Ítem no encontrado');
    this.assertVisible(row, user);

    // Populate tags with taxonomy node info
    const tags = await this.db
      .select({
        id: itemTaxonomyTags.id,
        itemId: itemTaxonomyTags.itemId,
        nodeId: itemTaxonomyTags.nodeId,
        tagType: itemTaxonomyTags.tagType,
        confidence: itemTaxonomyTags.confidence,
        taggedBy: itemTaxonomyTags.taggedBy,
        taggedAt: itemTaxonomyTags.taggedAt,
        node: {
          id: taxonomyNodes.id,
          name: taxonomyNodes.name,
          code: taxonomyNodes.code,
          type: taxonomyNodes.type,
          taxonomyId: taxonomyNodes.taxonomyId,
        },
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(itemTaxonomyTags.nodeId, taxonomyNodes.id))
      .where(eq(itemTaxonomyTags.itemId, id));

    return { ...row, tags };
  }

  async create(dto: CreateItemDto, user: JwtPayload) {
    const orgId = user.orgId;

    // El `content` polimórfico debe cumplir el schema de su `type` antes de persistir.
    const content = this.validateContent(dto.type, dto.content);

    const [created] = await this.db
      .insert(items)
      .values({
        orgId,
        instrumentId: dto.instrumentId ?? null,
        sectionId: dto.sectionId ?? null,
        position: dto.position,
        type: dto.type,
        content,
        scoringConfig: dto.scoringConfig ?? {},
        irtParams: dto.irtParams ?? {},
        status: dto.status,
        source: dto.source,
        version: 1,
        createdById: user.userId,
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo crear el ítem');

    // Create inline tags if provided
    if (dto.tags?.length) {
      for (const tag of dto.tags) {
        await this.db.insert(itemTaxonomyTags).values({
          itemId: created.id,
          nodeId: tag.nodeId,
          tagType: tag.tagType,
          confidence: tag.confidence,
          taggedBy: tag.taggedBy,
        });
      }
    }

    return this.getById(created.id, user);
  }

  async update(id: string, dto: UpdateItemDto, user: JwtPayload) {
    const existing = await this.getByIdRaw(id);
    this.assertEditable(existing, user);

    // Snapshot the current version before updating
    await this.createVersionSnapshot(existing, user.userId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    if (dto.instrumentId !== undefined) updateData.instrumentId = dto.instrumentId;
    if (dto.sectionId !== undefined) updateData.sectionId = dto.sectionId;
    if (dto.position !== undefined) updateData.position = dto.position;
    if (dto.type !== undefined) updateData.type = dto.type;
    // El content (si cambia) se valida contra el `type` efectivo: el nuevo si se
    // está cambiando, o el existente. Si solo cambia el `type` sin reenviar content,
    // re-validamos el content existente contra el nuevo type para no dejar datos
    // inconsistentes (un content MC bajo un type `gap_fill`, por ejemplo).
    const nextType = (dto.type ?? existing.type) as ItemType;
    if (dto.content !== undefined) {
      updateData.content = this.validateContent(nextType, dto.content);
    } else if (dto.type !== undefined) {
      updateData.content = this.validateContent(nextType, existing.content);
    }
    if (dto.scoringConfig !== undefined) updateData.scoringConfig = dto.scoringConfig;
    if (dto.irtParams !== undefined) updateData.irtParams = dto.irtParams;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.source !== undefined) updateData.source = dto.source;

    const [updated] = await this.db
      .update(items)
      .set(updateData)
      .where(eq(items.id, id))
      .returning();

    return updated;
  }

  async softDelete(id: string, user: JwtPayload) {
    const existing = await this.getByIdRaw(id);
    this.assertEditable(existing, user);

    await this.db
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(items.id, id));
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  async addTag(itemId: string, dto: CreateTagDto, user: JwtPayload) {
    const item = await this.getByIdRaw(itemId);
    this.assertEditable(item, user);

    const [created] = await this.db
      .insert(itemTaxonomyTags)
      .values({
        itemId,
        nodeId: dto.nodeId,
        tagType: dto.tagType,
        confidence: dto.confidence,
        taggedBy: dto.taggedBy,
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo agregar el tag');
    return created;
  }

  async removeTag(itemId: string, tagId: string, user: JwtPayload) {
    const item = await this.getByIdRaw(itemId);
    this.assertEditable(item, user);

    const [existing] = await this.db
      .select()
      .from(itemTaxonomyTags)
      .where(
        and(
          eq(itemTaxonomyTags.id, tagId),
          eq(itemTaxonomyTags.itemId, itemId),
        ),
      );

    if (!existing) throw new NotFoundException('Tag no encontrado');

    await this.db.delete(itemTaxonomyTags).where(eq(itemTaxonomyTags.id, tagId));
  }

  async batchTag(dto: BatchTagDto, user: JwtPayload) {
    // Validate all items exist and are editable
    const itemRows = await this.db
      .select()
      .from(items)
      .where(
        and(
          inArray(items.id, dto.itemIds),
          isNull(items.deletedAt),
        ),
      );

    if (itemRows.length !== dto.itemIds.length) {
      throw new NotFoundException('Uno o más ítems no fueron encontrados');
    }

    for (const item of itemRows) {
      this.assertEditable(item, user);
    }

    const results = [];
    for (const itemId of dto.itemIds) {
      const [created] = await this.db
        .insert(itemTaxonomyTags)
        .values({
          itemId,
          nodeId: dto.nodeId,
          tagType: dto.tagType,
          confidence: dto.confidence,
          taggedBy: dto.taggedBy,
        })
        .onConflictDoNothing()
        .returning();

      if (created) results.push(created);
    }

    return { created: results.length, total: dto.itemIds.length };
  }

  // ── Versions ────────────────────────────────────────────────────────────

  async listVersions(itemId: string, user: JwtPayload) {
    await this.getByIdRaw(itemId, user);

    return this.db
      .select()
      .from(itemVersions)
      .where(eq(itemVersions.itemId, itemId))
      .orderBy(itemVersions.version);
  }

  async createVersion(itemId: string, dto: CreateVersionDto, user: JwtPayload) {
    const item = await this.getByIdRaw(itemId);
    this.assertEditable(item, user);

    return this.createVersionSnapshot(item, user.userId, dto.changeNote);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Valida el `content` polimórfico contra el schema Zod de su `type`
   * (`validateItemContent` de @soe/types) y devuelve el content ya parseado.
   * Un content inválido para su tipo se traduce en un `BadRequestException`
   * con el detalle de los issues de Zod, en vez de un 500.
   */
  private validateContent(type: ItemType, content: unknown): ItemContent {
    try {
      return validateItemContent(type, content);
    } catch (error) {
      if (error instanceof ZodError) {
        const detail = error.issues
          .map((i) => {
            const path = i.path.length ? `${i.path.join('.')}: ` : '';
            return `${path}${i.message}`;
          })
          .join('; ');
        throw new BadRequestException(
          `El contenido del ítem no es válido para el tipo "${type}": ${detail}`,
        );
      }
      throw error;
    }
  }

  /**
   * Builds the base visibility + soft-delete conditions for items.
   * Official items (org_id IS NULL) are visible to everyone.
   * Custom items are filtered by the user's org_id.
   */
  private buildVisibilityConditions(user: JwtPayload) {
    const conditions = [isNull(items.deletedAt)];

    if (!user.isPlatformAdmin) {
      conditions.push(
        user.orgId
          ? or(isNull(items.orgId), eq(items.orgId, user.orgId))!
          : isNull(items.orgId),
      );
    }

    return conditions;
  }

  /** Fetch raw item (no tags), checking soft-delete. */
  private async getByIdRaw(id: string, user?: JwtPayload): Promise<Item> {
    const [row] = await this.db
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)));

    if (!row) throw new NotFoundException('Ítem no encontrado');
    if (user) this.assertVisible(row, user);
    return row;
  }

  /** Creates a version snapshot from the current item state. */
  private async createVersionSnapshot(
    item: Item,
    changedById: string,
    changeNote?: string,
  ) {
    const [version] = await this.db
      .insert(itemVersions)
      .values({
        itemId: item.id,
        version: item.version,
        content: item.content,
        irtParams: item.irtParams as Record<string, unknown> | undefined,
        changedById,
        changeNote: changeNote ?? null,
      })
      .returning();

    return version;
  }

  /** Verify the item is visible to this user. */
  assertVisible(item: Item, user: JwtPayload) {
    if (user.isPlatformAdmin) return;
    if (item.orgId === null) return; // official
    if (user.orgId && item.orgId === user.orgId) return;
    throw new ForbiddenException('No tienes acceso a este ítem');
  }

  /**
   * Verify the user can edit this item.
   * - platform_admin: can edit anything.
   * - Official items (non-admin): read-only.
   * - Custom items: must belong to the user's org.
   */
  assertEditable(item: Item, user: JwtPayload) {
    if (user.isPlatformAdmin) return;
    if (item.orgId === null) {
      throw new ForbiddenException('Los ítems oficiales son de solo lectura');
    }
    if (!user.orgId || item.orgId !== user.orgId) {
      throw new ForbiddenException('Solo puedes editar ítems de tu propia organización');
    }
  }
}
