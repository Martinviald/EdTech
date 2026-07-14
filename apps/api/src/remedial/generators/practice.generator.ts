import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  items,
  itemTaxonomyTags,
  withOrgContext,
  type NewItem,
  type NewItemTaxonomyTag,
} from '@soe/db';
import {
  remedialPracticeContentSchema,
  validateItemContent,
  type LlmFeature,
  type RemedialMaterialType,
  type RemedialPracticeContent,
  type RemedialPracticeItemRef,
} from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import { LlmService } from '../../llm/llm.service';
import { parseModelJson } from '../prompts/curriculum-context.prompt';
import {
  buildPracticePrompt,
  PRACTICE_PROMPT_VERSION,
  PRACTICE_STIMULUS_PROMPT_VERSION,
} from '../prompts/practice.prompt';
import { stimulusToRef } from '../stimulus/stimulus.mappers';
import {
  remedialUsageFields,
  type RemedialGenerationInput,
  type RemedialGenerationResult,
  type RemedialGenerator,
  type RemedialJudgeItem,
} from '../remedial.generator';

/** Cantidad de ítems por defecto si el registro no la trae. */
const DEFAULT_ITEM_COUNT = 5;

/**
 * Forma cruda esperada del modelo (un set de ítems MC). Cada `content` de ítem se
 * re-valida con `validateItemContent` antes de persistir; esta validación de capa
 * sirve para fallar temprano si el modelo no respetó el contrato.
 */
const llmPracticeOutputSchema = z.object({
  skillFocus: z.string(),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        stem: z.string().min(1),
        alternatives: z
          .array(
            z.object({
              key: z.string().min(1).max(5),
              text: z.string().min(1),
              isCorrect: z.boolean(),
            }),
          )
          .min(2),
        explanation: z.string().optional(),
      }),
    )
    .min(1),
});

/**
 * Generador del set de ítems de práctica (H9.3 + Ola 2.1a). Genera N ítems → valida
 * cada `content` con `validateItemContent` → los INSERTA en `items`
 * (`source='ai_generated'`, `status='draft'`, `instrumentId=null`) en BATCH y los
 * etiqueta al `nodeId` en `item_taxonomy_tags` (`taggedBy='ai'`) en BATCH. El
 * `content` del material guarda solo las referencias (`itemId`, `position`,
 * `stem`). Aprobar el material (H9.5) publica esos ítems.
 *
 * Dos modos según `input.stimulus`:
 * - Con estímulo (Opción A): las preguntas se anclan al pasaje (respondibles solo
 *   desde su texto), los ítems se ligan a `sectionId = stimulus.sectionId`,
 *   `content.stimuli = [ref]` y la generación usa la feature `remedial_reading` (Pro).
 * - Sin estímulo (self_contained): comportamiento actual — `sectionId = null`,
 *   `content.stimuli = []`, feature `remedial` (Flash).
 *
 * Toda escritura corre dentro de `withOrgContext` con `tx`.
 */
@Injectable()
export class PracticeGenerator implements RemedialGenerator {
  readonly type: RemedialMaterialType = 'practice_set';

  constructor(
    private readonly llm: LlmService,
    @InjectDb() private readonly db: Database,
  ) {}

