import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, exists, inArray, isNull, or } from 'drizzle-orm';
import {
  assessments,
  items,
  itemTaxonomyTags,
  itemVersions,
  taxonomyNodes,
  withOrgContext,
  type Item,
} from '@soe/db';
import { validateItemContent } from '@soe/types';
import type { ItemBankScope, ItemContent, ItemType } from '@soe/types';
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

/**
 * Forma NORMALIZADA y PII-free del contenido de un ítem para el asistente IA
 * (H21.6b). Aplana el `content` polimórfico a una estructura común que el modelo
 * puede leer para explicar la misconcepción detrás de un distractor. Para tipos
 * sin alternativas (open_ended, writing, …) `alternatives` va vacío y `correctKey`
 * en null. Solo contenido de la prueba — nunca datos de alumnos.
 */
export interface ItemContentForAssistant {
  itemId: string;
  position: number;
  type: ItemType;
  /** Enunciado / prompt / pasaje de la pregunta (lo que aplique según el tipo). */
  stem: string | null;
  /** Alternativas como pares clave→texto. Vacío si el tipo no las tiene. */
  alternatives: { key: string; text: string }[];
  /** Clave correcta (selección múltiple) o `V`/`F` (true_false); null si no aplica. */
  correctKey: string | null;
  /** Habilidad principal etiquetada al ítem (taxonomy tag), si existe. */
  skillName: string | null;
}

