// ── Lista de alumnos con señal (#2B · Z0) ────────────────────────────────────
// La puerta de entrada a la vista 360. Hasta ahora, para descubrir que un alumno
// estaba mal había que sospecharlo primero: el picker sólo ofrecía curso + buscar
// por nombre, sin un solo dato de desempeño. Esto invierte la dirección — el
// alumno que necesita atención emerge solo.
//
// ⚠️ Estas señales son DERIVADAS, no persistidas: se recalculan por request sobre
// `assessment_results`, igual que las alertas del dashboard. Cuando exista la
// bandeja del motor proactivo (roadmap #3B capa 3, con ciclo de vida y dedup),
// esta vista debe pasar a leer de ahí en vez de derivar — y `deriveAlerts` de
// dashboards y `buildRiskStudents` de assessment-report deben converger al mismo
// lugar. No agregar una cuarta derivación en otra vista.
//
// Los cortes NO se definen acá: salen de `ALERT_THRESHOLDS` (comparability.ts),
// que es el único lugar donde viven.
import { z } from 'zod';
import type { PerformanceBandView } from './performance-band.schema';

/**
 * Las señales que hacen emerger a un alumno. Ninguna es un corte absoluto de
 * logro ("bajo 60%"), porque un mismo porcentaje no significa lo mismo en dos
 * instrumentos con cortes distintos: todas se leen contra la escala del propio
 * instrumento o contra el resultado comparable anterior del propio alumno.
 */
export const STUDENT_SIGNALS = [
  /** Bajó de nivel respecto del momento comparable anterior. */
  'band_drop',
  /** Su resultado más reciente cae en el nivel más bajo de ese instrumento. */
  'lowest_band',
  /** Dos o más resultados en el nivel más bajo: no es un mal día. */
  'persistent_low',
  /** Caída en puntos porcentuales sobre el umbral, entre resultados comparables. */
  'achievement_drop',
] as const;
export type StudentSignal = (typeof STUDENT_SIGNALS)[number];

export const STUDENT_SIGNAL_LABELS: Record<StudentSignal, string> = {
  band_drop: 'Retrocedió de nivel',
  lowest_band: 'Nivel más bajo',
  persistent_low: 'Bajo persistente',
  achievement_drop: 'Caída de logro',
};

export const STUDENT_SIGNAL_DESCRIPTIONS: Record<StudentSignal, string> = {
  band_drop: 'Bajó de nivel respecto del momento comparable anterior.',
  lowest_band: 'Su resultado más reciente cae en el nivel más bajo de ese instrumento.',
  persistent_low: 'Quedó en el nivel más bajo en dos o más evaluaciones.',
  achievement_drop: 'Su % de logro cayó respecto de una evaluación comparable anterior.',
};

export const studentSignalsQuerySchema = z.object({
  classGroupId: z.string().uuid().optional(),
  signal: z.enum(STUDENT_SIGNALS).optional(),
  search: z.string().trim().min(1).optional(),
});
export type StudentSignalsQueryDto = z.infer<typeof studentSignalsQuerySchema>;

export type StudentSignalsRow = {
  studentId: string;
  fullName: string;
  rut: string;
  classGroupName: string | null;
  gradeName: string | null;
  assessmentsCount: number;
  /** Resultado más reciente del alumno, para dar contexto a la señal. */
  latest: {
    assessmentId: string;
    instrumentName: string;
    subjectName: string | null;
    administeredAt: string | Date | null;
    achievement: number | null;
    performanceBand: PerformanceBandView | null;
  } | null;
  /** Caída en puntos porcentuales que disparó `achievement_drop`, si aplica. */
  dropPp: number | null;
  signals: StudentSignal[];
};

export type StudentSignalsResponse = {
  data: StudentSignalsRow[];
  total: number;
  /** Cuántos alumnos del alcance dispara cada señal, para los chips. */
  counts: Record<StudentSignal, number>;
};
