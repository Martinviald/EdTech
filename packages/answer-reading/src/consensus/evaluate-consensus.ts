import {
  reviewModeFor,
  type ConsensusPolicy,
  type ConsensusResult,
  type NormalizationIssue,
  type NormalizedAnswer,
  type ReadingOutcome,
  type ReadingState,
  type ResponseFormat,
  type ReviewReason,
  type ScoringOutcome,
  type TiebreakTrigger,
  type TranscriptionOutput,
  type TranscriptionStatus,
} from '@soe/types';
import { normalizeTranscription, requiresRubricGrading } from '../formats/registry';
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
  /** Proveedor del lector; lo exige `tiebreakAgreeWith: 'other_provider'`. */
  readonly provider?: string;
  /** Umbral propio del lector (`ReaderSpec.minConfidence`); si falta, rige el de la política. */
  readonly minConfidence?: number;
}

export interface ConsensusOptions {
  readonly format: ResponseFormat;
  /** Tinta medida en el recorte tras restar la plantilla (paso 1). */
  readonly inkRatio?: number | null;
  /** Identificador estable de la casilla leída; decide la auditoría muestral. */
  readonly readingKey: string;
  /** Motivo cuando no hubo lectores (por ejemplo, la org no permite enviar imágenes). */
  readonly notReadReason?: Extract<
    ReviewReason,
    'insufficient_readers' | 'external_vision_disabled'
  >;
}

type ValidReading = ConsensusReading & { readonly output: TranscriptionOutput };

