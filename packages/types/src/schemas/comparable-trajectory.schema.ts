import { z } from 'zod';
import type { BaselineRef, ComparabilityMeta } from '../comparability';
import type { PerformanceBandDistributionBucket } from './dashboard.schema';
import type { PerformanceBandView } from './performance-band.schema';
import type { InstrumentApplicationPeriod } from './instrument.schema';
import type { ComparableUnitClassGroup } from './comparable-overview.schema';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/comparable-trajectory
//
// La vista unificada de "Trayectoria comparable" (docs/diseno-comparacion-progresion.md).
// Reemplaza la comparación generacional (H6.3) y la progresión (H6.6), que graficaban
// promedios que mezclaban instrumentos de distinta dificultad y escala.
//
// El principio: UNA familia comparable (mismo tipo + asignatura + nivel) desplegada como
// una MATRIZ año × momento del ciclo. El eje es el ciclo (Diagnóstico → Monitoreo →
// Cierre) y hay una serie por año: así el año en curso se lee evaluación a evaluación
// contra los años anteriores del mismo nivel — mismo instrumento, mismo corte de niveles,
// eje comparable.
//
// Cada punto es una aplicación comparable con su % de logro y su distribución por las
// bandas DEL INSTRUMENTO — nunca un promedio entre instrumentos. Es N4
// (`instrument_history`); acotado a un `year` degenera en la serie N3 (`period_series`)
// de ese ciclo.
// ─────────────────────────────────────────────────────────────────────────────

export const comparableTrajectoryQuerySchema = z.object({
  // La familia comparable base: tipo de instrumento + asignatura + nivel.
  gradeId: z.string().uuid(),
  subjectId: z.string().uuid(),
  instrumentType: z.string().min(1),
  // Acota la trayectoria a un año (instruments.year). Ausente → toda la historia de la
  // familia, una serie por año.
  year: z.coerce.number().int().optional(),
  // Acota el alcance a un curso (drill nivel → curso, decisión C). Ausente → todo el nivel.
  classGroupId: z.string().uuid().optional(),
});
export type ComparableTrajectoryQueryDto = z.infer<typeof comparableTrajectoryQuerySchema>;

/**
 * Un punto de la trayectoria: la aplicación de la familia en UN momento del ciclo de UN
 * año. Su `averageAchievement` es legítimo porque todos los resultados salen del mismo
 * instrumento y del mismo corte.
 */
export type ComparableTrajectoryPoint = {
  /** Clave del momento del ciclo (`"intermedio"`, o `"none"` si el instrumento no lo declara). */
  key: string;
  /** Etiqueta del momento, lista para el eje X (`"Monitoreo"`). */
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

/**
 * Una línea del gráfico: el ciclo completo de un año. Los alumnos de un año anterior son
 * otra generación (hoy están un nivel más arriba); eso se dice en `label` y
 * `currentGradeName`, nunca cambiando el instrumento ni la escala.
 */
export type ComparableTrajectoryYearSeries = {
  year: number | null;
  /** Etiqueta de la serie: "2026" el año más reciente; "2025 · hoy 6º básico" los anteriores. */
  label: string;
  /** Nivel donde está hoy esa generación. `null` si no se puede proyectar. */
  currentGradeName: string | null;
  /** Un punto por momento con datos ese año, en el orden del ciclo. */
  points: ComparableTrajectoryPoint[];
};

export type ComparableTrajectoryResponse = {
  scope: 'org' | 'teacher';
  gradeId: string;
  gradeName: string | null;
  subjectId: string;
  subjectName: string | null;
  instrumentType: string;
  classGroupId: string | null;
  classGroupName: string | null;
  /** Bandas del instrumento de la familia, para la leyenda de la distribución. */
  bands: PerformanceBandView[] | null;
  /** El eje X: los momentos presentes en toda la data, en el orden del ciclo. */
  periods: { key: string; label: string }[];
  /** Una serie por año, de la más reciente a la más antigua. */
  series: ComparableTrajectoryYearSeries[];
  /** El último momento con datos del año más reciente: lo que describen los KPIs. */
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
   * Comparabilidad del alcance. La entrada guiada garantiza N1/N2/N3/N4, pero se emite
   * igual para que la UI tenga la red de seguridad si un alcance resultara `mixed`.
   */
  comparability: ComparabilityMeta;
};
