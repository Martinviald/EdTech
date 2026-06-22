/** Mensaje renderizable en el chat (estado de UI, no el modelo persistido). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Trazas de tools del turno del asistente (para el indicador y auditoría UI). */
  tools: { name: string; isError: boolean }[];
}

/**
 * Eventos SSE que emite el endpoint de mensajes del asistente (E21). El backend
 * descarta el evento `final` (persiste en el server) y cierra con `done`; ante un
 * error tras abrir el stream emite `error`. Espejo del contrato de
 * `assistant.controller.ts` / `llm-agent.service.ts`.
 */
export type AssistantStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; isError: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Lee un `Response` de tipo `text/event-stream` y entrega cada evento parseado
 * vía `onEvent`. Acumula por si un frame `data:` llega partido entre chunks
 * (separador estándar SSE: línea en blanco `\n\n`).
 */
export async function readAssistantStream(
  res: Response,
  onEvent: (event: AssistantStreamEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error('Respuesta sin cuerpo de stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Procesa todos los frames completos (separados por línea en blanco).
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      emitFrame(frame, onEvent);
    }
  }

  // Frame final sin separador de cierre.
  if (buffer.trim().length > 0) emitFrame(buffer, onEvent);
}

function emitFrame(frame: string, onEvent: (event: AssistantStreamEvent) => void): void {
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload) continue;
    try {
      onEvent(JSON.parse(payload) as AssistantStreamEvent);
    } catch {
      // Frame no-JSON: se ignora (robustez ante keep-alives o ruido).
    }
  }
}
