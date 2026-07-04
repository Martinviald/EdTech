import type { RemedialMaterialType, RemedialMethod, RemedialStatus } from '@soe/types';
import type { StatusTone } from '@/components/patterns';

/** Etiquetas en español por tipo de material remedial. */
export const REMEDIAL_TYPE_LABELS: Record<RemedialMaterialType, string> = {
  guide: 'Guía de reenseñanza',
  practice_set: 'Set de práctica',
  group_plan: 'Plan por grupo',
};

/** Etiquetas en español por método de generación del set (Ola 2.1a). */
export const REMEDIAL_METHOD_LABELS: Record<RemedialMethod, string> = {
  reuse_stimulus: 'Mismas lecturas (Opción A)',
  self_contained: 'Ejercicios sin texto',
  generate_stimulus: 'Texto nuevo IA (Opción B)',
};

/** Opción del selector de método, con descripción y estado (deshabilitado/badge). */
export interface RemedialMethodOption {
  value: RemedialMethod;
  label: string;
  description: string;
  disabled?: boolean;
  badge?: string;
}

/**
 * Opciones del selector de método (solo `practice_set`). `reuse_stimulus` (Opción A)
 * genera preguntas sobre un texto oficial; `self_contained`, ejercicios sin texto;
 * `generate_stimulus` (Opción B) llega en 2.2 → deshabilitado con tag "Próximamente".
 */
export const REMEDIAL_METHOD_OPTIONS: RemedialMethodOption[] = [
  {
    value: 'reuse_stimulus',
    label: REMEDIAL_METHOD_LABELS.reuse_stimulus,
    description:
      'Preguntas nuevas sobre un texto oficial de la evaluación (el de mayor brecha, cambiable).',
  },
  {
    value: 'self_contained',
    label: REMEDIAL_METHOD_LABELS.self_contained,
    description: 'Ejercicios de opción múltiple sin texto base.',
  },
  {
    value: 'generate_stimulus',
    label: REMEDIAL_METHOD_LABELS.generate_stimulus,
    description: 'La IA redacta un texto nuevo y genera preguntas sobre él.',
    disabled: true,
    badge: 'Próximamente',
  },
];

/** Aviso de fallback cuando no hay textos disponibles (evaluación ni banco). */
export const REMEDIAL_NO_STIMULUS_NOTICE =
  'Esta habilidad no tiene textos disponibles en la evaluación ni en el banco. Se generarán ejercicios sin texto.';

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