@Injectable()
export class ItemsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ── Items ───────────────────────────────────────────────────────────────

  async list(user: JwtPayload, query: ListItemsQueryDto) {
    const { page, pageSize, ...filters } = query;
    // Banco de ítems (TKT-14): el `scope` decide qué origen se lista (propio de
    // la org, global/oficial, o ambos). Nunca expone otras orgs (ver §5.2).
    const conditions = this.buildVisibilityConditions(user, filters.scope);

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

    // Filtro facetado del banco (dropdowns en cascada): asignatura, nivel y cada
    // grupo de nodos elegido se combinan con AND (intersección). Los `items` no
    // tienen subject/grade: se derivan de los nodos que los etiquetan, así que
    // cada dimensión se expresa como un EXISTS correlacionado sobre los tags.
    // Semántica: AND entre dimensiones, OR dentro de cada grupo/subconsulta.
    if (filters.subjectId) {
      conditions.push(
        exists(
          this.db
            .select()
            .from(itemTaxonomyTags)
            .innerJoin(taxonomyNodes, eq(itemTaxonomyTags.nodeId, taxonomyNodes.id))
            .where(
              and(
                eq(itemTaxonomyTags.itemId, items.id),
                eq(taxonomyNodes.subjectId, filters.subjectId),
              ),
            ),
        ),
      );
    }
    if (filters.gradeId) {
      conditions.push(
        exists(
          this.db
            .select()
            .from(itemTaxonomyTags)
            .innerJoin(taxonomyNodes, eq(itemTaxonomyTags.nodeId, taxonomyNodes.id))
            .where(
              and(
                eq(itemTaxonomyTags.itemId, items.id),
                eq(taxonomyNodes.gradeId, filters.gradeId),
              ),
            ),
        ),
      );
    }
    if (filters.taxonomyNodeGroups) {
      for (const group of filters.taxonomyNodeGroups) {
        conditions.push(
          exists(
            this.db
              .select()
              .from(itemTaxonomyTags)
              .where(
                and(
                  eq(itemTaxonomyTags.itemId, items.id),
                  inArray(itemTaxonomyTags.nodeId, group),
                ),
              ),
          ),
        );
      }
    }

    // Filtro por tags (TKT-12/TKT-14): un ítem se incluye si tiene CUALQUIERA de
    // los nodos pedidos (lógica OR). Se admite `taxonomyNodeId` (single) y
    // `taxonomyNodeIds` (multi); ambos se combinan en un único conjunto OR.
    const nodeIds = [
      ...(filters.taxonomyNodeId ? [filters.taxonomyNodeId] : []),
      ...(filters.taxonomyNodeIds ?? []),
    ];
    if (nodeIds.length > 0) {
      const taggedItemIds = await this.db
        .select({ itemId: itemTaxonomyTags.itemId })
        .from(itemTaxonomyTags)
        .where(inArray(itemTaxonomyTags.nodeId, nodeIds));

      const ids = [...new Set(taggedItemIds.map((t) => t.itemId))];
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
      .where(
        inArray(
          itemTaxonomyTags.itemId,
          data.map((i) => i.id),
        ),
      );

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

  /**
   * Lee el contenido de un ítem (enunciado + alternativas) en forma NORMALIZADA y
   * PII-free para el asistente IA (H21.6b). El ítem se resuelve por `itemId` o,
   * alternativamente, por `assessmentId` + `position` (vía instrumento → ítems).
   * Hereda el scoping de visibilidad de los demás métodos: ítems propios de la org
   * + oficiales (`org_id IS NULL`), excluyendo soft-deleted.
   *
   * La identidad SIEMPRE viene del `user` (JWT), nunca del modelo.
   */
  async getContentForAssistant(
    user: JwtPayload,
    params: { itemId?: string; assessmentId?: string; position?: number },
  ): Promise<ItemContentForAssistant> {
    const row = await this.resolveItemForAssistant(user, params);
    const skillName = await this.loadPrimarySkillName(row.id);
    return this.normalizeItemContent(row, skillName);
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
      .where(and(eq(itemTaxonomyTags.id, tagId), eq(itemTaxonomyTags.itemId, itemId)));

    if (!existing) throw new NotFoundException('Tag no encontrado');

    await this.db.delete(itemTaxonomyTags).where(eq(itemTaxonomyTags.id, tagId));
  }

  async batchTag(dto: BatchTagDto, user: JwtPayload) {
    // Validate all items exist and are editable
    const itemRows = await this.db
      .select()
      .from(items)
      .where(and(inArray(items.id, dto.itemIds), isNull(items.deletedAt)));

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
   * Builds the base visibility + soft-delete conditions for items, honouring the
   * item-bank `scope` (TKT-14):
   *  · 'global' → sólo ítems globales/oficiales (org_id IS NULL).
   *  · 'own'    → sólo ítems de la org del usuario (org_id = orgId).
   *  · 'all'    → ambos (default histórico).
   *
   * El aislamiento se mantiene SIEMPRE: un usuario no-admin nunca ve ítems de
   * otra org, independientemente del `scope` (a lo sumo restringe lo que ya podía
   * ver). `items` no es tabla RLS (sin PII); el scope es un filtro de servicio.
   */
  private buildVisibilityConditions(user: JwtPayload, scope: ItemBankScope = 'all') {
    const conditions = [isNull(items.deletedAt)];

    if (scope === 'global') {
      conditions.push(isNull(items.orgId));
      return conditions;
    }

    if (scope === 'own') {
      // Sin org (ej. platform_admin sin membership) no hay "propios": se resuelve
      // como "ninguno" para no filtrar de más — usar isNull en un uuid es siempre
      // falso para filas con org, así garantizamos 0 leaks.
      conditions.push(user.orgId ? eq(items.orgId, user.orgId) : isNull(items.id));
      return conditions;
    }

    // scope === 'all'
    if (!user.isPlatformAdmin) {
      conditions.push(
        user.orgId ? or(isNull(items.orgId), eq(items.orgId, user.orgId))! : isNull(items.orgId),
      );
    }

    return conditions;
  }

  /**
   * Resuelve el ítem para el asistente: por `itemId` directo, o por
   * `assessmentId` + `position` (el ítem en esa posición del instrumento de la
   * evaluación). Aplica visibilidad (org propia + oficiales) y soft-delete.
   * Lanza NotFound/BadRequest si no se puede resolver — la tool los captura.
   */
  private async resolveItemForAssistant(
    user: JwtPayload,
    params: { itemId?: string; assessmentId?: string; position?: number },
  ): Promise<Item> {
    if (params.itemId) {
      const conditions = [eq(items.id, params.itemId)];
      conditions.push(...this.buildVisibilityConditions(user));
      const [row] = await this.db
        .select()
        .from(items)
        .where(and(...conditions));
      if (!row) throw new NotFoundException('Ítem no encontrado');
      return row;
    }

    if (params.assessmentId && params.position !== undefined) {
      // assessmentId → instrumentId. La evaluación debe ser de la org del usuario
      // (o cualquiera si es platform_admin); el filtro de items vuelve a aplicar
      // visibilidad sobre los ítems del instrumento.
      const assessmentConditions = [eq(assessments.id, params.assessmentId)];
      if (!user.isPlatformAdmin) {
        if (!user.orgId) throw new NotFoundException('Evaluación no encontrada');
        assessmentConditions.push(eq(assessments.orgId, user.orgId));
      }
      // `assessments` tiene RLS: la lectura debe correr dentro de withOrgContext
      // para fijar app.current_org_id; si no, bajo soe_app (sin BYPASSRLS) el RLS
      // devuelve 0 filas → NotFound (§5.2). Sólo ESTA query necesita contexto: las
      // lecturas de `items`/tags de más abajo NO son tablas RLS. (platform_admin
      // sin orgId es un caso cross-org preexistente fuera de alcance: corre sin
      // contexto, igual que antes.)
      const readInstrument = (db: Database) =>
        db
          .select({ instrumentId: assessments.instrumentId })
          .from(assessments)
          .where(and(...assessmentConditions))
          .limit(1);
      const [assessment] = user.orgId
        ? await withOrgContext(this.db, user.orgId, (tx) => readInstrument(tx))
        : await readInstrument(this.db);
      if (!assessment) throw new NotFoundException('Evaluación no encontrada');

      const itemConditions = [
        eq(items.instrumentId, assessment.instrumentId),
        eq(items.position, params.position),
        ...this.buildVisibilityConditions(user),
      ];
      const [row] = await this.db
        .select()
        .from(items)
        .where(and(...itemConditions))
        .orderBy(asc(items.createdAt))
        .limit(1);
      if (!row) throw new NotFoundException('Ítem no encontrado');
      return row;
    }

    throw new BadRequestException('Debe entregar itemId o (assessmentId y position)');
  }

  /** Nombre de la habilidad principal etiquetada al ítem (primer tag), si existe. */
  private async loadPrimarySkillName(itemId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: taxonomyNodes.name })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
      .where(eq(itemTaxonomyTags.itemId, itemId))
      .orderBy(asc(itemTaxonomyTags.tagType))
      .limit(1);
    return row?.name ?? null;
  }

  /**
   * Aplana el `content` polimórfico a la forma común del asistente. Respeta el
   * modelo polimórfico: extrae stem/alternativas/clave correcta de cada `type`
   * sin hardcodear un único tipo. Tipos sin alternativas devuelven lista vacía.
   */
  private normalizeItemContent(item: Item, skillName: string | null): ItemContentForAssistant {
    const type = item.type as ItemType;
    const content = (item.content ?? {}) as Record<string, unknown>;

    const base = {
      itemId: item.id,
      position: item.position,
      type,
      skillName,
    };

    const rawAlternatives = Array.isArray(content.alternatives) ? content.alternatives : [];
    const alternatives = rawAlternatives.flatMap((alt) => {
      if (!alt || typeof alt !== 'object') return [];
      const a = alt as { key?: unknown; text?: unknown };
      if (typeof a.key !== 'string' || typeof a.text !== 'string') return [];
      return [{ key: a.key, text: a.text }];
    });

    const correctKeyFromAlternatives = (): string | null => {
      for (const alt of rawAlternatives) {
        if (!alt || typeof alt !== 'object') continue;
        const a = alt as { key?: unknown; isCorrect?: unknown };
        if (a.isCorrect === true && typeof a.key === 'string') return a.key;
      }
      return null;
    };

    const asString = (v: unknown): string | null =>
      typeof v === 'string' && v.length > 0 ? v : null;

    // El enunciado vive bajo distintas claves según el tipo (stem/prompt/passage/
    // textWithGaps). Tomamos la primera presente — sin hardcodear un único tipo.
    const stem =
      asString(content.stem) ??
      asString(content.prompt) ??
      asString(content.passage) ??
      asString(content.textWithGaps);

    if (type === 'true_false') {
      const correct =
        typeof content.correctAnswer === 'boolean' ? (content.correctAnswer ? 'V' : 'F') : null;
      return { ...base, stem, alternatives, correctKey: correct };
    }

    // multiple_choice / listening (y cualquier tipo con alternativas): clave
    // correcta desde `content.correctKey` explícito o desde la alternativa marcada.
    const correctKey = asString(content.correctKey) ?? correctKeyFromAlternatives();

    return { ...base, stem, alternatives, correctKey };
  }

  /**
   * Devuelve el ítem RAW verificando que el usuario pueda EDITARLO (no solo verlo).
   * Lo consume el flujo de propuestas de edición (TKT-19): el snapshot del `content`
   * y el chequeo de permiso de edición (org propia, no oficial) se hacen una vez,
   * antes de generar/aplicar la propuesta. Lanza 404 si no existe, 403 si no editable.
   */
  async getEditableItem(id: string, user: JwtPayload): Promise<Item> {
    const item = await this.getByIdRaw(id);
    this.assertEditable(item, user);
    return item;
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
  private async createVersionSnapshot(item: Item, changedById: string, changeNote?: string) {
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
