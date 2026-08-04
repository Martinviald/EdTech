import { Injectable } from '@nestjs/common';
import type { ResolvedStimulus } from './stimulus.resolver';
import type {
  TerminalFallbackContext,
  TerminalFallbackPolicy,
} from './terminal-fallback.policy';

/**
 * Fallback terminal de 2.1a: sin pasaje fallado ni elección del docente → `self_contained`
 * (MCQ sin estímulo, el comportamiento remedial previo). En 2.2 se swappea por un
 * `GenerateStimulusFallback` (generar texto nuevo) bajo el token `TERMINAL_FALLBACK_POLICY`.
 */
@Injectable()
export class SelfContainedFallback implements TerminalFallbackPolicy {
  async fallback(_ctx: TerminalFallbackContext): Promise<ResolvedStimulus> {
    return { method: 'self_contained', stimulus: null };
  }
}
