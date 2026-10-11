jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { createHash } from 'node:crypto';
import { FakeTranscriber, fakeOutput, type FakeReading } from '@soe/answer-reading';
import {
  answerReadingDecisions,
  answerReadingRuns,
  answerReadings,
  grades,
  instruments,
  items,
  organizations,
  readingRoutes,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  type AnswerReadingDecision,
  type AnswerReadingRow,
  type AnswerReadingRun,
} from '@soe/db';
import {
  DEFAULT_CONSENSUS_POLICY,
  type ConsensusPolicy,
  type CropEvidence,
  type LayoutSpec,
  type ReaderSpec,
} from '@soe/types';
import * as observability from '../common/observability/report-error';
import type { FilesService } from '../files/files.service';
import type { EnqueuedJob, JobDispatcher } from '../jobs/job-dispatcher';
import type { AnswerReadingBudgetService } from './answer-reading-budget.service';
import type { AnswerReadingConsolidationService } from './answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import { AnswerReadingPipelineService } from './answer-reading-pipeline.service';
import {
  DEFAULT_ANSWER_READING_OPTIONS,
  type AnswerReadingOptions,
} from './answer-reading.constants';
import { CropReadingService } from './crop-reading.service';
import { ReadingRoutesService } from './reading-routes.service';
import type { RubricGradingService } from './rubric-grading.service';
import { InMemoryDatabase } from './testing/in-memory-database';
import type { VisionTranscriber } from './transcribers/vision-transcriber';
import { VisionTranscriberRegistry } from './transcribers/vision-transcriber.registry';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const PRINT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const LAYOUT_ID = '44444444-4444-4444-8444-444444444444';
const INSTRUMENT_ID = '55555555-5555-4555-8555-555555555555';
const ASSESSMENT_ID = '66666666-6666-4666-8666-666666666666';
const ITEM_ID = '77777777-7777-4777-8777-777777777777';
const STUDENT_ID = '88888888-8888-4888-8888-888888888888';
const GRADE_ID = '99999999-9999-4999-8999-999999999999';
const ROUTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCAN_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCAN_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MARK_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MARK_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CROP_1 = 'f1111111-1111-4111-8111-111111111111';
const CROP_2 = 'f2222222-2222-4222-8222-222222222222';
const RUBRIC_ITEM_ID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const RUBRIC_ROUTE_ID = 'abababab-abab-4bab-8bab-abababababab';
const RUBRIC_FIELD = 'f_desarrollo';
const SEQUENCE_ITEM_ID = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';
const SEQUENCE_FIELD = 'f_secuencia';
const FIELD_1 = 'f_001';
const FIELD_2 = 'f_002';

const CROP_BYTES: Record<string, string> = { [CROP_1]: 'recorte-uno', [CROP_2]: 'recorte-dos' };
const SHA_1 = sha256(CROP_BYTES[CROP_1] as string);

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text)).digest('hex');
}

function reader(key: string, family: string, overrides: Partial<ReaderSpec> = {}): ReaderSpec {
  return {
    key,
    transcriberId: 'fake',
    provider: 'anthropic',
    family,
    model: `${key}-model`,
    promptRef: 'transcribe.short-answer@2',
    hints: 'none',
    params: {
      maxOutputTokens: 2048,
      reasoning: 'off',
      mediaResolution: 'medium',
      timeoutMs: 30000,
    },
    ...overrides,
  };
}

const HAIKU = reader('haiku', 'anthropic-haiku');
const FLASH = reader('flash', 'gemini-flash-lite', { provider: 'gemini' });
const LUNA = reader('luna', 'openai-luna', { provider: 'openai' });
const SHADOW = reader('sombra', 'openai-mini', { provider: 'openai' });

const POLICY: ConsensusPolicy = { ...DEFAULT_CONSENSUS_POLICY, auditSampleRate: 0 };

function field(fieldId: string) {
  return {
    fieldId,
    kind: 'crop_region',
    printedNumber: fieldId,
    pageIndex: 0,
    selectMode: 'single',
    bubbles: [],
    region: null,
    response: {
      itemId: ITEM_ID,
      format: { kind: 'decimal', maxChars: 6, allowNegative: false },
      boxes: [],
      cropProfileId: 'short-answer@1',
    },
  };
}

const RUBRIC_FIELD_SPEC = {
  ...field(RUBRIC_FIELD),
  response: {
    itemId: RUBRIC_ITEM_ID,
    format: { kind: 'free_text', lines: 6 },
    boxes: [],
    cropProfileId: 'free-text@1',
  },
};

