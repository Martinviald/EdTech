'use server';

import {
  createAssistantConversationSchema,
  type AssistantConversationDetail,
  type AssistantConversationListResponse,
  type AssistantConversationModel,
  type AssistantStudentResult,
  type AssistantStudentSearchResponse,
  type CreateAssistantConversationDto,
} from '@soe/types';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

/**
 * Server Actions del asistente IA (E21 — Ola 4). CRUD de conversaciones sobre el
 * backend NestJS con el Bearer del usuario (resuelto en `apiGet`/`apiPost` desde
 * la cookie). El envío de mensajes NO está aquí: usa streaming SSE vía el route
 * handler `/api/assistant/conversations/:id/messages` (ver su archivo).
 */

export async function createConversation(
  input: CreateAssistantConversationDto = {},
): Promise<AssistantConversationModel> {
  const dto = createAssistantConversationSchema.parse(input);
  return apiPost<AssistantConversationModel>('/assistant/conversations', dto);
}

export async function listConversations(
  page = 1,
  limit = 20,
): Promise<AssistantConversationListResponse> {
  return apiGet<AssistantConversationListResponse>(
    `/assistant/conversations?page=${page}&limit=${limit}`,
  );
}

export async function getConversation(id: string): Promise<AssistantConversationDetail> {
  return apiGet<AssistantConversationDetail>(`/assistant/conversations/${id}`);
}

export async function deleteConversation(id: string): Promise<void> {
  await apiDelete(`/assistant/conversations/${id}`);
}

/** Busca alumnos del scope por nombre, para el selector `@` (H21.11b). */
export async function searchStudents(q: string): Promise<AssistantStudentResult[]> {
  const trimmed = q.trim();
  if (trimmed.length === 0) return [];
  const res = await apiGet<AssistantStudentSearchResponse>(
    `/assistant/students?q=${encodeURIComponent(trimmed)}`,
  );
  return res.data;
}
