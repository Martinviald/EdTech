import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  instruments,
  items,
  itemTaxonomyTags,
  taxonomyNodes,
} from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { parseExcelBuffer, type ParsedSheet } from './lib/excel-parser';
import {
  findMatchingNode,
  type ColumnMapping,
  type LinkResult,
  type TaxonomyNodeRef,
} from './lib/column-matcher';

/** Taxonomy column keys that we attempt to match against taxonomy nodes. */
const TAXONOMY_COLUMNS = ['skill', 'oa', 'content'] as const;

/** Maps our column key to the expected taxonomy node type. */
const COLUMN_TO_NODE_TYPE: Record<string, string> = {
  skill: 'skill',
  oa: 'objective',
  content: 'content',
};

@Injectable()
export class SpecTablesService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ─── Upload / Parse ───────────────────────────────────────────────────────

  /**
   * Parses an uploaded Excel/CSV buffer.
   * Returns column names, a 5-row preview, and total row count.
   */
  parseFile(buffer: Buffer): ParsedSheet {
    return parseExcelBuffer(buffer);
  }

  // ─── Link ─────────────────────────────────────────────────────────────────

  /**
   * Links spec-table rows to instrument items by creating `item_taxonomy_tags`.
   *
   * Flow:
   * 1. Verify instrument access.
   * 2. Load items for the instrument (ordered by position).
   * 3. Load taxonomy nodes for the taxonomy.
   * 4. For each row, match by position and create tags for mapped columns.
   */
  async linkToInstrument(
    instrumentId: string,
    rows: Record<string, string>[],
    mapping: ColumnMapping,
    taxonomyId: string,
    user: JwtPayload,
  ): Promise<LinkResult> {
    // 1. Verify instrument exists and belongs to the user's org (or is official)
    const instrument = await this.assertInstrumentAccess(instrumentId, user);

    // 2. Get items for this instrument, ordered by position
    const instrumentItems = await this.db
      .select({
        id: items.id,
        position: items.position,
      })
      .from(items)
      .where(
        and(
          eq(items.instrumentId, instrument.id),
          isNull(items.deletedAt),
        ),
      )
      .orderBy(items.position);

    if (instrumentItems.length === 0) {
      throw new BadRequestException(
        'El instrumento no tiene ítems. Cree los ítems primero.',
      );
    }

    // Build a map: position -> item id
    const positionMap = new Map<number, string>();
    for (const item of instrumentItems) {
      positionMap.set(item.position, item.id);
    }

    // 3. Get taxonomy nodes for the taxonomy
    const nodes: TaxonomyNodeRef[] = await this.db
      .select({
        id: taxonomyNodes.id,
        type: taxonomyNodes.type,
        code: taxonomyNodes.code,
        name: taxonomyNodes.name,
      })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.taxonomyId, taxonomyId));

    // 4. Process each row
    const result: LinkResult = {
      linked: 0,
      warnings: [],
      errors: [],
      linkedItems: [],
      unlinkedItems: [],
    };
    const tagsToInsert: Array<{
      itemId: string;
      nodeId: string;
      tagType: 'primary' | 'secondary';
      confidence: string;
      taggedBy: 'human' | 'ai';
    }> = [];

    // Posiciones de ítems que aparecieron en alguna fila de la tabla, para luego
    // detectar ítems del instrumento que quedaron fuera de la tabla.
    const seenPositions = new Set<number>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      // a. Parse position from the mapped column
      const positionRaw = row[mapping.position];
      if (positionRaw === undefined || positionRaw === '') {
        const reason = `Fila ${rowNum}: columna de posición "${mapping.position}" está vacía.`;
        result.warnings.push(reason);
        result.unlinkedItems.push({ position: null, reason });
        continue;
      }

      const position = parseInt(positionRaw, 10);
      if (isNaN(position)) {
        const reason = `Fila ${rowNum}: valor de posición "${positionRaw}" no es un número válido.`;
        result.warnings.push(reason);
        result.unlinkedItems.push({ position: null, reason });
        continue;
      }

      seenPositions.add(position);

      // b. Find item by position
      const itemId = positionMap.get(position);
      if (!itemId) {
        const reason = `No se encontró ítem con posición ${position} en el instrumento.`;
        result.warnings.push(`Fila ${rowNum}: ${reason}`);
        result.unlinkedItems.push({ position, reason });
        continue;
      }

      // c. For each taxonomy column, find matching node and prepare tag
      const matchedNodes: LinkResult['linkedItems'][number]['nodes'] = [];
      const unmatchedValues: string[] = [];

      for (const colKey of TAXONOMY_COLUMNS) {
        const columnName = mapping[colKey];
        if (!columnName) continue;

        const cellValue = row[columnName];
        if (!cellValue || cellValue.trim() === '') continue;

        const expectedType = COLUMN_TO_NODE_TYPE[colKey];
        // Primero intentamos con el tipo esperado; si no, fallback sin filtro.
        const node =
          findMatchingNode(cellValue, nodes, expectedType) ??
          findMatchingNode(cellValue, nodes);

        if (node) {
          tagsToInsert.push({
            itemId,
            nodeId: node.id,
            tagType: colKey === 'skill' || colKey === 'oa' ? 'primary' : 'secondary',
            confidence: '1.00',
            taggedBy: 'human',
          });
          matchedNodes.push({ type: node.type, name: node.name, code: node.code });
        } else {
          unmatchedValues.push(`${colKey}: "${cellValue}"`);
          result.warnings.push(
            `Fila ${rowNum}, columna "${colKey}": no se encontró nodo taxonómico para "${cellValue}".`,
          );
        }
      }

      if (matchedNodes.length > 0) {
        result.linked++;
        result.linkedItems.push({ position, nodes: matchedNodes });
      } else {
        result.unlinkedItems.push({
          position,
          reason:
            unmatchedValues.length > 0
              ? `Ningún valor coincidió con la taxonomía (${unmatchedValues.join(', ')}).`
              : 'No se mapeó ninguna columna taxonómica con contenido.',
        });
      }
    }

    // d. Ítems del instrumento que nunca aparecieron en la tabla de especificaciones.
    for (const item of instrumentItems) {
      if (!seenPositions.has(item.position)) {
        result.unlinkedItems.push({
          position: item.position,
          reason: 'El ítem no aparece en la tabla de especificaciones.',
        });
      }
    }

    // Ordenar para una lectura predecible (posiciones nulas al final).
    result.linkedItems.sort((a, b) => a.position - b.position);
    result.unlinkedItems.sort(
      (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
    );

    // 5. Bulk insert tags (with conflict handling — skip duplicates)
    if (tagsToInsert.length > 0) {
      try {
        await this.db
          .insert(itemTaxonomyTags)
          .values(tagsToInsert)
          .onConflictDoNothing();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Error al guardar tags: ${message}`);
      }
    }

    return result;
  }

  // ─── Get Spec Table ───────────────────────────────────────────────────────

  /**
   * Returns the "spec table view" for an instrument: items with their taxonomy tags.
   */
  async getSpecTable(instrumentId: string, user: JwtPayload) {
    await this.assertInstrumentAccess(instrumentId, user);

    // Get items with their taxonomy tags
    const instrumentItems = await this.db
      .select({
        id: items.id,
        position: items.position,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(
        and(
          eq(items.instrumentId, instrumentId),
          isNull(items.deletedAt),
        ),
      )
      .orderBy(items.position);

    if (instrumentItems.length === 0) {
      return { items: [] };
    }

    const itemIds = instrumentItems.map((it) => it.id);

    // Get all tags for these items
    const tags = await this.db
      .select({
        id: itemTaxonomyTags.id,
        itemId: itemTaxonomyTags.itemId,
        nodeId: itemTaxonomyTags.nodeId,
        tagType: itemTaxonomyTags.tagType,
        confidence: itemTaxonomyTags.confidence,
        taggedBy: itemTaxonomyTags.taggedBy,
        taggedAt: itemTaxonomyTags.taggedAt,
        nodeName: taxonomyNodes.name,
        nodeType: taxonomyNodes.type,
        nodeCode: taxonomyNodes.code,
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(itemTaxonomyTags.nodeId, taxonomyNodes.id))
      .where(inArray(itemTaxonomyTags.itemId, itemIds));

    // Group tags by item id
    const tagsByItemId = new Map<string, typeof tags>();
    for (const tag of tags) {
      const existing = tagsByItemId.get(tag.itemId) ?? [];
      existing.push(tag);
      tagsByItemId.set(tag.itemId, existing);
    }

    // Compose response
    const specTableItems = instrumentItems.map((item) => {
      const itemTags = tagsByItemId.get(item.id) ?? [];
      return {
        id: item.id,
        position: item.position,
        type: item.type,
        content: item.content,
        scoringConfig: item.scoringConfig,
        tags: itemTags.map((t) => ({
          id: t.id,
          nodeId: t.nodeId,
          tagType: t.tagType,
          confidence: t.confidence,
          taggedBy: t.taggedBy,
          taggedAt: t.taggedAt,
          node: {
            name: t.nodeName,
            type: t.nodeType,
            code: t.nodeCode,
          },
        })),
      };
    });

    return { items: specTableItems };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Verifies that the instrument exists and the user has access to it
   * (official instruments are visible to all, org instruments only to org members).
   */
  private async assertInstrumentAccess(
    instrumentId: string,
    user: JwtPayload,
  ) {
    const [instrument] = await this.db
      .select()
      .from(instruments)
      .where(
        and(
          eq(instruments.id, instrumentId),
          isNull(instruments.deletedAt),
        ),
      );

    if (!instrument) {
      throw new NotFoundException('Instrumento no encontrado');
    }

    // Platform admins can access everything
    if (user.isPlatformAdmin) return instrument;

    // Official instruments are visible to all
    if (instrument.isOfficial) return instrument;

    // Org-specific instruments require matching org
    if (!user.orgId || instrument.orgId !== user.orgId) {
      throw new ForbiddenException(
        'No tienes acceso a este instrumento',
      );
    }

    return instrument;
  }
}
