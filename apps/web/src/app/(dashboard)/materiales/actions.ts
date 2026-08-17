'use server';

import { revalidatePath } from 'next/cache';
import { apiDelete, apiPost } from '@/lib/api';
import type { CreateDocumentDto, DocumentModel } from '@soe/types';

type ApiError = Error & { status?: number };

export type DocumentActionResult =
  | { ok: true; data: DocumentModel }
  | { ok: false; message: string };

export type DocumentDeleteResult = { ok: true } | { ok: false; message: string };

export async function createDocument(input: CreateDocumentDto): Promise<DocumentActionResult> {
  try {
    const data = await apiPost<DocumentModel>('/documents', input);
    revalidatePath('/materiales');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function duplicateDocument(documentId: string): Promise<DocumentActionResult> {
  try {
    const data = await apiPost<DocumentModel>(`/documents/${documentId}/duplicate`, {});
    revalidatePath('/materiales');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function deleteDocument(documentId: string): Promise<DocumentDeleteResult> {
  try {
    await apiDelete(`/documents/${documentId}`);
    revalidatePath('/materiales');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}
