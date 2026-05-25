import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  classGroups,
  grades,
  orgMemberships,
  subjectClasses,
  subjects,
  teacherAssignments,
  users,
} from '@soe/db';
import type {
  CreateTeacherAssignmentDto,
  ListTeacherAssignmentsQuery,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class TeacherAssignmentsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(orgId: string, filters: ListTeacherAssignmentsQuery) {
    const conditions = [eq(classGroups.orgId, orgId)];
    if (filters.classGroupId) {
      conditions.push(eq(classGroups.id, filters.classGroupId));
    }
    if (filters.subjectId) {
      conditions.push(eq(subjectClasses.subjectId, filters.subjectId));
    }
    if (filters.userId) {
      conditions.push(eq(teacherAssignments.userId, filters.userId));
    }

    const rows = await this.db
      .select({
        id: teacherAssignments.id,
        role: teacherAssignments.role,
        createdAt: teacherAssignments.createdAt,
        teacherId: users.id,
        teacherName: users.name,
        teacherEmail: users.email,
        subjectClassId: subjectClasses.id,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeShortName: grades.shortName,
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
      })
      .from(teacherAssignments)
      .innerJoin(users, eq(users.id, teacherAssignments.userId))
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
      .where(and(...conditions))
      .orderBy(grades.order, classGroups.name, subjects.name);

    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      createdAt: r.createdAt,
      teacher: {
        id: r.teacherId,
        name: r.teacherName,
        email: r.teacherEmail,
      },
      subjectClass: {
        id: r.subjectClassId,
        classGroup: {
          id: r.classGroupId,
          name: r.classGroupName,
          gradeShortName: r.gradeShortName,
        },
        subject: {
          id: r.subjectId,
          name: r.subjectName,
          shortName: r.subjectShortName,
        },
      },
    }));
  }

  async create(orgId: string, dto: CreateTeacherAssignmentDto) {
    // 1. El usuario debe tener membership activa en la org.
    const [membership] = await this.db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.userId, dto.userId),
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.isActive, true),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new BadRequestException('El usuario no pertenece a esta organización');
    }
    if (!['teacher', 'homeroom_teacher', 'eval_coordinator'].includes(membership.role)) {
      throw new BadRequestException(
        'Solo profesores, profesores jefes o coordinadores de evaluación pueden ser asignados',
      );
    }

    // 2. El subject_class debe pertenecer a la org (via class_groups.org_id).
    const [subjectClass] = await this.db
      .select({ id: subjectClasses.id })
      .from(subjectClasses)
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(and(eq(subjectClasses.id, dto.subjectClassId), eq(classGroups.orgId, orgId)))
      .limit(1);

    if (!subjectClass) {
      throw new NotFoundException('Asignatura/curso no encontrado en esta organización');
    }

    // 3. Si role='primary', detectar conflicto con otro primary existente.
    if (dto.role === 'primary') {
      const [existingPrimary] = await this.db
        .select({ id: teacherAssignments.id, userId: users.id, name: users.name })
        .from(teacherAssignments)
        .innerJoin(users, eq(users.id, teacherAssignments.userId))
        .where(
          and(
            eq(teacherAssignments.subjectClassId, dto.subjectClassId),
            eq(teacherAssignments.role, 'primary'),
          ),
        )
        .limit(1);

      if (existingPrimary && existingPrimary.userId !== dto.userId) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'PRIMARY_EXISTS',
          message: `Ya existe un profesor titular para esta asignatura: ${existingPrimary.name}`,
          currentPrimary: { id: existingPrimary.userId, name: existingPrimary.name },
        });
      }
    }

    // 4. Insertar (el unique (user_id, subject_class_id) previene duplicados exactos).
    try {
      const [created] = await this.db
        .insert(teacherAssignments)
        .values({
          userId: dto.userId,
          subjectClassId: dto.subjectClassId,
          role: dto.role,
        })
        .returning();
      return created;
    } catch (err) {
      // unique_violation = 23505
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
        throw new ConflictException('Este profesor ya está asignado a esta asignatura');
      }
      throw err;
    }
  }

  async remove(orgId: string, assignmentId: string) {
    // Verificar que la asignación pertenece a la org antes de borrar.
    const [row] = await this.db
      .select({ id: teacherAssignments.id })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(and(eq(teacherAssignments.id, assignmentId), eq(classGroups.orgId, orgId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Asignación no encontrada');
    }

    // Borrar solo la fila — evaluaciones/respuestas históricas no tienen FK contra
    // teacher_assignments, por lo que quedan intactas.
    await this.db.delete(teacherAssignments).where(eq(teacherAssignments.id, assignmentId));
  }
}
