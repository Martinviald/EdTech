import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { instrumentSections, taxonomyNodes } from '@soe/db';
import type { RemedialStimulus } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import { LlmService } from '../../llm/llm.service';
import { parseModelJson } from '../prompts/curriculum-context.prompt';
import {
  buildGenerateStimulusPrompt,
  GENERATE_STIMULUS_PROMPT_VERSION,
  type GenerateStimulusReference,
  type GenerateStimulusSkill,
} from '../prompts/generate-stimulus.prompt';
import { FailedStimulusService, type FailedStimulus } from './failed-stimulus.service';
import {
  countWords,
  READABILITY_FORMULA,
  type ReadabilityFormula,
} from './readability.formula';
import { generatedSectionToStimulus } from './stimulus.mappers';
import { TargetProfiler, type StimulusTargetProfile } from './target-profiler';

/** Entrada de la generación del estímulo (misma forma que la brecha del resolver/fallback). */
export interface GenerateStimulusInput {
  orgId: string;
  assessmentId: string;
  nodeId: string;
}

/**
 * Legibilidad del texto generado + el target del que se calibró (Ola 2.2, Opción B). Es
 * backend-interna y se propaga para persistirse en `remedial_materials.input` (auditoría)
 * y mostrarse al docente. `withinBand` es una señal BLANDA (aviso), nunca un hard-gate:
 * si queda fuera de banda NO se regenera.
 */
export interface StimulusReadability {
  value: number; // legibilidad medida del texto generado
  gradeEstimate: number | null;
  target: number; // legibilidad objetivo (perfil de los fallados)
  gradeTarget: number | null;
  withinBand: boolean; // legibilidad dentro de la tolerancia blanda del target
  wordCount: number; // palabras del texto generado
  wordCountRange: [number, number]; // rango de largo objetivo
  textType: string;
  warning: string | null; // aviso blando si quedó fuera de banda/rango (no bloquea)
  promptVersion: string;
}

/** Resultado de generar un estímulo nuevo: método efectivo + estímulo hidratado + medición. */
export interface GeneratedStimulus {
  method: 'generate_stimulus';
  stimulus: RemedialStimulus;
  readability: StimulusReadability;
}

/** Forma cruda esperada del modelo: título + texto del pasaje generado. */
const generatedTextSchema = z.object({
  title: z.string().nullable().optional(),
  text: z.string().min(1),
});

// Tolerancia blanda (en puntos del índice) para considerar el texto generado "en banda"
// respecto del target. Heurística: los LLM no aciertan la legibilidad de forma fiable, así
// que se usa una banda amplia y, fuera de ella, solo se avisa (no se regenera).
const READABILITY_TARGET_TOLERANCE = 15;

// Nombre de la sección cuando el modelo no entrega título (columna `name` NOT NULL).
const DEFAULT_SECTION_NAME = 'Texto generado por IA (remedial)';

// Cota de pasajes fallados inyectados como referencia de calibración (los más relevantes
// primero: `FailedStimulusService.list` los entrega ordenados por brecha desc).
const MAX_REFERENCE_PASSAGES = 3;

/**
 * Genera un TEXTO NUEVO original con IA, de dificultad pareja a los pasajes fallados, y lo
 * persiste como estímulo (Ola 2.2, Opción B). Punto de variación previsto en 2.1: reusa
 * TODO el core (el generador de preguntas ancla al `stimulus` sin cambios); lo nuevo es
 * SOLO "conseguir el estímulo = generarlo".
 *
 * Flujo:
 *  1. `FailedStimulusService.list` → pasajes fallados (grounding). Reusa su lectura de
 *     `responses` bajo `withOrgContext` (RLS) y el filtro `orgId` explícito de secciones.
 *  2. `TargetProfiler` → target de legibilidad/largo/tipo (mediana de los fallados).
 *  3. Prompt a Pro (feature `remedial_reading`) con el target + la habilidad + los fallados
 *     como calibración (NO a copiar). Cero PII: habilidad curricular + pasajes oficiales.
 *  4. Mide la legibilidad del texto generado (aviso blando si queda fuera de banda).
 *  5. Inserta la sección `ai_generated` (`instrumentId=null`, `orgId` explícito; la tabla
 *     NO está bajo RLS → sin `withOrgContext`) y devuelve el estímulo hidratado + medición.
 *
 * Al ser `instrumentId=null`, la sección NO aparece en el picker del banco (que hace
 * innerJoin a instruments) — es per-material, correcto.
 */