const SEQUENCE_FIELD_SPEC = {
  ...field(SEQUENCE_FIELD),
  response: {
    itemId: SEQUENCE_ITEM_ID,
    format: { kind: 'sequence', length: 4 },
    boxes: [],
    cropProfileId: 'short-answer@1',
  },
};

const SPEC = {
  fields: [
    field(FIELD_1),
    field(FIELD_2),
    { ...field('f_rubric'), response: undefined },
    RUBRIC_FIELD_SPEC,
    SEQUENCE_FIELD_SPEC,
  ],
} as unknown as LayoutSpec;

class FakeDispatcher implements JobDispatcher {
  readonly jobs: EnqueuedJob[] = [];

  enqueue(job: EnqueuedJob): void {
    this.jobs.push(job);
  }

  async runAll(): Promise<void> {
    while (this.jobs.length > 0) {
      const job = this.jobs.shift() as EnqueuedJob;
      await job.run();
    }
  }
}

interface SetupOptions {
  readonly readings?: Record<string, Record<string, FakeReading>>;
  readonly policy?: ConsensusPolicy;
  readonly readers?: ReaderSpec[];
  readonly shadowReaders?: ReaderSpec[];
  readonly shadowSampleRate?: string;
  readonly orgConfig?: Record<string, unknown>;
  readonly batchStatus?: string;
  readonly budgetExceeded?: boolean;
  readonly options?: Partial<AnswerReadingOptions>;
  readonly wrapTranscriber?: (fake: FakeTranscriber, memory: InMemoryDatabase) => VisionTranscriber;
  readonly marks?: Array<{
    id: string;
    fieldId: string;
    cropFileId: string | null;
    cropEvidence?: CropEvidence | null;
  }>;
}

function setup(setupOptions: SetupOptions = {}) {
  const memory = new InMemoryDatabase();
  memory.seed(organizations, [
    { id: ORG_ID, name: 'Colegio', config: setupOptions.orgConfig ?? {} },
  ]);
  memory.seed(sheetScanBatches, [
    {
      id: BATCH_ID,
      orgId: ORG_ID,
      printRunId: PRINT_RUN_ID,
      status: setupOptions.batchStatus ?? 'needs_review',
    },
  ]);
  memory.seed(sheetPrintRuns, [
    { id: PRINT_RUN_ID, orgId: ORG_ID, layoutId: LAYOUT_ID, assessmentId: ASSESSMENT_ID },
  ]);
  memory.seed(sheetLayouts, [
    { id: LAYOUT_ID, orgId: ORG_ID, instrumentId: INSTRUMENT_ID, spec: SPEC },
  ]);
  memory.seed(sheetScans, [
    { id: SCAN_1, orgId: ORG_ID, batchId: BATCH_ID, state: 'read', resolvedStudentId: STUDENT_ID },
    { id: SCAN_2, orgId: ORG_ID, batchId: BATCH_ID, state: 'read', resolvedStudentId: STUDENT_ID },
  ]);
  memory.seed(
    sheetScanMarks,
    (setupOptions.marks ?? [{ id: MARK_1, fieldId: FIELD_1, cropFileId: CROP_1 }]).map((mark) => ({
      orgId: ORG_ID,
      scanId: SCAN_1,
      cropEvidence: null,
      ...mark,
    })),
  );
  memory.seed(items, [
    {
      id: ITEM_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'short_answer',
      content: { prompt: '¿Cuánto mide?', acceptedAnswers: ['7,3'] },
      scoringConfig: { points: 1 },
    },
    {
      id: SEQUENCE_ITEM_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'short_answer',
      content: { prompt: 'Completa la secuencia', acceptedAnswers: ['2, 4, 6, 8'] },
      scoringConfig: { points: 1 },
    },
    {
      id: RUBRIC_ITEM_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'rubric_scored',
      content: {
        prompt: 'Explica por qué se inundó el pueblo.',
        levels: [
          { code: '0', creditFraction: 0 },
          { code: '1', creditFraction: 0.5 },
          { code: '2', creditFraction: 1 },
        ],
      },
      scoringConfig: { points: 2 },
    },
  ]);
  memory.seed(instruments, [{ id: INSTRUMENT_ID, subjectId: null, gradeId: GRADE_ID }]);
  memory.seed(grades, [{ id: GRADE_ID, name: '7° básico' }]);
  memory.seed(readingRoutes, [
    {
      id: ROUTE_ID,
      orgId: null,
      status: 'active',
      level: 'default',
      readers: setupOptions.readers ?? [HAIKU, FLASH],
      fallbackReaders: [],
      shadowReaders: setupOptions.shadowReaders ?? [],
      shadowSampleRate: setupOptions.shadowSampleRate ?? '0',
      policy: setupOptions.policy ?? POLICY,
      version: 1,
    },
  ]);

  memory.unique(answerReadings, ['orgId', 'readingKey', 'readerKey', 'mode', 'attempt']);
  const db = memory.asDatabase();
  const transcriber = new FakeTranscriber({ byReader: setupOptions.readings ?? {} });
  const activeTranscriber = setupOptions.wrapTranscriber?.(transcriber, memory) ?? transcriber;
  const files = {
    getById: jest.fn(async (_orgId: string, fileId: string) => ({
      id: fileId,
      mimeType: 'image/jpeg',
      storageKey: `crops/${fileId}`,
      fileName: null,
    })),
    buildDownloadUrl: jest.fn((record: { id: string }) => `https://s3.example/${record.id}`),
  } as unknown as FilesService;
  const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const fileId = String(url).split('/').pop() as string;
    const bytes = Buffer.from(CROP_BYTES[fileId] ?? '');
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response;
  });
  const isExceeded = jest.fn().mockResolvedValue(setupOptions.budgetExceeded ?? false);
  const budget = { isExceeded } as unknown as AnswerReadingBudgetService;
  const options: AnswerReadingOptions = {
    ...DEFAULT_ANSWER_READING_OPTIONS,
    retryDelayMs: 0,
    ...setupOptions.options,
  };
  const dispatcher = new FakeDispatcher();
  const consolidateDecisions = jest.fn().mockResolvedValue({
    scored: [],
    pending: [],
    skipped: [],
    recalculatedAssessmentIds: [],
  });
  const consolidation = { consolidateDecisions } as unknown as AnswerReadingConsolidationService;
  const scheduleRubricGrading = jest.fn();
  const rubricGrading = {
    scheduleForDecisions: scheduleRubricGrading,
  } as unknown as RubricGradingService;
  const pipeline = new AnswerReadingPipelineService(
    db,
    dispatcher,
    new ReadingRoutesService(db),
    new CropReadingService(db, files, new VisionTranscriberRegistry([activeTranscriber]), options),
    new AnswerReadingDecisionsService(db),
    budget,
    consolidation,
    rubricGrading,
    options,
  );
  const runScan = async (scanId = SCAN_1) => {
    pipeline.scheduleForScan({ orgId: ORG_ID, batchId: BATCH_ID, scanId });
    await dispatcher.runAll();
  };
  return {
    memory,
    pipeline,
    transcriber,
    dispatcher,
    fetchSpy,
    isExceeded,
    runScan,
    consolidateDecisions,
    scheduleRubricGrading,
  };
}

