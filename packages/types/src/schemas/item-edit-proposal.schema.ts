import { z } from 'zod';
import type { ItemType } from '../enums';
import type { ItemContent } from './item-content.schema';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-19 — Escritura asistida de ítems (el asistente ayuda a editar contenido).
// Contratos compartidos del módulo `item-edit-proposals` (apps/api, ruta base
// /api/item-edit-proposals) y la UI del banco de ítems (ItemDetailPanel).
//
// Principio rector (CLAUDE.md §8.3): la IA PROPONE, el humano APRUEBA. El asistente
// (o un editor) genera una PROPUESTA de nuevo `content` del ítem que queda en
// `pending`; NUNCA toca el ítem real. Un rol de edición de ítems la APRUEBA (recién
// ahí se aplica al `items.content`, versionado) o la RECHAZA. La evidencia de lo
// generado por la IA (`proposedContent`) y el snapshot previo (`currentContent`)
// nunca se sobrescriben.
// ─────────────────────────────────────────────────────────────────────────────

export const ITEM_EDIT_PROPOSAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ItemEditProposalStatus = (typeof ITEM_EDIT_PROPOSAL_STATUSES)[number];
export const itemEditProposalStatusSchema = z.enum(ITEM_EDIT_PROPOSAL_STATUSES);

export const ITEM_EDIT_PROPOSAL_AUTHORS = ['ai', 'human'] as const;
export type ItemEditProposalAuthor = (typeof ITEM_EDIT_PROPOSAL_AUTHORS)[number];
export const itemEditProposalAuthorSchema = z.enum(ITEM_EDIT_PROPOSAL_AUTHORS);

// ── Input: crear una propuesta de edición (POST /item-edit-proposals) ────────
// La identidad (orgId/roles) sale del token, no del body. `instruction` es lo que
// el humano quiere cambiar; la IA genera el `content` propuesto a partir de ella.
export const proposeItemEditSchema = z.object({
  itemId: z.string().uuid(),
  instruction: z.string().trim().min(3).max(2000),
});
export type ProposeItemEditDto = z.infer<typeof proposeItemEditSchema>;

// ── Input: revisar una propuesta (POST /item-edit-proposals/:id/review) ──────
export const reviewItemEditProposalSchema = z.object({
  action: z.enum(['approve', 'reject']),
});
export type ReviewItemEditProposalDto = z.infer<typeof reviewItemEditProposalSchema>;

// ── Query: listar propuestas de un ítem (GET /item-edit-proposals?itemId=…) ──
export const listItemEditProposalsQuerySchema = z.object({
  itemId: z.string().uuid(),
  status: itemEditProposalStatusSchema.optional(),
});
export type ListItemEditProposalsQueryDto = z.infer<typeof listItemEditProposalsQuerySchema>;

// ── Modelo de respuesta ──────────────────────────────────────────────────────
// `currentContent`/`proposedContent` son el `content` polimórfico del ítem
// (validado contra `itemType` con `validateItemContent`). La UI arma el diff con
// ambos. `costUsd` es string (decimal) para no perder precisión.
export interface ItemEditProposalModel {
  id: string;
  itemId: string;
  status: ItemEditProposalStatus;
  author: ItemEditProposalAuthor;
  itemType: ItemType;
  instruction: string | null;
  reasoning: string | null;
  currentContent: ItemContent | null;
  proposedContent: ItemContent;
  appliedVersion: number | null;
  model: string | null;
  promptVersion: string | null;
  costUsd: string | null;
  createdById: string | null;
  reviewedById: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ItemEditProposalListResponse {
  data: ItemEditProposalModel[];
}
