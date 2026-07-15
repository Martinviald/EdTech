/**
 * Calculador puro del read-model de cohorte (`assessment_item_stats` /
 * `assessment_skill_stats`).
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md.
 *
 * Hermano de `grade-calculator.ts` y con el mismo contrato: función pura, todos los
 * datos llegan por parámetro, cero acceso a DB. Existe para que la agregación por
 * cohorte se escriba UNA sola vez y la usen los dos escritores:
 *  1. el cálculo desde `responses` (assessment-results + answer-sheets), y
 *  2. el importador de informes oficiales DIA (que no tiene respuestas por alumno).
 *
 * ⚠️ Este archivo congela dos detalles semánticos del motor actual. Si divergen, la
 * paridad con el `GROUP BY` histórico se rompe en silencio:
 *  · Precedencia de la alternativa elegida: `value.raw ?? value.key ?? value.answer`,
 *    string vacío → null. Hoy está duplicada en `item-analysis.service.ts` entre
 *    `extractRawAnswer` (TS) y el `coalesce` de `loadAnswerDistribution` (SQL), con un
 *    comentario que pide explícitamente que coincidan. Acá deja de estar duplicada.
 *  · `isCorrect` de un bucket es el de la FILA de respuesta (`coalesce(is_correct,false)`),
 *    no el de la definición de la alternativa. La UI decide el `isCorrect` presentable
 *    aparte, con `correctKey ?? alt.isCorrect`.
 */

/**
 * Un bucket de la distribución de respuestas de un ítem. `key: null` = blanco/nulo
 * (la opción "N — No responde" del informe oficial).
 *
 * En ítems de selección múltiple la clave es la alternativa marcada ('A', 'B', …).
 * En ítems de desarrollo es la categoría por puntaje ('RC' | 'RPC' | 'RI'), que son
 * las mismas claves que usa el informe oficial DIA. Así los dos escritores emiten un
 * único tipo de dato y el read-model sirve ambos tipos de ítem sin ramificar.
 */
export type AnswerCount = {
  key: string | null;
  count: number;
  isCorrect: boolean;
};

/** Categorías de un ítem de desarrollo. `null` (no responde) se emite como `key: null`. */
export const DEVELOPMENT_BUCKETS = ['RC', 'RPC', 'RI'] as const;
export type DevelopmentBucket = (typeof DEVELOPMENT_BUCKETS)[number];

/** Una respuesta cruda, tal como sale de `responses` ⋈ `items`. */
export type ResponseForItemStats = {
  studentId: string;
  itemId: string;
  /** El JSONB `responses.value` crudo, sin interpretar. */
  value: Record<string, unknown> | null | undefined;
  isCorrect: boolean | null;
  rawScore: number | null;
  /** `finalScore` tiene precedencia sobre `rawScore` (CLAUDE.md §8.3). */
  finalScore?: number | null;
  maxScore: number;
  /**
   * ¿El ítem ofrece alternativas (selección múltiple)?
   *
   * Necesario y no derivable de `value`: un ítem de desarrollo y una respuesta MC en
   * blanco producen ambos `extractRawAnswer → null`, y sin distinguirlos todo el
   * desarrollo colapsaría en un solo bucket de blancos, perdiendo RC/RPC/RI. El
   * caller lo resuelve con `Array.isArray(items.content.alternatives) && length > 0`.
   */
  hasAlternatives: boolean;
};

/** Una fila del read-model por (curso × ítem). Conteos, nunca porcentajes. */
export type ItemCohortStats = {
  classGroupId: string;
  itemId: string;
  studentCount: number;
  responseCount: number;
  correctCount: number;
  answerCounts: AnswerCount[];
  scoreSum: number;
  maxSum: number;
};

/** Una fila del read-model por (curso × habilidad). */
export type SkillCohortStats = {
  classGroupId: string;
  nodeId: string;
  studentCount: number;
  correctCount: number;
  totalCount: number;
  /** 0..1. Ojo: la definición depende del origen — ver `aggregateCohortSkillStats`. */
  percentage: number | null;
};