function readingsOf(memory: InMemoryDatabase): AnswerReadingRow[] {
  return memory.rows<AnswerReadingRow>(answerReadings);
}

function decisionsOf(memory: InMemoryDatabase): AnswerReadingDecision[] {
  return memory.rows<AnswerReadingDecision>(answerReadingDecisions);
}

function currentDecision(memory: InMemoryDatabase, markId = MARK_1): AnswerReadingDecision {
  const current = decisionsOf(memory).filter(
    (decision) => decision.markId === markId && decision.supersededById === null,
  );
  expect(current).toHaveLength(1);
  return current[0] as AnswerReadingDecision;
}

function runOf(memory: InMemoryDatabase): AnswerReadingRun {
  const runs = memory.rows<AnswerReadingRun>(answerReadingRuns);
  expect(runs).toHaveLength(1);
  return runs[0] as AnswerReadingRun;
}

function sequenceParts(literal: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const [index, element] of literal.split(',').entries()) {
    parts[`e${index + 1}`] = element.trim();
  }
  return parts;
}

function sequenceOutput(literal: string) {
  return fakeOutput(literal, { parts: sequenceParts(literal) });
}

const agree = {
  haiku: { [SHA_1]: fakeOutput('7,3') },
  flash: { [SHA_1]: fakeOutput('7.3') },
};

let reportSpy: jest.SpyInstance;

