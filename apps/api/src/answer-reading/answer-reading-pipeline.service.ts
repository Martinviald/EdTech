import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  answerReadingRuns,
  grades,
  instruments,
  items,
  organizations,
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  withOrgContext,
  type AnswerReadingDecision,
  type AnswerReadingRun,
} from '@soe/db';
import {
  resolveAnswerReadingSettings,
  type CropEvidence,
  type LayoutField,
  type ReadingOutcome,
  type ResolvedOrgAnswerReadingSettings,
  type ResponseFormat,
} from '@soe/types';
import { ConcurrencyLimiter } from '../common/concurrency/concurrency-limiter';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { AnswerReadingBudgetService } from './answer-reading-budget.service';
import { AnswerReadingConsolidationService } from './answer-reading-consolidation.service';
import { visionResponsesByField } from './answer-reading-layout.helpers';
import { toReadingScoringItem, type ReadingScoringItem } from './answer-reading-scoring.helpers';
import {
  AnswerReadingDecisionsService,
  type SavedReadingDecision,
} from './answer-reading-decisions.service';
import {
  ANSWER_READING_JOB_KIND,
  ANSWER_READING_OPTIONS,
  type AnswerReadingOptions,
} from './answer-reading.constants';
import {
  CropReadingService,
  type CropReadingOutcome,
  type CropReadingTask,
  type NotReadReason,
} from './crop-reading.service';
import { ReadingRoutesService, type ReadingRouteCatalog } from './reading-routes.service';
import { RubricGradingService } from './rubric-grading.service';

export interface ScheduleScanReadingParams {
  readonly orgId: string;
  readonly batchId: string;
  readonly scanId: string;
}

interface LayoutCrop {
  readonly markId: string;
  readonly cropFileId: string | null;
  readonly cropEvidence: CropEvidence | null;
  readonly itemId: string;
  readonly format: ResponseFormat;
  readonly cropProfileId: string;
}

interface ScanCrop extends LayoutCrop {
  readonly item: ReadingScoringItem;
}

interface ScanWork {
  readonly assessmentId: string | null;
  readonly instrumentId: string;
  readonly subjectId: string | null;
  readonly gradeId: string | null;
  readonly gradeName: string | null;
  readonly studentId: string | null;
  readonly orgConfig: Record<string, unknown> | null;
  readonly crops: readonly ScanCrop[];
}

interface RunState {
  readonly run: AnswerReadingRun;
  readonly previousCropsTotal: number;
}

interface PlannedCrop {
  readonly crop: ScanCrop;
  readonly task: CropReadingTask;
}

interface ScanTally {
  cropsDone: number;
  autoAccepted: number;
  needsReview: number;
  costUsd: number;
  readonly changedDecisionIds: string[];
}

const AUTO_OUTCOMES: ReadonlySet<ReadingOutcome> = new Set(['auto_accepted', 'auto_blank']);

const RUN_FAILURE_MESSAGE =
  'La lectura de las respuestas escritas se interrumpió por un error inesperado. Las respuestas que no se alcanzaron a leer quedan pendientes de revisión.';

