export const WILSON_Z_95 = 1.959963984540054;

export interface Proportion {
  readonly count: number;
  readonly total: number;
  readonly rate: number | null;
  readonly ci95: readonly [number, number] | null;
}

export function wilsonInterval(
  count: number,
  total: number,
  z = WILSON_Z_95,
): readonly [number, number] | null {
  if (total <= 0) return null;
  const p = count / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function proportion(count: number, total: number): Proportion {
  return {
    count,
    total,
    rate: total > 0 ? count / total : null,
    ci95: wilsonInterval(count, total),
  };
}

function logChoose(n: number, k: number): number {
  let sum = 0;
  for (let i = 1; i <= k; i += 1) sum += Math.log(n - k + i) - Math.log(i);
  return sum;
}

export interface McNemarResult {
  readonly onlyBefore: number;
  readonly onlyAfter: number;
  readonly discordant: number;
  readonly pValue: number;
}

export function mcnemarExact(onlyBefore: number, onlyAfter: number): McNemarResult {
  const discordant = onlyBefore + onlyAfter;
  if (discordant === 0) return { onlyBefore, onlyAfter, discordant, pValue: 1 };
  const smaller = Math.min(onlyBefore, onlyAfter);
  let tail = 0;
  for (let i = 0; i <= smaller; i += 1) {
    tail += Math.exp(logChoose(discordant, i) - discordant * Math.LN2);
  }
  return { onlyBefore, onlyAfter, discordant, pValue: Math.min(1, 2 * tail) };
}

export function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const left = previous[j - 1] ?? 0;
      previous[j] = Math.min(above + 1, left + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

export function normalizeWrittenText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[×✕]/g, 'x')
    .replace(/⇒|→/g, '=>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textSimilarity(read: string, truth: string): number {
  const a = normalizeWrittenText(read);
  const b = normalizeWrittenText(truth);
  if (a.length + b.length === 0) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
