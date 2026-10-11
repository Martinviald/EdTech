import { z } from 'zod';

// Valores de las columnas de estado de las tablas de lectura por visión (diseño §9).
// Los enums de Postgres en `packages/db` se construyen con estas mismas listas.

export const ANSWER_READING_RUN_STATUSES = [
  'pending',
  'running',
  'waiting_provider',
  'completed',
  'failed',
  'budget_exceeded',
] as const;
export type AnswerReadingRunStatus = (typeof ANSWER_READING_RUN_STATUSES)[number];
export const answerReadingRunStatusSchema = z.enum(ANSWER_READING_RUN_STATUSES);

// D2: la lectura arranca al procesar cada hoja (`scan_processed`), antes de confirmar.
export const ANSWER_READING_RUN_TRIGGERS = [
  'scan_processed',
  'manual_rerun',
  'route_change',
  'backfill',
] as const;
export type AnswerReadingRunTrigger = (typeof ANSWER_READING_RUN_TRIGGERS)[number];
export const answerReadingRunTriggerSchema = z.enum(ANSWER_READING_RUN_TRIGGERS);

// `primary` entra al consenso, `shadow` solo se mide (§6.5) y `tiebreak` es el
// lector de desempate de la política (§8.1).
export const READING_MODES = ['primary', 'shadow', 'tiebreak'] as const;
export type ReadingMode = (typeof READING_MODES)[number];
export const readingModeSchema = z.enum(READING_MODES);

// De dónde sale la etiqueta de una muestra del dataset (§11.4).
export const SAMPLE_LABEL_SOURCES = [
  'review_reading',
  'review_grading',
  'double_annotation',
  'import',
] as const;
export type SampleLabelSource = (typeof SAMPLE_LABEL_SOURCES)[number];
export const sampleLabelSourceSchema = z.enum(SAMPLE_LABEL_SOURCES);

// `test` nunca se usa para ajustar prompts.
export const SAMPLE_SPLITS = ['train', 'validation', 'test'] as const;
export type SampleSplit = (typeof SAMPLE_SPLITS)[number];
export const sampleSplitSchema = z.enum(SAMPLE_SPLITS);

// D7: por ahora solo `org_internal`; `platform_eval` queda previsto.
export const SAMPLE_CONSENT_SCOPES = ['org_internal', 'platform_eval'] as const;
export type SampleConsentScope = (typeof SAMPLE_CONSENT_SCOPES)[number];
export const sampleConsentScopeSchema = z.enum(SAMPLE_CONSENT_SCOPES);
