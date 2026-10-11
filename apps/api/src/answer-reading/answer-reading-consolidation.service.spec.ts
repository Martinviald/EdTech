jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { fakeOutput, normalizeTranscription } from '@soe/answer-reading';
import {
  answerReadingDecisions,
  answerReadings,
  items,
  printedSheets,
  responses,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  type AnswerReadingDecision,
  type Response,
} from '@soe/db';
import {
  getScoringStrategy,
  type ItemContent,
  type NormalizedAnswer,
  type ResponseFormat,
} from '@soe/types';
import type { AssessmentResultsService } from '../assessment-results/assessment-results.service';
import { AnswerReadingConsolidationService } from './answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import { consolidationDatabase } from './testing/consolidation-sql';
import { InMemoryDatabase } from './testing/in-memory-database';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const PRINT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const ASSESSMENT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ASSESSMENT_ID = '44444444-4444-4444-8444-444444444445';
const STUDENT_ID = '55555555-5555-4555-8555-555555555555';
const REVIEWER_ID = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '77777777-7777-4777-8777-777777777777';
const SCAN_ID = '88888888-8888-4888-8888-888888888888';
const SHEET_ID = '99999999-9999-4999-8999-999999999999';
const NUMBER_ITEM = 'aaaaaaaa-0000-4000-8000-000000000001';
const WORDS_ITEM = 'aaaaaaaa-0000-4000-8000-000000000002';
const OPEN_ITEM = 'aaaaaaaa-0000-4000-8000-000000000003';
const MARK_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const MARK_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const MARK_C = 'bbbbbbbb-0000-4000-8000-000000000003';
const READING_HAIKU = 'cccccccc-0000-4000-8000-000000000001';
const READING_FLASH = 'cccccccc-0000-4000-8000-000000000002';
const RESPONSE_A = 'dddddddd-0000-4000-8000-000000000001';
const RESPONSE_B = 'dddddddd-0000-4000-8000-000000000002';

const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 3, allowNegative: false };
const WORDS: ResponseFormat = { kind: 'word_list', count: 3 };

function answer(literal: string, format: ResponseFormat): NormalizedAnswer {
  return normalizeTranscription(fakeOutput(literal), format);
}

function blankAnswer(format: ResponseFormat): NormalizedAnswer {
  return normalizeTranscription(fakeOutput('', { state: 'blank' }), format);
}

function setup() {
  const memory = new InMemoryDatabase();
  memory.seed(items, [
    {
      id: NUMBER_ITEM,
      type: 'short_answer',
      content: { prompt: '¿Cuántos lados?', acceptedAnswers: ['7'] },
      scoringConfig: { points: 1 },
    },
    {
      id: WORDS_ITEM,
      type: 'short_answer',
      content: { prompt: 'Partes del insecto', acceptedAnswers: ['Cabeza, tórax, abdomen'] },
      scoringConfig: { points: 2 },
    },
    {
      id: OPEN_ITEM,
      type: 'open_ended',
      content: { prompt: 'Explica' },
      scoringConfig: { points: 2 },
    },
  ]);
  memory.seed(answerReadings, [
    {
      id: READING_HAIKU,
      orgId: ORG_ID,
      confidence: '0.930',
      model: 'claude-haiku',
      promptRef: 'transcribe.short-answer@2',
    },
    {
      id: READING_FLASH,
      orgId: ORG_ID,
      confidence: '0.880',
      model: 'gemini-flash',
      promptRef: 'transcribe.short-answer@2',
    },
  ]);

  const { db, statements } = consolidationDatabase(memory);

  const decisions = new AnswerReadingDecisionsService(db);
  const recalculate = jest.fn(async (_orgId: string, assessmentIds: readonly string[]) => [
    ...new Set(assessmentIds),
  ]);
  const results = {
    recalculateAnswerSheetResults: recalculate,
  } as unknown as AssessmentResultsService;
  const service = new AnswerReadingConsolidationService(db, decisions, results);
  return { memory, service, decisions, recalculate, statements };
}

