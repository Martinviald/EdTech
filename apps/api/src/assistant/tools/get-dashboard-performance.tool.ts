import { Injectable } from '@nestjs/common';
import {
  dashboardPerformanceQuerySchema,
  type StudentClassificationModel,
} from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { DashboardsService } from '../../dashboards/dashboards.service';

/** Límite de filas que devolvemos al modelo por defecto (PII-safe, compacto). */
const DEFAULT_LIMIT = 50;

/**
 * Fila de alumno SIN PII, lista para serializar al modelo. Conserva el
 * `studentId` (UUID, opaco) para que el FRONTEND re-hidrate el nombre; jamás
 * incluye `studentFullName` ni `studentRut`.
 */
type ProjectedStudentRow = Omit<
  StudentClassificationModel,
  'studentFullName' | 'studentRut'
>;

/**
 * `get_dashboard_performance` — clasificación de alumnos por desempeño (H21.5).
 *
 * Wrapper sobre `DashboardsService.getPerformance` con un GUARDRAIL PII crítico:
 * `getPerformance` devuelve filas con `studentFullName` y `studentRut`. Esta
 * tool PROYECTA esas filas eliminando nombre y RUT antes de serializar — el
 * modelo solo ve `studentId` (UUID) + `achievement` + `grade` +
 * `performanceLevel` + `classGroup{Id,Name}`. El nombre lo re-hidrata el
 * frontend; NUNCA debe viajar al modelo.
 *
 * Paginado: por defecto `page: 1`, `limit: 50`. El JSON indica `total` (filas
 * totales) vs `returned` (devueltas) para que el modelo sepa si hubo truncado.
 */
@Injectable()
export class GetDashboardPerformanceTool implements AssistantTool {
  constructor(private readonly dashboards: DashboardsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_dashboard_performance',
    description:
      'Clasificación de alumnos por desempeño: distribución por nivel y, por ' +
      'alumno, su % logro, nota promedio, nivel de desempeño y curso. Por ' +
      'privacidad, NO devuelve nombre ni RUT — solo un studentId opaco (el ' +
      'nombre lo resuelve la interfaz). Paginado (por defecto 50 filas); el ' +
      'campo total indica cuántos alumnos hay en total. Filtros opcionales por ' +
      'curso, grado, asignatura, instrumento, período o nivel de desempeño; sus ' +
      'IDs (UUID) se obtienen de list_filter_options.',
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
        performanceLevel: {
          type: 'string',
          description:
            'Filtra alumnos por nivel de desempeño (p. ej. "insufficient", ' +
            '"elementary", "adequate", "advanced").',
        },
        page: {
          type: 'number',
          description: 'Página (1-indexada). Por defecto 1.',
        },
        limit: {
          type: 'number',
          description: `Filas por página (máx 200). Por defecto ${DEFAULT_LIMIT}.`,
        },
      },
      required: [],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    // Por defecto acotamos a una página razonable (page 1, limit 50) para no
    // inundar al modelo. El usuario/modelo puede sobreescribir page/limit.
    const raw = (input ?? {}) as Record<string, unknown>;
    const parsed = dashboardPerformanceQuerySchema.safeParse({
      limit: DEFAULT_LIMIT,
      ...raw,
    });
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.dashboards.getPerformance(ctx.user, parsed.data);

    // GUARDRAIL PII: eliminamos studentFullName/studentRut de cada fila. El
    // modelo solo recibe el studentId opaco + métricas + curso.
    const projected: ProjectedStudentRow[] = data.students.data.map((s) => ({
      studentId: s.studentId,
      classGroupId: s.classGroupId,
      classGroupName: s.classGroupName,
      achievement: s.achievement,
      grade: s.grade,
      performanceLevel: s.performanceLevel,
    }));

    const payload = {
      distribution: data.distribution,
      thresholds: data.thresholds,
      students: {
        data: projected,
        total: data.students.total,
        returned: projected.length,
        page: data.students.page,
        limit: data.students.limit,
        truncated: data.students.total > projected.length,
      },
    };

    return { content: JSON.stringify(payload) };
  }
}
