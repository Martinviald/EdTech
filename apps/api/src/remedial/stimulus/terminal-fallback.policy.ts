import type { ResolvedStimulus } from './stimulus.resolver';

/** Contexto de la brecha para el fallback terminal (permite que 2.2 genere un texto). */
export interface TerminalFallbackContext {
  orgId: string;
  assessmentId: string;
  nodeId: string;
}

/**
 * Puerto del fallback terminal de la cadena de resolución de estímulo (Ola 2.1a):
 * qué hacer cuando no hay pasaje fallado ni elección del docente. La impl 2.1a
 * (`SelfContainedFallback`) señala `self_contained` (sin estímulo). Es el PUNTO DE SWAP
 * para que 2.2 enchufe un `GenerateStimulusFallback` (generar texto) sin tocar el resolver.
 */
export interface TerminalFallbackPolicy {
  fallback(ctx: TerminalFallbackContext): Promise<ResolvedStimulus>;
}

/** Token DI del puerto `TerminalFallbackPolicy` (patrón `CURRICULUM_RETRIEVER`). */
export const TERMINAL_FALLBACK_POLICY = 'TERMINAL_FALLBACK_POLICY';
