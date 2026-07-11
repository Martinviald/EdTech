import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { files, withOrgContext, type FileRecord } from '@soe/db';
import type { FileModel, FileStatus, FileUploadUrlResponse } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { StorageService } from '../storage/storage.service';

/**
 * Parámetros para emitir una URL de subida y registrar el archivo `pending`.
 * `orgId` es el TENANT dueño del archivo (null = global/plataforma). El caller lo
 * deriva de su contexto autorizado (ej. `instrument.orgId`), NO del usuario.
 */
export interface CreateUploadIntentParams {
  orgId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes?: number | null;
  ownerType?: string | null;
  ownerId?: string | null;
  purpose?: string | null;
  note?: string | null;
  createdById?: string | null;
  expiresIn?: number;
}

export interface ConfirmFileParams {
  orgId: string | null;
  fileId: string;
  sizeBytes?: number | null;
  note?: string | null;
  /**
   * Si es true, al confirmar este archivo se soft-borran (y se eliminan de S3)
   * los OTROS archivos `ready`/`pending` con el mismo (ownerType, ownerId, purpose).
   * Implementa la regla de negocio "un único archivo por entidad" (ej. 1 PDF de
   * enunciado por instrumento) sin acoplar la política al schema.
   */
  replaceSameOwnerPurpose?: boolean;
}

export interface ListFilesQuery {
  ownerType?: string;
  ownerId?: string;
  purpose?: string;
  status?: FileStatus;
  page?: number;
  limit?: number;
}

