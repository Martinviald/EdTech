import {
  reviewModeFor,
  type ConsensusPolicy,
  type ConsensusResult,
  type ItemType,
  type PromptVariables,
  type ReaderSpec,
  type RenderedPrompt,
  type ResponseFormat,
  type ReviewReason,
  type ScoringOutcome,
  type TranscriptionStatus,
  type VerificationOutput,
} from '@soe/types';
import type { ConsensusReading } from '../consensus/evaluate-consensus';
import { formatLabelFor } from '../formats/registry';
import { getPrompt } from '../prompts/registry';
import { renderPrompt } from '../prompts/render';
import { verificationJsonSchema, type VerificationJsonSchema } from './verification-json-schema';

// Verificador de incorrectas (etapa 1 T4). Funciones puras que comparten la API y el
// arnés: cuándo se llama al verificador, qué se le muestra y cómo su veredicto cambia
// la decisión. Regla: el verificador SOLO puede mandar a revisión. Nunca convierte
// nada en aceptado ni toca la corrección propuesta.

export const VERIFIER_FLAGGED: ReviewReason = 'verifier_flagged';
export const VERIFIER_FAILED: ReviewReason = 'verifier_failed';

/** Resultados que perjudican al estudiante si la lectura está equivocada. */
export const VERIFIED_SCORING_OUTCOMES: ReadonlySet<ScoringOutcome> = new Set<ScoringOutcome>([
  'incorrect',
  'partial',
]);

export interface AgreedReading {
  readonly literal: string;
  readonly parts: Readonly<Record<string, string>> | null;
}

export interface IncorrectVerificationVerdict {
  readonly status: TranscriptionStatus;
  readonly output: VerificationOutput | null;
}

/** ¿Hay que preguntarle al verificador antes de dar por buena esta decisión? */
export function needsIncorrectVerification(
  result: ConsensusResult,
  policy: ConsensusPolicy,
): boolean {
  return (
    policy.incorrectVerifier !== undefined &&
    result.outcome === 'auto_accepted' &&
    result.scoringOutcome !== null &&
    VERIFIED_SCORING_OUTCOMES.has(result.scoringOutcome) &&
    result.value !== null &&
    result.value.state === 'answered'
  );
}

/** Umbral para creerle un "no podría ser la clave": el del verificador o, si no trae, el de la política. */
export function incorrectVerifierThreshold(policy: ConsensusPolicy): number {
  return policy.incorrectVerifier?.minConfidence ?? policy.minConfidence;
}

/** El veredicto despeja la duda solo si dice "no" con confianza suficiente. Una falla nunca despeja. */
export function verifierClears(verdict: IncorrectVerificationVerdict, threshold: number): boolean {
  return (
    verdict.status === 'ok' &&
    verdict.output !== null &&
    !verdict.output.couldBeKey &&
    verdict.output.confidence >= threshold
  );
}

/** ¿El verificador llegó a dar un veredicto? Una falla, un plazo vencido o la falta de veredicto no. */
export function verifierAnswered(verdict: IncorrectVerificationVerdict | null): boolean {
  return verdict !== null && verdict.status === 'ok' && verdict.output !== null;
}

/**
 * Aplica el veredicto: si la decisión necesitaba verificación y el verificador no la
 * despeja, pasa a revisión de lectura conservando valor, corrección propuesta y
 * lecturas usadas: con `verifier_flagged` si el verificador respondió y duda, y con
 * `verifier_failed` si no llegó a responder (falla, plazo vencido, sin veredicto). En
 * cualquier otro caso devuelve la decisión intacta.
 */
export function applyIncorrectVerification(
  result: ConsensusResult,
  policy: ConsensusPolicy,
  verdict: IncorrectVerificationVerdict | null,
): ConsensusResult {
  if (!needsIncorrectVerification(result, policy)) return result;
  if (verdict !== null && verifierClears(verdict, incorrectVerifierThreshold(policy))) {
    return result;
  }
  const reason = verifierAnswered(verdict) ? VERIFIER_FLAGGED : VERIFIER_FAILED;
  const reasons: ReviewReason[] = [...result.reasons, reason];
  return { ...result, outcome: 'needs_review', reasons, reviewMode: reviewModeFor(reasons) };
}

/** La lectura acordada tal como la escribió el primer lector usado por el consenso. */
export function agreedReadingOf(
  result: ConsensusResult,
  readings: readonly ConsensusReading[],
): AgreedReading | null {
  const byId = new Map(readings.map((reading) => [reading.readingId, reading]));
  for (const readingId of result.usedReadingIds) {
    const output = byId.get(readingId)?.output;
    if (output) return { literal: output.literal, parts: output.parts };
  }
  return null;
}

