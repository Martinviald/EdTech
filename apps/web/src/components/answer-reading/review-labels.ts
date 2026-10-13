import type { ReadingState, ReviewMode, ReviewReason, ScoringOutcome } from '@soe/types';
import type { StatusTone } from '@/components/shared/StatusBadge';

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  readers_disagree: 'Los lectores no coinciden',
  low_confidence: 'Lectura con poca confianza',
  alternative_flips_outcome: 'Otra lectura posible cambiaría el resultado',
  illegible: 'Un lector la marcó ilegible',
  multiple_answers: 'Parece haber más de una respuesta',
  crossed_out: 'Hay texto tachado',
  undecidable: 'No se pudo decidir si es correcta',
  unparsed_format: 'La respuesta no calza con el formato esperado',
  format_mismatch: 'Lo escrito no corresponde al formato de la casilla',
  reader_failed: 'Un lector falló',
  insufficient_readers: 'No hubo suficientes lecturas',
  reader_requested_review: 'Un lector pidió revisión humana',
  policy_requires_review: 'La política del colegio exige revisión',
  audit_sample: 'Muestra de auditoría',
  rubric_item: 'Pregunta con rúbrica',
  external_vision_disabled: 'El envío de imágenes a terceros está desactivado',
  reading_disabled: 'La lectura automática está desactivada',
  budget_exceeded: 'Se alcanzó el presupuesto de lectura',
  run_limit_exceeded: 'Se alcanzó el tope de recortes por lote',
  crop_unavailable: 'El recorte no está disponible',
  verifier_flagged: 'El verificador cree que podría ser la respuesta correcta mal leída',
  verifier_failed: 'El verificador no pudo revisar esta respuesta: confirma qué escribió el alumno',
  scoring_changed: 'La clave cambió después de la lectura: confirma qué escribió el alumno',
};

export const REVIEW_MODE_LABELS: Record<ReviewMode, string> = {
  reading: 'Lectura',
  grading: 'Corrección',
};

export const REVIEW_MODE_QUESTIONS: Record<ReviewMode, string> = {
  reading: '¿Qué escribió el alumno?',
  grading: '¿Esta respuesta es correcta?',
};

export const SCORING_OUTCOME_LABELS: Record<ScoringOutcome, string> = {
  correct: 'Correcta',
  incorrect: 'Incorrecta',
  partial: 'Parcial',
  undecidable: 'Sin decidir',
};

export const SCORING_OUTCOME_TONES: Record<ScoringOutcome, StatusTone> = {
  correct: 'success',
  incorrect: 'danger',
  partial: 'warning',
  undecidable: 'neutral',
};

export const READING_STATE_LABELS: Record<ReadingState, string> = {
  answered: 'Respondida',
  blank: 'En blanco',
  illegible: 'Ilegible',
  crossed_out_only: 'Solo tachado',
  multiple_answers: 'Varias respuestas',
};

export function formatConfidence(confidence: number | null): string {
  if (confidence === null) return 'sin confianza';
  return confidence.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
