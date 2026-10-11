jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { NotFoundException } from '@nestjs/common';
import {
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
} from '@soe/db';
import {
  ASSESSMENT_ID,
  INTEGER,
  NUMBER_ITEM,
  ORG_ID,
  OTHER_ORG_ID,
  REVIEWER_ID,
  UNIT_ITEM,
  answer,
  setupReviewWorld,
} from './testing/review-fixtures';

const QUERY = { assessmentId: ASSESSMENT_ID, page: 1, pageSize: 20 } as const;

describe('AnswerReadingReviewQueueService.queue', () => {
  it('modo lectura: agrupa por valor propuesto y nunca expone la clave ni el resultado', async () => {
    const world = setupReviewWorld();
    world.seedDecision({ literal: '7' });
    world.seedDecision({ literal: '7' });
    world.seedDecision({ literal: '1' });

    const page = await world.queue.queue(ORG_ID, QUERY);

    expect(page.total).toBe(2);
    expect(page.limit).toBe(20);
    const [first, second] = page.data;
    expect(first).toMatchObject({
      mode: 'reading',
      canonical: answer('7').canonical,
      displayValue: '7',
      size: 2,
      printedNumber: '7',
      formatKind: 'integer',
      responseFormat: INTEGER,
      grading: null,
    });
    expect(second?.size).toBe(1);
    expect(first?.members.every((member) => member.cropUrl?.startsWith('https://'))).toBe(true);
    expect(first?.readers).toHaveLength(2);
    expect(first?.readers[0]?.alternatives).toEqual([{ literal: '1', plausibility: 0.3 }]);
    expect(JSON.stringify(page)).not.toContain('acceptedAnswers');
    expect(JSON.stringify(page)).not.toContain('correct');
  });

  it('modo corrección: trae la clave, la unidad y el resultado de cada opción', async () => {
    const world = setupReviewWorld();
    world.seedDecision({
      itemId: UNIT_ITEM,
      literal: '12',
      reasons: ['undecidable'],
      reviewMode: 'grading',
    });

    const page = await world.queue.queue(ORG_ID, { ...QUERY, mode: 'grading' });

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.grading).toEqual({
      acceptedAnswers: ['12'],
      unit: 'm',
      proposedOutcome: 'correct',
      optionOutcomes: [
        { literal: '12', outcome: 'correct' },
        { literal: '1', outcome: 'incorrect' },
      ],
    });
  });

  it('las decisiones sin valor canónico van cada una en su propio grupo', async () => {
    const world = setupReviewWorld();
    world.seedDecision({ value: null });
    world.seedDecision({ value: null });

    const page = await world.queue.queue(ORG_ID, QUERY);

    expect(page.data.map((group) => group.size)).toEqual([1, 1]);
    expect(new Set(page.data.map((group) => group.groupKey)).size).toBe(2);
  });

  it('la auditoría solo aparece con includeAudit y marca a sus miembros', async () => {
    const world = setupReviewWorld();
    world.seedDecision({ literal: '7', reasons: ['audit_sample'] });

    const without = await world.queue.queue(ORG_ID, QUERY);
    const withAudit = await world.queue.queue(ORG_ID, { ...QUERY, includeAudit: true });

    expect(without.total).toBe(0);
    expect(withAudit.data[0]?.members[0]?.isAudit).toBe(true);
  });

  it('no muestra decisiones de otra organización', async () => {
    const world = setupReviewWorld();
    world.seedDecision({ literal: '7', orgId: OTHER_ORG_ID });

    const page = await world.queue.queue(ORG_ID, QUERY);

    expect(page.total).toBe(0);
  });
});

