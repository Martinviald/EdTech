jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { fakeOutput, normalizeTranscription } from '@soe/answer-reading';
import {
  aiGradingJobs,
  answerReadingDecisions,
  grades,
  instruments,
  items,
  organizations,
  responses,
  type AnswerReadingDecision,
  type Response,
} from '@soe/db';
import type { ResponseFormat } from '@soe/types';
import * as observability from '../common/observability/report-error';
import type { AssessmentResultsService } from '../assessment-results/assessment-results.service';
import type { EnqueuedJob, JobDispatcher } from '../jobs/job-dispatcher';
import type { LlmConfigService } from '../llm/llm.config';
import type { LlmService } from '../llm/llm.service';
import type { LlmStructuredCall, LlmStructuredResult } from '../llm/llm.types';
import type { AnswerReadingBudgetService } from './answer-reading-budget.service';
import { AnswerReadingConsolidationService } from './answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import {
  DEFAULT_ANSWER_READING_OPTIONS,
  RUBRIC_GRADING_JOB_TYPE,
  RUBRIC_GRADING_PROMPT_REF,
} from './answer-reading.constants';
import { RubricGradingService } from './rubric-grading.service';
import { consolidationDatabase } from './testing/consolidation-sql';
import { InMemoryDatabase } from './testing/in-memory-database';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const ASSESSMENT_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';
const INSTRUMENT_ID = '55555555-5555-4555-8555-555555555555';
const GRADE_ID = '66666666-6666-4666-8666-666666666666';
const RESPONSE_ID = '77777777-7777-4777-8777-777777777777';
const MARK_ID = '88888888-8888-4888-8888-888888888888';
const RUN_ID = '99999999-9999-4999-8999-999999999999';
const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REVIEWER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const FREE_TEXT: ResponseFormat = { kind: 'free_text', lines: 6 };
const TRANSCRIPTION = 'Porque el río se desbordó\ny tapó las calles';

const ASSIST_ON = {
  answerReading: { rubricEngine: 'rubric_grading', rubricAssistEnabled: true },
};

interface ModelReply {
  readonly levelCode?: string;
  readonly data?: unknown;
}

class FakeDispatcher implements JobDispatcher {
  readonly jobs: EnqueuedJob[] = [];

  enqueue(job: EnqueuedJob): void {
    this.jobs.push(job);
  }

  async runAll(): Promise<void> {
    while (this.jobs.length > 0) await (this.jobs.shift() as EnqueuedJob).run();
  }
}

