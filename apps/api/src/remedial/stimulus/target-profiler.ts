import { Inject, Injectable } from '@nestjs/common';
import type { FailedStimulus } from './failed-stimulus.service';
import {
  countWords,
  READABILITY_FORMULA,
  type ReadabilityFormula,
} from './readability.formula';

/**
 * Perfil de target para generar un texto nuevo (Ola 2.2, Opción B), derivado de los
 * pasajes donde los alumnos fallaron. Interface backend-interna (no en `@soe/types`):
 * calibra la generación para que el texto nuevo tenga dificultad/largo/tipo PAREJOS a los
 * fallados.
 *
 * - `readabilityTarget`: índice de legibilidad objetivo (mediana de los fallados).
 * - `gradeTarget`: grado escolar aproximado objetivo (mediana de los grados estimados, o
 *   `null` si no hay medición). Orientativo.
 * - `wordCountRange`: rango [min, max] de palabras de los fallados.
 * - `textType`: tipo de texto dominante (o `informativo` por defecto).
 */
export interface StimulusTargetProfile {
  readabilityTarget: number;
  gradeTarget: number | null;
  wordCountRange: [number, number];
  textType: string;
}

// Defaults cuando no hay pasajes fallados con texto (p. ej. fallback A→B sin pasaje): se
// apunta a una dificultad media y un largo típico de pasaje escolar.
const DEFAULT_READABILITY_TARGET = 70; // ≈ grado 6 en Fernández-Huerta
const DEFAULT_WORD_RANGE: [number, number] = [150, 350];
const DEFAULT_TEXT_TYPE = 'informativo';

// `FailedStimulus.textType` hoy transporta el `passage_format` (formato de render), no un
// género discursivo. Se excluyen esos tokens para no pasarlos como "tipo de texto" al
// generador; si a futuro el `textType` trae un género real, fluye sin cambios.
const PASSAGE_FORMAT_TOKENS = new Set(['plain', 'markdown', 'html']);

/**
 * Perfila los pasajes fallados para fijar el target de generación (Ola 2.2, Opción B).
 * Mide la legibilidad de cada texto con la fórmula enchufable (`READABILITY_FORMULA`) y
 * agrega por mediana (robusta a outliers); el largo por rango; el tipo por dominancia.
 * Sin pasajes con texto → defaults (dificultad media, largo típico, `informativo`).
 */
@Injectable()
export class TargetProfiler {
  constructor(
    @Inject(READABILITY_FORMULA) private readonly readability: ReadabilityFormula,
  ) {}

  profile(failed: FailedStimulus[]): StimulusTargetProfile {
    const withText = failed.filter(
      (stimulus): stimulus is FailedStimulus & { text: string } =>
        typeof stimulus.text === 'string' && stimulus.text.trim().length > 0,
    );

    if (withText.length === 0) {
      return {
        readabilityTarget: DEFAULT_READABILITY_TARGET,
        gradeTarget: null,
        wordCountRange: DEFAULT_WORD_RANGE,
        textType: DEFAULT_TEXT_TYPE,
      };
    }

    const scores = withText.map((stimulus) => this.readability.score(stimulus.text));
    const values = scores.map((score) => score.value);
    const grades = scores
      .map((score) => score.gradeEstimate)
      .filter((grade): grade is number => grade !== null);
    const words = withText.map((stimulus) => countWords(stimulus.text));

    return {
      readabilityTarget: round2(median(values)),
      gradeTarget: grades.length > 0 ? Math.round(median(grades)) : null,
      wordCountRange: [Math.min(...words), Math.max(...words)],
      textType: dominantTextType(withText),
    };
  }
}

/** Tipo de texto dominante entre los fallados, ignorando tokens de formato; default si no hay. */
function dominantTextType(failed: FailedStimulus[]): string {
  const counts = new Map<string, number>();
  for (const stimulus of failed) {
    const type = stimulus.textType?.trim().toLowerCase();
    if (!type || PASSAGE_FORMAT_TOKENS.has(type)) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  let winner = DEFAULT_TEXT_TYPE;
  let best = 0;
  for (const [type, count] of counts) {
    if (count > best) {
      winner = type;
      best = count;
    }
  }
  return winner;
}

/** Mediana de una lista NO vacía de números. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
