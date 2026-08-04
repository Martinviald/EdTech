import { Injectable } from '@nestjs/common';
import { progressionQuerySchema, type ProgressionResponse } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { AnalyticsService } from '../../analytics/analytics.service';

/**
 * `get_progression` — serie temporal de % de logro a través de las evaluaciones
 * de un período (H6.6). El `scope` define la entidad medida: un alumno
 * (`student` + `studentId`), un curso (`class` + `classGroupId`) o una habilidad
 * (`skill` + `nodeId`).
 *
 * Wrapper delgado sobre `AnalyticsService.progression` → hereda `withOrgContext`
 * + RLS + scoping por rol. La identidad sale de `ctx.user` (JWT), nunca del input
 * del modelo.
 *
 * GUARDRAIL PII (§11): cuando `scope === 'student'`, el `entityLabel` que devuelve
 * el service es el NOMBRE del alumno. Lo proyectamos fuera y lo reemplazamos por
 * el `studentId` (pseudónimo) antes de serializar hacia el modelo. Las series por
 * curso/habilidad son agregadas y no llevan PII.
 */
@Injectable()
export class GetProgressionTool implements AssistantTool {
  constructor(private readonly analytics: AnalyticsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_progression',
    description:
      'Devuelve la progresión (serie temporal de % de logro) a través de las ' +
      'evaluaciones de un período. Según el scope mide: un alumno (scope=student, ' +
      'requiere studentId), un curso (scope=class, requiere classGroupId) o una ' +
      'habilidad (scope=skill, requiere nodeId). Opcionalmente acota por ' +
      'subjectId, instrumentType o academicYearId. Los IDs se obtienen de ' +
      'list_filter_options. Cada punto trae assessmentName, fecha, logro (0..100) ' +
      'y nivel de desempeño, ordenados por fecha ascendente.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['student', 'class', 'skill'],
          description:
            'Entidad a medir. student=un alumno, class=un curso, skill=una habilidad.',
        },
        studentId: {
          type: 'string',
          description: 'UUID del alumno. Requerido si scope=student.',
        },
        classGroupId: {
          type: 'string',
          description: 'UUID del curso (class group). Requerido si scope=class.',
        },
        nodeId: {
          type: 'string',
          description:
            'UUID del nodo de taxonomía (habilidad). Requerido si scope=skill.',
        },
        subjectId: {
          type: 'string',
          description: 'UUID de asignatura para acotar (opcional).',
        },
        instrumentType: {
          type: 'string',
          description: 'Tipo de instrumento para acotar, p. ej. "dia" (opcional).',
        },
        academicYearId: {
          type: 'string',
          description: 'UUID del año académico para acotar (opcional).',
        },
      },
      required: ['scope'],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = progressionQuerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.analytics.progression(ctx.user, parsed.data);
    return { content: JSON.stringify(this.sanitize(data)) };
  }

  /**
   * Proyección PII-free: si la serie es de un alumno, el `entityLabel` puede ser
   * su nombre. Lo descartamos y dejamos un label neutro (el `entityId`, que es el
   * studentId pseudónimo). Los demás scopes son agregados → se pasan tal cual.
   */
  private sanitize(data: ProgressionResponse): ProgressionResponse {
    if (data.scope === 'student') {
      return { ...data, entityLabel: data.entityId };
    }
    return data;
  }
}