  async generate(input: RemedialGenerationInput): Promise<RemedialGenerationResult> {
    const nodeId = input.material.nodeId;
    if (!nodeId) {
      throw new Error('El set de práctica requiere un nodeId (habilidad objetivo)');
    }

    const stimulus = input.stimulus ?? null;
    // Anclado al pasaje → modelo que razona sobre el texto (Pro); self_contained → Flash.
    const feature: LlmFeature = stimulus ? 'remedial_reading' : 'remedial';

    const itemCount = this.resolveItemCount(input);
    const { system, prompt } = buildPracticePrompt(
      input.curriculum,
      itemCount,
      input.brief,
      stimulus,
      // Ola 2.1b: objeciones del juez de la ronda anterior (modo regeneración).
      input.feedback,
    );
    const completion = await this.llm.completeWithUsage(system, prompt, input.orgId, feature);

    const json = parseModelJson(completion.text);
    const parsed = llmPracticeOutputSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`El set de ítems generado no cumple el schema: ${parsed.error.message}`);
    }

    // Valida cada content contra el schema MC ANTES de persistir.
    const validatedContents = parsed.data.items.map((item) =>
      validateItemContent('multiple_choice', {
        stem: item.stem,
        alternatives: item.alternatives,
        ...(item.explanation ? { explanation: item.explanation } : {}),
      }),
    );

    // Modo anclado: los ítems quedan ligados al pasaje (no `null`). Self_contained: `null`.
    const sectionId = stimulus ? stimulus.sectionId : null;

    const { refs, judgeItems } = await withOrgContext(this.db, input.orgId, async (tx) => {
      const newItems: NewItem[] = validatedContents.map((content, idx) => ({
        orgId: input.orgId,
        instrumentId: null,
        sectionId,
        position: idx + 1,
        type: 'multiple_choice',
        content,
        status: 'draft',
        source: 'ai_generated',
        createdById: input.material.createdById,
      }));

      // Batch insert de ítems.
      const insertedItems = await tx.insert(items).values(newItems).returning();

      // Batch insert de tags al nodeId (taggedBy='ai').
      const newTags: NewItemTaxonomyTag[] = insertedItems.map((created) => ({
        itemId: created.id,
        nodeId,
        tagType: 'primary',
        taggedBy: 'ai',
      }));
      await tx.insert(itemTaxonomyTags).values(newTags);

      const itemRefs = insertedItems.map(
        (created, idx): RemedialPracticeItemRef => ({
          itemId: created.id,
          position: idx + 1,
          stem: parsed.data.items[idx]!.stem,
        }),
      );

      // Ola 2.1b: ítems para el juez, armados de la salida validada + los ids recién
      // insertados (sin re-leer de DB). Llevan la `isCorrect` (clave real) para el
      // solve-then-check del juez; el `RemedialJudgeService` NO la envía al LLM.
      const items4judge = insertedItems.map((created, idx): RemedialJudgeItem => {
        const source = parsed.data.items[idx]!;
        return {
          position: idx + 1,
          itemId: created.id,
          stem: source.stem,
          alternatives: source.alternatives.map((alt) => ({
            key: alt.key,
            text: alt.text,
            isCorrect: alt.isCorrect,
          })),
          explanation: source.explanation ?? null,
        };
      });

      return { refs: itemRefs, judgeItems: items4judge };
    });

    const content: RemedialPracticeContent = remedialPracticeContentSchema.parse({
      skillFocus: parsed.data.skillFocus,
      itemCount: refs.length,
      items: refs,
      notes: parsed.data.notes ?? null,
      // Ola 2.1a: ref ligera del pasaje (el texto se re-hidrata on-read). `[]` self_contained.
      stimuli: stimulus ? [stimulusToRef(stimulus)] : [],
    });

    return {
      content,
      promptVersion: stimulus ? PRACTICE_STIMULUS_PROMPT_VERSION : PRACTICE_PROMPT_VERSION,
      audit: {
        curriculum: input.curriculum,
        requestedItemCount: itemCount,
        stimulusSectionId: sectionId,
        // Ola 2.1b: si es una regeneración, deja traza de las objeciones inyectadas.
        ...(input.feedback && input.feedback.length > 0
          ? { regeneratedFrom: input.feedback }
          : {}),
      },
      // Ola 2.1b: ítems para el juez (el loop los pasa a `RemedialJudgeService.judge`).
      judgeItems,
      ...remedialUsageFields(completion),
    };
  }

  /**
   * Resuelve cuántos ítems generar leyendo `material.input.itemCount` (persistido
   * de forma determinista en `create`). Fallback al default.
   */
  private resolveItemCount(input: RemedialGenerationInput): number {
    const meta = input.material.input;
    if (meta && typeof meta === 'object' && 'itemCount' in meta) {
      const value = (meta as { itemCount?: unknown }).itemCount;
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
      }
    }
    return DEFAULT_ITEM_COUNT;
  }
}