beforeEach(() => {
  reportSpy = jest.spyOn(observability, 'reportServerError').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AnswerReadingPipelineService — punta a punta del job', () => {
  it('dos lectores de familias distintas que coinciden → auto_accepted, sin que el lector vea la clave', async () => {
    const { memory, transcriber, runScan } = setup({ readings: agree });

    await runScan();

    expect(transcriber.calls).toHaveLength(2);
    for (const call of transcriber.calls) {
      expect(call.prompt.system).not.toContain('7,3');
      expect(call.prompt.user).not.toContain('7,3');
      expect(call.image.sha256).toBe(SHA_1);
    }
    const readings = readingsOf(memory);
    expect(readings).toHaveLength(2);
    expect(readings.map((row) => [row.readerKey, row.mode, row.status, row.attempt])).toEqual(
      expect.arrayContaining([
        ['haiku', 'primary', 'ok', 1],
        ['flash', 'primary', 'ok', 1],
      ]),
    );
    expect(readings[0]).toMatchObject({
      markId: MARK_1,
      itemId: ITEM_ID,
      cropFileId: CROP_1,
      cropSha256: SHA_1,
      cropProfileId: 'short-answer@1',
      routeId: ROUTE_ID,
      promptRef: 'transcribe.short-answer@2',
      literal: expect.any(String),
    });
    const decision = currentDecision(memory);
    expect(decision).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'correct',
      reasons: [],
      reviewMode: null,
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      routeId: ROUTE_ID,
      routeVersion: 1,
      canonical: expect.any(String),
    });
    expect(new Set(decision.usedReadingIds)).toEqual(new Set(readings.map((row) => row.id)));
    expect(runOf(memory)).toMatchObject({
      batchId: BATCH_ID,
      assessmentId: ASSESSMENT_ID,
      trigger: 'scan_processed',
      status: 'completed',
      cropsTotal: 1,
      cropsDone: 1,
      autoAccepted: 1,
      needsReview: 0,
    });
  });

  it('dos lectores que discrepan → needs_review en modo lectura', async () => {
    const { memory, runScan } = setup({
      readings: { haiku: { [SHA_1]: fakeOutput('7,3') }, flash: { [SHA_1]: fakeOutput('8,3') } },
    });

    await runScan();

    expect(currentDecision(memory)).toMatchObject({
      outcome: 'needs_review',
      reasons: ['readers_disagree'],
      reviewMode: 'reading',
      value: null,
    });
    expect(runOf(memory)).toMatchObject({ status: 'completed', autoAccepted: 0, needsReview: 1 });
  });

  it('el consenso corrige con el formato derivado del ítem: una alternativa que cambia el resultado va a revisión', async () => {
    const withAlternative = {
      ...sequenceOutput('2, 4, 6, 8'),
      alternativeReadings: [
        { literal: '2, 4, 6, 9', parts: sequenceParts('2, 4, 6, 9'), plausibility: 0.4 },
      ],
    };
    const { memory, runScan } = setup({
      readings: {
        haiku: { [SHA_1]: withAlternative },
        flash: { [SHA_1]: sequenceOutput('2, 4, 6, 8') },
      },
      marks: [{ id: MARK_1, fieldId: SEQUENCE_FIELD, cropFileId: CROP_1 }],
    });

    await runScan();

    expect(currentDecision(memory)).toMatchObject({
      outcome: 'needs_review',
      reasons: ['alternative_flips_outcome'],
      scoringOutcome: 'correct',
    });
  });

  it('una secuencia bien leída sale correcta en la decisión, igual que en la consolidación', async () => {
    const { memory, runScan } = setup({
      readings: {
        haiku: { [SHA_1]: sequenceOutput('2, 4, 6, 8') },
        flash: { [SHA_1]: sequenceOutput('2,4,6,8') },
      },
      marks: [{ id: MARK_1, fieldId: SEQUENCE_FIELD, cropFileId: CROP_1 }],
    });

    await runScan();

    expect(currentDecision(memory)).toMatchObject({
      outcome: 'auto_accepted',
      scoringOutcome: 'correct',
    });
  });

  it('ignora los campos de recorte sin formato de lectura por visión de respuesta corta', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: agree,
      marks: [{ id: MARK_2, fieldId: 'f_rubric', cropFileId: CROP_2 }],
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(0);
    expect(decisionsOf(memory)).toHaveLength(0);
    expect(memory.rows(answerReadingRuns)).toHaveLength(0);
  });
});