/** `skill_results` de un alumno, para agregar a cohorte. */
export type SkillResultForCohort = {
  studentId: string;
  nodeId: string;
  correctCount: number;
  totalCount: number;
  /** 0..1 */
  percentage: number | null;
};

/**
 * Extrae la alternativa elegida del JSONB `value`.
 *
 * Réplica exacta de `nullif(coalesce(value->>'raw', value->>'key', value->>'answer'), '')`.
 * `->>` castea a texto, por eso los no-string pasan por `String()`. `??` cae al
 * siguiente campo tanto con `null` como con `undefined`, igual que `coalesce` sobre
 * una clave ausente o un JSON null.
 */
export function extractRawAnswer(value: Record<string, unknown> | null | undefined): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value.raw ?? value.key ?? value.answer;
  if (raw == null) return null;
  const str = typeof raw === 'string' ? raw : String(raw);
  return str.length > 0 ? str : null;
}

/** Score efectivo: `finalScore` gana sobre `rawScore`; ambos null → 0. */
function effectiveScore(r: Pick<ResponseForItemStats, 'finalScore' | 'rawScore'>): number {
  if (r.finalScore != null) return r.finalScore;
  if (r.rawScore != null) return r.rawScore;
  return 0;
}

/**
 * Categoriza la respuesta a un ítem de desarrollo por su puntaje.
 *
 * Réplica exacta del `case` SQL de `loadDevelopmentDistributions`:
 *   score is null → N (acá `null`) · <= 0 → RI · >= max → RC · resto → RPC.
 * El orden importa: un ítem con maxScore 0 caería en RC, igual que hoy.
 */
export function classifyDevelopmentResponse(
  r: Pick<ResponseForItemStats, 'finalScore' | 'rawScore' | 'maxScore'>,
): DevelopmentBucket | null {
  const score = r.finalScore ?? r.rawScore;
  if (score == null) return null;
  if (score <= 0) return 'RI';
  if (score >= r.maxScore) return 'RC';
  return 'RPC';
}

/**
 * Clave del bucket de una respuesta: la alternativa marcada en selección múltiple,
 * o la categoría por puntaje en desarrollo.
 */
function bucketKeyFor(r: ResponseForItemStats): string | null {
  return r.hasAlternatives ? extractRawAnswer(r.value) : classifyDevelopmentResponse(r);
}

/**
 * Recombina distribuciones de varias cohortes en una sola.
 *
 * ⚠️ Suma conteos; NUNCA promedia porcentajes. Dos cursos de N distinto promediados
 * dan un número que no corresponde a ninguna población real. Los porcentajes se
 * recalculan al final sobre el total ya recombinado.
 *
 * Vive acá y no en cada lector porque es la primitiva que usan tanto `item-analysis`
 * como `official-reports`: tenerla dos veces es exactamente la duplicación que este
 * read-model vino a matar.
 */
export function mergeAnswerCounts(buckets: readonly AnswerCount[][]): AnswerCount[] {
  const acc = new Map<string, AnswerCount>();
  for (const list of buckets) {
    for (const b of list) {
      const k = JSON.stringify([b.key, b.isCorrect]);
      const prev = acc.get(k);
      if (prev) prev.count += b.count;
      else acc.set(k, { key: b.key, count: b.count, isCorrect: b.isCorrect });
    }
  }
  return sortAnswerCounts([...acc.values()]);
}

/**
 * Agrega respuestas crudas al read-model por (curso × ítem).
 *
 * `enrollment` mapea alumno → curso y DEBE construirse desde `student_enrollments`,
 * no desde `assessment_course_assignments`: es el mismo camino que usa
 * `resolveAccessibleStudentIds` para resolver el scope, y usar otro movería alumnos
 * de bucket. Las respuestas de alumnos ausentes del mapa se descartan (no se les
 * puede asignar cohorte).
 *
 * `studentCount` es el N de la cohorte: alumnos distintos del curso presentes en el
 * set de respuestas. Es constante entre los ítems de un mismo curso, igual que el
 * "Cantidad de estudiantes que considera este informe" del PDF oficial.
 *
 * `responseCount` es el número de filas de respuesta del ítem, que es el denominador
 * del `correctRate` actual e incluye los blancos. Puede ser menor que `studentCount`
 * si un alumno no tiene fila para ese ítem.
 */
