import type { AssistantContextRef } from '@soe/types';
import type { DashboardFilterValues } from './dashboard-filters';

/**
 * Traduce los filtros activos del dashboard de resultados a refs de contexto del
 * asistente embebido (E21). Solo los filtros que son UUID se vuelven refs;
 * `instrumentType` es texto (no un identificador de entidad) → se omite. Pura y
 * sin `'use client'` para que las páginas (Server Components) la usen directo.
 */
export function dashboardFiltersToAssistantRefs(f: DashboardFilterValues): AssistantContextRef[] {
  const refs: AssistantContextRef[] = [];
  if (f.subjectId) refs.push({ kind: 'subject', id: f.subjectId });
  if (f.gradeId) refs.push({ kind: 'grade', id: f.gradeId });
  if (f.classGroupId) refs.push({ kind: 'classGroup', id: f.classGroupId });
  if (f.studentId) refs.push({ kind: 'student', id: f.studentId });
  if (f.academicYearId) refs.push({ kind: 'academicYear', id: f.academicYearId });
  return refs;
}