describe('AnswerReadingPipelineService — respuestas de desarrollo', () => {
  const SHA_2 = sha256(CROP_BYTES[CROP_2] as string);
  const FREE_TEXT_HAIKU = reader('haiku-texto', 'anthropic-haiku', {
    promptRef: 'transcribe.free-text@1',
  });

  function seedRubricRoute(memory: InMemoryDatabase): void {
    memory.seed(readingRoutes, [
      {
        id: RUBRIC_ROUTE_ID,
        orgId: null,
        status: 'active',
        level: 'format',
        formatKind: 'free_text',
        readers: [FREE_TEXT_HAIKU],
        fallbackReaders: [],
        shadowReaders: [],
        shadowSampleRate: '0',
        policy: { ...POLICY, id: 'rubric-transcription', minReaders: 1 },
        version: 1,
      },
    ]);
  }

  it('transcribe con su ruta de formato y nunca autoacepta: queda en revisión por rúbrica con la transcripción', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: {
        'haiku-texto': {
          [SHA_2]: { ...fakeOutput('Porque el río\nse desbordó'), confidence: 0.99 },
        },
      },
      marks: [{ id: MARK_2, fieldId: RUBRIC_FIELD, cropFileId: CROP_2 }],
    });
    seedRubricRoute(memory);

    await runScan();

    expect(transcriber.calls).toHaveLength(1);
    expect(transcriber.calls[0]?.prompt.ref).toBe('transcribe.free-text@1');
    const decision = currentDecision(memory, MARK_2);
    expect(decision).toMatchObject({
      outcome: 'needs_review',
      itemId: RUBRIC_ITEM_ID,
      scoringOutcome: null,
      reviewMode: 'grading',
      routeId: RUBRIC_ROUTE_ID,
    });
    expect(decision.reasons).toContain('rubric_item');
    expect(decision.value).toMatchObject({
      formatKind: 'free_text',
      value: { type: 'text', text: 'Porque el río\nse desbordó' },
    });
    expect(runOf(memory)).toMatchObject({ autoAccepted: 0, needsReview: 1 });
  });

  it('una ruta cuyo prompt no transcribe desarrollo no se usa: queda sin leer y sin llamar al modelo', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: agree,
      marks: [{ id: MARK_2, fieldId: RUBRIC_FIELD, cropFileId: CROP_2 }],
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(0);
    expect(currentDecision(memory, MARK_2)).toMatchObject({
      outcome: 'not_read',
      reasons: ['insufficient_readers'],
    });
  });
});

describe('AnswerReadingPipelineService — idempotencia', () => {
  it('reprocesar el mismo recorte reutiliza las lecturas ok sin llamar de nuevo al modelo', async () => {
    const { memory, transcriber, runScan } = setup({ readings: agree });

    await runScan();
    await runScan();

    expect(transcriber.calls).toHaveLength(2);
    expect(readingsOf(memory)).toHaveLength(2);
    expect(decisionsOf(memory)).toHaveLength(1);
    expect(runOf(memory)).toMatchObject({ cropsTotal: 2, cropsDone: 2, autoAccepted: 2 });
  });

  it('otra marca con el mismo recorte reutiliza las lecturas y crea su propia decisión', async () => {
    const { memory, transcriber, runScan } = setup({ readings: agree });
    await runScan();
    memory.seed(sheetScanMarks, [
      { id: MARK_2, orgId: ORG_ID, scanId: SCAN_2, fieldId: FIELD_1, cropFileId: CROP_1 },
    ]);

    await runScan(SCAN_2);

    expect(transcriber.calls).toHaveLength(2);
    expect(currentDecision(memory, MARK_2)).toMatchObject({ outcome: 'auto_accepted' });
  });
});

describe('AnswerReadingPipelineService — interruptor y presupuesto', () => {
  it('con allowExternalVision: false no llama a ningún transcriptor y deja not_read', async () => {
    const { memory, transcriber, fetchSpy, runScan } = setup({
      readings: agree,
      orgConfig: { answerReading: { allowExternalVision: false } },
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'not_read',
      reasons: ['external_vision_disabled'],
      reviewMode: 'reading',
    });
    expect(runOf(memory)).toMatchObject({ status: 'completed', needsReview: 1 });
  });

  it('con la lectura apagada por la org no llama a modelos y lo explica', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: agree,
      orgConfig: { answerReading: { enabled: false } },
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(0);
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'not_read',
      reasons: ['reading_disabled'],
    });
  });

  it('con el presupuesto excedido no llama a modelos y marca la corrida', async () => {
    const { memory, transcriber, isExceeded, runScan } = setup({
      readings: agree,
      budgetExceeded: true,
    });

    await runScan();

    expect(isExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, plannedReadings: 2 }),
    );
    expect(transcriber.calls).toHaveLength(0);
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'not_read',
      reasons: ['budget_exceeded'],
      reviewMode: 'reading',
    });
    expect(runOf(memory)).toMatchObject({ status: 'budget_exceeded', cropsDone: 1 });
  });

  it('respeta el tope de recortes por corrida sin dejar recortes en silencio', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: agree,
      options: { maxCropsPerRun: 1 },
      marks: [
        { id: MARK_1, fieldId: FIELD_1, cropFileId: CROP_1 },
        { id: MARK_2, fieldId: FIELD_2, cropFileId: CROP_2 },
      ],
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(2);
    expect(currentDecision(memory, MARK_1).outcome).toBe('auto_accepted');
    expect(currentDecision(memory, MARK_2)).toMatchObject({
      outcome: 'not_read',
      reasons: ['run_limit_exceeded'],
    });
    expect(runOf(memory)).toMatchObject({
      cropsTotal: 2,
      cropsDone: 2,
      autoAccepted: 1,
      needsReview: 1,
    });
  });
});

