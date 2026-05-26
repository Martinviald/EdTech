import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  instruments,
  items,
  itemTaxonomyTags,
  taxonomyNodes,
  curricula,
} from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { parseDiaPayload, type DiaParseResult } from './lib/dia-parser';
import type { DiaRawPayload } from './lib/dia-sample-data';

export interface DiaIngestionMetadata {
  curriculumId: string;
  isOfficial?: boolean;
}

export interface PreviewResult {
  instrument: DiaParseResult['instrument'];
  items: DiaParseResult['items'];
  errors: DiaParseResult['errors'];
  taxonomyMatches: TaxonomyMatchResult[];
  summary: {
    totalItems: number;
    validItems: number;
    errorCount: number;
    matchedSkills: number;
    unmatchedSkills: string[];
  };
}

export interface TaxonomyMatchResult {
  skillName: string;
  nodeId: string | null;
  nodeName: string | null;
  matched: boolean;
}

export interface ConfirmResult {
  instrumentId: string;
  itemCount: number;
  tagCount: number;
}

@Injectable()
export class DiaIngestionService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Parse and preview a DIA payload without persisting.
   * Returns parsed items, validation errors, and taxonomy match info.
   */
  async preview(
    data: DiaRawPayload,
    metadata: DiaIngestionMetadata,
    user: JwtPayload,
  ): Promise<PreviewResult> {
    const parseResult = parseDiaPayload(data);
    const taxonomyMatches = await this.matchTaxonomy(
      parseResult.items.map((i) => i.skillName),
      metadata.curriculumId,
    );

    const matchedSkills = taxonomyMatches.filter((m) => m.matched).length;
    const unmatchedSkills = [
      ...new Set(
        taxonomyMatches.filter((m) => !m.matched).map((m) => m.skillName),
      ),
    ];

    return {
      instrument: parseResult.instrument,
      items: parseResult.items,
      errors: parseResult.errors,
      taxonomyMatches,
      summary: {
        totalItems: data.items.length,
        validItems: parseResult.items.length,
        errorCount: parseResult.errors.length,
        matchedSkills,
        unmatchedSkills,
      },
    };
  }

  /**
   * Confirm ingestion: create instrument, items, and taxonomy tags in a single transaction.
   */
  async confirm(
    data: DiaRawPayload,
    metadata: DiaIngestionMetadata,
    user: JwtPayload,
  ): Promise<ConfirmResult> {
    const parseResult = parseDiaPayload(data);

    if (parseResult.errors.length > 0) {
      throw new BadRequestException({
        message: 'El payload contiene errores de validación. Use /preview primero.',
        errors: parseResult.errors,
      });
    }

    if (parseResult.items.length === 0) {
      throw new BadRequestException('No hay ítems válidos para crear');
    }

    // Verify curriculum exists
    const [curriculum] = await this.db
      .select()
      .from(curricula)
      .where(eq(curricula.id, metadata.curriculumId));

    if (!curriculum) {
      throw new NotFoundException('Currículum no encontrado');
    }

    const taxonomyMatches = await this.matchTaxonomy(
      parseResult.items.map((i) => i.skillName),
      metadata.curriculumId,
    );

    // Determine orgId: official instruments have null orgId
    const orgId = metadata.isOfficial ? null : user.orgId;

    const result = await this.db.transaction(async (tx) => {
      // 1. Create instrument
      const [newInstrument] = await tx
        .insert(instruments)
        .values({
          orgId,
          curriculumId: metadata.curriculumId,
          name: parseResult.instrument.name,
          type: 'dia',
          year: parseResult.instrument.year,
          version: parseResult.instrument.applicationPeriod,
          isOfficial: metadata.isOfficial ?? false,
          status: 'published',
          createdById: user.userId,
          config: {
            subject: parseResult.instrument.subject,
            grade: parseResult.instrument.grade,
            applicationPeriod: parseResult.instrument.applicationPeriod,
          },
        })
        .returning();

      if (!newInstrument) {
        throw new BadRequestException('No se pudo crear el instrumento');
      }

      // 2. Create items
      const itemValues = parseResult.items.map((item) => ({
        orgId,
        instrumentId: newInstrument.id,
        position: item.position,
        type: 'multiple_choice' as const,
        content: item.content as unknown as Record<string, unknown>,
        scoringConfig: { points: 1, partialCredit: false },
        status: 'published' as const,
        source: 'official' as const,
        createdById: user.userId,
      }));

      const createdItems = await tx.insert(items).values(itemValues).returning();

      // 3. Create taxonomy tags for matched skills
      let tagCount = 0;
      const tagValues: Array<{
        itemId: string;
        nodeId: string;
        tagType: 'primary';
        confidence: string;
        taggedBy: 'human';
      }> = [];

      for (const createdItem of createdItems) {
        const parsedItem = parseResult.items.find(
          (pi) => pi.position === createdItem.position,
        );
        if (!parsedItem) continue;

        const match = taxonomyMatches.find(
          (m) => m.skillName === parsedItem.skillName && m.matched,
        );
        if (match?.nodeId) {
          tagValues.push({
            itemId: createdItem.id,
            nodeId: match.nodeId,
            tagType: 'primary',
            confidence: '1.00',
            taggedBy: 'human',
          });
        }
      }

      if (tagValues.length > 0) {
        await tx.insert(itemTaxonomyTags).values(tagValues);
        tagCount = tagValues.length;
      }

      return {
        instrumentId: newInstrument.id,
        itemCount: createdItems.length,
        tagCount,
      };
    });

    return result;
  }

  /**
   * List DIA instruments visible to the user (own org + official).
   */
  async listInstruments(user: JwtPayload) {
    const conditions = [
      eq(instruments.type, 'dia'),
      isNull(instruments.deletedAt),
    ];

    // Multi-tenancy: show official (org_id IS NULL) + user's org instruments
    const visibilityCondition = user.orgId
      ? or(isNull(instruments.orgId), eq(instruments.orgId, user.orgId))
      : isNull(instruments.orgId);

    const result = await this.db
      .select()
      .from(instruments)
      .where(and(...conditions, visibilityCondition))
      .orderBy(instruments.year, instruments.name);

    return { data: result, total: result.length };
  }

  /**
   * Match skill names to taxonomy nodes in the given curriculum.
   * Uses case-insensitive matching by name.
   */
  private async matchTaxonomy(
    skillNames: string[],
    curriculumId: string,
  ): Promise<TaxonomyMatchResult[]> {
    if (skillNames.length === 0) return [];

    // Get all nodes from the curriculum for matching
    const nodes = await this.db
      .select({ id: taxonomyNodes.id, name: taxonomyNodes.name })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.curriculumId, curriculumId));

    // Build a case-insensitive lookup map
    const nodeMap = new Map<string, { id: string; name: string }>();
    for (const node of nodes) {
      nodeMap.set(node.name.toLowerCase(), { id: node.id, name: node.name });
    }

    // Deduplicate skill names while preserving all matches
    const uniqueSkills = [...new Set(skillNames)];
    const matchResults: TaxonomyMatchResult[] = [];

    for (const skillName of uniqueSkills) {
      const normalized = skillName.toLowerCase().trim();
      const match = nodeMap.get(normalized);

      matchResults.push({
        skillName,
        nodeId: match?.id ?? null,
        nodeName: match?.name ?? null,
        matched: !!match,
      });
    }

    // Return one match result per input skill name (including duplicates)
    return skillNames.map((name) => {
      const found = matchResults.find(
        (r) => r.skillName.toLowerCase().trim() === name.toLowerCase().trim(),
      );
      return found ?? { skillName: name, nodeId: null, nodeName: null, matched: false };
    });
  }
}