/**
 * Módulo genérico de almacenamiento (S3). CRUD desacoplado sobre la tabla `files`
 * + orquestación del `StorageService` (presigned URLs + delete/head reales). Es
 * infraestructura reutilizable: NO contiene lógica de ningún dominio. Otros módulos
 * lo consumen inyectando este service (in-process) o vía `FilesController` (HTTP).
 *
 * Multi-tenant/RLS: cada operación corre dentro de `withOrgContext(orgId)` cuando el
 * archivo pertenece a un tenant; para archivos globales (`orgId === null`) corre sin
 * contexto (RLS sólo expone filas con `org_id IS NULL`). Nunca se consulta `this.db`
 * directamente para tablas con RLS (§5.2).
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  /** Corre `fn` con contexto RLS del tenant, o sin contexto para archivos globales. */
  private run<T>(orgId: string | null, fn: (tx: Database) => Promise<T>): Promise<T> {
    return orgId ? withOrgContext(this.db, orgId, fn) : fn(this.db);
  }

  // ── Create (upload intent) ─────────────────────────────────────────────────

  /**
   * Paso 1: construye la S3 key, emite la URL prefirmada de subida y persiste el
   * archivo en estado `pending`. La URL se genera ANTES del insert: si el storage
   * no está configurado, `createUploadUrl` lanza 503 y no queda una fila huérfana.
   */
  async createUploadIntent(
    params: CreateUploadIntentParams,
  ): Promise<{ file: FileRecord; upload: FileUploadUrlResponse }> {
    const storageKey = this.buildKey(params);
    const presigned = this.storage.createUploadUrl({
      key: storageKey,
      contentType: params.mimeType,
      expiresIn: params.expiresIn,
    });

    const file = await this.run(params.orgId, async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          orgId: params.orgId,
          status: 'pending',
          storageKey,
          fileName: params.fileName,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes ?? null,
          ownerType: params.ownerType ?? null,
          ownerId: params.ownerId ?? null,
          purpose: params.purpose ?? null,
          note: params.note ?? null,
          createdById: params.createdById ?? null,
          meta: {},
        })
        .returning();
      if (!row) throw new BadRequestException('No se pudo registrar el archivo');
      return row;
    });

    return {
      file,
      upload: { fileId: file.id, storageKey, ...presigned },
    };
  }

  // ── Confirm ────────────────────────────────────────────────────────────────

  /**
   * Paso 3: valida que el objeto exista en S3 (`headObject`) y marca el archivo como
   * `ready`. Si `replaceSameOwnerPurpose`, soft-borra los demás archivos del mismo
   * dueño+purpose y elimina sus objetos en S3 (best-effort, fuera de la transacción).
   */
  async confirm(params: ConfirmFileParams): Promise<FileRecord> {
    const { orgId, fileId } = params;

    const existing = await this.run(orgId, async (tx) => {
      const [row] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
      return row ?? null;
    });
    if (!existing) throw new NotFoundException('Archivo no encontrado');

    // Validación en S3 (sólo si el storage está configurado). Fuera de la
    // transacción para no mantener la tx abierta durante I/O de red.
    if (this.storage.isConfigured()) {
      const head = await this.storage.headObject(existing.storageKey);
      if (!head.exists) {
        throw new BadRequestException(
          'El archivo no se encuentra en el almacenamiento; reintenta la subida',
        );
      }
    }

    const { file, staleKeys } = await this.run(orgId, async (tx) => {
      let staleKeys: string[] = [];

      if (params.replaceSameOwnerPurpose && existing.ownerType && existing.ownerId) {
        const stale = await tx
          .select({ id: files.id, storageKey: files.storageKey })
          .from(files)
          .where(
            and(
              eq(files.ownerType, existing.ownerType),
              eq(files.ownerId, existing.ownerId),
              existing.purpose ? eq(files.purpose, existing.purpose) : isNull(files.purpose),
              ne(files.id, fileId),
              isNull(files.deletedAt),
            ),
          );
        staleKeys = stale.map((s) => s.storageKey);
        if (stale.length > 0) {
          await tx
            .update(files)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(
              inArray(
                files.id,
                stale.map((s) => s.id),
              ),
            );
        }
      }

      const [row] = await tx
        .update(files)
        .set({
          status: 'ready',
          sizeBytes: params.sizeBytes ?? existing.sizeBytes,
          note: params.note ?? existing.note,
          updatedAt: new Date(),
        })
        .where(eq(files.id, fileId))
        .returning();
      if (!row) throw new BadRequestException('No se pudo confirmar el archivo');
      return { file: row, staleKeys };
    });

    await this.deleteObjectsBestEffort(staleKeys);
    return file;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async getById(orgId: string | null, fileId: string): Promise<FileRecord> {
    const row = await this.run(orgId, async (tx) => {
      const [r] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
      return r ?? null;
    });
    if (!row) throw new NotFoundException('Archivo no encontrado');
    return row;
  }

  async findByStorageKey(orgId: string | null, storageKey: string): Promise<FileRecord | null> {
    return this.run(orgId, async (tx) => {
      const [r] = await tx
        .select()
        .from(files)
        .where(and(eq(files.storageKey, storageKey), isNull(files.deletedAt)));
      return r ?? null;
    });
  }

  /** Lista archivos (filtrados por dueño/purpose/estado) con paginación. */
  async list(
    orgId: string | null,
    query: ListFilesQuery,
  ): Promise<{ data: FileRecord[]; total: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.run(orgId, async (tx) => {
      const conditions = [isNull(files.deletedAt)];
      if (query.ownerType) conditions.push(eq(files.ownerType, query.ownerType));
      if (query.ownerId) conditions.push(eq(files.ownerId, query.ownerId));
      if (query.purpose) conditions.push(eq(files.purpose, query.purpose));
      if (query.status) conditions.push(eq(files.status, query.status));
      const where = and(...conditions);

      const data = await tx
        .select()
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);
      const all = await tx.select({ id: files.id }).from(files).where(where);
      return { data, total: all.length };
    });
  }

  /** Devuelve el archivo `ready` más reciente de un dueño+purpose (o null). */
  async getLatestByOwner(
    orgId: string | null,
    ownerType: string,
    ownerId: string,
    purpose: string,
  ): Promise<FileRecord | null> {
    return this.run(orgId, async (tx) => {
      const [row] = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.ownerType, ownerType),
            eq(files.ownerId, ownerId),
            eq(files.purpose, purpose),
            eq(files.status, 'ready'),
            isNull(files.deletedAt),
          ),
        )
        .orderBy(desc(files.createdAt))
        .limit(1);
      return row ?? null;
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async updateMetadata(
    orgId: string | null,
    fileId: string,
    dto: { fileName?: string; note?: string; meta?: Record<string, unknown> },
  ): Promise<FileRecord> {
    return this.run(orgId, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (dto.fileName !== undefined) set.fileName = dto.fileName;
      if (dto.note !== undefined) set.note = dto.note;
      if (dto.meta !== undefined) set.meta = dto.meta;

      const [row] = await tx
        .update(files)
        .set(set)
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
        .returning();
      if (!row) throw new NotFoundException('Archivo no encontrado');
      return row;
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /** Soft-delete del registro + delete real del objeto en S3 (sin huérfanos). */
  async remove(orgId: string | null, fileId: string): Promise<void> {
    const storageKey = await this.run(orgId, async (tx) => {
      const [row] = await tx
        .select({ storageKey: files.storageKey })
        .from(files)
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
      if (!row) throw new NotFoundException('Archivo no encontrado');
      await tx
        .update(files)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(files.id, fileId));
      return row.storageKey;
    });
    await this.deleteObjectsBestEffort([storageKey]);
  }

  /** Elimina todos los archivos de un dueño+purpose (soft-delete + S3). */
  async removeByOwner(
    orgId: string | null,
    ownerType: string,
    ownerId: string,
    purpose: string,
  ): Promise<void> {
    const staleKeys = await this.run(orgId, async (tx) => {
      const rows = await tx
        .select({ id: files.id, storageKey: files.storageKey })
        .from(files)
        .where(
          and(
            eq(files.ownerType, ownerType),
            eq(files.ownerId, ownerId),
            eq(files.purpose, purpose),
            isNull(files.deletedAt),
          ),
        );
      if (rows.length > 0) {
        await tx
          .update(files)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            inArray(
              files.id,
              rows.map((r) => r.id),
            ),
          );
      }
      return rows.map((r) => r.storageKey);
    });
    await this.deleteObjectsBestEffort(staleKeys);
  }

  // ── Presentación ─────────────────────────────────────────────────────────────

  /** URL prefirmada de descarga para un archivo (o undefined si storage no configurado). */
  buildDownloadUrl(row: FileRecord): string | undefined {
    if (!this.storage.isConfigured()) return undefined;
    return this.storage.createDownloadUrl({
      key: row.storageKey,
      downloadFileName: row.fileName ?? undefined,
    });
  }

  /** Mapea una fila de `files` al modelo de API compartido (`@soe/types`). */
  toModel(row: FileRecord, withDownloadUrl = false): FileModel {
    const model: FileModel = {
      id: row.id,
      orgId: row.orgId,
      status: row.status,
      storageKey: row.storageKey,
      bucket: row.bucket,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum,
      url: row.url,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      purpose: row.purpose,
      note: row.note,
      meta: row.meta ?? {},
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (withDownloadUrl) {
      const downloadUrl = this.buildDownloadUrl(row);
      if (downloadUrl) model.downloadUrl = downloadUrl;
    }
    return model;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * S3 key namespaced: `{ownerType|files}/{orgId|global}[/{ownerId}][/{purpose}]/{uuid}-{safeName}`.
   * No hardcodea ningún dominio/instrumento (CLAUDE.md §8.2); el nombre se sanea y
   * se preserva para trazabilidad.
   */
  private buildKey(params: CreateUploadIntentParams): string {
    const owner = this.sanitizeSegment(params.ownerType ?? 'files');
    const scope = params.orgId ?? 'global';
    const ownerSeg = params.ownerId ? `/${params.ownerId}` : '';
    const purposeSeg = params.purpose ? `/${this.sanitizeSegment(params.purpose)}` : '';
    const safeName =
      params.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'archivo';
    return `${owner}/${scope}${ownerSeg}${purposeSeg}/${randomUUID()}-${safeName}`;
  }

  private sanitizeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'x';
  }

  private async deleteObjectsBestEffort(keys: string[]): Promise<void> {
    if (keys.length === 0 || !this.storage.isConfigured()) return;
    await Promise.all(
      keys.map((key) =>
        this.storage.deleteObject(key).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`No se pudo eliminar el objeto S3 "${key}": ${message}`);
        }),
      ),
    );
  }
}
