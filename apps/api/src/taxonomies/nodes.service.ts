import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { itemTaxonomyTags, taxonomyNodes, type TaxonomyNode } from '@soe/db';
import type {
  CreateTaxonomyNodeDto,
  ListTaxonomyNodesQueryDto,
  UpdateTaxonomyNodeDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { TaxonomiesService } from './taxonomies.service';

@Injectable()
export class NodesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly taxonomiesService: TaxonomiesService,
  ) {}

  async list(filters: ListTaxonomyNodesQueryDto, user: JwtPayload) {
    // Verifica acceso al currículum antes de filtrar nodos.
    await this.taxonomiesService.getById(filters.taxonomyId, user);

    const conditions = [eq(taxonomyNodes.taxonomyId, filters.taxonomyId)];
    if (filters.gradeId) conditions.push(eq(taxonomyNodes.gradeId, filters.gradeId));
    if (filters.subjectId) conditions.push(eq(taxonomyNodes.subjectId, filters.subjectId));
    if (filters.type) conditions.push(eq(taxonomyNodes.type, filters.type));
    if (filters.parentId) conditions.push(eq(taxonomyNodes.parentId, filters.parentId));

    return this.db
      .select()
      .from(taxonomyNodes)
      .where(and(...conditions))
      .orderBy(taxonomyNodes.depth, taxonomyNodes.order);
  }

  async getById(id: string, user: JwtPayload): Promise<TaxonomyNode> {
    const [node] = await this.db.select().from(taxonomyNodes).where(eq(taxonomyNodes.id, id));
    if (!node) throw new NotFoundException('Nodo no encontrado');
    await this.taxonomiesService.getById(node.taxonomyId, user);
    return node;
  }

  async create(dto: CreateTaxonomyNodeDto, user: JwtPayload) {
    const taxonomy = await this.taxonomiesService.getById(dto.taxonomyId, user);
    this.taxonomiesService.assertEditable(taxonomy, user);

    let depth = 0;
    if (dto.parentId) {
      const [parent] = await this.db
        .select({
          id: taxonomyNodes.id,
          depth: taxonomyNodes.depth,
          taxonomyId: taxonomyNodes.taxonomyId,
        })
        .from(taxonomyNodes)
        .where(eq(taxonomyNodes.id, dto.parentId));

      if (!parent) throw new BadRequestException('Nodo padre no encontrado');
      if (parent.taxonomyId !== dto.taxonomyId) {
        throw new BadRequestException('El nodo padre pertenece a otro currículum');
      }
      depth = parent.depth + 1;
    }

    const [created] = await this.db
      .insert(taxonomyNodes)
      .values({
        taxonomyId: dto.taxonomyId,
        parentId: dto.parentId ?? null,
        type: dto.type,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        gradeId: dto.gradeId ?? null,
        subjectId: dto.subjectId ?? null,
        order: dto.order ?? 0,
        depth,
        metadata: dto.metadata ?? {},
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo crear el nodo');
    return created;
  }

  async update(id: string, dto: UpdateTaxonomyNodeDto, user: JwtPayload) {
    const existing = await this.getById(id, user);
    const taxonomy = await this.taxonomiesService.getById(existing.taxonomyId, user);
    this.taxonomiesService.assertEditable(taxonomy, user);

    let nextDepth = existing.depth;
    if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Un nodo no puede ser su propio padre');
      }

      if (dto.parentId === null) {
        nextDepth = 0;
      } else {
        await this.assertNoCycle(id, dto.parentId, existing.taxonomyId);
        const [parent] = await this.db
          .select({ depth: taxonomyNodes.depth, taxonomyId: taxonomyNodes.taxonomyId })
          .from(taxonomyNodes)
          .where(eq(taxonomyNodes.id, dto.parentId));

        if (!parent) throw new BadRequestException('Nodo padre no encontrado');
        if (parent.taxonomyId !== existing.taxonomyId) {
          throw new BadRequestException('El nodo padre pertenece a otro currículum');
        }
        nextDepth = parent.depth + 1;
      }
    }

    const depthDelta = nextDepth - existing.depth;

    const [updated] = await this.db
      .update(taxonomyNodes)
      .set({
        ...(dto.parentId !== undefined && { parentId: dto.parentId ?? null }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.gradeId !== undefined && { gradeId: dto.gradeId ?? null }),
        ...(dto.subjectId !== undefined && { subjectId: dto.subjectId ?? null }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
        depth: nextDepth,
      })
      .where(eq(taxonomyNodes.id, id))
      .returning();

    if (depthDelta !== 0) await this.shiftDescendantsDepth(id, depthDelta);

    return updated;
  }

  async remove(id: string, user: JwtPayload, opts: { cascade?: boolean } = {}) {
    const existing = await this.getById(id, user);
    const taxonomy = await this.taxonomiesService.getById(existing.taxonomyId, user);
    this.taxonomiesService.assertEditable(taxonomy, user);

    const [{ tagCount }] = await this.db
      .select({ tagCount: sql<number>`count(*)::int` })
      .from(itemTaxonomyTags)
      .where(eq(itemTaxonomyTags.nodeId, id));

    if (tagCount > 0) {
      throw new ConflictException(
        `El nodo tiene ${tagCount} ítem(s) etiquetados. Elimina primero los tags.`,
      );
    }

    const [{ childCount }] = await this.db
      .select({ childCount: sql<number>`count(*)::int` })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.parentId, id));

    if (childCount > 0 && !opts.cascade) {
      throw new ConflictException(
        `El nodo tiene ${childCount} hijo(s). Usa cascade=true para eliminar el subárbol.`,
      );
    }

    // taxonomy_nodes.parent_id no tiene FK con ON DELETE CASCADE, así que
    // borrar solo el nodo raíz dejaría hijos huérfanos. Para cascade=true
    // calculamos el subárbol completo y lo borramos explícitamente; para
    // cascade=false aquí ya sabemos que childCount = 0, basta borrar el nodo.
    if (opts.cascade) {
      const subtreeIds = await this.collectSubtreeIds(id);
      const [{ subTagCount }] = await this.db
        .select({ subTagCount: sql<number>`count(*)::int` })
        .from(itemTaxonomyTags)
        .where(inArray(itemTaxonomyTags.nodeId, subtreeIds));

      if (subTagCount > 0) {
        throw new ConflictException(
          `El subárbol contiene nodos con ítems etiquetados. Elimina los tags antes de borrar.`,
        );
      }

      await this.db.delete(taxonomyNodes).where(inArray(taxonomyNodes.id, subtreeIds));
    } else {
      await this.db.delete(taxonomyNodes).where(eq(taxonomyNodes.id, id));
    }
  }

  /**
   * Recorre los ancestros candidatos a partir de `newParentId` para verificar
   * que `nodeId` (el que se está moviendo) NO aparece en la cadena.
   * Si aparece, hay ciclo.
   */
  private async assertNoCycle(nodeId: string, newParentId: string, taxonomyId: string) {
    let current: string | null = newParentId;
    const visited = new Set<string>();
    while (current) {
      if (current === nodeId) {
        throw new BadRequestException('Movimiento inválido: crearía un ciclo en el árbol');
      }
      if (visited.has(current)) break; // protección contra ciclos preexistentes
      visited.add(current);

      const [parent]: Array<{ parentId: string | null }> = await this.db
        .select({ parentId: taxonomyNodes.parentId })
        .from(taxonomyNodes)
        .where(and(eq(taxonomyNodes.id, current), eq(taxonomyNodes.taxonomyId, taxonomyId)));
      current = parent?.parentId ?? null;
    }
  }

  /**
   * Recalcula la profundidad de todos los descendientes de `nodeId` desplazándola
   * por `delta`. Usa un CTE recursivo de Postgres.
   */
  private async shiftDescendantsDepth(nodeId: string, delta: number) {
    if (delta === 0) return;
    await this.db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM taxonomy_nodes WHERE parent_id = ${nodeId}
        UNION ALL
        SELECT t.id FROM taxonomy_nodes t
        INNER JOIN descendants d ON t.parent_id = d.id
      )
      UPDATE taxonomy_nodes
      SET depth = depth + ${delta}
      WHERE id IN (SELECT id FROM descendants)
    `);
  }

  /** Recolecta los IDs del subárbol que cuelga de `nodeId` (incluye el propio nodo). */
  private async collectSubtreeIds(nodeId: string): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM taxonomy_nodes WHERE id = ${nodeId}
        UNION ALL
        SELECT t.id FROM taxonomy_nodes t
        INNER JOIN subtree s ON t.parent_id = s.id
      )
      SELECT id FROM subtree
    `);
    return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
  }
}