describe('AnswerReadingPipelineService — blanco por tinta', () => {
  it('con inkRatio bajo el umbral de la política decide auto_blank sin llamar modelos ni descargar', async () => {
    const { memory, transcriber, fetchSpy, runScan } = setup({
      readings: agree,
      policy: { ...POLICY, blankByInkBelow: 0.02 },
      marks: [
        {
          id: MARK_1,
          fieldId: FIELD_1,
          cropFileId: CROP_1,
          cropEvidence: {
            cropProfileId: 'short-answer@1',
            inkRatio: 0.004,
            widthPx: 1000,
            heightPx: 300,
            sha256: SHA_1,
          },
        },
      ],
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'auto_blank',
      scoringOutcome: 'incorrect',
      reasons: [],
    });
    expect(runOf(memory)).toMatchObject({ autoAccepted: 1, needsReview: 0 });
  });
});

describe('AnswerReadingPipelineService — desempate y sombra', () => {
  it('ante un desacuerdo corre el lector de desempate y acepta el valor de la mayoría', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: {
        haiku: { [SHA_1]: fakeOutput('7,3') },
        flash: { [SHA_1]: fakeOutput('8,3') },
        luna: { [SHA_1]: fakeOutput('7.3') },
      },
      policy: { ...POLICY, onDisagreement: 'tiebreak_reader', tiebreakReader: LUNA },
    });

    await runScan();

    expect(transcriber.calls.map((call) => call.reader.key)).toEqual(
      expect.arrayContaining(['haiku', 'flash', 'luna']),
    );
    const tiebreak = readingsOf(memory).find((row) => row.readerKey === 'luna');
    expect(tiebreak?.mode).toBe('tiebreak');
    const decision = currentDecision(memory);
    expect(decision).toMatchObject({ outcome: 'auto_accepted', scoringOutcome: 'correct' });
    expect(decision.usedReadingIds).toContain(tiebreak?.id);
  });

  it('el lector en sombra se guarda con modo shadow y nunca entra al consenso', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: { ...agree, sombra: { [SHA_1]: fakeOutput('9,9') } },
      shadowReaders: [SHADOW],
      shadowSampleRate: '1',
    });

    await runScan();

    expect(transcriber.calls).toHaveLength(3);
    const shadow = readingsOf(memory).find((row) => row.readerKey === 'sombra');
    expect(shadow).toMatchObject({ mode: 'shadow', status: 'ok' });
    const decision = currentDecision(memory);
    expect(decision.outcome).toBe('auto_accepted');
    expect(decision.usedReadingIds).not.toContain(shadow?.id);
  });

  it('con tasa de muestreo 0 el lector en sombra no corre', async () => {
    const { transcriber, runScan } = setup({
      readings: agree,
      shadowReaders: [SHADOW],
      shadowSampleRate: '0',
    });

    await runScan();

    expect(transcriber.calls.map((call) => call.reader.key)).not.toContain('sombra');
  });
});

describe('AnswerReadingPipelineService — reemplazo de la decisión vigente', () => {
  it('una decisión distinta reemplaza a la vigente con superseded_by_id, sin borrar la anterior', async () => {
    const { memory, runScan } = setup({ readings: agree });
    memory.seed(answerReadingDecisions, [
      {
        id: 'abababab-abab-4bab-8bab-abababababab',
        orgId: ORG_ID,
        runId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
        markId: MARK_1,
        itemId: ITEM_ID,
        outcome: 'not_read',
        reasons: ['external_vision_disabled'],
        policyId: POLICY.id,
        policyVersion: POLICY.version,
        usedReadingIds: [],
        supersededById: null,
      },
    ]);

    await runScan();

    const all = decisionsOf(memory).filter((decision) => decision.markId === MARK_1);
    expect(all).toHaveLength(2);
    const current = currentDecision(memory);
    const previous = all.find((decision) => decision.id !== current.id);
    expect(previous?.supersededById).toBe(current.id);
    expect(current.outcome).toBe('auto_accepted');
  });
});

