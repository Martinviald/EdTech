import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  classGroups,
  students,
} from '@soe/db';
import type { Database } from '../../database/database.types';

/**
 * Año académico de cada evaluación, derivado de los cursos a los que se asignó.
 *
 * `assessments` no guarda el año: lo aporta el curso que la rindió. Sirve para unir
 * un resultado con la matrícula CORRECTA de su alumno — `student_enrollments` es
 * única por (alumno, año), así que unir sin acotar el año duplica cada resultado
 * tantas veces como años lleva matriculado el alumno.
 */
export function assessmentAcademicYears(tx: Database) {
  const assignedClassGroup = alias(classGroups, 'assigned_class_group');
  return tx
    .selectDistinct({
      assessmentId: assessmentCourseAssignments.assessmentId,
      academicYearId: assignedClassGroup.academicYearId,
    })
    .from(assessmentCourseAssignments)
    .innerJoin(
      assignedClassGroup,
      eq(assignedClassGroup.id, assessmentCourseAssignments.classGroupId),
    )
    .as('assessment_academic_year');
}

/**
 * Los resultados del alcance como subconsulta con barrera de optimización.
 *
 * El `offset 0` no pagina nada: impide que Postgres suba esta subconsulta al plan de
 * afuera. Sin él, el filtro de RLS sobre `assessments` —un `current_setting()` que el
 * planificador no sabe estimar— lo hace creer que hay UNA fila, y entonces empieza por
 * las matrículas: 261 evaluaciones × 1.289 matrículas = 336.524 iteraciones para
 * encontrar 9.076 resultados. Medido contra la BDD demo con el rol de la API: 14 s con
 * la subconsulta suelta, 0,6 s con la barrera.
 *
 * Sólo aparece bajo RLS. Con un rol que lo bypassa (el admin de las migraciones) las
 * dos formas rinden igual, así que esto no se ve midiendo con el rol equivocado.
 *
 * El cast del `offset` es porque Drizzle tipa el parámetro como `number` y descarta el
 * literal 0 por falsy; con la expresión SQL sí lo emite.
 */
export function scopedAssessmentResults(tx: Database, assessmentIds: string[]) {
  return tx
    .select({
      assessmentId: assessmentResults.assessmentId,
      studentId: assessmentResults.studentId,
      percentage: assessmentResults.percentage,
      performanceBandId: assessmentResults.performanceBandId,
      priorPerformanceBandId: assessmentResults.priorPerformanceBandId,
      instrumentId: assessments.instrumentId,
    })
    .from(assessmentResults)
    .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
    .innerJoin(students, eq(students.id, assessmentResults.studentId))
    .where(and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)))
    .offset(sql`0` as unknown as number)
    .as('scoped_assessment_results');
}