export function aggregateItemStats(
  responses: readonly ResponseForItemStats[],
  enrollment: ReadonlyMap<string, string>,
): ItemCohortStats[] {
  // (classGroupId, itemId) → acumulador
  const acc = new Map<
    string,
    {
      classGroupId: string;
      itemId: string;
      students: Set<string>;
      responseCount: number;
      correctCount: number;
      // (key, isCorrect) → count. Espeja el `group by answer, is_correct` del SQL:
      // una misma clave puede aparecer con is_correct distinto si el dato es
      // inconsistente, y no lo ocultamos.
      buckets: Map<string, { key: string | null; isCorrect: boolean; count: number }>;
      scoreSum: number;
      maxSum: number;
    }
  >();
  // classGroupId → alumnos distintos del curso en todo el set (el N de la cohorte).
  const cohort = new Map<string, Set<string>>();

  for (const r of responses) {
    const classGroupId = enrollment.get(r.studentId);
    if (classGroupId == null) continue;

    let students = cohort.get(classGroupId);
    if (!students) {
      students = new Set();
      cohort.set(classGroupId, students);
    }
    students.add(r.studentId);

    const cellKey = `${classGroupId}__${r.itemId}`;
    let cell = acc.get(cellKey);
    if (!cell) {
      cell = {
        classGroupId,
        itemId: r.itemId,
        students: new Set(),
        responseCount: 0,
        correctCount: 0,
        buckets: new Map(),
        scoreSum: 0,
        maxSum: 0,
      };
      acc.set(cellKey, cell);
    }

    const answer = bucketKeyFor(r);
    const isCorrect = r.isCorrect === true;

    cell.students.add(r.studentId);
    cell.responseCount += 1;
    if (isCorrect) cell.correctCount += 1;
    cell.scoreSum += effectiveScore(r);
    cell.maxSum += r.maxScore;

    // JSON.stringify y no una plantilla: distingue sin ambigüedad el blanco (null)
    // de un alumno que respondió literalmente el texto "null", y evita inventar un
    // separador que alguna clave pudiera contener.
    const bucketKey = JSON.stringify([answer, isCorrect]);
    const bucket = cell.buckets.get(bucketKey);
    if (bucket) bucket.count += 1;
    else cell.buckets.set(bucketKey, { key: answer, isCorrect, count: 1 });
  }

  return [...acc.values()].map((cell) => ({
    classGroupId: cell.classGroupId,
    itemId: cell.itemId,
    studentCount: cohort.get(cell.classGroupId)?.size ?? cell.students.size,
    responseCount: cell.responseCount,
    correctCount: cell.correctCount,
    answerCounts: sortAnswerCounts([...cell.buckets.values()]),
    scoreSum: round2(cell.scoreSum),
    maxSum: round2(cell.maxSum),
  }));
}

/**
 * Agrega `skill_results` por alumno al read-model por (curso × habilidad).
 *
 * ⚠️ `percentage` = **media de los porcentajes por alumno** (`source='computed'`).
 * Se conserva esta definición deliberadamente (decisión §9.2 del plan) para que los
 * números que los dashboards y el heatmap ya muestran NO cambien con el refactor.
 * Es distinta de la tasa agrupada que usa `deriveSkillStatsFromItemStats` para los
 * informes importados; coinciden cuando todos los alumnos responden todos los ítems.
 */
export function aggregateCohortSkillStats(
  skillResults: readonly SkillResultForCohort[],
  enrollment: ReadonlyMap<string, string>,
): SkillCohortStats[] {
  const acc = new Map<
    string,
    {
      classGroupId: string;
      nodeId: string;
      students: Set<string>;
      correctCount: number;
      totalCount: number;
      pctSum: number;
      pctCount: number;
    }
  >();

  for (const sr of skillResults) {
    const classGroupId = enrollment.get(sr.studentId);
    if (classGroupId == null) continue;

    const key = `${classGroupId}__${sr.nodeId}`;
    let cell = acc.get(key);
    if (!cell) {
      cell = {
        classGroupId,
        nodeId: sr.nodeId,
        students: new Set(),
        correctCount: 0,
        totalCount: 0,
        pctSum: 0,
        pctCount: 0,
      };
      acc.set(key, cell);
    }
    cell.students.add(sr.studentId);
    cell.correctCount += sr.correctCount;
    cell.totalCount += sr.totalCount;
    if (sr.percentage != null) {
      cell.pctSum += sr.percentage;
      cell.pctCount += 1;
    }
  }

  return [...acc.values()].map((cell) => ({
    classGroupId: cell.classGroupId,
    nodeId: cell.nodeId,
    studentCount: cell.students.size,
    correctCount: cell.correctCount,
    totalCount: cell.totalCount,
    percentage: cell.pctCount > 0 ? cell.pctSum / cell.pctCount : null,
  }));
}

