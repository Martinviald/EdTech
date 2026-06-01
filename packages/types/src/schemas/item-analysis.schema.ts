import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5 — Análisis a nivel de ítem (H6.11 + H6.12)
// Módulo backend: apps/api/src/item-analysis/  (ruta base /api/item-analysis)
//
// H6.11 — Tabla cruzada alumno × pregunta (granularidad Gradecam++): para una
//         evaluación, qué respondió cada alumno en cada pregunta, con la
//         habilidad y el contenido (taxonomy_nodes) asociados a cada ítem.
// H6.12 — Click en una pregunta → enunciado + alternativas + distribución de
//         respuestas + análisis de distractores.
//
// Ambos respetan el scoping por rol (directivo = toda la org; profesor = sólo
// sus cursos asignados). El org_id SIEMPRE sale del token, nunca del query.
// La clave correcta de un ítem se deriva de items.content.correctKey o, como
// fallback, de items.content.alternatives[].isCorrect.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// Selector de evaluación (apoyo a H6.11): lista de evaluaciones visibles para el
// usuario, con resultados, para poblar el dropdown de la vista de detalle.
// GET /api/item-analysis/assessments
// ═══════════════════════════════════════════════════════════════════════════

/** Filtros del listado: acotan las evaluaciones ofrecidas (mismos que el dashboard). */
export const assessmentListQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  classGroupId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  instrumentType: z.string().min(1).optional(),
});
export type AssessmentListQueryDto = z.infer<typeof assessmentListQuerySchema>;

/** Una evaluación seleccionable para la tabla cruzada. */
export type AssessmentOption = {
  assessmentId: string;
  name: string | null;
  instrumentName: string;
  instrumentType: string;
  subjectName: string | null;
  gradeName: string | null;
  administeredAt: string | Date | null;
  studentsCount: number; // alumnos con resultados (dentro del scope)
};

export type AssessmentListResponse = {
  data: AssessmentOption[];
};

// ═══════════════════════════════════════════════════════════════════════════
// H6.11 — Tabla cruzada alumno × pregunta
// GET /api/item-analysis/matrix?assessmentId=...
// ═══════════════════════════════════════════════════════════════════════════

/** La matriz es siempre por evaluación: assessmentId es obligatorio. */
export const itemMatrixQuerySchema = z.object({
  assessmentId: z.string().uuid(),
  classGroupId: z.string().uuid().optional(),
  nodeId: z.string().uuid().optional(), // filtra columnas por habilidad/contenido
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ItemMatrixQueryDto = z.infer<typeof itemMatrixQuerySchema>;

/** Etiqueta de taxonomía (habilidad o contenido) asociada a un ítem. */
export type ItemTaxonomyRef = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
};

/** Una columna de la matriz = una pregunta (ítem) de la evaluación. */
export type MatrixQuestionColumn = {
  itemId: string;
  position: number; // número de pregunta (1-based)
  type: string; // item_type
  maxScore: number;
  correctKey: string | null; // clave correcta si es selección múltiple
  skill: ItemTaxonomyRef | null; // habilidad principal
  content: ItemTaxonomyRef | null; // contenido/OA principal
  // % de alumnos (de la población visible) que respondió correctamente esta
  // pregunta — para resaltar preguntas críticas en la cabecera.
  correctRate: number | null; // 0..100
};

/** Una celda de la matriz: la respuesta de un alumno a una pregunta. */
export type MatrixCell = {
  itemId: string;
  selectedKey: string | null; // alternativa elegida (null = sin respuesta)
  isCorrect: boolean | null;
  score: number | null; // final_score si existe, si no raw_score
};

/** Una fila de la matriz = un alumno con sus respuestas. */
export type MatrixStudentRow = {
  studentId: string;
  studentRut: string;
  studentFullName: string;
  classGroupId: string | null;
  classGroupName: string | null;
  correctCount: number;
  answeredCount: number;
  achievement: number | null; // % logro 0..100
  cells: MatrixCell[]; // una por columna, en el orden de `questions`
};

export type ItemMatrixResponse = {
  assessmentId: string;
  assessmentName: string | null;
  instrumentName: string;
  questions: MatrixQuestionColumn[];
  students: {
    data: MatrixStudentRow[];
    total: number;
    page: number;
    limit: number;
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// H6.12 — Distribución de respuestas + análisis de distractores
// GET /api/item-analysis/questions/:itemId?assessmentId=...
// ═══════════════════════════════════════════════════════════════════════════

/** Filtros opcionales: acotan la población sobre la que se calcula la distribución. */
export const questionAnalysisQuerySchema = z.object({
  assessmentId: z.string().uuid().optional(),
  classGroupId: z.string().uuid().optional(),
});
export type QuestionAnalysisQueryDto = z.infer<typeof questionAnalysisQuerySchema>;

/** Una alternativa con su distribución de respuestas. */
export type AlternativeDistribution = {
  key: string; // "A" | "B" | ...
  text: string | null;
  isCorrect: boolean;
  count: number; // nº de alumnos que la eligió
  percentage: number; // 0..100, proporción del total de respuestas
};

/**
 * Un nodo de taxonomía asociado al ítem (item_taxonomy_tags → taxonomy_nodes).
 * A diferencia de `skill`/`content` (un solo nodo representativo), esto lista
 * TODOS los nodos etiquetados en la pregunta.
 */
export type QuestionTaxonomyTag = {
  nodeId: string;
  nodeName: string;
  nodeType: string; // taxonomy_node_type: skill | content | learning_objective | text_type | axis | ...
  nodeCode: string | null; // ej. "OA 4"
  tagType: string; // item_tag_type: primary | secondary
  taggedBy: string; // human | ai
};

export type QuestionAnalysisResponse = {
  itemId: string;
  position: number;
  type: string; // item_type
  stem: string | null; // enunciado
  imageUrl: string | null;
  explanation: string | null;
  correctKey: string | null;
  skill: ItemTaxonomyRef | null; // habilidad principal (representativo, compat)
  content: ItemTaxonomyRef | null; // contenido/OA principal (representativo, compat)
  tags: QuestionTaxonomyTag[]; // TODOS los nodos asociados a la pregunta
  totalResponses: number; // alumnos con respuesta registrada (incluye en blanco)
  blankCount: number; // alumnos sin alternativa elegida
  correctCount: number;
  correctRate: number | null; // 0..100 sobre totalResponses
  alternatives: AlternativeDistribution[]; // incluye la correcta y los distractores
};
