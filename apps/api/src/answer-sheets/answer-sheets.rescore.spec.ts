import { BadRequestException, ConflictException } from '@nestjs/common';
import { getTableName } from 'drizzle-orm';
import type { Database } from '../database/database.types';
import { AnswerSheetsService, type RescoreScannedAnswerInput } from './answer-sheets.service';
import { AnswerSheetPreviewStore } from './lib/preview-store';

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const INSTRUMENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const ASSESSMENT_ID = 'dddddddd-0000-0000-0000-000000000001';
const STUDENT_ID = '11110000-0000-0000-0000-000000000001';
const ITEM_1 = 'ffff0001-0000-0000-0000-000000000001';
const ITEM_2 = 'ffff0002-0000-0000-0000-000000000001';

function mcq(id: string, position: number, correctKey: string) {
  return {
    id,
    position,
    type: 'multiple_choice',
    content: {
      stem: `Pregunta ${position}`,
      alternatives: ['A', 'B', 'C', 'D'].map((key) => ({
        key,
        text: key,
        isCorrect: key === correctKey,
      })),
    },
    scoringConfig: {},
  };
}

interface Upsert {
  values: Record<string, unknown>;
  target: unknown;
}

function makeDb(existingResponse: boolean) {
  const upserts: Upsert[] = [];
  const rowsFor = (table: unknown): unknown[] => {
    const name = getTableName(table as Parameters<typeof getTableName>[0]);
    if (name === 'items') return [mcq(ITEM_1, 1, 'B'), mcq(ITEM_2, 2, 'C')];
    if (name === 'responses') return existingResponse ? [{ id: 'resp-1' }] : [];
    return [];
  };
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const method of ['where', 'orderBy', 'limit', 'innerJoin', 'leftJoin']) {
      c[method] = () => c;
    }
    c.then = (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return c;
  };
  const db = {
    select: () => ({ from: (table: unknown) => chain(rowsFor(table)) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (config: { target: unknown }) => {
          upserts.push({ values, target: config.target });
          return Promise.resolve([]);
        },
      }),
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;
  return { db, upserts };
}

function input(overrides: Partial<RescoreScannedAnswerInput> = {}): RescoreScannedAnswerInput {
  return {
    assessmentId: ASSESSMENT_ID,
    instrumentId: INSTRUMENT_ID,
    studentId: STUDENT_ID,
    label: '1',
    answers: { '1': 'B', '2': 'A' },
    annulledLabels: [],
    ...overrides,
  };
}

describe('AnswerSheetsService.rescoreScannedAnswer', () => {
  it('reescribe solo la respuesta del ítem corregido, con la misma corrección que la ingesta', async () => {
    const { db, upserts } = makeDb(true);
    const service = new AnswerSheetsService(db, new AnswerSheetPreviewStore());

    await expect(service.rescoreScannedAnswer(ORG_ID, input())).resolves.toBe(ITEM_1);

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.values).toMatchObject({
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      itemId: ITEM_1,
      value: { answer: 'B' },
      isCorrect: true,
      rawScore: '1.00',
      finalScore: '1.00',
      scoredBy: 'auto',
    });
  });

  it('una respuesta anulada queda incorrecta y con la evidencia de anulación', async () => {
    const { db, upserts } = makeDb(true);
    const service = new AnswerSheetsService(db, new AnswerSheetPreviewStore());

    await service.rescoreScannedAnswer(
      ORG_ID,
      input({ answers: { '1': null, '2': 'A' }, annulledLabels: ['1'] }),
    );

    expect(upserts[0]?.values).toMatchObject({
      itemId: ITEM_1,
      value: { answer: null, annulled: true },
      isCorrect: false,
      finalScore: '0.00',
    });
  });

  it('rechaza con 409 si la respuesta no se registró al confirmar', async () => {
    const { db, upserts } = makeDb(false);
    const service = new AnswerSheetsService(db, new AnswerSheetPreviewStore());

    await expect(service.rescoreScannedAnswer(ORG_ID, input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(upserts).toHaveLength(0);
  });

  it('rechaza con 400 una pregunta que no está en el instrumento', async () => {
    const { db } = makeDb(true);
    const service = new AnswerSheetsService(db, new AnswerSheetPreviewStore());

    await expect(
      service.rescoreScannedAnswer(ORG_ID, input({ label: '99' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
