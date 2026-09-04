import type { AssessCaptureIdentityModel } from '@soe/types';

export function assessIdentityLabel(identity: AssessCaptureIdentityModel): string | null {
  const parts: string[] = [];
  if (identity.sheetSequence !== null) parts.push(`Hoja ${identity.sheetSequence}`);
  if (identity.studentName) parts.push(identity.studentName);
  return parts.length > 0 ? parts.join(' — ') : null;
}
