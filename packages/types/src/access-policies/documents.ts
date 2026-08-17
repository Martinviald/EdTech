import type { UserRole } from '../enums';

// Roles que pueden usar el Editor de Materiales (crear/editar documentos propios
// y duplicar compartidos — docs/propuesta-editor-materiales.md §11). El profesor
// es el usuario principal (arma guías y material para su aula); coordinaciones y
// dirección también crean material institucional. `guardian` queda fuera.
export const DOCUMENT_EDITOR_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'teacher',
  'homeroom_teacher',
];

// Roles que pueden VER la biblioteca de materiales. Mismo conjunto que editores
// en v1 (alias intencional, no copy-paste): quien ve la biblioteca puede crear.
// Editar un documento AJENO no lo decide el rol sino created_by_id + visibility
// (copy-on-use); ese chequeo vive en el service.
export const DOCUMENT_VIEWER_ROLES: readonly UserRole[] = DOCUMENT_EDITOR_ROLES;

// Roles que pueden editar el BRANDING del colegio (logo, colores, textos de
// cabecera/pie usados en los documentos imprimibles). Configuración
// institucional → solo dirección/administración.
export const ORG_BRANDING_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];
