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
 * `get_dashboard_skills` — logro promedio por habilidad (H21.5).
 *
 * Wrapper delgado sobre `DashboardsService.getSkills`: devuelve, por cada
 * habilidad (taxonomy node), el % logro promedio, el nivel de desempeño y los
 * alumnos evaluados. Agregado (sin PII), acotado al scope de `ctx.user`. Los
 * filtros opcionales son UUIDs que salen de `list_filter_options`.
 */
@Injectable()
export class GetDashboardSkillsTool implements AssistantTool {
  constructor(private readonly dashboards: DashboardsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_dashboard_skills',
    description:
      'Logro promedio por habilidad (taxonomy node): % logro, nivel de ' +
      'desempeño y alumnos evaluados por habilidad. Útil para detectar ' +
      'habilidades descendidas. Datos agregados (sin alumnos individuales). ' +
      'Filtros opcionales por curso, grado, asignatura, instrumento o período; ' +
      'sus IDs (UUID) se obtienen de list_filter_options.',
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

    const data = await this.dashboards.getSkills(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
