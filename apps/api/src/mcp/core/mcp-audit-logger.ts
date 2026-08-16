import type { AnalyticsChannel } from './analytics-principal';

export interface McpAuditEntry {
  orgId: string | null;
  userId: string;
  tool: string;
  argsHash: string;
  channel: AnalyticsChannel;
  ok: boolean;
}

export abstract class McpAuditLogger {
  abstract record(entry: McpAuditEntry): Promise<void>;
}