function seedDecision(memory: InMemoryDatabase, overrides: Partial<AnswerReadingDecision>) {
  const value = overrides.value ?? null;
  memory.seed(answerReadingDecisions, [
    {
      orgId: ORG_ID,
      runId: RUN_ID,
      markId: MARK_A,
      itemId: NUMBER_ITEM,
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      outcome: 'auto_accepted',
      canonical: value?.canonical ?? null,
      reasons: [],
      policyId: 'short-answer-default',
      policyVersion: 1,
      usedReadingIds: [READING_HAIKU, READING_FLASH],
      ...overrides,
    },
  ]);
  const rows = memory.rows<AnswerReadingDecision>(answerReadingDecisions);
  return rows[rows.length - 1] as AnswerReadingDecision;
}

function seedResponse(memory: InMemoryDatabase, overrides: Partial<Response>) {
  memory.seed(responses, [
    {
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      itemId: NUMBER_ITEM,
      value: { answer: null, pendingReading: true },
      isCorrect: null,
      rawScore: null,
      maxScore: '1.00',
      finalScore: null,
      scoredBy: 'human',
      aiScore: null,
      humanScore: null,
      ...overrides,
    },
  ]);
  const rows = memory.rows<Response>(responses);
  return rows[rows.length - 1] as Response;
}

function seedConfirmedBatch(memory: InMemoryDatabase, status = 'confirmed') {
  memory.seed(sheetScanBatches, [
    { id: BATCH_ID, orgId: ORG_ID, printRunId: PRINT_RUN_ID, status },
  ]);
  memory.seed(sheetPrintRuns, [{ id: PRINT_RUN_ID, orgId: ORG_ID, assessmentId: ASSESSMENT_ID }]);
  memory.seed(printedSheets, [
    { id: SHEET_ID, orgId: ORG_ID, printRunId: PRINT_RUN_ID, studentId: STUDENT_ID, sequence: 1 },
  ]);
  memory.seed(sheetScans, [
    {
      id: SCAN_ID,
      orgId: ORG_ID,
      batchId: BATCH_ID,
      state: 'read',
      resolvedStudentId: null,
      printedSheetId: SHEET_ID,
    },
  ]);
  memory.seed(sheetScanMarks, [{ id: MARK_A, orgId: ORG_ID, scanId: SCAN_ID }]);
}

function currentDecisionOf(memory: InMemoryDatabase, markId = MARK_A) {
  const current = memory
    .rows<AnswerReadingDecision>(answerReadingDecisions)
    .filter((row) => row.markId === markId && row.supersededById === null);
  expect(current).toHaveLength(1);
  return current[0] as AnswerReadingDecision;
}

function batchDecisions(rows: AnswerReadingDecision[]) {
  return new Map(rows.map((row) => [row.markId, row]));
}

