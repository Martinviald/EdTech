import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  assessmentForms,
  assessments,
  instruments,
  items,
  sheetLayouts,
  withOrgContext,
} from '@soe/db';
import type { SheetLayout } from '@soe/db';
import {
  layoutHash,
  type FreezeLayoutResponse,
  type ItemContent,
  type ItemType,
  type LayoutDraftModel,
  type LayoutSpec,
  type PaginatedResponse,
  type SheetIdentityMode,
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

  async deriveDraft(
    orgId: string,
    instrumentId: string,
    identityMode: SheetIdentityMode = 'qr',
    assessmentFormId: string | null = null,
  ): Promise<LayoutDraftModel> {
    await this.requireVisibleInstrument(orgId, instrumentId);
    const sectionIds = await this.resolveFormSections(orgId, assessmentFormId, instrumentId);
    const derivableItems = await this.loadDerivableItems(instrumentId, sectionIds);
    return deriveLayoutDraft(instrumentId, derivableItems, identityMode, assessmentFormId);
  }

  async freeze(orgId: string, userId: string, spec: LayoutSpec): Promise<FreezeLayoutResponse> {
    await this.requireVisibleInstrument(orgId, spec.instrumentId);
    const formId = spec.formId ?? null;
    const sectionIds = await this.resolveFormSections(orgId, formId, spec.instrumentId);
    // Con forma, la biyección del invariante 4 se evalúa contra los ítems de la
    // forma; sin forma, contra todos los del instrumento (idéntico a antes).
    const derivableItems = await this.loadDerivableItems(spec.instrumentId, sectionIds);

    const violations = collectInvariantViolations(spec, derivableItems);
    if (violations.length > 0) {
      const first = violations[0]!;
      throw new BadRequestException(`Invariante ${first.invariant} violado: ${first.message}`);
    }

    const specHash = layoutHash(spec);

    return withOrgContext(this.db, orgId, async (tx) => {
      // El versionado es por ámbito: la serie de un layout de forma es la suya,
      // independiente de la del instrumento completo.
      const [maxRow] = await tx
        .select({ maxVersion: sql<number>`coalesce(max(${sheetLayouts.version}), 0)` })
        .from(sheetLayouts)
        .where(
          and(
            eq(sheetLayouts.orgId, orgId),
            formId === null
              ? and(
                  eq(sheetLayouts.instrumentId, spec.instrumentId),
                  isNull(sheetLayouts.assessmentFormId),
                )
              : eq(sheetLayouts.assessmentFormId, formId),
          ),
        );

      const version = Number(maxRow?.maxVersion ?? 0) + 1;

      const [inserted] = await tx
        .insert(sheetLayouts)
        .values({
          orgId,
          instrumentId: spec.instrumentId,
          assessmentFormId: formId,
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
        query.assessmentFormId
          ? eq(sheetLayouts.assessmentFormId, query.assessmentFormId)
          : undefined,
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
      assessmentFormId: row.assessmentFormId ?? null,
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

  /**
   * Secciones que componen la forma, o `null` si el layout es del instrumento
   * completo. Valida además que la forma pertenezca al instrumento del layout:
   * una forma de otro instrumento produciría una hoja con ítems ajenos.
   */
  private async resolveFormSections(
    orgId: string,
    assessmentFormId: string | null,
    instrumentId: string,
  ): Promise<string[] | null> {
    if (assessmentFormId === null) return null;

    const [form] = await this.db
      .select({
        id: assessmentForms.id,
        sectionIds: assessmentForms.sectionIds,
        instrumentId: assessments.instrumentId,
      })
      .from(assessmentForms)
      .innerJoin(assessments, eq(assessments.id, assessmentForms.assessmentId))
      .where(and(eq(assessmentForms.id, assessmentFormId), eq(assessmentForms.orgId, orgId)))
      .limit(1);

    if (!form) throw new NotFoundException('Forma de evaluación no encontrada');
    if (form.instrumentId !== instrumentId) {
      throw new BadRequestException(
        'La forma seleccionada pertenece a una evaluación de otro instrumento: elige una forma cuya evaluación use el instrumento de este layout.',
      );
    }
    if (!form.sectionIds || form.sectionIds.length === 0) {
      throw new BadRequestException(
        'La forma seleccionada no declara secciones: no se puede derivar una hoja de respuestas de un subconjunto vacío.',
      );
    }
    return form.sectionIds;
  }

  /**
   * Ítems corregibles del ámbito del layout: los de las secciones de la forma
   * cuando hay forma; TODOS los del instrumento cuando no la hay (idéntico al
   * comportamiento previo a las secciones electivas).
   */
  private async loadDerivableItems(
    instrumentId: string,
    sectionIds: string[] | null = null,
  ): Promise<DerivableItem[]> {
    const rows = await this.db
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
          sectionIds === null ? undefined : inArray(items.sectionId, sectionIds),
        ),
      )
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
