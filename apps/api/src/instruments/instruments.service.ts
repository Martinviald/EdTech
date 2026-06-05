import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  instruments,
  instrumentSections,
  sectionAttachments,
  type Instrument,
  type InstrumentSection,
  type NewSectionAttachment,
} from '@soe/db';
import { userHasRole, type PassageDto, type SectionAttachmentInputDto } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import type {
  CreateInstrumentDto,
  UpdateInstrumentDto,
  ListInstrumentsQueryDto,
  CreateSectionDto,
  UpdateSectionDto,
} from './dto/instrument.dto';

/** Cliente transaccional de Drizzle (mismo shape que `Database` dentro de un `.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Sección con sus adjuntos poblados (API shape). */
type SectionWithAttachments = InstrumentSection & {
  attachments: (typeof sectionAttachments.$inferSelect)[];
};

@Injectable()
export class InstrumentsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ── Instruments ─────────────────────────────────────────────────────────

  async list(user: JwtPayload, query: ListInstrumentsQueryDto) {
    const { page, pageSize, ...filters } = query;
    const conditions = this.buildVisibilityConditions(user);

    if (filters.type) {
      conditions.push(eq(instruments.type, filters.type));
    }
    if (filters.subjectId) {
      conditions.push(eq(instruments.subjectId, filters.subjectId));
    }
    if (filters.gradeId) {
      conditions.push(eq(instruments.gradeId, filters.gradeId));
    }
    if (filters.year !== undefined) {
      conditions.push(eq(instruments.year, filters.year));
    }
    if (filters.status) {
      conditions.push(eq(instruments.status, filters.status));
    }
    if (typeof filters.isOfficial === 'boolean') {
      conditions.push(eq(instruments.isOfficial, filters.isOfficial));
    }

    const where = and(...conditions);
    const offset = (page - 1) * pageSize;

    const [data, totalResult] = await Promise.all([
      this.db
        .select()
        .from(instruments)
        .where(where)
        .orderBy(instruments.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(instruments).where(where),
    ]);

    const total = totalResult[0]?.total ?? 0;

    return { data, total, page, limit: pageSize };
  }

  async getById(id: string, user: JwtPayload) {
    const [row] = await this.db
      .select()
      .from(instruments)
      .where(and(eq(instruments.id, id), isNull(instruments.deletedAt)));

    if (!row) throw new NotFoundException('Instrumento no encontrado');
    this.assertVisible(row, user);

    // Populate sections (con pasaje + adjuntos)
    const sections = await this.db
      .select()
      .from(instrumentSections)
      .where(eq(instrumentSections.instrumentId, id))
      .orderBy(instrumentSections.order);

    const withAttachments = await this.withAttachments(sections);

    return { ...row, sections: withAttachments };
  }

  async create(dto: CreateInstrumentDto, user: JwtPayload) {
    if (dto.isOfficial && !userHasRole(user.roles, 'platform_admin')) {
      throw new ForbiddenException('Solo platform_admin puede crear instrumentos oficiales');
    }

    const orgId = dto.isOfficial ? null : user.orgId;

    const [created] = await this.db
      .insert(instruments)
      .values({
        orgId,
        taxonomyId: dto.taxonomyId ?? null,
        name: dto.name,
        shortName: dto.shortName ?? null,
        type: dto.type,
        subjectId: dto.subjectId ?? null,
        gradeId: dto.gradeId ?? null,
        year: dto.year ?? null,
        version: dto.version ?? null,
        isOfficial: dto.isOfficial,
        status: dto.status,
        gradingScaleId: dto.gradingScaleId ?? null,
        config: dto.config ?? {},
        createdById: user.userId,
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo crear el instrumento');

    // Create inline sections if provided (sección + pasaje + adjuntos, atómico)
    if (dto.sections?.length) {
      await this.db.transaction(async (tx) => {
        for (const section of dto.sections!) {
          const [createdSection] = await tx
            .insert(instrumentSections)
            .values({
              instrumentId: created.id,
              name: section.name,
              type: section.type,
              order: section.order,
              maxPoints: section.maxPoints ?? null,
              timeLimitMin: section.timeLimitMin ?? null,
              instructions: section.instructions ?? null,
              ...this.passageColumns(section.passage),
              config: section.config ?? {},
            })
            .returning({ id: instrumentSections.id });

          if (createdSection) {
            await this.insertAttachments(tx, createdSection.id, section.attachments);
          }
        }
      });
    }

    return this.getById(created.id, user);
  }

  async update(id: string, dto: UpdateInstrumentDto, user: JwtPayload) {
    const existing = await this.getByIdRaw(id);
    this.assertEditable(existing, user);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.shortName !== undefined) updateData.shortName = dto.shortName;
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.taxonomyId !== undefined) updateData.taxonomyId = dto.taxonomyId;
    if (dto.subjectId !== undefined) updateData.subjectId = dto.subjectId;
    if (dto.gradeId !== undefined) updateData.gradeId = dto.gradeId;
    if (dto.year !== undefined) updateData.year = dto.year;
    if (dto.version !== undefined) updateData.version = dto.version;
    if (dto.isOfficial !== undefined) {
      if (dto.isOfficial && !userHasRole(user.roles, 'platform_admin')) {
        throw new ForbiddenException('Solo platform_admin puede marcar instrumentos como oficiales');
      }
      updateData.isOfficial = dto.isOfficial;
    }
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.gradingScaleId !== undefined) updateData.gradingScaleId = dto.gradingScaleId;
    if (dto.config !== undefined) updateData.config = dto.config;

    const [updated] = await this.db
      .update(instruments)
      .set(updateData)
      .where(eq(instruments.id, id))
      .returning();

    return updated;
  }

  async softDelete(id: string, user: JwtPayload) {
    const existing = await this.getByIdRaw(id);
    this.assertEditable(existing, user);

    await this.db
      .update(instruments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(instruments.id, id));
  }

  // ── Sections ────────────────────────────────────────────────────────────

  async listSections(instrumentId: string, user: JwtPayload) {
    // Validate instrument exists and is visible
    await this.getByIdRaw(instrumentId, user);

    const sections = await this.db
      .select()
      .from(instrumentSections)
      .where(eq(instrumentSections.instrumentId, instrumentId))
      .orderBy(instrumentSections.order);

    return this.withAttachments(sections);
  }

  async createSection(instrumentId: string, dto: CreateSectionDto, user: JwtPayload) {
    const instrument = await this.getByIdRaw(instrumentId);
    this.assertEditable(instrument, user);

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(instrumentSections)
        .values({
          instrumentId,
          name: dto.name,
          type: dto.type,
          order: dto.order,
          maxPoints: dto.maxPoints ?? null,
          timeLimitMin: dto.timeLimitMin ?? null,
          instructions: dto.instructions ?? null,
          ...this.passageColumns(dto.passage),
          config: dto.config ?? {},
        })
        .returning();

      if (!row) throw new BadRequestException('No se pudo crear la sección');

      await this.insertAttachments(tx, row.id, dto.attachments);
      return row;
    });

    return this.getSectionWithAttachments(created.id);
  }

  async updateSection(
    instrumentId: string,
    sectionId: string,
    dto: UpdateSectionDto,
    user: JwtPayload,
  ) {
    const instrument = await this.getByIdRaw(instrumentId);
    this.assertEditable(instrument, user);

    const [existing] = await this.db
      .select()
      .from(instrumentSections)
      .where(
        and(
          eq(instrumentSections.id, sectionId),
          eq(instrumentSections.instrumentId, instrumentId),
        ),
      );

    if (!existing) throw new NotFoundException('Sección no encontrada');

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.order !== undefined) updateData.order = dto.order;
    if (dto.maxPoints !== undefined) updateData.maxPoints = dto.maxPoints;
    if (dto.timeLimitMin !== undefined) updateData.timeLimitMin = dto.timeLimitMin;
    if (dto.instructions !== undefined) updateData.instructions = dto.instructions;
    // Pasaje: si `dto.passage` viene, se reescriben las 3 columnas (incluido borrarlo con null).
    if (dto.passage !== undefined) Object.assign(updateData, this.passageColumns(dto.passage));
    if (dto.config !== undefined) updateData.config = dto.config;

    await this.db.transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx
          .update(instrumentSections)
          .set(updateData)
          .where(eq(instrumentSections.id, sectionId));
      }

      // Reemplazo de adjuntos: si `dto.attachments` está definido, se borran los
      // existentes de la sección y se insertan los nuevos. Si es `undefined`, no se tocan.
      if (dto.attachments !== undefined) {
        await tx.delete(sectionAttachments).where(eq(sectionAttachments.sectionId, sectionId));
        await this.insertAttachments(tx, sectionId, dto.attachments);
      }
    });

    return this.getSectionWithAttachments(sectionId);
  }

  async deleteSection(instrumentId: string, sectionId: string, user: JwtPayload) {
    const instrument = await this.getByIdRaw(instrumentId);
    this.assertEditable(instrument, user);

    const [existing] = await this.db
      .select()
      .from(instrumentSections)
      .where(
        and(
          eq(instrumentSections.id, sectionId),
          eq(instrumentSections.instrumentId, instrumentId),
        ),
      );

    if (!existing) throw new NotFoundException('Sección no encontrada');

    await this.db.delete(instrumentSections).where(eq(instrumentSections.id, sectionId));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Builds the base visibility + soft-delete conditions for instruments.
   * Official instruments (org_id IS NULL) are visible to everyone.
   * Custom instruments are filtered by the user's org_id.
   */
  private buildVisibilityConditions(user: JwtPayload) {
    const conditions = [isNull(instruments.deletedAt)];

    if (!user.isPlatformAdmin) {
      conditions.push(
        user.orgId
          ? or(isNull(instruments.orgId), eq(instruments.orgId, user.orgId))!
          : isNull(instruments.orgId),
      );
    }

    return conditions;
  }

  /** Fetch raw instrument (no sections), checking soft-delete. */
  private async getByIdRaw(id: string, user?: JwtPayload): Promise<Instrument> {
    const [row] = await this.db
      .select()
      .from(instruments)
      .where(and(eq(instruments.id, id), isNull(instruments.deletedAt)));

    if (!row) throw new NotFoundException('Instrumento no encontrado');
    if (user) this.assertVisible(row, user);
    return row;
  }

  /** Verify the instrument is visible to this user. */
  assertVisible(instrument: Instrument, user: JwtPayload) {
    if (user.isPlatformAdmin) return;
    if (instrument.orgId === null) return; // official
    if (user.orgId && instrument.orgId === user.orgId) return;
    throw new ForbiddenException('No tienes acceso a este instrumento');
  }

  /**
   * Verify the user can edit this instrument.
   * - platform_admin: can edit anything.
   * - Official instruments (non-admin): read-only.
   * - Custom instruments: must belong to the user's org.
   */
  assertEditable(instrument: Instrument, user: JwtPayload) {
    if (user.isPlatformAdmin) return;
    if (instrument.isOfficial) {
      throw new ForbiddenException('Los instrumentos oficiales son de solo lectura');
    }
    if (!user.orgId || instrument.orgId !== user.orgId) {
      throw new ForbiddenException('Solo puedes editar instrumentos de tu propia organización');
    }
  }

  // ── Passage / Attachments helpers ─────────────────────────────────────────

  /** Mapea el `passage` del DTO a las columnas tipadas de la sección. */
  private passageColumns(passage?: PassageDto): {
    passageTitle: string | null;
    passageText: string | null;
    passageFormat: PassageDto['format'] | null;
  } {
    if (!passage) {
      return { passageTitle: null, passageText: null, passageFormat: null };
    }
    return {
      passageTitle: passage.title ?? null,
      passageText: passage.text,
      passageFormat: passage.format ?? 'plain',
    };
  }

  /** Inserta los adjuntos de una sección dentro de la transacción dada. */
  private async insertAttachments(
    tx: Tx,
    sectionId: string,
    attachments?: SectionAttachmentInputDto[],
  ): Promise<void> {
    if (!attachments?.length) return;

    const values: NewSectionAttachment[] = attachments.map((a) => ({
      sectionId,
      kind: a.kind,
      order: a.order,
      storageKey: a.storageKey ?? null,
      url: a.url ?? null,
      fileName: a.fileName ?? null,
      mimeType: a.mimeType ?? null,
      sizeBytes: a.sizeBytes ?? null,
      note: a.note ?? null,
      meta: a.meta ?? {},
    }));

    await tx.insert(sectionAttachments).values(values);
  }

  /** Pobla los adjuntos (ordenados) en un conjunto de secciones. */
  private async withAttachments(
    sections: InstrumentSection[],
  ): Promise<SectionWithAttachments[]> {
    if (!sections.length) return [];

    const ids = sections.map((s) => s.id);
    const rows = await this.db
      .select()
      .from(sectionAttachments)
      .where(inArray(sectionAttachments.sectionId, ids))
      .orderBy(sectionAttachments.order);

    const bySection = new Map<string, (typeof sectionAttachments.$inferSelect)[]>();
    for (const row of rows) {
      const list = bySection.get(row.sectionId) ?? [];
      list.push(row);
      bySection.set(row.sectionId, list);
    }

    return sections.map((s) => ({ ...s, attachments: bySection.get(s.id) ?? [] }));
  }

  /** Lee una sección con sus adjuntos poblados. */
  private async getSectionWithAttachments(sectionId: string): Promise<SectionWithAttachments> {
    const [section] = await this.db
      .select()
      .from(instrumentSections)
      .where(eq(instrumentSections.id, sectionId));

    if (!section) throw new NotFoundException('Sección no encontrada');

    const [withAttachments] = await this.withAttachments([section]);
    return withAttachments;
  }
}