describe('AnswerReadingReviewQueueService.summary', () => {
  it('cuenta pendientes por modo, revisadas, autoaceptadas y el total que pasa por revisión', async () => {
    const world = setupReviewWorld();
    world.seedDecision({ literal: '7' });
    world.seedDecision({ literal: '7', reasons: ['audit_sample'] });
    world.seedDecision({ literal: '12', reasons: ['unparsed_format'], reviewMode: 'grading' });
    world.seedDecision({ literal: '7', outcome: 'auto_accepted', reasons: [] });
    const reviewed = world.seedDecision({ literal: '7' });
    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [reviewed.id],
      mode: 'reading',
      action: 'accept',
    });

    const summary = await world.queue.summary(ORG_ID, { assessmentId: ASSESSMENT_ID });

    expect(summary).toMatchObject({
      pendingReading: 2,
      pendingGrading: 1,
      pendingAudit: 1,
      autoAccepted: 1,
      reviewed: 1,
      total: 4,
      inProgress: 0,
    });
    expect(summary.byItem).toEqual([
      {
        itemId: NUMBER_ITEM,
        printedNumber: '7',
        formatLabel: expect.any(String),
        pendingReading: 2,
        pendingGrading: 1,
      },
    ]);
  });

  it('en progreso = recortes del lote que todavía no tienen decisión vigente', async () => {
    const world = setupReviewWorld();
    const batchId = '22222222-2222-4222-8222-222222222222';
    const printRunId = '33333333-3333-4333-8333-333333333333';
    const layoutId = '99999999-9999-4999-8999-999999999999';
    const scanId = '88888888-8888-4888-8888-888888888888';
    world.memory.seed(sheetLayouts, [
      {
        id: layoutId,
        spec: {
          fields: [
            {
              fieldId: 'q7',
              kind: 'crop_region',
              printedNumber: '7',
              response: { itemId: NUMBER_ITEM, format: INTEGER },
            },
            { fieldId: 'q1', kind: 'bubble_group', printedNumber: '1' },
          ],
        },
      },
    ]);
    world.memory.seed(sheetPrintRuns, [
      { id: printRunId, orgId: ORG_ID, layoutId, assessmentId: ASSESSMENT_ID },
    ]);
    world.memory.seed(sheetScanBatches, [{ id: batchId, orgId: ORG_ID, printRunId }]);
    world.memory.seed(sheetScans, [{ id: scanId, orgId: ORG_ID, batchId, state: 'read' }]);
    const decided = world.seedDecision({ literal: '7' });
    world.memory.rows<{ id: string; scanId: string | null }>(sheetScanMarks).forEach((mark) => {
      mark.scanId = scanId;
    });
    world.memory.seed(sheetScanMarks, [
      { orgId: ORG_ID, scanId, fieldId: 'q7', printedNumber: '7' },
      { orgId: ORG_ID, scanId, fieldId: 'q1', printedNumber: '1' },
    ]);

    const byBatch = await world.queue.summary(ORG_ID, { batchId });
    const page = await world.queue.queue(ORG_ID, { batchId, page: 1, pageSize: 20 });

    expect(byBatch.inProgress).toBe(1);
    expect(byBatch.pendingReading).toBe(1);
    expect(page.data[0]?.members[0]?.decisionId).toBe(decided.id);
  });
});

describe('AnswerReadingReviewQueueService.detail', () => {
  it('modo lectura sin clave e historial con quién revisó', async () => {
    const world = setupReviewWorld();
    const decision = world.seedDecision({ literal: '7' });
    await world.reviews.submit(ORG_ID, REVIEWER_ID, {
      decisionIds: [decision.id],
      mode: 'reading',
      action: 'edit',
      editedLiteral: '1',
    });

    const detail = await world.queue.detail(ORG_ID, decision.id);

    expect(detail).toMatchObject({
      decisionId: decision.id,
      mode: 'reading',
      displayValue: '1',
      grading: null,
      cropUrl: expect.stringContaining('https://'),
    });
    expect(detail.history).toEqual([
      expect.objectContaining({ action: 'edit', editedLiteral: '1', superseded: false }),
    ]);
  });

  it('una decisión de otra organización responde 404', async () => {
    const world = setupReviewWorld();
    const foreign = world.seedDecision({ literal: '7', orgId: OTHER_ORG_ID });

    await expect(world.queue.detail(ORG_ID, foreign.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
