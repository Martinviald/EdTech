import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { aiGradingJobs, responses, type Database } from '@soe/db';
import type { LayoutSpec } from '@soe/types';
import type { FilesService } from '../files/files.service';
import type { EnqueuedJob, JobDispatcher } from '../jobs/job-dispatcher';
import type { LlmService } from '../llm/llm.service';
import type { LlmImagePart } from '../llm/llm.types';
import {
  DEVELOPMENT_GRADING_BATCH_LIMIT,
  DEVELOPMENT_GRADING_JOB_TYPE,
  DEVELOPMENT_GRADING_PROMPT_VERSION,
  DevelopmentGradingService,
  type ScheduleConfirmedBatchParams,
} from './development-grading.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '33333333-3333-4333-8333-333333333333';
const INSTRUMENT_ID = '44444444-4444-4444-8444-444444444444';
const ASSESSMENT_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const STUDENT_1 = '99999999-9999-4999-8999-999999999991';
const RESPONSE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const CROP_BYTES = Buffer.from('imagen-recorte');
const CROP_BASE64 = CROP_BYTES.toString('base64');
const DEFAULT_LLM_JSON =
  '{"score": 1.5, "confidence": 0.8, "justification": "Respuesta casi completa"}';

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  innerJoin: (..._: unknown[]) => QueryChain;
  leftJoin: (..._: unknown[]) => QueryChain;
  orderBy: (..._: unknown[]) => QueryChain;
  limit: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

function makeDb(selectResults: unknown[][]): {
  db: Database;
  updates: Array<{ table: unknown; values: Record<string, unknown> }>;
  inserts: Array<{ table: unknown; rows: Array<Record<string, unknown>> }>;
  selectWheres: unknown[];
} {
  let selectIdx = 0;
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: unknown; rows: Array<Record<string, unknown>> }> = [];
  const selectWheres: unknown[] = [];

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: (condition?: unknown) => {
        selectWheres.push(condition);
        return c;
      },
      innerJoin: () => c,
      leftJoin: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: () => Promise.resolve([]) };
      },
    }),
    insert: (table: unknown) => ({
      values: (rows: Array<Record<string, unknown>>) => {
        inserts.push({ table, rows });
        return {
          returning: () =>
            Promise.resolve(rows.map((row, i) => ({ id: `job-${i + 1}`, responseId: row.responseId }))),
        };
      },
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, updates, inserts, selectWheres };
}

function makeDispatcher(): { dispatcher: JobDispatcher; jobs: EnqueuedJob[] } {
  const jobs: EnqueuedJob[] = [];
  return {
    dispatcher: { enqueue: (job) => jobs.push(job) },
    jobs,
  };
}

type LlmCall = {
  system: string;
  prompt: string;
  images: LlmImagePart[] | undefined;
  orgId: string | null | undefined;
  feature: string;
};

function makeLlm(text: string): { llm: LlmService; calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  const llm = {
    completeMultimodalWithUsage: async (
      system: string,
      prompt: string,
      images: LlmImagePart[] | undefined,
      orgId: string | null | undefined,
      feature: string,
    ) => {
      calls.push({ system, prompt, images, orgId, feature });
      return { text, model: 'gemini-2.5-pro', usage: { inputTokens: 1000, outputTokens: 100 } };
    },
  } as unknown as LlmService;
  return { llm, calls };
}

const filesServiceFake = {
  getById: async (_orgId: string, fileId: string) => ({
    id: fileId,
    storageKey: `key/${fileId}`,
    fileName: 'crop.jpg',
    mimeType: 'image/jpeg',
  }),
  buildDownloadUrl: (row: { id: string }) => `https://signed/${row.id}`,
} as unknown as FilesService;

function makeService(selects: unknown[][], llmText = DEFAULT_LLM_JSON) {
  const { db, updates, inserts, selectWheres } = makeDb(selects);
  const { dispatcher, jobs } = makeDispatcher();
  const { llm, calls: llmCalls } = makeLlm(llmText);
  const service = new DevelopmentGradingService(db, dispatcher, llm, filesServiceFake);
  return { service, updates, inserts, jobs, llmCalls, selectWheres };
}