interface KeyedItem {
  readonly type: ItemType;
  readonly content: unknown;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function gapLine(gap: unknown, index: number): string | null {
  if (typeof gap !== 'object' || gap === null) return null;
  const record = gap as Record<string, unknown>;
  const answers = stringList(record['acceptedAnswers']);
  if (answers.length === 0) return null;
  const label =
    typeof record['label'] === 'string' && record['label'].trim().length > 0
      ? record['label'].trim().replace(/:$/, '')
      : `Espacio ${index + 1}`;
  return `${label}: ${answers.map((answer) => `"${answer}"`).join(' o ')}`;
}

/**
 * Respuestas correctas del ítem, una por línea de la lista que ve el verificador.
 * `short_answer`: cada respuesta aceptada. `gap_fill`: una sola respuesta con cada
 * espacio y sus variantes. Otro tipo o sin clave: lista vacía (el verificador no corre
 * y la casilla va a revisión).
 */
export function acceptedAnswersOf(item: KeyedItem): string[] {
  const content =
    typeof item.content === 'object' && item.content !== null
      ? (item.content as Record<string, unknown>)
      : {};
  if (item.type === 'short_answer') return stringList(content['acceptedAnswers']);
  if (item.type === 'gap_fill' && Array.isArray(content['gaps'])) {
    const lines = content['gaps'].map(gapLine);
    if (lines.some((line) => line === null)) return [];
    return [lines.join(' · ')];
  }
  return [];
}

function partLabels(format: ResponseFormat): Map<string, string> {
  if (format.kind !== 'multi_box') return new Map();
  return new Map(format.boxes.map((box) => [box.partId, box.label.replace(/:$/, '')]));
}

export function describeAgreedReading(reading: AgreedReading, format: ResponseFormat): string {
  const lines = [reading.literal];
  const parts = Object.entries(reading.parts ?? {});
  if (parts.length > 1) {
    const labels = partLabels(format);
    lines.push(
      `Por casilla: ${parts.map(([partId, value]) => `${labels.get(partId) ?? partId} = "${value}"`).join('; ')}`,
    );
  }
  return lines.join('\n');
}

export interface VerificationPromptInput {
  readonly reader: Pick<ReaderSpec, 'promptRef' | 'hints'>;
  readonly format: ResponseFormat;
  readonly agreedReading: AgreedReading;
  readonly acceptedAnswers: readonly string[];
  readonly gradeName?: string | null;
}

export interface RenderedVerificationPrompt {
  readonly prompt: RenderedPrompt;
  readonly outputSchema: VerificationJsonSchema;
}

/** ¿El prompt es de verificación y atiende el formato? */
export function isVerificationPromptFor(ref: string, format: ResponseFormat): boolean {
  const prompt = getPrompt(ref);
  return (
    prompt !== null && prompt.purpose === 'verification' && prompt.formatKinds.includes(format.kind)
  );
}

/**
 * Renderiza el prompt del verificador. Es el único render que recibe la clave:
 * `renderPrompt` rechaza variables no declaradas y el esquema de prompts impide que
 * un prompt de transcripción declare `acceptedAnswers` o `agreedReading`.
 */
export function renderVerificationPrompt(
  input: VerificationPromptInput,
): RenderedVerificationPrompt {
  const prompt = getPrompt(input.reader.promptRef);
  if (!prompt) throw new Error(`No existe el prompt ${input.reader.promptRef}`);
  if (!isVerificationPromptFor(input.reader.promptRef, input.format)) {
    throw new Error(
      `El prompt ${input.reader.promptRef} no verifica incorrectas del formato ${input.format.kind}`,
    );
  }
  if (input.acceptedAnswers.length === 0) {
    throw new Error('El verificador necesita al menos una respuesta correcta');
  }
  const candidates: PromptVariables = {
    agreedReading: describeAgreedReading(input.agreedReading, input.format),
    acceptedAnswers: input.acceptedAnswers.map((answer) => `- ${answer}`).join('\n'),
    ...(input.gradeName?.trim() ? { gradeName: input.gradeName.trim() } : {}),
    ...(input.reader.hints === 'format' ? { formatLabel: formatLabelFor(input.format) } : {}),
  };
  const variables: PromptVariables = {};
  for (const name of prompt.variables) {
    const value = candidates[name];
    if (value) variables[name] = value;
  }
  const outputSchema = verificationJsonSchema();
  return { prompt: renderPrompt(prompt, variables, outputSchema), outputSchema };
}
