import type { OmrReadRequest, ScanResult } from '@soe/types';

export const OMR_CLIENT = 'OMR_CLIENT';

export interface OmrClient {
  read(request: OmrReadRequest): Promise<ScanResult>;
}

export class OmrServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrServiceUnavailableError';
  }
}

export class OmrPageTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrPageTimeoutError';
  }
}
