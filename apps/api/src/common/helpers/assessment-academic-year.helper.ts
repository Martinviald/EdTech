import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { assessmentCourseAssignments, classGroups } from '@soe/db';
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
