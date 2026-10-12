export interface TextSegment {
  text: string;
  highlighted: boolean;
}

function quotePattern(quote: string): RegExp | null {
  const words = quote
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return null;
  return new RegExp(words.join('\\s+'), 'giu');
}

/**
 * Parte la transcripción en tramos y marca los que coinciden con alguna cita
 * de la IA (sin distinguir mayúsculas ni cantidad de espacios). Una cita que no
 * aparece en el texto simplemente no se resalta.
 */
export function highlightQuotes(text: string, quotes: readonly string[]): TextSegment[] {
  const ranges: Array<[number, number]> = [];
  for (const quote of quotes) {
    const pattern = quotePattern(quote);
    if (!pattern) continue;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || match[0].length === 0) continue;
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  if (ranges.length === 0) return text.length > 0 ? [{ text, highlighted: false }] : [];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
