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
 * asignatura + nivel) a lo largo de un eje: años (comparación generacional, N2) o la
 * historia completa de sus aplicaciones en orden cronológico (N4; acotada a un año, la
 * serie de momentos diagnóstico → monitoreo → cierre, N3). Reemplaza a
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
      'momento del ciclo); axis=moments recorre todas las aplicaciones en orden ' +
      'cronológico (año, y dentro del año diagnóstico → monitoreo → cierre), es decir ' +
      'los momentos de los años anteriores y los de este año, y acepta year para ' +
      'acotarlo al ciclo de un solo año. Requiere gradeId, ' +
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
            'years=misma medición año a año (generacional); moments=todas las aplicaciones en orden cronológico (años y momentos del ciclo).',
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
            'Acota la trayectoria a un solo año cuando axis=moments (opcional; por defecto toda la historia).',
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
