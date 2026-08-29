import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { LayoutSpec } from '../schemas/omr-layout.schema';

// Hash canónico y estable de un LayoutSpec (D6). Viaja dentro del QR y se
// verifica al escanear: un hash distinto = instrumento editado después de
// imprimir = lote rechazado completo (G1). Impresor y lector usan EXACTAMENTE
// esta función — nunca dos implementaciones. Estable ante reordenamiento de
// claves; números a precisión fija de 6 decimales; SHA-256 truncado a 16 hex
// para caber cómodo en el QR.

const NUMBER_PRECISION = 6;

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('LayoutSpec contiene un número no finito');
    return Number(value.toFixed(NUMBER_PRECISION)).toString();
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`LayoutSpec contiene un valor no serializable: ${typeof value}`);
}

export const LAYOUT_HASH_LENGTH = 16;

export function layoutHash(spec: LayoutSpec): string {
  return bytesToHex(sha256(canonicalize(spec))).slice(0, LAYOUT_HASH_LENGTH);
}
