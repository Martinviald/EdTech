import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { files, sheetScanMarks, sheetScans, withOrgContext, type FileRecord } from '@soe/db';
import {
  DecisionError,
  pairConsensus,
  type ChoiceAnswer,
  type DecisionImage,
  type PairSide,
  type PairThresholds,
} from '@soe/decisions';
import {
  MARK_ANSWER_BLANK,
  MARK_DISAMBIGUATION_DECISION_VERSION,
  MARK_DISAMBIGUATION_FEATURES,
  MARK_DISAMBIGUATION_QUESTION_ID,
  markAnswerToReview,
  pairThresholdsSchema,
  type DecisionEngineId,
  type DecisionFeature,
  type DoubtReason,
  type LayoutField,
  type LayoutSpec,
  type MarkAiEngineResult,
  type MarkAiResolution,
  type MarkAiVerdict,
  type MarkState,
  type SheetScanState,
} from '@soe/types';
import { ConcurrencyLimiter } from '../common/concurrency/concurrency-limiter';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import { DecisionsService, type DecisionFeatureSettings } from '../decisions/decisions.service';
import { FilesService } from '../files/files.service';
import {
  buildMarkDisambiguationDecision,
  collidesWithReservedAnswers,
  markDisambiguationChoiceKeys,
  markDisambiguationOptions,
  type MarkDisambiguationDecision,
} from './mark-disambiguation-decision';

export const MARK_DISAMBIGUATION_BATCH_DEADLINE_MS = 90_000;
export const MARK_DISAMBIGUATION_CONCURRENCY = 3;
export const MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH = 500;
export const MARK_DISAMBIGUATION_AUDIT_RATE = 0.05;
export const MARK_DISAMBIGUATION_CALL_TIMEOUT_MS = 8_000;
export const MARK_DISAMBIGUATION_IDENTITY_MARGIN_RADII = 1.5;
export const MARK_DISAMBIGUATION_KILL_SWITCH_ENV = 'MARK_DISAMBIGUATION_AI_DISABLED';

export interface MarkDisambiguationCandidate {
  markId: string;
  scanId: string;
  fieldId: string;
  state: MarkState;
  cropJpegBase64: string;
  scanState: SheetScanState;
  autoAnnulled: boolean;
  doubtReason: DoubtReason | null;
  suggestedValue: string | null;
  nullConfidence: number | null;
  fill: number;
  margin: number;
}

export type PipelineMode = 'shadow' | 'live';

export type EngineSlot = 'jev' | 'openai';

export interface SlotConfig {
  slot: EngineSlot;
  feature: DecisionFeature;
  settings: DecisionFeatureSettings;
  thresholds: PairThresholds | null;
}

export interface MarkDisambiguationPipeline {
  mode: PipelineMode;
  jev: SlotConfig;
  openai: SlotConfig;
}

interface WorkItem {
  markId: string;
  fieldId: string;
  state: MarkState;
  image: DecisionImage;
  options: string[];
  baseline: Record<string, unknown>;
}

interface SideOutcome {
  side: PairSide;
  model: string | null;
}

const PENDING_MARK_STATES: MarkState[] = ['multiple', 'ambiguous'];
const EXCLUDED_SCAN_STATES: SheetScanState[] = ['quality_rejected', 'superseded'];
const EXPECTED_ENGINE: Record<EngineSlot, DecisionEngineId> = { jev: 'jev', openai: 'openai' };

