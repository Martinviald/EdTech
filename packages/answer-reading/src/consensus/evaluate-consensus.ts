import {
  reviewModeFor,
  type ConsensusPolicy,
  type ConsensusResult,
  type NormalizedAnswer,
  type ReadingOutcome,
  type ReadingState,
  type ResponseFormat,
  type ReviewReason,
  type ScoringOutcome,
  type TranscriptionOutput,
  type TranscriptionStatus,
} from '@soe/types';
import { normalizeTranscription } from '../formats/registry';
import { isAuditSample } from './audit-sample';

/**
 * Corrige una respuesta normalizada con las estrategias existentes. Se inyecta para
 * que el consenso pueda preguntar "¿esta alternativa cambia el resultado?" sin
 * conocer el ítem ni la clave.
 */
export type ScoreOf = (answer: NormalizedAnswer) => ScoringOutcome;

export interface ConsensusReading {
  readonly readingId: string;
  readonly family: string;
  readonly status: TranscriptionStatus;
  readonly output: TranscriptionOutput | null;
  /** `tiebreak`: lectura de desempate pedida tras un desacuerdo (política `tiebreak_reader`). */
  readonly role?: 'primary' | 'tiebreak';
}

export interface ConsensusOptions {
  readonly format: ResponseFormat;
  /** Tinta medida en el recorte tras restar la plantilla (paso 1). */
  readonly inkRatio?: number | null;
  /** Identificador estable de la casilla leída; habilita la auditoría muestral. */
  readonly readingKey?: string;
  /** Motivo cuando no hubo lectores (por ejemplo, la org no permite enviar imágenes). */
  readonly notReadReason?: Extract<
    ReviewReason,
    'insufficient_readers' | 'external_vision_disabled'
  >;
}

type ValidReading = ConsensusReading & { readonly output: TranscriptionOutput };

interface Normalized {
  readonly reading: ValidReading;
  readonly answer: NormalizedAnswer;
}

const STATE_REASONS: Partial<Record<ReadingState, ReviewReason>> = {
  illegible: 'illegible',
  multiple_answers: 'multiple_answers',
  crossed_out_only: 'crossed_out',
};

function isValid(reading: ConsensusReading): reading is ValidReading {
  return reading.status === 'ok' && reading.output !== null;
}

function blankAnswer(format: ResponseFormat): NormalizedAnswer {
  return { formatKind: format.kind, state: 'blank', canonical: null, value: null, issues: [] };
}

function distinctFamilies(readings: readonly ConsensusReading[]): number {
  return new Set(readings.map((reading) => reading.family)).size;
}

/**
 * Consenso y abstención (diseño §8.2). Pasos, en orden:
 *  1. tinta bajo el umbral → auto_blank (sin modelos);
 *  2. lecturas válidas < minReaders → revisión [reader_failed | insufficient_readers];
 *  3. familias repetidas cuando se exigen distintas → revisión [insufficient_readers];
 *  4. algún estado ≠ answered: todas en blanco → auto_blank (o revisión si la política
 *     no autoacepta); ilegible / varias respuestas / tachado → revisión;
 *  4b. algún lector pidió revisión → revisión [reader_requested_review];
 *  5. no se pudo convertir al formato → revisión [unparsed_format] (nunca incorrecta);
 *  6. desacuerdo → desempate (si está configurado y llegó) o revisión [readers_disagree];
 *  7. confianza baja → revisión [low_confidence];
 *  8. alternativa plausible que cambia el resultado → revisión [alternative_flips_outcome];
 *  9. corrección indecidible → revisión [undecidable];
 * 10. la política no autoacepta ese resultado → revisión [policy_requires_review];
 * 11. auto_accepted, salvo que caiga en la muestra de auditoría → revisión [audit_sample].
 */