function cropField(printedNumber: string, fieldId = `f_dev_${printedNumber}`) {
  return {
    fieldId,
    kind: 'crop_region' as const,
    printedNumber,
    pageIndex: 0,
    selectMode: 'single' as const,
    bubbles: [],
    region: { topLeft: { x: 0.1, y: 0.5 }, bottomRight: { x: 0.9, y: 0.8 } },
  };
}

function bubbleField(printedNumber: string) {
  return {
    fieldId: `f_${printedNumber}`,
    kind: 'bubble_group' as const,
    printedNumber,
    pageIndex: 0,
    selectMode: 'single' as const,
    bubbles: [
      { value: 'A', center: { x: 0.1, y: 0.2 }, radius: 0.01 },
      { value: 'B', center: { x: 0.15, y: 0.2 }, radius: 0.01 },
    ],
    region: null,
  };
}

function makeSpec(fields: LayoutSpec['fields']): LayoutSpec {
  return {
    specVersion: 1,
    instrumentId: INSTRUMENT_ID,
    pageCount: 1,
    paper: 'letter',
    fiducials: { kind: 'corner_squares', sizeRatio: 0.02, marginRatio: 0.03 },
    identity: {
      mode: 'qr',
      region: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.2, y: 0.1 } },
    },
    fields,
  };
}

const PARAMS: ScheduleConfirmedBatchParams = {
  orgId: ORG_ID,
  batchId: BATCH_ID,
  assessmentId: ASSESSMENT_ID,
  instrumentId: INSTRUMENT_ID,
  spec: makeSpec([bubbleField('1'), cropField('5')]),
};

const RUBRIC_ITEM = {
  id: ITEM_ID,
  position: 5,
  type: 'rubric_scored',
  content: {
    prompt: '¿Por qué el personaje decide volver al pueblo?',
    levels: [
      { code: '0', descriptor: 'No responde o es incorrecta', creditFraction: 0 },
      { code: '1', descriptor: 'Respuesta parcial con evidencia débil', creditFraction: 0.5 },
      { code: '2', descriptor: 'Respuesta completa con evidencia del texto', creditFraction: 1 },
    ],
  },
  scoringConfig: { points: 2 },
};

const CROP_ROW = {
  markId: 'mark-crop-1',
  printedNumber: '5',
  cropFileId: 'file-crop-1',
  sequence: 1,
  resolvedStudentId: STUDENT_1,
  sheetStudentId: null,
};

const RESPONSE_ROW = { id: RESPONSE_ID, studentId: STUDENT_1, itemId: ITEM_ID };

const HAPPY_SELECTS = [[CROP_ROW], [RUBRIC_ITEM], [RESPONSE_ROW], []];

const originalFetch = globalThis.fetch;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const arrayBuffer = CROP_BYTES.buffer.slice(
    CROP_BYTES.byteOffset,
    CROP_BYTES.byteOffset + CROP_BYTES.byteLength,
  );
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => arrayBuffer,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  warnSpy.mockRestore();
  globalThis.fetch = originalFetch;
});

async function runScheduledJob(selects: unknown[][], llmText = DEFAULT_LLM_JSON) {
  const ctx = makeService(selects, llmText);
  ctx.service.scheduleConfirmedBatch(PARAMS);
  await ctx.jobs[0].run();
  return ctx;
}

describe('DevelopmentGradingService.scheduleConfirmedBatch', () => {
  it('no encola nada cuando el layout no tiene campos crop_region', () => {
    const { service, jobs } = makeService([]);

    service.scheduleConfirmedBatch({ ...PARAMS, spec: makeSpec([bubbleField('1')]) });

    expect(jobs).toHaveLength(0);
  });

  it('encola un único job asíncrono por lote cuando el layout tiene crop_region', () => {
    const { service, jobs, llmCalls } = makeService([]);

    service.scheduleConfirmedBatch(PARAMS);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('development_grading');
    expect(jobs[0].id).toBe(BATCH_ID);
    expect(llmCalls).toHaveLength(0);
  });
});

