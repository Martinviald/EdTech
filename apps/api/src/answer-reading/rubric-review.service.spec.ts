jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { fakeOutput, normalizeTranscription } from '@soe/answer-reading';
import { items, users, type AnswerReadingDecision, type Response } from '@soe/db';
import type { ResponseFormat } from '@soe/types';
import type { FilesService } from '../files/files.service';
import { DEFAULT_ANSWER_READING_OPTIONS } from './answer-reading.constants';
import { RubricGradingService } from './rubric-grading.service';
import { RubricReviewService } from './rubric-review.service';
import {
  ASSESSMENT_ID,
  ORG_ID,
  OTHER_ORG_ID,
  REVIEWER_ID,
  setupReviewWorld,
} from './testing/review-fixtures';

const RUBRIC_ITEM = 'aaaaaaaa-0000-4000-8000-000000000009';
const FREE_TEXT: ResponseFormat = { kind: 'free_text', lines: 6 };
const TRANSCRIPTION = 'Porque el río se desbordó y tapó las calles';
const QUERY = { assessmentId: ASSESSMENT_ID, page: 1, pageSize: 20 } as const;

function setup() {
  const world = setupReviewWorld();
  world.memory.seed(items, [
    {
      id: RUBRIC_ITEM,
      type: 'rubric_scored',
      content: {
        prompt: '¿Por qué se inundó el pueblo?',
        levels: [
          { code: '0', label: 'Incorrecta', descriptor: 'No da una causa.', creditFraction: 0 },
          { code: '1', label: 'Parcial', descriptor: 'Da la causa.', creditFraction: 0.5 },
          { code: '2', label: 'Completa', descriptor: 'Explica la causa.', creditFraction: 1 },
        ],
      },
      scoringConfig: { points: 2 },
    },
  ]);
  world.memory.seed(users, [{ id: REVIEWER_ID, email: 'docente@colegio.cl', name: 'Docente' }]);
  const rubricGrading = new RubricGradingService(
    world.db,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    world.decisions,
    world.consolidation,
    DEFAULT_ANSWER_READING_OPTIONS,
  );
  const filesService = {
    buildDownloadUrl: (row: { id: string }) => `https://recortes.test/${row.id}.jpg`,
  } as unknown as FilesService;
  const service = new RubricReviewService(world.db, world.decisions, rubricGrading, filesService);

  function seedRubric(
    options: {
      proposal?: string | null;
      linked?: boolean;
      humanScore?: Response['humanScore'];
      orgId?: string;
    } = {},
  ): { decision: AnswerReadingDecision; response: Response } {
    const response = world.seedResponse({
      itemId: RUBRIC_ITEM,
      maxScore: '2.00',
      humanScore: options.humanScore ?? null,
    });
    const decision = world.seedDecision({
      itemId: RUBRIC_ITEM,
      value: normalizeTranscription(fakeOutput(TRANSCRIPTION), FREE_TEXT),
      canonical: TRANSCRIPTION,
      reasons: ['rubric_item'],
      reviewMode: 'grading',
      responseId: options.linked === false ? null : response.id,
      ...(options.orgId ? { orgId: options.orgId } : {}),
    });
    if (options.proposal !== null) {
      response.aiScore = {
        score: 1,
        confidence: 0.8,
        levelCode: options.proposal ?? '1',
        rationale: 'Da la causa sin explicarla.',
        evidenceQuotes: ['el río se desbordó'],
        model: 'gemini-3.5-flash-lite',
        promptVersion: 'grade.rubric@1',
        decisionId: decision.id,
      };
    }
    return { decision, response };
  }

  return { world, service, seedRubric };
}

