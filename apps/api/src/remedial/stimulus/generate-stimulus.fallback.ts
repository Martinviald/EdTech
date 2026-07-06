import { Injectable } from '@nestjs/common';
import { GenerateStimulusProvider } from './generate-stimulus.provider';
import type { ResolvedStimulus } from './stimulus.resolver';
import type {
  TerminalFallbackContext,
  TerminalFallbackPolicy,
} from './terminal-fallback.policy';

/**
 * Fallback terminal de la Ola 2.2 (Opción B): cuando la cadena de resolución no consigue
 * un pasaje (Opción A sin pasaje fallado ni elección del docente), GENERA un texto nuevo
 * con IA calibrado a la brecha. Reemplaza a `SelfContainedFallback` en el binding del
 * token `TERMINAL_FALLBACK_POLICY` (swap previsto en 2.1a). `SelfContainedFallback` se
 * conserva en el repo por si se quiere revertir el binding.
 *
 * El `method` efectivo pasa a `generate_stimulus` (A → B), y se propaga la legibilidad
 * medida para auditoría/UI. Ver `GenerateStimulusProvider`.
 */
@Injectable()
export class GenerateStimulusFallback implements TerminalFallbackPolicy {
  constructor(private readonly generator: GenerateStimulusProvider) {}

  async fallback(ctx: TerminalFallbackContext): Promise<ResolvedStimulus> {
    const generated = await this.generator.generate({
      orgId: ctx.orgId,
      assessmentId: ctx.assessmentId,
      nodeId: ctx.nodeId,
    });
    return {
      method: generated.method,
      stimulus: generated.stimulus,
      readability: generated.readability,
    };
  }
}
