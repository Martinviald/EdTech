import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { InstrumentsService } from '../../instruments/instruments.service';
import { ItemsService } from '../../items/items.service';

/** Validación local del input que propone el modelo: solo el UUID del instrumento. */
const inputSchema = z.object({
  instrumentId: z.string().uuid(),
});

/** Largo máximo del enunciado corto por ítem (evita reinyectar contenido pesado). */
const STEM_PREVIEW_MAX = 160;
/** Cap de ítems listados (la barrera real de contenido la pone `get_item_content`). */
const ITEMS_PAGE_SIZE = 100;

/**
 * Tool `get_instrument` (E21 — Ola 5): resuelve una referencia fijada de tipo
 * `instrument`. Devuelve la metadata del instrumento + sus secciones + el listado
 * de ítems (id + posición + enunciado CORTO), SIN el contenido pesado de cada ítem
 * (eso lo trae `get_item_content` bajo demanda).
 *
 * Wrapper que COMPONE dos services de dominio con la identidad del JWT (`ctx.user`,
 * NUNCA del modelo): `InstrumentsService.getById` (metadata + secciones, hereda la
 * visibilidad org propia + oficiales) e `ItemsService.list` (ítems del instrumento,
 * misma visibilidad). La identidad sale siempre de `ctx.user` (CLAUDE.md §6.3, §11).
 */
@Injectable()
export class GetInstrumentTool implements AssistantTool {
  constructor(
    private readonly instruments: InstrumentsService,
    private readonly items: ItemsService,
  ) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_instrument',
    description:
      'Lee la ficha de un instrumento (prueba/evaluación estandarizada) por su ' +
      'instrumentId: metadata (nombre, tipo, año, estado, asignatura, grado), sus ' +
      'secciones y el listado de ítems con su número (position) y un enunciado ' +
      'corto. NO devuelve el contenido completo de cada ítem: para el enunciado y ' +
      'las alternativas de una pregunta puntual usa get_item_content con su itemId ' +
      '(o assessmentId + position). Solo contenido de la prueba, sin datos de alumnos.',
    inputSchema: {
      type: 'object',
      properties: {
        instrumentId: {
          type: 'string',
          description: 'UUID del instrumento a consultar.',
        },
      },
      required: ['instrumentId'],
    },
  };

  async execute(input: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({ error: 'Parámetros inválidos: entrega instrumentId (UUID).' }),
        isError: true,
      };
    }

    try {
      const instrument = await this.instruments.getById(parsed.data.instrumentId, ctx.user);
      const itemsPage = await this.items.list(ctx.user, {
        instrumentId: parsed.data.instrumentId,
        page: 1,
        pageSize: ITEMS_PAGE_SIZE,
      });

      const payload = {
        instrument: {
          id: instrument.id,
          name: instrument.name,
          shortName: instrument.shortName,
          type: instrument.type,
          subjectId: instrument.subjectId,
          gradeId: instrument.gradeId,
          year: instrument.year,
          status: instrument.status,
          isOfficial: instrument.isOfficial,
        },
        sections: instrument.sections.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          order: s.order,
          maxPoints: s.maxPoints,
        })),
        items: itemsPage.data.map((item) => ({
          id: item.id,
          position: item.position,
          type: item.type,
          stem: shortStem(item.content),
        })),
        itemCount: itemsPage.total,
      };

      return { content: JSON.stringify(payload) };
    } catch {
      return {
        content: JSON.stringify({ error: 'Instrumento no encontrado o sin acceso' }),
        isError: true,
      };
    }
  }
}

/**
 * Extrae un enunciado CORTO del `content` polimórfico del ítem (sin hardcodear un
 * único tipo): toma la primera clave textual presente (stem/prompt/passage/
 * textWithGaps) y la trunca. Mantiene el payload liviano — el contenido completo
 * lo entrega `get_item_content`.
 */
function shortStem(content: unknown): string | null {
  if (content === null || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;
  const raw =
    pickString(c.stem) ??
    pickString(c.prompt) ??
    pickString(c.passage) ??
    pickString(c.textWithGaps);
  if (raw === null) return null;
  return raw.length > STEM_PREVIEW_MAX ? `${raw.slice(0, STEM_PREVIEW_MAX)}…` : raw;
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
