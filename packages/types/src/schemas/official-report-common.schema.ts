import { PERFORMANCE_LEVELS, type PerformanceLevel } from '../enums';

// ─────────────────────────────────────────────────────────────────────────────
// Informes oficiales (TKT-24/25/26) — modelos de datos compartidos
//
// Estos informes replican el FORMATO de los informes oficiales que los colegios
// reconocen (hoy: DIA), pero como PLANTILLA sobre datos genéricos. Nada aquí
// hardcodea "DIA"/"Lenguaje"/un grado: el momento (Diagnóstico/Monitoreo/Cierre)
// se lee de `assessments.config.period` (string genérico), los niveles de logro
// del enum `performance_level` (insufficient/elementary/adequate/advanced) que la
// plataforma ya calcula, y las asignaturas/grados/ejes de
// `subjects`/`grades`/`taxonomy_nodes` por ID. Extender a SIMCE/PAES/Cambridge no
// requiere cambios de schema, sólo nuevos registros de taxonomía.
//
// Nota: la plataforma modela el nivel de logro con el enum de 4 niveles
// (`performance_level`). Los informes oficiales DIA usan 3 niveles (I/II/III); el
// mapeo I/II/III lo aplica el frontend sobre estos 4 niveles (o, cuando en el
// futuro se configuren `performance_bands` por instrumento, se refinará al corte
// oficial exacto sin cambiar este contrato).
//
// Módulo backend: apps/api/src/official-reports/ (ruta base /api/reports).
// El scoping por rol lo aplica el service (directivo = toda la org; profesor =
// sólo sus cursos). El org_id SIEMPRE sale del token, nunca del query.
// ─────────────────────────────────────────────────────────────────────────────

/** Niveles de logro ordenados de menor a mayor (fila de las tablas de niveles). */
export const OFFICIAL_REPORT_LEVEL_ORDER: readonly PerformanceLevel[] = PERFORMANCE_LEVELS;

/** El nivel de logro más bajo → estudiantes que "requieren mayor apoyo". */
export const REQUIRES_SUPPORT_LEVEL: PerformanceLevel = 'insufficient';

/**
 * Variante del informe según el momento de la evaluación. Es sólo una PISTA de
 * presentación: el service SIEMPRE calcula ambos conjuntos de datos (nivel más
 * bajo / "requiere apoyo" y distribución por niveles de logro), y el frontend
 * decide qué destacar. No cambia el cálculo, sólo el énfasis del layout.
 * - `requires_support`: propio del Diagnóstico → se destaca el % de estudiantes
 *   en el nivel más bajo ("requieren mayor apoyo").
 * - `achievement_levels`: propio de Monitoreo/Cierre → se destaca la
 *   distribución por niveles de logro (torta).
 */
export const OFFICIAL_REPORT_VARIANTS = ['requires_support', 'achievement_levels'] as const;
export type OfficialReportVariant = (typeof OFFICIAL_REPORT_VARIANTS)[number];

/**
 * Ficha técnica / portada común a los tres informes oficiales. Los campos
 * específicos (curso, docente, alumno) se agregan en el meta de cada informe.
 *
 * `disclaimers` (recuadro "esta información NO DEBE usarse para…") se emite como
 * DATOS, no como copy hardcodeado: proviene de `instruments.config.reportDisclaimers`
 * (array de strings) si está definido; si no, es `[]` y el frontend inyecta la
 * copia oficial del instrumento en la capa de plantilla. Así el backend no
 * hardcodea texto legal de ningún instrumento concreto.
 */
export type OfficialReportMeta = {
  orgId: string;
  orgName: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  directorName: string | null; // mejor esfuerzo: membership academic_director/school_admin
  instrumentId: string;
  instrumentName: string;
  instrumentType: string; // instrument_type (dia | simce | paes | …) — nunca se ramifica lógica por su valor
  subjectId: string | null;
  subjectName: string | null;
  // Momento de la evaluación leído de `assessments.config.period` (genérico).
  period: string | null;
  periodLabel: string | null; // `config.periodLabel` si existe, si no humanizado de `period`
  year: number | null; // año del instrumento o de la evaluación
  generatedAt: string; // ISO — fecha/hora de generación del informe
  disclaimers: string[]; // recuadro de advertencias de uso (data-driven, ver arriba)
  variant: OfficialReportVariant;
};

export type { PerformanceLevel };
