/**
 * Persistencia de los resultados de un assessment: `assessment_results` +
 * `skill_results` + el read-model de cohorte (`assessment_item_stats` /
 * `assessment_skill_stats`).
 *
 * Existe para que los DOS escritores del sistema pasen por el mismo lugar:
 *  1. `AssessmentResultsService.computeAndPersist` — recálculo desde `responses`.
 *  2. `AnswerSheetsService.confirm` — ingesta de hojas de respuesta.
 *
 * Antes (2) duplicaba delete + aggregate + insert inline. Con el read-model esa
 * duplicación deja de ser un problema de estilo y pasa a ser de corrección: si sólo
 * (1) poblara `assessment_item_stats`, cargar una hoja de respuestas dejaría el
 * read-model desincronizado y silenciosamente falso (plan §8.1).
 *
 * ⚠️ Los dos escritores DIVERGEN en la semántica del total por alumno, y la divergencia
 * se preserva a propósito vía `ResultsPersistPolicy`. Unificarla cambiaría `percentage`,
 * `grade` e `isComplete` de datos ya publicados. Ver `ANSWER_SHEET_IMPORT_POLICY`.
 *
 * `tx` debe correr dentro de `withOrgContext` (CLAUDE.md §5.2): las cuatro tablas
 * tienen RLS.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  assessmentResults,
  itemTaxonomyTags,
  items,
  recomputeCohortStatsFromResponses,
  responses,
  skillResults,
} from '@soe/db';
import {
  aggregateSkillResults,
  aggregateStudentResults,
  type GradingScaleParams,
  type PerformanceBandInput,
  type ResponseForCalculation,
  type ResponseForItemStats,
  type SkillAggregateResult,
  type StudentAggregateResult,
} from '@soe/types';
import type { Database } from '../../database/database.types';
import { toResponseForCalculation } from './result-aggregator';

/**
 * Una respuesta lista para persistir: lo que piden los agregadores por alumno
 * (`ResponseForCalculation`) y el read-model de cohorte (`ResponseForItemStats`) a la
 * vez. Los campos comunes coinciden; la intersección sólo suma `value` (el JSONB crudo,
 * para la distribución de alternativas) y `hasAlternatives`.
 *
 * Es una intersección y no una copia a mano para que cualquier campo nuevo en el
 * contrato del calculador puro rompa la compilación acá en vez de resolverse con un
 * cast que lo silencie.
 */
export type ResponseForPersist = ResponseForCalculation & ResponseForItemStats;

/**
 * Las dos divergencias reales entre los escritores. Cada flag documenta un
 * comportamiento vivo; ninguno es una preferencia.
 */
export type ResultsPersistPolicy = {
  /**
   * Excluir del total por alumno las respuestas pendientes de corrección humana/IA
   * (`isCorrect === null`) y marcar incompleto a quien tenga alguna.
   *
   * Sólo la ingesta de hojas de respuesta genera pendientes (los ítems de desarrollo
   * quedan sin puntaje, nunca en 0). Sumarían 0 al numerador pero su `maxScore`
   * inflaría el denominador, contaminando el % de los autocorregidos.
   *
   * NO aplica al read-model de cohorte: ese espeja el `GROUP BY` de `responses`, que
   * no filtra nada.
   */
  excludePendingFromStudentTotals: boolean;
  /**
   * Estampar `completed_at` aunque `isComplete` sea false.
   *
   * `answer-sheets` lo hace desde siempre (la ingesta ocurrió, con pendientes o sin
   * ellos); el recálculo desde `responses` escribe null si el alumno no está completo.
   */
  alwaysStampCompletedAt: boolean;
};

/** Recálculo desde `responses` (`AssessmentResultsService.computeAndPersist`). */
export const RECOMPUTE_FROM_RESPONSES_POLICY: ResultsPersistPolicy = {
  excludePendingFromStudentTotals: false,
  alwaysStampCompletedAt: false,
};

/** Ingesta de hojas de respuesta (`AnswerSheetsService.confirm`). */
export const ANSWER_SHEET_IMPORT_POLICY: ResultsPersistPolicy = {
  excludePendingFromStudentTotals: true,
  alwaysStampCompletedAt: true,
};

/**
 * Lee TODAS las `responses` de un assessment y las deja listas para
 * `persistAssessmentResults`.
 *
 * Existe porque `persistAssessmentResults` hace delete + reinsert POR ASSESSMENT: las
 * cuatro tablas se borran enteras y se reescriben con lo que reciben. Alimentarlo con
 * un subconjunto (p.ej. sólo las filas de la hoja recién subida) borra los resultados
 * de los cursos que ya estaban. El caso es real: `answer-sheets.confirm` permite
 * ingestar una segunda hoja contra un assessment existente, y `responses` conserva
 * ambos cursos aunque los resultados no.
 *
 * La única fuente de verdad válida para el recálculo es la tabla `responses`, ya con
 * el upsert de la subida aplicado.
 *
 * `tx` debe correr dentro de `withOrgContext` (`responses` tiene RLS).
 */
