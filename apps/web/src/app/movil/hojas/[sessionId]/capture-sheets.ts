import type { AssessCaptureIdentityModel } from '@soe/types';
import { assessIdentityLabel } from '@/app/(dashboard)/hojas/escanear/capture-identity';

/**
 * Una hoja capturada en esta sesión del teléfono, con su estado de subida.
 *
 * La lista es la fuente de verdad de la hoja inferior. `priorCount` (las hojas que
 * la sesión ya traía al canjear el QR) no entra acá porque de ellas no conocemos ni
 * identidad ni orden: se muestran agregadas en una sola fila.
 */
export type CapturedSheet = {
  id: string;
  identity: AssessCaptureIdentityModel | null;
  status: 'uploading' | 'done' | 'failed';
};

export type SheetRow = {
  id: string;
  /** Número de hoja dentro del lote completo (incluye las previas a esta sesión). */
  number: number;
  label: string;
  status: CapturedSheet['status'];
};

const UNRESOLVED_LABEL = 'Identidad por resolver';

export function sheetRowLabel(sheet: CapturedSheet): string {
  const label = sheet.identity ? assessIdentityLabel(sheet.identity) : null;
  return label ?? UNRESOLVED_LABEL;
}

export function toSheetRows(sheets: CapturedSheet[], priorCount: number): SheetRow[] {
  let number = priorCount;
  return sheets.map((sheet) => {
    if (sheet.status !== 'failed') number += 1;
    return { id: sheet.id, number, label: sheetRowLabel(sheet), status: sheet.status };
  });
}

/** Las fallidas no se cuentan: no entraron al lote. */
export function countCaptured(sheets: CapturedSheet[], priorCount: number): number {
  return priorCount + sheets.filter((sheet) => sheet.status !== 'failed').length;
}

export function isDuplicateIdentity(
  identity: AssessCaptureIdentityModel,
  sheets: CapturedSheet[],
): boolean {
  return sheets.some(({ identity: prev }) => {
    if (prev === null) return false;
    if (identity.printedSheetId !== null) {
      return (
        prev.printedSheetId === identity.printedSheetId && prev.pageIndex === identity.pageIndex
      );
    }
    return identity.studentId !== null && prev.studentId === identity.studentId;
  });
}
