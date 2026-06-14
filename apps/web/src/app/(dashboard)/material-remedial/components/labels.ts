import type { RemedialMaterialType, RemedialStatus } from '@soe/types';
import type { StatusTone } from '@/components/patterns';

/** Etiquetas en español por tipo de material remedial. */
export const REMEDIAL_TYPE_LABELS: Record<RemedialMaterialType, string> = {
  guide: 'Guía de reenseñanza',
  practice_set: 'Set de práctica',
  group_plan: 'Plan por grupo',
};

/** Etiquetas en español por estado. */
export const REMEDIAL_STATUS_LABELS: Record<RemedialStatus, string> = {
  pending: 'En cola',
  processing: 'Generando',
  ready: 'Borrador (revisar)',
  failed: 'Falló',
  approved: 'Aprobado',
  discarded: 'Descartado',
};

/** Tono visual del badge por estado. */
export const REMEDIAL_STATUS_TONE: Record<RemedialStatus, StatusTone> = {
  pending: 'neutral',
  processing: 'info',
  ready: 'warning',
  failed: 'danger',
  approved: 'success',
  discarded: 'neutral',
};

/** Opciones de tipo para selects/filtros. */
export const REMEDIAL_TYPE_OPTIONS: { value: RemedialMaterialType; label: string }[] = [
  { value: 'guide', label: REMEDIAL_TYPE_LABELS.guide },
  { value: 'practice_set', label: REMEDIAL_TYPE_LABELS.practice_set },
  { value: 'group_plan', label: REMEDIAL_TYPE_LABELS.group_plan },
];

/** Opciones de estado para filtros. */
export const REMEDIAL_STATUS_OPTIONS: { value: RemedialStatus; label: string }[] = [
  { value: 'pending', label: REMEDIAL_STATUS_LABELS.pending },
  { value: 'processing', label: REMEDIAL_STATUS_LABELS.processing },
  { value: 'ready', label: REMEDIAL_STATUS_LABELS.ready },
  { value: 'approved', label: REMEDIAL_STATUS_LABELS.approved },
  { value: 'discarded', label: REMEDIAL_STATUS_LABELS.discarded },
  { value: 'failed', label: REMEDIAL_STATUS_LABELS.failed },
];

/** Texto del disclaimer IA (CLAUDE.md §8.3: la IA propone, el humano aprueba). */
export const AI_DISCLAIMER =
  'Contenido sugerido por IA. Revisa y valida antes de usarlo en aula; ajústalo si es necesario y apruébalo.';
