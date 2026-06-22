import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AssessmentResultModel,
  StudentResultDetail,
} from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { AssessmentResultsService } from '../../assessment-results/assessment-results.service';

// Input local: dos UUIDs (no es un query DTO de @soe/types).
const inputSchema = z.object({
  assessmentId: z.string().uuid(),
  studentId: z.string().uuid(),
});

/** Resultado del alumno SIN PII: igual al modelo pero sin nombre ni RUT. */
type ResultPiiFree = Omit<
  AssessmentResultModel,
  'studentRut' | 'studentFullName'
>;

/** Detalle del alumno con `result` proyectado a su forma PII-free. */
type StudentResultDetailPiiFree = Omit<StudentResultDetail, 'result'> & {
  result: ResultPiiFree;
};

/**
 * `get_student_detail` — detalle del resultado de UN alumno en UNA evaluación:
 * métricas globales (logro, nota, nivel), resultados por habilidad y la respuesta
 * por ítem (acierto/error y puntajes).
 *
 * Wrapper delgado sobre `AssessmentResultsService.getStudentDetail` → hereda
 * `withOrgContext` + RLS + scoping por rol. La identidad sale de `ctx.user`
 * (JWT), nunca del input del modelo.
 *
 * GUARDRAIL PII (§11): el `result` trae `studentFullName` y `studentRut`. Los
 * removemos y dejamos sólo `studentId` (pseudónimo) + métricas. `skillResults` y
 * `responses` no llevan PII (sólo nodeId/itemId + métricas).
 */
@Injectable()
export class GetStudentDetailTool implements AssistantTool {
  constructor(private readonly results: AssessmentResultsService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_student_detail',
    description:
      'Devuelve el detalle del resultado de un alumno en una evaluación: ' +
      'métricas globales (porcentaje de logro, nota, nivel de desempeño), ' +
      'resultados por habilidad y la respuesta por ítem (acierto/error y ' +
      'puntajes). Requiere assessmentId y studentId (ambos UUID); los obtienes de ' +
      'list_filter_options o get_dashboard_*. Identifica al alumno sólo por su ' +
      'studentId: no expone nombre ni RUT.',
    inputSchema: {
      type: 'object',
      properties: {
        assessmentId: {
          type: 'string',
          description: 'UUID de la evaluación. Requerido.',
        },
        studentId: {
          type: 'string',
          description: 'UUID del alumno. Requerido.',
        },
      },
      required: ['assessmentId', 'studentId'],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.results.getStudentDetail(
      ctx.user,
      parsed.data.assessmentId,
      parsed.data.studentId,
    );
    return { content: JSON.stringify(this.sanitize(data)) };
  }

  /**
   * Proyección PII-free: descarta `studentFullName`/`studentRut` del `result`,
   * conservando `studentId` + métricas. `skillResults` y `responses` ya son
   * PII-free.
   */
  private sanitize(data: StudentResultDetail): StudentResultDetailPiiFree {
    const { studentRut, studentFullName, ...result } = data.result;
    void studentRut;
    void studentFullName;
    return { ...data, result };
  }
}
