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
  // Thresholds opcionales explícitos para `percentageToPerformanceLevel`.
  // Si se proveen tienen precedencia sobre `config.performanceThresholds`.
  performanceThresholds?: {
    elementary?: number;
    adequate?: number;
    advanced?: number;
  };
};

// ── Thresholds de nivel de desempeño ─────────────────────────────────────────
// Umbrales (0..1) por defecto alineados al estándar DIA (4 niveles). ÚNICO punto
// de verdad: lo consumen `percentageToPerformanceLevel` aquí, y los servicios
// `dashboards`/`heatmap` en la API. No duplicar literales 0.4/0.7/0.85.
export const DEFAULT_PERFORMANCE_THRESHOLDS = {
  elementary: 0.4,
  adequate: 0.7,
  advanced: 0.85,
} as const;

export type PerformanceThresholds = {
  elementary: number;
  adequate: number;
  advanced: number;
};

// Escala por defecto cuando el instrumento no tiene grading_scale asignada.
// Convención chilena: 1.0..7.0, aprobación con 60% de logro → 4.0.
export const DEFAULT_GRADING_SCALE: GradingScaleParams = {
  type: 'linear_chilean',
  minGrade: 1,
  maxGrade: 7,
  passingGrade: 4,
  passingThreshold: 0.6,
};

// ── Config tipada de escalas escaladas (paes_scaled / irt_based) ─────────────
// Las fórmulas NO se hardcodean: se leen de `scale.config`. Si la config falta,
// se documenta el fallback (linear_chilean) en cada conversor.

/** Punto de anclaje (porcentaje de logro 0..1 → puntaje escalado). */
export type ScaledAnchor = { p: number; score: number };

/** Config para `paes_scaled`: anclajes para interpolación lineal por tramos. */
export type PaesScaledConfig = {
  // Anclajes ordenables por `p`. Ej.: [{p:0,score:150},{p:1,score:1000}].
  anchors?: ScaledAnchor[];
  // Alternativa simple si no hay anchors: extremos del rango escalado.
  minScore?: number;
  maxScore?: number;
};

/**
 * Config para `irt_based`. El % de logro (proxy de θ) se mapea a un puntaje
 * escalado con `scaledScore = mean + theta * sd`, donde `theta` se deriva del
 * porcentaje vía la inversa logística centrada (logit). Parámetros configurables.
 */
export type IrtScaledConfig = {
  mean?: number; // media de la escala (ej. 500 IRT, 50 stanine*10)
  sd?: number; // desviación estándar de la escala (ej. 100)
  // Factor que escala el logit a unidades de θ. Default 1.
  thetaScale?: number;
  // Recorte del puntaje resultante.
  minScore?: number;
  maxScore?: number;
};

/**
 * Convierte un porcentaje de logro (0..1) a nota/puntaje numérico.
 * - `linear_chilean`: lineal por tramos con quiebre en passingThreshold.
 *   - 0..threshold → minGrade..passingGrade
 *   - threshold..1 → passingGrade..maxGrade
 * - `percentage`: devuelve percentage * 100 (escala 0-100).
 * - `paes_scaled`: interpolación por anclajes de `config.anchors` (o min/maxScore).
 * - `irt_based`: mapea el % vía logit a un puntaje `mean + θ·sd` de `config`.
 * - `custom`/otros: linear_chilean como fallback.
 *
 * Para `paes_scaled`/`irt_based` el valor devuelto es el puntaje escalado (no la
 * nota chilena). Si la config necesaria falta, cae a `linear_chilean` (fallback
 * documentado) para no romper el flujo.
 */