@Injectable()
export class MarkDisambiguationService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly decisions: DecisionsService,
    private readonly filesService: FilesService,
  ) {}

  async pipelineFor(orgId: string, batchId: string): Promise<MarkDisambiguationPipeline | null> {
    try {
      return await this.resolvePipeline(orgId, batchId);
    } catch (error) {
      reportServerError(error, { scope: 'mark_disambiguation', orgId, batchId });
      return null;
    }
  }

  async resolveBatch(
    orgId: string,
    batchId: string,
    spec: LayoutSpec,
    candidates: readonly MarkDisambiguationCandidate[],
    pipeline?: MarkDisambiguationPipeline,
  ): Promise<void> {
    try {
      const config = pipeline ?? (await this.resolvePipeline(orgId, batchId));
      if (config === null) return;
      const items = await this.collectWork(orgId, batchId, spec, candidates, config.mode);
      if (items.length === 0) return;
      await this.runWithDeadline(orgId, batchId, config, items);
    } catch (error) {
      reportServerError(error, { scope: 'mark_disambiguation', orgId, batchId });
    }
  }

  private async resolvePipeline(
    orgId: string,
    batchId: string,
  ): Promise<MarkDisambiguationPipeline | null> {
    if (this.isDisabledByKillSwitch()) return null;
    const [jev, openai] = await Promise.all([
      this.slotConfig(orgId, 'jev'),
      this.slotConfig(orgId, 'openai'),
    ]);
    const modes = { jev: jev.settings.mode, openai: openai.settings.mode };
    if (modes.jev === 'off' && modes.openai === 'off') return null;
    if (modes.jev !== modes.openai || modes.jev === 'off') {
      this.report('mode_mismatch', orgId, batchId, { modes });
      return null;
    }
    const mode: PipelineMode = modes.jev === 'live' ? 'live' : 'shadow';
    for (const slot of [jev, openai]) {
      if (slot.settings.engine !== EXPECTED_ENGINE[slot.slot]) {
        this.report('misconfigured', orgId, batchId, {
          feature: slot.feature,
          engine: slot.settings.engine,
          expected: EXPECTED_ENGINE[slot.slot],
        });
        return null;
      }
      if (!slot.settings.available || !slot.settings.acceptsImages) {
        this.report('misconfigured', orgId, batchId, {
          feature: slot.feature,
          reason: slot.settings.available
            ? 'el motor no acepta imágenes (JEV_EXPERIMENTAL_IMAGES)'
            : 'el motor no está disponible (falta su API key)',
        });
        return null;
      }
      if (mode === 'live' && slot.thresholds === null) {
        this.report('misconfigured', orgId, batchId, {
          feature: slot.feature,
          reason: 'sin umbrales válidos en live',
        });
        return null;
      }
    }
    return { mode, jev, openai };
  }

  private isDisabledByKillSwitch(): boolean {
    return process.env[MARK_DISAMBIGUATION_KILL_SWITCH_ENV]?.trim().toLowerCase() === 'true';
  }

  private async slotConfig(orgId: string, slot: EngineSlot): Promise<SlotConfig> {
    const feature = MARK_DISAMBIGUATION_FEATURES[slot];
    const settings = await this.decisions.settingsOf(orgId, feature);
    const parsed = pairThresholdsSchema.safeParse(
      settings.thresholds[MARK_DISAMBIGUATION_QUESTION_ID],
    );
    return { slot, feature, settings, thresholds: parsed.success ? parsed.data : null };
  }

  private async collectWork(
    orgId: string,
    batchId: string,
    spec: LayoutSpec,
    candidates: readonly MarkDisambiguationCandidate[],
    mode: PipelineMode,
  ): Promise<WorkItem[]> {
    const optionsByField = this.eligibleFields(orgId, batchId, spec);
    const items: WorkItem[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      seen.add(candidate.markId);
      if (!this.isEligibleCandidate(candidate, mode)) continue;
      const options = optionsByField.get(candidate.fieldId);
      if (!options) continue;
      items.push({
        markId: candidate.markId,
        fieldId: candidate.fieldId,
        state: candidate.state,
        image: { mimeType: 'image/jpeg', data: candidate.cropJpegBase64 },
        options,
        baseline: this.baselineOf(candidate),
      });
    }
    if (items.length < MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH) {
      const pending = await this.catchUpWork(orgId, batchId, mode, optionsByField, seen);
      items.push(...pending);
    }
    if (items.length > MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH) {
      this.report('max_marks', orgId, batchId, {
        marks: items.length,
        max: MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH,
      });
    }
    return items.slice(0, MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH);
  }

  private isEligibleCandidate(candidate: MarkDisambiguationCandidate, mode: PipelineMode): boolean {
    if (!PENDING_MARK_STATES.includes(candidate.state)) return false;
    if (EXCLUDED_SCAN_STATES.includes(candidate.scanState)) return false;
    if (candidate.cropJpegBase64.length === 0) return false;
    return mode === 'shadow' || !candidate.autoAnnulled;
  }

  private eligibleFields(orgId: string, batchId: string, spec: LayoutSpec): Map<string, string[]> {
    const eligible = new Map<string, string[]>();
    const collisions: string[] = [];
    const identityOverlaps: string[] = [];
    for (const field of spec.fields) {
      if (field.kind !== 'bubble_group' || field.selectMode !== 'single') continue;
      if (field.bubbles.length < 2 || !this.isSingleRow(field)) continue;
      const options = markDisambiguationOptions(field);
      if (collidesWithReservedAnswers(options)) {
        collisions.push(field.fieldId);
        continue;
      }
      if (this.overlapsIdentity(field, spec.identity.region)) {
        identityOverlaps.push(field.fieldId);
        continue;
      }
      eligible.set(field.fieldId, options);
    }
    if (collisions.length > 0) {
      this.report('reserved_value_collision', orgId, batchId, { fieldIds: collisions });
    }
    if (identityOverlaps.length > 0) {
      this.report('identity_overlap', orgId, batchId, { fieldIds: identityOverlaps });
    }
    return eligible;
  }

  private isSingleRow(field: LayoutField): boolean {
    const ys = field.bubbles.map((bubble) => bubble.center.y);
    const minRadius = Math.min(...field.bubbles.map((bubble) => bubble.radius));
    return Math.max(...ys) - Math.min(...ys) <= minRadius;
  }

  private overlapsIdentity(field: LayoutField, region: LayoutSpec['identity']['region']): boolean {
    const maxRadius = Math.max(...field.bubbles.map((bubble) => bubble.radius));
    const pad = maxRadius * (1 + MARK_DISAMBIGUATION_IDENTITY_MARGIN_RADII);
    const xs = field.bubbles.map((bubble) => bubble.center.x);
    const ys = field.bubbles.map((bubble) => bubble.center.y);
    const left = Math.min(...xs) - pad;
    const right = Math.max(...xs) + pad;
    const top = Math.min(...ys) - pad;
    const bottom = Math.max(...ys) + pad;
    return (
      left < region.bottomRight.x &&
      right > region.topLeft.x &&
      top < region.bottomRight.y &&
      bottom > region.topLeft.y
    );
  }

  private baselineOf(candidate: {
    state: MarkState;
    doubtReason: DoubtReason | null;
    suggestedValue: string | null;
    nullConfidence: number | null;
    fill: number;
    margin: number;
    fieldId: string;
    autoAnnulled: boolean;
  }): Record<string, unknown> {
    return {
      state: candidate.state,
      doubtReason: candidate.doubtReason,
      suggestedValue: candidate.suggestedValue,
      nullConfidence: candidate.nullConfidence,
      fill: candidate.fill,
      margin: candidate.margin,
      fieldId: candidate.fieldId,
      autoAnnulled: candidate.autoAnnulled,
    };
  }

  private async catchUpWork(
    orgId: string,
    batchId: string,
    mode: PipelineMode,
    optionsByField: Map<string, string[]>,
    seen: ReadonlySet<string>,
  ): Promise<WorkItem[]> {
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          markId: sheetScanMarks.id,
          fieldId: sheetScanMarks.fieldId,
          state: sheetScanMarks.state,
          fill: sheetScanMarks.fill,
          margin: sheetScanMarks.margin,
          suggestedValue: sheetScanMarks.suggestedValue,
          doubtReason: sheetScanMarks.doubtReason,
          nullConfidence: sheetScanMarks.nullConfidence,
          autoResolved: sheetScanMarks.autoResolved,
          reviewedById: sheetScanMarks.reviewedById,
          reviewDecision: sheetScanMarks.reviewDecision,
          file: files,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .innerJoin(files, eq(files.id, sheetScanMarks.cropFileId))
        .where(
          and(
            eq(sheetScanMarks.orgId, orgId),
            eq(sheetScans.batchId, batchId),
            notInArray(sheetScans.state, EXCLUDED_SCAN_STATES),
            inArray(sheetScanMarks.state, PENDING_MARK_STATES),
            isNotNull(sheetScanMarks.cropFileId),
            isNull(sheetScanMarks.aiResolution),
            mode === 'live' ? isNull(sheetScanMarks.reviewedAt) : undefined,
          ),
        ),
    );
    const items: WorkItem[] = [];
    for (const row of rows) {
      if (seen.has(row.markId)) continue;
      const options = optionsByField.get(row.fieldId);
      if (!options) continue;
      const url = this.cropUrl(row.file);
      if (url === null) continue;
      const autoAnnulled =
        row.autoResolved && row.reviewedById === null && row.reviewDecision === 'annulled';
      if (mode === 'live' && autoAnnulled) continue;
      items.push({
        markId: row.markId,
        fieldId: row.fieldId,
        state: row.state,
        image: { url },
        options,
        baseline: this.baselineOf({
          state: row.state,
          doubtReason: row.doubtReason,
          suggestedValue: row.suggestedValue,
          nullConfidence: row.nullConfidence === null ? null : Number(row.nullConfidence),
          fill: Number(row.fill),
          margin: Number(row.margin),
          fieldId: row.fieldId,
          autoAnnulled,
        }),
      });
    }
    return items;
  }

  private cropUrl(file: FileRecord): string | null {
    return this.filesService.buildDownloadUrl(file, 'inline') ?? null;
  }

  private async runWithDeadline(
    orgId: string,
    batchId: string,
    config: MarkDisambiguationPipeline,
    items: readonly WorkItem[],
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MARK_DISAMBIGUATION_BATCH_DEADLINE_MS);
    const limiter = new ConcurrencyLimiter(MARK_DISAMBIGUATION_CONCURRENCY);
    try {
      await Promise.all(
        items.map((item) =>
          limiter.run(async () => {
            if (controller.signal.aborted) return;
            try {
              await this.resolveItem(orgId, config, item, controller.signal);
            } catch (error) {
              reportServerError(error, {
                scope: 'mark_disambiguation.mark',
                orgId,
                batchId,
                markId: item.markId,
              });
            }
          }),
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveItem(
    orgId: string,
    config: MarkDisambiguationPipeline,
    item: WorkItem,
    signal: AbortSignal,
  ): Promise<void> {
    const decision = buildMarkDisambiguationDecision(item.options);
    const [jev, openai] = await Promise.all([
      this.callEngine(orgId, config.mode, config.jev, decision, item, signal),
      this.callEngine(orgId, config.mode, config.openai, decision, item, signal),
    ]);
    if (signal.aborted) return;

    const resolution = this.decide(config, item, jev, openai);
    await this.persist(orgId, item.markId, resolution);
  }

  private async callEngine(
    orgId: string,
    mode: PipelineMode,
    slot: SlotConfig,
    decision: MarkDisambiguationDecision,
    item: WorkItem,
    signal: AbortSignal,
  ): Promise<SideOutcome> {
    const request = {
      state: decision.state,
      questions: decision.questions,
      images: [item.image],
      timeoutMs: MARK_DISAMBIGUATION_CALL_TIMEOUT_MS,
      signal,
    };
    const options = { baseline: item.baseline, correlationId: item.markId };
    if (mode === 'shadow') {
      const result = await this.decisions.shadow(orgId, slot.feature, request, options);
      if (result === null) {
        return { side: { status: 'failed', code: 'dropped' }, model: slot.settings.model };
      }
      return {
        side: this.okSide(result.answers[MARK_DISAMBIGUATION_QUESTION_ID]),
        model: result.model,
      };
    }
    try {
      const result = await this.decisions.evaluate(orgId, slot.feature, request, options);
      return {
        side: this.okSide(result.answers[MARK_DISAMBIGUATION_QUESTION_ID]),
        model: result.model,
      };
    } catch (error) {
      if (!(error instanceof DecisionError)) {
        reportServerError(error, {
          scope: 'mark_disambiguation.engine',
          orgId,
          feature: slot.feature,
          markId: item.markId,
        });
      }
      const code = error instanceof DecisionError ? error.code : 'upstream';
      return { side: { status: 'failed', code }, model: slot.settings.model };
    }
  }

  private okSide(answer: ChoiceAnswer<string>): PairSide {
    return { status: 'ok', answer };
  }

  private decide(
    config: MarkDisambiguationPipeline,
    item: WorkItem,
    jev: SideOutcome,
    openai: SideOutcome,
  ): MarkAiResolution {
    const base = {
      version: MARK_DISAMBIGUATION_DECISION_VERSION,
      mode: config.mode,
      applied: false,
      engines: [this.engineResult(config.jev, jev), this.engineResult(config.openai, openai)],
      thresholds: { jev: config.jev.thresholds, openai: config.openai.thresholds },
      decidedAt: new Date().toISOString(),
    };
    if (config.jev.thresholds === null || config.openai.thresholds === null) {
      return { ...base, verdict: 'no_thresholds', route: 'review', value: null };
    }
    const consensus = pairConsensus(
      jev.side,
      openai.side,
      config.jev.thresholds,
      config.openai.thresholds,
      markDisambiguationChoiceKeys(item.options),
    );
    if (consensus.route !== 'auto' || consensus.choice === null) {
      return { ...base, verdict: consensus.verdict, route: 'review', value: null };
    }
    const verdict = this.vetoOrAudit(config.mode, item, consensus.choice);
    if (verdict !== null) {
      return { ...base, verdict, route: 'review', value: consensus.choice };
    }
    return { ...base, verdict: consensus.verdict, route: 'auto', value: consensus.choice };
  }

  private vetoOrAudit(mode: PipelineMode, item: WorkItem, choice: string): MarkAiVerdict | null {
    if (item.state === 'multiple' && choice === MARK_ANSWER_BLANK) return 'vetoed';
    if (mode === 'live' && this.isAuditSample(item.markId)) return 'audit_sample';
    return null;
  }

  private isAuditSample(markId: string): boolean {
    const bucket = parseInt(createHash('sha256').update(markId).digest('hex').slice(0, 8), 16);
    return bucket / 2 ** 32 < MARK_DISAMBIGUATION_AUDIT_RATE;
  }

  private engineResult(slot: SlotConfig, outcome: SideOutcome): MarkAiEngineResult {
    const side = outcome.side;
    return {
      feature: slot.feature,
      engine: slot.settings.engine,
      model: outcome.model,
      choice: side.status === 'ok' ? side.answer.choice : null,
      confidence: side.status === 'ok' ? side.answer.confidence : null,
      errorCode: side.status === 'ok' ? null : side.code,
    };
  }

  private async persist(
    orgId: string,
    markId: string,
    resolution: MarkAiResolution,
  ): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      const target = and(
        eq(sheetScanMarks.id, markId),
        eq(sheetScanMarks.orgId, orgId),
        isNull(sheetScanMarks.aiResolution),
      );
      if (resolution.mode === 'live' && resolution.route === 'auto' && resolution.value !== null) {
        const applied = await tx
          .update(sheetScanMarks)
          .set({
            ...markAnswerToReview(resolution.value),
            reviewedAt: new Date(),
            reviewedById: null,
            autoResolved: true,
            aiResolution: { ...resolution, applied: true },
          })
          .where(and(target, isNull(sheetScanMarks.reviewedAt)))
          .returning({ id: sheetScanMarks.id });
        if (applied.length > 0) return;
      }
      await tx
        .update(sheetScanMarks)
        .set({ aiResolution: { ...resolution, applied: false } })
        .where(target);
    });
  }

  private report(
    reason: string,
    orgId: string,
    batchId: string,
    context: Record<string, unknown>,
  ): void {
    reportServerError(new Error(`Desambiguación de marcas omitida: ${reason}`), {
      scope: `mark_disambiguation.${reason}`,
      orgId,
      batchId,
      ...context,
    });
  }
}
