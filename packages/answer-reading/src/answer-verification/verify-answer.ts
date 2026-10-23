import {
  normalizeText,
  type AnswerSpace,
  type MatchingCode,
  type ResponseFormat,
  type TranscriptionOutput,
} from '@soe/types';
import { ANSWER_FORMATS, isSupportedFormatKind, normalizeTranscription } from '../formats/registry';
import type {
  AnswerStrength,
  AnswerVerificationInput,
  AnswerVerificationStep,
  CrossSupport,
  VerifiedAnswer,
  VerifiedCandidate,
} from './verified-answer';

export const ANSWER_VERIFICATION_RULESET = 'verify@1';

/**
 * Cómo se llega desde lo escrito a un valor. `null` = no se desprende. Las
 * transformaciones permitidas son cerradas: nunca se cambia un operador, nunca
 * aparece un dígito que no está escrito y las confusiones de glifo solo valen
 * en espacios cerrados.
 */
type Derivation = { strength: AnswerStrength; steps: AnswerVerificationStep[] } | null;

interface SpaceValue {
  readonly canonical: string;
  readonly answerText: string;
  readonly steps: AnswerVerificationStep[];
}

interface Canonicalized {
  readonly values: SpaceValue[];
  readonly outOfSpace: boolean;
}

interface SpaceAdapter {
  canonicalize(proposal: string): Canonicalized;
  derive(literal: string, value: SpaceValue): Derivation;
}

const STRENGTH_ORDER: Record<AnswerStrength, number> = { direct: 0, inferred: 1, selection: 2 };

function weakest(a: AnswerStrength, b: AnswerStrength): AnswerStrength {
  return STRENGTH_ORDER[a] >= STRENGTH_ORDER[b] ? a : b;
}

function step(
  rule: AnswerVerificationStep['rule'],
  from: string,
  to: string,
): AnswerVerificationStep {
  return { rule, from, to };
}

// ── Pareo: códigos de una columna y sus textos ───────────────────────────────

const GLYPH_DIGITS: Readonly<Record<string, string>> = {
  S: '5',
  s: '5',
  b: '6',
  O: '0',
  o: '0',
  I: '1',
  l: '1',
  Z: '2',
  z: '2',
};

const CODE_MENTION =
  /(?<![\p{L}\p{N}])([A-Za-z])\s*[.,:;)\-]?\s*(\d{1,2}|[SsbOoIlZz])(?![\p{L}\p{N}])/gu;

interface CodeMention {
  readonly code: string;
  readonly written: string;
  readonly glyph: boolean;
}

function codeKey(column: string, index: string): string {
  return `${column.toUpperCase()}.${index.replace(/^0+(?=\d)/, '')}`;
}

function codeMentions(text: string, codes: ReadonlyMap<string, MatchingCode>): CodeMention[] {
  const mentions: CodeMention[] = [];
  for (const match of text.matchAll(CODE_MENTION)) {
    const [written, column = '', rawIndex = ''] = match;
    const glyph = /^\D$/.test(rawIndex);
    const index = glyph ? (GLYPH_DIGITS[rawIndex] ?? '') : rawIndex;
    const key = codeKey(column, index);
    const code = codes.get(key);
    if (code) mentions.push({ code: code.code, written: written.trim(), glyph });
  }
  return mentions;
}

function codeLikeCount(text: string): number {
  return [...text.matchAll(CODE_MENTION)].length;
}

function wordBounded(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
}

function textMentions(text: string, options: readonly MatchingCode[]): MatchingCode[] {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  return options.filter(
    (option) =>
      option.text !== null &&
      wordBounded(normalized, normalizeText(option.text).replace(/\s+/g, ' ')),
  );
}

