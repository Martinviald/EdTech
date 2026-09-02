import type { UserRole } from '../enums';

// Enviar feedback lo puede hacer CUALQUIER persona autenticada de la org. Poner
// un rol mínimo acá sería contraproducente: el punto del widget es que quien
// tropieza con la fricción la reporte en el momento, y quien más tropieza es el
// profesor de aula. La lista es explícita (no "todos") para que el guard siga
// siendo el mismo mecanismo que el resto de la API.
export const FEEDBACK_SUBMIT_ROLES: readonly UserRole[] = [
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
];

// Leer y hacer triage de los comentarios del colegio: solo dirección.
export const FEEDBACK_TRIAGE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];
