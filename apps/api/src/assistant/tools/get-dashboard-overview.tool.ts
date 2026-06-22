import { Injectable } from '@nestjs/common';
import { dashboardFiltersQuerySchema } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { DashboardsService } from '../../dashboards/dashboards.service';

/**
 * `get_dashboard_overview` — KPIs macro del dashboard (H21.5).
 *
 * Wrapper delgado sobre `DashboardsService.getOverview`: devuelve logro global,
 * alumnos evaluados, conteo de evaluaciones, distribución por nivel de
 * desempeño, evaluaciones recientes y alertas. Todo agregado (sin PII), acotado
 * al scope del usuario autenticado (`ctx.user`). Los filtros opcionales son
 * UUIDs que salen de `list_filter_options`.
 */
@Injectable()
export class GetDashboardOverviewTool implements AssistantTool {
  constructor(private readonly dashboards: DashboardsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_dashboard_overview',
    description:
      'Resumen macro del dashboard: logro global (%), alumnos evaluados, ' +
      'cantidad de evaluaciones, distribución por nivel de desempeño, ' +
      'evaluaciones recientes y alertas. Datos agregados (sin información de ' +
      'alumnos individuales). Filtros opcionales por curso, grado, asignatura, ' +
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
        studentId: {
          type: 'string',
          description: 'UUID de un alumno para acotar el scope.',
        },
      },
      required: [],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = dashboardFiltersQuerySchema.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.dashboards.getOverview(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
