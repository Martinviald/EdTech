import { Injectable } from '@nestjs/common';
import { comparableOverviewQuerySchema } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { ComparableOverviewService } from '../../dashboards/comparable-overview.service';

/**
 * `get_comparable_overview` — el panorama por unidad comparable y sus alertas.
 *
 * Existe porque `get_dashboard_overview` dejó de entregar un "% de logro global": ese
 * número promediaba instrumentos de distinta dificultad y el modelo razonaba sobre él
 * como si significara algo. Acá cada % vive dentro de UN instrumento, cada unidad trae
 * su delta contra su propio comparable, y las alertas vienen con el corte del
 * instrumento que las originó.
 */
@Injectable()
export class GetComparableOverviewTool implements AssistantTool {
  constructor(private readonly comparableOverview: ComparableOverviewService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_comparable_overview',
    description:
      'Panorama desglosado por unidad comparable (un instrumento): % de logro de cada ' +
      'una, distribución por nivel, desglose por curso, comparación contra el mismo ' +
      'instrumento del año anterior o del momento anterior, y las alertas vigentes. ' +
      'USA ESTA HERRAMIENTA para preguntas de "cómo vamos" o "qué está mal": no existe ' +
      'un % de logro global, porque promediar instrumentos de distinta dificultad no es ' +
      'interpretable. Filtros opcionales; sus IDs salen de list_filter_options.',
    inputSchema: {
      type: 'object',
      properties: {
        classGroupId: {
          type: 'string',
          description: 'UUID del curso. Sale de list_filter_options.',
        },
        gradeId: { type: 'string', description: 'UUID del grado/nivel.' },
        subjectId: { type: 'string', description: 'UUID de la asignatura.' },
        instrumentId: { type: 'string', description: 'UUID del instrumento.' },
        instrumentType: { type: 'string', description: 'Tipo de instrumento (p. ej. "dia").' },
        assessmentId: { type: 'string', description: 'UUID de una evaluación específica.' },
        academicYearId: { type: 'string', description: 'UUID del período/año académico.' },
      },
      required: [],
    },
  };

  async execute(input: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = comparableOverviewQuerySchema.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        content: JSON.stringify({ error: 'Parámetros inválidos', details: parsed.error.issues }),
        isError: true,
      };
    }

    const data = await this.comparableOverview.getComparableOverview(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
