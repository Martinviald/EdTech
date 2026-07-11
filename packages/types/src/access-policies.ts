import type { UserRole } from './enums';

// Fuente única de verdad para los conjuntos de roles que controlan acceso a
// features/páginas. Consumido tanto por guards backend como por guards inline
// en server components del frontend. Si agregas una constante nueva acá,
// úsala en ambos lados — no la dupliques inline.

export const TAXONOMY_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

export const STAFF_MANAGEMENT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
];

export const IMPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

export const ASSIGNMENTS_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

export const CLASS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'homeroom_teacher',
  'teacher',
];

// Roles autorizados a ver datos psicopedagógicos/PII sensible (alumnos, etc.).
export const SENSITIVE_DATA_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles autorizados a gestionar el banco de ítems y pautas de instrumentos.
export const ITEM_BANK_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que pueden ver ítems (lectura) pero no editarlos.
export const ITEM_VIEWER_ROLES: readonly UserRole[] = [
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

// Roles de "profesor" — usados para la vista "Mis cursos" que es la única
// excepción a la regla de unión: el isTeacherView se decide por activeRole,
// no por la unión, para que un usuario teacher+academic_director pueda
// alternar entre la vista de admin y la de profesor.
export const TEACHER_ROLES: readonly UserRole[] = [
  'teacher',
  'homeroom_teacher',
];

// Roles autorizados a importar hojas de respuesta (DIA, Gradecam, ZipGrade,
// archivo oficial). Coincide con IMPORT_ROLES + eval_coordinator (la persona
// que típicamente corre la corrección en el colegio).
export const ANSWER_SHEET_IMPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que pueden gestionar las escalas de notas del colegio.
export const GRADING_SCALE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

// Roles que pueden ver los resultados consolidados de una evaluación.
// Profesores ven sólo los resultados de sus cursos asignados — el scoping por
// teacher_assignments lo aplica el service, no esta constante.
export const RESULTS_VIEWER_ROLES: readonly UserRole[] = [
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

// Roles que pueden gatillar el recálculo de resultados de una evaluación.
export const RESULTS_RECALCULATE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que pueden ver los dashboards de resultados (S4 — H6.1..H6.8). Mismo
// conjunto que RESULTS_VIEWER_ROLES: los dashboards son la capa de visualización
// sobre los resultados. El scoping por curso para profesores lo aplica el
// service, no esta constante.
export const DASHBOARD_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver la analítica de series temporales (S4 — H6.3, H6.6:
// comparación de generaciones y progresión).
export const ANALYTICS_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver el mapa de calor de % logro por habilidad × asignatura
// (S5 — H6.10). Mismo conjunto que los dashboards; el scoping por curso para
// profesores lo aplica el service.
export const HEATMAP_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver el análisis a nivel de ítem (S5 — H6.11 tabla cruzada
// alumno × pregunta × habilidad × contenido, y H6.12 distribución de respuestas
// y análisis de distractores). Mismo conjunto que los dashboards; el scoping por
// curso para profesores lo aplica el service.
export const ITEM_ANALYSIS_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver la calidad de instrumento/ítems (F2 S2 — H20.9: KR-20 +
// flags psicométricos + sugerencias de corrección deterministas). Análisis
// determinista (sin costo IA) → mismo conjunto que los dashboards. El scoping por
// curso para profesores lo aplica el service.
export const INSTRUMENT_QUALITY_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// ── F2 S0 — Análisis IA y Benchmarking ──────────────────────────────────────
// Roles que pueden VER análisis IA (E20 / H19.23). Resultados + profesor.
export const AI_ANALYSIS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
  'teacher',
];

// Roles que pueden GATILLAR generación de análisis IA (tiene costo) — sin teacher.
export const AI_ANALYSIS_GENERATOR_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que gestionan la participación en benchmarking (opt-out + consentimiento, H19.24).
export const BENCHMARK_SETTINGS_ROLES: readonly UserRole[] = ['platform_admin', 'school_admin'];

// ── F2 S3 — IA Remedial (RAG) ────────────────────────────────────────────────
// Roles que pueden VER material remedial. El profesor es el usuario principal del
// material (guía/ítems/plan para su aula), por eso se incluye.
export const REMEDIAL_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
  'teacher',
];

// Roles que pueden GATILLAR generación remedial (tiene costo IA). Incluye teacher:
// la generación de material remedial nace de la brecha del aula del profesor.
export const REMEDIAL_GENERATOR_ROLES: readonly UserRole[] = REMEDIAL_VIEWER_ROLES;

// Roles que pueden APROBAR/DESCARTAR material remedial (IA propone, humano aprueba).
// El profesor aprueba el material de su aula; coordinadores/directivos también.
export const REMEDIAL_APPROVER_ROLES: readonly UserRole[] = REMEDIAL_VIEWER_ROLES;

// ── F2 S4 — Benchmarking Institucional ───────────────────────────────────────
// Roles que pueden VER benchmarking (decisión institucional/directiva, NO profesor:
// es comparación macro entre colegios). Incluye el director de sostenedor para el
// modo red identificado.
export const BENCHMARKING_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'foundation_director',
  'school_admin',
  'academic_director',
  'cycle_director',
  'eval_coordinator',
];

// Roles que pueden gatillar el refresh del read-model cross-tenant (operación global).
export const BENCHMARKING_ADMIN_ROLES: readonly UserRole[] = ['platform_admin'];

// ── F2 S5 — Gating de tier pago (H18.1) y Observabilidad IA (H19.25) ──────────
// Roles que pueden GESTIONAR el plan/features pagas de una org. Es una decisión
// de facturación a nivel plataforma → sólo platform_admin (un school_admin no
// debería habilitarse features pagas a sí mismo).
export const FEATURE_MANAGEMENT_ROLES: readonly UserRole[] = ['platform_admin'];

// Roles que pueden ver el panel de observabilidad de costo/latencia IA. Es
// información de gasto/facturación → directivos, no profesores.
export const AI_OBSERVABILITY_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

// Roles que pueden configurar qué modelo/proveedor de IA usa cada funcionalidad
// (panel /configuracion/modelos-ia). Hoy la config es GLOBAL (afecta a todas las
// orgs) → sólo platform_admin, igual que FEATURE_MANAGEMENT_ROLES. Cuando pase a
// per-org se sumará school_admin (sólo sobre las filas de su org).
export const LLM_SETTINGS_ROLES: readonly UserRole[] = ['platform_admin'];

// ── Informes oficiales (TKT-24/25/26) ─────────────────────────────────────────
// Roles que pueden ver/generar los informes oficiales por curso (TKT-24) y por
// estudiante (TKT-26). Mismo conjunto que los resultados: el scoping por curso
// para profesores lo aplica el service (un profesor sólo ve sus cursos/alumnos).
export const OFFICIAL_REPORT_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver el informe AGREGADO de establecimiento (TKT-25). Es una
// vista macro de toda la organización (no PII, sólo % y conteos) → directivos y
// coordinadores, NO profesores (que sólo tienen alcance de sus cursos).
export const ESTABLISHMENT_REPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

// ── E21 — Asistente IA Conversacional ────────────────────────────────────────
// Roles que pueden usar el asistente conversacional (v1 = solo directivos, por
// minimización de superficie de PII; los profesores entran en v2 con scoping por
// curso). El gating de tier pago lo aplica además @RequireFeature('ai_assistant').
export const ASSISTANT_USER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
];
