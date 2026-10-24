import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  createDbClient,
  decisionCalls,
  decisionSettings,
  instruments,
  items,
  organizations,
  printedSheets,
  responses,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  students,
  users,
  type Database,
} from '@soe/db';
import {
  JEV_LIMITS,
  JevDecisionEngine,
  OpenAiDecisionEngine,
  type ChoiceAnswer,
  type DecisionEngine,
} from '@soe/decisions';
import {
  DEFAULT_CAPTURE_PROFILES,
  layoutHash,
  type LayoutField,
  type LayoutSpec,
  type MarkAiResolution,
} from '@soe/types';
import { AnswerSheetsService } from '../answer-sheets/answer-sheets.service';
import { AnswerSheetPreviewStore } from '../answer-sheets/lib/preview-store';
import { AssessmentResultsService } from '../assessment-results/assessment-results.service';
import type { AnswerReadingConsolidationService } from '../answer-reading/answer-reading-consolidation.service';
import type { RubricGradingService } from '../answer-reading/rubric-grading.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { DecisionCallsRecorder } from '../decisions/decision-calls.recorder';
import { DecisionsConfigService } from '../decisions/decisions-config.service';
import { DecisionsService } from '../decisions/decisions.service';
import type { FilesService } from '../files/files.service';
import type { DevelopmentGradingService } from './development-grading.service';
import {
  MARK_DISAMBIGUATION_AUDIT_RATE,
  MarkDisambiguationService,
  type MarkDisambiguationCandidate,
} from './mark-disambiguation.service';
import { ScanReviewService, createAnswerSheetConfirmer } from './scan-review.service';
import { SheetScanService } from './sheet-scan.service';

const ADMIN_URL = process.env.MARK_AI_E2E_ADMIN_URL;
const APP_URL = process.env.MARK_AI_E2E_APP_URL;
const POC_DIR = process.env.MARK_AI_E2E_POC_DIR;
const REAL_ENGINES = process.env.MARK_AI_E2E_REAL_ENGINES === '1';
const ENABLED = Boolean(ADMIN_URL && APP_URL && POC_DIR);

const OPTIONS = ['A', 'B', 'C', 'D'];
const THRESHOLDS = {
  jev: { agree: 0.6, solo: 0.85, unsure: 0.5 },
  openai: { agree: 0.5, solo: 0.8, unsure: 0.5 },
};

interface PocRow {
  id: string;
  truth: string;
  omr_state: 'multiple' | 'ambiguous';
  crop: string;
}

interface Plan {
  fieldId: string;
  poc: string;
  jev: [string, number];
  openai: [string, number];
  preset?: 'human' | 'omr_annulled';
}

const PLAN: Plan[] = [
  { fieldId: 'q1', poc: 'IMG_1620_q20', jev: ['B', 0.99], openai: ['B', 0.98] },
  { fieldId: 'q2', poc: 'IMG_1619_q23', jev: ['B', 0.94], openai: ['null', 0.27] },
  { fieldId: 'q3', poc: 'IMG_1626_q12', jev: ['null', 0.83], openai: ['B', 0.46] },
  { fieldId: 'q4', poc: 'IMG_1619_q12', jev: ['null', 0.87], openai: ['B', 0.33] },
  { fieldId: 'q5', poc: 'IMG_1626_q23', jev: ['B', 0.9], openai: ['B', 0.9], preset: 'human' },
  {
    fieldId: 'q6',
    poc: 'old-captura-1_q01',
    jev: ['null', 0.95],
    openai: ['null', 0.9],
    preset: 'omr_annulled',
  },
];

function nonAuditedMarkId(): string {
  for (;;) {
    const id = randomUUID();
    const bucket =
      parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) / 2 ** 32;
    if (bucket >= MARK_DISAMBIGUATION_AUDIT_RATE) return id;
  }
}