/** Orden lexicográfico: la primera componente que difiere decide; un empate conserva el orden de la ruta. */
function isBetterRank(candidate: readonly number[], current: readonly number[]): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    const difference = (candidate[index] ?? 0) - (current[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

interface Normalized {
  readonly reading: ValidReading;
  readonly answer: NormalizedAnswer;
}

/**
 * Problemas del normalizador que mandan a revisión de lectura aunque haya valor:
 * el literal no calza con el formato o con las partes que reportó el lector.
 * La ambigüedad miles/decimal no está: la decide la corrección (paso 9).
 */
const FORMAT_ISSUES: ReadonlySet<NormalizationIssue> = new Set<NormalizationIssue>([
  'format_mismatch',
  'parts_disagree_with_literal',
  'empty_part',
  'non_numeric_in_numeric',
  'unexpected_unit',
  'extra_tokens',
]);

function hasFormatIssue(answer: NormalizedAnswer): boolean {
  return answer.issues.some((issue) => FORMAT_ISSUES.has(issue));
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

/** Cada lectura se mide con el umbral de su lector; sin él, con el de la política. */
function meetsConfidence(reading: ValidReading, policy: ConsensusPolicy): boolean {
  return reading.output.confidence >= (reading.minConfidence ?? policy.minConfidence);
}

function distinctFamilies(readings: readonly ConsensusReading[]): number {
  return new Set(readings.map((reading) => reading.family)).size;
}

/**
 * Consenso y abstención (diseño §8.2). Pasos, en orden:
 *  1. tinta bajo el umbral → auto_blank (sin modelos);
 *  2. lecturas válidas < minReaders → revisión [reader_failed | insufficient_readers];
 *  3. familias repetidas cuando se exigen distintas → revisión [insufficient_readers];
 *  4. algún estado ≠ answered: todas en blanco → auto_blank, pero antes pasa por
 *     4b, 7, 10 y 11 (petición de revisión, confianza, política y auditoría);
 *     ilegible / varias respuestas / tachado → revisión;
 *  4b. algún lector pidió revisión → revisión [reader_requested_review];
 *  5. no se pudo convertir al formato → revisión [unparsed_format] (nunca incorrecta);
 *  6. desacuerdo → desempate (si está configurado y llegó) o revisión [readers_disagree];
 *  6b. el valor acordado no calza con el formato o con sus partes (issues del
 *     normalizador) → revisión [format_mismatch];
 *  7. confianza baja → revisión [low_confidence]; cada lectura se compara con su
 *     propio umbral (`minConfidence` del lector) o, si no lo trae, con el de la política;
 *  8. alternativa plausible que cambia el resultado → revisión [alternative_flips_outcome];
 *  9. corrección indecidible → revisión [undecidable];
 * 10. la política no autoacepta ese resultado → revisión [policy_requires_review];
 * 11. auto_accepted (o auto_blank), salvo que caiga en la muestra de auditoría →
 *     revisión [audit_sample];
 * 12. con `tiebreakOn` (escalamiento), una revisión solo por motivos de esa lista
 *     puede confirmarse con la lectura de desempate (`confirmByEscalation`); en el
 *     paso 6 el desempate ya no se suma al grupo.
 *
 * Formatos de rúbrica (`free_text`, `math_work`): solo se transcriben. Nunca se
 * autoaceptan ni se corrigen contra una clave (`scoringOutcome` null): toda
 * decisión es revisión y lleva el motivo `rubric_item`, junto con los de lectura
 * (desacuerdo, confianza baja, ilegible…), que se resuelven primero.
 */
export function evaluateConsensus(
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
  scoreOf: ScoreOf,
  options: ConsensusOptions,
): ConsensusResult {
  const result = evaluatePrimaries(readings, policy, scoreOf, options);
  return confirmByEscalation(result, readings, policy, scoreOf, options) ?? result;
}

function evaluatePrimaries(
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
  scoreOf: ScoreOf,
  options: ConsensusOptions,
): ConsensusResult {
  const { format } = options;
  const rubric = requiresRubricGrading(format);
  const scoreIfParsed = (answer: NormalizedAnswer | null): ScoringOutcome | null =>
    !rubric && answer !== null && answer.canonical !== null ? scoreOf(answer) : null;
  const decide = (
    outcome: ReadingOutcome,
    value: NormalizedAnswer | null,
    reasons: ReviewReason[],
    used: readonly ConsensusReading[],
    scoringOutcome: ScoringOutcome | null = scoreIfParsed(value),
  ): ConsensusResult => ({
    outcome,
    value,
    scoringOutcome: rubric ? null : scoringOutcome,
    reasons:
      rubric && outcome === 'needs_review' && !reasons.includes('rubric_item')
        ? [...reasons, 'rubric_item']
        : reasons,
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
  const audited = isAuditSample(options.readingKey, policy.auditSampleRate);
  const acceptBlank = (used: readonly ValidReading[]): ConsensusResult => {
    const blank = blankAnswer(format);
    const blankScore = rubric ? null : scoreOf(blank);
    const reviewBlank = (reason: ReviewReason) =>
      decide('needs_review', blank, [reason], used, blankScore);
    if (used.some((reading) => reading.output.reviewRequested)) {
      return reviewBlank('reader_requested_review');
    }
    if (used.some((reading) => !meetsConfidence(reading, policy))) {
      return reviewBlank('low_confidence');
    }
    if (rubric) return reviewBlank('rubric_item');
    const blankAcceptable =
      blankScore !== null &&
      (policy.autoAcceptOutcomes as readonly ScoringOutcome[]).includes(blankScore);
    if (!policy.autoAccept || !blankAcceptable) return reviewBlank('policy_requires_review');
    if (audited) return reviewBlank('audit_sample');
    return decide('auto_blank', blank, [], used, blankScore);
  };

  if (
    policy.blankByInkBelow !== null &&
    options.inkRatio !== undefined &&
    options.inkRatio !== null &&
    options.inkRatio < policy.blankByInkBelow
  ) {
    return acceptBlank([]);
  }

  const primaries = readings.filter((reading) => (reading.role ?? 'primary') === 'primary');
  if (primaries.length === 0) {
    return decide('not_read', null, [options.notReadReason ?? 'insufficient_readers'], [], null);
  }

  const valid = primaries.filter(isValid);
  const proposal = (): NormalizedAnswer | null => {
    let best: { answer: NormalizedAnswer; rank: readonly number[] } | null = null;
    for (const reading of valid) {
      const answer = normalizeTranscription(reading.output, format);
      const rank = [
        reading.output.reviewRequested ? 0 : 1,
        answer.canonical === null ? 0 : 1,
        meetsConfidence(reading, policy) ? 1 : 0,
        reading.output.confidence,
      ];
      if (best === null || isBetterRank(rank, best.rank)) best = { answer, rank };
    }
    return best?.answer ?? null;
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
    if (states.every((state) => state === 'blank')) return acceptBlank(valid);
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

  if (rubric) {
    const first = normalized[0]?.answer ?? null;
    const agree = new Set(normalized.map((entry) => entry.answer.canonical)).size === 1;
    const reasons: ReviewReason[] = agree ? [] : ['readers_disagree'];
    if (valid.some((reading) => !meetsConfidence(reading, policy))) {
      reasons.push('low_confidence');
    }
    return review(reasons, first, valid);
  }

  const agreementKey = (entry: Normalized): string =>
    policy.agreeOn === 'canonical' ? (entry.answer.canonical ?? '') : scoreOf(entry.answer);
  const used = agreeingGroup(normalized, readings, policy, format, agreementKey);
  if (used === null) return review(['readers_disagree'], null, valid);

  const usedReadings = used.map((entry) => entry.reading);
  const agreed = used[0]?.answer ?? null;
  if (agreed === null) return review(['readers_disagree'], null, valid);

  if (used.some((entry) => hasFormatIssue(entry.answer))) {
    return review(['format_mismatch'], agreed, usedReadings);
  }

  if (usedReadings.some((reading) => !meetsConfidence(reading, policy))) {
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

  if (audited) return review(['audit_sample'], agreed, usedReadings);

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
  if (policy.onDisagreement !== 'tiebreak_reader' || escalates(policy)) return null;
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
 * lector configurado y aún no hay desempate. Sin `tiebreakOn`, solo cuando todas
 * las primarias respondieron pero leyeron valores distintos. Con `tiebreakOn`
 * (escalamiento), cuando todos los motivos de revisión están en esa lista y hay
 * una primaria contestada con la que el desempate podría coincidir. Quien llama
 * corre el lector de desempate y vuelve a evaluar con esa lectura (`role: 'tiebreak'`).
 */
export function needsTiebreak(
  result: ConsensusResult,
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
): boolean {
  if (
    policy.onDisagreement !== 'tiebreak_reader' ||
    policy.tiebreakReader === null ||
    readings.some((reading) => reading.role === 'tiebreak')
  ) {
    return false;
  }
  if (escalates(policy)) {
    const tiebreakProvider = policy.tiebreakReader.provider;
    return (
      isEscalationTrigger(result, policy) &&
      readings.some(
        (reading) =>
          isValid(reading) &&
          reading.output.state === 'answered' &&
          canConfirm(reading, tiebreakProvider, policy),
      )
    );
  }
  return (
    result.outcome === 'needs_review' &&
    result.reasons.length === 1 &&
    result.reasons[0] === 'readers_disagree' &&
    result.value === null &&
    readings.every((reading) => reading.output?.state === 'answered')
  );
}

function escalates(policy: ConsensusPolicy): boolean {
  return policy.tiebreakOn !== undefined;
}

function isEscalationTrigger(result: ConsensusResult, policy: ConsensusPolicy): boolean {
  const triggers = new Set<ReviewReason>(policy.tiebreakOn ?? ([] as TiebreakTrigger[]));
  return (
    result.outcome === 'needs_review' &&
    result.reasons.length > 0 &&
    result.reasons.every((reason) => triggers.has(reason))
  );
}

/** ¿Esta primaria puede corroborar al desempate? Con `other_provider`, solo si se sabe que es de otro proveedor. */
function canConfirm(
  reading: ConsensusReading,
  tiebreakProvider: string | undefined,
  policy: ConsensusPolicy,
): boolean {
  if (policy.tiebreakAgreeWith !== 'other_provider') return true;
  return (
    reading.provider !== undefined &&
    tiebreakProvider !== undefined &&
    reading.provider !== tiebreakProvider
  );
}

/**
 * Escalamiento (`tiebreakOn`): si la casilla fue a revisión solo por motivos de
 * lectura de la lista, la lectura de desempate (contestada, sobre su umbral y sin
 * pedir revisión) la confirma cuando coincide con una primaria contestada que
 * `canConfirm` admite; se prefiere una de otro proveedor. No se exige la confianza
 * de esa primaria: el desempate lee de forma independiente. El valor es el de la
 * primaria y pasa por formato, corrección, política y auditoría. Si algo falla,
 * `null`: queda la revisión original.
 */
function confirmByEscalation(
  result: ConsensusResult,
  readings: readonly ConsensusReading[],
  policy: ConsensusPolicy,
  scoreOf: ScoreOf,
  options: ConsensusOptions,
): ConsensusResult | null {
  const { format } = options;
  if (!escalates(policy) || requiresRubricGrading(format) || !isEscalationTrigger(result, policy)) {
    return null;
  }
  const keyOf = (answer: NormalizedAnswer): string =>
    policy.agreeOn === 'canonical' ? (answer.canonical ?? '') : scoreOf(answer);
  const tiebreak = readings
    .filter((reading) => reading.role === 'tiebreak')
    .filter(isValid)
    .find(
      (reading) =>
        reading.output.state === 'answered' &&
        !reading.output.reviewRequested &&
        meetsConfidence(reading, policy),
    );
  if (!tiebreak) return null;
  const tiebreakAnswer = normalizeTranscription(tiebreak.output, format);
  if (tiebreakAnswer.canonical === null || hasFormatIssue(tiebreakAnswer)) return null;
  const otherProvider = (reading: ConsensusReading) =>
    reading.provider !== undefined &&
    tiebreak.provider !== undefined &&
    reading.provider !== tiebreak.provider;
  const candidates = readings
    .filter((reading) => (reading.role ?? 'primary') === 'primary')
    .filter(isValid)
    .filter(
      (reading) =>
        reading.output.state === 'answered' && canConfirm(reading, tiebreak.provider, policy),
    )
    .map((reading) => ({ reading, answer: normalizeTranscription(reading.output, format) }))
    .filter(
      (entry) => entry.answer.canonical !== null && keyOf(entry.answer) === keyOf(tiebreakAnswer),
    );
  const match = candidates.find((entry) => otherProvider(entry.reading)) ?? candidates[0] ?? null;
  if (match === null || hasFormatIssue(match.answer)) return null;
  const scoringOutcome = scoreOf(match.answer);
  const acceptable = (policy.autoAcceptOutcomes as readonly ScoringOutcome[]).includes(
    scoringOutcome,
  );
  if (!policy.autoAccept || !acceptable) return null;
  const audited = isAuditSample(options.readingKey, policy.auditSampleRate);
  const reasons: ReviewReason[] = audited ? ['audit_sample'] : [];
  return {
    outcome: audited ? 'needs_review' : 'auto_accepted',
    value: match.answer,
    scoringOutcome,
    reasons,
    reviewMode: audited ? reviewModeFor(reasons) : null,
    usedReadingIds: [match.reading.readingId, tiebreak.readingId],
    policyId: policy.id,
    policyVersion: policy.version,
  };
}