function matchingAdapter(space: Extract<AnswerSpace, { kind: 'matching' }>): SpaceAdapter {
  const codes = new Map(space.codes.map((code) => [codeKey(code.column, code.index), code]));
  return {
    canonicalize(proposal) {
      const byCode = codeMentions(proposal, codes);
      if (byCode.length > 0) {
        const values = [...new Set(byCode.map((mention) => mention.code))].map((code) => {
          const mention = byCode.find((candidate) => candidate.code === code);
          const rule = mention?.glyph ? 'glyph_confusion' : 'matching_code';
          return {
            canonical: code,
            answerText: code,
            steps: [step(rule, mention?.written ?? code, code)],
          };
        });
        return { values, outOfSpace: codeLikeCount(proposal) > byCode.length };
      }
      const byText = textMentions(proposal, space.codes);
      if (byText.length > 0) {
        return {
          values: byText.map((option) => ({
            canonical: option.code,
            answerText: option.code,
            steps: [step('matching_option_text', option.text ?? '', option.code)],
          })),
          outOfSpace: false,
        };
      }
      return { values: [], outOfSpace: true };
    },
    derive(literal, value) {
      const byCode = codeMentions(literal, codes);
      const byText = textMentions(literal, space.codes);
      const mentioned = new Set([
        ...byCode.map((mention) => mention.code),
        ...byText.map((option) => option.code),
      ]);
      if (!mentioned.has(value.canonical)) return null;
      const direct = byCode.find((mention) => mention.code === value.canonical && !mention.glyph);
      const glyph = byCode.find((mention) => mention.code === value.canonical && mention.glyph);
      const text = byText.find((option) => option.code === value.canonical);
      const steps: AnswerVerificationStep[] = [];
      if (direct) steps.push(step('matching_code', direct.written, value.canonical));
      else if (glyph) steps.push(step('glyph_confusion', glyph.written, value.canonical));
      if (text) steps.push(step('matching_option_text', text.text ?? '', value.canonical));
      const byWrittenCode = direct !== undefined || glyph !== undefined;
      const otherCodes = byWrittenCode && codeLikeCount(literal) > 1;
      const strength: AnswerStrength =
        mentioned.size > 1 || otherCodes ? 'selection' : direct ? 'direct' : 'inferred';
      return { strength, steps };
    },
  };
}

// ── Conjunto u orden de opciones ─────────────────────────────────────────────

const CONNECTORS = new Set(['y', 'o', 'e', 'u']);

interface OptionTokens {
  readonly ids: string[];
  readonly foreign: string[];
  readonly words: boolean;
  readonly split: boolean;
}

function optionTokens(text: string, ids: ReadonlySet<string>): OptionTokens {
  const singleChar = [...ids].every((id) => [...id].length === 1);
  const result = { ids: [] as string[], foreign: [] as string[] };
  let words = false;
  let split = false;
  for (const raw of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const token = raw.toUpperCase();
    if (ids.has(token)) result.ids.push(token);
    else if (CONNECTORS.has(raw.toLowerCase())) continue;
    else if (singleChar && /^\p{N}+$/u.test(token) && [...token].every((char) => ids.has(char))) {
      result.ids.push(...token);
      split = true;
    } else if (/^\p{L}{2,}$/u.test(token)) words = true;
    else result.foreign.push(raw);
  }
  return { ...result, words, split };
}

function optionSetAdapter(space: Extract<AnswerSpace, { kind: 'option_set' }>): SpaceAdapter {
  const order = space.options.map((option) => option.id.toUpperCase());
  const ids = new Set(order);
  const arrange = (tokens: string[]): string[] =>
    space.ordered
      ? tokens
      : [...new Set(tokens)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    canonicalize(proposal) {
      const tokens = optionTokens(proposal, ids);
      if (tokens.foreign.length > 0 || tokens.ids.length === 0)
        return { values: [], outOfSpace: true };
      const canonical = arrange(tokens.ids).join(' ');
      return {
        values: [
          { canonical, answerText: canonical, steps: [step('set_tokens', proposal, canonical)] },
        ],
        outOfSpace: false,
      };
    },
    derive(literal, value) {
      const tokens = optionTokens(literal, ids);
      const written = arrange(tokens.ids);
      const wanted = value.canonical.split(' ');
      const steps = [step('set_tokens', literal, written.join(' '))];
      if (written.join(' ') === value.canonical) {
        if (tokens.foreign.length > 0) return { strength: 'selection', steps };
        return { strength: tokens.words ? 'inferred' : 'direct', steps };
      }
      const subset =
        !space.ordered &&
        wanted.length < written.length &&
        wanted.every((id) => written.includes(id));
      return subset ? { strength: 'selection', steps } : null;
    },
  };
}

