import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  isProviderAllowedByOrg,
  renderRubricGradingPrompt,
  rubricGradeOutputSchema,
  type RubricGradeOutput,
  type RubricLevelForGrading,
} from '@soe/answer-reading';
import {
  aiGradingJobs,
  answerReadingDecisions,
  grades,
  instruments,
  items,
  organizations,
  responses,
  rubricCriteria,
  rubricLevels,
  rubrics,
  withOrgContext,
  type AnswerReadingDecision,
} from '@soe/db';
import {
  resolveAnswerReadingSettings,
  rubricScoredContentSchema,
  rubricScoredStrategy,
  sameRubricCode,
  type ItemContent,
  type ItemType,
  type ResolvedOrgAnswerReadingSettings,
  type RubricEngine,
  type RubricLevel,
  type ScoringOutput,
} from '@soe/types';
import { ConcurrencyLimiter } from '../common/concurrency/concurrency-limiter';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { LlmConfigService } from '../llm/llm.config';
import { estimateLlmCostUsd } from '../llm/llm.pricing';
import { LlmService } from '../llm/llm.service';
import type { LlmStructuredResult } from '../llm/llm.types';
import { AnswerReadingBudgetService } from './answer-reading-budget.service';
import {
  AnswerReadingConsolidationService,
  type ConsolidationReport,
} from './answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import {
  ANSWER_READING_OPTIONS,
  RUBRIC_GRADING_JOB_KIND,
  RUBRIC_GRADING_JOB_TYPE,
  RUBRIC_GRADING_LLM_FEATURE,
  RUBRIC_GRADING_PROMPT_REF,
  VISION_RUBRIC_FORMAT_KINDS,
  type AnswerReadingOptions,
} from './answer-reading.constants';

export const RUBRIC_GRADING_SKIP_REASONS = [
  'budget_exceeded',
  'provider_not_allowed',
  'run_limit_exceeded',
] as const;
export type RubricGradingSkipReason = (typeof RUBRIC_GRADING_SKIP_REASONS)[number];

const RETRYABLE_JOB_STATUSES: ReadonlySet<string> = new Set(['failed', 'skipped']);
const RUBRIC_FORMAT_KINDS: ReadonlySet<string> = new Set(VISION_RUBRIC_FORMAT_KINDS);
const STRUCTURED_SCHEMA_NAME = 'rubric_grade';

interface RubricItem {
  readonly id: string;
  readonly type: ItemType;
  readonly content: ItemContent;
  readonly maxScore: number;
  readonly stem: string;
  readonly levels: readonly RubricLevel[];
  readonly rubricId: string | null;
  readonly instrumentId: string | null;
}

interface GradingEntry {
  readonly decision: AnswerReadingDecision;
  readonly responseId: string;
  readonly transcription: string;
  readonly item: RubricItem;
  readonly levels: readonly RubricLevelForGrading[];
  readonly gradeName: string | null;
}

interface PlannedGrading {
  readonly entry: GradingEntry;
  readonly jobId: string;
  readonly skipReason: RubricGradingSkipReason | null;
}

export interface RubricLevelRequest {
  readonly decisionId: string;
  readonly levelCode: string;
  readonly reason?: string;
}

export interface RubricLevelApproval {
  readonly decisionId: string;
  readonly levelCode: string;
  readonly isCorrect: boolean;
  readonly score: number;
  readonly reason?: string;
}

export interface RubricLevelApprovals {
  readonly report: ConsolidationReport;
  readonly approved: RubricLevelApproval[];
}

interface OrgSnapshot {
  readonly config: Record<string, unknown> | null;
  readonly settings: ResolvedOrgAnswerReadingSettings;
}

