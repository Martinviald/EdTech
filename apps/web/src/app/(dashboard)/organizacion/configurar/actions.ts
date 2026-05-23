'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, withOrgContext } from '@soe/db';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import {
  updateOrganizationProfileSchema,
  academicSetupSchema,
} from '@soe/types';
import type { UpdateOrganizationProfileDto, AcademicSetupDto } from '@soe/types';

async function getSession() {
  const session = await auth();
  if (!session?.user?.orgId) throw new Error('No autenticado');
  return session.user;
}

export async function updateOrgProfile(dto: UpdateOrganizationProfileDto) {
  const user = await getSession();

  const validated = updateOrganizationProfileSchema.parse(dto);

  await withOrgContext(db, user.orgId, async (tx) => {
    const [org] = await tx
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(
        and(
          eq(schema.organizations.id, user.orgId),
          eq(schema.organizations.type, 'school'),
        ),
      );

    if (!org) throw new Error('Colegio no encontrado');

    await tx
      .update(schema.organizations)
      .set({ ...validated, updatedAt: new Date() })
      .where(eq(schema.organizations.id, user.orgId));
  });

  revalidatePath('/organizacion');
}

export async function setupAcademicYear(dto: AcademicSetupDto) {
  const user = await getSession();

  const validated = academicSetupSchema.parse(dto);

  const gradeIds = validated.classGroups.map((cg) => cg.gradeId);
  const existingGrades = await db
    .select({ id: schema.grades.id })
    .from(schema.grades)
    .where(inArray(schema.grades.id, gradeIds));

  if (existingGrades.length !== gradeIds.length) {
    throw new Error('Uno o más niveles no son válidos');
  }

  const existingSubjects = await db
    .select({ id: schema.subjects.id })
    .from(schema.subjects)
    .where(inArray(schema.subjects.id, validated.subjectIds));

  if (existingSubjects.length !== validated.subjectIds.length) {
    throw new Error('Una o más asignaturas no son válidas');
  }

  let classGroupsCreated = 0;
  let subjectClassesCreated = 0;
  let academicYearId = '';

  await withOrgContext(db, user.orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.academicYears.id })
      .from(schema.academicYears)
      .where(
        and(
          eq(schema.academicYears.orgId, user.orgId),
          eq(schema.academicYears.year, validated.year),
        ),
      );

    if (existing) {
      throw new Error(`El año académico ${validated.year} ya está configurado`);
    }

    const [newYear] = await tx
      .insert(schema.academicYears)
      .values({ orgId: user.orgId, year: validated.year, isCurrent: true })
      .returning({ id: schema.academicYears.id });

    if (!newYear) throw new Error('Error al crear el año académico');
    academicYearId = newYear.id;

    for (const cgInput of validated.classGroups) {
      for (const sectionName of cgInput.sections) {
        const [newGroup] = await tx
          .insert(schema.classGroups)
          .values({
            orgId: user.orgId,
            academicYearId,
            gradeId: cgInput.gradeId,
            name: sectionName,
          })
          .returning({ id: schema.classGroups.id });

        if (!newGroup) throw new Error('Error al crear el curso');

        classGroupsCreated++;

        if (validated.subjectIds.length > 0) {
          await tx.insert(schema.subjectClasses).values(
            validated.subjectIds.map((subjectId) => ({
              classGroupId: newGroup.id,
              subjectId,
              academicYearId,
            })),
          );
          subjectClassesCreated += validated.subjectIds.length;
        }
      }
    }
  });

  revalidatePath('/organizacion');

  return { academicYearId, classGroupsCreated, subjectClassesCreated };
}