describe('RubricReviewService.queue', () => {
  it('lista solo las respuestas de rúbrica pendientes, con la propuesta y sin datos del alumno', async () => {
    const { world, service, seedRubric } = setup();
    const { decision } = seedRubric();
    const withoutProposal = seedRubric({ proposal: null });
    world.seedDecision({ literal: '7' });

    const page = await service.queue(ORG_ID, QUERY);

    expect(page).toMatchObject({ total: 2, page: 1, limit: 20 });
    const byId = new Map(page.data.map((entry) => [entry.decisionId, entry]));
    expect(byId.get(decision.id)).toEqual({
      decisionId: decision.id,
      itemId: RUBRIC_ITEM,
      printedNumber: '7',
      transcription: TRANSCRIPTION,
      cropUrl: expect.stringMatching(/^https:\/\/recortes\.test\//),
      proposal: { levelCode: '1', confidence: 0.8 },
      awaitingConfirmation: false,
    });
    expect(byId.get(withoutProposal.decision.id)?.proposal).toBeNull();
    expect(JSON.stringify(page)).not.toContain('studentId');
  });

  it('pagina y no muestra decisiones de otra organización', async () => {
    const { service, seedRubric } = setup();
    seedRubric();
    seedRubric();
    seedRubric({ orgId: OTHER_ORG_ID });

    const page = await service.queue(ORG_ID, { ...QUERY, pageSize: 1, page: 2 });

    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(1);
  });
});

describe('RubricReviewService.detail', () => {
  it('trae enunciado, niveles con puntaje, transcripción y la propuesta vigente', async () => {
    const { service, seedRubric } = setup();
    const { decision } = seedRubric();

    const detail = await service.detail(ORG_ID, decision.id);

    expect(detail).toMatchObject({
      stem: '¿Por qué se inundó el pueblo?',
      transcription: TRANSCRIPTION,
      formatKind: 'free_text',
      maxScore: 2,
      pending: true,
      approval: null,
      awaitingConfirmation: false,
      proposal: {
        levelCode: '1',
        confidence: 0.8,
        rationale: 'Da la causa sin explicarla.',
        evidenceQuotes: ['el río se desbordó'],
      },
    });
    expect(detail.levels.map((level) => [level.code, level.score])).toEqual([
      ['0', 0],
      ['1', 1],
      ['2', 2],
    ]);
  });

  it('ignora una propuesta que se hizo para otra lectura', async () => {
    const { service, seedRubric } = setup();
    const { decision, response } = seedRubric();
    response.aiScore = { ...response.aiScore, decisionId: 'otra-lectura' };

    const detail = await service.detail(ORG_ID, decision.id);

    expect(detail.proposal).toBeNull();
  });

  it('responde 404 para otra organización o una respuesta que no es de rúbrica', async () => {
    const { world, service, seedRubric } = setup();
    const foreign = seedRubric({ orgId: OTHER_ORG_ID });
    const shortAnswer = world.seedDecision({ literal: '7' });

    await expect(service.detail(ORG_ID, foreign.decision.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.detail(ORG_ID, shortAnswer.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RubricReviewService.approve', () => {
  it('escribe human_score con el nivel, conserva ai_score y deja una revisión que F8 puede deshacer', async () => {
    const { world, service, seedRubric } = setup();
    const { decision, response } = seedRubric();
    const aiScore = response.aiScore;

    const result = await service.approve(ORG_ID, REVIEWER_ID, {
      decisionId: decision.id,
      levelCode: '1',
    });

    expect(result.approvedDecisionIds).toEqual([decision.id]);
    expect(result.skipped).toEqual([]);
    expect(response).toMatchObject({
      isCorrect: false,
      finalScore: '1.00',
      scoredBy: 'human',
      humanScore: { score: 1, scoredById: REVIEWER_ID, levelCode: '1' },
      aiScore,
    });
    expect(world.reviewRows()).toEqual([
      expect.objectContaining({
        id: result.reviewIds[0],
        decisionId: decision.id,
        mode: 'grading',
        action: 'mark_incorrect',
        editedLiteral: '1',
        supersededById: null,
      }),
    ]);
    expect((await service.queue(ORG_ID, QUERY)).total).toBe(0);
    const detail = await service.detail(ORG_ID, decision.id);
    expect(detail.approval).toMatchObject({ levelCode: '1', reviewerName: 'Docente' });
    expect(detail.pending).toBe(false);

    await world.reviews.undo(ORG_ID, REVIEWER_ID, { reviewIds: result.reviewIds });

    expect(response.humanScore).toBeNull();
    expect(response.finalScore).toBeNull();
    expect(response.aiScore).toEqual(aiScore);
    expect((await service.queue(ORG_ID, QUERY)).total).toBe(1);
  });

  it('el nivel completo se registra como correcta y una nueva aprobación reemplaza a la anterior', async () => {
    const { world, service, seedRubric } = setup();
    const { decision, response } = seedRubric();

    const first = await service.approve(ORG_ID, REVIEWER_ID, {
      decisionId: decision.id,
      levelCode: '1',
    });
    const second = await service.approve(ORG_ID, REVIEWER_ID, {
      decisionId: decision.id,
      levelCode: '2',
      reason: 'Explica la causa en la segunda línea',
    });

    expect(response).toMatchObject({ isCorrect: true, finalScore: '2.00' });
    const rows = world.reviewRows();
    expect(rows.find((row) => row.id === first.reviewIds[0])?.supersededById).toBe(
      second.reviewIds[0],
    );
    expect(rows.find((row) => row.id === second.reviewIds[0])).toMatchObject({
      action: 'mark_correct',
      editedLiteral: '2',
      reason: 'Explica la causa en la segunda línea',
    });
  });

  it('no pisa una corrección humana que no escribió esta lectura', async () => {
    const { world, service, seedRubric } = setup();
    const { decision, response } = seedRubric({
      humanScore: { score: 2, scoredById: REVIEWER_ID },
    });

    const result = await service.approve(ORG_ID, REVIEWER_ID, {
      decisionId: decision.id,
      levelCode: '0',
    });

    expect(result).toEqual({
      reviewIds: [],
      approvedDecisionIds: [],
      skipped: [{ decisionId: decision.id, reason: 'human_scored' }],
    });
    expect(response.humanScore).toEqual({ score: 2, scoredById: REVIEWER_ID });
    expect(world.reviewRows()).toHaveLength(0);
  });

  it('exige que el lote esté confirmado antes de aprobar', async () => {
    const { service, seedRubric } = setup();
    const { decision } = seedRubric({ linked: false });

    await expect(
      service.approve(ORG_ID, REVIEWER_ID, { decisionId: decision.id, levelCode: '1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza un nivel que no está en la rúbrica sin dejar revisión', async () => {
    const { world, service, seedRubric } = setup();
    const { decision, response } = seedRubric();

    await expect(
      service.approve(ORG_ID, REVIEWER_ID, { decisionId: decision.id, levelCode: '9' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(response.humanScore).toBeNull();
    expect(world.reviewRows()).toHaveLength(0);
  });

  it('responde 404 para una respuesta de otra organización', async () => {
    const { service, seedRubric } = setup();
    const { decision, response } = seedRubric({ orgId: OTHER_ORG_ID });

    await expect(
      service.approve(ORG_ID, REVIEWER_ID, { decisionId: decision.id, levelCode: '1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(response.humanScore).toBeNull();
  });
});

describe('RubricReviewService.acceptProposals', () => {
  it('aprueba cada respuesta con el nivel que propuso la IA y salta las que no tienen propuesta', async () => {
    const { world, service, seedRubric } = setup();
    const partial = seedRubric({ proposal: '1' });
    const complete = seedRubric({ proposal: '2' });
    const missing = seedRubric({ proposal: null });

    const result = await service.acceptProposals(ORG_ID, REVIEWER_ID, {
      acceptAiProposals: [partial.decision.id, complete.decision.id, missing.decision.id],
    });

    expect(result.approvedDecisionIds).toEqual([partial.decision.id, complete.decision.id]);
    expect(result.skipped).toEqual([{ decisionId: missing.decision.id, reason: 'no_proposal' }]);
    expect(partial.response.humanScore).toMatchObject({ score: 1, levelCode: '1' });
    expect(complete.response.humanScore).toMatchObject({ score: 2, levelCode: '2' });
    expect(missing.response.humanScore).toBeNull();
    const rows = world.reviewRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.groupOperationId)).size).toBe(1);
    expect(rows.every((row) => row.groupSize === 2)).toBe(true);
  });
});