function bubbleField(fieldId: string, index: number): LayoutField {
  return {
    fieldId,
    kind: 'bubble_group',
    printedNumber: String(index + 1),
    pageIndex: 0,
    selectMode: 'single',
    region: null,
    bubbles: OPTIONS.map((value, column) => ({
      value,
      center: { x: 0.2 + column * 0.05, y: 0.3 + index * 0.05 },
      radius: 0.012,
    })),
  };
}

function answer(choice: string, confidence: number): ChoiceAnswer<string> {
  const probabilities: Record<string, number> = {};
  for (const key of [...OPTIONS, 'blank', 'null']) probabilities[key] = 0;
  probabilities[choice] = confidence;
  return { type: 'choice', choice, confidence, probabilities };
}

function fakeEngines(byImage: Map<string, Plan>): DecisionEngine[] {
  const make = (slot: 'jev' | 'openai'): DecisionEngine => ({
    name: slot,
    capabilities: { images: true },
    limits: { ...JEV_LIMITS, imageConstraints: null },
    isAvailable: () => true,
    evaluate: async (request) => {
      const image = request.images?.[0];
      const plan = image && 'data' in image ? byImage.get(image.data) : undefined;
      if (!plan) throw new Error('imagen desconocida');
      const [choice, confidence] = plan[slot];
      return {
        answers: { respuesta: answer(choice, confidence) } as never,
        model: slot === 'jev' ? 'jev-1.14.0' : 'gpt-6-luna',
        usage: { inputTokens: 10, outputTokens: 1 },
        latencyMs: 1,
        engine: slot,
      };
    },
  });
  return [make('jev'), make('openai')];
}

const describeE2e = ENABLED ? describe : describe.skip;

