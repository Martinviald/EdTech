jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { answerReadingSamples, type AnswerReadingSample } from '@soe/db';
import {
  ASSESSMENT_ID,
  ORG_ID,
  OTHER_ORG_ID,
  REVIEWER_ID,
  STUDENT_ID,
  answer,
  setupReviewWorld,
} from './testing/review-fixtures';

function samples(world: ReturnType<typeof setupReviewWorld>) {
  return world.memory.rows<AnswerReadingSample>(answerReadingSamples);
}

describe('AnswerReadingReviewsService.submit', () => {
  it('aceptar en grupo corrige cada respuesta con la estrategia y registra una fila por decisión', async () => {
    const world = setupReviewWorld();
    const first = world.seedDecision({ literal: '7' });
    const second = world.seedDecision({ literal: '7' });
    const firstResponse = world.seedResponse();
    const secondResponse = world.seedResponse({
      studentId: '55555555-5555-4555-8555-555555555556',
    });
    first.responseId = firstResponse.id;
    second.responseId = secondResponse.id;

    const result = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [first.id, second.id],
      mode: 'reading',
      action: 'accept',
    });

    expect(result.appliedDecisionIds.sort()).toEqual([first.id, second.id].sort());
    expect(result.pendingConsolidation).toEqual([]);
    expect(world.reviewRows()).toHaveLength(2);
    expect(world.reviewRows().every((row) => row.groupSize === 2)).toBe(true);
    expect(new Set(world.reviewRows().map((row) => row.groupOperationId)).size).toBe(1);
    expect(firstResponse).toMatchObject({
      isCorrect: true,
      finalScore: '1.00',
      scoredBy: 'human',
      humanScore: { score: 1, scoredById: REVIEWER_ID },
    });
    expect(world.recalculate).toHaveBeenCalledWith(ORG_ID, [ASSESSMENT_ID]);
  });

  it('aceptar con editedLiteral acepta esa lectura y no la propuesta', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '1' });
    const response = world.seedResponse();
    decision.responseId = response.id;

    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'accept',
      editedLiteral: '7',
    });

    expect(world.reviewRows()[0]).toMatchObject({
      editedLiteral: '7',
      resultingCanonical: answer('7').canonical,
    });
    expect(response.isCorrect).toBe(true);
  });

  it('en blanco deja la respuesta en 0 como decisión humana, sin tocar el ai_score', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });
    const response = world.seedResponse({ aiScore: { score: 0, decisionId: 'x' } });
    decision.responseId = response.id;

    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'blank',
    });

    expect(response).toMatchObject({
      isCorrect: false,
      finalScore: '0.00',
      aiScore: { score: 0, decisionId: 'x' },
      humanScore: { score: 0, scoredById: REVIEWER_ID, overrideReason: 'en blanco' },
    });
    expect(response.value).toMatchObject({ blank: true });
  });

  it('una acción que no corresponde al modo responde 400', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });

    await expect(
      world.reviews.submit(ORG_ID, REVIEWER_ID, {
        decisionIds: [decision.id],
        mode: 'reading',
        action: 'mark_correct',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(world.reviewRows()).toHaveLength(0);
  });

  it('juzgar en modo corrección una respuesta que espera lectura responde 400', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });

    await expect(
      world.reviews.submit(ORG_ID, REVIEWER_ID, {
        decisionIds: [decision.id],
        mode: 'grading',
        action: 'mark_correct',
      }),
    ).rejects.toThrow('Primero resuelve qué escribió el alumno');
  });

  it('una edición que no se puede interpretar con el formato responde 400 con un mensaje claro', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });

    await expect(
      world.reviews.submit(ORG_ID, REVIEWER_ID, {
        decisionIds: [decision.id],
        mode: 'reading',
        action: 'edit',
        editedLiteral: 'siete y medio',
      }),
    ).rejects.toThrow(/No se pudo interpretar "siete y medio"/);
    expect(world.reviewRows()).toHaveLength(0);
  });

  it('modo corrección: marcar correcta usa el juicio del docente', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({
      literal: '7',
      reasons: ['unparsed_format'],
      reviewMode: 'grading',
    });
    const response = world.seedResponse();
    decision.responseId = response.id;

    const result = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'grading',
      action: 'mark_correct',
      reason: 'equivalente',
    });

    expect(result.appliedDecisionIds).toEqual([decision.id]);
    expect(response).toMatchObject({
      isCorrect: true,
      humanScore: { score: 1, scoredById: REVIEWER_ID, overrideReason: 'equivalente' },
    });
  });

  it('una decisión de otra organización responde 404 y no escribe nada', async () => {
    const world = setupReviewWorld();
    const foreign = world.seedDecision({ literal: '7', orgId: OTHER_ORG_ID });

    await expect(
      world.reviews.submit(ORG_ID, REVIEWER_ID, {
        decisionIds: [foreign.id],
        mode: 'reading',
        action: 'accept',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(world.reviewRows()).toHaveLength(0);
  });

  it('una decisión reemplazada responde 409', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({
      literal: '7',
      supersededById: '99999999-0000-4000-8000-000000000000',
    });

    await expect(
      world.reviews.submit(ORG_ID, REVIEWER_ID, {
        decisionIds: [decision.id],
        mode: 'reading',
        action: 'accept',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('un human_score puesto fuera de la revisión no se pisa y se informa', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });
    const response = world.seedResponse({
      humanScore: { score: 0, scoredById: 'docente', overrideReason: 'corrección manual' },
      finalScore: '0.00',
    });
    decision.responseId = response.id;

    const result = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'accept',
    });

    expect(result.skippedHumanScored).toEqual([decision.id]);
    expect(result.appliedDecisionIds).toEqual([]);
    expect(response.humanScore).toEqual({
      score: 0,
      scoredById: 'docente',
      overrideReason: 'corrección manual',
    });
  });

  it('una segunda revisión reemplaza a la anterior y deja su historial', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });
    const response = world.seedResponse();
    decision.responseId = response.id;

    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'accept',
    });
    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'edit',
      editedLiteral: '1',
    });

    const [first, second] = world.reviewRows();
    expect(first?.supersededById).toBe(second?.id);
    expect(second?.supersededById).toBeNull();
    expect(response).toMatchObject({ isCorrect: false, finalScore: '0.00' });
  });
});

