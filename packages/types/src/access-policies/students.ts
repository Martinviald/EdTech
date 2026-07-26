import type { UserRole } from '../enums';

// Roles que pueden ver y administrar la nómina de alumnos del colegio. Incluye
// al profesor jefe (ve a su curso) además de los directivos.
export const STUDENT_ROSTER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'homeroom_teacher',
];
