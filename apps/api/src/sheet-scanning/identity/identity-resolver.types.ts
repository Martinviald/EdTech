import type { ScannedPage, SheetIdentityMode } from '@soe/types';

export interface IdentityCandidate {
  printedSheetId: string | null;
  studentId: string | null;
  confidence: number;
  evidence: Record<string, unknown>;
  needsHumanConfirmation: boolean;
  batchRejection: { reason: string } | null;
}

export interface SheetIdentityResolver {
  readonly mode: SheetIdentityMode;
  resolve(orgId: string, page: ScannedPage): Promise<IdentityCandidate>;
}

export function unresolvedIdentityCandidate(evidence: Record<string, unknown>): IdentityCandidate {
  return {
    printedSheetId: null,
    studentId: null,
    confidence: 0,
    evidence,
    needsHumanConfirmation: true,
    batchRejection: null,
  };
}
