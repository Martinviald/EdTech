import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { judgeVerdictSchema, type JudgeVerdict, type RemedialStimulus } from '@soe/types';
import { LlmService } from '../llm/llm.service';
import { parseModelJson } from './prompts/curriculum-context.prompt';
import { buildJudgePrompt, type JudgePromptItem } from './prompts/judge.prompt';
import type { RemedialJudgeItem } from './remedial.generator';

/**
 * Forma cruda del veredicto que devuelve el juez (LLM). NO trae `answerable` ni
 * `position`: `answerable` lo calcula el SERVICE con solve-then-check (compara la
 * respuesta del juez con la clave real, que el juez nunca vio) y `position` viene del
 * ítem. `objections` es opcional (degrada a `[]`) para no romper por un detalle.
 */
const judgeRawOutputSchema = z.object({
  derivedAnswer: z.string().nullable(),
  uniqueCorrect: z.boolean(),
  factual: z.boolean(),
  skillMatch: z.boolean(),
  objections: z.array(z.string()).optional(),
});

/**
 * Juez automático de calidad de los ítems remediales (Ola 2.1b · feature
 * `remedial_judge` → Flash por defecto). Por cada ítem hace una completion aislada:
 * el juez recibe el pasaje (si hay) + la pregunta y las alternativas SIN la clave ni
 * la explicación (anti-filtración), deduce la respuesta a ciegas y evalúa unicidad,
 * factualidad y alineación de habilidad.
 *
 * **solve-then-check:** el juez NUNCA ve cuál alternativa es la correcta. El SERVICE
 * compara la respuesta que dedujo (`derivedAnswer`) con la clave real del ítem
 * (`isCorrect`): `answerable = (derivedAnswer === claveReal)`. Así un ítem cuya clave
 * no se deduce del material queda marcado como no respondible.
 *
 * `answerable`/`uniqueCorrect`/`factual` son hard-gate (gatillan regeneración en el
 * loop); `skillMatch` es aviso blando (se muestra al docente, no regenera).
 *
 * Nota (§5 diseño): con Flash juzgando a Pro, juez y generador son de la MISMA familia
 * (juez débil, atrapa errores gruesos). Swap a otra familia (Claude) = cambiar
 * `remedial_judge` en `llm_settings`. El determinismo (temperature 0) lo fija la config.
 */
@Injectable()
export class RemedialJudgeService {
  constructor(private readonly llm: LlmService) {}

  /**
   * Juzga un set de ítems (un veredicto por ítem, en el mismo orden). Cada ítem se
   * evalúa en su propia completion (aislada, en paralelo). Lanza si algún veredicto
   * del modelo no es parseable (→ el runner deja el material `failed`, como el generador).
   *
   * @param orgId       tenant para resolver el modelo del juez (config por org).
   * @param stimulus    pasaje al que se anclan las preguntas, o `null` (self_contained).
   * @param judgeItems  ítems a juzgar (llevan la clave real para el solve-then-check).
   */
  async judge(
    orgId: string,
    stimulus: RemedialStimulus | null,
    judgeItems: RemedialJudgeItem[],
  ): Promise<JudgeVerdict[]> {
    return Promise.all(judgeItems.map((item) => this.judgeOne(orgId, stimulus, item)));
  }

  private async judgeOne(
    orgId: string,
    stimulus: RemedialStimulus | null,
    item: RemedialJudgeItem,
  ): Promise<JudgeVerdict> {
    // El juez ve la pregunta y las alternativas SIN `isCorrect` ni la explicación
    // (ambas filtrarían la clave). El solve-then-check exige que la deduzca a ciegas.
    const promptItem: JudgePromptItem = {
      stem: item.stem.trim(),
      alternatives: item.alternatives.map((alt) => ({ key: alt.key, text: alt.text })),
    };
    const { system, prompt } = buildJudgePrompt(stimulus, promptItem);
    const completion = await this.llm.completeWithUsage(system, prompt, orgId, 'remedial_judge');

    const parsed = judgeRawOutputSchema.safeParse(parseModelJson(completion.text));
    if (!parsed.success) {
      throw new Error(`El veredicto del juez no cumple el schema: ${parsed.error.message}`);
    }

    // Normaliza la respuesta del juez ("" → null) y hace solve-then-check contra la
    // clave real, que el juez nunca vio.
    const derivedAnswer = parsed.data.derivedAnswer?.trim() || null;
    const realKey = this.realKey(item.alternatives);
    const answerable =
      derivedAnswer !== null && realKey !== null && normalizeKey(derivedAnswer) === normalizeKey(realKey);

    const objections = [...(parsed.data.objections ?? [])];
    // Si el ítem no es respondible, deja SIEMPRE una objeción accionable (aunque el
    // juez no la haya articulado) para que la regeneración tenga con qué corregir.
    if (!answerable) {
      objections.push(this.solveThenCheckObjection(derivedAnswer, realKey));
    }

    return judgeVerdictSchema.parse({
      position: item.position,
      answerable,
      derivedAnswer,
      uniqueCorrect: parsed.data.uniqueCorrect,
      factual: parsed.data.factual,
      skillMatch: parsed.data.skillMatch,
      objections,
    });
  }

  /** Clave real del ítem: la key de la primera alternativa `isCorrect`. `null` si no hay. */
  private realKey(alternatives: RemedialJudgeItem['alternatives']): string | null {
    const correct = alternatives.find((alt) => alt.isCorrect);
    return correct ? correct.key : null;
  }

  /** Objeción concreta cuando el solve-then-check falla (para regenerar / mostrar). */
  private solveThenCheckObjection(derivedAnswer: string | null, realKey: string | null): string {
    if (derivedAnswer === null) {
      return 'El juez no pudo deducir una respuesta única desde el material: la pregunta no es respondible como está planteada.';
    }
    return `El juez, respondiendo solo desde el material, eligió "${derivedAnswer}", pero la clave marcada es "${realKey ?? '—'}": la pregunta no es respondible desde el material o la clave es incorrecta.`;
  }
}

/** Normaliza una key de alternativa para comparar (trim + mayúsculas). */
function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}
