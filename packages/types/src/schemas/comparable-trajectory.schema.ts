import { z } from 'zod';
import type { BaselineRef, ComparabilityMeta } from '../comparability';
import type { PerformanceBandDistributionBucket } from './dashboard.schema';
import type { PerformanceBandView } from './performance-band.schema';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  type InstrumentApplicationPeriod,
} from './instrument.schema';
import type { ComparableUnitClassGroup } from './comparable-overview.schema';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/comparable-trajectory
//
// La vista unificada de "Trayectoria comparable" (docs/diseno-comparacion-progresion.md).
// Reemplaza la comparación generacional (H6.3) y la progresión (H6.6), que graficaban
// promedios que mezclaban instrumentos de distinta dificultad y escala.
//
// El principio: UNA unidad comparable (una familia N2 = mismo tipo+asignatura+nivel) que
// se mueve a lo largo de UN eje. Cada punto es una aplicación comparable con su % de logro
// y su distribución por las bandas DEL INSTRUMENTO — nunca un promedio entre instrumentos.
//
//  - `axis='years'`   → fija el momento (`applicationPeriod`), varía el año. Es N2
//                       (`instrument_family`): la comparación generacional legítima.
//  - `axis='moments'` → recorre TODAS las aplicaciones de la familia en orden cronológico
//                       (año, y dentro del año diagnóstico → monitoreo → cierre): los
//                       momentos de los años anteriores y los de este año hasta hoy. Es N4
//                       (`instrument_history`). Acotado a un `year` degenera en la serie
//                       N3 (`period_series`) de ese ciclo.
// ─────────────────────────────────────────────────────────────────────────────

export const COMPARABLE_TRAJECTORY_AXES = ['years', 'moments'] as const;
export type ComparableTrajectoryAxis = (typeof COMPARABLE_TRAJECTORY_AXES)[number];

export const comparableTrajectoryQuerySchema = z.object({
  axis: z.enum(COMPARABLE_TRAJECTORY_AXES),
  // La familia comparable base: tipo de instrumento + asignatura + nivel.
  gradeId: z.string().uuid(),
  subjectId: z.string().uuid(),
  instrumentType: z.string().min(1),
  // Eje años: el momento del ciclo que se mantiene fijo (ej. "intermedio"). Ausente si
  // el instrumento no tiene ciclo (custom).
  applicationPeriod: z.enum(INSTRUMENT_APPLICATION_PERIODS).optional(),
  // Eje momentos: acota la trayectoria a un año (instruments.year). Ausente → toda la
  // historia de la familia, año a año y momento a momento.
  year: z.coerce.number().int().optional(),
  // Acota el alcance a un curso (drill nivel → curso, decisión C). Ausente → todo el nivel.
  classGroupId: z.string().uuid().optional(),
});
export type ComparableTrajectoryQueryDto = z.infer<typeof comparableTrajectoryQuerySchema>;

/**
 * Un punto de la trayectoria: una aplicación comparable de la familia (un año en el eje
 * de años, o un momento del ciclo en el eje de momentos). Su `averageAchievement` es
 * legítimo porque todos los resultados salen del mismo instrumento y del mismo corte.
 */
export type ComparableTrajectoryPoint = {
  /** Clave estable del punto: el año (`"2025"`) o la aplicación (`"2025-intermedio"`). */
  key: string;
  /** Etiqueta lista para pintar en el eje. */
  label: string;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  instrumentId: string;
  instrumentName: string;
  assessmentIds: string[];
  administeredAt: string | Date | null;
  studentsAssessed: number;
  /** % de logro DENTRO del punto: legítimo, no mezcla instrumentos. */
  averageAchievement: number | null;
  /** Distribución por las bandas del instrumento. `null` si el instrumento no define bandas. */
  bandDistribution: PerformanceBandDistributionBucket[] | null;
};

export type ComparableTrajectoryResponse = {
  scope: 'org' | 'teacher';
  axis: ComparableTrajectoryAxis;
  gradeId: string;
  gradeName: string | null;
  subjectId: string;
  subjectName: string | null;
  instrumentType: string;
  /** Momento fijo (eje años) o `null`. */
  applicationPeriod: InstrumentApplicationPeriod | null;
  classGroupId: string | null;
  classGroupName: string | null;
  /** Bandas del instrumento de la familia, para la leyenda de la distribución. */
  bands: PerformanceBandView[] | null;
  /** Puntos ordenados ascendente a lo largo del eje. */
  series: ComparableTrajectoryPoint[];
  /** El punto más reciente de la serie (conveniencia; `= series[series.length - 1]`). */
  current: ComparableTrajectoryPoint | null;
  /** Desglose por curso del punto actual — el drill nivel → curso (decisión C). */
  byClassGroup: ComparableUnitClassGroup[];
  /**
   * Las dos variaciones del resultado actual, en un mismo lugar (decisión A):
   *  - `previousPeriod`: la evaluación anterior del mismo nivel (momento anterior del ciclo).
   *  - `previousYear`:  la misma medición el año anterior (la generación previa).
   * Cualquiera puede ser `null` si no hay un comparable disponible.
   */
  baselines: {
    previousPeriod: BaselineRef | null;
    previousYear: BaselineRef | null;
  };
  /**
   * Comparabilidad del alcance. La entrada guiada garantiza N1/N2/N3, pero se emite igual
   * para que la UI tenga la red de seguridad si un alcance resultara `mixed`.
   */
  comparability: ComparabilityMeta;
};