describe('AnswerReadingConsolidationService.readingsForConfirmation', () => {
  it('auto_accepted se corrige con la estrategia del ítem y deja la evidencia de los lectores', async () => {
    const { memory, service, decisions } = setup();
    const decision = seedDecision(memory, { value: answer('7', INTEGER) });
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

    const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

    expect(readings.get(MARK_A)).toEqual({
      decisionId: decision.id,
      itemId: NUMBER_ITEM,
      prescored: {
        itemId: NUMBER_ITEM,
        value: { answer: '7', reading: { canonical: decision.canonical, decisionId: decision.id } },
        isCorrect: true,
        rawScore: 1,
        scoredBy: 'ai',
        aiScore: {
          score: 1,
          confidence: 0.88,
          model: 'claude-haiku+gemini-flash',
          promptVersion: 'transcribe.short-answer@2',
          decisionId: decision.id,
        },
      },
    });
  });

  it('una lectura incorrecta autoaceptada se corrige en 0 con scored_by ai', async () => {
    const { memory, service, decisions } = setup();
    const decision = seedDecision(memory, { value: answer('9', INTEGER) });
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

    const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

    expect(readings.get(MARK_A)?.prescored).toMatchObject({
      isCorrect: false,
      rawScore: 0,
      scoredBy: 'ai',
    });
  });

  it('auto_blank queda en 0, incorrecta y corregida automáticamente, sin ai_score', async () => {
    const { memory, service, decisions } = setup();
    const decision = seedDecision(memory, {
      outcome: 'auto_blank',
      value: blankAnswer(INTEGER),
      usedReadingIds: [],
    });
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

    const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

    expect(readings.get(MARK_A)?.prescored).toEqual({
      itemId: NUMBER_ITEM,
      value: { answer: null, reading: { canonical: null, decisionId: decision.id } },
      isCorrect: false,
      rawScore: 0,
      scoredBy: 'auto',
      aiScore: null,
    });
  });

  it.each(['needs_review', 'not_read'] as const)(
    '%s queda pendiente (sin corrección), nunca en 0',
    async (outcome) => {
      const { memory, service, decisions } = setup();
      const decision = seedDecision(memory, { outcome, value: answer('7', INTEGER) });
      jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

      const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

      expect(readings.get(MARK_A)).toEqual({
        decisionId: decision.id,
        itemId: NUMBER_ITEM,
        prescored: null,
      });
    },
  );

  it('si la estrategia no puede decidir, la autoaceptada pasa a revisión con una decisión nueva', async () => {
    const { memory, service, decisions } = setup();
    const decision = seedDecision(memory, { itemId: OPEN_ITEM, value: answer('7', INTEGER) });
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

    const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

    const confirmation = readings.get(MARK_A);
    expect(confirmation?.prescored).toBeNull();
    expect(confirmation?.decisionId).not.toBe(decision.id);
    expect(decision.supersededById).toBe(confirmation?.decisionId);
    expect(currentDecisionOf(memory)).toMatchObject({
      id: confirmation?.decisionId,
      outcome: 'needs_review',
      reasons: ['undecidable'],
      reviewMode: 'grading',
      scoringOutcome: 'undecidable',
      canonical: decision.canonical,
      usedReadingIds: decision.usedReadingIds,
    });
  });

  it('aplica el formato derivado del ítem: una lista con falta de ortografía va a revisión, no a incorrecta', async () => {
    const { memory, service, decisions } = setup();
    const misspelled = answer('cabeza, torax, abdomem', WORDS);
    const withoutFormat = getScoringStrategy('short_answer').score({
      item: {
        id: WORDS_ITEM,
        type: 'short_answer',
        content: {
          prompt: 'Partes del insecto',
          acceptedAnswers: ['Cabeza, tórax, abdomen'],
        } as ItemContent,
        maxScore: 2,
      },
      rawAnswer: 'cabeza, torax, abdomem',
    });
    expect(withoutFormat.isCorrect).toBe(false);
    const decision = seedDecision(memory, { itemId: WORDS_ITEM, value: misspelled });
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

    const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

    expect(readings.get(MARK_A)?.prescored).toBeNull();
    expect(currentDecisionOf(memory)).toMatchObject({
      outcome: 'needs_review',
      reasons: ['undecidable'],
    });
  });

  it('con el formato derivado una lista bien escrita sale correcta con el puntaje del ítem', async () => {
    const { memory, service, decisions } = setup();
    const decision = seedDecision(memory, {
      itemId: WORDS_ITEM,
      value: answer('cabeza, torax, abdomen', WORDS),
    });
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(batchDecisions([decision]));

    const readings = await service.readingsForConfirmation(ORG_ID, BATCH_ID);

    expect(readings.get(MARK_A)?.prescored).toMatchObject({ isCorrect: true, rawScore: 2 });
  });

  it('sin decisiones en el lote no consulta ítems ni lecturas', async () => {
    const { service, decisions } = setup();
    jest.spyOn(decisions, 'findCurrentByBatch').mockResolvedValue(new Map());

    await expect(service.readingsForConfirmation(ORG_ID, BATCH_ID)).resolves.toEqual(new Map());
  });
});

