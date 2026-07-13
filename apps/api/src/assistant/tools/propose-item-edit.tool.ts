import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { ItemEditProposalsService } from '../../item-edit-proposals/item-edit-proposals.service';

/**
 * Validación local del input que propone el modelo. `itemId` identifica el ítem a
 * editar; `instruction` es lo que se quiere cambiar del enunciado/alternativas/clave.
 */
const inputSchema = z.object({
  itemId: z.string().uuid(),
  instruction: z.string().trim().min(3).max(2000),
});

/**
 * Tool `propose_item_edit` (TKT-19): el asistente PROPONE una edición del contenido
 * de un ítem (enunciado, alternativas, clave). NO aplica el cambio — crea una
 * propuesta en estado `pending` que un humano con permiso de edición debe aprobar
 * o rechazar desde el banco de ítems (§8.3: la IA propone, el humano aprueba).
 *
 * Wrapper delgado sobre `ItemEditProposalsService.propose` con `author='ai'`. La
 * identidad (orgId/roles) sale de `ctx.user` (JWT), nunca de los argumentos del
 * modelo; el service verifica que el ítem sea editable por el usuario.
 */
@Injectable()
export class ProposeItemEditTool implements AssistantTool {
  constructor(private readonly proposals: ItemEditProposalsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'propose_item_edit',
    description:
      'PROPONE una edición del contenido de una pregunta (ítem): enunciado, ' +
      'alternativas o clave correcta. NO aplica el cambio — crea una propuesta ' +
      'que queda PENDIENTE de aprobación humana en el banco de ítems. Úsala cuando ' +
      'el usuario pida ayuda para mejorar o corregir una pregunta. Entrega el ' +
      'itemId (UUID de la pregunta) y una instrucción clara de qué cambiar. Tras ' +
      'llamarla, informa al usuario que la propuesta quedó pendiente de su ' +
      'aprobación; nunca afirmes que el ítem ya fue modificado.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'UUID del ítem (pregunta) a editar.',
        },
        instruction: {
          type: 'string',
          description:
            'Qué cambiar del ítem, en lenguaje natural. Ej: "mejora la redacción ' +
            'del enunciado para que sea más claro", "la clave correcta debería ser B".',
        },
      },
      required: ['itemId', 'instruction'],
    },
  };

  async execute(input: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos: entrega itemId (UUID) e instruction (texto).',
        }),
        isError: true,
      };
    }

    try {
      const proposal = await this.proposals.propose(ctx.user, parsed.data, 'ai');
      return {
        content: JSON.stringify({
          proposalId: proposal.id,
          itemId: proposal.itemId,
          status: proposal.status,
          reasoning: proposal.reasoning,
          note:
            'Propuesta creada en estado PENDIENTE. Un humano con permiso de edición ' +
            'debe aprobarla o rechazarla en el banco de ítems. El ítem NO fue modificado.',
        }),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo crear la propuesta de edición';
      return {
        content: JSON.stringify({ error: message }),
        isError: true,
      };
    }
  }
}
