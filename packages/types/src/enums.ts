export const ORG_TYPES = ['platform', 'foundation', 'school'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const SCHOOL_DEPENDENCES = [
  'municipal',
  'particular_pagado',
  'particular_subvencionado',
  'delegada',
] as const;
export type SchoolDependence = (typeof SCHOOL_DEPENDENCES)[number];

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

// Mayor a menor privilegio. Usado por pickDefaultActiveRole para decidir qué
// rol mostrar por default cuando un usuario tiene múltiples memberships.
export const ROLE_HIERARCHY = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'eval_coordinator',
  'dept_head',
  'coordinator',
  'homeroom_teacher',
  'teacher',
  'foundation_director',
  'guardian',
] as const satisfies readonly UserRole[];

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

// Tipos de nodo de taxonomía que NO se reportan en las agregaciones de resultados
// (matriz de habilidades `dashboards`/skills, heatmap, informes por nodo). Los
// descriptores son metadato del ítem (banco de ítems) y contexto para IA remedial,
// NO una dimensión de reporte pedagógico (TKT-05). Excluirlos aquí no afecta el
// banco de ítems ni el pipeline de IA — sólo la lectura de resultados.
export const RESULT_HIDDEN_NODE_TYPES = ['descriptor'] as const;
export type ResultHiddenNodeType = (typeof RESULT_HIDDEN_NODE_TYPES)[number];

export const PERFORMANCE_LEVELS = ['insufficient', 'elementary', 'adequate', 'advanced'] as const;
export type PerformanceLevel = (typeof PERFORMANCE_LEVELS)[number];

// Métrica raíz de un resultado. El DIA y la mayoría de las pruebas chilenas
// usan `percentage` (% de logro 0..1). `scaled` cubre PAES (150–1000), stanine,
// puntaje IRT, etc. `band` cubre escalas puramente categóricas (Cambridge CEFR
// A1–C2) donde no hay un puntaje numérico continuo sino una banda.
export const METRIC_TYPES = ['percentage', 'scaled', 'band'] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

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