export function evaluateConsensus(
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
  scoreOf: ScoreOf,
  options: ConsensusOptions,
): ConsensusResult {
  const { format } = options;
  const scoreIfParsed = (answer: NormalizedAnswer | null): ScoringOutcome | null =>
    answer !== null && answer.canonical !== null ? scoreOf(answer) : null;
  const decide = (
    outcome: ReadingOutcome,
    value: NormalizedAnswer | null,
    reasons: ReviewReason[],
    used: readonly ConsensusReading[],
    scoringOutcome: ScoringOutcome | null = scoreIfParsed(value),
  ): ConsensusResult => ({
    outcome,
    value,
    scoringOutcome,
    reasons,
    reviewMode:
      outcome === 'needs_review' || outcome === 'not_read' ? reviewModeFor(reasons) : null,
    usedReadingIds: used.map((reading) => reading.readingId),
    policyId: policy.id,
    policyVersion: policy.version,
  });
  const review = (
    reasons: ReviewReason[],
    value: NormalizedAnswer | null,
    used: readonly ConsensusReading[],
  ) => decide('needs_review', value, reasons, used);

  if (
    policy.blankByInkBelow !== null &&
    options.inkRatio !== undefined &&
    options.inkRatio !== null &&
    options.inkRatio < policy.blankByInkBelow
  ) {
    const blank = blankAnswer(format);
    return decide('auto_blank', blank, [], [], scoreOf(blank));
  }

  const primaries = readings.filter((reading) => (reading.role ?? 'primary') === 'primary');
  if (primaries.length === 0) {
    return decide('not_read', null, [options.notReadReason ?? 'insufficient_readers'], [], null);
  }

  const valid = primaries.filter(isValid);
  const proposal = (): NormalizedAnswer | null => {
    const first = valid[0];
    return first ? normalizeTranscription(first.output, format) : null;
  };

  if (valid.length < policy.minReaders) {
    const reason = valid.length < primaries.length ? 'reader_failed' : 'insufficient_readers';
    return review([reason], proposal(), valid);
  }

  if (policy.requireDistinctFamilies && distinctFamilies(valid) < policy.minReaders) {
    return review(['insufficient_readers'], proposal(), valid);
  }

  const states = valid.map((reading) => reading.output.state);
  if (states.some((state) => state !== 'answered')) {
    if (states.every((state) => state === 'blank')) {
      const blank = blankAnswer(format);
      return policy.autoAccept
        ? decide('auto_blank', blank, [], valid, scoreOf(blank))
        : decide('needs_review', blank, ['policy_requires_review'], valid, scoreOf(blank));
    }
    const reasons = new Set<ReviewReason>();
    for (const state of states) {
      const reason = STATE_REASONS[state];
      if (reason) reasons.add(reason);
    }
    if (new Set(states).size > 1) reasons.add('readers_disagree');
    return review([...reasons], null, valid);
  }

  if (valid.some((reading) => reading.output.reviewRequested)) {
    return review(['reader_requested_review'], proposal(), valid);
  }

  const normalized: Normalized[] = valid.map((reading) => ({
    reading,
    answer: normalizeTranscription(reading.output, format),
  }));
  const unparsed = normalized.find((entry) => entry.answer.canonical === null);
  if (unparsed) return review(['unparsed_format'], unparsed.answer, valid);

  const agreementKey = (entry: Normalized): string =>
    policy.agreeOn === 'canonical' ? (entry.answer.canonical ?? '') : scoreOf(entry.answer);
  const used = agreeingGroup(normalized, readings, policy, format, agreementKey);
  if (used === null) return review(['readers_disagree'], null, valid);

  const usedReadings = used.map((entry) => entry.reading);
  const agreed = used[0]?.answer ?? null;
  if (agreed === null) return review(['readers_disagree'], null, valid);

  if (usedReadings.some((reading) => reading.output.confidence < policy.minConfidence)) {
    return review(['low_confidence'], agreed, usedReadings);
  }

  const agreedOutcome = scoreOf(agreed);
  const flips = usedReadings.some((reading) =>
    reading.output.alternativeReadings.some((alternative) => {
      if (alternative.plausibility < policy.alternativePlausibilityFloor) return false;
      const answer = normalizeTranscription(
        {
          ...reading.output,
          state: 'answered',
          literal: alternative.literal,
          parts: alternative.parts,
        },
        format,
      );
      return answer.canonical === null || scoreOf(answer) !== agreedOutcome;
    }),
  );
  if (flips) return review(['alternative_flips_outcome'], agreed, usedReadings);

  if (agreedOutcome === 'undecidable') return review(['undecidable'], agreed, usedReadings);

  const autoAcceptable = (policy.autoAcceptOutcomes as readonly ScoringOutcome[]).includes(
    agreedOutcome,
  );
  if (!policy.autoAccept || !autoAcceptable) {
    return review(['policy_requires_review'], agreed, usedReadings);
  }

  if (
    options.readingKey !== undefined &&
    isAuditSample(options.readingKey, policy.auditSampleRate)
  ) {
    return review(['audit_sample'], agreed, usedReadings);
  }

  return decide('auto_accepted', agreed, [], usedReadings, agreedOutcome);
}

/**
 * Grupo de lecturas que coincide. Todas las primarias, si coinciden; si no, y la
 * política usa desempate, el grupo de la lectura de desempate (con al menos
 * `minReaders` lecturas y familias distintas si se exigen). `null` = desacuerdo.
 */
function agreeingGroup(
  normalized: readonly Normalized[],
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
  format: ResponseFormat,
  keyOf: (entry: Normalized) => string,
): Normalized[] | null {
  const keys = new Set(normalized.map(keyOf));
  if (keys.size === 1) return [...normalized];
  if (policy.onDisagreement !== 'tiebreak_reader') return null;
  const tiebreaks: Normalized[] = readings
    .filter((reading) => reading.role === 'tiebreak')
    .filter(isValid)
    .filter((reading) => reading.output.state === 'answered' && !reading.output.reviewRequested)
    .map((reading) => ({ reading, answer: normalizeTranscription(reading.output, format) }))
    .filter((entry) => entry.answer.canonical !== null);
  for (const tiebreak of tiebreaks) {
    const key = keyOf(tiebreak);
    const group = [...normalized.filter((entry) => keyOf(entry) === key), tiebreak];
    const familiesOk =
      !policy.requireDistinctFamilies ||
      distinctFamilies(group.map((entry) => entry.reading)) >= policy.minReaders;
    if (group.length >= policy.minReaders && group.length >= 2 && familiesOk) return group;
  }
  return null;
}

/**
 * Indica si conviene pedir una lectura de desempate: la política lo usa, hay
 * lector configurado, todas las primarias respondieron pero leyeron valores
 * distintos y aún no hay desempate. Quien llama corre el lector de desempate y
 * vuelve a evaluar con esa lectura (`role: 'tiebreak'`).
 */
export function needsTiebreak(
  result: ConsensusResult,
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
): boolean {
  return (
    policy.onDisagreement === 'tiebreak_reader' &&
    policy.tiebreakReader !== null &&
    result.outcome === 'needs_review' &&
    result.reasons.length === 1 &&
    result.reasons[0] === 'readers_disagree' &&
    result.value === null &&
    readings.every((reading) => reading.role !== 'tiebreak' && reading.output?.state === 'answered')
  );
}
