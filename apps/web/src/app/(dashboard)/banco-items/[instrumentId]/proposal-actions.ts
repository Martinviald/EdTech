'use server';

import { revalidatePath } from 'next/cache';
import { apiGet, apiPost } from '@/lib/api';
import type { ItemEditProposalModel, ItemEditProposalListResponse } from '@soe/types';

type ApiError = Error & { status?: number };

// ─────────────────────────────────────────────────────────────────────────────
// TKT-19 — Escritura asistida de ítems (la IA propone, el humano aprueba). Server
// actions que envuelven la API del backend (/item-edit-proposals) para que el
// detalle del ítem (client component) pueda listar/proponer/revisar sin exponer
// el token. La autorización real la aplican los guards del backend.
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalActionResult =
  | { ok: true; data: ItemEditProposalModel }
  | { ok: false; message: string };

export type ProposalListResult =
  | { ok: true; data: ItemEditProposalModel[] }
  | { ok: false; message: string };

/** Lista las propuestas de edición de un ítem (más recientes primero). */
export async function listItemEditProposals(itemId: string): Promise<ProposalListResult> {
  try {
    const res = await apiGet<ItemEditProposalListResponse>(
      `/item-edit-proposals?itemId=${encodeURIComponent(itemId)}`,
    );
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

/** Pide a la IA una propuesta de edición del ítem según una instrucción. */
export async function proposeItemEdit(
  itemId: string,
  instruction: string,
): Promise<ProposalActionResult> {
  try {
    const data = await apiPost<ItemEditProposalModel>('/item-edit-proposals', {
      itemId,
      instruction,
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

/** Aprueba (aplica al ítem) o rechaza una propuesta de edición. */
export async function reviewItemEditProposal(
  instrumentId: string,
  proposalId: string,
  action: 'approve' | 'reject',
): Promise<ProposalActionResult> {
  try {
    const data = await apiPost<ItemEditProposalModel>(`/item-edit-proposals/${proposalId}/review`, {
      action,
    });
    // Aprobar cambia el content del ítem → revalidar la vista del instrumento
    // (si lo conocemos; en el explorador cross-instrumento puede no venir).
    if (action === 'approve' && instrumentId) {
      revalidatePath(`/banco-items/${instrumentId}`);
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}
