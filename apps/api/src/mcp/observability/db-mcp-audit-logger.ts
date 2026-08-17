import { Injectable } from '@nestjs/common';
import { mcpAccessLogs, withOrgContext } from '@soe/db';
import { InjectDb, type Database } from '../../database/database.types';
import { reportServerError } from '../../common/observability/report-error';
import { McpAuditLogger, type McpAuditEntry } from '../core/mcp-audit-logger';

@Injectable()
export class DbMcpAuditLogger extends McpAuditLogger {
  constructor(@InjectDb() private readonly db: Database) {
    super();
  }

  async record(entry: McpAuditEntry): Promise<void> {
    if (!entry.orgId) return;
    const orgId = entry.orgId;
    try {
      await withOrgContext(this.db, orgId, async (tx) => {
        await tx.insert(mcpAccessLogs).values({
          orgId,
          userId: entry.userId,
          tool: entry.tool,
          argsHash: entry.argsHash,
          channel: entry.channel,
          ok: entry.ok,
        });
      });
    } catch (error) {
      reportServerError(error, {
        context: 'mcp-audit',
        tool: entry.tool,
        orgId,
      });
    }
  }
}
