// ── Comparativas 360 del estudiante (F2 · B2) ────────────────────────────────
// El alumno de `/estudiantes/:id`, POR ASIGNATURA, comparado contra tres cohortes:
// su CURSO, su NIVEL (grado completo) y las GENERACIONES ANTERIORES del mismo grado
// (mismo instrumento en años previos). Todo en % de logro comparable (misma familia
// de instrumento) — nunca mezclando asignaturas ni promediando escalas incomparables.
//
// NO introduce datos nuevos: reagrega lo ya calculado en `assessment_results`,
// reutilizando `ComparableUnitAssembler` (mismo cómputo ponderado por alumnos que el
// Panorama y la Trayectoria). Las cohortes son AGREGADAS (promedios + conteos), nunca
// per-alumno → sin fuga de PII.
import { z } from 'zod';
import type { PerformanceLevel } from '../enums';
import type { ComparabilityMeta } from '../comparability';
import type { PerformanceBandView } from './performance-band.schema';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  type InstrumentApplicationPeriod,
} from './instrument.schema';

/**
 * Mismos filtros que el Panorama del alumno: el ancla por asignatura se elige tras
 * aplicarlos. `year` tiene default implícito en el backend (el año más reciente con
 * resultados del alumno); `allYears` lo desactiva.
 */
export const studentComparisonsQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  instrumentType: z.string().min(1).optional(),
  applicationPeriod: z.enum(INSTRUMENT_APPLICATION_PERIODS).optional(),
  year: z.coerce.number().int().optional(),
  allYears: z.coerce.boolean().optional(),
});
export type StudentComparisonsQueryDto = z.infer<typeof studentComparisonsQuerySchema>;

/**
 * El % de logro de UNA cohorte contra la que se compara el alumno, con su tamaño y el
 * delta del alumno en puntos porcentuales. `achievement` es null cuando la cohorte no
 * tiene resultados con porcentaje; `deltaPp` es null si falta cualquiera de los dos
 * extremos.
 */
export type CohortStat = {
  /** Etiqueta de la cohorte: "3°A" (curso) | "3° básico" (nivel) | "2024" (generación). */
  label: string;
  achievement: number | null;
  studentsAssessed: number;
  /** alumno − cohorte, en puntos porcentuales. Negativo = el alumno está por debajo. */
  deltaPp: number | null;
};

/**
 * El instrumento ancla de una asignatura: la evaluación comparable más reciente del
 * alumno en esa asignatura. De él salen el año, el momento y la familia contra los que
 * se construyen todas las cohortes.
 */
export type StudentComparisonAnchor = {
  instrumentId: string;
  instrumentName: string;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  label: string;
};

/**
 * El alumno en UNA asignatura, comparado en 360°: su propio resultado en el ancla y las
 * tres cohortes (curso, nivel, generaciones anteriores). Si el alcance de la asignatura
 * mezcla instrumentos incomparables, el ancla se muestra igual pero `comparability.reason`
 * marca la mezcla.
 */
export type StudentSubjectComparison = {
  subjectId: string | null;
  subjectName: string | null;
  anchor: StudentComparisonAnchor;
  student: {
    achievement: number | null;
    performanceBand: PerformanceBandView | null;
    performanceLevel: PerformanceLevel | null;
  };
  /** Cohorte del curso del alumno en el año del ancla. null si no se pudo resolver el curso. */
  course: CohortStat | null;
  /** Cohorte del grado completo (todas las secciones) en el año del ancla. */
  grade: CohortStat | null;
  /** Años anteriores, mismo grado + familia, orden descendente por año. */
  generations: CohortStat[];
  comparability: ComparabilityMeta;
};

export type StudentComparisonsResponse = {
  scope: 'org' | 'teacher';
  subjects: StudentSubjectComparison[];
};
