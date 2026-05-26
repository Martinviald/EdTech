// Calculadora pura de notas: dado un % de logro y una escala, devuelve la nota.
// No tiene side effects ni acceso a DB. Usada tanto en el flujo de ingesta
// (Answer Sheets) como en el endpoint de recálculo (Assessment Results).
//
// Soporta los tipos definidos en `GradingScaleTypeValue`. Por ahora la lógica
// efectiva está en `linear_chilean` y `percentage`; los demás (paes_scaled,
// irt_based, custom) reciben una fallback razonable y deben extenderse en F2+.

import type { PerformanceLevel } from '../enums';

export type GradingScaleParams = {
  type: string; // 'linear_chilean' | 'percentage' | 'paes_scaled' | 'irt_based' | 'custom'
  minGrade: number;
  maxGrade: number;
  passingGrade: number;
  passingThreshold: number; // 0..1
  config?: Record<string, unknown> | null;
};

/**
 * Convierte un porcentaje de logro (0..1) a nota numérica.
 * - `linear_chilean`: lineal por tramos con quiebre en passingThreshold.
 *   - 0..threshold → minGrade..passingGrade
 *   - threshold..1 → passingGrade..maxGrade
 * - `percentage`: devuelve percentage * 100 (escala 0-100).
 * - otros: linear_chilean como fallback.
 */
export function percentageToGrade(percentage: number, scale: GradingScaleParams): number {
  if (!Number.isFinite(percentage)) return scale.minGrade;
  const p = Math.max(0, Math.min(1, percentage));

  switch (scale.type) {
    case 'percentage':
      return roundGrade(p * 100);
    case 'linear_chilean':
    case 'irt_based':
    case 'paes_scaled':
    case 'custom':
    default:
      return linearChileanGrade(p, scale);
  }
}

function linearChileanGrade(p: number, scale: GradingScaleParams): number {
  const { minGrade, maxGrade, passingGrade, passingThreshold } = scale;
  if (passingThreshold <= 0) {
    // Sin exigencia: lineal puro de minGrade a maxGrade.
    return roundGrade(minGrade + p * (maxGrade - minGrade));
  }
  if (p <= passingThreshold) {
    const ratio = passingThreshold === 0 ? 0 : p / passingThreshold;
    return roundGrade(minGrade + ratio * (passingGrade - minGrade));
  }
  const ratio = (p - passingThreshold) / (1 - passingThreshold);
  return roundGrade(passingGrade + ratio * (maxGrade - passingGrade));
}

function roundGrade(g: number): number {
  // Redondea a 1 decimal — convención chilena para notas.
  return Math.round(g * 10) / 10;
}

/**
 * Calcula el nivel de desempeño en base al porcentaje.
 * Thresholds por defecto (alineados a estándar DIA):
 *  - < 0.40 → insufficient
 *  - 0.40..0.69 → elementary
 *  - 0.70..0.84 → adequate
 *  - >= 0.85 → advanced
 *
 * Si la escala incluye `config.performanceThresholds`, se usan esos.
 */
export function percentageToPerformanceLevel(
  percentage: number,
  scale?: Pick<GradingScaleParams, 'config'>,
): PerformanceLevel {
  const p = Math.max(0, Math.min(1, percentage));
  const cfg = scale?.config as
    | { performanceThresholds?: { adequate?: number; elementary?: number; advanced?: number } }
    | undefined;
  const thresholds = {
    elementary: cfg?.performanceThresholds?.elementary ?? 0.4,
    adequate: cfg?.performanceThresholds?.adequate ?? 0.7,
    advanced: cfg?.performanceThresholds?.advanced ?? 0.85,
  };
  if (p < thresholds.elementary) return 'insufficient';
  if (p < thresholds.adequate) return 'elementary';
  if (p < thresholds.advanced) return 'adequate';
  return 'advanced';
}

/**
 * Indica si la nota es de aprobación (>= passingGrade).
 */
export function isPassingGrade(grade: number, scale: GradingScaleParams): boolean {
  return grade >= scale.passingGrade;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

export type ResponseForCalculation = {
  studentId: string;
  itemId: string;
  isCorrect: boolean | null;
  rawScore: number | null;
  maxScore: number;
  // Posición del ítem y nodos de taxonomía a los que está taggeado (para skill_results).
  itemPosition: number;
  taxonomyNodeIds: string[];
};

export type StudentAggregateResult = {
  studentId: string;
  totalScore: number;
  maxScore: number;
  percentage: number; // 0..1
  grade: number;
  performanceLevel: PerformanceLevel;
  isComplete: boolean;
};

export type SkillAggregateResult = {
  studentId: string;
  nodeId: string;
  correctCount: number;
  totalCount: number;
  percentage: number; // 0..1
  performanceLevel: PerformanceLevel;
};

/**
 * Agrega `responses` por alumno y devuelve los totales (assessment_results).
 * Pure function — todos los datos llegan por parámetro.
 */
export function aggregateStudentResults(
  responses: ResponseForCalculation[],
  scale: GradingScaleParams,
): StudentAggregateResult[] {
  const byStudent = new Map<string, ResponseForCalculation[]>();
  for (const r of responses) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r);
    byStudent.set(r.studentId, list);
  }

  const results: StudentAggregateResult[] = [];
  for (const [studentId, rows] of byStudent) {
    const totalScore = rows.reduce((acc, r) => acc + (r.rawScore ?? 0), 0);
    const maxScore = rows.reduce((acc, r) => acc + r.maxScore, 0);
    const percentage = maxScore > 0 ? totalScore / maxScore : 0;
    const grade = percentageToGrade(percentage, scale);
    const performanceLevel = percentageToPerformanceLevel(percentage, scale);
    const isComplete = rows.every((r) => r.isCorrect !== null);

    results.push({
      studentId,
      totalScore,
      maxScore,
      percentage,
      grade,
      performanceLevel,
      isComplete,
    });
  }
  return results;
}

/**
 * Agrega `responses` por alumno × nodo de taxonomía y devuelve skill_results.
 */
export function aggregateSkillResults(
  responses: ResponseForCalculation[],
  scale?: Pick<GradingScaleParams, 'config'>,
): SkillAggregateResult[] {
  const key = (studentId: string, nodeId: string) => `${studentId}__${nodeId}`;
  const byKey = new Map<
    string,
    { studentId: string; nodeId: string; correctCount: number; totalCount: number }
  >();

  for (const r of responses) {
    for (const nodeId of r.taxonomyNodeIds) {
      const k = key(r.studentId, nodeId);
      const acc = byKey.get(k) ?? {
        studentId: r.studentId,
        nodeId,
        correctCount: 0,
        totalCount: 0,
      };
      acc.totalCount += 1;
      if (r.isCorrect === true) acc.correctCount += 1;
      byKey.set(k, acc);
    }
  }

  const results: SkillAggregateResult[] = [];
  for (const v of byKey.values()) {
    const percentage = v.totalCount > 0 ? v.correctCount / v.totalCount : 0;
    results.push({
      studentId: v.studentId,
      nodeId: v.nodeId,
      correctCount: v.correctCount,
      totalCount: v.totalCount,
      percentage,
      performanceLevel: percentageToPerformanceLevel(percentage, scale),
    });
  }
  return results;
}
