import { z } from 'zod';
import type { BaselineRef } from '../comparability';
import type { ComparabilityMeta } from '../comparability';
import { dashboardFiltersQuerySchema } from './dashboard.schema';
import type {
  PerformanceBandDistributionBucket,
  PerformanceDistributionBucket,
} from './dashboard.schema';
import type { PerformanceBandView } from './performance-band.schema';
import type { InstrumentApplicationPeriod } from './instrument.schema';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboards/comparable-overview
//
// El reemplazo del "% de logro global" que #1C retiró. En vez de un número que
// promediaba instrumentos de distinta dificultad, entrega UNA FILA POR UNIDAD
// COMPARABLE: el corte % logro × nivel × asignatura × evaluación del roadmap #2.
//
// Cada unidad es agregable por construcción (un instrumento), así que su % de logro
// sí se puede leer. Comparar unidades entre sí se hace por su `baseline`, nunca
// promediándolas.
//
// Ver docs/diseno-panorama-comparable.md §4.3.
// ─────────────────────────────────────────────────────────────────────────────

export const comparableOverviewQuerySchema = dashboardFiltersQuerySchema;
export type ComparableOverviewQueryDto = z.infer<typeof comparableOverviewQuerySchema>;

/** Severidad de una unidad: qué tan urgente es mirarla. Ordena la vista. */
export const UNIT_SEVERITIES = ['high', 'medium', 'low'] as const;
export type UnitSeverity = (typeof UNIT_SEVERITIES)[number];

/** Desglose de una unidad por curso — el drill-down natural de una fila. */
export type ComparableUnitClassGroup = {
  classGroupId: string;
  classGroupName: string;
  gradeName: string | null;
  studentsAssessed: number;
  averageAchievement: number | null; // 0..100
  lowestBandShare: number | null; // % de alumnos en la banda inferior, 0..100
};

export type ComparableUnitSummary = {
  /** `instrumentId`: la unidad comparable mínima que agrupa varias aplicaciones. */
  key: string;
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  subjectId: string | null;
  subjectName: string | null;
  gradeId: string | null;
  gradeName: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
  assessmentIds: string[];
  /** Fecha de aplicación más reciente de la unidad, para ordenar por recencia. */
  lastAdministeredAt: string | Date | null;
  studentsAssessed: number;
  /** % de logro DENTRO de la unidad: legítimo, no mezcla instrumentos. */
  averageAchievement: number | null;
  bands: PerformanceBandView[] | null;
  bandDistribution: PerformanceBandDistributionBucket[] | null;
  /** Distribución legacy de 4 niveles, cuando el instrumento no define bandas. */
  levelDistribution: PerformanceDistributionBucket[] | null;
  /** % de alumnos en la banda/nivel inferior. Es lo que gobierna la severidad. */
  lowestBandShare: number | null; // 0..100
  byClassGroup: ComparableUnitClassGroup[];
  baseline: BaselineRef | null;
  severity: UnitSeverity | null;
};

export type ComparableOverviewResponse = {
  scope: 'org' | 'teacher';
  /** Ordenadas por severidad y, dentro de ella, por recencia. */
  units: ComparableUnitSummary[];
  totals: {
    assessments: number;
    studentsEvaluated: number;
  };
  comparability: ComparabilityMeta;
};
