import { Injectable, Logger } from '@nestjs/common';
import { refreshBenchmarkAggregates } from '@soe/db';
import type { BenchmarkRefreshResponse } from '@soe/types';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class BenchmarkingRefreshService {
  private readonly logger = new Logger(BenchmarkingRefreshService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async refresh(): Promise<BenchmarkRefreshResponse> {
    const { refreshedOrgs, refreshedRows } = await refreshBenchmarkAggregates(this.db);

    this.logger.log(`Benchmark read-model refreshed: ${refreshedOrgs} orgs, ${refreshedRows} rows`);

    return {
      refreshedOrgs,
      refreshedRows,
      refreshedAt: new Date().toISOString(),
    };
  }

  private readonly runningOrgs = new Set<string>();
  private readonly pendingOrgs = new Set<string>();

  refreshOrgInBackground(orgId: string): void {
    if (this.runningOrgs.has(orgId)) {
      this.pendingOrgs.add(orgId);
      return;
    }
    this.runningOrgs.add(orgId);
    refreshBenchmarkAggregates(this.db, { orgId })
      .catch((error: unknown) => {
        reportServerError(error, { orgId, operation: 'benchmark-refresh-org' });
      })
      .finally(() => {
        this.runningOrgs.delete(orgId);
        if (this.pendingOrgs.delete(orgId)) this.refreshOrgInBackground(orgId);
      });
  }
}