function setup(
  options: {
    orgConfig?: Record<string, unknown>;
    reply?: ModelReply;
    budgetExceeded?: boolean;
    humanScore?: Response['humanScore'];
    provider?: string;
  } = {},
) {
  const memory = new InMemoryDatabase();
  memory.seed(organizations, [
    { id: ORG_ID, name: 'Colegio', config: options.orgConfig ?? ASSIST_ON },
  ]);
  memory.seed(items, [
    {
      id: ITEM_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'rubric_scored',
      content: {
        prompt: '¿Por qué se inundó el pueblo?',
        levels: [
          { code: '0', label: 'Incorrecta', descriptor: 'No da una causa.', creditFraction: 0 },
          {
            code: '1',
            label: 'Parcial',
            descriptor: 'Da la causa sin explicarla.',
            creditFraction: 0.5,
          },
          { code: '2', label: 'Completa', descriptor: 'Explica la causa.', creditFraction: 1 },
        ],
      },
      scoringConfig: { points: 2 },
    },
  ]);
  memory.seed(instruments, [{ id: INSTRUMENT_ID, gradeId: GRADE_ID }]);
  memory.seed(grades, [{ id: GRADE_ID, name: '6° básico' }]);
  memory.seed(responses, [
    {
      id: RESPONSE_ID,
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      itemId: ITEM_ID,
      value: { answer: null, pendingReading: true },
      isCorrect: null,
      rawScore: null,
      maxScore: '2.00',
      finalScore: null,
      scoredBy: 'human',
      aiScore: null,
      humanScore: options.humanScore ?? null,
    },
  ]);
  memory.seed(answerReadingDecisions, [
    {
      orgId: ORG_ID,
      runId: RUN_ID,
      markId: MARK_ID,
      itemId: ITEM_ID,
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      responseId: RESPONSE_ID,
      outcome: 'needs_review',
      value: normalizeTranscription(fakeOutput(TRANSCRIPTION), FREE_TEXT),
      reasons: ['rubric_item'],
      reviewMode: 'grading',
      policyId: 'rubric-transcription',
      policyVersion: 1,
      usedReadingIds: [],
    },
  ]);

  const { db } = consolidationDatabase(memory);
  const dispatcher = new FakeDispatcher();
  const calls: Array<{ call: LlmStructuredCall; orgId: unknown; feature: unknown }> = [];
  const reply = options.reply ?? {};
  const completeStructured = jest.fn(
    async (call: LlmStructuredCall, orgId: unknown, feature: unknown) => {
      calls.push({ call, orgId, feature });
      const result: LlmStructuredResult = {
        data: reply.data ?? {
          evidenceQuotes: ['el río se desbordó'],
          rationale: 'Da la causa, pero no explica cómo provocó la inundación.',
          levelCode: reply.levelCode ?? '1',
          confidence: 0.8,
          score: 99,
        },
        rawText: '{}',
        model: 'gemini-3.5-flash-lite',
        finishReason: 'stop',
        usage: {
          inputTokens: 500,
          outputTokens: 80,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          imageTokens: null,
        },
        providerRequestId: null,
      };
      return result;
    },
  );
  const llm = { completeStructured } as unknown as LlmService;
  const llmConfig = {
    resolve: jest.fn(async () => ({
      provider: options.provider ?? 'gemini',
      model: 'gemini-3.5-flash-lite',
      maxTokens: 1024,
    })),
  } as unknown as LlmConfigService;
  const isExceeded = jest.fn().mockResolvedValue(options.budgetExceeded ?? false);
  const budget = { isExceeded } as unknown as AnswerReadingBudgetService;
  const decisions = new AnswerReadingDecisionsService(db);
  const results = {
    recalculateAnswerSheetResults: jest.fn(async (_orgId: string, ids: readonly string[]) => [
      ...ids,
    ]),
  } as unknown as AssessmentResultsService;
  const consolidation = new AnswerReadingConsolidationService(db, decisions, results);
  const service = new RubricGradingService(
    db,
    dispatcher,
    llm,
    llmConfig,
    budget,
    decisions,
    consolidation,
    DEFAULT_ANSWER_READING_OPTIONS,
  );
  const decision = memory.rows<AnswerReadingDecision>(
    answerReadingDecisions,
  )[0] as AnswerReadingDecision;
  const response = memory.rows<Response>(responses)[0] as Response;
  const jobs = () => memory.rows<typeof aiGradingJobs.$inferSelect>(aiGradingJobs);
  return {
    memory,
    service,
    dispatcher,
    calls,
    completeStructured,
    isExceeded,
    decision,
    response,
    jobs,
  };
}

let reportSpy: jest.SpyInstance;

