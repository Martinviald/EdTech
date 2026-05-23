import { pgEnum } from 'drizzle-orm/pg-core';

export const orgTypeEnum = pgEnum('org_type', ['platform', 'foundation', 'school']);

export const schoolDependenceEnum = pgEnum('school_dependence', [
  'municipal',
  'particular_pagado',
  'particular_subvencionado',
  'delegada',
]);

export const userRoleEnum = pgEnum('user_role', [
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
]);

export const ssoProviderEnum = pgEnum('sso_provider', ['google', 'microsoft']);

export const genderEnum = pgEnum('gender', ['M', 'F', 'X', 'unspecified']);

export const enrollmentStatusEnum = pgEnum('enrollment_status', [
  'active',
  'transferred',
  'graduated',
  'withdrawn',
]);

export const curriculumTypeEnum = pgEnum('curriculum_type', [
  'mineduc',
  'simce',
  'paes',
  'dia',
  'cambridge',
  'aptus',
  'desafio',
  'custom',
]);

export const taxonomyNodeTypeEnum = pgEnum('taxonomy_node_type', [
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
]);

export const taxonomyMappingTypeEnum = pgEnum('taxonomy_mapping_type', [
  'equivalent',
  'subset',
  'related',
]);

export const instrumentTypeEnum = pgEnum('instrument_type', [
  'dia',
  'simce',
  'paes',
  'cambridge_mock',
  'aptus',
  'desafio',
  'pal',
  'custom',
]);

export const instrumentStatusEnum = pgEnum('instrument_status', ['draft', 'published', 'archived']);

export const sectionTypeEnum = pgEnum('section_type', [
  'multiple_choice',
  'open_ended',
  'oral_reading',
  'oral_expression',
  'writing',
  'listening',
  'matching',
  'mixed',
]);

export const itemTypeEnum = pgEnum('item_type', [
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
]);

export const itemStatusEnum = pgEnum('item_status', ['draft', 'review', 'published', 'deprecated']);

export const itemSourceEnum = pgEnum('item_source', [
  'official',
  'ai_generated',
  'custom',
  'imported',
]);

export const itemTagTypeEnum = pgEnum('item_tag_type', ['primary', 'secondary']);
export const taggedByEnum = pgEnum('tagged_by', ['human', 'ai']);

export const gradingScaleTypeEnum = pgEnum('grading_scale_type', [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
]);

export const assessmentStatusEnum = pgEnum('assessment_status', [
  'scheduled',
  'in_progress',
  'processing',
  'completed',
  'cancelled',
]);

export const assessmentModeEnum = pgEnum('assessment_mode', ['paper', 'digital', 'oral', 'mixed']);

export const importJobTypeEnum = pgEnum('import_job_type', [
  'answer_sheet_csv',
  'dia_official',
  'gradecam_csv',
  'zipgrade_csv',
  'aptus',
  'student_roster',
]);

export const importJobStatusEnum = pgEnum('import_job_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'partial',
]);

export const scoredByEnum = pgEnum('scored_by', ['auto', 'ai', 'human']);

export const performanceLevelEnum = pgEnum('performance_level', [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
]);

export const rubricTypeEnum = pgEnum('rubric_type', ['analytic', 'holistic']);
