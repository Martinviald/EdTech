import { z } from 'zod';
import type { PerformanceLevel } from '../enums';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5 — Mapa de calor de % logro por habilidad × asignatura (H6.10)
// Módulo backend: apps/api/src/heatmap/  (ruta base /api/heatmap)
//
// Tabla heatmap: filas = habilidades (taxonomy_nodes), columnas = asignaturas
// (subjects). Cada celda = % logro promedio (0..100) agregado desde skill_results
// sobre el scope del usuario. Respeta el scoping por rol (directivo = toda la org;
// profesor = sólo sus cursos asignados) — el org_id SIEMPRE sale del token.
// ─────────────────────────────────────────────────────────────────────────────

// ── Query DTO ────────────────────────────────────────────────────────────────

/** Filtros del heatmap. Todos opcionales: por defecto agrega sobre lo visible. */
export const heatmapQuerySchema = z.object({
  assessmentId: z.string().uuid().optional(),
  instrumentId: z.string().uuid().optional(),
  instrumentType: z.string().min(1).optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  classGroupId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});
export type HeatmapQueryDto = z.infer<typeof heatmapQuerySchema>;

// ── Response Model ───────────────────────────────────────────────────────────

/** Una asignatura = una columna del heatmap. */
export type HeatmapSubject = {
  subjectId: string;
  subjectName: string;
};

/** Una celda: % logro de una habilidad en una asignatura. `null` = sin datos. */
export type HeatmapCell = {
  subjectId: string;
  averageAchievement: number | null; // % logro promedio 0..100
  performanceLevel: PerformanceLevel | null;
  studentsAssessed: number;
};

/** Una fila del heatmap = una habilidad (taxonomy node) con sus celdas. */
export type HeatmapRow = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  // % logro de la habilidad agregando todas las asignaturas visibles (para una
  // columna "Total" / orden por criticidad).
  overallAchievement: number | null; // 0..100
  overallPerformanceLevel: PerformanceLevel | null;
  cells: HeatmapCell[]; // una por subject de `subjects`, en el mismo orden
};

/** GET /api/heatmap → matriz habilidad × asignatura. */
export type HeatmapResponse = {
  subjects: HeatmapSubject[]; // columnas, en orden
  rows: HeatmapRow[]; // filas (habilidades), ordenadas por criticidad asc
};