export async function loadResponsesForPersist(
  tx: Database,
  assessmentId: string,
): Promise<ResponseForPersist[]> {
  const rows = await tx
    .select({
      studentId: responses.studentId,
      itemId: responses.itemId,
      value: responses.value,
      itemContent: items.content,
      isCorrect: responses.isCorrect,
      rawScore: responses.rawScore,
      finalScore: responses.finalScore,
      maxScore: responses.maxScore,
      itemPosition: items.position,
    })
    .from(responses)
    .innerJoin(items, eq(items.id, responses.itemId))
    .where(eq(responses.assessmentId, assessmentId));

  if (rows.length === 0) return [];

  const itemIds = Array.from(new Set(rows.map((r) => r.itemId)));
  const tagRows = await tx
    .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
    .from(itemTaxonomyTags)
    .where(inArray(itemTaxonomyTags.itemId, itemIds));

  const tagsByItemId = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByItemId.get(t.itemId) ?? [];
    list.push(t.nodeId);
    tagsByItemId.set(t.itemId, list);
  }

  return toResponseForCalculation(rows, tagsByItemId);
}

export type PersistResultsInput = {
  assessmentId: string;
  /** TODAS las respuestas del assessment, incluidas las pendientes. */
  responses: readonly ResponseForPersist[];
  scale: GradingScaleParams;
  /** Bandas del instrumento (`loadInstrumentBands`). Vacío → enum legacy de 4 niveles. */
  bands: readonly PerformanceBandInput[];
  now: Date;
  policy: ResultsPersistPolicy;
};

export type PersistResultsOutput = {
  studentAggregates: StudentAggregateResult[];
  skillAggregates: SkillAggregateResult[];
};

/**
 * Recalcula y reemplaza los resultados del assessment. Delete + reinsert: ninguna de
 * las cuatro tablas tiene `deleted_at`, y el recálculo tiene que ser idempotente.
 *
 * No valida permisos ni scope — el caller ya lo hizo.
 */
export async function persistAssessmentResults(
  tx: Database,
  input: PersistResultsInput,
): Promise<PersistResultsOutput> {
  const { assessmentId, responses, scale, bands, now, policy } = input;

  const forStudentTotals = policy.excludePendingFromStudentTotals
    ? responses.filter((r) => r.isCorrect !== null)
    : responses;
  const studentsWithPending = policy.excludePendingFromStudentTotals
    ? new Set(responses.filter((r) => r.isCorrect === null).map((r) => r.studentId))
    : new Set<string>();

  const studentAggregates = aggregateStudentResults([...forStudentTotals], scale, bands).map((a) =>
    studentsWithPending.has(a.studentId) ? { ...a, isComplete: false } : a,
  );
  // El denominador ponderado de aggregateSkillResults ya excluye los pendientes por su
  // cuenta, así que acá van todas las respuestas en ambas políticas.
  const skillAggregates = aggregateSkillResults([...responses], scale, bands);

  await tx.delete(assessmentResults).where(eq(assessmentResults.assessmentId, assessmentId));
  await tx.delete(skillResults).where(eq(skillResults.assessmentId, assessmentId));

  if (studentAggregates.length > 0) {
    await tx.insert(assessmentResults).values(
      studentAggregates.map((a) => ({
        assessmentId,
        studentId: a.studentId,
        totalScore: a.totalScore.toFixed(2),
        maxScore: a.maxScore.toFixed(2),
        // Contrato del modelo: percentage es 0..100 (decimal string).
        percentage: (a.percentage * 100).toFixed(2),
        grade: a.grade.toFixed(2),
        performanceBandId: a.performanceBandId ?? null,
        performanceLevel: a.performanceLevel,
        isComplete: a.isComplete,
        completedAt: policy.alwaysStampCompletedAt ? now : a.isComplete ? now : null,
      })),
    );
  }

  if (skillAggregates.length > 0) {
    await tx.insert(skillResults).values(
      skillAggregates.map((a) => ({
        assessmentId,
        studentId: a.studentId,
        nodeId: a.nodeId,
        correctCount: a.correctCount,
        totalCount: a.totalCount,
        percentage: (a.percentage * 100).toFixed(2),
        performanceBandId: a.performanceBandId ?? null,
        performanceLevel: a.performanceLevel,
      })),
    );
  }

  await recomputeCohortStatsFromResponses(tx, {
    assessmentId,
    responses,
    skillResults: skillAggregates.map((a) => ({
      studentId: a.studentId,
      nodeId: a.nodeId,
      correctCount: a.correctCount,
      totalCount: a.totalCount,
      percentage: a.percentage,
    })),
  });

  return { studentAggregates, skillAggregates };
}
