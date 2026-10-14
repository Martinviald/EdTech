import {
  READING_AUDIT_REASONS,
  reviewModeFor,
  type ConsensusPolicy,
  type ConsensusResult,
  type NormalizedAnswer,
  type PromptVariables,
  type ReaderSpec,
  type ReadingAuditOutput,
  type RenderedPrompt,
  type ResponseFormat,
  type ReviewReason,
  type ScoringOutcome,
  type TranscriptionOutput,
  type TranscriptionStatus,
} from '@soe/types';
import { isAuditSample } from '../consensus/audit-sample';
import {
  hasFormatIssue,
  type ConsensusOptions,
  type ConsensusReading,
  type ScoreOf,
} from '../consensus/evaluate-consensus';
import { formatLabelFor, normalizeTranscription, requiresRubricGrading } from '../formats/registry';
import { getPrompt } from '../prompts/registry';
import { renderPrompt } from '../prompts/render';
import { readingAuditJsonSchema, type ReadingAuditJsonSchema } from './reading-audit-json-schema';

// Auditor de lectura. Funciones puras que comparten la API y el arnés: cuándo se llama al
// auditor, qué candidata revisa, qué se le muestra y cómo su veredicto cambia la decisión.
// Regla: el auditor SOLO puede convertir en aceptada una casilla que estaba en revisión por
// motivos de lectura, y solo con un `approve` confiable. Lo aceptado sigue pasando por la
// corrección, la política, la auditoría muestral y, después, el verificador de incorrectas.

const AUDIT_REASONS: ReadonlySet<ReviewReason> = new Set<ReviewReason>(READING_AUDIT_REASONS);

export interface ReadingAuditCandidate {
  readonly literal: string;
  readonly parts: Readonly<Record<string, string>> | null;
  readonly answer: NormalizedAnswer;
  /** Lecturas que respaldan la candidata; la primera es la de mayor confianza (su literal es el auditado). */
  readonly readingIds: readonly string[];
}

export interface ReadingAuditVerdict {
  readonly status: TranscriptionStatus;
  readonly output: ReadingAuditOutput | null;
}

/** ¿Hay que preguntarle al auditor? Solo revisiones por motivos de lectura en formatos con clave. */
export function needsReadingAudit(
  result: ConsensusResult,
  policy: ConsensusPolicy,
  format: ResponseFormat,
): boolean {
  return (
    policy.readingAuditor !== undefined &&
    policy.autoAccept &&
    !requiresRubricGrading(format) &&
    result.outcome === 'needs_review' &&
    result.reasons.length > 0 &&
    result.reasons.every((reason) => AUDIT_REASONS.has(reason))
  );
}

interface AnsweredEntry {
  readonly reading: ConsensusReading;
  readonly output: TranscriptionOutput;
  readonly answer: NormalizedAnswer;
  readonly canonical: string;
}

function answeredEntries(
  readings: readonly ConsensusReading[],
  format: ResponseFormat,
): AnsweredEntry[] {
  const entries: AnsweredEntry[] = [];
  for (const reading of readings) {
    const output = reading.output;
    if (reading.status !== 'ok' || output === null || output.state !== 'answered') continue;
    const answer = normalizeTranscription(output, format);
    if (answer.canonical === null) continue;
    entries.push({ reading, output, answer, canonical: answer.canonical });
  }
  return entries;
}

/** La de mayor confianza; a igual confianza, la primera en el orden de la ruta. */
function mostConfident(entries: readonly AnsweredEntry[]): AnsweredEntry | null {
  let best: AnsweredEntry | null = null;
  for (const entry of entries) {
    if (best === null || entry.output.confidence > best.output.confidence) best = entry;
  }
  return best;
}

/**
 * Candidata `agreement_or_top` (C2 del experimento): la canónica en que coinciden más
 * lecturas contestadas (al menos dos; primarias o de escalamiento) o, si ninguna coincide,
 * la lectura contestada de mayor confianza. El literal auditado es el de la lectura de mayor
 * confianza del grupo. Sin lecturas contestadas, `null`.
 */
export function readingAuditCandidate(
  readings: readonly ConsensusReading[],
  format: ResponseFormat,
): ReadingAuditCandidate | null {
  const entries = answeredEntries(readings, format);
  const groups = new Map<string, AnsweredEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.canonical);
    if (group) group.push(entry);
    else groups.set(entry.canonical, [entry]);
  }
  let agreement: AnsweredEntry[] | null = null;
  for (const group of groups.values()) {
    if (group.length >= 2 && (agreement === null || group.length > agreement.length)) {
      agreement = group;
    }
  }
  const top = mostConfident(entries);
  const members = agreement ?? (top === null ? null : (groups.get(top.canonical) ?? null));
  const best = members === null ? null : mostConfident(members);
  if (members === null || best === null) return null;
  return {
    literal: best.output.literal,
    parts: best.output.parts,
    answer: best.answer,
    readingIds: [
      best.reading.readingId,
      ...members.filter((entry) => entry !== best).map((entry) => entry.reading.readingId),
    ],
  };
}

