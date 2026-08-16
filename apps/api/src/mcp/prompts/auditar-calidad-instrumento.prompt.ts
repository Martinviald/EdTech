import { Injectable } from '@nestjs/common';
import { ITEM_ANALYSIS_VIEWER_ROLES } from '@soe/types';
import {
  McpPromptProvider,
  type McpPrompt,
  type PromptDescriptor,
  type PromptMessage,
} from '../core/mcp-prompt';

@McpPromptProvider()
@Injectable()
export class AuditarCalidadInstrumentoPrompt implements McpPrompt {
  readonly descriptor: PromptDescriptor = {
    name: 'auditar_calidad_instrumento',
    description:
      'Auditoría psicométrica de un instrumento a partir de una evaluación aplicada: dificultad, ' +
      'discriminación y cobertura de habilidades ítem por ítem.',
    arguments: [
      { name: 'instrumentId', description: 'ID del instrumento a auditar', required: true },
      { name: 'assessmentId', description: 'ID de la evaluación aplicada', required: true },
    ],
    requiredRoles: ITEM_ANALYSIS_VIEWER_ROLES,
  };

  render(args: Record<string, string>): PromptMessage[] {
    const instrumentId = args.instrumentId ?? '<instrumentId>';
    const assessmentId = args.assessmentId ?? '<assessmentId>';
    return [
      {
        role: 'user',
        text: [
          `Haz una auditoría psicométrica del instrumento ${instrumentId} usando los resultados de`,
          `la evaluación ${assessmentId}:`,
          '',
          `1. get_instrument_blueprint(instrumentId="${instrumentId}"): revisa cobertura de habilidades,`,
          '   puntajes y dificultad declarada por ítem.',
          `2. get_item_statistics(itemId, assessmentId="${assessmentId}") por ítem: p-value y distractores.`,
          '',
          'Reporta por ítem: dificultad (fácil/adecuada/difícil según p-value), calidad de los',
          'distractores, y una recomendación (mantener, revisar o retirar del banco). Cierra con un',
          'resumen de la calidad global del instrumento y su balance de dificultad.',
        ].join('\n'),
      },
    ];
  }
}
