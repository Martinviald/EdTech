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
 * `list_filter_options` — tool de RESOLUCIÓN DE NOMBRES (H21.5).
 *
 * Es la tool que el modelo usa PRIMERO para traducir lo que escribe el usuario
 * en lenguaje natural ("4°A", "matemática", "este año") a los UUIDs que exigen
 * las demás tools del asistente (`get_dashboard_*`, `get_heatmap`). Devuelve, en
 * el scope del usuario autenticado, los catálogos de asignaturas, grados, cursos
 * (class groups), períodos (academic years) e instrumentos con su `id` + `label`.
 *
 * Wrapper delgado sobre `DashboardsService.getFilterOptions` → hereda
 * `withOrgContext` + RLS + scoping por rol. La identidad sale de `ctx.user`
 * (JWT), nunca del input del modelo.
 */
@Injectable()
export class ListFilterOptionsTool implements AssistantTool {
  constructor(private readonly dashboards: DashboardsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'list_filter_options',
    description:
      'Resuelve nombres en lenguaje natural a UUIDs. Devuelve los catálogos ' +
      'visibles para el usuario (asignaturas, grados, cursos/class groups, ' +
      'períodos académicos e instrumentos), cada uno con su id (UUID) y label. ' +
      'LLÁMALA PRIMERO para traducir lo que pide el usuario (p. ej. "4°A", ' +
      '"matemática", "DIA", "2024") a los UUIDs que requieren las demás tools ' +
      '(get_dashboard_overview, get_dashboard_skills, get_dashboard_performance, ' +
      'get_heatmap). No inventes IDs: úsalos de aquí.',
    inputSchema: {
      type: 'object',
      properties: {},
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

    const data = await this.dashboards.getFilterOptions(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
