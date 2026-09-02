import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { feedback, users, withOrgContext } from '@soe/db';
import type {
  CreateFeedbackDto,
  FeedbackListItem,
  FeedbackListResponse,
  FeedbackQueryDto,
  FeedbackScreenshotUrlDto,
  UpdateFeedbackDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { StorageService } from '../storage/storage.service';

/** Namespace de `files` para las capturas del widget. */
const SCREENSHOT_OWNER_TYPE = 'feedback';
const SCREENSHOT_PURPOSE = 'screenshot';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly files: FilesService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Registra un comentario. El `orgId` y el autor salen SIEMPRE del token (§11):
   * el cliente sólo aporta el texto, el tipo y el contexto de la vista.
   */
  async create(user: JwtPayload, dto: CreateFeedbackDto): Promise<{ id: string }> {
    const orgId = this.requireOrgId(user);

    // El rol activo del token manda sobre el que reporte el cliente: la misma
    // vista se ve distinta según el rol, y ese dato no puede ser falsificable.
    const context = { ...dto.context, activeRole: user.activeRole };

    return withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(feedback)
        .values({
          orgId,
          createdById: user.userId,
          type: dto.type,
          message: dto.message,
          context,
          screenshotFileId: dto.screenshotFileId ?? null,
        })
        .returning({ id: feedback.id });
      if (!row) throw new BadRequestException('No se pudo registrar el comentario');
      return { id: row.id };
    });
  }

  /**
   * Presigned de S3 para la captura opcional. Vive acá y no en `FilesController`
   * porque ese CRUD está restringido a roles de gestión; el widget tiene que
   * funcionar también para un profesor de aula.
   */
  async createScreenshotUploadUrl(user: JwtPayload, dto: FeedbackScreenshotUrlDto) {
    const orgId = this.requireOrgId(user);
    const { upload } = await this.files.createUploadIntent({
      orgId,
      createdById: user.userId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes ?? null,
      ownerType: SCREENSHOT_OWNER_TYPE,
      ownerId: user.userId,
      purpose: SCREENSHOT_PURPOSE,
    });
    return upload;
  }

  /** Marca la captura como `ready` una vez subida a S3. */
  async confirmScreenshot(user: JwtPayload, fileId: string): Promise<{ fileId: string }> {
    const orgId = this.requireOrgId(user);
    const file = await this.files.confirm({ orgId, fileId });
    return { fileId: file.id };
  }

  async list(user: JwtPayload, query: FeedbackQueryDto): Promise<FeedbackListResponse> {
    const orgId = this.requireOrgId(user);
    const { page, limit } = query;

    return withOrgContext(this.db, orgId, async (tx) => {
      const conditions = [eq(feedback.orgId, orgId)];
      if (query.status) conditions.push(eq(feedback.status, query.status));
      if (query.type) conditions.push(eq(feedback.type, query.type));
      const where = and(...conditions);

      const rows = await tx
        .select({
          id: feedback.id,
          type: feedback.type,
          status: feedback.status,
          message: feedback.message,
          context: feedback.context,
          internalNote: feedback.internalNote,
          screenshotFileId: feedback.screenshotFileId,
          createdAt: feedback.createdAt,
          createdByName: users.name,
        })
        .from(feedback)
        .leftJoin(users, eq(users.id, feedback.createdById))
        .where(where)
        .orderBy(desc(feedback.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const [totalRow] = await tx.select({ value: count() }).from(feedback).where(where);

      const data: FeedbackListItem[] = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          message: row.message,
          context: row.context,
          internalNote: row.internalNote,
          createdByName: row.createdByName ?? null,
          createdAt: row.createdAt.toISOString(),
          screenshotUrl: await this.screenshotUrl(orgId, row.screenshotFileId),
        })),
      );

      return { data, total: totalRow?.value ?? 0, page, limit };
    });
  }

  /** Triage interno: sólo `status` e `internalNote`. El texto original es inmutable. */
  async update(user: JwtPayload, id: string, dto: UpdateFeedbackDto): Promise<{ id: string }> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (dto.status !== undefined) set.status = dto.status;
      if (dto.internalNote !== undefined) set.internalNote = dto.internalNote ?? null;

      const [row] = await tx
        .update(feedback)
        .set(set)
        .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId)))
        .returning({ id: feedback.id });
      if (!row) throw new NotFoundException('Comentario no encontrado');
      return { id: row.id };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * URL prefirmada de la captura. Best-effort: un archivo que ya no está en S3
   * no debe tumbar el listado completo de comentarios.
   */
  private async screenshotUrl(orgId: string, fileId: string | null): Promise<string | null> {
    if (!fileId || !this.storage.isConfigured()) return null;
    try {
      const file = await this.files.getById(orgId, fileId);
      return this.storage.createDownloadUrl({
        key: file.storageKey,
        downloadFileName: file.fileName ?? undefined,
        disposition: 'inline',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo firmar la captura ${fileId}: ${message}`);
      return null;
    }
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new BadRequestException('El usuario no tiene una organización activa');
    }
    return user.orgId;
  }
}
