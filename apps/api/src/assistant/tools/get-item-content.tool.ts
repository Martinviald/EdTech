import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { ItemsService } from '../../items/items.service';

/**
 * Validación local del input que propone el modelo. El ítem se identifica por
 * `itemId` O por `assessmentId` + `position` (la pregunta en esa posición de la
 * evaluación). `refine` exige que llegue uno de los dos modos completos.
 */
const inputSchema = z
  .object({
    itemId: z.string().uuid().optional(),
    assessmentId: z.string().uuid().optional(),
    position: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.itemId !== undefined ||
      (v.assessmentId !== undefined && v.position !== undefined),
    {
      message: 'Debe entregar itemId, o bien assessmentId y position.',
    },
  );

/**
 * Tool `get_item_content` (H21.6b): lee el enunciado + alternativas de una
 * pregunta en forma NORMALIZADA y PII-free, para que el modelo explique la
 * misconcepción detrás del distractor dominante. Wrapper delgado sobre
 * `ItemsService.getContentForAssistant` — la identidad sale de `ctx.user` (JWT),
 * nunca de los argumentos del modelo (CLAUDE.md §6.3, §11).
 */
@Injectable()
export class GetItemContentTool implements AssistantTool {
  constructor(private readonly items: ItemsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_item_content',
    description:
      'Lee el enunciado y las alternativas de una pregunta (ítem) de una prueba ' +
      'para explicar por qué los alumnos eligieron un distractor (alternativa ' +
      'incorrecta) y qué misconcepción hay detrás. Devuelve enunciado, ' +
      'alternativas clave→texto, la clave correcta y la habilidad evaluada. ' +
      'Usa itemId si lo conoces; si no, identifica la pregunta por assessmentId ' +
      'y su position (número de la pregunta en la evaluación). Solo contenido de ' +
      'la prueba, sin datos de alumnos.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description:
            'UUID del ítem. Úsalo cuando lo conozcas directamente.',
        },
        assessmentId: {
          type: 'string',
          description:
            'UUID de la evaluación. Combínalo con `position` para identificar la ' +
            'pregunta sin conocer su itemId.',
        },
        position: {
          type: 'number',
          description:
            'Número de la pregunta (posición) dentro de la evaluación. Requiere ' +
            '`assessmentId`.',
        },
      },
      required: [],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error:
            'Parámetros inválidos: entrega itemId, o assessmentId y position.',
        }),
        isError: true,
      };
    }

    try {
      const data = await this.items.getContentForAssistant(ctx.user, parsed.data);
      return { content: JSON.stringify(data) };
    } catch {
      return {
        content: JSON.stringify({ error: 'Ítem no encontrado o sin acceso' }),
        isError: true,
      };
    }
  }
}
