import { z } from 'zod';
import { stringCsvSchema, uuidCsvSchema } from './common.schema';

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

/**
 * Filtros del listado: acotan las evaluaciones ofrecidas (mismos que el dashboard).
 *
 * ⚠️ Multi-valor (T2-12), igual que `dashboardFiltersQuerySchema`: la barra de
 * filtros serializa la selección como CSV (`?gradeId=a,b`) y este endpoint recibe
 * exactamente la MISMA querystring que `/dashboards/filters` (ver la página
 * `/evaluaciones`). Con un DTO escalar, elegir dos niveles reventaba en un 400
 * ("Invalid uuid") y `instrumentType` en CSV no matcheaba nada en silencio.
 */
export const assessmentListQuerySchema = z.object({
  subjectId: uuidCsvSchema,
  gradeId: uuidCsvSchema,
  classGroupId: uuidCsvSchema,
  academicYearId: z.string().uuid().optional(),
  instrumentType: stringCsvSchema,
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
  // TKT-12 — filtro multi-tag con semántica OR: una pregunta se muestra si tiene
  // CUALQUIERA de estos nodos/tags (OA, habilidad, contenido, tipo de texto…).
  // Se combina con `nodeId` como unión (OR sobre todos los ids provistos).
  tagIds: z.array(z.string().uuid()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // TKT-09 — "Detalle por pregunta": el ordenamiento (alumnos/preguntas por % de
  // logro) se resuelve en el frontend, por lo que necesita el curso COMPLETO. Con
  // `all=true` se ignora la paginación y se devuelven todos los alumnos del scope.
  all: z.coerce.boolean().optional().default(false),
});
export type ItemMatrixQueryDto = z.infer<typeof itemMatrixQuerySchema>;

/** Etiqueta de taxonomía (habilidad o contenido) asociada a un ítem. */
export type ItemTaxonomyRef = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
};

/**
 * TKT-22 — Líneas de referencia comparativas por pregunta en el tablero maestro
 * (Detalle por pregunta). Objeto extensible: cada nueva referencia es un campo
 * más, sin romper el contrato existente.
 *
 * - `grade`: % de logro del NIVEL/grado para la pregunta = TODOS los alumnos de la
 *   org que rindieron el MISMO instrumento en el MISMO grado y año académico,
 *   aunque lo hayan hecho bajo otra `assessment` (el modelo crea una evaluación
 *   POR CURSO, así que los cursos hermanos viven en evaluaciones distintas y deben
 *   entrar igual). Como los instrumentos son siempre por nivel, es la referencia
 *   del colegio para esa evaluación. Trasciende el scope del usuario (un profesor
 *   ve su curso en `correctRate` y el nivel aquí). Sale del token; nunca expone
 *   datos de otra org (RLS + withOrgContext).
 * - `sample` (DIFERIDO): % de logro de la MUESTRA de colegios (benchmark
 *   inter-colegio). Bloqueado hasta existir un pool multi-colegio (TKT-20). El
 *   campo se deja opcional para poblarlo después sin cambiar el contrato.
 *
 * ⚠️ La tasa es SIEMPRE ponderada por alumno: `sum(correctCount)/sum(responseCount)`
 * sobre las cohortes involucradas, NUNCA el promedio de los % de cada curso (cursos
 * de distinto N pesarían igual). Los conteos crudos viajan en el contrato para que
 * el frontend pueda agregar con el mismo criterio.
 */
export type ReferenceRate = {
  rate: number | null; // 0..100 — ponderado: correctCount / responseCount
  responseCount: number; // respuestas de TODOS los alumnos de la población
  correctCount: number; // aciertos de TODOS los alumnos de la población
};

export type QuestionReferences = {
  grade: ReferenceRate; // % logro del nivel (mismo grado + instrumento + año)
  sample?: number | null; // 0..100 — muestra de colegios (DIFERIDO, TKT-20)
};

