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
  classGroups,
  grades,
  orgMemberships,
  organizations,
  subjectClasses,
  subjects,
  users,
  withOrgContext,
} from '@soe/db';
import type { AcademicSetupDto, UpdateOrganizationProfileDto } from '@soe/types';
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
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, orgId), eq(organizations.type, 'school')));

      if (!org) throw new NotFoundException('Colegio no encontrado');

      await tx
        .update(organizations)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    });

    return this.getProfile(orgId);
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
