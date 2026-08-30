import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { instruments, items, sheetLayouts, withOrgContext } from '@soe/db';
import type { SheetLayout } from '@soe/db';
import {
  layoutHash,
  type FreezeLayoutResponse,
  type ItemContent,
  type ItemType,
  type LayoutDraftModel,
  type LayoutSpec,
  type PaginatedResponse,
  type SheetLayoutModel,
  type SheetLayoutQueryDto,
  type SheetLayoutSummaryModel,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import {
  collectInvariantViolations,
  deriveLayoutDraft,
  type DerivableItem,
} from './sheet-layout.helpers';

@Injectable()
export class SheetLayoutService {
  constructor(@InjectDb() private readonly db: Database) {}

  async deriveDraft(orgId: string, instrumentId: string): Promise<LayoutDraftModel> {
    await this.requireVisibleInstrument(orgId, instrumentId);
    const derivableItems = await this.loadDerivableItems(instrumentId);
    return deriveLayoutDraft(instrumentId, derivableItems);
  }

  async freeze(orgId: string, userId: string, spec: LayoutSpec): Promise<FreezeLayoutResponse> {
    await this.requireVisibleInstrument(orgId, spec.instrumentId);
    const derivableItems = await this.loadDerivableItems(spec.instrumentId);

    const violations = collectInvariantViolations(spec, derivableItems);
    if (violations.length > 0) {
      const first = violations[0]!;
      throw new BadRequestException(`Invariante ${first.invariant} violado: ${first.message}`);
    }

    const specHash = layoutHash(spec);

    return withOrgContext(this.db, orgId, async (tx) => {
      const [maxRow] = await tx
        .select({ maxVersion: sql<number>`coalesce(max(${sheetLayouts.version}), 0)` })
        .from(sheetLayouts)
        .where(and(eq(sheetLayouts.orgId, orgId), eq(sheetLayouts.instrumentId, spec.instrumentId)));

      const version = Number(maxRow?.maxVersion ?? 0) + 1;

      const [inserted] = await tx
        .insert(sheetLayouts)
        .values({
          orgId,
          instrumentId: spec.instrumentId,
          version,
          spec,
          specHash,
          createdById: userId,
        })
        .returning({ id: sheetLayouts.id });

      if (!inserted) throw new Error('sheet_layouts insert returned no row');
      return { layoutId: inserted.id, version, specHash };
    });
  }

  async getFrozen(orgId: string, layoutId: string): Promise<SheetLayoutModel> {
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [layout] = await tx
        .select()
        .from(sheetLayouts)
        .where(and(eq(sheetLayouts.orgId, orgId), eq(sheetLayouts.id, layoutId)))
        .limit(1);
      return layout;
    });

    if (!row) throw new NotFoundException('Layout de hoja no encontrado');
    return { ...this.toSummary(row), spec: row.spec };
  }

  async list(
    orgId: string,
    query: SheetLayoutQueryDto,
  ): Promise<PaginatedResponse<SheetLayoutSummaryModel>> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const where = and(
        eq(sheetLayouts.orgId, orgId),
        query.instrumentId ? eq(sheetLayouts.instrumentId, query.instrumentId) : undefined,
      );

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(sheetLayouts)
        .where(where);

      const rows = await tx
        .select()
        .from(sheetLayouts)
        .where(where)
        .orderBy(desc(sheetLayouts.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      return {
        data: rows.map((row) => this.toSummary(row)),
        total: Number(countRow?.total ?? 0),
        page: query.page,
        limit: query.limit,
      };
    });
  }

  private toSummary(row: SheetLayout): SheetLayoutSummaryModel {
    return {
      id: row.id,
      instrumentId: row.instrumentId,
      version: row.version,
      specHash: row.specHash,
      pageCount: row.spec.pageCount,
      fieldCount: row.spec.fields.length,
      createdById: row.createdById,
      createdAt: row.createdAt,
    };
  }

  private async requireVisibleInstrument(orgId: string, instrumentId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: instruments.id })
      .from(instruments)
      .where(
        and(
          eq(instruments.id, instrumentId),
          isNull(instruments.deletedAt),
          or(eq(instruments.orgId, orgId), isNull(instruments.orgId)),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Instrumento no encontrado o no visible para tu organización');
    }
  }

  private async loadDerivableItems(instrumentId: string): Promise<DerivableItem[]> {
    const rows = await this.db
      .select({
        id: items.id,
        position: items.position,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
      .orderBy(items.position);

    return rows.map((row) => {
      const scoringConfig = (row.scoringConfig ?? {}) as { printedNumber?: unknown };
      return {
        id: row.id,
        position: row.position,
        printedNumber:
          typeof scoringConfig.printedNumber === 'string' ? scoringConfig.printedNumber : null,
        type: row.type as ItemType,
        content: (row.content ?? {}) as ItemContent,
      };
    });
  }
}
