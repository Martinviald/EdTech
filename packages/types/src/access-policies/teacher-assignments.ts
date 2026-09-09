import type { UserRole } from '../enums';
import { userHasAnyRole } from '../utils/roles';

/** Quién puede administrar las asignaciones académicas de la org. */
export const ASSIGNMENTS_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

/**
 * Roles que pueden RECIBIR carga académica (`teacher_assignments`).
 *
 * Vive acá y no inline en cada service porque estaba duplicada en dos lugares
 * (`organizations.listTeachers` y la validación de `teacher-assignments.create`), que es
 * justo el patrón que CLAUDE.md §6.3 prohíbe: dos listas que se desincronizan y nadie se
 * entera hasta que un docente aparece en el selector y falla al guardarse.
 */
export const TEACHING_ROLES: readonly UserRole[] = [
  'teacher',
  'homeroom_teacher',
  'eval_coordinator',
];

/**
 * ¿Esta persona puede recibir carga académica?
 *
 * Se responde sobre TODOS sus roles, no sobre uno solo. Es la regla de "guards por
 * unión" de CLAUDE.md §6.3, y acá no es teórica: en la demo hay 6 directores académicos
 * que además hacen clases (`academic_director` + `teacher`). La validación anterior
 * tomaba UN membership arbitrario (`LIMIT 1` sin `ORDER BY`), le tocaba
 * `academic_director` y los rechazaba con "Solo profesores… pueden ser asignados" —
 * siendo que sí son profesores.
 */
export function canReceiveTeachingLoad(roles: readonly UserRole[]): boolean {
  return userHasAnyRole(roles, TEACHING_ROLES);
}
