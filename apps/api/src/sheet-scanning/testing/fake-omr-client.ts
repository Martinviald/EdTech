import type { OmrAssessRequest, OmrAssessResult, OmrReadRequest, ScanResult } from '@soe/types';
import type { OmrClient } from '../omr-client.types';

export class FakeOmrClient implements OmrClient {
  readonly requests: OmrReadRequest[] = [];
  readonly assessRequests: OmrAssessRequest[] = [];
  private readonly responses: (ScanResult | Error)[] = [];
  private readonly assessResponses: (OmrAssessResult | Error)[] = [];

  enqueueResponse(response: ScanResult | Error): void {
    this.responses.push(response);
  }

  enqueueAssessResponse(response: OmrAssessResult | Error): void {
    this.assessResponses.push(response);
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

  async assess(request: OmrAssessRequest): Promise<OmrAssessResult> {
    this.assessRequests.push(request);
    const next = this.assessResponses.shift();
    if (!next) {
      throw new Error('FakeOmrClient: sin respuestas de assess encoladas');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
