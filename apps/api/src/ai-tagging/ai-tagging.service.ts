import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { instruments, items, itemTaxonomyTags, taxonomyNodes } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { LlmService } from '../llm/llm.service';
import {
  buildTaggingPrompt,
  parseAiResponse,
  type AiSuggestionRaw,
} from './lib/prompt-builder';

/** Maximum items processed per request to avoid overloading the AI API. */
const MAX_ITEMS_PER_BATCH = 10;

interface TaxonomyNodeRow {
  id: string;
  name: string;
  type: string;
  code: string | null;
}

export interface AiTagSuggestion {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  confidence: number;
  reasoning: string;
}

export interface SuggestResult {
  suggestions: Record<string, AiTagSuggestion[]>;
}

export interface ConfirmResult {
  applied: number;
  rejected: number;
}

interface ConfirmTag {
  itemId: string;
  nodeId: string;
  tagType?: 'primary' | 'secondary';
  confirmed: boolean;
}

@Injectable()
export class AiTaggingService {
  private readonly logger = new Logger(AiTaggingService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly llm: LlmService,
  ) {}

  async suggest(
    dto: { itemIds: string[]; taxonomyId: string },
    user: JwtPayload,
  ): Promise<SuggestResult> {
    if (!(await this.llm.isAvailable(user.orgId, 'ai_tagging'))) {
      throw new ServiceUnavailableException(
        'AI tagging service is not available — el proveedor LLM activo no tiene API key configurada',
      );
    }

    // 1. Validate item count
    if (dto.itemIds.length > MAX_ITEMS_PER_BATCH) {
      throw new BadRequestException(
        `Maximum ${MAX_ITEMS_PER_BATCH} items per request`,
      );
    }

    // 2. Fetch items — multi-tenancy: orgId matches user OR is null (shared items), and not deleted
    const orgCondition = user.orgId
      ? or(eq(items.orgId, user.orgId), isNull(items.orgId))
      : isNull(items.orgId);

    const fetchedItems = await this.db
      .select({
        id: items.id,
        type: items.type,
        content: items.content,
      })
      .from(items)
      .where(
        and(
          inArray(items.id, dto.itemIds),
          orgCondition,
          isNull(items.deletedAt),
        ),
      );

    if (fetchedItems.length === 0) {
      throw new NotFoundException('No accessible items found for the given IDs');
    }

    // 3. Derive the (subject, grade) scopes from the items' instruments so we
    //    can narrow the taxonomy slice we feed to the LLM. Less noise → better
    //    suggestions, lower input cost.
    const instrumentScopes = await this.db
      .selectDistinct({
        subjectId: instruments.subjectId,
        gradeId: instruments.gradeId,
      })
      .from(items)
      .innerJoin(instruments, eq(items.instrumentId, instruments.id))
      .where(inArray(items.id, dto.itemIds));

    const subjectIds = [
      ...new Set(
        instrumentScopes
          .map((s) => s.subjectId)
          .filter((id): id is string => !!id),
      ),
    ];
    const gradeIds = [
      ...new Set(
        instrumentScopes
          .map((s) => s.gradeId)
          .filter((id): id is string => !!id),
      ),
    ];

    // Universal nodes (subjectId/gradeId NULL) are always included — they
    // represent cross-cutting skills that apply regardless of subject/grade.
    const subjectFilter =
      subjectIds.length > 0
        ? or(
            isNull(taxonomyNodes.subjectId),
            inArray(taxonomyNodes.subjectId, subjectIds),
          )
        : undefined;

    const gradeFilter =
      gradeIds.length > 0
        ? or(
            isNull(taxonomyNodes.gradeId),
            inArray(taxonomyNodes.gradeId, gradeIds),
          )
        : undefined;

    // 4. Fetch taxonomy nodes for the specified taxonomy, scoped to the
    //    items' subject/grade plus universal nodes.
    const nodes = await this.db
      .select({
        id: taxonomyNodes.id,
        name: taxonomyNodes.name,
        type: taxonomyNodes.type,
        code: taxonomyNodes.code,
      })
      .from(taxonomyNodes)
      .where(
        and(
          eq(taxonomyNodes.taxonomyId, dto.taxonomyId),
          subjectFilter,
          gradeFilter,
        ),
      );

    if (nodes.length === 0) {
      throw new NotFoundException(
        'No taxonomy nodes found for the specified taxonomy',
      );
    }

    // Build a lookup map for node validation and enrichment
    const nodeMap = new Map<string, TaxonomyNodeRow>(
      nodes.map((n: TaxonomyNodeRow) => [n.id, n]),
    );

    // 4. For each item, build prompt and call Claude
    const suggestions: Record<string, AiTagSuggestion[]> = {};

    for (const item of fetchedItems) {
      const prompt = buildTaggingPrompt(
        { id: item.id, type: item.type, content: item.content },
        nodes,
      );

      let rawResponse: string;
      try {
        rawResponse = await this.llm.complete(
          prompt.system,
          prompt.user,
          user.orgId,
          'ai_tagging',
        );
      } catch (err) {
        this.logger.error(
          `LLM call failed for item ${item.id}`,
          err instanceof Error ? err.stack : String(err),
        );
        throw new ServiceUnavailableException(
          'AI tagging service temporarily unavailable',
        );
      }

      // 5. Parse response
      let parsed = parseAiResponse(rawResponse);

      // If parsing returned empty but response was not empty, retry once
      if (parsed.length === 0 && rawResponse.trim().length > 0) {
        this.logger.warn(
          `Invalid JSON from LLM for item ${item.id}, retrying once`,
        );
        try {
          rawResponse = await this.llm.complete(
            prompt.system,
            prompt.user,
            user.orgId,
            'ai_tagging',
          );
          parsed = parseAiResponse(rawResponse);
        } catch (retryErr) {
          this.logger.error(
            `Retry failed for item ${item.id}`,
            retryErr instanceof Error ? retryErr.stack : String(retryErr),
          );
          // Continue with empty suggestions for this item
        }
      }

      // 6. Validate nodeIds exist and enrich with node metadata
      suggestions[item.id] = parsed
        .filter((s: AiSuggestionRaw) => nodeMap.has(s.nodeId))
        .map((s: AiSuggestionRaw) => {
          const node = nodeMap.get(s.nodeId)!;
          return {
            nodeId: s.nodeId,
            nodeName: node.name,
            nodeType: node.type,
            nodeCode: node.code,
            confidence: s.confidence,
            reasoning: s.reasoning,
          };
        });
    }

    return { suggestions };
  }

