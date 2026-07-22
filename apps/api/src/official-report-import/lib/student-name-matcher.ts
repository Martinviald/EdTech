import type { OfficialReportStudentCandidate } from '@soe/types';

/**
 * Match difuso de los nombres que salen del OCR de la figura de niveles contra la
 * nómina del curso (gate #5 — §6.2).
 *
 * Función PURA. Reglas duras, no negociables (§8.6, §8.7 y CLAUDE.md §8.3):
 *  · NUNCA crea alumnos. Solo propone pares contra la nómina que recibe.
 *  · NUNCA decide sola: devuelve una propuesta con confianza y sus candidatos. El
 *    humano aprueba en el `confirm`; el service jamás escribe su propia propuesta.
 *  · Si no cruza, la fila queda fuera y se reporta. No se inventa el alumno.
 *
 * El informe imprime el nombre abreviado — "ARREDONDO SABALLA C." (apellidos +
 * inicial del nombre) —, así que el matcher compara contra varias formas canónicas
 * del alumno y se queda con la mejor.
 */

export type StudentForMatch = {
  id: string;
  firstName: string;
  lastName: string;
};

export type NameMatchResult = {
  /** null si nada superó el umbral o si hubo empate (`ambiguous`). */
  studentId: string | null;
  studentName: string | null;
  /** 0..1. */
  confidence: number;
  ambiguous: boolean;
  candidates: OfficialReportStudentCandidate[];
};

/** Bajo esto no se propone nada: el humano elige a mano. */
export const AUTO_MATCH_MIN_CONFIDENCE = 0.85;

/**
 * Si el segundo mejor está a menos de esto del primero, no hay ganador claro
 * (hermanos, apellidos repetidos, misma inicial) y se marca `ambiguous`.
 */
export const AMBIGUITY_MARGIN = 0.05;

const MAX_CANDIDATES = 3;

/**
 * Normaliza para comparar: sin diacríticos, mayúsculas, sin puntuación, espacios
 * colapsados. "ARREDONDO SABALLA C." → "ARREDONDO SABALLA C".
 *
 * `Ñ` → `N` a propósito: ambos lados pasan por acá, así que "MUÑOZ" (nómina) y
 * "MUNOZ" (OCR sin tilde) convergen al mismo string y cruzan igual.
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Formas canónicas de un alumno contra las que se compara el nombre del informe. */
function candidateForms(student: StudentForMatch): string[] {
  const first = normalizeName(student.firstName);
  const last = normalizeName(student.lastName);
  const firstInitial = first.charAt(0);
  const forms = new Set<string>();
  if (last && first) {
    forms.add(`${last} ${first}`);
    forms.add(`${first} ${last}`);
    if (firstInitial) forms.add(`${last} ${firstInitial}`);
  }
  if (last) forms.add(last);
  if (first) forms.add(first);
  return [...forms].filter((f) => f.length > 0);
}

export function fullName(student: StudentForMatch): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

/** Similitud 0..1 por distancia de edición normalizada. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  // Una sola fila de DP: las nóminas son de ~45 alumnos, pero se compara contra
  // varias formas por alumno y no hay razón para reservar la matriz completa.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1, // inserción
        (prev[j] ?? 0) + 1, // borrado
        (prev[j - 1] ?? 0) + cost, // sustitución
      );
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

export function matchReportName(
  reportedName: string,
  roster: readonly StudentForMatch[],
): NameMatchResult {
  const target = normalizeName(reportedName);
  const empty: NameMatchResult = {
    studentId: null,
    studentName: null,
    confidence: 0,
    ambiguous: false,
    candidates: [],
  };
  if (target.length === 0 || roster.length === 0) return empty;

  const scored = roster
    .map((student) => ({
      studentId: student.id,
      studentName: fullName(student),
      confidence: bestFormScore(target, student),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const candidates = scored.slice(0, MAX_CANDIDATES).map((c) => ({
    ...c,
    confidence: round4(c.confidence),
  }));

  const best = scored[0];
  if (!best || best.confidence < AUTO_MATCH_MIN_CONFIDENCE) {
    return { ...empty, confidence: round4(best?.confidence ?? 0), candidates };
  }

  const runnerUp = scored[1];
  const ambiguous =
    runnerUp !== undefined && best.confidence - runnerUp.confidence < AMBIGUITY_MARGIN;

  return {
    // Empate ⇒ no se propone nadie: que el humano elija entre los candidatos es
    // más barato que corregir un nivel escrito sobre el alumno equivocado.
    studentId: ambiguous ? null : best.studentId,
    studentName: ambiguous ? null : best.studentName,
    confidence: round4(best.confidence),
    ambiguous,
    candidates,
  };
}

function bestFormScore(target: string, student: StudentForMatch): number {
  let best = 0;
  for (const form of candidateForms(student)) {
    const score = similarity(target, form);
    if (score > best) best = score;
  }
  return best;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
