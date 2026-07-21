// Resuelve, para un alumno, su banda de logro del instrumento y su nivel legacy
// (4 niveles) a partir de las bandas cargadas del instrumento. Es el núcleo por
// alumno de `AssessmentReportService.hydrateBands`, extraído aquí para que el
// informe oficial (`CourseReportService`) derive el nivel con EXACTAMENTE la
// misma lógica (DRY) y ambos no discrepen.
//
// La prioridad es **band-autoritativa por `metricType`**:
//  - `metricType === 'band'`: la fila representa una banda ya decidida (lo que
//    escribe el importador/backfill de informes oficiales). El nivel se deriva de
//    la banda guardada, IGNORANDO `percentage`. Esto cubre dos casos:
//      · Monitoreo/Cierre band-only: `percentage` NULL, `performanceBandId` seteado
//        → nivel desde la banda.
//      · Diagnóstico: `percentage` = posición APROXIMADA (no un score que se pueda
//        re-clasificar) + `performanceBandId` = banda "requiere mayor apoyo" (Nivel I)
//        cuando corresponde, o NULL si no requiere apoyo → nivel desde la banda (o
//        null si no hay banda). La banda importada manda sobre el % aproximado.
//    Sin `performanceBandId`, el nivel queda no determinado (null).
//  - `metricType !== 'band'` (`percentage`/`scaled`, p.ej. item_level): clasifica por
//    umbral sobre `percentage`, como siempre. No toca `performanceLevel` (se deriva
//    del % en otra capa).

import { bandToLegacyLevel, classifyByBands } from '@soe/types';
import type { MetricType, PerformanceBandInput, PerformanceLevel } from '@soe/types';

export type BandHydrationInput = {
  metricType: MetricType;
  percentage: number | null;
  performanceLevel: PerformanceLevel | null;
  performanceBandId: string | null;
};

export type BandHydrationResult = {
  band: PerformanceBandInput | null;
  performanceLevel: PerformanceLevel | null;
};

/**
 * Devuelve la banda y el nivel resueltos para un alumno. Sin bandas o cuando la
 * fila no cae en ninguna rama, retorna la banda en null y el `performanceLevel`
 * de entrada sin tocar.
 */
export function hydrateBandForStudent(
  student: BandHydrationInput,
  bands: PerformanceBandInput[],
): BandHydrationResult {
  if (bands.length === 0) {
    return { band: null, performanceLevel: student.performanceLevel };
  }
  // Band-autoritativa: la banda guardada manda; `percentage` se ignora por completo
  // (en Diagnóstico es una posición aproximada, no un score clasificable).
  if (student.metricType === 'band') {
    if (student.performanceBandId === null) {
      return { band: null, performanceLevel: null };
    }
    const band = bands.find((b) => b.id === student.performanceBandId) ?? null;
    if (!band) return { band: null, performanceLevel: null };
    return { band, performanceLevel: bandToLegacyLevel(band, bands) };
  }
  // Dato granular (item_level): clasifica por umbral sobre el % del alumno.
  if (student.percentage !== null) {
    return {
      band: classifyByBands(student.percentage / 100, bands),
      performanceLevel: student.performanceLevel,
    };
  }
  return { band: null, performanceLevel: student.performanceLevel };
}
