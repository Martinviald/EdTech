import type { FeatureKey } from '@soe/types';
import type { JwtPayload } from '../../auth/jwt-payload.types';

export type AnalyticsChannel = 'mcp-external' | 'in-app';

export interface AnalyticsPrincipal extends JwtPayload {
  features: readonly FeatureKey[];
  channel: AnalyticsChannel;
}
