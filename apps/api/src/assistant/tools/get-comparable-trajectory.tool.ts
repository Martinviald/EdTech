import { Injectable } from '@nestjs/common';
import { comparableTrajectoryQuerySchema } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { ComparableTrajectoryService } from '../../analytics/comparable-trajectory.service';

/**
 * `get_comparable_trajectory` — la trayectoria de UNA familia comparable (tipo +
 * asignatura + nivel) a lo largo de un eje: años (comparación generacional, N2) o
 * momentos del ciclo diagnóstico → monitoreo → cierre (N3). Reemplaza a
 * `get_generational` y `get_progression`, que promediaban instrumentos no comparables.
 *
 * Wrapper delgado sobre `ComparableTrajectoryService.trajectory` → hereda
 * `withOrgContext` + RLS + scoping por rol. La identidad sale de `ctx.user` (JWT),
 * nunca del input del modelo.
 *
 * GUARDRAIL PII (§11): la respuesta es 100% agregada (puntos por año/momento con % de
 * logro y distribución por banda, desglose por curso con su nombre y su %, y los dos
 * baselines). No contiene nombres ni RUT de alumnos → se serializa tal cual.
 */
@Injectable()
export class GetComparableTrajectoryTool implements AssistantTool {
  constructor(private readonly trajectory: ComparableTrajectoryService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_comparable_trajectory',
    description:
      'Devuelve la trayectoria comparable de una familia de instrumento (mismo tipo, ' +
      'asignatura y nivel) a lo largo de un eje. axis=years compara la misma medición ' +
      'entre años (evolución generacional, requiere applicationPeriod para fijar el ' +
      'momento del ciclo); axis=moments recorre el ciclo diagnóstico → monitoreo → ' +
      'cierre de un año (requiere/asume el año más reciente). Requiere gradeId, ' +
      'subjectId e instrumentType; opcionalmente acota a un curso con classGroupId. ' +
      'Los IDs se obtienen de list_filter_options. Cada punto es una aplicación ' +
      'comparable con su % de logro y distribución por las bandas del instrumento (nunca ' +
      'un promedio entre instrumentos distintos). Trae además el desglose por curso del ' +
      'punto actual y sus dos variaciones: vs el momento anterior del ciclo y vs el año ' +
      'anterior. Datos agregados, sin información de alumnos individuales.',
    inputSchema: {
      type: 'object',
      properties: {
        axis: {
          type: 'string',
          enum: ['years', 'moments'],
          description:
            'years=misma medición año a año (generacional); moments=ciclo diagnóstico→monitoreo→cierre de un año.',
        },
        gradeId: { type: 'string', description: 'UUID del nivel (grade). Requerido.' },
        subjectId: { type: 'string', description: 'UUID de asignatura. Requerido.' },
        instrumentType: {
          type: 'string',
          description: 'Tipo de instrumento, p. ej. "dia". Requerido.',
        },
        applicationPeriod: {
          type: 'string',
          enum: ['diagnostico', 'intermedio', 'cierre'],
          description: 'Momento del ciclo a fijar cuando axis=years (opcional en otros casos).',
        },
        year: {
          type: 'number',
          description:
            'Año a recorrer cuando axis=moments (opcional; por defecto el más reciente).',
        },
        classGroupId: {
          type: 'string',
          description: 'UUID del curso para acotar el alcance al nivel de un curso (opcional).',
        },
      },
      required: ['axis', 'gradeId', 'subjectId', 'instrumentType'],
    },
  };

  async execute(input: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = comparableTrajectoryQuerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({ error: 'Parámetros inválidos', details: parsed.error.issues }),
        isError: true,
      };
    }

    const data = await this.trajectory.trajectory(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
