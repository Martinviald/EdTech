import { Injectable } from '@nestjs/common';
import { heatmapQuerySchema } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { HeatmapService } from '../../heatmap/heatmap.service';

/**
 * `get_heatmap` — matriz habilidad × asignatura de % logro (H21.5).
 *
 * Wrapper delgado sobre `HeatmapService.getHeatmap`: devuelve filas
 * (habilidades) × columnas (asignaturas) con el % logro promedio y nivel de
 * desempeño por celda, ordenadas por criticidad. Agregado (sin PII), acotado al
 * scope de `ctx.user`. Los filtros opcionales son UUIDs que salen de
 * `list_filter_options`.
 */
@Injectable()
export class GetHeatmapTool implements AssistantTool {
  constructor(private readonly heatmap: HeatmapService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_heatmap',
    description:
      'Mapa de calor habilidad × asignatura: para cada habilidad (taxonomy ' +
      'node) y cada asignatura, el % logro promedio y el nivel de desempeño, ' +
      'con las habilidades más críticas primero. Datos agregados (sin alumnos ' +
      'individuales). Filtros opcionales por curso, grado, asignatura, ' +
      'instrumento o período; sus IDs (UUID) se obtienen de list_filter_options.',
    inputSchema: {
      type: 'object',
      properties: {
        classGroupId: {
          type: 'string',
          description: 'UUID del curso (class group). Sale de list_filter_options.',
        },
        gradeId: {
          type: 'string',
          description: 'UUID del grado/nivel. Sale de list_filter_options.',
        },
        subjectId: {
          type: 'string',
          description: 'UUID de la asignatura. Sale de list_filter_options.',
        },
        instrumentId: {
          type: 'string',
          description: 'UUID del instrumento. Sale de list_filter_options.',
        },
        instrumentType: {
          type: 'string',
          description: 'Tipo de instrumento (p. ej. "dia"). Texto, no UUID.',
        },
        assessmentId: {
          type: 'string',
          description: 'UUID de una evaluación específica.',
        },
        academicYearId: {
          type: 'string',
          description: 'UUID del período/año académico. Sale de list_filter_options.',
        },
      },
      required: [],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = heatmapQuerySchema.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.heatmap.getHeatmap(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