/** La candidata como la ve el auditor: el literal y, si hay varias casillas, cada una. */
export function describeAuditCandidate(
  literal: string,
  parts: Readonly<Record<string, string>> | null,
): string {
  const entries = Object.entries(parts ?? {});
  if (entries.length <= 1) return literal;
  return `${literal}   (por casilla: ${entries.map(([partId, value]) => `${partId}: "${value}"`).join('; ')})`;
}

/** Enunciado del ítem (`content.prompt`), solo como contexto. Nunca la clave. */
export function itemStemOf(content: unknown): string | null {
  if (typeof content !== 'object' || content === null) return null;
  const prompt = (content as Record<string, unknown>)['prompt'];
  return typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : null;
}

export interface ReadingAuditPromptInput {
  readonly reader: Pick<ReaderSpec, 'promptRef' | 'hints'>;
  readonly format: ResponseFormat;
  readonly candidate: Pick<ReadingAuditCandidate, 'literal' | 'parts'>;
  readonly stem: string | null;
  readonly gradeName?: string | null;
}

export interface RenderedReadingAuditPrompt {
  readonly prompt: RenderedPrompt;
  readonly outputSchema: ReadingAuditJsonSchema;
}

/** ¿El prompt audita lecturas del formato? */
export function isReadingAuditPromptFor(ref: string, format: ResponseFormat): boolean {
  const prompt = getPrompt(ref);
  return (
    prompt !== null &&
    prompt.purpose === 'reading_audit' &&
    prompt.formatKinds.includes(format.kind)
  );
}

/**
 * Renderiza el prompt del auditor: la candidata, el formato (si la ruta pide pistas), el
 * curso y el enunciado. `renderPrompt` rechaza variables no declaradas y el esquema de
 * prompts impide que uno de auditoría declare la clave o la lectura acordada.
 */
export function renderReadingAuditPrompt(
  input: ReadingAuditPromptInput,
): RenderedReadingAuditPrompt {
  const prompt = getPrompt(input.reader.promptRef);
  if (!prompt || !isReadingAuditPromptFor(input.reader.promptRef, input.format)) {
    throw new Error(
      `El prompt ${input.reader.promptRef} no audita lecturas del formato ${input.format.kind}`,
    );
  }
  const candidates: PromptVariables = {
    transcription: describeAuditCandidate(input.candidate.literal, input.candidate.parts),
    ...(input.gradeName?.trim() ? { gradeName: input.gradeName.trim() } : {}),
    ...(input.stem ? { stem: input.stem } : {}),
    ...(input.reader.hints === 'format' ? { formatLabel: formatLabelFor(input.format) } : {}),
  };
  const variables: PromptVariables = {};
  for (const name of prompt.variables) {
    const value = candidates[name];
    if (value) variables[name] = value;
  }
  const outputSchema = readingAuditJsonSchema();
  return { prompt: renderPrompt(prompt, variables, outputSchema), outputSchema };
}

/** El veredicto acepta solo si es `approve` con confianza suficiente. Una falla nunca acepta. */
export function readingAuditApproves(verdict: ReadingAuditVerdict, threshold: number): boolean {
  return (
    verdict.status === 'ok' &&
    verdict.output !== null &&
    verdict.output.verdict === 'approve' &&
    verdict.output.confidence >= threshold
  );
}

/**
 * Aplica el veredicto. Si la casilla estaba en revisión solo por motivos de lectura y el
 * auditor aprueba con confianza suficiente, la candidata se corrige y, si la política
 * autoacepta ese resultado, queda `auto_accepted` (o en la muestra de auditoría). En
 * cualquier otro caso (rechazo, falla, candidata fuera de formato, indecidible o resultado
 * que la política no autoacepta) devuelve la decisión intacta, con sus motivos originales.
 */
export function applyReadingAudit(
  result: ConsensusResult,
  policy: ConsensusPolicy,
  candidate: ReadingAuditCandidate | null,
  verdict: ReadingAuditVerdict | null,
  scoreOf: ScoreOf,
  options: Pick<ConsensusOptions, 'format' | 'readingKey'>,
): ConsensusResult {
  const auditor = policy.readingAuditor;
  if (
    auditor === undefined ||
    candidate === null ||
    verdict === null ||
    !needsReadingAudit(result, policy, options.format) ||
    !readingAuditApproves(verdict, auditor.minConfidence) ||
    hasFormatIssue(candidate.answer)
  ) {
    return result;
  }
  const scoringOutcome = scoreOf(candidate.answer);
  const acceptable = (policy.autoAcceptOutcomes as readonly ScoringOutcome[]).includes(
    scoringOutcome,
  );
  if (!acceptable) return result;
  const audited = isAuditSample(options.readingKey, policy.auditSampleRate);
  const reasons: ReviewReason[] = audited ? ['audit_sample'] : [];
  return {
    outcome: audited ? 'needs_review' : 'auto_accepted',
    value: candidate.answer,
    scoringOutcome,
    reasons,
    reviewMode: audited ? reviewModeFor(reasons) : null,
    usedReadingIds: [...candidate.readingIds],
    policyId: policy.id,
    policyVersion: policy.version,
  };
}
