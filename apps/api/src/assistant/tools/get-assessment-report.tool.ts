import { Injectable } from '@nestjs/common';
import {
  assessmentReportQuerySchema,
  type AssessmentReportResponse,
  type AssessmentReportRiskStudent,
} from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { AssessmentReportService } from '../../assessment-report/assessment-report.service';

/** Alumno en foco SIN PII: estructuralmente igual pero sin nombre ni RUT. */
type RiskStudentPiiFree = Omit<
  AssessmentReportRiskStudent,
  'studentRut' | 'studentFullName'
>;

/** Informe con `studentsAtRisk` proyectado a su forma PII-free. */
type AssessmentReportPiiFree = Omit<
  AssessmentReportResponse,
  'studentsAtRisk'
> & {
  studentsAtRisk: RiskStudentPiiFree[];
};

/**
 * `get_assessment_report` — informe psicométrico consolidado de una evaluación
 * (H6.13): ficha técnica, síntesis ejecutiva, distribución por nivel, comparativa
 * por curso, fortalezas/brechas por habilidad, análisis de ítems (dificultad,
 * discriminación, distractor dominante, flags) y recomendaciones accionables.
 *
 * Wrapper delgado sobre `AssessmentReportService.getReport` → hereda
 * `withOrgContext` + RLS + scoping por rol. La identidad sale de `ctx.user`
 * (JWT), nunca del input del modelo.
 *
 * GUARDRAIL PII (§11): `studentsAtRisk[]` trae `studentFullName` y `studentRut`.
 * Los removemos y dejamos sólo `studentId` (pseudónimo) + métricas. El resto del
 * informe es agregado (skills, items, distribución, recomendaciones) → se pasa
 * tal cual.
 */
@Injectable()
export class GetAssessmentReportTool implements AssistantTool {
  constructor(private readonly report: AssessmentReportService) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_assessment_report',
    description:
      'Devuelve el informe psicométrico consolidado de una evaluación: síntesis ' +
      'ejecutiva (logro, aprobación, cobertura), distribución por nivel de ' +
      'desempeño, comparativa por curso, fortalezas y brechas por habilidad, ' +
      'análisis de ítems (dificultad, discriminación, distractor dominante, ' +
      'flags como critical/low_discrimination/strong_distractor/easy) y ' +
      'recomendaciones accionables. Requiere assessmentId; opcionalmente acota a ' +
      'un curso con classGroupId. Los IDs se obtienen de list_filter_options o ' +
      'get_dashboard_*. No expone nombres ni RUT de alumnos.',
    inputSchema: {
      type: 'object',
      properties: {
        assessmentId: {
          type: 'string',
          description: 'UUID de la evaluación a analizar. Requerido.',
        },
        classGroupId: {
          type: 'string',
          description:
            'UUID del curso (class group) para acotar el informe a ese curso (opcional).',
        },
      },
      required: ['assessmentId'],
    },
  };

  async execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const parsed = assessmentReportQuerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.report.getReport(ctx.user, parsed.data);
    return { content: JSON.stringify(this.sanitize(data)) };
  }

  /**
   * Proyección PII-free: descarta `studentFullName`/`studentRut` de cada alumno
   * en foco, conservando `studentId` + métricas (achievement, performanceLevel,
   * weakestSkill, classGroupName). El resto del informe es agregado.
   */
  private sanitize(data: AssessmentReportResponse): AssessmentReportPiiFree {
    const studentsAtRisk: RiskStudentPiiFree[] = data.studentsAtRisk.map(
      (s) => ({
        studentId: s.studentId,
        classGroupName: s.classGroupName,
        achievement: s.achievement,
        performanceLevel: s.performanceLevel,
        weakestSkill: s.weakestSkill,
      }),
    );
    return { ...data, studentsAtRisk };
  }
}
