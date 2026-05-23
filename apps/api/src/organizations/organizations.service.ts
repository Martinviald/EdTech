import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  academicYears,
  classGroups,
  grades,
  organizations,
  subjectClasses,
  subjects,
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
