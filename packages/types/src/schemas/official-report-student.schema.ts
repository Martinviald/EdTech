import { z } from 'zod';
import type { PerformanceLevel } from '../enums';
import type { OfficialReportMeta } from './official-report-common.schema';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-26 — Informe por niño por evaluación (SÓLO generación)
// GET /api/reports/student?assessmentId=...&studentId=...
//
// Informe individual del alumno para una evaluación, sobre datos ya calculados
// (assessment_results, skill_results, responses). Contiene PII (RUT, nombre): el
// service aplica scoping (el profesor sólo ve alumnos de sus cursos).
//
// El ENVÍO por correo al apoderado queda DIFERIDO (fase posterior): requiere
// infraestructura de email inexistente + modelar correos de apoderados + revisión
// legal de PII de menores (Ley 19.628). Este contrato es sólo de generación.
// ─────────────────────────────────────────────────────────────────────────────

export const officialStudentReportQuerySchema = z.object({
  assessmentId: z.string().uuid(),
  studentId: z.string().uuid(),
});
export type OfficialStudentReportQueryDto = z.infer<typeof officialStudentReportQuerySchema>;

export type OfficialStudentReportMeta = OfficialReportMeta & {
  student: { id: string; rut: string; fullName: string };
  classGroup: { id: string; name: string; gradeName: string | null } | null;
  administeredAt: string | Date | null;
};

/** Resultado global del alumno en la evaluación. */
export type OfficialStudentOverallResult = {
  achievement: number | null; // % de logro 0..100
  grade: number | null;
  totalScore: number | null;
  maxScore: number | null;
  correctCount: number;
  totalItems: number;
  performanceLevel: PerformanceLevel | null;
  requiresSupport: boolean; // cae en el nivel de logro más bajo
  // Promedio del curso, para contextualizar el resultado del alumno (sin exponer
  // a otros alumnos). Null si no hay datos del curso.
  classAverageAchievement: number | null;
};

/** Logro del alumno por eje/habilidad (taxonomy_node). */
export type OfficialStudentSkillRow = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  correctCount: number;
  totalCount: number;
  percentage: number | null; // 0..100
  performanceLevel: PerformanceLevel | null;
};

/** Respuesta del alumno a una pregunta. */
export type OfficialStudentItemRow = {
  itemId: string;
  position: number;
  itemType: string;
  oaCode: string | null;
  axis: string | null;
  skill: string | null;
  textType: string | null;
  selectedKey: string | null; // alternativa elegida (null = sin respuesta)
  correctKey: string | null;
  isCorrect: boolean | null;
  score: number | null; // final_score o raw_score
  maxScore: number;
};

export type OfficialStudentReportResponse = {
  meta: OfficialStudentReportMeta;
  result: OfficialStudentOverallResult;
  skills: OfficialStudentSkillRow[]; // ordenado por logro asc (brechas primero)
  items: OfficialStudentItemRow[]; // ordenado por posición
};