describe('AnswerReadingPipelineService — lectores que fallan', () => {
  it('reintenta una vez un error transitorio y guarda cada intento como fila nueva', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: {
        haiku: { [SHA_1]: { status: 'error', errorCode: 'provider_unavailable' } },
        flash: { [SHA_1]: fakeOutput('7,3') },
      },
    });

    await runScan();

    const haiku = readingsOf(memory).filter((row) => row.readerKey === 'haiku');
    expect(haiku.map((row) => [row.attempt, row.status])).toEqual([
      [1, 'error'],
      [2, 'error'],
    ]);
    expect(transcriber.calls.filter((call) => call.reader.key === 'haiku')).toHaveLength(2);
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'needs_review',
      reasons: ['reader_failed'],
      reviewMode: 'reading',
    });
    expect(reportSpy).toHaveBeenCalled();
  });

  it('si otra corrida guardó la misma lectura mientras se leía, la llamada pagada se registra como el intento siguiente con su costo', async () => {
    let collided = false;
    const { memory, runScan } = setup({
      readings: agree,
      wrapTranscriber: (fake, store) => ({
        id: fake.id,
        supports: (spec) => fake.supports(spec),
        transcribe: async (request) => {
          const result = await fake.transcribe(request);
          if (!collided && request.reader.key === 'haiku') {
            collided = true;
            store.seed(answerReadings, [
              {
                orgId: ORG_ID,
                readingKey: request.readingKey,
                readerKey: 'haiku',
                mode: 'primary',
                attempt: 1,
                status: 'ok',
                output: result.output,
                family: 'anthropic-haiku',
                costUsd: '0.002000',
              },
            ]);
          }
          return { ...result, costUsd: 0.002 };
        },
      }),
    });

    await runScan();

    const haiku = readingsOf(memory)
      .filter((row) => row.readerKey === 'haiku')
      .map((row) => [row.attempt, row.costUsd, row.status]);
    expect(haiku).toEqual(
      expect.arrayContaining([
        [1, '0.002000', 'ok'],
        [2, '0.002000', 'ok'],
      ]),
    );
    expect(currentDecision(memory)).toMatchObject({ outcome: 'auto_accepted' });
    expect(Number(runOf(memory).costUsd)).toBeCloseTo(0.004, 6);
  });

  it('una salida inválida no se reintenta con el mismo lector', async () => {
    const { memory, transcriber, runScan } = setup({
      readings: {
        haiku: { [SHA_1]: { status: 'invalid_output' } },
        flash: { [SHA_1]: fakeOutput('7,3') },
      },
    });

    await runScan();

    expect(transcriber.calls.filter((call) => call.reader.key === 'haiku')).toHaveLength(1);
    expect(currentDecision(memory).reasons).toEqual(['reader_failed']);
  });

  it('un nuevo procesamiento tras un fallo vuelve a leer con el intento siguiente', async () => {
    const readings: Record<string, Record<string, FakeReading>> = {
      haiku: { [SHA_1]: { status: 'refused' } },
      flash: { [SHA_1]: fakeOutput('7,3') },
    };
    const { memory, runScan } = setup({ readings });
    await runScan();
    readings.haiku = { [SHA_1]: fakeOutput('7,3') };

    await runScan();

    const haiku = readingsOf(memory).filter((row) => row.readerKey === 'haiku');
    expect(haiku.map((row) => [row.attempt, row.status])).toEqual([
      [1, 'refused'],
      [2, 'ok'],
    ]);
    expect(currentDecision(memory).outcome).toBe('auto_accepted');
  });

  it('un recorte que no se puede descargar queda not_read con motivo explícito', async () => {
    const { memory, transcriber, fetchSpy, runScan } = setup({ readings: agree });
    fetchSpy.mockResolvedValue({ ok: false, status: 403 } as Response);

    await runScan();

    expect(transcriber.calls).toHaveLength(0);
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'not_read',
      reasons: ['crop_unavailable'],
    });
  });
});

describe('AnswerReadingPipelineService — lectura tardía', () => {
  it('con el lote ya confirmado consolida en responses las decisiones nuevas', async () => {
    const { memory, runScan, consolidateDecisions } = setup({
      readings: agree,
      batchStatus: 'confirmed',
    });

    await runScan();

    expect(consolidateDecisions).toHaveBeenCalledTimes(1);
    expect(consolidateDecisions).toHaveBeenCalledWith(ORG_ID, [currentDecision(memory).id]);
  });

  it('con el lote ya confirmado agenda la calificación con rúbrica de las decisiones nuevas', async () => {
    const { memory, runScan, scheduleRubricGrading } = setup({
      readings: agree,
      batchStatus: 'confirmed',
    });

    await runScan();

    expect(scheduleRubricGrading).toHaveBeenCalledWith(ORG_ID, [currentDecision(memory).id]);
  });

  it('con el lote en revisión no consolida: la confirmación se encarga', async () => {
    const { runScan, consolidateDecisions, scheduleRubricGrading } = setup({ readings: agree });

    await runScan();

    expect(consolidateDecisions).not.toHaveBeenCalled();
    expect(scheduleRubricGrading).not.toHaveBeenCalled();
  });

  it('reprocesar sin cambios en la decisión no vuelve a consolidar', async () => {
    const { runScan, consolidateDecisions } = setup({
      readings: agree,
      batchStatus: 'confirmed',
    });

    await runScan();
    await runScan();

    expect(consolidateDecisions).toHaveBeenCalledTimes(1);
  });
});

