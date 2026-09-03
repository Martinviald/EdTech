import { LAYOUT_HASH_LENGTH } from './layout-hash';

// Payload del QR de una hoja impresa. Dos formatos:
//
// CORTO (el que se imprime desde la identidad robusta, doc 07 §4.1):
//   AC:<shortCode hex8 MAYUSCULA>:<pageIndex>
//   14 caracteres maximos, solo charset alfanumerico de QR => version 1
//   (21x21) incluso con ECC Q. El shortCode es un entero de 32 bits unico
//   por org (printed_sheets.short_code); el hash del diseño NO viaja — el
//   gate G1 se evalua contra la base al resolver la hoja.
//
// COMPLETO (legado, hojas ya impresas):
//   academos:v1:<printedSheetId>:<layoutHash>:<pageIndex>:<pageCount>
//   69 caracteres => version 5 (37x37), cuyo modulo de ~1 mm cae en la zona
//   de aliasing del escaner (doc 07 §2). Se sigue parseando para siempre:
//   las hojas impresas con el no caducan.
//
// Impresor (construye) y resolvers (interpretan) usan EXACTAMENTE estas
// funciones — nunca un split() artesanal en otro lado. El lector Python
// espeja el parse minimo que necesita en services/omr/app/identity.py
// (peek_logical_page_index); si esto cambia, aquello cambia.

export const OMR_QR_PREFIX = 'academos';
export const OMR_QR_VERSION = 'v1';
export const OMR_QR_SHORT_PREFIX = 'AC';
export const SHORT_CODE_MIN = 1;
export const SHORT_CODE_MAX = 0xffffffff;

export type OmrQrFullPayload = {
  kind: 'full';
  printedSheetId: string;
  layoutHash: string;
  pageIndex: number;
  pageCount: number;
};

export type OmrQrShortPayload = {
  kind: 'short';
  shortCode: number;
  pageIndex: number;
};

export type OmrQrPayload = OmrQrFullPayload | OmrQrShortPayload;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = new RegExp(`^[0-9a-f]{${LAYOUT_HASH_LENGTH}}$`, 'i');
const SHORT_RE = /^AC:([0-9A-F]{8}):([0-9]{1,2})$/;

export function buildOmrQrPayload(payload: Omit<OmrQrFullPayload, 'kind'>): string {
  const { printedSheetId, layoutHash, pageIndex, pageCount } = payload;
  return [OMR_QR_PREFIX, OMR_QR_VERSION, printedSheetId, layoutHash, pageIndex, pageCount].join(':');
}

export function buildOmrShortQrPayload(payload: Omit<OmrQrShortPayload, 'kind'>): string {
  const { shortCode, pageIndex } = payload;
  if (!Number.isInteger(shortCode) || shortCode < SHORT_CODE_MIN || shortCode > SHORT_CODE_MAX) {
    throw new Error(`shortCode fuera del rango de 32 bits: ${shortCode}`);
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 99) {
    throw new Error(`pageIndex invalido para el payload corto: ${pageIndex}`);
  }
  const hex = shortCode.toString(16).toUpperCase().padStart(8, '0');
  return `${OMR_QR_SHORT_PREFIX}:${hex}:${pageIndex}`;
}

export function parseOmrQrPayload(raw: string): OmrQrPayload | null {
  const trimmed = raw.trim();
  const short = SHORT_RE.exec(trimmed);
  if (short) {
    const [, hex = '', page = ''] = short;
    const shortCode = Number.parseInt(hex, 16);
    if (shortCode < SHORT_CODE_MIN) return null;
    return { kind: 'short', shortCode, pageIndex: Number(page) };
  }

  const parts = trimmed.split(':');
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
  return {
    kind: 'full',
    printedSheetId,
    layoutHash: layoutHash.toLowerCase(),
    pageIndex,
    pageCount,
  };
}

/** Formato humano del codigo corto, impreso junto al QR para tipearlo si todo lo demas falla. */
export function formatShortCode(shortCode: number): string {
  const hex = shortCode.toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

export function parseShortCodeText(text: string): number | null {
  const normalized = text.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[0-9A-F]{1,8}$/.test(normalized)) return null;
  const code = Number.parseInt(normalized, 16);
  if (code < SHORT_CODE_MIN || code > SHORT_CODE_MAX) return null;
  return code;
}