describeE2e('desambiguación de marcas con IA contra una BDD local (opt-in)', () => {
  jest.setTimeout(180_000);

  let admin: Database;
  let app: Database;
  const ids = {
    org: '',
    user: '',
    instrument: '',
    assessment: '',
    student: '',
    layout: '',
    run: '',
    sheet: '',
    batch: '',
    scan: '',
  };
  const markIds = new Map<string, string>();
  const itemIds = new Map<string, string>();
  let spec: LayoutSpec;
  let candidates: MarkDisambiguationCandidate[] = [];
  let byImage = new Map<string, Plan>();
  const user = (): JwtPayload => ({
    userId: ids.user,
    orgId: ids.org,
    email: 'e2e@colegio.cl',
    name: 'Profesora E2E',
    isPlatformAdmin: false,
    roles: ['eval_coordinator'],
    activeRole: 'eval_coordinator',
    role: 'eval_coordinator',
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    if (REAL_ENGINES) {
      loadDotenv({ path: process.env.MARK_AI_E2E_ENV_FILE ?? resolve(POC_DIR ?? '', '.env') });
    }
    admin = createDbClient(ADMIN_URL ?? '', { maxConnections: 2 });
    app = createDbClient(APP_URL ?? '', { maxConnections: 4 });

    const sample = JSON.parse(
      readFileSync(resolve(POC_DIR ?? '', 'sample-100.json'), 'utf8'),
    ) as PocRow[];
    const pocById = new Map(sample.map((row) => [row.id, row]));

    const [org] = await admin
      .insert(organizations)
      .values({ type: 'school', name: 'Colegio E2E marcas IA' })
      .returning({ id: organizations.id });
    ids.org = org?.id ?? '';
    const [reviewer] = await admin
      .insert(users)
      .values({
        email: `e2e-${Date.now()}@colegio.cl`,
        name: 'Profesora E2E',
        provider: 'google',
        providerId: `e2e-${Date.now()}`,
      })
      .returning({ id: users.id });
    ids.user = reviewer?.id ?? '';
    const [instrument] = await admin
      .insert(instruments)
      .values({ orgId: ids.org, name: 'Prueba E2E', type: 'dia' })
      .returning({ id: instruments.id });
    ids.instrument = instrument?.id ?? '';
    for (const [index, plan] of PLAN.entries()) {
      const truth = pocById.get(plan.poc)?.truth;
      const correctKey = truth && OPTIONS.includes(truth) ? truth : 'A';
      const [item] = await admin
        .insert(items)
        .values({
          orgId: ids.org,
          instrumentId: ids.instrument,
          position: index + 1,
          type: 'multiple_choice',
          status: 'published',
          content: {
            stem: `Pregunta ${index + 1}`,
            alternatives: OPTIONS.map((key) => ({
              key,
              text: key,
              isCorrect: key === correctKey,
            })),
          } as never,
        })
        .returning({ id: items.id });
      itemIds.set(plan.fieldId, item?.id ?? '');
    }
    const [student] = await admin
      .insert(students)
      .values({ orgId: ids.org, rut: '11111111-1', firstName: 'Ana', lastName: 'Pérez' })
      .returning({ id: students.id });
    ids.student = student?.id ?? '';
    const [assessment] = await admin
      .insert(assessments)
      .values({
        orgId: ids.org,
        instrumentId: ids.instrument,
        name: 'Evaluación E2E',
        mode: 'paper',
        status: 'completed',
      })
      .returning({ id: assessments.id });
    ids.assessment = assessment?.id ?? '';

    spec = {
      specVersion: 1,
      instrumentId: ids.instrument,
      pageCount: 1,
      paper: 'letter',
      fiducials: { kind: 'corner_squares', sizeRatio: 0.03, marginRatio: 0.02 },
      identity: {
        mode: 'qr',
        region: { topLeft: { x: 0.78, y: 0.02 }, bottomRight: { x: 0.98, y: 0.18 } },
      },
      fields: PLAN.map((plan, index) => bubbleField(plan.fieldId, index)),
    } as LayoutSpec;
    const [layout] = await admin
      .insert(sheetLayouts)
      .values({
        orgId: ids.org,
        instrumentId: ids.instrument,
        version: 1,
        spec,
        specHash: layoutHash(spec),
      })
      .returning({ id: sheetLayouts.id });
    ids.layout = layout?.id ?? '';
    const [run] = await admin
      .insert(sheetPrintRuns)
      .values({
        orgId: ids.org,
        layoutId: ids.layout,
        assessmentId: ids.assessment,
        sheetCount: 1,
      })
      .returning({ id: sheetPrintRuns.id });
    ids.run = run?.id ?? '';
    const [sheet] = await admin
      .insert(printedSheets)
      .values({ orgId: ids.org, printRunId: ids.run, studentId: ids.student, sequence: 1 })
      .returning({ id: printedSheets.id });
    ids.sheet = sheet?.id ?? '';
    const [batch] = await admin
      .insert(sheetScanBatches)
      .values({
        orgId: ids.org,
        printRunId: ids.run,
        status: 'processing',
        captureProfile: DEFAULT_CAPTURE_PROFILES.phone,
        sourceFileIds: [],
      })
      .returning({ id: sheetScanBatches.id });
    ids.batch = batch?.id ?? '';
    const [scan] = await admin
      .insert(sheetScans)
      .values({
        orgId: ids.org,
        batchId: ids.batch,
        printedSheetId: ids.sheet,
        pageIndex: 0,
        imageHash: 'e2e'.padEnd(64, '0'),
        state: 'read',
        quality: { ok: true, sharpness: 0.9, glare: 0.05, fiducialsFound: 4, rejectReason: null },
        resolvedStudentId: ids.student,
      })
      .returning({ id: sheetScans.id });
    ids.scan = scan?.id ?? '';

    byImage = new Map();
    candidates = [];
    for (const [index, plan] of PLAN.entries()) {
      const poc = pocById.get(plan.poc);
      if (!poc) throw new Error(`falta ${plan.poc} en la PoC`);
      const base64 = readFileSync(resolve(POC_DIR ?? '', 'crops', poc.crop)).toString('base64');
      byImage.set(base64, plan);
      const state = plan.preset === 'omr_annulled' ? 'multiple' : poc.omr_state;
      const preset =
        plan.preset === 'human'
          ? {
              reviewDecision: 'option' as const,
              reviewedValue: 'C',
              reviewedById: ids.user,
              reviewedAt: new Date(),
            }
          : plan.preset === 'omr_annulled'
            ? {
                reviewDecision: 'annulled' as const,
                reviewedValue: null,
                reviewedAt: new Date(),
                autoResolved: true,
              }
            : {};
      const [mark] = await admin
        .insert(sheetScanMarks)
        .values({
          id: nonAuditedMarkId(),
          orgId: ids.org,
          scanId: ids.scan,
          fieldId: plan.fieldId,
          printedNumber: String(index + 1),
          state: state,
          value: null,
          fill: '0.700',
          threshold: '0.500',
          margin: '0.300',
          suggestedValue: state === 'ambiguous' ? 'B' : null,
          doubtReason: state === 'multiple' ? 'multiple' : 'margin',
          nullConfidence: state === 'multiple' ? '0.950' : null,
          ...preset,
        })
        .returning({ id: sheetScanMarks.id });
      markIds.set(plan.fieldId, mark?.id ?? '');
      candidates.push({
        markId: mark?.id ?? '',
        scanId: ids.scan,
        fieldId: plan.fieldId,
        state: state,
        cropJpegBase64: base64,
        scanState: 'read',
        autoAnnulled: plan.preset === 'omr_annulled',
        doubtReason: state === 'multiple' ? 'multiple' : 'margin',
        suggestedValue: state === 'ambiguous' ? 'B' : null,
        nullConfidence: state === 'multiple' ? 0.95 : null,
        fill: 0.7,
        margin: 0.3,
      });
    }
  });

  afterAll(async () => {
    await admin?.$client.end();
    await app?.$client.end();
  });

  async function setMode(mode: 'shadow' | 'live'): Promise<void> {
    await admin.delete(decisionSettings).where(eq(decisionSettings.orgId, ids.org));
    await admin.insert(decisionSettings).values([
      {
        orgId: ids.org,
        feature: 'mark_disambiguation_jev',
        engine: 'jev',
        model: 'jev-1.14.0',
        mode,
        thresholds: { respuesta: THRESHOLDS.jev },
      },
      {
        orgId: ids.org,
        feature: 'mark_disambiguation_openai',
        engine: 'openai',
        model: 'gpt-6-luna',
        mode,
        thresholds: { respuesta: THRESHOLDS.openai },
      },
    ]);
  }

  function buildDisambiguation(): MarkDisambiguationService {
    const engines = REAL_ENGINES
      ? [new JevDecisionEngine({ experimentalImages: true }), new OpenAiDecisionEngine()]
      : fakeEngines(byImage);
    const decisions = new DecisionsService(
      new DecisionsConfigService(app),
      new DecisionCallsRecorder(app),
      engines,
    );
    const files = { buildDownloadUrl: () => undefined } as unknown as FilesService;
    return new MarkDisambiguationService(app, decisions, files);
  }

  async function marksByField() {
    const rows = await admin
      .select()
      .from(sheetScanMarks)
      .where(eq(sheetScanMarks.scanId, ids.scan));
    return new Map(rows.map((row) => [row.fieldId, row]));
  }

  function reviewService(): ScanReviewService {
    const previewStore = new AnswerSheetPreviewStore();
    const confirmer = createAnswerSheetConfirmer(
      new AnswerSheetsService(app, previewStore),
      previewStore,
      new AssessmentResultsService(app),
    );
    return new ScanReviewService(
      app,
      confirmer,
      { buildDownloadUrl: () => undefined } as unknown as FilesService,
      { scheduleConfirmedBatch: () => undefined } as unknown as DevelopmentGradingService,
      {
        readingsForConfirmation: async () => new Map(),
        linkConfirmedResponses: async () => null,
      } as unknown as AnswerReadingConsolidationService,
      { engineFor: async () => 'legacy' } as unknown as RubricGradingService,
    );
  }

  it('sombra: registra ai_resolution y decision_calls sin tocar reviewed_*', async () => {
    await setMode('shadow');
    const before = await marksByField();

    await buildDisambiguation().resolveBatch(ids.org, ids.batch, spec, candidates);

    const after = await marksByField();
    for (const plan of PLAN) {
      const mark = after.get(plan.fieldId);
      const prior = before.get(plan.fieldId);
      const resolution = mark?.aiResolution as MarkAiResolution | null;
      expect(resolution).toMatchObject({ mode: 'shadow', applied: false });
      expect(mark?.reviewedAt?.getTime() ?? null).toBe(prior?.reviewedAt?.getTime() ?? null);
      expect(mark?.reviewDecision).toBe(prior?.reviewDecision ?? null);
      expect(mark?.autoResolved).toBe(prior?.autoResolved);
    }
    const calls = await admin
      .select({
        feature: decisionCalls.feature,
        mode: decisionCalls.mode,
        id: decisionCalls.correlationId,
      })
      .from(decisionCalls)
      .where(eq(decisionCalls.orgId, ids.org));
    expect(calls).toHaveLength(PLAN.length * 2);
    expect(new Set(calls.map((call) => call.mode))).toEqual(new Set(['shadow']));
    expect(new Set(calls.map((call) => call.id))).toEqual(new Set(markIds.values()));
    if (!REAL_ENGINES) {
      expect((after.get('q1')?.aiResolution as MarkAiResolution).verdict).toBe('agree');
      expect((after.get('q3')?.aiResolution as MarkAiResolution).verdict).toBe('conflict');
      expect((after.get('q4')?.aiResolution as MarkAiResolution).verdict).toBe('solo_a');
    }
  });

  it('live: aplica las automáticas sin pisar decisiones previas y baja reviewPending', async () => {
    await admin
      .update(sheetScanMarks)
      .set({ aiResolution: null })
      .where(eq(sheetScanMarks.scanId, ids.scan));
    await admin.delete(decisionCalls).where(eq(decisionCalls.orgId, ids.org));
    await setMode('live');

    const pendingBefore = await admin
      .select({ count: sql<number>`count(*)::int` })
      .from(sheetScanMarks)
      .where(and(eq(sheetScanMarks.scanId, ids.scan), isNull(sheetScanMarks.reviewedAt)));

    await buildDisambiguation().resolveBatch(ids.org, ids.batch, spec, candidates);

    const after = await marksByField();
    let applied = 0;
    for (const plan of PLAN) {
      const mark = after.get(plan.fieldId);
      const resolution = mark?.aiResolution as MarkAiResolution | null;
      if (plan.preset === 'omr_annulled') {
        expect(resolution).toBeNull();
        expect(mark?.reviewDecision).toBe('annulled');
        continue;
      }
      expect(resolution?.mode).toBe('live');
      if (plan.preset === 'human') {
        expect(resolution?.applied).toBe(false);
        expect(mark).toMatchObject({
          reviewDecision: 'option',
          reviewedValue: 'C',
          reviewedById: ids.user,
        });
        continue;
      }
      if (resolution?.applied) {
        applied++;
        expect(resolution.route).toBe('auto');
        expect(mark?.autoResolved).toBe(true);
        expect(mark?.reviewedById).toBeNull();
        expect(mark?.reviewedAt).not.toBeNull();
      } else {
        expect(mark?.reviewedAt).toBeNull();
      }
    }
    if (!REAL_ENGINES) {
      expect((after.get('q1')?.aiResolution as MarkAiResolution).applied).toBe(true);
      expect(after.get('q1')).toMatchObject({ reviewDecision: 'option', reviewedValue: 'B' });
      expect(after.get('q4')).toMatchObject({ reviewDecision: 'annulled', reviewedValue: null });
      expect((after.get('q3')?.aiResolution as MarkAiResolution).verdict).toBe('conflict');
    }

    const scanService = new SheetScanService(
      app,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await (
      scanService as unknown as {
        finalizeBatch: (orgId: string, batchId: string, pages: number) => Promise<void>;
      }
    ).finalizeBatch(ids.org, ids.batch, 1);
    const [batch] = await admin
      .select({ status: sheetScanBatches.status, reviewPending: sheetScanBatches.reviewPending })
      .from(sheetScanBatches)
      .where(eq(sheetScanBatches.id, ids.batch));
    expect(batch?.status).toBe('needs_review');
    expect(batch?.reviewPending).toBe(Number(pendingBefore[0]?.count ?? 0) - applied);
    expect(applied).toBeGreaterThan(0);

    const queue = await reviewService().getQueue(ids.org, ids.batch);
    const iaShown = queue.autoAnnulled.filter((mark) => mark.aiResolution !== null);
    expect(iaShown).toHaveLength(applied);
  });

  it('corrección posterior: reescribe la respuesta, recalcula resultados y deja la marca como humana', async () => {
    const review = reviewService();
    const queue = await review.getQueue(ids.org, ids.batch);
    for (const mark of queue.ambiguousMarks) {
      await review.resolveMark(ids.org, ids.user, mark.markId, { decision: 'blank' });
    }
    await review.confirmBatch(ids.org, user(), ids.batch);

    const corrections = await review.getCorrections(ids.org, ids.batch);
    const target = corrections.marks.find(
      (mark) => mark.aiResolution !== null && mark.autoResolved,
    );
    expect(target).toBeDefined();
    if (!target) return;
    const field = PLAN.find((plan) => markIds.get(plan.fieldId) === target.markId);
    const itemId = itemIds.get(field?.fieldId ?? '') ?? '';
    const responseOf = async () => {
      const [row] = await admin
        .select({
          value: responses.value,
          isCorrect: responses.isCorrect,
          finalScore: responses.finalScore,
        })
        .from(responses)
        .where(
          and(
            eq(responses.assessmentId, ids.assessment),
            eq(responses.studentId, ids.student),
            eq(responses.itemId, itemId),
          ),
        );
      return row;
    };
    const resultOf = async () => {
      const [row] = await admin
        .select()
        .from(assessmentResults)
        .where(
          and(
            eq(assessmentResults.assessmentId, ids.assessment),
            eq(assessmentResults.studentId, ids.student),
          ),
        );
      return row;
    };
    const responseBefore = await responseOf();
    const resultBefore = await resultOf();
    expect(responseBefore).toBeDefined();
    expect(resultBefore).toBeDefined();

    const newValue = responseBefore?.isCorrect ? 'D' : 'A';
    const corrected = await review.correctConfirmedMark(ids.org, ids.user, target.markId, {
      decision: 'option',
      reviewedValue: newValue,
    });

    expect(corrected).toMatchObject({
      reviewedValue: newValue,
      autoResolved: false,
      reviewedById: ids.user,
    });
    expect(corrected.aiResolution).not.toBeNull();
    const responseAfter = await responseOf();
    expect(responseAfter?.value).toMatchObject({ answer: newValue });
    expect(responseAfter?.isCorrect).not.toBe(responseBefore?.isCorrect);
    const resultAfter = await resultOf();
    expect(JSON.stringify(resultAfter)).not.toBe(JSON.stringify(resultBefore));
    const marks = await marksByField();
    const stored = marks.get(field?.fieldId ?? '');
    expect(stored).toMatchObject({
      autoResolved: false,
      reviewedById: ids.user,
      reviewedValue: newValue,
    });
    expect((stored?.aiResolution as MarkAiResolution).applied).toBe(true);
  });

  it('RLS: el rol de la app no ve las marcas de otra organización', async () => {
    const rows = await app.select({ id: sheetScanMarks.id }).from(sheetScanMarks);
    expect(rows).toHaveLength(0);
  });
});