  async confirm(
    dto: { tags: ConfirmTag[] },
    user: JwtPayload,
  ): Promise<ConfirmResult> {
    const confirmed = dto.tags.filter((t) => t.confirmed);
    const rejected = dto.tags.filter((t) => !t.confirmed);

    if (confirmed.length === 0) {
      return { applied: 0, rejected: rejected.length };
    }

    // Validate that the referenced items belong to this user's org
    const itemIds = [...new Set(confirmed.map((t) => t.itemId))];

    const orgCondition = user.orgId
      ? or(eq(items.orgId, user.orgId), isNull(items.orgId))
      : isNull(items.orgId);

    const accessibleItems = await this.db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          inArray(items.id, itemIds),
          orgCondition,
          isNull(items.deletedAt),
        ),
      );

    const accessibleItemIds = new Set(accessibleItems.map((i: { id: string }) => i.id));

    // Validate that the referenced nodes exist
    const nodeIds = [...new Set(confirmed.map((t) => t.nodeId))];
    const existingNodes = await this.db
      .select({ id: taxonomyNodes.id })
      .from(taxonomyNodes)
      .where(inArray(taxonomyNodes.id, nodeIds));

    const existingNodeIds = new Set(existingNodes.map((n: { id: string }) => n.id));

    // Filter to only valid tags
    const validTags = confirmed.filter(
      (t) => accessibleItemIds.has(t.itemId) && existingNodeIds.has(t.nodeId),
    );

    if (validTags.length === 0) {
      return { applied: 0, rejected: dto.tags.length };
    }

    // Insert confirmed tags with taggedBy='ai' — use onConflictDoNothing for
    // items that might already have a manual tag for the same node.
    const insertValues = validTags.map((t) => ({
      itemId: t.itemId,
      nodeId: t.nodeId,
      tagType: (t.tagType ?? 'primary') as 'primary' | 'secondary',
      confidence: '1.00',
      taggedBy: 'ai' as const,
    }));

    const result = await this.db
      .insert(itemTaxonomyTags)
      .values(insertValues)
      .onConflictDoNothing({ target: [itemTaxonomyTags.itemId, itemTaxonomyTags.nodeId] })
      .returning({ id: itemTaxonomyTags.id });

    return {
      applied: result.length,
      rejected: dto.tags.length - result.length,
    };
  }
}