@Injectable()
export class GenerateStimulusProvider {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly llm: LlmService,
    private readonly failedStimulus: FailedStimulusService,
    private readonly profiler: TargetProfiler,
    @Inject(READABILITY_FORMULA) private readonly readability: ReadabilityFormula,
  ) {}

  async generate(input: GenerateStimulusInput): Promise<GeneratedStimulus> {
    const { orgId, assessmentId, nodeId } = input;

    // 1-2. Pasajes fallados (grounding) → perfil de target (legibilidad/largo/tipo).
    const failed = await this.failedStimulus.list(orgId, assessmentId, nodeId);
    const profile = this.profiler.profile(failed);
    const skill = await this.loadSkill(nodeId);

    const references: GenerateStimulusReference[] = failed
      .filter(
        (stimulus): stimulus is FailedStimulus & { text: string } =>
          typeof stimulus.text === 'string' && stimulus.text.trim().length > 0,
      )
      .slice(0, MAX_REFERENCE_PASSAGES)
      .map((stimulus) => ({ title: stimulus.title, text: stimulus.text }));

    // 3. Genera el texto con Pro (feature `remedial_reading`, reusada de la Opción A).
    const { system, prompt } = buildGenerateStimulusPrompt({
      textType: profile.textType,
      wordTarget: Math.round((profile.wordCountRange[0] + profile.wordCountRange[1]) / 2),
      wordCountRange: profile.wordCountRange,
      gradeTarget: profile.gradeTarget,
      readabilityTarget: profile.readabilityTarget,
      skill,
      references,
    });
    const completion = await this.llm.completeWithUsage(
      system,
      prompt,
      orgId,
      'remedial_reading',
    );

    const parsed = generatedTextSchema.safeParse(parseModelJson(completion.text));
    if (!parsed.success) {
      throw new Error(`El texto generado no cumple el schema: ${parsed.error.message}`);
    }
    const text = parsed.data.text.trim();
    if (text.length === 0) {
      throw new Error('El texto generado vino vacío');
    }
    const title = parsed.data.title?.trim() || null;

    // 4. Mide la legibilidad y compara con el target (aviso blando, sin regenerar).
    const readability = this.measure(text, profile);

    // 5. Persiste la sección `ai_generated` (orgId explícito; sin RLS → sin withOrgContext).
    const [section] = await this.db
      .insert(instrumentSections)
      .values({
        instrumentId: null,
        orgId,
        name: title ?? DEFAULT_SECTION_NAME,
        type: 'multiple_choice',
        kind: 'passage',
        source: 'ai_generated',
        passageTitle: title,
        passageText: text,
        passageFormat: 'plain',
      })
      .returning({
        id: instrumentSections.id,
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
      });
    if (!section) {
      throw new Error('No se pudo persistir el estímulo generado');
    }

    return {
      method: 'generate_stimulus',
      stimulus: generatedSectionToStimulus(section),
      readability,
    };
  }

  /** Compara la legibilidad medida contra el target y arma el aviso blando (no bloquea). */
  private measure(text: string, profile: StimulusTargetProfile): StimulusReadability {
    const measured = this.readability.score(text);
    const wordCount = countWords(text);
    const [minWords, maxWords] = profile.wordCountRange;

    const readabilityOff =
      Math.abs(measured.value - profile.readabilityTarget) > READABILITY_TARGET_TOLERANCE;
    const lengthOff = wordCount < minWords || wordCount > maxWords;

    let warning: string | null = null;
    if (readabilityOff || lengthOff) {
      const parts: string[] = [];
      if (readabilityOff) {
        parts.push(`legibilidad ${measured.value} vs objetivo ${profile.readabilityTarget}`);
      }
      if (lengthOff) {
        parts.push(`largo ${wordCount} palabras fuera del rango ${minWords}–${maxWords}`);
      }
      warning = `Texto generado fuera de banda (${parts.join('; ')}); no se regenera (aviso blando).`;
    }

    return {
      value: measured.value,
      gradeEstimate: measured.gradeEstimate,
      target: profile.readabilityTarget,
      gradeTarget: profile.gradeTarget,
      withinBand: !readabilityOff,
      wordCount,
      wordCountRange: profile.wordCountRange,
      textType: profile.textType,
      warning,
      promptVersion: GENERATE_STIMULUS_PROMPT_VERSION,
    };
  }

  /**
   * Carga la habilidad/OA objetivo (`taxonomy_nodes`) para nombrarla en el prompt. La
   * taxonomía es global (sin `org_id`, sin RLS) → query directa (patrón de
   * `RemedialService.toModel`). Es contenido curricular, no PII.
   */
  private async loadSkill(nodeId: string): Promise<GenerateStimulusSkill> {
    const [node] = await this.db
      .select({
        name: taxonomyNodes.name,
        code: taxonomyNodes.code,
        description: taxonomyNodes.description,
      })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.id, nodeId))
      .limit(1);
    if (!node) {
      throw new NotFoundException(
        'Nodo de taxonomía no encontrado para generar el estímulo',
      );
    }
    return { name: node.name, code: node.code, description: node.description };
  }
}
