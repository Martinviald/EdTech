import type { UserRole } from '../enums';
import { RESULTS_VIEWER_ROLES } from './results-dashboards';

export const PROCESS_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

export const PROCESS_MANAGEMENT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];
