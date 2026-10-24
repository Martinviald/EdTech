import { createHash } from 'node:crypto';

const BUCKETS = 0x1_0000_0000;

/**
 * Muestreo determinístico para auditoría: la misma lectura cae siempre en el mismo
 * lado. Usa los primeros 32 bits de `sha256(readingKey)` como fracción en [0, 1).
 */
export function isAuditSample(readingKey: string, rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const bucket = Number.parseInt(
    createHash('sha256').update(readingKey, 'utf8').digest('hex').slice(0, 8),
    16,
  );
  return bucket / BUCKETS < rate;
}