// ── Espacio abierto: cualquier valor del formato ─────────────────────────────

const SCALAR_KINDS = new Set(['integer', 'decimal', 'fraction']);
const NUMBER_TOKEN = /\d+(?:[.,]\d+)*(?:\s*\/\s*\d+)?/g;

function answerOutput(text: string): TranscriptionOutput {
  return {
    characters: [],
    state: 'answered',
    literal: text,
    parts: null,
    alternativeReadings: [],
    confidence: 1,
    reviewRequested: false,
    notes: '',
  };
}

function openCanonical(text: string, format: ResponseFormat): string | null {
  if (text.trim().length === 0) return null;
  const normalized = normalizeTranscription(answerOutput(text), format);
  if (normalized.canonical === null || normalized.canonical.length === 0) return null;
  return normalized.canonical;
}

function signedNumberTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const start = match.index ?? 0;
    const before = text.slice(0, start).replace(/\s+$/, '');
    const negative = before.endsWith('-') && !/\d\s*-$/.test(before);
    tokens.push(`${negative ? '-' : ''}${match[0]}`);
  }
  return tokens;
}

function compact(text: string): string {
  return normalizeText(text).replace(/[^\p{L}\p{N}]/gu, '');
}

function openAdapter(format: ResponseFormat): SpaceAdapter {
  const scalar = SCALAR_KINDS.has(format.kind);
  return {
    canonicalize(proposal) {
      const canonical = openCanonical(proposal, format);
      if (canonical === null) return { values: [], outOfSpace: true };
      return {
        values: [{ canonical, answerText: proposal.trim(), steps: [] }],
        outOfSpace: false,
      };
    },
    derive(literal, value) {
      if (openCanonical(literal, format) === value.canonical) {
        return { strength: 'direct', steps: [step('identity', literal, value.answerText)] };
      }
      if (!scalar) {
        if (compact(literal) === compact(value.answerText) && compact(literal).length > 0) {
          return {
            strength: 'direct',
            steps: [step('whitespace_punctuation', literal, value.answerText)],
          };
        }
        const words = normalizeText(literal).replace(/\s+/g, ' ');
        const answer = normalizeText(value.answerText).replace(/\s+/g, ' ');
        return wordBounded(words, answer)
          ? { strength: 'inferred', steps: [step('strip_words_units', literal, value.answerText)] }
          : null;
      }
      const equals = literal.lastIndexOf('=');
      if (equals >= 0) {
        const right = literal.slice(equals + 1);
        if (openCanonical(right, format) === value.canonical) {
          return {
            strength: 'direct',
            steps: [step('after_last_equals', literal, right.trim())],
          };
        }
      }
      const keys = signedNumberTokens(literal).map((token) => openCanonical(token, format));
      if (!keys.includes(value.canonical)) return null;
      const distinct = new Set(keys.filter((key): key is string => key !== null));
      if (distinct.size > 1) {
        return {
          strength: 'selection',
          steps: [step('strip_words_units', literal, value.answerText)],
        };
      }
      if (keys.length > 1) {
        return { strength: 'direct', steps: [step('collapse_repeats', literal, value.answerText)] };
      }
      return {
        strength: 'inferred',
        steps: [step('strip_words_units', literal, value.answerText)],
      };
    },
  };
}

function adapterFor(space: AnswerSpace, format: ResponseFormat): SpaceAdapter {
  if (space.kind === 'matching') return matchingAdapter(space);
  if (space.kind === 'option_set') return optionSetAdapter(space);
  return openAdapter(format);
}