describe('AnswerReadingReviewsService: revisión antes de confirmar el lote', () => {
  it('sin respuesta vinculada queda registrada y se aplica sola al confirmar', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '1' });

    const result = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'edit',
      editedLiteral: '7',
    });

    expect(result.pendingConsolidation).toEqual([decision.id]);
    expect(result.appliedDecisionIds).toEqual([]);

    const response = world.seedResponse();
    const report = await world.consolidation.linkConfirmedResponses(ORG_ID, {
      assessmentId: ASSESSMENT_ID,
      links: [
        {
          decisionId: decision.id,
          studentId: STUDENT_ID,
          itemId: decision.itemId,
          consolidated: false,
        },
      ],
      cropMarks: [{ markId: decision.markId, studentId: STUDENT_ID, itemId: decision.itemId }],
    });

    expect(report?.scored).toEqual([decision.id]);
    expect(decision.responseId).toBe(response.id);
    expect(response).toMatchObject({
      isCorrect: true,
      finalScore: '1.00',
      scoredBy: 'human',
      humanScore: { score: 1, scoredById: REVIEWER_ID },
    });
  });

  it('una revisión deshecha antes de confirmar no se aplica: la respuesta queda pendiente', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });
    const { reviewIds } = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'accept',
    });
    await world.reviews.undo(ORG_ID, REVIEWER_ID, { reviewIds });

    const response = world.seedResponse();
    await world.consolidation.linkConfirmedResponses(ORG_ID, {
      assessmentId: ASSESSMENT_ID,
      links: [
        {
          decisionId: decision.id,
          studentId: STUDENT_ID,
          itemId: decision.itemId,
          consolidated: false,
        },
      ],
      cropMarks: [{ markId: decision.markId, studentId: STUDENT_ID, itemId: decision.itemId }],
    });

    expect(response.finalScore).toBeNull();
    expect(response.humanScore).toBeNull();
  });
});

