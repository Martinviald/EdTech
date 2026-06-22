import { Injectable } from '@nestjs/common';
import { assessmentListQuerySchema } from '@soe/types';
import type {
  AssistantTool,
  AssistantToolContext,
  AssistantToolResult,
} from './assistant-tool.types';
import type { LlmToolDefinition } from '../../llm/llm.types';
import { ItemAnalysisService } from '../../item-analysis/item-analysis.service';

/**
 * `list_assessments` — evaluaciones ADMINISTRADAS con resultados visibles (H21.x).
 *
 * Resuelve el hueco que hacía adivinar `assessmentId` al modelo:
 * `list_filter_options` devuelve cursos/asignaturas/instrumentos/períodos, pero NO
 * las evaluaciones. Esta tool lista las `assessments` (con su `assessmentId`,
 * nombre, asignatura, grado, tipo de instrumento y fecha) para que el modelo
 * resuelva "la DIA de mate diagnóstico 2026" → su UUID antes de llamar a
 * `get_assessment_report` o `get_student_detail`. Agregado (sin PII), acotado al
 * scope de `ctx.user`. Filtros opcionales (UUIDs de list_filter_options).
 */
@Injectable()
export class ListAssessmentsTool implements AssistantTool {
  constructor(private readonly itemAnalysis: ItemAnalysisService) {}

  readonly definition: LlmToolDefinition = {
    name: 'list_assessments',
    description:
      'Lista las evaluaciones administradas con resultados (assessments) del ' +
      'scope del usuario: cada una con su assessmentId (UUID), nombre, asignatura, ' +
      'grado, tipo de instrumento (p. ej. "dia") y fecha de aplicación. ÚSALA para ' +
      'resolver el nombre de una evaluación a su assessmentId ANTES de llamar a ' +
      'get_assessment_report o get_student_detail (que requieren ese UUID). ' +
      'Filtros opcionales por asignatura, grado, curso, período o tipo de ' +
      'instrumento; sus IDs (UUID) se obtienen de list_filter_options.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: {
          type: 'string',
          description: 'UUID de la asignatura. Sale de list_filter_options.',
        },
        gradeId: {
          type: 'string',
          description: 'UUID del grado/nivel. Sale de list_filter_options.',
        },
        classGroupId: {
          type: 'string',
          description: 'UUID del curso (class group). Sale de list_filter_options.',
        },
        academicYearId: {
          type: 'string',
          description: 'UUID del período/año académico. Sale de list_filter_options.',
        },
        instrumentType: {
          type: 'string',
          description: 'Tipo de instrumento (p. ej. "dia"). Texto, no UUID.',
        },
      },
      required: [],
    },
  };

  async execute(input: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = assessmentListQuerySchema.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        content: JSON.stringify({
          error: 'Parámetros inválidos',
          details: parsed.error.issues,
        }),
        isError: true,
      };
    }

    const data = await this.itemAnalysis.listAssessments(ctx.user, parsed.data);
    return { content: JSON.stringify(data) };
  }
}
