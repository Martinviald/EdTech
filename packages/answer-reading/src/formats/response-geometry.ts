import type { ResponseFormat } from '@soe/types';

type NumericFormat = Extract<ResponseFormat, { kind: 'integer' | 'decimal' }>;

/**
 * Geometría impresa de la casilla que no viaja en el `ResponseFormat`: cuántas
 * casillas de dígito van después de la coma impresa en un decimal. La hoja la
 * deriva del ítem (`responseGeometryOf`) y la lectura usa la misma derivación.
 */
export interface ResponseGeometry {
  readonly fractionDigits: number | null;
}

export const DEFAULT_RESPONSE_GEOMETRY: ResponseGeometry = { fractionDigits: null };

const DEFAULT_FRACTION_DIGITS = 2;
const DECIMAL_TAIL = /[.,](\d+)\s*$/;

export function responseGeometryOf(content: unknown): ResponseGeometry {
  const accepted = (content as { acceptedAnswers?: unknown } | null | undefined)?.acceptedAnswers;
  if (!Array.isArray(accepted)) return DEFAULT_RESPONSE_GEOMETRY;
  let digits: number | null = null;
  for (const answer of accepted) {
    if (typeof answer !== 'string') continue;
    const match = DECIMAL_TAIL.exec(answer.trim());
    if (match?.[1]) digits = Math.max(digits ?? 0, match[1].length);
  }
  return { fractionDigits: digits };
}

/** Casillas impresas de un número: signo opcional, dígitos antes y después de la coma. */
export interface NumericBoxes {
  readonly signBox: boolean;
  readonly integerDigits: number;
  readonly fractionDigits: number;
}

export function numericBoxesFor(
  format: NumericFormat,
  fractionDigits: number | null | undefined,
): NumericBoxes {
  const digitCount = format.kind === 'decimal' ? Math.max(format.maxChars - 1, 2) : format.maxChars;
  const fraction =
    format.kind === 'decimal'
      ? Math.min(Math.max(fractionDigits ?? DEFAULT_FRACTION_DIGITS, 1), digitCount - 1)
      : 0;
  return {
    signBox: format.allowNegative,
    integerDigits: digitCount - fraction,
    fractionDigits: fraction,
  };
}