describe('AnswerReadingPipelineService.scheduleForScan', () => {
  it('encola un solo job por lote y procesa en orden las hojas que llegan mientras tanto', async () => {
    const { dispatcher, pipeline } = setup({ readings: agree });
    const processScan = jest.spyOn(pipeline, 'processScan').mockResolvedValue(undefined);

    pipeline.scheduleForScan({ orgId: ORG_ID, batchId: BATCH_ID, scanId: SCAN_1 });
    pipeline.scheduleForScan({ orgId: ORG_ID, batchId: BATCH_ID, scanId: SCAN_2 });

    expect(dispatcher.jobs).toHaveLength(1);
    expect(dispatcher.jobs[0]).toMatchObject({ id: BATCH_ID, kind: 'answer_reading' });
    await dispatcher.runAll();
    expect(processScan.mock.calls.map((call) => call[2])).toEqual([SCAN_1, SCAN_2]);

    pipeline.scheduleForScan({ orgId: ORG_ID, batchId: BATCH_ID, scanId: SCAN_1 });
    expect(dispatcher.jobs).toHaveLength(1);
  });

  it('nunca lanza: un error al encolar se reporta y no rompe el procesamiento de la hoja', () => {
    const { dispatcher, pipeline } = setup();
    jest.spyOn(dispatcher, 'enqueue').mockImplementation(() => {
      throw new Error('cola caída');
    });

    expect(() =>
      pipeline.scheduleForScan({ orgId: ORG_ID, batchId: BATCH_ID, scanId: SCAN_1 }),
    ).not.toThrow();
    expect(reportSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scanId: SCAN_1 }),
    );
  });

  it('un error inesperado del job marca la corrida como fallida y se reporta', async () => {
    const { memory, pipeline } = setup({ readings: agree });
    jest.spyOn(ReadingRoutesService.prototype, 'loadCatalog').mockRejectedValue(new Error('rutas'));

    await pipeline.processScan(ORG_ID, BATCH_ID, SCAN_1);

    expect(runOf(memory)).toMatchObject({ status: 'failed' });
    expect(reportSpy).toHaveBeenCalled();
  });

  it('si el job falla, cada recorte sin decisión queda not_read con motivo explícito', async () => {
    const { memory, pipeline, transcriber } = setup({ readings: agree });
    jest.spyOn(ReadingRoutesService.prototype, 'loadCatalog').mockRejectedValue(new Error('rutas'));

    await pipeline.processScan(ORG_ID, BATCH_ID, SCAN_1);

    expect(transcriber.calls).toHaveLength(0);
    expect(currentDecision(memory)).toMatchObject({
      outcome: 'not_read',
      reasons: ['reader_failed'],
      reviewMode: 'reading',
    });
    expect(runOf(memory)).toMatchObject({ status: 'failed' });
  });

  it('si no se pudo guardar la decisión leída, el recorte igual queda con una decisión not_read', async () => {
    const { memory, runScan } = setup({ readings: agree });
    jest
      .spyOn(AnswerReadingDecisionsService.prototype, 'save')
      .mockRejectedValueOnce(new Error('bd'));

    await runScan();

    expect(currentDecision(memory)).toMatchObject({
      outcome: 'not_read',
      reasons: ['reader_failed'],
    });
    expect(runOf(memory)).toMatchObject({ status: 'completed' });
  });
});

describe('AnswerReadingPipelineService — consulta para la confirmación', () => {
  it('devuelve la decisión vigente por marca', async () => {
    const { pipeline, runScan } = setup({ readings: agree });
    await runScan();

    const decisions = await pipeline.currentDecisionsForMarks(ORG_ID, [MARK_1, MARK_2]);

    expect([...decisions.keys()]).toEqual([MARK_1]);
    expect(decisions.get(MARK_1)?.outcome).toBe('auto_accepted');
  });
});