/**
 * Deriva el read-model por habilidad desde el de ítems (`source='imported'`).
 *
 * `percentage` = **tasa agrupada ponderada por puntaje** (`scoreSum / maxSum`), que es
 * la definición del propio DIA: reproduce el "% promedio de respuestas correctas del
 * curso por eje" del informe oficial con error < 0.01 pp, incluyendo el crédito
 * parcial de las preguntas de desarrollo (RPC = 0.5 punto).
 *
 * Un ítem etiquetado con N nodos suma a los N (misma expansión que `aggregateSkillResults`).
 */
export function deriveSkillStatsFromItemStats(
  itemStats: readonly ItemCohortStats[],
  tagsByItem: ReadonlyMap<string, readonly string[]>,
): SkillCohortStats[] {
  const acc = new Map<
    string,
    {
      classGroupId: string;
      nodeId: string;
      studentCount: number;
      correctCount: number;
      totalCount: number;
      scoreSum: number;
      maxSum: number;
    }
  >();

  for (const st of itemStats) {
    const nodeIds = tagsByItem.get(st.itemId);
    if (!nodeIds || nodeIds.length === 0) continue;

    for (const nodeId of nodeIds) {
      const key = `${st.classGroupId}__${nodeId}`;
      let cell = acc.get(key);
      if (!cell) {
        cell = {
          classGroupId: st.classGroupId,
          nodeId,
          studentCount: st.studentCount,
          correctCount: 0,
          totalCount: 0,
          scoreSum: 0,
          maxSum: 0,
        };
        acc.set(key, cell);
      }
      cell.studentCount = Math.max(cell.studentCount, st.studentCount);
      cell.correctCount += st.correctCount;
      cell.totalCount += st.responseCount;
      cell.scoreSum += st.scoreSum;
      cell.maxSum += st.maxSum;
    }
  }

  return [...acc.values()].map((cell) => ({
    classGroupId: cell.classGroupId,
    nodeId: cell.nodeId,
    studentCount: cell.studentCount,
    correctCount: cell.correctCount,
    totalCount: cell.totalCount,
    percentage: cell.maxSum > 0 ? cell.scoreSum / cell.maxSum : null,
  }));
}

/**
 * Reconstruye conteos enteros desde los porcentajes de un informe oficial.
 *
 * El PDF entrega porcentajes con 2 decimales y el N del curso. `round(pct/100 * N)`
 * recupera el conteo exacto: verificado contra el informe de 3°A Cierre 2025 (N=43)
 * en preguntas de selección múltiple y de desarrollo — los conteos reconstruidos
 * suman exactamente N en todos los casos.
 *
 * Que la suma dé N es la validación de integridad dura del importador: si no cuadra,
 * el informe está mal leído y se rechaza. Por eso esto devuelve los conteos y el
 * caller compara; no "arregla" la diferencia repartiéndola.
 */
export function reconstructCountsFromPercentages(
  percentages: readonly number[],
  studentCount: number,
): number[] {
  return percentages.map((pct) => Math.round((pct / 100) * studentCount));
}

/** Orden estable: los blancos al final, el resto por clave. Facilita comparar y testear. */
function sortAnswerCounts(buckets: AnswerCount[]): AnswerCount[] {
  return [...buckets].sort((a, b) => {
    if (a.key === null && b.key === null) return 0;
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return a.key.localeCompare(b.key);
  });
}

/** Los decimales de la DB son (9,2); redondear acá evita ruido de coma flotante. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
