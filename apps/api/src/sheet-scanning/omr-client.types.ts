import type { OmrAssessRequest, OmrAssessResult, OmrReadRequest, ScanReadResult } from '@soe/types';

export const OMR_CLIENT = 'OMR_CLIENT';

export interface OmrClient {
  read(request: OmrReadRequest): Promise<ScanReadResult>;
  assess(request: OmrAssessRequest): Promise<OmrAssessResult>;
}

export class OmrServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrServiceUnavailableError';
  }
}

export class OmrSourceUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrSourceUnreadableError';
  }
}

export class OmrPageTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrPageTimeoutError';
  }
}
