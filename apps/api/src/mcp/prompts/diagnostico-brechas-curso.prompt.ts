import { Injectable } from '@nestjs/common';
import { DASHBOARD_VIEWER_ROLES } from '@soe/types';
import {
  McpPromptProvider,
  type McpPrompt,
  type PromptDescriptor,
  type PromptMessage,
} from '../core/mcp-prompt';

@McpPromptProvider()
@Injectable()
export class DiagnosticoBrechasCursoPrompt implements McpPrompt {
  readonly descriptor: PromptDescriptor = {
    name: 'diagnostico_brechas_curso',
    description:
      'Diagnóstico de brechas de aprendizaje de un curso: panorama de logro, mapa de calor de ' +
      'habilidades y brechas priorizadas.',
    arguments: [
      { name: 'classGroupId', description: 'ID del curso a diagnosticar', required: true },
      {
        name: 'assessmentId',
        description: 'Opcional: acotar a una evaluación específica',
        required: false,
      },
    ],
    requiredRoles: DASHBOARD_VIEWER_ROLES,
  };

  render(args: Record<string, string>): PromptMessage[] {
    const classGroupId = args.classGroupId ?? '<classGroupId>';
    const scope = args.assessmentId
      ? `classGroupId="${classGroupId}", assessmentId="${args.assessmentId}"`
      : `classGroupId="${classGroupId}"`;
    return [
      {
        role: 'user',
        text: [
          `Diagnostica las brechas de aprendizaje del curso ${classGroupId}. Pasos:`,
          '',
          `1. get_assessment_overview(${scope}) para el % de logro global y la distribución por banda.`,
          `2. get_skill_heatmap(${scope}) para ubicar visualmente las habilidades más débiles.`,
          `3. get_skill_gaps(${scope}) para la lista priorizada de habilidades bajo el umbral.`,
          '',
          'Entrega un diagnóstico accionable: las 3-5 habilidades más críticas, cuántos estudiantes',
          'afectan, y qué patrones se repiten entre ellas. Prioriza por brecha (menor % de logro).',
        ].join('\n'),
      },
    ];
  }
}
