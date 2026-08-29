import type { OmrReadRequest, ScanResult } from '@soe/types';
import type { OmrClient } from '../omr-client.types';

export class FakeOmrClient implements OmrClient {
  readonly requests: OmrReadRequest[] = [];
  private readonly responses: (ScanResult | Error)[] = [];

  enqueueResponse(response: ScanResult | Error): void {
    this.responses.push(response);
  }

  async read(request: OmrReadRequest): Promise<ScanResult> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (!next) {
      return { pages: [] };
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
