export const ORG_TYPES = ['platform', 'foundation', 'school'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const USER_ROLES = [
  'platform_admin',
  'foundation_director',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'teacher',
  'homeroom_teacher',
  'eval_coordinator',
  'guardian',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const INSTRUMENT_TYPES = [
  'dia',
  'simce',
  'paes',
  'cambridge_mock',
  'aptus',
  'desafio',
  'pal',
  'custom',
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const ITEM_TYPES = [
  'multiple_choice',
  'true_false',
  'open_ended',
  'oral_reading',
  'oral_expression',
  'writing',
  'listening',
  'matching',
  'ordering',
  'gap_fill',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const TAXONOMY_NODE_TYPES = [
  'domain',
  'subdomain',
  'axis',
  'learning_objective',
  'skill',
  'content',
  'text_type',
  'performance_level',
  'descriptor',
  'criterion',
  'paper',
] as const;
export type TaxonomyNodeType = (typeof TAXONOMY_NODE_TYPES)[number];

export const PERFORMANCE_LEVELS = ['insufficient', 'elementary', 'adequate', 'advanced'] as const;
export type PerformanceLevel = (typeof PERFORMANCE_LEVELS)[number];

export const ASSESSMENT_STATUS = [
  'scheduled',
  'in_progress',
  'processing',
  'completed',
  'cancelled',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUS)[number];

export const ASSESSMENT_MODE = ['paper', 'digital', 'oral', 'mixed'] as const;
export type AssessmentMode = (typeof ASSESSMENT_MODE)[number];
