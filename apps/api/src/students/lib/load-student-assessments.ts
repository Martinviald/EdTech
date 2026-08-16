// Carga los resultados de UN alumno a grano alumno × evaluación, con el instrumento,
// la asignatura, la familia comparable y su banda (propia o previa) ya resueltas a la
// forma `StudentPanoramaAssessment`. Es un data-access loader —toma el `tx` de la
// transacción y consulta `assessment_results`/`assessments`/`instruments` bajo RLS— así
// que DEBE invocarse dentro de un `withOrgContext(...)`.
//
// Vive aquí —y no como método privado de `StudentPanoramaService`— porque lo reutilizan
// dos servicios: el Panorama (`student-panorama.service.ts`) y las Comparativas 360
// (`student-comparisons.service.ts`). Es el punto único donde vive esta lectura; ninguno
// re-deriva la forma de la fila por su cuenta (`03-helpers-vs-services.md`: lógica
// reutilizada entre archivos → su propio módulo, no duplicar).

import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  assessmentResults,
  assessments,
  instruments,
  performanceBands,
  subjects,
} from '@soe/db';
import {
  buildInstrumentFamilyKey,
  buildPeriodSeriesKey,
  type ComparabilityInstrumentRef,
  type DataGranularity,
  type PerformanceBandView,
  type StudentPanoramaAssessment,
} from '@soe/types';
import type { Database } from '../../database/database.types';

function toBandView(r: {
  bandKey: string | null;
  bandLabel: string | null;
  bandOrder: number | null;
  bandColor: string | null;
}): PerformanceBandView | null {
  if (r.bandKey === null || r.bandLabel === null || r.bandOrder === null) return null;
  return { key: r.bandKey, label: r.bandLabel, order: r.bandOrder, color: r.bandColor };
}

export async function loadStudentAssessments(
  tx: Database,
  orgId: string,
  studentId: string,
): Promise<StudentPanoramaAssessment[]> {
  const priorBands = alias(performanceBands, 'prior_performance_bands');

  const rows = await tx
    .select({
      assessmentId: assessments.id,
      assessmentName: assessments.name,
      instrumentId: instruments.id,
      instrumentName: instruments.name,
      instrumentType: instruments.type,
      subjectId: instruments.subjectId,
      subjectName: subjects.name,
      gradeId: instruments.gradeId,
      year: instruments.year,
      applicationPeriod: instruments.applicationPeriod,
      administeredAt: assessments.administeredAt,
      dataGranularity: assessments.dataGranularity,
      achievement: assessmentResults.percentage,
      grade: assessmentResults.grade,
      performanceLevel: assessmentResults.performanceLevel,
      bandKey: performanceBands.key,
      bandLabel: performanceBands.label,
      bandOrder: performanceBands.order,
      bandColor: performanceBands.color,
      priorBandKey: priorBands.key,
      priorBandLabel: priorBands.label,
      priorBandOrder: priorBands.order,
      priorBandColor: priorBands.color,
    })
    .from(assessmentResults)
    .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
    .leftJoin(performanceBands, eq(performanceBands.id, assessmentResults.performanceBandId))
    .leftJoin(priorBands, eq(priorBands.id, assessmentResults.priorPerformanceBandId))
    .where(
      and(
        eq(assessmentResults.studentId, studentId),
        eq(assessments.orgId, orgId),
        isNull(instruments.deletedAt),
      ),
    )
    .orderBy(asc(assessments.administeredAt), asc(assessments.createdAt));

  return rows.map((r) => {
    const ref: ComparabilityInstrumentRef = {
      instrumentId: r.instrumentId,
      type: r.instrumentType,
      subjectId: r.subjectId,
      gradeId: r.gradeId,
      applicationPeriod: r.applicationPeriod,
      year: r.year,
    };
    return {
      assessmentId: r.assessmentId,
      assessmentName: r.assessmentName,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      instrumentType: r.instrumentType,
      subjectId: r.subjectId,
      subjectName: r.subjectName,
      gradeId: r.gradeId,
      year: r.year,
      applicationPeriod: r.applicationPeriod,
      familyKey: buildInstrumentFamilyKey(ref),
      periodSeriesKey: buildPeriodSeriesKey(ref),
      administeredAt: r.administeredAt,
      dataGranularity: r.dataGranularity as DataGranularity,
      achievement: r.achievement === null ? null : Number(r.achievement),
      grade: r.grade,
      performanceLevel: r.performanceLevel,
      performanceBand: toBandView(r),
      priorPerformanceBand: toBandView({
        bandKey: r.priorBandKey,
        bandLabel: r.priorBandLabel,
        bandOrder: r.priorBandOrder,
        bandColor: r.priorBandColor,
      }),
    };
  });
}