@Injectable()
export class RubricGradingService {
  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
    private readonly llm: LlmService,
    private readonly llmConfig: LlmConfigService,
    private readonly budget: AnswerReadingBudgetService,
    private readonly decisions: AnswerReadingDecisionsService,
    private readonly consolidation: AnswerReadingConsolidationService,
    @Inject(ANSWER_READING_OPTIONS) private readonly options: AnswerReadingOptions,
  ) {}

  async engineFor(orgId: string): Promise<RubricEngine> {
    return (await this.loadOrg(orgId)).settings.rubricEngine;
  }

  scheduleForBatch(orgId: string, batchId: string): void {
    this.enqueue(orgId, batchId, async () => {
      const current = await this.decisions.findCurrentByBatch(orgId, batchId);
      await this.grade(orgId, [...current.values()]);
    });
  }

  scheduleForDecisions(orgId: string, decisionIds: readonly string[]): void {
    if (decisionIds.length === 0) return;
    const ids = [...new Set(decisionIds)];
    this.enqueue(orgId, randomUUID(), () => this.gradeDecisions(orgId, ids));
  }

  async gradeDecisions(orgId: string, decisionIds: readonly string[]): Promise<void> {
    if (decisionIds.length === 0) return;
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(
            eq(answerReadingDecisions.orgId, orgId),
            inArray(answerReadingDecisions.id, [...decisionIds]),
            isNull(answerReadingDecisions.supersededById),
          ),
        ),
    );
    await this.grade(orgId, rows);
  }

  async approveRubricLevel(
    orgId: string,
    decisionId: string,
    levelCode: string,
    reviewerId: string,
  ): Promise<ConsolidationReport> {
    const { report } = await this.approveRubricLevels(
      orgId,
      [{ decisionId, levelCode }],
      reviewerId,
    );
    return report;
  }

  async approveRubricLevels(
    orgId: string,
    requests: readonly RubricLevelRequest[],
    reviewerId: string,
  ): Promise<RubricLevelApprovals> {
    if (requests.length === 0) {
      return {
        report: { scored: [], pending: [], skipped: [], recalculatedAssessmentIds: [] },
        approved: [],
      };
    }
    const decisionIds = [...new Set(requests.map((request) => request.decisionId))];
    const { decisions, itemsById } = await withOrgContext(this.db, orgId, async (tx) => {
      const found = await tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(
            eq(answerReadingDecisions.orgId, orgId),
            inArray(answerReadingDecisions.id, decisionIds),
          ),
        );
      const loaded =
        found.length === 0
          ? new Map<string, RubricItem>()
          : await this.loadItems(
              tx,
              found.map((decision) => decision.itemId),
            );
      return {
        decisions: new Map(found.map((decision) => [decision.id, decision])),
        itemsById: loaded,
      };
    });
    const approved: RubricLevelApproval[] = [];
    for (const request of requests) {
      const decision = decisions.get(request.decisionId);
      if (!decision) throw new NotFoundException('La respuesta a revisar no existe.');
      if (decision.supersededById !== null) {
        throw new ConflictException(
          'La lectura de esta respuesta cambió. Vuelve a cargar la revisión e inténtalo de nuevo.',
        );
      }
      const item = itemsById.get(decision.itemId);
      if (!item) {
        throw new BadRequestException(
          'El ítem de esta respuesta no tiene una rúbrica con niveles.',
        );
      }
      const level = item.levels.find((candidate) =>
        sameRubricCode(candidate.code, request.levelCode),
      );
      if (!level) {
        throw new BadRequestException(
          `El nivel "${request.levelCode}" no existe en la rúbrica del ítem.`,
        );
      }
      const scored = this.scoreLevel(item, level.code);
      if (scored.rawScore === null || scored.isCorrect === null) {
        throw new BadRequestException(
          `El nivel "${request.levelCode}" no tiene puntaje en la rúbrica.`,
        );
      }
      approved.push({
        decisionId: decision.id,
        levelCode: level.code,
        isCorrect: scored.isCorrect,
        score: scored.rawScore,
        reason: request.reason,
      });
    }
    const report = await this.consolidation.applyHumanResolutions(
      orgId,
      approved.map((approval) => ({
        decisionId: approval.decisionId,
        resolution: {
          kind: 'rubric',
          levelCode: approval.levelCode,
          isCorrect: approval.isCorrect,
          score: approval.score,
          ...(approval.reason === undefined ? {} : { reason: approval.reason }),
        },
      })),
      reviewerId,
    );
    return { report, approved };
  }

  private enqueue(orgId: string, jobId: string, run: () => Promise<void>): void {
    try {
      this.dispatcher.enqueue({ id: jobId, kind: RUBRIC_GRADING_JOB_KIND, run });
    } catch (error) {
      reportServerError(error, { orgId, jobId, stage: 'schedule_rubric_grading' });
    }
  }

  private async grade(orgId: string, decisions: readonly AnswerReadingDecision[]): Promise<void> {
    try {
      const candidates = decisions.filter((decision) => this.transcriptionOf(decision) !== null);
      if (candidates.length === 0) return;
      const org = await this.loadOrg(orgId);
      if (!this.isAssistEnabled(org.settings)) return;
      const entries = await this.loadEntries(orgId, candidates);
      if (entries.length === 0) return;
      const skipReason = await this.skipReasonFor(orgId, org, entries.length);
      const planned = await this.createJobs(orgId, entries, skipReason);
      const limiter = new ConcurrencyLimiter(this.options.cropConcurrency);
      await Promise.all(
        planned
          .filter((plan) => plan.skipReason === null)
          .map((plan) => limiter.run(() => this.gradeOne(orgId, plan))),
      );
    } catch (error) {
      reportServerError(error, { orgId, stage: 'rubric_grading' });
    }
  }

  private isAssistEnabled(settings: ResolvedOrgAnswerReadingSettings): boolean {
    return (
      settings.rubricEngine === 'rubric_grading' &&
      settings.rubricAssistEnabled &&
      settings.enabled &&
      settings.allowExternalVision
    );
  }

  private transcriptionOf(decision: AnswerReadingDecision): string | null {
    const value = decision.value;
    if (decision.responseId === null || decision.resolvedAt !== null || value === null) {
      return null;
    }
    if (!RUBRIC_FORMAT_KINDS.has(value.formatKind) || value.state !== 'answered') return null;
    if (value.value?.type !== 'text' || value.value.text.trim().length === 0) return null;
    return value.value.text;
  }

  private async loadOrg(orgId: string): Promise<OrgSnapshot> {
    const [org] = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({ config: organizations.config })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1),
    );
    const config = org?.config ?? null;
    return { config, settings: resolveAnswerReadingSettings(config) };
  }

  private async loadEntries(
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<GradingEntry[]> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const itemsById = await this.loadItems(
        tx,
        decisions.map((decision) => decision.itemId),
      );
      const responseIds = [...new Set(decisions.map((decision) => decision.responseId as string))];
      const responseRows = await tx
        .select({ id: responses.id, humanScore: responses.humanScore })
        .from(responses)
        .where(inArray(responses.id, responseIds));
      const openResponses = new Set(
        responseRows.filter((row) => row.humanScore === null).map((row) => row.id),
      );
      const graded = await this.alreadyGraded(tx, orgId, responseIds);
      const rubricItems = [...itemsById.values()];
      const examples = await this.examplesByItem(tx, orgId, rubricItems);
      const gradeNames = await this.gradeNamesByInstrument(tx, rubricItems);
      const entries: GradingEntry[] = [];
      for (const decision of decisions) {
        const item = itemsById.get(decision.itemId);
        const responseId = decision.responseId as string;
        if (!item || !openResponses.has(responseId) || graded.has(decision.id)) continue;
        const itemExamples = examples.get(item.id);
        entries.push({
          decision,
          responseId,
          transcription: this.transcriptionOf(decision) as string,
          item,
          levels: item.levels.map((level) => ({
            code: level.code,
            label: level.label ?? null,
            descriptor: level.descriptor ?? null,
            creditFraction: level.creditFraction,
            examples: itemExamples?.get(level.code) ?? [],
          })),
          gradeName:
            item.instrumentId === null ? null : (gradeNames.get(item.instrumentId) ?? null),
        });
      }
      return entries;
    });
  }

  private async loadItems(
    tx: Database,
    itemIds: readonly string[],
  ): Promise<Map<string, RubricItem>> {
    const rows = await tx
      .select({
        id: items.id,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
        instrumentId: items.instrumentId,
      })
      .from(items)
      .where(inArray(items.id, [...new Set(itemIds)]));
    const byId = new Map<string, RubricItem>();
    for (const row of rows) {
      const content = rubricScoredContentSchema.safeParse(row.content ?? {});
      if (!content.success) continue;
      const scoringConfig = (row.scoringConfig ?? {}) as { points?: unknown };
      byId.set(row.id, {
        id: row.id,
        type: row.type as ItemType,
        content: row.content as ItemContent,
        maxScore: typeof scoringConfig.points === 'number' ? scoringConfig.points : 1,
        stem: content.data.prompt,
        levels: content.data.levels,
        rubricId: content.data.rubricId ?? null,
        instrumentId: row.instrumentId,
      });
    }
    return byId;
  }

  private async alreadyGraded(
    tx: Database,
    orgId: string,
    responseIds: readonly string[],
  ): Promise<Set<string>> {
    const rows = await tx
      .select({ status: aiGradingJobs.status, input: aiGradingJobs.input })
      .from(aiGradingJobs)
      .where(
        and(
          eq(aiGradingJobs.orgId, orgId),
          eq(aiGradingJobs.type, RUBRIC_GRADING_JOB_TYPE),
          inArray(aiGradingJobs.responseId, [...responseIds]),
        ),
      );
    const graded = new Set<string>();
    for (const row of rows) {
      const decisionId = row.input?.decisionId;
      if (typeof decisionId === 'string' && !RETRYABLE_JOB_STATUSES.has(row.status)) {
        graded.add(decisionId);
      }
    }
    return graded;
  }

  private async examplesByItem(
    tx: Database,
    orgId: string,
    rubricItems: readonly RubricItem[],
  ): Promise<Map<string, Map<string, string[]>>> {
    const rubricIds = [
      ...new Set(rubricItems.flatMap((item) => (item.rubricId === null ? [] : [item.rubricId]))),
    ];
    if (rubricIds.length === 0) return new Map();
    const visible = await tx
      .select({ id: rubrics.id })
      .from(rubrics)
      .where(
        and(
          inArray(rubrics.id, rubricIds),
          isNull(rubrics.deletedAt),
          or(eq(rubrics.orgId, orgId), isNull(rubrics.orgId), eq(rubrics.isShared, true)),
        ),
      );
    if (visible.length === 0) return new Map();
    const criteria = await tx
      .select({
        id: rubricCriteria.id,
        rubricId: rubricCriteria.rubricId,
        maxPoints: rubricCriteria.maxPoints,
      })
      .from(rubricCriteria)
      .where(
        inArray(
          rubricCriteria.rubricId,
          visible.map((rubric) => rubric.id),
        ),
      );
    const criteriaByRubric = new Map<string, typeof criteria>();
    for (const criterion of criteria) {
      const bucket = criteriaByRubric.get(criterion.rubricId);
      if (bucket) bucket.push(criterion);
      else criteriaByRubric.set(criterion.rubricId, [criterion]);
    }
    const singleCriterion = new Map<string, { id: string; maxPoints: number }>();
    for (const [rubricId, bucket] of criteriaByRubric) {
      const [only] = bucket;
      if (bucket.length === 1 && only) {
        singleCriterion.set(rubricId, { id: only.id, maxPoints: Number(only.maxPoints) });
      }
    }
    if (singleCriterion.size === 0) return new Map();
    const levelRows = await tx
      .select({
        criterionId: rubricLevels.criterionId,
        score: rubricLevels.score,
        examples: rubricLevels.examples,
      })
      .from(rubricLevels)
      .where(
        inArray(
          rubricLevels.criterionId,
          [...singleCriterion.values()].map((criterion) => criterion.id),
        ),
      );
    const examplesByCriterionScore = new Map<string, string[]>();
    for (const row of levelRows) {
      if (row.examples && row.examples.length > 0) {
        examplesByCriterionScore.set(`${row.criterionId}|${Number(row.score)}`, row.examples);
      }
    }
    const result = new Map<string, Map<string, string[]>>();
    for (const item of rubricItems) {
      const criterion = item.rubricId === null ? undefined : singleCriterion.get(item.rubricId);
      if (!criterion) continue;
      const byLevel = new Map<string, string[]>();
      for (const level of item.levels) {
        const score = level.creditFraction * criterion.maxPoints;
        const examples = examplesByCriterionScore.get(`${criterion.id}|${score}`);
        if (examples) byLevel.set(level.code, examples);
      }
      if (byLevel.size > 0) result.set(item.id, byLevel);
    }
    return result;
  }

  private async gradeNamesByInstrument(
    tx: Database,
    rubricItems: readonly RubricItem[],
  ): Promise<Map<string, string>> {
    const instrumentIds = [
      ...new Set(
        rubricItems.flatMap((item) => (item.instrumentId === null ? [] : [item.instrumentId])),
      ),
    ];
    if (instrumentIds.length === 0) return new Map();
    const instrumentRows = await tx
      .select({ id: instruments.id, gradeId: instruments.gradeId })
      .from(instruments)
      .where(inArray(instruments.id, instrumentIds));
    const gradeIds = [
      ...new Set(instrumentRows.flatMap((row) => (row.gradeId === null ? [] : [row.gradeId]))),
    ];
    if (gradeIds.length === 0) return new Map();
    const gradeRows = await tx
      .select({ id: grades.id, name: grades.name })
      .from(grades)
      .where(inArray(grades.id, gradeIds));
    const nameByGrade = new Map(gradeRows.map((row) => [row.id, row.name]));
    const names = new Map<string, string>();
    for (const row of instrumentRows) {
      const name = row.gradeId === null ? undefined : nameByGrade.get(row.gradeId);
      if (name) names.set(row.id, name);
    }
    return names;
  }

  private async skipReasonFor(
    orgId: string,
    org: OrgSnapshot,
    plannedGradings: number,
  ): Promise<RubricGradingSkipReason | null> {
    if (org.settings.allowedProviders !== undefined) {
      const runtime = await this.llmConfig.resolve(orgId, RUBRIC_GRADING_LLM_FEATURE);
      if (!isProviderAllowedByOrg(org.settings, runtime.provider)) return 'provider_not_allowed';
    }
    const exceeded = await this.budget.isExceeded({
      orgId,
      orgConfig: org.config,
      settings: org.settings,
      plannedReadings: plannedGradings,
    });
    return exceeded ? 'budget_exceeded' : null;
  }

  private async createJobs(
    orgId: string,
    entries: readonly GradingEntry[],
    skipReason: RubricGradingSkipReason | null,
  ): Promise<PlannedGrading[]> {
    const planned: PlannedGrading[] = entries.map((entry, index) => ({
      entry,
      jobId: randomUUID(),
      skipReason:
        skipReason ?? (index >= this.options.maxRubricGradingsPerRun ? 'run_limit_exceeded' : null),
    }));
    await withOrgContext(this.db, orgId, (tx) =>
      tx.insert(aiGradingJobs).values(
        planned.map(({ entry, jobId, skipReason: reason }) => ({
          id: jobId,
          orgId,
          responseId: entry.responseId,
          type: RUBRIC_GRADING_JOB_TYPE,
          status: reason === null ? 'pending' : 'skipped',
          promptVersion: RUBRIC_GRADING_PROMPT_REF,
          input: {
            decisionId: entry.decision.id,
            itemId: entry.item.id,
            markId: entry.decision.markId,
          },
          ...(reason === null ? {} : { output: { reason }, completedAt: new Date() }),
        })),
      ),
    );
    const skipped = planned.filter((plan) => plan.skipReason !== null);
    if (skipped.length > 0) {
      reportServerError(new Error('Calificación con rúbrica omitida'), {
        orgId,
        skipped: skipped.length,
        reason: skipped[0]?.skipReason,
      });
    }
    return planned;
  }

  private async gradeOne(orgId: string, plan: PlannedGrading): Promise<void> {
    const { entry, jobId } = plan;
    let model: string | null = null;
    let costUsd: string | null = null;
    try {
      await this.updateJob(orgId, jobId, { status: 'processing' });
      const { prompt, outputSchema } = renderRubricGradingPrompt({
        promptRef: RUBRIC_GRADING_PROMPT_REF,
        levels: entry.levels,
        transcription: entry.transcription,
        stem: entry.item.stem,
        gradeName: entry.gradeName,
      });
      const result = await this.llm.completeStructured(
        {
          system: prompt.system,
          prompt: prompt.user,
          images: [],
          jsonSchema: outputSchema.schema as unknown as Record<string, unknown>,
          schemaName: STRUCTURED_SCHEMA_NAME,
          propertyOrder: [...outputSchema.propertyOrder],
          reasoning: 'off',
          maxTokens: this.options.rubricGradingMaxOutputTokens,
          timeoutMs: this.options.rubricGradingTimeoutMs,
        },
        orgId,
        RUBRIC_GRADING_LLM_FEATURE,
      );
      model = result.model;
      costUsd = this.costOf(result);
      const output = rubricGradeOutputSchema.safeParse(result.data);
      if (!output.success) {
        await this.failJob(orgId, jobId, 'invalid_output', model, costUsd, result.rawText);
        return;
      }
      const level = entry.item.levels.find((candidate) =>
        sameRubricCode(candidate.code, output.data.levelCode),
      );
      const scored = level ? this.scoreLevel(entry.item, level.code) : null;
      if (!level || scored === null || scored.rawScore === null) {
        await this.failJob(orgId, jobId, 'unknown_level', model, costUsd, result.rawText);
        return;
      }
      await this.saveProposal(orgId, plan, output.data, level.code, scored.rawScore, model, {
        costUsd,
        promptHash: prompt.hash,
      });
    } catch (error) {
      reportServerError(error, { orgId, jobId, stage: 'rubric_grading_call' });
      await this.failJob(orgId, jobId, 'provider_error', model, costUsd, null);
    }
  }

  private scoreLevel(item: RubricItem, levelCode: string): ScoringOutput {
    return rubricScoredStrategy.score({
      item: {
        id: item.id,
        type: item.type,
        content: item.content,
        maxScore: item.maxScore,
        scoringConfig: { points: item.maxScore },
      },
      rawAnswer: levelCode,
    });
  }

  private async saveProposal(
    orgId: string,
    plan: PlannedGrading,
    output: RubricGradeOutput,
    levelCode: string,
    score: number,
    model: string,
    meta: { costUsd: string | null; promptHash: string },
  ): Promise<void> {
    const now = new Date();
    const confidence = Math.round(output.confidence * 100) / 100;
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(aiGradingJobs)
        .set({
          status: 'completed',
          model,
          promptVersion: RUBRIC_GRADING_PROMPT_REF,
          output: { ...output, levelCode, promptHash: meta.promptHash },
          score: score.toFixed(2),
          confidence: confidence.toFixed(2),
          justification: output.rationale,
          costUsd: meta.costUsd,
          completedAt: now,
        })
        .where(and(eq(aiGradingJobs.orgId, orgId), eq(aiGradingJobs.id, plan.jobId)));
      await tx
        .update(responses)
        .set({
          aiScore: {
            score,
            confidence: output.confidence,
            levelCode,
            rationale: output.rationale,
            evidenceQuotes: output.evidenceQuotes,
            model,
            promptVersion: RUBRIC_GRADING_PROMPT_REF,
            decisionId: plan.entry.decision.id,
          },
          updatedAt: now,
        })
        .where(eq(responses.id, plan.entry.responseId));
    });
  }

  private async failJob(
    orgId: string,
    jobId: string,
    error: string,
    model: string | null,
    costUsd: string | null,
    rawText: string | null,
  ): Promise<void> {
    try {
      await this.updateJob(orgId, jobId, {
        status: 'failed',
        model,
        costUsd,
        output: { error, ...(rawText === null ? {} : { rawText }) },
        completedAt: new Date(),
      });
    } catch (updateError) {
      reportServerError(updateError, { orgId, jobId, stage: 'rubric_grading_fail_job' });
    }
  }

  private async updateJob(
    orgId: string,
    jobId: string,
    values: Partial<typeof aiGradingJobs.$inferInsert>,
  ): Promise<void> {
    await withOrgContext(this.db, orgId, (tx) =>
      tx
        .update(aiGradingJobs)
        .set(values)
        .where(and(eq(aiGradingJobs.orgId, orgId), eq(aiGradingJobs.id, jobId))),
    );
  }

  private costOf(result: LlmStructuredResult): string | null {
    if (result.usage === null) return null;
    return estimateLlmCostUsd(result.model, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
    });
  }
}
