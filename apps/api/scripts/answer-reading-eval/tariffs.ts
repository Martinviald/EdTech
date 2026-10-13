import type { LlmProviderId } from '@soe/types';

export interface EvalTariff {
  readonly provider: LlmProviderId;
  readonly inputUsdPerMtok: number;
  readonly outputUsdPerMtok: number;
  readonly cachedInputUsdPerMtok: number | null;
  readonly maxOutputTokens: number;
  readonly supportsSamplingParams: boolean;
  readonly source: string;
}

const MIGRATION_0044 = 'llm_models, migración 0044_llm_models.sql';
const MIGRATION_0046 = 'llm_models, migración 0046_llm_models_openai.sql';
const GEMINI_FLASH_2027 =
  'https://ai.google.dev/gemini-api/docs/pricing (oct. 2026): US$0,75 / 3,75 hasta el 31-12-2026 y US$1,50 / 7,50 desde el 1-1-2027, salida con razonamiento incluido; se usa el de 2027 (conservador)';

export const EVAL_TARIFFS: Readonly<Record<string, EvalTariff>> = {
  'claude-haiku-5-5': {
    provider: 'anthropic',
    inputUsdPerMtok: 0.1,
    outputUsdPerMtok: 0.5,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 8192,
    supportsSamplingParams: false,
    source: MIGRATION_0044,
  },
  'claude-sonnet-5-5': {
    provider: 'anthropic',
    inputUsdPerMtok: 2,
    outputUsdPerMtok: 10,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 16384,
    supportsSamplingParams: false,
    source: MIGRATION_0044,
  },
  'gemini-3.1-flash-lite': {
    provider: 'gemini',
    inputUsdPerMtok: 0.25,
    outputUsdPerMtok: 1.5,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 8192,
    supportsSamplingParams: true,
    source: MIGRATION_0044,
  },
  'gemini-3.5-flash-lite': {
    provider: 'gemini',
    inputUsdPerMtok: 0.3,
    outputUsdPerMtok: 2.5,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 8192,
    supportsSamplingParams: true,
    source: MIGRATION_0044,
  },
  'gemini-3.5-flash': {
    provider: 'gemini',
    inputUsdPerMtok: 1.5,
    outputUsdPerMtok: 9,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 16384,
    supportsSamplingParams: true,
    source:
      'agregadores de precios, sep. 2026 (anotherwrapper.com, pricepertoken.com), anotado en pruebas-vlm-manuscrito/hojas-sinteticas/experimento-lectores/analisis.md; sin página oficial de Google',
  },
  'gemini-3.6-flash': {
    provider: 'gemini',
    inputUsdPerMtok: 1.5,
    outputUsdPerMtok: 7.5,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 16384,
    supportsSamplingParams: true,
    source: GEMINI_FLASH_2027,
  },
  'gemini-3.8-flash': {
    provider: 'gemini',
    inputUsdPerMtok: 1.5,
    outputUsdPerMtok: 7.5,
    cachedInputUsdPerMtok: null,
    maxOutputTokens: 16384,
    supportsSamplingParams: true,
    source: GEMINI_FLASH_2027,
  },
  'gpt-6-luna': {
    provider: 'openai',
    inputUsdPerMtok: 0.1,
    outputUsdPerMtok: 0.5,
    cachedInputUsdPerMtok: 0.01,
    maxOutputTokens: 16384,
    supportsSamplingParams: false,
    source: MIGRATION_0046,
  },
};
