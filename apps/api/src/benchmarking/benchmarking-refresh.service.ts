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

  refreshOrgInBackground(orgId: string): void {
    refreshBenchmarkAggregates(this.db, { orgId }).catch((error: unknown) => {
      reportServerError(error, { orgId, operation: 'benchmark-refresh-org' });
    });
  }
}
