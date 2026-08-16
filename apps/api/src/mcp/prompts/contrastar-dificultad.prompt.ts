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
export class ContrastarDificultadPrompt implements McpPrompt {
  readonly descriptor: PromptDescriptor = {
    name: 'contrastar_dificultad_declarada_vs_empirica',
    description:
      'Audita la calidad de un instrumento contrastando la dificultad declarada de cada ítem ' +
      'contra su dificultad empírica y las brechas de habilidad de una evaluación.',
    arguments: [
      { name: 'instrumentId', description: 'ID del instrumento a auditar', required: true },
      {
        name: 'assessmentId',
        description: 'ID de la evaluación aplicada de ese instrumento',
        required: true,
      },
    ],
    requiredRoles: DASHBOARD_VIEWER_ROLES,
  };

  render(args: Record<string, string>): PromptMessage[] {
    const instrumentId = args.instrumentId ?? '<instrumentId>';
    const assessmentId = args.assessmentId ?? '<assessmentId>';
    return [
      {
        role: 'user',
        text: [
          `Actúa como analista psicométrico. Audita la calidad del instrumento ${instrumentId}`,
          `aplicado en la evaluación ${assessmentId}. Sigue estos pasos:`,
          '',
          `1. Llama a get_instrument_blueprint(instrumentId="${instrumentId}") para obtener la`,
          '   dificultad DECLARADA de cada ítem (campo difficulty y parámetros IRT) y la habilidad',
          '   de taxonomía que mide.',
          `2. Para los ítems relevantes, llama a get_item_statistics(itemId, assessmentId="${assessmentId}")`,
          '   para obtener su dificultad EMPÍRICA (p-value) y la distribución de distractores.',
          `3. Llama a get_skill_gaps(assessmentId="${assessmentId}") para ver las brechas por habilidad.`,
          '',
          'Con eso, entrega un dictamen que identifique:',
          '- Ítems miscalibrados: dificultad declarada muy distinta de la empírica.',
          '- Ítems de baja discriminación o con distractores dominantes.',
          '- Brechas de habilidad que podrían ser un artefacto del instrumento (p. ej. sostenidas por',
          '  un solo ítem de mala calidad) en vez de un déficit real de aprendizaje.',
          'Fundamenta cada conclusión con los números concretos que devolvieron las herramientas.',
        ].join('\n'),
      },
    ];
  }
}
