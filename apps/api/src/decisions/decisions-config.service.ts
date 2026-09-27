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
import { InjectDb, type Database } from '../database/database.types';

export interface DecisionRuntimeConfig {
  engine: DecisionEngineId;
  model: string;
  mode: DecisionMode;
  thresholds: DecisionThresholds;
  source: 'default' | 'global' | 'org';
}

@Injectable()
export class DecisionsConfigService {
  constructor(@InjectDb() private readonly db: Database) {}

  async resolve(orgId: string, feature: DecisionFeature): Promise<DecisionRuntimeConfig> {
    const codeDefault = DECISION_FEATURE_DEFAULTS[feature];
    const row = await this.findMostSpecificSetting(orgId, feature);
    if (!row) {
      return { ...codeDefault, source: 'default' };
    }

    const thresholds = decisionThresholdsSchema.safeParse(row.thresholds);
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
