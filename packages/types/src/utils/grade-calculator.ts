import type { PerformanceLevel } from '../enums';
import {
  DEFAULT_GRADING_SCALE,
  type GradingScaleParams,
  type ResponseForCalculation,
} from '../schemas/grading-scale.schema';

/**
 * Calculador puro (sin DB) que convierte respuestas crudas en
 * `assessment_results` y `skill_results` listos para persistir.
 *
 * Diseño:
 *  - Sin dependencias de Drizzle ni de NestJS.
 *  - Single source of truth para las reglas de conversión % → nota → nivel.
 *  - Reutilizado por:
 *    · `answer-sheets` al confirmar ingesta masiva
 *    · `assessment-results` al recalcular
 *    · `grading-scales` al previsualizar conversiones
 */

/** Output por alumno listo para insertar en `assessment_results`. */
export interface StudentResultAggregate {
  studentId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  grade: number;
  performanceLevel: PerformanceLevel;
  isComplete: boolean;
}

/** Output por alumno × nodo taxonómico listo para `skill_results`. */
export interface SkillResultAggregate {
  studentId: string;
  nodeId: string;
  correctCount: number;
  totalCount: number;
  percentage: number;
  performanceLevel: PerformanceLevel;
}

/**
 * Convierte un porcentaje (0..1) a una nota según la escala. Garantiza que
 * el valor cae dentro de `[minGrade, maxGrade]`.
 *
 * - `linear_chilean`: piecewise lineal con quiebre en `passingThreshold` →
 *   `passingGrade`. Es la convención chilena para evitar penalizar de más
 *   bajo el umbral de aprobación.
 * - `percentage`: identidad (porcentaje × maxGrade); útil para SIMCE.
 * - Otros tipos: piecewise lineal (mismo cálculo que `linear_chilean`).
 */
export function percentageToGrade(
  percentage: number,
  scale: GradingScaleParams = DEFAULT_GRADING_SCALE,
): number {
  const pct = clamp(percentage, 0, 1);

  if (scale.type === 'percentage') {
    return round2(scale.minGrade + (scale.maxGrade - scale.minGrade) * pct);
  }

  if (pct <= scale.passingThreshold) {
    if (scale.passingThreshold === 0) {
      return round2(scale.passingGrade);
    }
    const slope = (scale.passingGrade - scale.minGrade) / scale.passingThreshold;
    return round2(scale.minGrade + slope * pct);
  }
  const remainingRange = 1 - scale.passingThreshold;
  if (remainingRange === 0) {
    return round2(scale.maxGrade);
  }
  const slope = (scale.maxGrade - scale.passingGrade) / remainingRange;
  return round2(scale.passingGrade + slope * (pct - scale.passingThreshold));
}

/**
 * Mapea un porcentaje al nivel de logro estándar de la Agencia.
 * Si la escala provee thresholds custom, se usan esos.
 */
export function percentageToPerformanceLevel(
  percentage: number,
  scale: GradingScaleParams = DEFAULT_GRADING_SCALE,
): PerformanceLevel {
  const pct = clamp(percentage, 0, 1);
  const thresholds = scale.performanceThresholds ?? {};
  const insufficient = thresholds.insufficient ?? 0.4;
  const elementary = thresholds.elementary ?? 0.6;
  const adequate = thresholds.adequate ?? 0.8;
  // `advanced` (si está) puede subir el techo del rango adequate.
  const advanced = thresholds.advanced ?? Math.max(adequate, 1);

  if (pct < insufficient) return 'insufficient';
  if (pct < elementary) return 'elementary';
  if (pct < adequate) return 'adequate';
  if (pct >= advanced) return 'advanced';
  return 'adequate';
}

/**
 * Agrega `responses` en un `StudentResultAggregate` por alumno. Si un
 * alumno no respondió un ítem del instrumento, el caller debe igual
 * incluir esa fila con `rawScore=0, maxScore=N` para que el porcentaje
 * refleje la realidad.
 */
export function aggregateStudentResults(
  responses: readonly ResponseForCalculation[],
  scale: GradingScaleParams = DEFAULT_GRADING_SCALE,
): StudentResultAggregate[] {
  const byStudent = new Map<string, { total: number; max: number; count: number }>();

  for (const r of responses) {
    const acc = byStudent.get(r.studentId) ?? { total: 0, max: 0, count: 0 };
    acc.total += r.finalScore ?? r.rawScore;
    acc.max += r.maxScore;
    acc.count += 1;
    byStudent.set(r.studentId, acc);
  }

  const out: StudentResultAggregate[] = [];
  for (const [studentId, agg] of byStudent.entries()) {
    const percentage = agg.max > 0 ? agg.total / agg.max : 0;
    out.push({
      studentId,
      totalScore: round2(agg.total),
      maxScore: round2(agg.max),
      percentage: round2(percentage * 100), // se almacena como 0..100
      grade: percentageToGrade(percentage, scale),
      performanceLevel: percentageToPerformanceLevel(percentage, scale),
      isComplete: agg.count > 0,
    });
  }
  return out;
}

/**
 * Agrega `responses` en `SkillResultAggregate` por (alumno × nodo taxonómico).
 * Cada response puede tener múltiples `taxonomyNodeIds`; cada uno suma una
 * unidad al total del nodo.
 */
export function aggregateSkillResults(
  responses: readonly ResponseForCalculation[],
  scale: GradingScaleParams = DEFAULT_GRADING_SCALE,
): SkillResultAggregate[] {
  const key = (studentId: string, nodeId: string) => `${studentId}::${nodeId}`;
  const acc = new Map<string, { studentId: string; nodeId: string; correct: number; total: number }>();

  for (const r of responses) {
    for (const nodeId of r.taxonomyNodeIds) {
      const k = key(r.studentId, nodeId);
      const slot = acc.get(k) ?? { studentId: r.studentId, nodeId, correct: 0, total: 0 };
      slot.total += 1;
      if (r.isCorrect === true) slot.correct += 1;
      acc.set(k, slot);
    }
  }

  const out: SkillResultAggregate[] = [];
  for (const slot of acc.values()) {
    const pct = slot.total > 0 ? slot.correct / slot.total : 0;
    out.push({
      studentId: slot.studentId,
      nodeId: slot.nodeId,
      correctCount: slot.correct,
      totalCount: slot.total,
      percentage: round2(pct * 100),
      performanceLevel: percentageToPerformanceLevel(pct, scale),
    });
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
