import type { UserRole } from '../enums';

// Roles que pueden usar el asistente conversacional (v1 = solo directivos,
// por minimización de superficie de PII; los profesores entran en v2 con
// scoping por curso). El gating de tier pago lo aplica además
// @RequireFeature('ai_assistant').
export const ASSISTANT_USER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
];