describe('AnswerReadingReviewsService.undo', () => {
  it('deshace un lote: agrega revisiones nuevas, no borra, y la respuesta vuelve a pendiente (nunca 0)', async () => {
    const world = setupReviewWorld({ consent: 'org_internal' });
    const first = world.seedDecision({ literal: '7' });
    const second = world.seedDecision({ literal: '7' });
    const firstResponse = world.seedResponse();
    const secondResponse = world.seedResponse({
      studentId: '55555555-5555-4555-8555-555555555556',
    });
    first.responseId = firstResponse.id;
    second.responseId = secondResponse.id;
    const submitted = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [first.id, second.id],
      mode: 'reading',
      action: 'accept',
    });

    const result = await world.reviews.undo(ORG_ID, REVIEWER_ID, {
      reviewIds: submitted.reviewIds,
    });

    const rows = world.reviewRows();
    expect(rows).toHaveLength(4);
    const undoRows = rows.filter((row) => row.action === 'undo');
    expect(undoRows.map((row) => row.id).sort()).toEqual([...result.reviewIds].sort());
    for (const original of rows.filter((row) => row.action === 'accept')) {
      expect(result.reviewIds).toContain(original.supersededById);
    }
    expect(result.appliedDecisionIds.sort()).toEqual([first.id, second.id].sort());
    for (const response of [firstResponse, secondResponse]) {
      expect(response).toMatchObject({
        finalScore: null,
        isCorrect: null,
        humanScore: null,
        value: { answer: null, pendingReading: true },
      });
    }
    expect(samples(world).every((sample) => sample.deletedAt instanceof Date)).toBe(true);
  });

  it('una decisión autoaceptada vuelve a su corrección automática al deshacer', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7', outcome: 'auto_accepted', reasons: [] });
    const response = world.seedResponse();
    decision.responseId = response.id;
    const { reviewIds } = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'edit',
      editedLiteral: '1',
    });
    expect(response.isCorrect).toBe(false);

    await world.reviews.undo(ORG_ID, REVIEWER_ID, { reviewIds });

    expect(response).toMatchObject({
      isCorrect: true,
      finalScore: '1.00',
      scoredBy: 'ai',
      humanScore: null,
    });
  });

  it('deshacer dos veces la misma revisión responde 409', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });
    const { reviewIds } = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'accept',
    });
    await world.reviews.undo(ORG_ID, REVIEWER_ID, { reviewIds });

    await expect(world.reviews.undo(ORG_ID, REVIEWER_ID, { reviewIds })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('una revisión de otra organización responde 404', async () => {
    const world = setupReviewWorld();

    await expect(
      world.reviews.undo(ORG_ID, REVIEWER_ID, {
        reviewIds: ['12345678-1234-4123-8123-123456789012'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AnswerReadingReviewsService: dataset de evaluación', () => {
  it('con consentimiento interno, una revisión de lectura agrega una muestra etiquetada', async () => {
    const world = setupReviewWorld({ consent: 'org_internal' });
    const decision = world.seedDecision({ literal: '1' });

    const { reviewIds } = await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'edit',
      editedLiteral: '7',
    });

    expect(samples(world)).toEqual([
      expect.objectContaining({
        reviewId: reviewIds[0],
        decisionId: decision.id,
        labelLiteral: '7',
        labelCanonical: answer('7').canonical,
        labelState: 'answered',
        labelSource: 'review_reading',
        consentScope: 'org_internal',
        needsNormalizerCase: false,
        formatKind: 'integer',
      }),
    ]);
  });

  it('marcar correcta una respuesta que el código no supo interpretar pide un caso para el normalizador', async () => {
    const world = setupReviewWorld({ consent: 'platform_eval' });
    const decision = world.seedDecision({
      literal: '7',
      reasons: ['unparsed_format'],
      reviewMode: 'grading',
    });

    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'grading',
      action: 'mark_correct',
    });

    expect(samples(world)).toEqual([
      expect.objectContaining({
        labelSource: 'review_grading',
        needsNormalizerCase: true,
        consentScope: 'platform_eval',
      }),
    ]);
  });

  it('sin consentimiento no se guarda ninguna muestra', async () => {
    const world = setupReviewWorld({ consent: 'none' });
    const decision = world.seedDecision({ literal: '7' });

    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'accept',
    });

    expect(samples(world)).toHaveLength(0);
    expect(world.reviewRows()).toHaveLength(1);
  });
});