beforeEach(() => {
  reportSpy = jest.spyOn(observability, 'reportServerError').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RubricGradingService — propuesta de nivel', () => {
  it('propone un nivel con la transcripción, sin imagen, y escribe solo ai_score', async () => {
    const { service, calls, decision, response, jobs } = setup();

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(calls).toHaveLength(1);
    const [{ call, orgId, feature }] = calls as [(typeof calls)[number]];
    expect(orgId).toBe(ORG_ID);
    expect(feature).toBe('rubric_grading');
    expect(call.images).toEqual([]);
    expect(call.prompt).toContain('Porque el río se desbordó\ny tapó las calles');
    expect(call.prompt).toContain('¿Por qué se inundó el pueblo?');
    expect(call.prompt).toContain('Crédito: 50 % del puntaje.');
    expect(call.system).toContain('estudiante de 6° básico');
    expect(call.prompt).not.toContain(STUDENT_ID);
    expect(response.aiScore).toEqual({
      score: 1,
      confidence: 0.8,
      levelCode: '1',
      rationale: 'Da la causa, pero no explica cómo provocó la inundación.',
      evidenceQuotes: ['el río se desbordó'],
      model: 'gemini-3.5-flash-lite',
      promptVersion: RUBRIC_GRADING_PROMPT_REF,
      decisionId: decision.id,
    });
    expect(response).toMatchObject({
      finalScore: null,
      humanScore: null,
      isCorrect: null,
      rawScore: null,
    });
    expect(jobs()).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        responseId: RESPONSE_ID,
        type: RUBRIC_GRADING_JOB_TYPE,
        status: 'completed',
        promptVersion: RUBRIC_GRADING_PROMPT_REF,
        model: 'gemini-3.5-flash-lite',
        score: '1.00',
        confidence: '0.80',
        costUsd: '0.000350',
        input: { decisionId: decision.id, itemId: ITEM_ID, markId: MARK_ID },
      }),
    ]);
  });

  it('el puntaje sale del nivel con rubricScoredStrategy, nunca de un número del modelo', async () => {
    const { service, decision, response } = setup({ reply: { levelCode: '2' } });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(response.aiScore).toMatchObject({ score: 2, levelCode: '2' });
  });

  it('un nivel que no existe en la rúbrica deja el job fallido y no toca la respuesta', async () => {
    const { service, decision, response, jobs } = setup({ reply: { levelCode: '3' } });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(response.aiScore).toBeNull();
    expect(jobs()[0]).toMatchObject({ status: 'failed', output: { error: 'unknown_level' } });
  });

  it('una salida que no cumple el esquema deja el job fallido', async () => {
    const { service, decision, response, jobs } = setup({ reply: { data: { levelCode: '1' } } });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(response.aiScore).toBeNull();
    expect(jobs()[0]).toMatchObject({ status: 'failed', output: { error: 'invalid_output' } });
  });

  it('no vuelve a llamar al modelo por una decisión ya calificada', async () => {
    const { service, decision, completeStructured, jobs } = setup();

    await service.gradeDecisions(ORG_ID, [decision.id]);
    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(completeStructured).toHaveBeenCalledTimes(1);
    expect(jobs()).toHaveLength(1);
  });

  it('no propone sobre una respuesta que el docente ya calificó', async () => {
    const { service, decision, completeStructured, jobs } = setup({
      humanScore: { score: 2, scoredById: REVIEWER_ID },
    });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(completeStructured).not.toHaveBeenCalled();
    expect(jobs()).toHaveLength(0);
  });
});