describe('DevelopmentGradingService.processConfirmedBatch', () => {
  it('M3: sólo toma crops de scans read con hoja anclada — identity_unresolved y quality_rejected quedan fuera del query', async () => {
    const ctx = makeService([[]]);
    ctx.service.scheduleConfirmedBatch(PARAMS);
    await ctx.jobs[0].run();

    expect(ctx.inserts).toHaveLength(0);
    expect(ctx.llmCalls).toHaveLength(0);
    const cropsWhere = new PgDialect().sqlToQuery(
      ctx.selectWheres[0] as Parameters<PgDialect['sqlToQuery']>[0],
    );
    expect(cropsWhere.sql).toContain('"sheet_scans"."state" =');
    expect(cropsWhere.params).toContain('read');
    expect(cropsWhere.sql).toContain('"sheet_scans"."printed_sheet_id" is not null');
  });

  it('crea el ai_grading_job pending con el responseId y el input del recorte', async () => {
    const { inserts } = await runScheduledJob(HAPPY_SELECTS);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(aiGradingJobs);
    expect(inserts[0].rows).toEqual([
      {
        responseId: RESPONSE_ID,
        type: DEVELOPMENT_GRADING_JOB_TYPE,
        status: 'pending',
        promptVersion: DEVELOPMENT_GRADING_PROMPT_VERSION,
        input: {
          batchId: BATCH_ID,
          markId: 'mark-crop-1',
          cropFileId: 'file-crop-1',
          printedNumber: '5',
        },
      },
    ]);
  });

  it('arma el prompt con el enunciado y la pauta del ítem, y adjunta el recorte como imagen', async () => {
    const { llmCalls } = await runScheduledJob(HAPPY_SELECTS);

    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0].prompt).toContain('¿Por qué el personaje decide volver al pueblo?');
    expect(llmCalls[0].prompt).toContain('Pauta de corrección:');
    expect(llmCalls[0].prompt).toContain('Respuesta parcial con evidencia débil');
    expect(llmCalls[0].prompt).toContain('Puntaje máximo: 2');
    expect(llmCalls[0].images).toEqual([{ mimeType: 'image/jpeg', data: CROP_BASE64 }]);
    expect(llmCalls[0].orgId).toBe(ORG_ID);
    expect(llmCalls[0].feature).toBe('ai_grading');
  });

  it('escribe ai_score en la response y completa el job con score, modelo y costo', async () => {
    const { updates } = await runScheduledJob(HAPPY_SELECTS);

    const responseUpdates = updates.filter((u) => u.table === responses);
    expect(responseUpdates).toHaveLength(1);
    expect(responseUpdates[0].values.aiScore).toEqual({
      score: 1.5,
      confidence: 0.8,
      justification: 'Respuesta casi completa',
      model: 'gemini-2.5-pro',
      promptVersion: DEVELOPMENT_GRADING_PROMPT_VERSION,
    });

    const jobUpdates = updates.filter((u) => u.table === aiGradingJobs);
    expect(jobUpdates.map((u) => u.values.status)).toEqual(['processing', 'completed']);
    expect(jobUpdates[1].values).toMatchObject({
      score: '1.50',
      confidence: '0.80',
      justification: 'Respuesta casi completa',
      model: 'gemini-2.5-pro',
      costUsd: '0.002250',
    });
  });

  it('jamás escribe final_score, human_score ni scored_by: la IA sólo propone (§8.3)', async () => {
    const { updates } = await runScheduledJob(HAPPY_SELECTS);

    const responseUpdate = updates.find((u) => u.table === responses);
    expect(Object.keys(responseUpdate!.values).sort()).toEqual(['aiScore', 'updatedAt']);
    expect(responseUpdate!.values).not.toHaveProperty('finalScore');
    expect(responseUpdate!.values).not.toHaveProperty('humanScore');
    expect(responseUpdate!.values).not.toHaveProperty('scoredBy');
  });

  it('no duplica jobs cuando la response ya tiene una corrección pendiente o completada', async () => {
    const { inserts, llmCalls } = await runScheduledJob([
      [CROP_ROW],
      [RUBRIC_ITEM],
      [RESPONSE_ROW],
      [{ responseId: RESPONSE_ID, status: 'completed' }],
    ]);

    expect(inserts).toHaveLength(0);
    expect(llmCalls).toHaveLength(0);
  });

  it('reintenta la corrección cuando el job anterior quedó failed', async () => {
    const { inserts, llmCalls } = await runScheduledJob([
      [CROP_ROW],
      [RUBRIC_ITEM],
      [RESPONSE_ROW],
      [{ responseId: RESPONSE_ID, status: 'failed' }],
    ]);

    expect(inserts).toHaveLength(1);
    expect(llmCalls).toHaveLength(1);
  });

  it('aplica el límite por lote y reporta el excedente sin corregirlo en silencio', async () => {
    const total = DEVELOPMENT_GRADING_BATCH_LIMIT + 1;
    const manyItems = Array.from({ length: total }, (_, i) => ({
      ...RUBRIC_ITEM,
      id: `item-${i + 1}`,
      position: i + 1,
    }));
    const manyCrops = Array.from({ length: total }, (_, i) => ({
      ...CROP_ROW,
      markId: `mark-${i + 1}`,
      printedNumber: String(i + 1),
      cropFileId: `file-${i + 1}`,
    }));
    const manyResponses = Array.from({ length: total }, (_, i) => ({
      id: `response-${i + 1}`,
      studentId: STUDENT_1,
      itemId: `item-${i + 1}`,
    }));
    const { inserts } = await runScheduledJob([manyCrops, manyItems, manyResponses, []]);

    expect(inserts[0].rows).toHaveLength(DEVELOPMENT_GRADING_BATCH_LIMIT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 recorte(s) del lote'),
    );
  });

  it('deja el job failed cuando la salida del modelo no es JSON y no toca la response', async () => {
    const { updates } = await runScheduledJob(HAPPY_SELECTS, 'esto no es json');

    const jobUpdates = updates.filter((u) => u.table === aiGradingJobs);
    expect(jobUpdates.map((u) => u.values.status)).toEqual(['processing', 'failed']);
    expect(jobUpdates[1].values.output).toEqual({
      error: 'La salida del modelo no es JSON válido',
    });
    expect(updates.some((u) => u.table === responses)).toBe(false);
  });

  it('deja el job failed cuando el puntaje excede el máximo del ítem', async () => {
    const { updates } = await runScheduledJob(
      HAPPY_SELECTS,
      '{"score": 99, "confidence": 0.9, "justification": "x"}',
    );

    const jobUpdates = updates.filter((u) => u.table === aiGradingJobs);
    expect(jobUpdates.map((u) => u.values.status)).toEqual(['processing', 'failed']);
    expect(updates.some((u) => u.table === responses)).toBe(false);
  });

  it('tolera fences ```json``` alrededor de la salida del modelo', async () => {
    const { updates } = await runScheduledJob(
      HAPPY_SELECTS,
      '```json\n{"score": 2, "confidence": 1, "justification": "Completa"}\n```',
    );

    const responseUpdate = updates.find((u) => u.table === responses);
    expect(responseUpdate!.values.aiScore).toMatchObject({ score: 2 });
  });

  it('se salta con aviso un recorte cuyo número impreso no existe en el instrumento', async () => {
    const orphanCrop = { ...CROP_ROW, printedNumber: '99' };
    const { inserts, llmCalls } = await runScheduledJob([[orphanCrop], [RUBRIC_ITEM]]);

    expect(inserts).toHaveLength(0);
    expect(llmCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"99"'));
  });

  it('se salta con aviso un recorte sin response persistida para ese alumno e ítem', async () => {
    const { inserts, llmCalls } = await runScheduledJob([[CROP_ROW], [RUBRIC_ITEM], [], []]);

    expect(inserts).toHaveLength(0);
    expect(llmCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No existe response'));
  });
});