describe('AnswerReadingConsolidationService.linkConfirmedResponses', () => {
  it('vincula cada decisión con su respuesta y solo marca resuelta la que quedó corregida', async () => {
    const { memory, service, recalculate } = setup();
    const scored = seedDecision(memory, { value: answer('7', INTEGER) });
    const pending = seedDecision(memory, {
      markId: MARK_B,
      itemId: WORDS_ITEM,
      outcome: 'needs_review',
      value: answer('cabeza', WORDS),
    });
    const scoredResponse = seedResponse(memory, {
      id: RESPONSE_A,
      finalScore: '1.00',
      isCorrect: true,
    });
    const pendingResponse = seedResponse(memory, { id: RESPONSE_B, itemId: WORDS_ITEM });

    const report = await service.linkConfirmedResponses(ORG_ID, {
      assessmentId: ASSESSMENT_ID,
      links: [
        { decisionId: scored.id, studentId: STUDENT_ID, itemId: NUMBER_ITEM, consolidated: true },
        { decisionId: pending.id, studentId: STUDENT_ID, itemId: WORDS_ITEM, consolidated: false },
      ],
      cropMarkIds: [MARK_A, MARK_B],
    });

    expect(report).toBeNull();
    expect(scored.responseId).toBe(scoredResponse.id);
    expect(scored.resolvedAt).toBeInstanceOf(Date);
    expect(pending.responseId).toBe(pendingResponse.id);
    expect(pending.resolvedAt).toBeNull();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it('consolida la decisión que reemplazó a la leída durante la confirmación', async () => {
    const { memory, service, recalculate } = setup();
    const read = seedDecision(memory, {
      outcome: 'needs_review',
      value: answer('7', INTEGER),
    });
    const response = seedResponse(memory, { id: RESPONSE_A });
    const newer = seedDecision(memory, { value: answer('7', INTEGER) });
    read.supersededById = newer.id;

    const report = await service.linkConfirmedResponses(ORG_ID, {
      assessmentId: ASSESSMENT_ID,
      links: [
        { decisionId: read.id, studentId: STUDENT_ID, itemId: NUMBER_ITEM, consolidated: false },
      ],
      cropMarkIds: [MARK_A],
    });

    expect(report?.scored).toEqual([newer.id]);
    expect(response).toMatchObject({ finalScore: '1.00', isCorrect: true, scoredBy: 'ai' });
    expect(newer.responseId).toBe(response.id);
    expect(recalculate).toHaveBeenCalledTimes(1);
  });
});

describe('AnswerReadingConsolidationService.consolidateDecisions', () => {
  it('una lectura tardía autoaceptada corrige la respuesta pendiente y recalcula la evaluación', async () => {
    const { memory, service, recalculate } = setup();
    const response = seedResponse(memory, { id: RESPONSE_A });
    const decision = seedDecision(memory, {
      value: answer('7', INTEGER),
      responseId: RESPONSE_A,
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report).toEqual({
      scored: [decision.id],
      pending: [],
      skipped: [],
      recalculatedAssessmentIds: [ASSESSMENT_ID],
    });
    expect(response).toMatchObject({
      isCorrect: true,
      rawScore: '1.00',
      finalScore: '1.00',
      scoredBy: 'ai',
      humanScore: null,
      value: { answer: '7', reading: { canonical: decision.canonical, decisionId: decision.id } },
    });
    expect(response.aiScore).toMatchObject({ score: 1, confidence: 0.88, decisionId: decision.id });
    expect(response.scoredAt).toBeInstanceOf(Date);
    expect(decision.resolvedAt).toBeInstanceOf(Date);
    expect(recalculate).toHaveBeenCalledWith(ORG_ID, [ASSESSMENT_ID]);
  });

  it('nunca pisa un human_score: la decisión queda como evidencia y se informa', async () => {
    const { memory, service, recalculate } = setup();
    const human = { score: 0, scoredById: REVIEWER_ID, overrideReason: 'revisado' };
    const response = seedResponse(memory, {
      id: RESPONSE_A,
      humanScore: human,
      finalScore: '0.00',
      isCorrect: false,
    });
    const decision = seedDecision(memory, { value: answer('7', INTEGER) });
    seedDecision(memory, {
      value: answer('9', INTEGER),
      responseId: RESPONSE_A,
      supersededById: decision.id,
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.skipped).toEqual([{ decisionId: decision.id, reason: 'human_scored' }]);
    expect(report.scored).toEqual([]);
    expect(response).toMatchObject({ humanScore: human, finalScore: '0.00', isCorrect: false });
    expect(decision.responseId).toBe(RESPONSE_A);
    expect(decision.resolvedAt).toBeNull();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it('una decisión nueva sin vínculo hereda la respuesta de la decisión anterior de la marca', async () => {
    const { memory, service } = setup();
    const response = seedResponse(memory, { id: RESPONSE_A });
    const decision = seedDecision(memory, { value: answer('7', INTEGER) });
    seedDecision(memory, {
      outcome: 'needs_review',
      value: answer('7', INTEGER),
      responseId: RESPONSE_A,
      supersededById: decision.id,
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.scored).toEqual([decision.id]);
    expect(response.finalScore).toBe('1.00');
    expect(decision.responseId).toBe(RESPONSE_A);
  });

  it('sin vínculos previos encuentra la respuesta por la hoja de un lote confirmado', async () => {
    const { memory, service } = setup();
    seedConfirmedBatch(memory);
    const response = seedResponse(memory, { id: RESPONSE_A });
    seedResponse(memory, { id: RESPONSE_B, assessmentId: OTHER_ASSESSMENT_ID });
    const decision = seedDecision(memory, { value: answer('7', INTEGER) });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.scored).toEqual([decision.id]);
    expect(response.finalScore).toBe('1.00');
    expect(decision.responseId).toBe(RESPONSE_A);
  });

  it('con el lote todavía en revisión no toca ninguna respuesta', async () => {
    const { memory, service } = setup();
    seedConfirmedBatch(memory, 'needs_review');
    const response = seedResponse(memory, { id: RESPONSE_A });
    const decision = seedDecision(memory, { value: answer('7', INTEGER) });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.skipped).toEqual([{ decisionId: decision.id, reason: 'no_response' }]);
    expect(response.finalScore).toBeNull();
  });

  it('una decisión reemplazada no se consolida', async () => {
    const { memory, service } = setup();
    seedResponse(memory, { id: RESPONSE_A });
    const decision = seedDecision(memory, {
      value: answer('7', INTEGER),
      responseId: RESPONSE_A,
      supersededById: 'eeeeeeee-0000-4000-8000-000000000001',
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.skipped).toEqual([{ decisionId: decision.id, reason: 'not_current' }]);
  });

  it('si la decisión vigente pasa a revisión, la respuesta vuelve a pendiente y conserva el ai_score', async () => {
    const { memory, service } = setup();
    const aiScore = { score: 1, confidence: 0.9, decisionId: 'previa' };
    const response = seedResponse(memory, {
      id: RESPONSE_A,
      isCorrect: true,
      rawScore: '1.00',
      finalScore: '1.00',
      scoredBy: 'ai',
      aiScore,
    });
    const decision = seedDecision(memory, {
      outcome: 'needs_review',
      value: answer('7', INTEGER),
      responseId: RESPONSE_A,
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.pending).toEqual([decision.id]);
    expect(response).toMatchObject({
      isCorrect: null,
      rawScore: null,
      finalScore: null,
      value: { answer: null, pendingReading: true },
      aiScore,
    });
    expect(report.recalculatedAssessmentIds).toEqual([ASSESSMENT_ID]);
  });

  it('una autoaceptada que la estrategia no puede decidir entra a la cola en vez de quedar pendiente sin revisión', async () => {
    const { memory, service } = setup();
    const response = seedResponse(memory, { id: RESPONSE_A, itemId: OPEN_ITEM });
    const decision = seedDecision(memory, {
      itemId: OPEN_ITEM,
      value: answer('7', INTEGER),
      responseId: RESPONSE_A,
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    const reviewable = currentDecisionOf(memory);
    expect(reviewable).toMatchObject({
      outcome: 'needs_review',
      reasons: ['undecidable'],
      reviewMode: 'grading',
      responseId: RESPONSE_A,
    });
    expect(decision.supersededById).toBe(reviewable.id);
    expect(report.pending).toEqual([reviewable.id]);
    expect(response.finalScore).toBeNull();
  });

  it('una respuesta que ya estaba pendiente no se reescribe ni recalcula', async () => {
    const { memory, service, statements } = setup();
    seedResponse(memory, { id: RESPONSE_A });
    const decision = seedDecision(memory, {
      outcome: 'not_read',
      value: null,
      responseId: RESPONSE_A,
    });

    const report = await service.consolidateDecisions(ORG_ID, [decision.id]);

    expect(report.pending).toEqual([decision.id]);
    expect(report.recalculatedAssessmentIds).toEqual([]);
    expect(statements.some((statement) => statement.includes('UPDATE responses'))).toBe(false);
  });

  it('recalcula una sola vez por evaluación y escribe por lote', async () => {
    const { memory, service, recalculate, statements } = setup();
    seedResponse(memory, { id: RESPONSE_A });
    seedResponse(memory, { id: RESPONSE_B, itemId: WORDS_ITEM, maxScore: '2.00' });
    const first = seedDecision(memory, { value: answer('7', INTEGER), responseId: RESPONSE_A });
    const second = seedDecision(memory, {
      markId: MARK_C,
      itemId: WORDS_ITEM,
      value: answer('cabeza, torax, abdomen', WORDS),
      responseId: RESPONSE_B,
    });

    const report = await service.consolidateDecisions(ORG_ID, [first.id, second.id]);

    expect(report.scored).toEqual([first.id, second.id]);
    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(recalculate).toHaveBeenCalledWith(ORG_ID, [ASSESSMENT_ID]);
    expect(statements.filter((statement) => statement.includes('UPDATE responses'))).toHaveLength(
      1,
    );
    expect(
      statements.filter((statement) => statement.includes('UPDATE answer_reading_decisions')),
    ).toHaveLength(1);
  });
});

describe('AnswerReadingConsolidationService.applyHumanResolution', () => {
  function seedReviewed(memory: InMemoryDatabase) {
    const aiScore = { score: 0, confidence: 0.6, decisionId: 'previa' };
    const response = seedResponse(memory, { id: RESPONSE_A, aiScore });
    const decision = seedDecision(memory, {
      outcome: 'needs_review',
      value: answer('1', INTEGER),
      responseId: RESPONSE_A,
    });
    return { response, decision, aiScore };
  }

  it('modo lectura: corrige con la estrategia el valor que leyó el docente y conserva el ai_score', async () => {
    const { memory, service, recalculate } = setup();
    const { response, decision, aiScore } = seedReviewed(memory);

    const report = await service.applyHumanResolution(
      ORG_ID,
      decision.id,
      { kind: 'reading', value: answer('7', INTEGER) },
      REVIEWER_ID,
    );

    expect(report.scored).toEqual([decision.id]);
    expect(response).toMatchObject({
      isCorrect: true,
      finalScore: '1.00',
      scoredBy: 'human',
      humanScore: { score: 1, scoredById: REVIEWER_ID },
      aiScore,
    });
    expect(decision.resolvedAt).toBeInstanceOf(Date);
    expect(recalculate).toHaveBeenCalledWith(ORG_ID, [ASSESSMENT_ID]);
  });

  it('modo corrección: el juicio directo del docente decide el puntaje', async () => {
    const { memory, service } = setup();
    const { response, decision } = seedReviewed(memory);

    await service.applyHumanResolution(
      ORG_ID,
      decision.id,
      { kind: 'grading', isCorrect: true, reason: 'equivalente a la clave' },
      REVIEWER_ID,
    );

    expect(response).toMatchObject({
      isCorrect: true,
      finalScore: '1.00',
      scoredBy: 'human',
      humanScore: { score: 1, scoredById: REVIEWER_ID, overrideReason: 'equivalente a la clave' },
    });
  });

  it('modo corrección con puntaje explícito lo acota al máximo del ítem', async () => {
    const { memory, service } = setup();
    const { response, decision } = seedReviewed(memory);

    await service.applyHumanResolution(
      ORG_ID,
      decision.id,
      { kind: 'grading', isCorrect: false, score: 5 },
      REVIEWER_ID,
    );

    expect(response).toMatchObject({ isCorrect: false, finalScore: '1.00' });
  });

  it('ilegible es una decisión explícita del docente: 0 con motivo "ilegible"', async () => {
    const { memory, service } = setup();
    const { response, decision } = seedReviewed(memory);

    await service.applyHumanResolution(ORG_ID, decision.id, { kind: 'illegible' }, REVIEWER_ID);

    expect(response).toMatchObject({
      isCorrect: false,
      finalScore: '0.00',
      scoredBy: 'human',
      humanScore: { score: 0, scoredById: REVIEWER_ID, overrideReason: 'ilegible' },
    });
  });

  it('una revisión humana posterior reemplaza a la anterior', async () => {
    const { memory, service } = setup();
    const { response, decision } = seedReviewed(memory);
    response.humanScore = { score: 0, scoredById: 'otra-persona' };

    await service.applyHumanResolution(
      ORG_ID,
      decision.id,
      { kind: 'grading', isCorrect: true },
      REVIEWER_ID,
    );

    expect(response.humanScore).toEqual({ score: 1, scoredById: REVIEWER_ID });
  });

  it('si el valor leído por el docente no se puede decidir, no toca la respuesta', async () => {
    const { memory, service } = setup();
    const { response, decision } = seedReviewed(memory);
    decision.itemId = WORDS_ITEM;

    const report = await service.applyHumanResolution(
      ORG_ID,
      decision.id,
      { kind: 'reading', value: answer('cabeza, torax, abdomem', WORDS) },
      REVIEWER_ID,
    );

    expect(report.skipped).toEqual([{ decisionId: decision.id, reason: 'undecidable' }]);
    expect(response.finalScore).toBeNull();
  });
});