describe('RubricGradingService — interruptores, motor y presupuesto', () => {
  it('sin rubricAssistEnabled no llama al modelo ni crea jobs', async () => {
    const { service, decision, completeStructured, jobs } = setup({
      orgConfig: { answerReading: { rubricEngine: 'rubric_grading' } },
    });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(completeStructured).not.toHaveBeenCalled();
    expect(jobs()).toHaveLength(0);
  });

  it('con el motor legacy no llama al modelo aunque la asistencia esté encendida', async () => {
    const { service, decision, completeStructured } = setup({
      orgConfig: { answerReading: { rubricAssistEnabled: true } },
    });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(completeStructured).not.toHaveBeenCalled();
  });

  it('con allowExternalVision: false no envía la respuesta a terceros', async () => {
    const { service, decision, completeStructured } = setup({
      orgConfig: {
        answerReading: { ...ASSIST_ON.answerReading, allowExternalVision: false },
      },
    });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(completeStructured).not.toHaveBeenCalled();
  });

  it('con el presupuesto excedido registra el job omitido sin llamar al modelo', async () => {
    const { service, decision, completeStructured, isExceeded, jobs, response } = setup({
      budgetExceeded: true,
    });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(isExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, plannedReadings: 1, workload: 'rubric_grading' }),
    );
    expect(completeStructured).not.toHaveBeenCalled();
    expect(jobs()[0]).toMatchObject({ status: 'skipped', output: { reason: 'budget_exceeded' } });
    expect(response.aiScore).toBeNull();
    expect(reportSpy).toHaveBeenCalled();
  });

  it('un proveedor no permitido por la org deja el job omitido', async () => {
    const { service, decision, completeStructured, jobs } = setup({
      orgConfig: { answerReading: { ...ASSIST_ON.answerReading, allowedProviders: ['anthropic'] } },
    });

    await service.gradeDecisions(ORG_ID, [decision.id]);

    expect(completeStructured).not.toHaveBeenCalled();
    expect(jobs()[0]).toMatchObject({
      status: 'skipped',
      output: { reason: 'provider_not_allowed' },
    });
  });

  it('un error del proveedor deja el job fallido y no se propaga', async () => {
    const { service, decision, completeStructured, jobs } = setup();
    completeStructured.mockRejectedValueOnce(new Error('caído'));

    await expect(service.gradeDecisions(ORG_ID, [decision.id])).resolves.toBeUndefined();

    expect(jobs()[0]).toMatchObject({ status: 'failed', output: { error: 'provider_error' } });
  });

  it('engineFor responde legacy por defecto y el motor elegido por la org', async () => {
    await expect(setup({ orgConfig: {} }).service.engineFor(ORG_ID)).resolves.toBe('legacy');
    await expect(setup().service.engineFor(ORG_ID)).resolves.toBe('rubric_grading');
  });

  it('scheduleForBatch encola un job asíncrono que califica las decisiones vigentes del lote', async () => {
    const { service, dispatcher, decision, completeStructured } = setup();
    const findCurrentByBatch = jest
      .spyOn(AnswerReadingDecisionsService.prototype, 'findCurrentByBatch')
      .mockResolvedValue(new Map([[decision.markId, decision]]));

    service.scheduleForBatch(ORG_ID, BATCH_ID);

    expect(completeStructured).not.toHaveBeenCalled();
    expect(dispatcher.jobs).toHaveLength(1);
    expect(dispatcher.jobs[0]).toMatchObject({ id: BATCH_ID, kind: 'rubric_grading' });
    await dispatcher.runAll();
    expect(findCurrentByBatch).toHaveBeenCalledWith(ORG_ID, BATCH_ID);
    expect(completeStructured).toHaveBeenCalledTimes(1);
  });
});

describe('RubricGradingService.approveRubricLevel', () => {
  it('escribe human_score con el nivel y el puntaje de la estrategia, y conserva ai_score', async () => {
    const { service, decision, response } = setup();
    await service.gradeDecisions(ORG_ID, [decision.id]);
    const aiScore = response.aiScore;

    await service.approveRubricLevel(ORG_ID, decision.id, '2', REVIEWER_ID);

    expect(response).toMatchObject({
      isCorrect: true,
      finalScore: '2.00',
      scoredBy: 'human',
      humanScore: { score: 2, scoredById: REVIEWER_ID, levelCode: '2' },
      aiScore,
    });
    expect(response.value).toMatchObject({ rubricLevel: '2' });
    expect(decision.resolvedAt).toBeInstanceOf(Date);
  });

  it('un nivel parcial da crédito parcial y no cuenta como correcta', async () => {
    const { service, decision, response } = setup();

    await service.approveRubricLevel(ORG_ID, decision.id, '1', REVIEWER_ID);

    expect(response).toMatchObject({
      isCorrect: false,
      finalScore: '1.00',
      humanScore: { score: 1, levelCode: '1' },
    });
  });

  it('rechaza un nivel que no está en la rúbrica', async () => {
    const { service, decision, response } = setup();

    await expect(
      service.approveRubricLevel(ORG_ID, decision.id, '9', REVIEWER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(response.humanScore).toBeNull();
  });

  it('rechaza aprobar sobre una lectura que ya fue reemplazada', async () => {
    const { service, decision } = setup();
    decision.supersededById = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    await expect(
      service.approveRubricLevel(ORG_ID, decision.id, '2', REVIEWER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
