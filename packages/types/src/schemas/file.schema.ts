import { z } from 'zod';

// ── Módulo genérico de almacenamiento de archivos (S3) ───────────────────────
// Contrato compartido api ⇄ web para el CRUD de archivos. El flujo de subida es
// en 3 pasos con presigned URL (el backend NO recibe el archivo en memoria):
//   1) POST /files/upload-url  → { fileId, storageKey, uploadUrl }  (crea fila `pending`)
//   2) el cliente hace PUT del archivo directo a S3 con `uploadUrl`
//   3) POST /files/:id/confirm → valida en S3 (headObject) y marca `ready`
// Otros módulos consumen `FilesService` in-process (no necesariamente vía HTTP).

export const FILE_STATUSES = ['pending', 'ready'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** Límite de tamaño por archivo (50 MB). Coincide con el flujo de enunciado PDF. */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Paso 1: solicitar una URL prefirmada de subida (genérico, cualquier dominio). */
export const createFileUploadUrlRequestSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(150),
  sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE_BYTES).optional(),
  /** Asociación polimórfica opcional al dominio dueño. */
  ownerType: z.string().min(1).max(80).optional(),
  ownerId: z.string().uuid().optional(),
  purpose: z.string().min(1).max(80).optional(),
  note: z.string().max(2000).optional(),
});

/** Paso 3: confirmar la subida (referencia el archivo por su id). */
export const confirmFileSchema = z.object({
  /** Si el cliente conoce el tamaño final, se persiste (informativo). */
  sizeBytes: z.number().int().min(0).optional(),
  note: z.string().max(2000).optional(),
});

/** Actualización de metadata de un archivo `ready` (no cambia el objeto en S3). */
export const updateFileSchema = z.object({
  fileName: z.string().min(1).max(300).optional(),
  note: z.string().max(2000).optional(),
  meta: z.record(z.unknown()).optional(),
});

/** Filtros de listado de archivos. */
export const fileQuerySchema = z.object({
  ownerType: z.string().min(1).max(80).optional(),
  ownerId: z.string().uuid().optional(),
  purpose: z.string().min(1).max(80).optional(),
  status: z.enum(FILE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFileUploadUrlRequestDto = z.infer<typeof createFileUploadUrlRequestSchema>;
export type ConfirmFileDto = z.infer<typeof confirmFileSchema>;
export type UpdateFileDto = z.infer<typeof updateFileSchema>;
export type FileQueryDto = z.infer<typeof fileQuerySchema>;

/** Respuesta del paso 1: instrucciones para subir el archivo directo a S3. */
export type FileUploadUrlResponse = {
  /** Id del registro `files` (estado `pending`) creado para esta subida. */
  fileId: string;
  /** Clave de almacenamiento (S3 key) del objeto. */
  storageKey: string;
  /** URL prefirmada a la que el cliente hace el PUT del archivo. */
  uploadUrl: string;
  /** Método HTTP para la subida (siempre PUT en el flujo presigned). */
  method: 'PUT';
  /** Headers que el cliente DEBE reenviar en el PUT (ej. Content-Type). */
  headers: Record<string, string>;
  /** Segundos de validez de la URL prefirmada. */
  expiresIn: number;
};

/** Archivo (API shape). `downloadUrl` sólo se incluye al leer un archivo puntual. */
export type FileModel = {
  id: string;
  orgId: string | null;
  status: FileStatus;
  storageKey: string;
  bucket: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  url: string | null;
  ownerType: string | null;
  ownerId: string | null;
  purpose: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdById: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** URL prefirmada de descarga (presente al leer un archivo puntual). */
  downloadUrl?: string;
};
