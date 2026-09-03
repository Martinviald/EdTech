import type { OmrQrPayload } from '@soe/types';
import type { IdentityCandidate } from './identity-resolver.types';

type MismatchCandidate = Omit<IdentityCandidate, 'printedSheetId'>;

export function layoutHashMismatch(
  payload: OmrQrPayload,
  sheetSpecHash: string,
  batchSpecHash: string,
  qrRaw: string,
): MismatchCandidate | null {
  if (payload.kind === 'full') {
    if (payload.layoutHash === sheetSpecHash.toLowerCase()) return null;
    return {
      studentId: null,
      confidence: 0,
      evidence: { qr: qrRaw, qrLayoutHash: payload.layoutHash, layoutSpecHash: sheetSpecHash },
      needsHumanConfirmation: false,
      batchRejection: {
        reason: `El instrumento fue editado después de imprimir las hojas: el diseño impreso (hash ${payload.layoutHash}) no coincide con el diseño de la tirada (hash ${sheetSpecHash}). Reimprime las hojas con el diseño vigente y vuelve a escanear el lote completo.`,
      },
    };
  }

  if (sheetSpecHash.toLowerCase() === batchSpecHash.toLowerCase()) return null;
  return {
    studentId: null,
    confidence: 0,
    evidence: { qr: qrRaw, sheetLayoutHash: sheetSpecHash, batchLayoutHash: batchSpecHash },
    needsHumanConfirmation: false,
    batchRejection: {
      reason: `El diseño impreso en las hojas (hash ${sheetSpecHash}) no coincide con el diseño de la tirada de este lote (hash ${batchSpecHash}). El instrumento fue editado o las hojas pertenecen a otra tirada: reimprime las hojas o crea el lote sobre la tirada correcta. Ninguna hoja de este lote fue corregida.`,
    },
  };
}
