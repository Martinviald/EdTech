import type { Database } from '@soe/db';
import { refreshBenchmarkAggregates } from '@soe/db';
import { reportServerError } from '../common/observability/report-error';
import { BenchmarkingRefreshService } from './benchmarking-refresh.service';

jest.mock('@soe/db', () => ({
  ...jest.requireActual('@soe/db'),
  refreshBenchmarkAggregates: jest.fn(),
}));

jest.mock('../common/observability/report-error', () => ({
  reportServerError: jest.fn(),
}));

const refreshMock = refreshBenchmarkAggregates as jest.MockedFunction<
  typeof refreshBenchmarkAggregates
>;
const reportMock = reportServerError as jest.MockedFunction<typeof reportServerError>;

function makeService(): BenchmarkingRefreshService {
  return new (BenchmarkingRefreshService as new (db: Database) => BenchmarkingRefreshService)(
    {} as Database,
  );
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('BenchmarkingRefreshService', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    reportMock.mockReset();
  });

  it('refresh reconstruye el read-model completo y reporta los totales', async () => {
    refreshMock.mockResolvedValue({ refreshedOrgs: 2, refreshedRows: 130 });

    const res = await makeService().refresh();

    expect(refreshMock).toHaveBeenCalledWith(expect.anything());
    expect(res).toMatchObject({ refreshedOrgs: 2, refreshedRows: 130 });
    expect(typeof res.refreshedAt).toBe('string');
  });

  it('refreshOrgInBackground acota el refresh a la org y no espera', () => {
    refreshMock.mockReturnValue(new Promise(() => undefined));

    expect(makeService().refreshOrgInBackground('org-1')).toBeUndefined();
    expect(refreshMock).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1' });
  });

  it('refreshOrgInBackground reporta el error sin propagarlo', async () => {
    const error = new Error('CONNECTION_CLOSED');
    refreshMock.mockRejectedValue(error);

    makeService().refreshOrgInBackground('org-1');
    await flushPromises();

    expect(reportMock).toHaveBeenCalledWith(error, {
      orgId: 'org-1',
      operation: 'benchmark-refresh-org',
    });
  });
});
