import { Injectable, NotFoundException } from '@nestjs/common';
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
import { ItemAnalysisService } from '../../item-analysis/item-analysis.service';

/** Alumno en foco SIN PII: estructuralmente igual pero sin nombre ni RUT. */
type RiskStudentPiiFree = Omit<AssessmentReportRiskStudent, 'studentRut' | 'studentFullName'>;

/** Informe con `studentsAtRisk` proyectado a su forma PII-free. */
type AssessmentReportPiiFree = Omit<AssessmentReportResponse, 'studentsAtRisk'> & {
  studentsAtRisk: RiskStudentPiiFree[];
};

/**
 * `get_assessment_report` — informe consolidado de resultados de una evaluación
 * (H6.13): ficha técnica, síntesis ejecutiva, distribución por nivel, comparativa
 * por curso, fortalezas/brechas por habilidad, análisis de ítems (dificultad,
 * distractor dominante, flags) y recomendaciones accionables.
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
  constructor(
    private readonly report: AssessmentReportService,
    private readonly itemAnalysis: ItemAnalysisService,
  ) {}

  readonly definition: LlmToolDefinition = {
    name: 'get_assessment_report',
    description:
      'Devuelve el informe consolidado de resultados de una evaluación: síntesis ' +
      'ejecutiva (logro, aprobación, cobertura), distribución por nivel de ' +
      'desempeño, comparativa por curso, fortalezas y brechas por habilidad, ' +
      'análisis de ítems (% de logro, distractor dominante, flags como ' +
      'critical/dominant_error/high_achievement) y recomendaciones accionables. ' +
      'Los flags describen el APRENDIZAJE del curso, no la calidad del ' +
      'instrumento: son pruebas estandarizadas y validadas y no se juzgan. ' +
      'Requiere assessmentId; opcionalmente acota a un curso con classGroupId. ' +
      'El assessmentId se obtiene SIEMPRE de list_assessments: list_filter_options ' +
      'devuelve instrumentos, no evaluaciones, y cada curso tiene su propia ' +
      'evaluación del mismo instrumento. No expone nombres ni RUT de alumnos.',
    inputSchema: {
      type: 'object',
      properties: {
        assessmentId: {
          type: 'string',
          description:
            'UUID de la evaluación (assessmentId de list_assessments, no el id de un instrumento). Requerido.',
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

  async execute(input: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
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

    try {
      const data = await this.report.getReport(ctx.user, parsed.data);
      return { content: JSON.stringify(this.sanitize(data)) };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.notFoundGuidance(ctx, parsed.data.assessmentId);
      }
      throw error;
    }
  }

  private async notFoundGuidance(
    ctx: AssistantToolContext,
    unknownId: string,
  ): Promise<AssistantToolResult> {
    const { data: assessmentsOfInstrument } = await this.itemAnalysis.listAssessments(ctx.user, {
      instrumentId: [unknownId],
    });
    if (assessmentsOfInstrument.length === 0) {
      return {
        content: JSON.stringify({
          error:
            'No existe una evaluación con ese assessmentId dentro de tu alcance. ' +
            'Busca el assessmentId con list_assessments antes de reintentar.',
        }),
        isError: true,
      };
    }
    return {
      content: JSON.stringify({
        error:
          'Ese UUID es de un instrumento, no de una evaluación. Cada curso tiene su ' +
          'propia evaluación de este instrumento: reintenta con el assessmentId de ' +
          'la que corresponda o pregunta al usuario qué curso quiere ver.',
        assessments: assessmentsOfInstrument.map((assessment) => ({
          assessmentId: assessment.assessmentId,
          name: assessment.name,
          gradeName: assessment.gradeName,
          studentsCount: assessment.studentsCount,
        })),
      }),
      isError: true,
    };
  }

  /**
   * Proyección PII-free: descarta `studentFullName`/`studentRut` de cada alumno
   * en foco, conservando `studentId` + métricas (achievement, performanceLevel,
   * weakestSkill, classGroupName). El resto del informe es agregado.
   */
  private sanitize(data: AssessmentReportResponse): AssessmentReportPiiFree {
    const studentsAtRisk: RiskStudentPiiFree[] = data.studentsAtRisk.map((s) => ({
      studentId: s.studentId,
      classGroupName: s.classGroupName,
      achievement: s.achievement,
      performanceLevel: s.performanceLevel,
      weakestSkill: s.weakestSkill,
    }));
    return { ...data, studentsAtRisk };
  }
}
