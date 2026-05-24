import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  classGroups,
  grades,
  orgMemberships,
  organizations,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  teacherAssignments,
  users,
  withOrgContext,
} from '@soe/db';
import type {
  AcademicSetupDto,
  BulkAddSubjectsDto,
  CreateClassGroupDto,
  UpdateOrganizationProfileDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class OrganizationsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getProfile(orgId: string) {
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.type, 'school')));

    if (!org) throw new NotFoundException('Colegio no encontrado');
    return org;
  }

  async updateProfile(
    orgId: string,
    requestingOrgId: string,
    dto: UpdateOrganizationProfileDto,
  ) {
    if (orgId !== requestingOrgId) {
      throw new ForbiddenException('Solo puedes modificar tu propio colegio');
    }

    await withOrgContext(this.db, orgId, async (tx) => {
      const [org] = await tx
        .select({ id: organizations.id, type: organizations.type })
        .from(organizations)
        .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

      if (!org) throw new NotFoundException('Colegio no encontrado');

      // Cambiar el `type` mueve la org entre dominios (school↔foundation).
      // Solo se permite si la org está vacía: datos asociados (students,
      // class_groups) están modelados para escuelas y no aplican a fundaciones.
      if (dto.type && dto.type !== org.type) {
        const [{ studentCount } = { studentCount: 0 }] = await tx
          .select({ studentCount: count() })
          .from(students)
          .where(eq(students.orgId, orgId));
        const [{ classGroupCount } = { classGroupCount: 0 }] = await tx
          .select({ classGroupCount: count() })
          .from(classGroups)
          .where(eq(classGroups.orgId, orgId));

        if (studentCount > 0 || classGroupCount > 0) {
          throw new BadRequestException(
            `No se puede cambiar el tipo: el colegio tiene ${studentCount} alumno(s) y ${classGroupCount} curso(s) asociados.`,
          );
        }
      }

      await tx
        .update(organizations)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    });

    const [updated] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!updated) throw new NotFoundException('Colegio no encontrado');
    return updated;
  }

  /** Soft-delete del colegio (setea deleted_at). Idempotente. Solo platform_admin. */
  async softDelete(orgId: string) {
    const [org] = await this.db
      .select({ id: organizations.id, deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('Colegio no encontrado');
    if (org.deletedAt) return { ok: true, alreadyDeleted: true };

    await this.db
      .update(organizations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
    return { ok: true, alreadyDeleted: false };
  }

  /** Restaura un colegio soft-deleted. Idempotente. */
  async restore(orgId: string) {
    const [org] = await this.db
      .select({ id: organizations.id, deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('Colegio no encontrado');
    if (!org.deletedAt) return { ok: true, alreadyActive: true };

    await this.db
      .update(organizations)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
    return { ok: true, alreadyActive: false };
  }

  async getOverview(orgId: string) {
    const currentYear = new Date().getFullYear();

    const [org] = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.type, 'school')));

    if (!org) throw new NotFoundException('Colegio no encontrado');

    const [academicYear] = await this.db
      .select({ id: academicYears.id, year: academicYears.year })
      .from(academicYears)
      .where(and(eq(academicYears.orgId, orgId), eq(academicYears.year, currentYear)))
      .limit(1);

    const classGroupCount = academicYear
      ? await this.db
          .select({ total: count() })
          .from(classGroups)
          .where(
            and(
              eq(classGroups.orgId, orgId),
              eq(classGroups.academicYearId, academicYear.id),
            ),
          )
          .then((rows) => rows[0]?.total ?? 0)
      : 0;

    return {
      org,
      academicYear: academicYear ?? null,
      classGroupCount,
      isSetupComplete: !!academicYear && classGroupCount > 0,
    };
  }

  async listGrades() {
    return this.db
      .select()
      .from(grades)
      .orderBy(grades.order);
  }

  async listSubjects() {
    return this.db
      .select()
      .from(subjects)
      .orderBy(subjects.name);
  }

  /**
   * Lista los usuarios elegibles para ser asignados como profesores en una org.
   * Incluye memberships activas con rol docente; excluye invitaciones pendientes
   * (user_id IS NULL) porque aún no tienen un usuario al cual asignar carga.
   */
  async listTeachers(orgId: string) {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: orgMemberships.role,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.isActive, true),
          inArray(orgMemberships.role, ['teacher', 'homeroom_teacher', 'eval_coordinator']),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.name);
  }

  /**
   * Lista las subject_classes del año académico vigente de la org, con su
   * class_group y subject expandidos. Si no hay año vigente, retorna vacío.
   */
  async listSubjectClasses(orgId: string) {
    // Si por inconsistencia hay >1 academic_year con is_current=true, tomar el
    // más reciente. En estado válido solo hay uno; el desempate evita que el
    // resultado dependa del orden físico de las filas.
    const [currentYear] = await this.db
      .select({ id: academicYears.id, year: academicYears.year })
      .from(academicYears)
      .where(and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true)))
      .orderBy(desc(academicYears.createdAt))
      .limit(1);

    if (!currentYear) return [];

    const rows = await this.db
      .select({
        id: subjectClasses.id,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeShortName: grades.shortName,
        gradeOrder: grades.order,
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
      })
      .from(subjectClasses)
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
      .where(
        and(
          eq(classGroups.orgId, orgId),
          eq(subjectClasses.academicYearId, currentYear.id),
        ),
      )
      .orderBy(grades.order, classGroups.name, subjects.name);

    return rows.map((r) => ({
      id: r.id,
      academicYear: currentYear.year,
      classGroup: {
        id: r.classGroupId,
        name: r.classGroupName,
        gradeShortName: r.gradeShortName,
        gradeOrder: r.gradeOrder,
      },
      subject: {
        id: r.subjectId,
        name: r.subjectName,
        shortName: r.subjectShortName,
      },
    }));
  }

  /**
   * Devuelve la matriz de cursos × asignaturas del año vigente: la lista global
   * de subjects, los class_groups del año, y los subject_classes existentes para
   * que el frontend pinte los checks activos.
   */
  async getSubjectMatrix(orgId: string) {
    const academicYear = await this.findCurrentAcademicYear(orgId);
    const allSubjectsList = await this.listSubjects();
    if (!academicYear) {
      return {
        academicYear: null,
        classGroups: [] as Array<{
          id: string;
          name: string;
          gradeShortName: string;
          gradeName: string;
          gradeOrder: number;
        }>,
        allSubjects: allSubjectsList,
        cells: [] as Array<{ classGroupId: string; subjectId: string; subjectClassId: string }>,
      };
    }

    const classGroupRows = await this.db
      .select({
        id: classGroups.id,
        name: classGroups.name,
        gradeShortName: grades.shortName,
        gradeName: grades.name,
        gradeOrder: grades.order,
      })
      .from(classGroups)
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(
        and(eq(classGroups.orgId, orgId), eq(classGroups.academicYearId, academicYear.id)),
      )
      .orderBy(grades.order, classGroups.name);

    const cells = await this.db
      .select({
        subjectClassId: subjectClasses.id,
        classGroupId: subjectClasses.classGroupId,
        subjectId: subjectClasses.subjectId,
      })
      .from(subjectClasses)
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(
        and(eq(classGroups.orgId, orgId), eq(subjectClasses.academicYearId, academicYear.id)),
      );

    return {
      academicYear,
      classGroups: classGroupRows,
      allSubjects: allSubjectsList,
      cells,
    };
  }

  /**
   * Crea subject_classes para TODOS los class_groups del año vigente y los
   * subjectIds indicados. Idempotente (ON CONFLICT DO NOTHING).
   */
  async bulkAddSubjects(orgId: string, dto: BulkAddSubjectsDto) {
    const academicYear = await this.requireCurrentAcademicYear(orgId);

    const validSubjects = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(inArray(subjects.id, dto.subjectIds));
    if (validSubjects.length !== dto.subjectIds.length) {
      throw new BadRequestException('Una o más asignaturas no existen');
    }

    const cgRows = await this.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(
        and(eq(classGroups.orgId, orgId), eq(classGroups.academicYearId, academicYear.id)),
      );
    if (cgRows.length === 0) {
      throw new BadRequestException(
        'El año vigente no tiene cursos. Configurá primero los cursos del colegio.',
      );
    }

    const values = cgRows.flatMap((cg) =>
      dto.subjectIds.map((subjectId) => ({
        classGroupId: cg.id,
        subjectId,
        academicYearId: academicYear.id,
      })),
    );

    let created = 0;
    await withOrgContext(this.db, orgId, async (tx) => {
      const inserted = await tx
        .insert(subjectClasses)
        .values(values)
        .onConflictDoNothing({
          target: [
            subjectClasses.classGroupId,
            subjectClasses.subjectId,
            subjectClasses.academicYearId,
          ],
        })
        .returning({ id: subjectClasses.id });
      created = inserted.length;
    });

    return {
      created,
      alreadyExisting: values.length - created,
      total: values.length,
    };
  }

  async addSubjectToClassGroup(orgId: string, classGroupId: string, subjectId: string) {
    const academicYear = await this.requireCurrentAcademicYear(orgId);

    const [cg] = await this.db
      .select({ id: classGroups.id, academicYearId: classGroups.academicYearId })
      .from(classGroups)
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)));
    if (!cg) throw new NotFoundException('Curso no encontrado');
    if (cg.academicYearId !== academicYear.id) {
      throw new BadRequestException('El curso no pertenece al año académico vigente');
    }

    const [subject] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId));
    if (!subject) throw new NotFoundException('Asignatura no encontrada');

    let result: { id: string };
    await withOrgContext(this.db, orgId, async (tx) => {
      const [inserted] = await tx
        .insert(subjectClasses)
        .values({ classGroupId, subjectId, academicYearId: academicYear.id })
        .onConflictDoNothing({
          target: [
            subjectClasses.classGroupId,
            subjectClasses.subjectId,
            subjectClasses.academicYearId,
          ],
        })
        .returning({ id: subjectClasses.id });

      if (inserted) {
        result = inserted;
        return;
      }
      // Ya existía: devolver el id existente.
      const [existing] = await tx
        .select({ id: subjectClasses.id })
        .from(subjectClasses)
        .where(
          and(
            eq(subjectClasses.classGroupId, classGroupId),
            eq(subjectClasses.subjectId, subjectId),
            eq(subjectClasses.academicYearId, academicYear.id),
          ),
        );
      if (!existing) throw new Error('subject_classes upsert sin returning ni fallback');
      result = existing;
    });
    return result!;
  }

  /**
   * Elimina un subject_class. Rechaza si hay teacher_assignments asociadas
   * (porque CASCADE las borraría silenciosamente — preferimos error explícito).
   */
  async removeSubjectClass(orgId: string, subjectClassId: string) {
    const [sc] = await this.db
      .select({
        id: subjectClasses.id,
        classGroupId: subjectClasses.classGroupId,
      })
      .from(subjectClasses)
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(and(eq(subjectClasses.id, subjectClassId), eq(classGroups.orgId, orgId)));
    if (!sc) throw new NotFoundException('Asignación de asignatura no encontrada');

    const [{ assignmentsCount } = { assignmentsCount: 0 }] = await this.db
      .select({ assignmentsCount: count() })
      .from(teacherAssignments)
      .where(eq(teacherAssignments.subjectClassId, subjectClassId));
    if (assignmentsCount > 0) {
      throw new ConflictException({
        code: 'HAS_TEACHER_ASSIGNMENTS',
        message: `No se puede eliminar: hay ${assignmentsCount} profesor(es) asignado(s). Quitalos primero desde Asignaciones.`,
      });
    }

    await withOrgContext(this.db, orgId, async (tx) => {
      await tx.delete(subjectClasses).where(eq(subjectClasses.id, subjectClassId));
    });
    return { ok: true };
  }

  /**
   * Crea un class_group nuevo en el año vigente y replica los subject_classes
   * que la org ya tiene configurados para ese año. Mismo patrón que
   * `students-import.service.ts` usa al auto-crear cursos por CSV.
   */
  async createClassGroup(orgId: string, dto: CreateClassGroupDto) {
    const academicYear = await this.requireCurrentAcademicYear(orgId);

    const [grade] = await this.db
      .select({ id: grades.id })
      .from(grades)
      .where(eq(grades.id, dto.gradeId));
    if (!grade) throw new BadRequestException('Nivel no encontrado');

    const [duplicate] = await this.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(
        and(
          eq(classGroups.orgId, orgId),
          eq(classGroups.academicYearId, academicYear.id),
          eq(classGroups.gradeId, dto.gradeId),
          eq(classGroups.name, dto.name),
        ),
      );
    if (duplicate) {
      throw new ConflictException(
        `Ya existe un curso con esa sección para el nivel y año seleccionados.`,
      );
    }

    let createdRow: { id: string };
    await withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(classGroups)
        .values({
          orgId,
          academicYearId: academicYear.id,
          gradeId: dto.gradeId,
          name: dto.name,
        })
        .returning({ id: classGroups.id });
      if (!row) throw new Error('classGroups insert returned no row');
      createdRow = row;

      // Replica subject_classes ya configurados para el año.
      const configuredSubjectIds = await tx
        .selectDistinct({ subjectId: subjectClasses.subjectId })
        .from(subjectClasses)
        .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
        .where(
          and(
            eq(classGroups.orgId, orgId),
            eq(subjectClasses.academicYearId, academicYear.id),
          ),
        )
        .then((rows) => rows.map((r) => r.subjectId));

      if (configuredSubjectIds.length > 0) {
        await tx.insert(subjectClasses).values(
          configuredSubjectIds.map((subjectId) => ({
            classGroupId: row.id,
            subjectId,
            academicYearId: academicYear.id,
          })),
        );
      }
    });
    return createdRow!;
  }

  /**
   * Borra un class_group del año vigente. Rechaza si hay enrollments,
   * teacher_assignments o assessment_course_assignments asociados.
   */
  async deleteClassGroup(orgId: string, classGroupId: string) {
    const [cg] = await this.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)));
    if (!cg) throw new NotFoundException('Curso no encontrado');

    const [{ enrollmentsCount } = { enrollmentsCount: 0 }] = await this.db
      .select({ enrollmentsCount: count() })
      .from(studentEnrollments)
      .where(eq(studentEnrollments.classGroupId, classGroupId));

    const [{ assignmentsCount } = { assignmentsCount: 0 }] = await this.db
      .select({ assignmentsCount: count() })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .where(eq(subjectClasses.classGroupId, classGroupId));

    const [{ assessmentsCount } = { assessmentsCount: 0 }] = await this.db
      .select({ assessmentsCount: count() })
      .from(assessmentCourseAssignments)
      .where(eq(assessmentCourseAssignments.classGroupId, classGroupId));

    if (enrollmentsCount > 0 || assignmentsCount > 0 || assessmentsCount > 0) {
      throw new ConflictException({
        code: 'CLASS_GROUP_HAS_DATA',
        message: 'No se puede eliminar el curso: tiene datos asociados.',
        details: { enrollmentsCount, assignmentsCount, assessmentsCount },
      });
    }

    await withOrgContext(this.db, orgId, async (tx) => {
      // CASCADE en subject_classes via FK.
      await tx.delete(classGroups).where(eq(classGroups.id, classGroupId));
    });
    return { ok: true };
  }

  private async findCurrentAcademicYear(orgId: string) {
    const [row] = await this.db
      .select({ id: academicYears.id, year: academicYears.year })
      .from(academicYears)
      .where(and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true)))
      .orderBy(desc(academicYears.createdAt))
      .limit(1);
    return row ?? null;
  }

  private async requireCurrentAcademicYear(orgId: string) {
    const row = await this.findCurrentAcademicYear(orgId);
    if (!row) {
      throw new BadRequestException(
        'El colegio no tiene un año académico vigente configurado.',
      );
    }
    return row;
  }

  async setupAcademicYear(
    orgId: string,
    requestingOrgId: string,
    dto: AcademicSetupDto,
  ) {
    if (orgId !== requestingOrgId) {
      throw new ForbiddenException('Solo puedes configurar tu propio colegio');
    }

    // Verificar que los gradeIds existen
    const gradeIds = dto.classGroups.map((cg) => cg.gradeId);
    const existingGrades = await this.db
      .select({ id: grades.id })
      .from(grades)
      .where(inArray(grades.id, gradeIds));

    if (existingGrades.length !== gradeIds.length) {
      throw new BadRequestException('Uno o más niveles no son válidos');
    }

    // Verificar que los subjectIds existen
    const existingSubjects = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(inArray(subjects.id, dto.subjectIds));

    if (existingSubjects.length !== dto.subjectIds.length) {
      throw new BadRequestException('Una o más asignaturas no son válidas');
    }

    let classGroupsCreated = 0;
    let subjectClassesCreated = 0;
    let academicYearId: string;

    await withOrgContext(this.db, orgId, async (tx) => {
      // Verificar que no existe ya un año académico para ese año
      const [existing] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(and(eq(academicYears.orgId, orgId), eq(academicYears.year, dto.year)));

      if (existing) {
        throw new ConflictException(`El año académico ${dto.year} ya está configurado`);
      }

      // Crear año académico
      const [newAcademicYear] = await tx
        .insert(academicYears)
        .values({
          orgId,
          year: dto.year,
          isCurrent: true,
        })
        .returning({ id: academicYears.id });

      academicYearId = newAcademicYear.id;

      // Crear classGroups y subjectClasses por cada nivel/sección
      for (const cgInput of dto.classGroups) {
        for (const sectionName of cgInput.sections) {
          const [newGroup] = await tx
            .insert(classGroups)
            .values({
              orgId,
              academicYearId,
              gradeId: cgInput.gradeId,
              name: sectionName,
            })
            .returning({ id: classGroups.id });

          classGroupsCreated++;

          // Crear subjectClass por cada asignatura seleccionada
          if (dto.subjectIds.length > 0) {
            await tx.insert(subjectClasses).values(
              dto.subjectIds.map((subjectId) => ({
                classGroupId: newGroup.id,
                subjectId,
                academicYearId,
              })),
            );
            subjectClassesCreated += dto.subjectIds.length;
          }
        }
      }
    });

    return {
      academicYearId: academicYearId!,
      year: dto.year,
      classGroupsCreated,
      subjectClassesCreated,
    };
  }
}
