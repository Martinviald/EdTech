import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  academicYears,
  classGroups,
  grades,
  subjectClasses,
  subjects,
  teacherAssignments,
} from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

const TEACHER_ROLES = ['teacher', 'homeroom_teacher'];

@Injectable()
export class ClassGroupsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Lista los class_groups visibles para el usuario en una organización.
   *  - Roles administrativos: ven todos los class_groups de la org.
   *  - Profesores (teacher / homeroom_teacher): solo ven aquellos donde tienen
   *    una asignación activa, devolviendo una fila por (curso × asignatura).
   */
  async listForUser(orgId: string, user: JwtPayload) {
    const isTeacherView = !user.isPlatformAdmin && TEACHER_ROLES.includes(user.role);

    if (isTeacherView) {
      return this.db
        .select({
          classGroupId: classGroups.id,
          className: classGroups.name,
          gradeShortName: grades.shortName,
          gradeOrder: grades.order,
          academicYear: academicYears.year,
          subjectClassId: subjectClasses.id,
          subjectId: subjects.id,
          subjectName: subjects.name,
          subjectShortName: subjects.shortName,
          assignmentRole: teacherAssignments.role,
        })
        .from(teacherAssignments)
        .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
        .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
        .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
        .where(
          and(
            eq(classGroups.orgId, orgId),
            eq(teacherAssignments.userId, user.userId),
          ),
        )
        .orderBy(grades.order, classGroups.name, subjects.name);
    }

    return this.db
      .select({
        classGroupId: classGroups.id,
        className: classGroups.name,
        gradeShortName: grades.shortName,
        gradeOrder: grades.order,
        academicYear: academicYears.year,
        subjectClassId: subjectClasses.id,
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
        assignmentRole: teacherAssignments.role,
      })
      .from(classGroups)
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .leftJoin(subjectClasses, eq(subjectClasses.classGroupId, classGroups.id))
      .leftJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
      .leftJoin(teacherAssignments, eq(teacherAssignments.subjectClassId, subjectClasses.id))
      .where(eq(classGroups.orgId, orgId))
      .orderBy(grades.order, classGroups.name, subjects.name);
  }
}
