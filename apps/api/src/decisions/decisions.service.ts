import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DecisionError,
  type DecisionEngine,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
} from '@soe/decisions';
import type { DecisionFeature, DecisionThresholds } from '@soe/types';
import { reportServerError } from '../common/observability/report-error';
import { ConcurrencyLimiter } from './concurrency-limiter';
import { DecisionCallsRecorder } from './decision-calls.recorder';
import { DECISION_ENGINES, DECISION_MAX_CONCURRENCY } from './decisions.constants';
import { DecisionsConfigService, type DecisionRuntimeConfig } from './decisions-config.service';

export type DecisionOutcome<Q extends DecisionQuestions> = DecisionResult<Q> & {
  readonly thresholds: DecisionThresholds;
};

export interface ShadowOptions {
  baseline?: Record<string, unknown>;
  correlationId?: string;
}

type RecordedMode = 'shadow' | 'live';

@Injectable()
export class DecisionsService {
  private readonly logger = new Logger(DecisionsService.name);
  private readonly registry: Map<string, DecisionEngine>;
  private readonly limiter = new ConcurrencyLimiter(DECISION_MAX_CONCURRENCY);

  constructor(
    private readonly config: DecisionsConfigService,
    private readonly recorder: DecisionCallsRecorder,
    @Inject(DECISION_ENGINES) engines: DecisionEngine[],
  ) {
    this.registry = new Map(engines.map((engine) => [engine.name, engine]));
  }

  async isLive(orgId: string, feature: DecisionFeature): Promise<boolean> {
    const cfg = await this.config.resolve(orgId, feature);
    return cfg.mode === 'live' && (this.registry.get(cfg.engine)?.isAvailable() ?? false);
  }

  async evaluate<Q extends DecisionQuestions>(
    orgId: string,
    feature: DecisionFeature,
    request: DecisionRequest<Q>,
  ): Promise<DecisionOutcome<Q>> {
    const cfg = await this.config.resolve(orgId, feature);
    if (cfg.mode !== 'live') {
      throw new DecisionError(
        'disabled',
        `La funcionalidad ${feature} no está en modo live (modo: ${cfg.mode})`,
      );
    }
    const engine = this.requireAvailableEngine(cfg);
    const result = await this.runAndRecord(engine, cfg, orgId, feature, 'live', request, {});
    return { ...result, thresholds: cfg.thresholds };
  }

  async shadow<Q extends DecisionQuestions>(
    orgId: string,
    feature: DecisionFeature,
    request: DecisionRequest<Q>,
    options: ShadowOptions = {},
  ): Promise<void> {
    const cfg = await this.resolveForShadow(orgId, feature);
    if (cfg?.mode !== 'shadow') return;
    const engine = this.registry.get(cfg.engine);
    if (!engine?.isAvailable()) return;

    try {
      await this.runAndRecord(engine, cfg, orgId, feature, 'shadow', request, options);
    } catch (error) {
      const decisionError = this.toDecisionError(error);
      this.logger.warn(`Sombra ${feature}: ${decisionError.code} — ${decisionError.message}`);
    }
  }

  private async resolveForShadow(
    orgId: string,
    feature: DecisionFeature,
  ): Promise<DecisionRuntimeConfig | null> {
    try {
      return await this.config.resolve(orgId, feature);
    } catch (error) {
      reportServerError(error, { scope: 'decisions.shadow', orgId, feature });
      return null;
    }
  }

  private async runAndRecord<Q extends DecisionQuestions>(
    engine: DecisionEngine,
    cfg: DecisionRuntimeConfig,
    orgId: string,
    feature: DecisionFeature,
    mode: RecordedMode,
    request: DecisionRequest<Q>,
    options: ShadowOptions,
  ): Promise<DecisionResult<Q>> {
    const common = {
      orgId,
      feature,
      engine: cfg.engine,
      mode,
      state: request.state,
      baseline: options.baseline ?? null,
      correlationId: options.correlationId ?? null,
    };

    let result: DecisionResult<Q>;
    try {
      result = await this.limiter.run(() =>
        engine.evaluate({ ...request, model: request.model ?? cfg.model }),
      );
    } catch (error) {
      const decisionError = this.toDecisionError(error);
      await this.recorder.record({
        ...common,
        model: null,
        answers: null,
        errorCode: decisionError.code,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: null,
      });
      throw decisionError;
    }

    await this.recorder.record({
      ...common,
      model: result.model,
      answers: result.answers,
      errorCode: null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
    });
    return result;
  }

  private requireAvailableEngine(cfg: DecisionRuntimeConfig): DecisionEngine {
    const engine = this.registry.get(cfg.engine);
    if (!engine) {
      throw new DecisionError(
        'unavailable',
        `El motor de decisiones "${cfg.engine}" no está registrado`,
      );
    }
    if (!engine.isAvailable()) {
      throw new DecisionError(
        'unavailable',
        `El motor de decisiones "${cfg.engine}" no está disponible: revisa su API key`,
      );
    }
    return engine;
  }

  private toDecisionError(error: unknown): DecisionError {
    if (error instanceof DecisionError) return error;
    return new DecisionError(
      'upstream',
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}
