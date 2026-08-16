'use server';

import { revalidatePath } from 'next/cache';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type {
  FileModel,
  FileUploadUrlResponse,
  OrgBrandingResponse,
  UpdateOrgBrandingDto,
} from '@soe/types';

type ApiError = Error & { status?: number };

// La subida del logo reutiliza el flujo genérico de 3 pasos del módulo `files`
// (presigned S3): pasos 1 y 3 pasan por el backend con auth y viven acá; el
// paso 2 (PUT del archivo a S3) ocurre en el cliente (§11 seguridad).

export type LogoUploadUrlResult =
  | { ok: true; data: FileUploadUrlResponse }
  | { ok: false; message: string; storageUnavailable: boolean };

export type LogoConfirmResult = { ok: true; data: FileModel } | { ok: false; message: string };

export type BrandingSaveResult =
  | { ok: true; data: OrgBrandingResponse }
  | { ok: false; message: string };

export async function requestLogoUploadUrl(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  orgId: string;
}): Promise<LogoUploadUrlResult> {
  try {
    const data = await apiPost<FileUploadUrlResponse>('/files/upload-url', {
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ownerType: 'organization',
      ownerId: input.orgId,
      purpose: 'org_logo',
    });
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 503) {
      return {
        ok: false,
        storageUnavailable: true,
        message:
          'El almacenamiento de archivos no está configurado en este entorno. No es posible subir el logo por ahora.',
      };
    }
    return { ok: false, storageUnavailable: false, message: err.message };
  }
}

export async function confirmLogoUpload(
  fileId: string,
  sizeBytes: number,
): Promise<LogoConfirmResult> {
  try {
    const data = await apiPost<FileModel>(`/files/${fileId}/confirm`, { sizeBytes });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function saveBranding(dto: UpdateOrgBrandingDto): Promise<BrandingSaveResult> {
  try {
    const data = await apiPatch<OrgBrandingResponse>('/organizations/me/branding', dto);
    revalidatePath('/configuracion/identidad');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function getBranding(): Promise<OrgBrandingResponse> {
  return apiGet<OrgBrandingResponse>('/organizations/me/branding');
}