/**
 * Resumen de la población de la línea de referencia, para rotularla y para la
 * columna "% Logro" de su fila. `rate` es el % ponderado sobre TODAS las respuestas
 * de TODOS los alumnos del nivel (no el promedio de los % por pregunta ni por
 * curso). `classGroupCount`/`studentCount` dicen sobre cuántos cursos y alumnos
 * agrega: sin eso, un nivel de un solo curso se lee como dato duplicado del curso.
 */
export type MatrixReferenceScopes = {
  grade: {
    rate: number | null; // 0..100 — % logro ponderado de todo el nivel
    gradeName: string | null;
    classGroupCount: number;
    studentCount: number;
  };
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
  // % de alumnos (de la población VISIBLE, según scope) que respondió
  // correctamente esta pregunta — para resaltar preguntas críticas en la cabecera.
  correctRate: number | null; // 0..100
  // T2-17 — línea de referencia por pregunta (% del nivel; muestra diferida).
  references: QuestionReferences;
};

/** Una celda de la matriz: la respuesta de un alumno a una pregunta. */
export type MatrixCell = {
  itemId: string;
  selectedKey: string | null; // alternativa elegida (null = sin respuesta)
  isCorrect: boolean | null;
  score: number | null; // final_score si existe, si no raw_score
  /**
   * Puntaje máximo del ítem. Con ítems de crédito parcial (`matching`), un
   * `isCorrect: false` puede traer puntaje > 0: mostrar "2/4" dice mucho más que
   * "incorrecto". En los ítems binarios vale 1 y no cambia nada de lo que se ve.
   */
  maxScore: number | null;
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
  /** Resumen de la línea de referencia (nivel) del tablero maestro. */
  references: MatrixReferenceScopes;
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
  /** La alternativa ES una imagen: la vista la muestra vía /items/{id}/alternativa/{key}/figura. */
  hasImage: boolean;
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

/** Un adjunto multimedia de la sección (figura/audio/pdf) del ítem. */
export type QuestionSectionAttachment = {
  kind: string; // image | audio | pdf | other
  url: string | null; // null si aún no se sube el archivo a S3
  /** Storage key en S3 (null si aún no se sube). La vista arma la ruta de imagen con esto. */
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  note: string | null;
};

/**
 * Sección de lectura (texto base + multimedia) a la que pertenece la pregunta.
 * `null` si el ítem no cuelga de una sección con passage (ej. matemática sin
 * texto). Permite mostrar el texto de lectura en la vista de resultados.
 */
export type QuestionSection = {
  id: string;
  name: string;
  passageTitle: string | null;
  passageText: string | null;
  passageFormat: string | null; // 'plain' | 'markdown' | 'html'
  attachments: QuestionSectionAttachment[];
};

export type QuestionAnalysisResponse = {
  itemId: string;
  position: number;
  type: string; // item_type
  stem: string | null; // enunciado
  imageUrl: string | null;
  /** ¿El ítem tiene una figura asociada (archivo en `files`)? La imagen se sirve
   *  por `/items/{itemId}/figura`, no por URL en el payload (las presigned caducan). */
  hasFigure: boolean;
  explanation: string | null;
  correctKey: string | null;
  skill: ItemTaxonomyRef | null; // habilidad principal (representativo, compat)
  content: ItemTaxonomyRef | null; // contenido/OA principal (representativo, compat)
  tags: QuestionTaxonomyTag[]; // TODOS los nodos asociados a la pregunta
  section: QuestionSection | null; // texto de lectura + multimedia de la sección
  totalResponses: number; // alumnos con respuesta registrada (incluye en blanco)
  blankCount: number; // alumnos sin alternativa elegida
  correctCount: number;
  correctRate: number | null; // 0..100 sobre totalResponses
  // T2-17 — referencias comparativas de la MISMA pregunta, independientes del scope
  // del usuario (un profesor ve su curso en `correctRate` y estas referencias más
  // amplias aquí): `org` = % de logro en todo el colegio; `grade` = % de logro en el
  // nivel/grado (todos los cursos del mismo grado que rindieron la evaluación). Ambas
  // `null` sin evaluación en contexto o sin datos agregados. `sample` queda DIFERIDO.
  references: QuestionReferences;
  alternatives: AlternativeDistribution[]; // incluye la correcta y los distractores
};
