import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { decisionSettings, withOrgContext } from '@soe/db';
import {
  DECISION_FEATURE_DEFAULTS,
  decisionThresholdsSchema,
  type DecisionEngineId,
  type DecisionFeature,
  type DecisionMode,
  type DecisionThresholds,
} from '@soe/types';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import { DECISION_CONFIG_CACHE_TTL_MS } from './decisions.constants';

export interface DecisionRuntimeConfig {
  engine: DecisionEngineId;
  model: string;
  mode: DecisionMode;
  thresholds: DecisionThresholds;
  source: 'default' | 'global' | 'org';
}

interface CachedConfig {
  config: Promise<DecisionRuntimeConfig>;
  expiresAt: number;
}

@Injectable()
export class DecisionsConfigService {
  private readonly cache = new Map<string, CachedConfig>();

  constructor(@InjectDb() private readonly db: Database) {}

  async resolve(orgId: string, feature: DecisionFeature): Promise<DecisionRuntimeConfig> {
    const cacheKey = `${orgId}:${feature}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.config;
    }
    const config = this.resolveUncached(orgId, feature);
    this.cache.set(cacheKey, { config, expiresAt: Date.now() + DECISION_CONFIG_CACHE_TTL_MS });
    config.catch(() => this.cache.delete(cacheKey));
    return config;
  }

  private async resolveUncached(
    orgId: string,
    feature: DecisionFeature,
  ): Promise<DecisionRuntimeConfig> {
    const codeDefault = DECISION_FEATURE_DEFAULTS[feature];
    const row = await this.findMostSpecificSetting(orgId, feature);
    if (!row) {
      return { ...codeDefault, source: 'default' };
    }

    const thresholds = decisionThresholdsSchema.safeParse(row.thresholds);
    if (!thresholds.success) {
      reportServerError(thresholds.error, {
        scope: 'decision_settings.thresholds',
        orgId,
        feature,
      });
    }
    return {
      engine: row.engine,
      model: row.model,
      mode: row.mode,
      thresholds: thresholds.success ? thresholds.data : codeDefault.thresholds,
      source: row.orgId ? 'org' : 'global',
    };
  }

  private async findMostSpecificSetting(orgId: string, feature: DecisionFeature) {
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          orgId: decisionSettings.orgId,
          engine: decisionSettings.engine,
          model: decisionSettings.model,
          mode: decisionSettings.mode,
          thresholds: decisionSettings.thresholds,
        })
        .from(decisionSettings)
        .where(
          and(
            eq(decisionSettings.feature, feature),
            or(isNull(decisionSettings.orgId), eq(decisionSettings.orgId, orgId)),
          ),
        )
        .orderBy(sql`${decisionSettings.orgId} NULLS LAST`)
        .limit(1),
    );
    return rows[0] ?? null;
  }
}
