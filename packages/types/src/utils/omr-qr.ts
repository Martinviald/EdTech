import { LAYOUT_HASH_LENGTH } from './layout-hash';

// Payload del QR de una hoja impresa (§3.2):
//   academos:v1:<printedSheetId>:<layoutHash>:<pageIndex>:<pageCount>
// El printedSheetId es la PK de printed_sheets; no contiene datos personales.
// Impresor (lo construye) y QrIdentityResolver (lo interpreta) usan EXACTAMENTE
// estas dos funciones — nunca un split() artesanal en otro lado.

export const OMR_QR_PREFIX = 'academos';
export const OMR_QR_VERSION = 'v1';

export type OmrQrPayload = {
  printedSheetId: string;
  layoutHash: string;
  pageIndex: number;
  pageCount: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = new RegExp(`^[0-9a-f]{${LAYOUT_HASH_LENGTH}}$`, 'i');

export function buildOmrQrPayload(payload: OmrQrPayload): string {
  const { printedSheetId, layoutHash, pageIndex, pageCount } = payload;
  return [OMR_QR_PREFIX, OMR_QR_VERSION, printedSheetId, layoutHash, pageIndex, pageCount].join(':');
}

export function parseOmrQrPayload(raw: string): OmrQrPayload | null {
  const parts = raw.trim().split(':');
  if (parts.length !== 6) return null;
  const [prefix, version, printedSheetId, layoutHash, pageIndexRaw, pageCountRaw] = parts;
  if (prefix !== OMR_QR_PREFIX || version !== OMR_QR_VERSION) return null;
  if (!printedSheetId || !UUID_RE.test(printedSheetId)) return null;
  if (!layoutHash || !HASH_RE.test(layoutHash)) return null;
  const pageIndex = Number(pageIndexRaw);
  const pageCount = Number(pageCountRaw);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
  if (!Number.isInteger(pageCount) || pageCount <= 0) return null;
  if (pageIndex >= pageCount) return null;
  return { printedSheetId, layoutHash: layoutHash.toLowerCase(), pageIndex, pageCount };
}
