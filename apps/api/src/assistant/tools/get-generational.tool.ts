import { Injectable } from '@nestjs/common';
import { generationalComparisonQuerySchema } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { AnalyticsService } from '../../analytics/analytics.service';

/**
 * `get_generational` — comparación de generaciones (H6.3): compara el mismo nivel
 * (grade) entre años académicos distintos (p. ej. 3° básico DIA Lenguaje 2025 vs
 * 2024). Puede venir vacío si sólo hay datos de un período.
 *
 * Wrapper delgado sobre `AnalyticsService.generational` → hereda `withOrgContext`
 * + RLS + scoping por rol. La identidad sale de `ctx.user` (JWT), nunca del input
 * del modelo.
 *
 * GUARDRAIL PII (§11): la respuesta es 100% agregada por año (nº de alumnos, %
 * logro, % aprobación, distribución por nivel) — no contiene nombres ni RUT, se
 * serializa tal cual.
 */
@Injectable()
export class GetGenerationalTool implements AssistantTool {
  constructor(private readonly analytics: AnalyticsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_generational',
    description:
      'Compara el mismo nivel (grade) entre años académicos distintos para ver ' +
      'la evolución generacional. Requiere gradeId; opcionalmente acota por ' +
      'subjectId, instrumentType o nodeId (para enfocar una habilidad). Los IDs ' +
      'se obtienen de list_filter_options. Devuelve una serie por año con nº de ' +
      'alumnos, % de logro promedio, % de aprobación y distribución por nivel de ' +
      'desempeño. Datos agregados, sin información de alumnos individuales.',
    inputSchema: {
      type: 'object',
      properties: {
        gradeId: {
          type: 'string',
          description: 'UUID del nivel (grade) a comparar entre años. Requerido.',
        },
        subjectId: {
          type: 'string',
          description: 'UUID de asignatura para acotar (opcional).',
        },
        instrumentType: {
          type: 'string',
          description: 'Tipo de instrumento para acotar, p. ej. "dia" (opcional).',
        },
        nodeId: {
          type: 'string',
          description:
            'UUID del nodo de taxonomía para enfocar una habilidad (opcional).',
        },
      },
      required: ['gradeId'],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = generationalComparisonQuerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.analytics.generational(ctx.user, parsed.data);
    // Respuesta agregada por año: sin PII, se serializa tal cual.
    return { content: JSON.stringify(data) };
  }
}
