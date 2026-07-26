import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, isNull } from 'drizzle-orm';
import {
  itemCollectionItems,
  itemCollections,
  items,
  type Item,
  type ItemCollection,
} from '@soe/db';
import type {
  AddCollectionItemsDto,
  CreateItemCollectionDto,
  ItemCollectionDetailModel,
  ItemCollectionItemModel,
  ItemCollectionListQueryDto,
  ItemCollectionListResponse,
  ItemCollectionModel,
  ItemModel,
  MaterializeCollectionDto,
  UpdateItemCollectionDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { InstrumentsService } from '../instruments/instruments.service';
import { ItemsService } from '../items/items.service';

@Injectable()
export class ItemCollectionsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly items: ItemsService,
    private readonly instruments: InstrumentsService,
  ) {}

  async list(
    user: JwtPayload,
    query: ItemCollectionListQueryDto,
  ): Promise<ItemCollectionListResponse> {
    const orgId = this.requireOrgId(user);
    const conditions = [eq(itemCollections.orgId, orgId), isNull(itemCollections.deletedAt)];
    if (query.q) {
      conditions.push(ilike(itemCollections.name, `%${query.q}%`));
    }

    const where = and(...conditions);
    const offset = (query.page - 1) * query.limit;

    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          id: itemCollections.id,
          orgId: itemCollections.orgId,
          name: itemCollections.name,
          description: itemCollections.description,
          createdById: itemCollections.createdById,
          createdAt: itemCollections.createdAt,
          updatedAt: itemCollections.updatedAt,
          itemCount: count(itemCollectionItems.id),
        })
        .from(itemCollections)
        .leftJoin(itemCollectionItems, eq(itemCollectionItems.collectionId, itemCollections.id))
        .where(where)
        .groupBy(itemCollections.id)
        .orderBy(desc(itemCollections.updatedAt))
        .limit(query.limit)
        .offset(offset),
      this.db.select({ total: count() }).from(itemCollections).where(where),
    ]);

    const total = totalResult[0]?.total ?? 0;
    return { data: rows, total, page: query.page, limit: query.limit };
  }

  async getById(id: string, user: JwtPayload): Promise<ItemCollectionDetailModel> {
    const collection = await this.getOwnedCollection(id, user);

    const rows = await this.db
      .select({ link: itemCollectionItems, item: items })
      .from(itemCollectionItems)
      .leftJoin(items, and(eq(items.id, itemCollectionItems.itemId), isNull(items.deletedAt)))
      .where(eq(itemCollectionItems.collectionId, id))
      .orderBy(asc(itemCollectionItems.position), asc(itemCollectionItems.createdAt));

    const collectionItems: ItemCollectionItemModel[] = rows.map((row) => ({
      id: row.link.id,
      collectionId: row.link.collectionId,
      itemId: row.link.itemId,
      position: row.link.position,
      createdAt: row.link.createdAt,
      item: row.item ? this.toItemModel(row.item) : null,
    }));

    return { ...this.toModel(collection, collectionItems.length), items: collectionItems };
  }

  async create(dto: CreateItemCollectionDto, user: JwtPayload): Promise<ItemCollectionModel> {
    const orgId = this.requireOrgId(user);

    const [created] = await this.db
      .insert(itemCollections)
      .values({
        orgId,
        name: dto.name,
        description: dto.description ?? null,
        createdById: user.userId,
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo crear la lista');
    return this.toModel(created, 0);
  }

  async update(
    id: string,
    dto: UpdateItemCollectionDto,
    user: JwtPayload,
  ): Promise<ItemCollectionDetailModel> {
    await this.getOwnedCollection(id, user);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description ?? null;

    await this.db.update(itemCollections).set(updateData).where(eq(itemCollections.id, id));
    return this.getById(id, user);
  }

  async softDelete(id: string, user: JwtPayload): Promise<void> {
    await this.getOwnedCollection(id, user);
    await this.db
      .update(itemCollections)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(itemCollections.id, id));
  }

  async addItems(
    id: string,
    dto: AddCollectionItemsDto,
    user: JwtPayload,
  ): Promise<ItemCollectionDetailModel> {
    await this.getOwnedCollection(id, user);

    const uniqueIds = [...new Set(dto.itemIds)];
    const visible = await this.items.findVisibleByIds(uniqueIds, user);
    if (visible.length !== uniqueIds.length) {
      throw new NotFoundException('Uno o más ítems no están disponibles');
    }

    const existing = await this.db
      .select({ position: itemCollectionItems.position })
      .from(itemCollectionItems)
      .where(eq(itemCollectionItems.collectionId, id));

    let nextPosition = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const values = uniqueIds.map((itemId) => ({
      collectionId: id,
      itemId,
      position: nextPosition++,
    }));

    await this.db.insert(itemCollectionItems).values(values).onConflictDoNothing();
    await this.touch(id);
    return this.getById(id, user);
  }

  async removeItem(id: string, itemId: string, user: JwtPayload): Promise<void> {
    await this.getOwnedCollection(id, user);
    await this.db
      .delete(itemCollectionItems)
      .where(and(eq(itemCollectionItems.collectionId, id), eq(itemCollectionItems.itemId, itemId)));
    await this.touch(id);
  }

  async materialize(id: string, dto: MaterializeCollectionDto, user: JwtPayload) {
    const collection = await this.getOwnedCollection(id, user);

    const links = await this.db
      .select({ itemId: itemCollectionItems.itemId })
      .from(itemCollectionItems)
      .where(eq(itemCollectionItems.collectionId, id))
      .orderBy(asc(itemCollectionItems.position), asc(itemCollectionItems.createdAt));

    if (links.length === 0) {
      throw new BadRequestException('La lista no tiene ítems para crear una evaluación');
    }

    const visible = await this.items.findVisibleByIds(
      links.map((link) => link.itemId),
      user,
    );
    const byId = new Map(visible.map((item) => [item.id, item]));
    const ordered = links
      .map((link) => byId.get(link.itemId))
      .filter((item): item is Item => Boolean(item));

    if (ordered.length === 0) {
      throw new BadRequestException('Los ítems de la lista ya no están disponibles');
    }

    const instrument = await this.instruments.create(
      {
        name: dto.name?.trim() || collection.name,
        type: dto.type ?? 'custom',
        status: 'draft',
        isOfficial: false,
      },
      user,
    );

    await this.items.cloneIntoInstrument(instrument.id, ordered, user);
    return this.instruments.getById(instrument.id, user);
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException('Tu usuario no tiene un colegio activo para gestionar listas');
    }
    return user.orgId;
  }

  private async getOwnedCollection(id: string, user: JwtPayload): Promise<ItemCollection> {
    const orgId = this.requireOrgId(user);
    const [row] = await this.db
      .select()
      .from(itemCollections)
      .where(
        and(
          eq(itemCollections.id, id),
          eq(itemCollections.orgId, orgId),
          isNull(itemCollections.deletedAt),
        ),
      );

    if (!row) throw new NotFoundException('Lista no encontrada');
    return row;
  }

  private async touch(id: string): Promise<void> {
    await this.db
      .update(itemCollections)
      .set({ updatedAt: new Date() })
      .where(eq(itemCollections.id, id));
  }

  private toModel(row: ItemCollection, itemCount: number): ItemCollectionModel {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      description: row.description,
      createdById: row.createdById,
      itemCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toItemModel(row: Item): ItemModel {
    return {
      id: row.id,
      orgId: row.orgId,
      instrumentId: row.instrumentId,
      sectionId: row.sectionId,
      position: row.position,
      type: row.type,
      content: (row.content ?? {}) as Record<string, unknown>,
      scoringConfig: row.scoringConfig ?? null,
      irtParams: row.irtParams ?? null,
      status: row.status,
      version: row.version,
      source: row.source,
      difficulty: row.difficulty,
      createdById: row.createdById,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