@Injectable()
export class AnswerReadingPipelineService {
  private readonly pendingScansByBatch = new Map<string, { orgId: string; scanIds: string[] }>();

  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
    private readonly routes: ReadingRoutesService,
    private readonly cropReader: CropReadingService,
    private readonly decisions: AnswerReadingDecisionsService,
    private readonly budget: AnswerReadingBudgetService,
    private readonly consolidation: AnswerReadingConsolidationService,
    private readonly rubricGrading: RubricGradingService,
    @Inject(ANSWER_READING_OPTIONS) private readonly options: AnswerReadingOptions,
  ) {}

  scheduleForScan(params: ScheduleScanReadingParams): void {
    try {
      const pending = this.pendingScansByBatch.get(params.batchId);
      if (pending) {
        pending.scanIds.push(params.scanId);
        return;
      }
      this.pendingScansByBatch.set(params.batchId, {
        orgId: params.orgId,
        scanIds: [params.scanId],
      });
      this.dispatcher.enqueue({
        id: params.batchId,
        kind: ANSWER_READING_JOB_KIND,
        run: () => this.drainBatch(params.batchId),
      });
    } catch (error) {
      this.pendingScansByBatch.delete(params.batchId);
      reportServerError(error, { ...params, stage: 'schedule_answer_reading' });
    }
  }

  async currentDecisionsForBatch(
    orgId: string,
    batchId: string,
  ): Promise<Map<string, AnswerReadingDecision>> {
    return this.decisions.findCurrentByBatch(orgId, batchId);
  }

  async currentDecisionsForMarks(
    orgId: string,
    markIds: readonly string[],
  ): Promise<Map<string, AnswerReadingDecision>> {
    return this.decisions.findCurrentByMarkIds(orgId, markIds);
  }

  async processScan(orgId: string, batchId: string, scanId: string): Promise<void> {
    let runId: string | null = null;
    let work: ScanWork | null = null;
    try {
      work = await this.loadScanWork(orgId, batchId, scanId);
      if (work === null) return;
      const state = await this.ensureRun(orgId, batchId, work);
      runId = state.run.id;
      const settings = resolveAnswerReadingSettings(work.orgConfig);
      const catalog = settings.enabled ? await this.routes.loadCatalog(orgId) : null;
      const planned = this.planCrops(orgId, state, work, settings, catalog);
      const budgetExceeded = await this.isBudgetExceeded(orgId, work, settings, planned);
      const tally = await this.readCrops(
        orgId,
        state.run.id,
        work,
        budgetExceeded ? this.blockedByBudget(planned) : planned,
      );
      if (tally.cropsDone < planned.length) {
        await this.leaveUnreadDecisions(orgId, state.run.id, work, tally.changedDecisionIds);
      }
      await this.finishRun(orgId, state, tally, budgetExceeded);
      await this.consolidateIfConfirmed(orgId, batchId, tally.changedDecisionIds);
    } catch (error) {
      reportServerError(error, { orgId, batchId, scanId, runId, stage: 'answer_reading' });
      if (runId !== null && work !== null) {
        await this.leaveUnreadDecisions(orgId, runId, work, []);
      }
      if (runId !== null) await this.failRun(orgId, runId);
    }
  }

  private async drainBatch(batchId: string): Promise<void> {
    for (;;) {
      const pending = this.pendingScansByBatch.get(batchId);
      const scanId = pending?.scanIds.shift();
      if (!pending || scanId === undefined) {
        this.pendingScansByBatch.delete(batchId);
        return;
      }
      await this.processScan(pending.orgId, batchId, scanId);
    }
  }

  private async loadScanWork(
    orgId: string,
    batchId: string,
    scanId: string,
  ): Promise<ScanWork | null> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [scan] = await tx
        .select({
          state: sheetScans.state,
          resolvedStudentId: sheetScans.resolvedStudentId,
          printedSheetId: sheetScans.printedSheetId,
        })
        .from(sheetScans)
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            eq(sheetScans.id, scanId),
            eq(sheetScans.batchId, batchId),
          ),
        )
        .limit(1);
      if (!scan || scan.state === 'superseded') return null;

      const [batch] = await tx
        .select({ printRunId: sheetScanBatches.printRunId })
        .from(sheetScanBatches)
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)))
        .limit(1);
      if (!batch) return null;
      const [printRun] = await tx
        .select({ layoutId: sheetPrintRuns.layoutId, assessmentId: sheetPrintRuns.assessmentId })
        .from(sheetPrintRuns)
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, batch.printRunId)))
        .limit(1);
      if (!printRun) return null;
      const [layout] = await tx
        .select({ spec: sheetLayouts.spec, instrumentId: sheetLayouts.instrumentId })
        .from(sheetLayouts)
        .where(eq(sheetLayouts.id, printRun.layoutId))
        .limit(1);
      if (!layout) return null;

      const markRows = await tx
        .select({
          id: sheetScanMarks.id,
          fieldId: sheetScanMarks.fieldId,
          cropFileId: sheetScanMarks.cropFileId,
          cropEvidence: sheetScanMarks.cropEvidence,
        })
        .from(sheetScanMarks)
        .where(and(eq(sheetScanMarks.orgId, orgId), eq(sheetScanMarks.scanId, scanId)));
      const layoutCrops = this.visionCrops(layout.spec.fields, markRows);
      if (layoutCrops.length === 0) return null;

      const itemRows = await tx
        .select({
          id: items.id,
          type: items.type,
          content: items.content,
          scoringConfig: items.scoringConfig,
        })
        .from(items)
        .where(inArray(items.id, [...new Set(layoutCrops.map((crop) => crop.itemId))]));
      const crops = this.withItems(
        orgId,
        scanId,
        layoutCrops,
        new Map(itemRows.map((row) => [row.id, toReadingScoringItem(row)])),
      );
      if (crops.length === 0) return null;
      const [instrument] = await tx
        .select({ subjectId: instruments.subjectId, gradeId: instruments.gradeId })
        .from(instruments)
        .where(eq(instruments.id, layout.instrumentId))
        .limit(1);
      const gradeId = instrument?.gradeId ?? null;
      const [grade] =
        gradeId === null
          ? []
          : await tx.select({ name: grades.name }).from(grades).where(eq(grades.id, gradeId));
      const [org] = await tx
        .select({ config: organizations.config })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      return {
        assessmentId: printRun.assessmentId,
        instrumentId: layout.instrumentId,
        subjectId: instrument?.subjectId ?? null,
        gradeId,
        gradeName: grade?.name ?? null,
        studentId:
          scan.resolvedStudentId ?? (await this.printedSheetStudent(tx, scan.printedSheetId)),
        orgConfig: org?.config ?? null,
        crops,
      };
    });
  }

  private async printedSheetStudent(
    tx: Database,
    printedSheetId: string | null,
  ): Promise<string | null> {
    if (printedSheetId === null) return null;
    const [sheet] = await tx
      .select({ studentId: printedSheets.studentId })
      .from(printedSheets)
      .where(eq(printedSheets.id, printedSheetId))
      .limit(1);
    return sheet?.studentId ?? null;
  }

  private visionCrops(
    fields: readonly LayoutField[],
    markRows: ReadonlyArray<{
      id: string;
      fieldId: string;
      cropFileId: string | null;
      cropEvidence: CropEvidence | null;
    }>,
  ): LayoutCrop[] {
    const responseByField = visionResponsesByField(fields);
    const crops: LayoutCrop[] = [];
    for (const mark of markRows) {
      const response = responseByField.get(mark.fieldId);
      if (!response) continue;
      crops.push({
        markId: mark.id,
        cropFileId: mark.cropFileId,
        cropEvidence: mark.cropEvidence,
        itemId: response.itemId,
        format: response.format,
        cropProfileId: mark.cropEvidence?.cropProfileId ?? response.cropProfileId,
      });
    }
    return crops;
  }

  private withItems(
    orgId: string,
    scanId: string,
    layoutCrops: readonly LayoutCrop[],
    itemsById: ReadonlyMap<string, ReadingScoringItem>,
  ): ScanCrop[] {
    const crops: ScanCrop[] = [];
    for (const crop of layoutCrops) {
      const item = itemsById.get(crop.itemId);
      if (item) {
        crops.push({ ...crop, item });
        continue;
      }
      reportServerError(new Error('El ítem del campo de respuesta escrita no existe'), {
        orgId,
        scanId,
        markId: crop.markId,
      });
    }
    return crops;
  }

  private async ensureRun(orgId: string, batchId: string, work: ScanWork): Promise<RunState> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const now = new Date();
      const [existing] = await tx
        .select()
        .from(answerReadingRuns)
        .where(
          and(
            eq(answerReadingRuns.orgId, orgId),
            eq(answerReadingRuns.batchId, batchId),
            eq(answerReadingRuns.trigger, 'scan_processed'),
          ),
        )
        .orderBy(desc(answerReadingRuns.createdAt))
        .limit(1);
      if (existing) {
        const cropsTotal = existing.cropsTotal + work.crops.length;
        await tx
          .update(answerReadingRuns)
          .set({
            status: existing.status === 'budget_exceeded' ? 'budget_exceeded' : 'running',
            cropsTotal,
            startedAt: existing.startedAt ?? now,
            completedAt: null,
            updatedAt: now,
          })
          .where(and(eq(answerReadingRuns.orgId, orgId), eq(answerReadingRuns.id, existing.id)));
        return {
          run: { ...existing, cropsTotal, startedAt: existing.startedAt ?? now },
          previousCropsTotal: existing.cropsTotal,
        };
      }
      const [created] = await tx
        .insert(answerReadingRuns)
        .values({
          orgId,
          batchId,
          assessmentId: work.assessmentId,
          trigger: 'scan_processed',
          status: 'running',
          cropsTotal: work.crops.length,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error('No se pudo crear la corrida de lectura');
      return { run: created, previousCropsTotal: 0 };
    });
  }

  private planCrops(
    orgId: string,
    state: RunState,
    work: ScanWork,
    settings: ResolvedOrgAnswerReadingSettings,
    catalog: ReadingRouteCatalog | null,
  ): PlannedCrop[] {
    const planned: PlannedCrop[] = [];
    for (const [index, crop] of work.crops.entries()) {
      const { item } = crop;
      const route =
        catalog === null
          ? null
          : this.routes.resolve(
              {
                orgId,
                itemId: item.id,
                instrumentId: work.instrumentId,
                subjectId: work.subjectId,
                gradeId: work.gradeId,
                responseFormat: crop.format,
              },
              catalog,
              settings,
            );
      planned.push({
        crop,
        task: this.taskFor(
          orgId,
          state.run.id,
          work,
          crop,
          route,
          this.blockedReasonOf(settings, state.previousCropsTotal + index),
        ),
      });
    }
    return planned;
  }

  private taskFor(
    orgId: string,
    runId: string,
    work: ScanWork,
    crop: ScanCrop,
    route: CropReadingTask['route'],
    blockedReason: NotReadReason | null,
  ): CropReadingTask {
    return {
      orgId,
      runId,
      markId: crop.markId,
      item: crop.item,
      format: crop.format,
      cropProfileId: crop.cropProfileId,
      cropFileId: crop.cropFileId,
      cropEvidence: crop.cropEvidence,
      gradeName: work.gradeName,
      route,
      blockedReason,
    };
  }

  private async leaveUnreadDecisions(
    orgId: string,
    runId: string,
    work: ScanWork,
    changedDecisionIds: string[],
  ): Promise<void> {
    try {
      const current = await this.decisions.findCurrentByMarkIds(
        orgId,
        work.crops.map((crop) => crop.markId),
      );
      for (const crop of work.crops) {
        if (current.has(crop.markId)) continue;
        const outcome = await this.cropReader.read(
          this.taskFor(orgId, runId, work, crop, null, 'reader_failed'),
        );
        const saved = await this.saveDecision(orgId, runId, work, crop, outcome);
        if (!saved.unchanged) changedDecisionIds.push(saved.decisionId);
      }
    } catch (error) {
      reportServerError(error, { orgId, runId, stage: 'answer_reading_unread_decisions' });
    }
  }

  private blockedReasonOf(
    settings: ResolvedOrgAnswerReadingSettings,
    runPosition: number,
  ): NotReadReason | null {
    if (!settings.enabled) return 'reading_disabled';
    if (runPosition >= this.options.maxCropsPerRun) return 'run_limit_exceeded';
    return null;
  }

  private async isBudgetExceeded(
    orgId: string,
    work: ScanWork,
    settings: ResolvedOrgAnswerReadingSettings,
    planned: readonly PlannedCrop[],
  ): Promise<boolean> {
    let plannedReadings = 0;
    for (const { task } of planned) {
      if (task.blockedReason !== null || task.route === null) continue;
      plannedReadings += task.route.route.readers.length + task.route.route.shadowReaders.length;
    }
    return this.budget.isExceeded({
      orgId,
      orgConfig: work.orgConfig,
      settings,
      plannedReadings,
    });
  }

  private blockedByBudget(planned: readonly PlannedCrop[]): PlannedCrop[] {
    return planned.map((entry) =>
      entry.task.blockedReason === null
        ? { ...entry, task: { ...entry.task, blockedReason: 'budget_exceeded' } }
        : entry,
    );
  }

  private async readCrops(
    orgId: string,
    runId: string,
    work: ScanWork,
    planned: readonly PlannedCrop[],
  ): Promise<ScanTally> {
    const limiter = new ConcurrencyLimiter(this.options.cropConcurrency);
    const tally: ScanTally = {
      cropsDone: 0,
      autoAccepted: 0,
      needsReview: 0,
      costUsd: 0,
      changedDecisionIds: [],
    };
    await Promise.all(
      planned.map(({ crop, task }) =>
        limiter.run(async () => {
          const outcome = await this.readCrop(task);
          try {
            const saved = await this.saveDecision(orgId, runId, work, crop, outcome);
            if (!saved.unchanged) tally.changedDecisionIds.push(saved.decisionId);
          } catch (error) {
            reportServerError(error, { orgId, runId, markId: crop.markId, stage: 'save_decision' });
            return;
          }
          tally.cropsDone += 1;
          tally.costUsd += outcome.costUsd;
          if (AUTO_OUTCOMES.has(outcome.result.outcome)) tally.autoAccepted += 1;
          else tally.needsReview += 1;
        }),
      ),
    );
    return tally;
  }

  private async readCrop(task: CropReadingTask): Promise<CropReadingOutcome> {
    try {
      return await this.cropReader.read(task);
    } catch (error) {
      reportServerError(error, { orgId: task.orgId, runId: task.runId, markId: task.markId });
      return this.cropReader.read({ ...task, blockedReason: 'reader_failed' });
    }
  }

  private async saveDecision(
    orgId: string,
    runId: string,
    work: ScanWork,
    crop: ScanCrop,
    outcome: CropReadingOutcome,
  ): Promise<SavedReadingDecision> {
    return this.decisions.save(orgId, {
      runId,
      markId: crop.markId,
      itemId: crop.itemId,
      assessmentId: work.assessmentId,
      studentId: work.studentId,
      routeId: outcome.routeId,
      routeVersion: outcome.routeVersion,
      result: outcome.result,
    });
  }

  private async finishRun(
    orgId: string,
    state: RunState,
    tally: ScanTally,
    budgetExceeded: boolean,
  ): Promise<void> {
    const { run } = state;
    const now = new Date();
    await withOrgContext(this.db, orgId, (tx) =>
      tx
        .update(answerReadingRuns)
        .set({
          status:
            budgetExceeded || run.status === 'budget_exceeded' ? 'budget_exceeded' : 'completed',
          cropsDone: run.cropsDone + tally.cropsDone,
          autoAccepted: run.autoAccepted + tally.autoAccepted,
          needsReview: run.needsReview + tally.needsReview,
          costUsd: (Number(run.costUsd) + tally.costUsd).toFixed(6),
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(answerReadingRuns.orgId, orgId), eq(answerReadingRuns.id, run.id))),
    );
  }

  private async consolidateIfConfirmed(
    orgId: string,
    batchId: string,
    decisionIds: readonly string[],
  ): Promise<void> {
    if (decisionIds.length === 0) return;
    try {
      const [batch] = await withOrgContext(this.db, orgId, (tx) =>
        tx
          .select({ status: sheetScanBatches.status })
          .from(sheetScanBatches)
          .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)))
          .limit(1),
      );
      if (batch?.status !== 'confirmed') return;
      await this.consolidation.consolidateDecisions(orgId, decisionIds);
      this.rubricGrading.scheduleForDecisions(orgId, decisionIds);
    } catch (error) {
      reportServerError(error, { orgId, batchId, stage: 'answer_reading_consolidation' });
    }
  }

  private async failRun(orgId: string, runId: string): Promise<void> {
    try {
      const now = new Date();
      await withOrgContext(this.db, orgId, (tx) =>
        tx
          .update(answerReadingRuns)
          .set({
            status: 'failed',
            failureReason: RUN_FAILURE_MESSAGE,
            completedAt: now,
            updatedAt: now,
          })
          .where(and(eq(answerReadingRuns.orgId, orgId), eq(answerReadingRuns.id, runId))),
      );
    } catch (error) {
      reportServerError(error, { orgId, runId, stage: 'answer_reading_fail_run' });
    }
  }
}