export function percentageToGrade(percentage: number, scale: GradingScaleParams): number {
  if (!Number.isFinite(percentage)) return scale.minGrade;
  const p = Math.max(0, Math.min(1, percentage));

  switch (scale.type) {
    case 'percentage':
      return roundGrade(p * 100);
    case 'paes_scaled':
      return paesScaledScore(p, scale);
    case 'irt_based':
      return irtScaledScore(p, scale);
    case 'linear_chilean':
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

/**
 * PAES (u otra escala lineal por tramos). Interpola `p` (0..1) sobre los anclajes
 * `config.anchors` (ordenados por `p`). Sin anchors, usa `config.minScore`/
 * `config.maxScore` como recta. Sin config → fallback `linear_chilean`.
 */
function paesScaledScore(p: number, scale: GradingScaleParams): number {
  const cfg = (scale.config ?? undefined) as PaesScaledConfig | undefined;
  const anchors = cfg?.anchors;
  if (anchors && anchors.length >= 2) {
    return roundGrade(interpolateAnchors(p, anchors));
  }
  if (typeof cfg?.minScore === 'number' && typeof cfg?.maxScore === 'number') {
    return roundGrade(cfg.minScore + p * (cfg.maxScore - cfg.minScore));
  }
  // Fallback documentado: sin config de escalado, comportamiento chileno previo.
  return linearChileanGrade(p, scale);
}

/** Interpolación lineal por tramos sobre anclajes ordenados por `p`. */
function interpolateAnchors(p: number, anchors: ScaledAnchor[]): number {
  const sorted = [...anchors].sort((a, b) => a.p - b.p);
  if (p <= sorted[0]!.p) return sorted[0]!.score;
  const last = sorted[sorted.length - 1]!;
  if (p >= last.p) return last.score;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (p >= lo.p && p <= hi.p) {
      const span = hi.p - lo.p;
      const ratio = span === 0 ? 0 : (p - lo.p) / span;
      return lo.score + ratio * (hi.score - lo.score);
    }
  }
  return last.score;
}

/**
 * IRT: aproxima θ a partir del % de logro con la inversa logística (logit) y lo
 * mapea a la escala `mean + θ·sd`. `p` se recorta a (ε, 1-ε) para evitar ±∞.
 * Sin `mean`/`sd` en config → fallback `linear_chilean`.
 */
function irtScaledScore(p: number, scale: GradingScaleParams): number {
  const cfg = (scale.config ?? undefined) as IrtScaledConfig | undefined;
  if (cfg == null || typeof cfg.mean !== 'number' || typeof cfg.sd !== 'number') {
    return linearChileanGrade(p, scale);
  }
  const eps = 1e-6;
  const clamped = Math.max(eps, Math.min(1 - eps, p));
  const logit = Math.log(clamped / (1 - clamped));
  const theta = logit * (cfg.thetaScale ?? 1);
  let score = cfg.mean + theta * cfg.sd;
  if (typeof cfg.minScore === 'number') score = Math.max(cfg.minScore, score);
  if (typeof cfg.maxScore === 'number') score = Math.min(cfg.maxScore, score);
  return roundGrade(score);
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
  scale?: Pick<GradingScaleParams, 'config' | 'performanceThresholds'>,
): PerformanceLevel {
  const p = Math.max(0, Math.min(1, percentage));
  const cfg = scale?.config as
    | { performanceThresholds?: { adequate?: number; elementary?: number; advanced?: number } }
    | undefined;
  const direct = scale?.performanceThresholds;
  const thresholds = {
    elementary:
      direct?.elementary ??
      cfg?.performanceThresholds?.elementary ??
      DEFAULT_PERFORMANCE_THRESHOLDS.elementary,
    adequate:
      direct?.adequate ??
      cfg?.performanceThresholds?.adequate ??
      DEFAULT_PERFORMANCE_THRESHOLDS.adequate,
    advanced:
      direct?.advanced ??
      cfg?.performanceThresholds?.advanced ??
      DEFAULT_PERFORMANCE_THRESHOLDS.advanced,
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

// ── Clasificación por bandas data-driven (performance_bands) ──────────────────
// Fuente de verdad del nivel de logro cuando el instrumento tiene bandas
// configuradas. Cada banda define su rango [minThreshold, maxThreshold) sobre el
// % de logro (0..1). Reemplaza el corte hardcodeado 40/70/85 por datos por
// instrumento (ver docs/analisis-clasificacion-niveles-dia.md). El caller mapea
// las filas de la tabla `performance_bands` (thresholds decimales string) a este
// tipo con los thresholds ya parseados a number.

export type PerformanceBandInput = {
  id: string;
  key: string;
  label: string;
  order: number;
  minThreshold: number; // 0..1 inclusivo
  maxThreshold: number; // 0..1 exclusivo (salvo la banda superior, ver abajo)
  color?: string | null;
};

/**
 * Clasifica un % de logro (0..1) en la banda correspondiente.
 * - Rango [min, max): min inclusivo, max exclusivo.
 * - La banda de mayor `order` trata su `max` como inclusivo, de modo que p=1.0
 *   siempre cae en la banda superior aunque su maxThreshold sea 1.
 * Devuelve `null` si no hay bandas o ninguna contiene el %.
 */
export function classifyByBands(
  percentage: number,
  bands: readonly PerformanceBandInput[] | null | undefined,
): PerformanceBandInput | null {
  if (!bands || bands.length === 0) return null;
  const p = Math.max(0, Math.min(1, percentage));
  const sorted = [...bands].sort((a, b) => a.order - b.order);
  const top = sorted[sorted.length - 1]!;
  for (const b of sorted) {
    const isTop = b === top;
    if (p >= b.minThreshold && (p < b.maxThreshold || (isTop && p <= b.maxThreshold))) {
      return b;
    }
  }
  return null;
}

/**
 * Deriva el enum legacy de 4 niveles (`performance_level`) desde una banda, para
 * retrocompatibilidad. Mapea la posición relativa de la banda (order) dentro del
 * set a uno de los 4 buckets. Instrumentos con 3 bandas (DIA I/II/III) o 6 (CEFR)
 * se proyectan proporcionalmente. `performance_band_id` sigue siendo la verdad.
 */
export function bandToLegacyLevel(
  band: PerformanceBandInput,
  bands: readonly PerformanceBandInput[],
): PerformanceLevel {
  const levels: PerformanceLevel[] = ['insufficient', 'elementary', 'adequate', 'advanced'];
  const n = bands.length;
  if (n <= 1) return 'adequate';
  // Posición relativa 0..1 del `order` de la banda dentro del set ordenado.
  const orders = [...bands].map((b) => b.order).sort((a, b) => a - b);
  const idx = orders.indexOf(band.order);
  const ratio = idx / (n - 1);
  const bucket = Math.min(levels.length - 1, Math.round(ratio * (levels.length - 1)));
  return levels[bucket]!;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

export type ResponseForCalculation = {
  studentId: string;
  itemId: string;
  isCorrect: boolean | null;
  rawScore: number | null;
  // Opcional: si el flujo distingue ai/human/final, finalScore tiene precedencia
  // sobre rawScore al calcular el total. Si no, se usa rawScore.
  finalScore?: number | null;
  maxScore: number;
  // Posición del ítem y nodos de taxonomía (para skill_results).
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
  // Métrica raíz extendida (#3). Opcionales para no romper consumidores DIA:
  // un instrumento `percentage`/`linear_chilean` los deja en null/undefined.
  scaledScore?: number | null;
  bandLabel?: string | null;
  // Nivel de logro como dato (performance_bands). Poblado cuando el instrumento
  // tiene bandas configuradas; null → se usa el enum `performanceLevel` legacy.
  performanceBandId?: string | null;
};

export type SkillAggregateResult = {
  studentId: string;
  nodeId: string;
  correctCount: number;
  totalCount: number;
  percentage: number; // 0..1
  performanceLevel: PerformanceLevel;
  performanceBandId?: string | null;
};

/**
 * Score efectivo de una respuesta: `finalScore` tiene precedencia sobre
 * `rawScore` cuando existe (CLAUDE.md §8.3 — el final_score es el que cuenta).
 * Respuestas pendientes (`finalScore`/`rawScore` ambos null) cuentan 0.
 */
function effectiveScore(r: Pick<ResponseForCalculation, 'finalScore' | 'rawScore'>): number {
  if (r.finalScore != null) return r.finalScore;
  if (r.rawScore != null) return r.rawScore;
  return 0;
}

/**
 * Agrega `responses` por alumno y devuelve los totales (assessment_results).
 * Pure function — todos los datos llegan por parámetro.
 */
export function aggregateStudentResults(
  responses: ResponseForCalculation[],
  scale: GradingScaleParams,
  bands?: readonly PerformanceBandInput[] | null,
): StudentAggregateResult[] {
  const byStudent = new Map<string, ResponseForCalculation[]>();
  for (const r of responses) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r);
    byStudent.set(r.studentId, list);
  }

  const results: StudentAggregateResult[] = [];
  for (const [studentId, rows] of byStudent) {
    // Los ítems pendientes (`isCorrect === null`: no auto-corregibles, esperan
    // corrección humana/IA) NO cuentan para el % — ni en numerador ni en
    // denominador — para no diluir el logro de los ítems efectivamente evaluados.
    // Sí marcan `isComplete = false`. Misma semántica que `aggregateSkillResults`,
    // aplicada en la fuente para que TODOS los consumidores (ingesta de respuestas
    // y recálculo de resultados) sean consistentes sin replicar el filtro (DRY).
    const scored = rows.filter((r) => r.isCorrect !== null);
    const totalScore = scored.reduce((acc, r) => acc + effectiveScore(r), 0);
    const maxScore = scored.reduce((acc, r) => acc + r.maxScore, 0);
    const percentage = maxScore > 0 ? totalScore / maxScore : 0;
    const grade = percentageToGrade(percentage, scale);
    const isComplete = rows.every((r) => r.isCorrect !== null);

    // Nivel de logro: si el instrumento tiene bandas configuradas, éstas son la
    // fuente de verdad (performance_band_id) y el enum legacy se deriva de la
    // banda. Sin bandas → corte por thresholds del enum (comportamiento previo).
    const band = classifyByBands(percentage, bands);
    const performanceLevel = band
      ? bandToLegacyLevel(band, bands!)
      : percentageToPerformanceLevel(percentage, scale);
    const performanceBandId = band?.id ?? null;

    // Métrica raíz extendida (#3): para escalas `paes_scaled`/`irt_based`,
    // `grade` ya ES el puntaje escalado → exponerlo también como `scaledScore`.
    // `bandLabel` prefiere la banda del instrumento; si no, `config.bands`.
    const isScaled = scale.type === 'paes_scaled' || scale.type === 'irt_based';
    const scaledScore = isScaled ? grade : null;
    const bandLabel = band?.label ?? resolveBandLabel(percentage, scale);

    results.push({
      studentId,
      totalScore,
      maxScore,
      percentage,
      grade,
      performanceLevel,
      isComplete,
      scaledScore,
      bandLabel,
      performanceBandId,
    });
  }
  return results;
}

/** Banda de desempeño (etiqueta) según `config.bands`, si la escala las define. */
export type BandThreshold = { label: string; minThreshold: number };

function resolveBandLabel(percentage: number, scale: GradingScaleParams): string | null {
  const cfg = (scale.config ?? undefined) as { bands?: BandThreshold[] } | undefined;
  const bands = cfg?.bands;
  if (!bands || bands.length === 0) return null;
  const p = Math.max(0, Math.min(1, percentage));
  // Mayor minThreshold que el alumno alcanza gana.
  const sorted = [...bands].sort((a, b) => b.minThreshold - a.minThreshold);
  for (const b of sorted) {
    if (p >= b.minThreshold) return b.label;
  }
  return sorted[sorted.length - 1]?.label ?? null;
}

/**
 * Agrega `responses` por alumno × nodo de taxonomía y devuelve skill_results.
 */
export function aggregateSkillResults(
  responses: ResponseForCalculation[],
  scale?: Pick<GradingScaleParams, 'config'>,
  bands?: readonly PerformanceBandInput[] | null,
): SkillAggregateResult[] {
  const key = (studentId: string, nodeId: string) => `${studentId}__${nodeId}`;
  const byKey = new Map<
    string,
    {
      studentId: string;
      nodeId: string;
      // correctCount/totalCount se mantienen como conteo de ítems (para las
      // columnas integer de skill_results y compatibilidad). El % real se
      // pondera por puntaje/maxScore (#7/#9), no por conteo binario.
      correctCount: number;
      totalCount: number;
      scoreSum: number; // Σ effectiveScore de ítems corregidos
      maxSum: number; // Σ maxScore de ítems corregidos (peso por ítem)
    }
  >();

  for (const r of responses) {
    for (const nodeId of r.taxonomyNodeIds) {
      const k = key(r.studentId, nodeId);
      const acc = byKey.get(k) ?? {
        studentId: r.studentId,
        nodeId,
        correctCount: 0,
        totalCount: 0,
        scoreSum: 0,
        maxSum: 0,
      };
      acc.totalCount += 1;
      if (r.isCorrect === true) acc.correctCount += 1;
      // Ítems pendientes (isCorrect === null) NO contaminan el %: se excluyen
      // del denominador ponderado. Sólo se promedian los ítems corregidos.
      if (r.isCorrect !== null && r.maxScore > 0) {
        acc.scoreSum += effectiveScore(r);
        acc.maxSum += r.maxScore;
      }
      byKey.set(k, acc);
    }
  }

  const results: SkillAggregateResult[] = [];
  for (const v of byKey.values()) {
    // % ponderado por maxScore por ítem (respeta finalScore). Si no hay ítems
    // corregidos con maxScore (todo pendiente / maxScore 0), cae a 0.
    const percentage = v.maxSum > 0 ? v.scoreSum / v.maxSum : 0;
    // Mismas bandas del instrumento aplicadas al % del nodo de habilidad.
    const band = classifyByBands(percentage, bands);
    results.push({
      studentId: v.studentId,
      nodeId: v.nodeId,
      correctCount: v.correctCount,
      totalCount: v.totalCount,
      percentage,
      performanceLevel: band
        ? bandToLegacyLevel(band, bands!)
        : percentageToPerformanceLevel(percentage, scale),
      performanceBandId: band?.id ?? null,
    });
  }
  return results;
}
