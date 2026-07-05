import { Injectable } from '@nestjs/common';

/**
 * Medición de legibilidad de un texto (Ola 2.2, Opción B). `value` es el índice bruto
 * de la fórmula (dominio propio de cada fórmula; en Fernández-Huerta ≈ 0–120, más alto =
 * más fácil). `gradeEstimate` es un grado escolar APROXIMADO derivado del índice (o `null`
 * si el texto no tiene palabras y no se puede estimar). Es una MEDICIÓN heurística, no
 * exacta: sirve como target de generación + valor mostrado al docente + aviso blando,
 * nunca como hard-gate.
 */
export interface ReadabilityScore {
  value: number;
  gradeEstimate: number | null;
}

/**
 * Puerto de legibilidad ENCHUFABLE (patrón de las policies del módulo: interface +
 * token DI). Permite cambiar de fórmula (Fernández-Huerta → INFLESZ / Crawford / …) sin
 * tocar a los consumidores (`TargetProfiler`, `GenerateStimulusProvider`).
 */
export interface ReadabilityFormula {
  /** Mide la legibilidad de `text`. Determinista y sin efectos secundarios. */
  score(text: string): ReadabilityScore;
}

/** Token DI del puerto `ReadabilityFormula` (patrón `CURRICULUM_RETRIEVER`). */
export const READABILITY_FORMULA = 'READABILITY_FORMULA';

// Vocales del español (incl. acentuadas y diéresis). La heurística de sílabas cuenta
// grupos vocálicos maximales (vocales consecutivas ≈ 1 grupo), por lo que subcuenta los
// hiatos (p. ej. "ríe" → 1); es una aproximación conocida y documentada.
const VOWELS = 'aeiouáéíóúü';
// Palabra = secuencia de letras (Unicode, cubre tildes/ñ). Los dígitos y la puntuación no
// cuentan como palabra. `String.match` con /g es seguro para reuso (resetea lastIndex).
const WORD_RE = /\p{L}+/gu;
// Fin de oración ("frase"): uno o más signos terminales seguidos cuentan como una frase.
const SENTENCE_RE = /[.!?…]+/g;

/**
 * Cuenta las PALABRAS de un texto (tokens de letras). Fuente única (DRY) para la fórmula
 * de legibilidad (P = sílabas por 100 palabras) y para el rango de largo del
 * `TargetProfiler`, de modo que ambas midan "palabras" de la misma forma.
 */
export function countWords(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

/** Cuenta las sílabas de UNA palabra por grupos vocálicos (heurística del español). */
function countSyllables(word: string): number {
  const lower = word.toLowerCase();
  let groups = 0;
  let inVowel = false;
  for (const ch of lower) {
    const isVowel = VOWELS.includes(ch);
    if (isVowel && !inVowel) groups += 1;
    inVowel = isVowel;
  }
  return groups;
}

/** Cuenta las frases (oraciones) de un texto por sus signos terminales. */
function countSentences(text: string): number {
  return (text.match(SENTENCE_RE) ?? []).length;
}

/**
 * Mapea el índice Fernández-Huerta a un grado escolar aproximado (heurística; el ejemplo
 * del contrato: 90–100→~2°, 80–90→~4°, 70–80→~6°, 60–70→~8°…). Índice alto = más fácil =
 * grado menor. Es orientativo (la fórmula no calibra grados con precisión).
 */
function gradeEstimateFromScore(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value >= 90) return 2;
  if (value >= 80) return 4;
  if (value >= 70) return 6;
  if (value >= 60) return 8;
  if (value >= 50) return 10;
  if (value >= 40) return 12;
  return 14; // muy difícil (educación superior/técnica). Se satura, no baja de aquí.
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fórmula de Fernández-Huerta (adaptación al español del Flesch Reading Ease):
 *
 *   L = 206.84 − 0.60·P − 1.02·F
 *
 * con `P` = sílabas por cada 100 palabras y `F` = frases por cada 100 palabras. `L` alto =
 * texto más fácil. La densidad silábica (`P`) domina el resultado, por lo que el orden es
 * monotónico (un texto simple puntúa más alto que uno complejo) pese a la aproximación de
 * los conteos. Impl del puerto `ReadabilityFormula` registrada en `READABILITY_FORMULA`.
 *
 * MEDICIÓN heurística (no exacta): el conteo de sílabas es por grupos vocálicos y el de
 * frases por signos terminales; no resuelve hiatos, diptongos ni abreviaturas. Se usa como
 * señal blanda (target + aviso), nunca como criterio de bloqueo.
 */
@Injectable()
export class FernandezHuertaFormula implements ReadabilityFormula {
  score(text: string): ReadabilityScore {
    const words: string[] = text.match(WORD_RE) ?? [];
    const wordCount = words.length;
    // Sin palabras → no hay legibilidad medible (evita división por cero).
    if (wordCount === 0) return { value: 0, gradeEstimate: null };

    const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0);
    // Un texto con palabras tiene al menos una frase aunque no traiga puntuación final.
    const sentenceCount = Math.max(1, countSentences(text));

    const syllablesPer100 = (syllableCount / wordCount) * 100;
    const sentencesPer100 = (sentenceCount / wordCount) * 100;
    const value = 206.84 - 0.6 * syllablesPer100 - 1.02 * sentencesPer100;

    return { value: round2(value), gradeEstimate: gradeEstimateFromScore(value) };
  }
}
