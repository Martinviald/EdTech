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
 * asignatura + nivel) como matriz año × momento del ciclo: el eje es el ciclo
 * (diagnóstico → monitoreo → cierre) y hay una serie por año, de la más reciente a la
 * más antigua (N4 `instrument_history`; acotada a un año, la serie de momentos de ese
 * ciclo, N3). Reemplaza a `get_generational` y `get_progression`, que promediaban
 * instrumentos no comparables.
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
      'asignatura y nivel) como una matriz año × momento del ciclo. El eje son los ' +
      'momentos (diagnóstico → monitoreo → cierre, en `periods`) y hay UNA serie por año ' +
      'en `series`, de la más reciente a la más antigua: así se compara evaluación a ' +
      'evaluación el año en curso contra los años anteriores del mismo nivel. Cada serie ' +
      'trae la etiqueta de su generación ("2025 · hoy 6º básico"), porque los alumnos de ' +
      'un año anterior hoy están un nivel más arriba. Requiere gradeId, subjectId e ' +
      'instrumentType; year acota la respuesta a una sola serie (el ciclo de ese año) y ' +
      'classGroupId acota el alcance a un curso. Los IDs se obtienen de ' +
      'list_filter_options. Cada punto es una aplicación comparable con su % de logro y ' +
      'distribución por las bandas del instrumento (nunca un promedio entre instrumentos ' +
      'distintos). `current` es el último momento con datos del año más reciente; trae ' +
      'además el desglose por curso de ese punto y sus dos variaciones: vs el momento ' +
      'anterior del ciclo y vs el año anterior. Datos agregados, sin información de ' +
      'alumnos individuales.',
    inputSchema: {
      type: 'object',
      properties: {
        gradeId: { type: 'string', description: 'UUID del nivel (grade). Requerido.' },
        subjectId: { type: 'string', description: 'UUID de asignatura. Requerido.' },
        instrumentType: {
          type: 'string',
          description: 'Tipo de instrumento, p. ej. "dia". Requerido.',
        },
        year: {
          type: 'number',
          description:
            'Acota la trayectoria al ciclo de un solo año (opcional; por defecto todos los años de la familia).',
        },
        classGroupId: {
          type: 'string',
          description: 'UUID del curso para acotar el alcance al nivel de un curso (opcional).',
        },
      },
      required: ['gradeId', 'subjectId', 'instrumentType'],
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
