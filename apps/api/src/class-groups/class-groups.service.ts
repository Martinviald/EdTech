import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  academicYears,
  classGroups,
  grades,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  teacherAssignments,
  users,
} from '@soe/db';
import {
  TEACHER_ROLES,
  type ClassGroupDetailResponse,
  type ClassGroupSubject,
  type TeacherAssignmentRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

const TEACHER_ROLE_VALUES: readonly TeacherAssignmentRole[] = ['primary', 'assistant'];

/**
 * Decide si el usuario ve la pestaña "Mis cursos" (filtrada por sus
 * asignaciones) o la vista administrativa (todos los cursos de la org).
 *
 * Esta es la ÚNICA excepción a la regla general de "guards autorizan por
 * unión de roles": acá decidimos en base al `activeRole`, no a la unión.
 * Motivo: un usuario que es teacher + academic_director debe poder alternar
 * entre la vista de admin y la de profesor cambiando el rol activo, no
 * estar forzado a una sola vista.
 */
function shouldShowTeacherView(user: JwtPayload): boolean {
  if (user.isPlatformAdmin) return false;
  return (TEACHER_ROLES as readonly string[]).includes(user.activeRole);
}

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
    const isTeacherView = shouldShowTeacherView(user);

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

  /**
   * Devuelve el detalle de un class_group: información básica, alumnos
   * matriculados activos del año académico de ese curso y asignaturas con sus
   * profesores asignados.
   *
   *  - Filtra multi-tenant por orgId (defensa en profundidad).
   *  - Si el usuario es profesor sin asignación en el curso → 404 (mismo
   *    código que "no existe" para no filtrar existencia entre orgs).
   */
  async getDetailForUser(
    orgId: string,
    classGroupId: string,
    user: JwtPayload,
  ): Promise<ClassGroupDetailResponse> {
    const [classGroupRow] = await this.db
      .select({
        id: classGroups.id,
        name: classGroups.name,
        academicYearId: classGroups.academicYearId,
        gradeShortName: grades.shortName,
        gradeName: grades.name,
        academicYear: academicYears.year,
      })
      .from(classGroups)
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
      .limit(1);

    if (!classGroupRow) {
      throw new NotFoundException('Curso no encontrado');
    }

    const isTeacherView = shouldShowTeacherView(user);
    if (isTeacherView) {
      const [assignment] = await this.db
        .select({ id: teacherAssignments.id })
        .from(teacherAssignments)
        .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
        .where(
          and(
            eq(teacherAssignments.userId, user.userId),
            eq(subjectClasses.classGroupId, classGroupId),
          ),
        )
        .limit(1);

      if (!assignment) {
        throw new NotFoundException('Curso no encontrado');
      }
    }

    const studentRows = await this.db
      .select({
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        rut: students.rut,
        enrollmentStatus: studentEnrollments.status,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          eq(studentEnrollments.classGroupId, classGroupId),
          eq(studentEnrollments.academicYearId, classGroupRow.academicYearId),
          eq(studentEnrollments.status, 'active'),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      )
      .orderBy(students.lastName, students.firstName);

    const subjectRows = await this.db
      .select({
        subjectClassId: subjectClasses.id,
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
        teacherUserId: users.id,
        teacherName: users.name,
        teacherRole: teacherAssignments.role,
      })
      .from(subjectClasses)
      .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
      .leftJoin(teacherAssignments, eq(teacherAssignments.subjectClassId, subjectClasses.id))
      .leftJoin(
        users,
        and(eq(users.id, teacherAssignments.userId), isNull(users.deletedAt)),
      )
      .where(eq(subjectClasses.classGroupId, classGroupId))
      .orderBy(subjects.name);

    const subjectsBySubjectClass = new Map<string, ClassGroupSubject>();
    for (const row of subjectRows) {
      let subject = subjectsBySubjectClass.get(row.subjectClassId);
      if (!subject) {
        subject = {
          subjectClassId: row.subjectClassId,
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          subjectShortName: row.subjectShortName,
          teachers: [],
        };
        subjectsBySubjectClass.set(row.subjectClassId, subject);
      }
      if (
        row.teacherUserId &&
        row.teacherName &&
        row.teacherRole &&
        (TEACHER_ROLE_VALUES as readonly string[]).includes(row.teacherRole)
      ) {
        subject.teachers.push({
          userId: row.teacherUserId,
          name: row.teacherName,
          role: row.teacherRole as TeacherAssignmentRole,
        });
      }
    }

    return {
      classGroup: {
        id: classGroupRow.id,
        name: classGroupRow.name,
        gradeShortName: classGroupRow.gradeShortName,
        gradeName: classGroupRow.gradeName,
        academicYear: classGroupRow.academicYear,
      },
      students: studentRows.map((s) => ({
        studentId: s.studentId,
        firstName: s.firstName,
        lastName: s.lastName,
        rut: s.rut,
        enrollmentStatus: s.enrollmentStatus,
      })),
      subjects: [...subjectsBySubjectClass.values()],
    };
  }
}
