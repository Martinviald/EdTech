// Resuelve, para un alumno, su banda de logro del instrumento y su nivel legacy
// (4 niveles) a partir de las bandas cargadas del instrumento. Es el núcleo por
// alumno de `AssessmentReportService.hydrateBands`, extraído aquí para que el
// informe oficial (`CourseReportService`) derive el nivel con EXACTAMENTE la
// misma lógica (DRY) y ambos no discrepen.
//
// Dos ramas:
//  - Dato granular (`percentage` presente): clasifica por umbral, como siempre.
//    No toca `performanceLevel` (se deriva del % en otra capa).
//  - Dato agregado band-only: la fila trae `performanceBandId` pero sin
//    `percentage` ni `performanceLevel` (lo que escribe el importador de
//    informes oficiales con `metric_type='band'`). Deriva el nivel legacy desde
//    la banda guardada. Es, por construcción, la única fila que cae en esta rama:
//    exige las tres condiciones a la vez (sin %, sin nivel, con banda).

import { bandToLegacyLevel, classifyByBands } from '@soe/types';
import type { PerformanceBandInput, PerformanceLevel } from '@soe/types';

export type BandHydrationInput = {
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
  if (student.percentage !== null) {
    return {
      band: classifyByBands(student.percentage / 100, bands),
      performanceLevel: student.performanceLevel,
    };
  }
  if (student.performanceLevel !== null || student.performanceBandId === null) {
    return { band: null, performanceLevel: student.performanceLevel };
  }
  const band = bands.find((b) => b.id === student.performanceBandId) ?? null;
  if (!band) return { band: null, performanceLevel: student.performanceLevel };
  return { band, performanceLevel: bandToLegacyLevel(band, bands) };
}