// ── Verificación ─────────────────────────────────────────────────────────────

function gradedByKey(format: ResponseFormat): boolean {
  return isSupportedFormatKind(format.kind) && ANSWER_FORMATS[format.kind].gradedBy === 'key';
}

function proposalsOf(input: AnswerVerificationInput): string[] {
  const { reading } = input;
  const raw =
    reading.state === 'ambiguous' && reading.candidates.length > 0
      ? reading.candidates
      : [reading.answer];
  return raw.map((proposal) => proposal.trim()).filter((proposal) => proposal.length > 0);
}

/**
 * Verifica la respuesta que propone un lector, sin ver la clave: tiene que
 * existir en el espacio del ítem y desprenderse de lo escrito. El literal del
 * mismo lector sale de la misma llamada que su respuesta y puede acomodarse a
 * ella; por eso `crossSupport` mira el literal del OTRO lector.
 */
export function verifyAnswer(input: AnswerVerificationInput): VerifiedAnswer {
  const base = { ruleset: ANSWER_VERIFICATION_RULESET };
  const { reading, otherReading, format, space, ink } = input;
  if (!gradedByKey(format)) return { ...base, status: 'not_applicable', trace: [] };
  if (reading.state === 'blank') {
    return {
      ...base,
      status: 'blank',
      blankEvidence: ink?.hasInk === false ? 'ink_absent' : 'unverified',
      trace: [],
    };
  }
  if (reading.state === 'illegible') return { ...base, status: 'unreadable', trace: [] };
  const proposals = proposalsOf(input);
  if (proposals.length === 0) return { ...base, status: 'unreadable', trace: [] };

  const adapter = adapterFor(space, format);
  const inSpace = new Map<string, SpaceValue>();
  let outOfSpace = false;
  for (const proposal of proposals) {
    const result = adapter.canonicalize(proposal);
    outOfSpace = outOfSpace || result.outOfSpace;
    for (const value of result.values) {
      if (!inSpace.has(value.canonical)) inSpace.set(value.canonical, value);
    }
  }
  if (inSpace.size === 0) return { ...base, status: 'out_of_space', trace: [] };

  const otherLiteral = otherReading?.literal.trim() ?? '';
  const candidates: (VerifiedCandidate & { steps: AnswerVerificationStep[] })[] = [];
  for (const value of inSpace.values()) {
    const own = adapter.derive(reading.literal, value);
    const other = otherLiteral.length > 0 ? adapter.derive(otherLiteral, value) : null;
    const derivation = own ?? other;
    if (derivation === null) continue;
    const crossSupport: CrossSupport =
      otherLiteral.length === 0 ? 'no_other' : other ? 'supported' : 'unsupported';
    candidates.push({
      canonical: value.canonical,
      answerText: value.answerText,
      strength: derivation.strength,
      crossSupport,
      steps: [...value.steps, ...derivation.steps],
    });
  }
  if (candidates.length === 0) return { ...base, status: 'not_derivable', trace: [] };

  if (candidates.length > 1) {
    return {
      ...base,
      status: 'ambiguous',
      candidates: candidates.map((candidate) => ({
        canonical: candidate.canonical,
        answerText: candidate.answerText,
        strength: candidate.strength,
        crossSupport: candidate.crossSupport,
      })),
      trace: candidates.flatMap((candidate) => candidate.steps),
    };
  }
  const [chosen] = candidates;
  if (!chosen) return { ...base, status: 'not_derivable', trace: [] };
  const filtered = reading.state === 'ambiguous' || inSpace.size > 1 || outOfSpace;
  const trace = filtered
    ? [...chosen.steps, step('candidate_filter', proposals.join(' | '), chosen.answerText)]
    : chosen.steps;
  return {
    ...base,
    status: 'unique',
    canonical: chosen.canonical,
    answerText: chosen.answerText,
    strength: filtered ? weakest(chosen.strength, 'selection') : chosen.strength,
    crossSupport: chosen.crossSupport,
    trace,
  };
}
