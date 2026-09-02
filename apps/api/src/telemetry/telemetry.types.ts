import type {
  TelemetryContext,
  TelemetryEventCategory,
  TelemetrySource,
  UserRole,
} from '@soe/types';

export type TelemetryRecord = {
  orgId: string;
  userId: string | null;
  eventName: string;
  eventCategory: TelemetryEventCategory;
  source: TelemetrySource;
  role: UserRole | null;
  properties: Record<string, unknown>;
  context: TelemetryContext;
  occurredAt: Date;
};

export type TelemetryActor = {
  orgId: string | null;
  userId: string | null;
  role: UserRole | null;
};
