/**
 * Tipos de los goldsets de calibración del motor de decisiones.
 *
 * Los escribe `extract-goldsets.ts` (lectura de la BDD local) y los consume
 * `run-calibration.ts`. Solo contenido de ítems y taxonomía: NUNCA datos de
 * alumnos (ni nombres, ni RUT, ni respuestas).
 */

/** Veredicto del juez LLM tal como quedó en `remedial_materials.quality_report`. */
export interface StoredJudgeVerdict {
  answerable: boolean;
  derivedAnswer: string | null;
  uniqueCorrect: boolean;
  factual: boolean;
  skillMatch: boolean;
}

export interface GoldAlternative {
  key: string;
  text: string;
  isCorrect: boolean;
}

/** Un ítem del goldset del juez remedial. */
export interface RemedialGoldItem {
  itemId: string;
  /**
   * `remedial`: ítem generado por el motor remedial (con veredicto del juez LLM).
   * `bank`: ítem del banco (oficial/importado) que completa el set; sin veredicto.
   */
  origin: 'remedial' | 'bank';
  /** Código de asignatura (`LANG`, `MATH`, `HIST`, `SCI`) o `null` si no se pudo resolver. */
  subjectCode: string | null;
  isMath: boolean;
  /** Nombre del instrumento (banco) o id del material remedial (remedial). */
  sourceLabel: string;
  stimulus: { title: string | null; text: string } | null;
  stem: string;
  alternatives: GoldAlternative[];
  /** Verdad para la pregunta `clave`: la alternativa con `isCorrect`. */
  correctKey: string;
  /** Habilidad declarada (skillFocus del material o tag humano de tipo `skill`). */
  declaredSkill: string | null;
  judgeVerdict: StoredJudgeVerdict | null;
}

/** Nodo de un árbol de taxonomía (forma de `DecisionTreeNode` del paquete). */
export interface GoldTreeNode {
  /** `code` del nodo si existe (más legible para el modelo), si no el uuid. */
  id: string;
  label: string;
  description?: string;
  children?: GoldTreeNode[];
}

/**
 * Una "dimensión" de taxonomía: el bosque podado a los caminos que terminan en
 * nodos de un tipo (p. ej. `mineduc` + `learning_objective`). Se colapsan las
 * raíces únicas (una Choice de una sola opción no aporta nada).
 */
export interface GoldDimension {
  key: string;
  taxonomyType: string;
  taxonomyName: string;
  leafType: string;
  /** Etiquetas de los nodos colapsados por encima del bosque (contexto, no se pregunta). */
  collapsedPrefix: string[];
  tree: GoldTreeNode[];
  /** id → ids de sus ancestros (para medir aciertos parciales). */
  ancestors: Record<string, string[]>;
}

export interface TaxonomyGoldTask {
  /** Dimensión (`GoldDimension.key`) sobre la que se desciende. */
  dimension: string;
  /** Ids (en el espacio de `GoldTreeNode.id`) de los tags humanos del ítem en esta dimensión. */
  goldNodeIds: string[];
}

export interface TaxonomyGoldItem {
  itemId: string;
  subjectCode: string | null;
  isMath: boolean;
  instrumentName: string;
  gradeName: string | null;
  subjectName: string | null;
  stimulus: { title: string | null; text: string } | null;
  stem: string;
  alternatives: { key: string; text: string }[];
  tasks: TaxonomyGoldTask[];
}

export interface RemedialGoldset {
  generatedAt: string;
  database: string;
  items: RemedialGoldItem[];
}

export interface TaxonomyGoldset {
  generatedAt: string;
  database: string;
  dimensions: GoldDimension[];
  items: TaxonomyGoldItem[];
}
