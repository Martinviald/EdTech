import type { UserRole } from '../enums';

// Roles autorizados a gestionar hojas de respuesta propias (diseñar el layout,
// congelarlo, imprimir tiradas y subir lotes de escaneo). Mismo público que
// ANSWER_SHEET_IMPORT_ROLES: quien hoy importa escaneos de GradeCam es quien
// mañana imprime y escanea hojas propias.
export const SHEET_MANAGEMENT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles autorizados a operar la cola de revisión (G6). La vista muestra el
// nombre del alumno junto a su hoja, así que además pasa por SensitiveDataGuard:
// este conjunto se mantiene deliberadamente igual a SENSITIVE_DATA_ROLES — si
// se agrega un rol acá, hay que decidir qué pasa con ese guard.
export const SHEET_REVIEW_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];
