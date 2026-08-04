import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { instrumentSections } from '@soe/db';
import type { RemedialMethod, RemedialStimulus } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import { FailedStimulusService } from './failed-stimulus.service';
import { failedStimulusToStimulus } from './stimulus.mappers';
import {
  PASSAGE_SELECTION_POLICY,
  type PassageSelectionPolicy,
} from './passage-selection.policy';
import {
  TERMINAL_FALLBACK_POLICY,
  type TerminalFallbackPolicy,
} from './terminal-fallback.policy';

/** Entrada de la resolución de estímulo. `method`/`stimulusId` vienen del DTO de generación. */
export interface ResolveStimulusInput {
  orgId: string;
  assessmentId: string;
  nodeId: string;
  method?: RemedialMethod; // default resuelto aquí (self_contained)
  stimulusId?: string; // override del docente (sección elegida del picker)
}

/** Estímulo resuelto para el set remedial: el `method` efectivo + el estímulo hidratado (o null). */
export interface ResolvedStimulus {
  method: RemedialMethod;
  stimulus: RemedialStimulus | null;
}

/**
 * Orquesta la cadena de fallback para conseguir el estímulo de un set remedial (Ola 2.1a).
 *
 * - `method != 'reuse_stimulus'` → `self_contained` (sin estímulo). `generate_stimulus`
 *   (Opción B) llega en 2.2; hasta entonces también cae aquí.
 * - `reuse_stimulus` con `stimulusId` (override del docente) → carga y valida esa sección
 *   (visible a la org, `kind='passage'`).
 * - `reuse_stimulus` sin `stimulusId` → pasaje de mayor brecha vía `FailedStimulusService` +
 *   `PassageSelectionPolicy`; si no hay ninguno → `TerminalFallbackPolicy` (2.1a: self_contained).
 *
 * La elección del docente NO es interactiva en el backend: el front pide candidatos
 * (`GET /remedial/candidate-stimuli`), el docente elige y reenvía `generate` con `stimulusId`.
 */
@Injectable()
export class StimulusResolver {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly failedStimulus: FailedStimulusService,
    @Inject(PASSAGE_SELECTION_POLICY)
    private readonly selectionPolicy: PassageSelectionPolicy,
    @Inject(TERMINAL_FALLBACK_POLICY)
    private readonly terminalFallback: TerminalFallbackPolicy,
  ) {}

  async resolve(input: ResolveStimulusInput): Promise<ResolvedStimulus> {
    const method = input.method ?? 'self_contained';

    // Solo `reuse_stimulus` (Opción A) ancla a un pasaje en 2.1a.
    if (method !== 'reuse_stimulus') {
      return { method: 'self_contained', stimulus: null };
    }

    // Override del docente: carga y valida la sección elegida (visible, pasaje).
    if (input.stimulusId) {
      const stimulus = await this.loadPassage(input.orgId, input.stimulusId);
      if (!stimulus) {
        throw new NotFoundException(
          'Estímulo no encontrado o no es un pasaje visible para la organización',
        );
      }
      return { method: 'reuse_stimulus', stimulus };
    }

    // Auto: el pasaje de mayor brecha de la evaluación (política enchufable).
    const candidates = await this.failedStimulus.list(
      input.orgId,
      input.assessmentId,
      input.nodeId,
    );
    if (candidates.length > 0) {
      const [selected] = this.selectionPolicy.select(candidates);
      const chosen = selected
        ? candidates.find((c) => c.sectionId === selected.sectionId)
        : undefined;
      if (chosen) {
        return {
          method: 'reuse_stimulus',
          stimulus: failedStimulusToStimulus(chosen),
        };
      }
    }

    // Sin pasaje ni elección → fallback terminal (2.1a: self_contained; swap en 2.2).
    return this.terminalFallback.fallback({
      orgId: input.orgId,
      assessmentId: input.assessmentId,
      nodeId: input.nodeId,
    });
  }

  /**
   * Carga una sección como estímulo hidratado (texto completo) si es un pasaje visible
   * para la org. `instrument_sections` NO está bajo RLS → filtro `orgId` explícito del
   * pool `org ∪ oficial`; no requiere `withOrgContext`.
   */
  private async loadPassage(
    orgId: string,
    sectionId: string,
  ): Promise<RemedialStimulus | null> {
    const [section] = await this.db
      .select({
        id: instrumentSections.id,
        kind: instrumentSections.kind,
        source: instrumentSections.source,
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
      })
      .from(instrumentSections)
      .where(
        and(
          eq(instrumentSections.id, sectionId),
          eq(instrumentSections.kind, 'passage'),
          or(
            eq(instrumentSections.orgId, orgId),
            isNull(instrumentSections.orgId),
          ),
        ),
      )
      .limit(1);

    if (!section) return null;
    return {
      sectionId: section.id,
      kind: section.kind,
      source: section.source,
      title: section.passageTitle ?? null,
      text: section.passageText ?? null,
    };
  }
}
