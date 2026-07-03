import { config } from 'dotenv';
import { resolve } from 'path';
import { and, eq } from 'drizzle-orm';
import { createDbClient } from '../client';
import { classGroups, grades, subjectClasses, subjects } from '../schema/academic';
import { academicYears, organizations } from '../schema/organizations';
import { students } from '../schema/students';
import { orgMemberships, teacherAssignments, users } from '../schema/users';
import { platformAdmins } from '../schema/platform-admins';
import { seedTaxonomyReal } from './taxonomy-real';
import { importInstruments } from './import-instruments';
import { applyItemTags } from './import-item-tags';

config({ path: resolve(__dirname, '../../../../.env') });

// UUIDs determinísticos para el entorno demo.
// Permiten referenciar org, usuarios y alumnos desde tests y mock auth sin lookups.
// Nota: los UUIDs solo aceptan dígitos hex (0-9, a-f).
export const DEMO_ORG_ID = 'dec00000-0000-0000-0000-000000000001';
export const DEMO_ORG2_ID = 'dec00000-0000-0000-0000-000000000002';
const DEMO_USER_IDS = {
  admin: 'dec00000-0000-0000-0000-0000000000a1',
  director: 'dec00000-0000-0000-0000-0000000000d1',
  teacher: 'dec00000-0000-0000-0000-0000000000c1',
} as const;
const DEMO2_USER_IDS = {
  admin: 'dec00000-0000-0000-0000-0000000000a2',
} as const;

export const DEMO_STUDENT_IDS = {
  juan: 'dec00000-0000-0000-0000-000000000051',
  maria: 'dec00000-0000-0000-0000-000000000052',
  pedro: 'dec00000-0000-0000-0000-000000000053',
} as const;

// Año académico + curso + asignaturas demo. Permiten que el seed deje una
// asignación docente lista para probar el scoping por rol en /my-classes.
export const DEMO_ACADEMIC_YEAR_ID = 'dec00000-0000-0000-0000-000000000071';
export const DEMO_CLASS_GROUP_ID = 'dec00000-0000-0000-0000-000000000072';
export const DEMO_SUBJECT_CLASS_LANG_ID = 'dec00000-0000-0000-0000-000000000073';
// Año vigente del segundo tenant, para que el usuario multi-org no aterrice en
// un estado sin configurar al cambiar a Colegio San Patricio.
export const DEMO_ORG2_ACADEMIC_YEAR_ID = 'dec00000-0000-0000-0000-000000000074';

// Platform admins: operadores de la plataforma con acceso global, sin membership de colegio.
export const PLATFORM_ADMIN_USER_IDS = {
  demoSuperAdmin: 'dec00000-0000-0000-0000-0000000000f1',
  mvial: 'dec00000-0000-0000-0000-0000000000f2',
} as const;

const PLATFORM_ADMINS = [
  {
    id: PLATFORM_ADMIN_USER_IDS.demoSuperAdmin,
    email: 'superadmin.demo@soe.cl',
    name: 'Super Admin Demo',
    notes: 'Cuenta demo de plataforma',
  },
  {
    id: PLATFORM_ADMIN_USER_IDS.mvial,
    email: 'mvial@cscj.cl',
    name: 'Martín Vial',
    notes: 'Founder / operador principal',
  },
];

export const DEMO_USERS = [
  {
    id: DEMO_USER_IDS.admin,
    email: 'admin.demo@colegiodemo.cl',
    name: 'Admin Demo',
    role: 'school_admin' as const,
  },
  {
    id: DEMO_USER_IDS.director,
    email: 'director.demo@colegiodemo.cl',
    name: 'Director Demo',
    role: 'academic_director' as const,
  },
  {
    id: DEMO_USER_IDS.teacher,
    email: 'profesor.demo@colegiodemo.cl',
    name: 'Profesor Demo',
    role: 'teacher' as const,
  },
];

async function main() {
  // El seed inserta en tablas con RLS+FORCE sin contexto de org: usa el rol
  // privilegiado (DATABASE_ADMIN_URL) que bypassa RLS. Cae a DATABASE_URL en dev.
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  }

  const db = createDbClient(databaseUrl);

  console.log('Seeding grades...');
  await db
    .insert(grades)
    .values([
      { name: '1° Básico', shortName: '1B', code: '1RD_BASIC', cycle: 1, order: 1 },
      { name: '2° Básico', shortName: '2B', code: '2ND_BASIC', cycle: 1, order: 2 },
      { name: '3° Básico', shortName: '3B', code: '3RD_BASIC', cycle: 1, order: 3 },
      { name: '4° Básico', shortName: '4B', code: '4TH_BASIC', cycle: 1, order: 4 },
      { name: '5° Básico', shortName: '5B', code: '5TH_BASIC', cycle: 2, order: 5 },
      { name: '6° Básico', shortName: '6B', code: '6TH_BASIC', cycle: 2, order: 6 },
      { name: '7° Básico', shortName: '7B', code: '7TH_BASIC', cycle: 2, order: 7 },
      { name: '8° Básico', shortName: '8B', code: '8TH_BASIC', cycle: 2, order: 8 },
      { name: '1° Medio', shortName: '1M', code: '1ST_MEDIO', cycle: 3, order: 9 },
      { name: '2° Medio', shortName: '2M', code: '2ND_MEDIO', cycle: 3, order: 10 },
      { name: '3° Medio', shortName: '3M', code: '3RD_MEDIO', cycle: 3, order: 11 },
      { name: '4° Medio', shortName: '4M', code: '4TH_MEDIO', cycle: 3, order: 12 },
    ])
    .onConflictDoNothing();

  console.log('Seeding subjects...');
  await db
    .insert(subjects)
    .values([
      { name: 'Lenguaje y Comunicación', shortName: 'Lenguaje', code: 'LANG' },
      { name: 'Matemáticas', shortName: 'Matemáticas', code: 'MATH' },
      { name: 'Ciencias Naturales', shortName: 'Ciencias', code: 'SCI' },
      { name: 'Historia, Geografía y Cs. Sociales', shortName: 'Historia', code: 'HIST' },
      { name: 'Inglés', shortName: 'Inglés', code: 'ENG' },
    ])
    .onConflictDoNothing();

  // Taxonomía REAL en 2 marcos (Currículum Nacional universal + DIA), reference-data
  // idempotente. Reemplaza la antigua siembra IA (mineduc-2024.json + skills inline).
  console.log('Seeding taxonomía real (Currículum Nacional + DIA)...');
  await seedTaxonomyReal(db);

  // Instrumentos + ítems reales (DIA 2025, 24 con-pauta) + sus tags de taxonomía.
  // Reference-data idempotente; reemplaza cualquier import previo por config.sourceJson.
  console.log('Importando instrumentos + ítems reales (DIA 2025)...');
  await importInstruments(db);
  await applyItemTags(db);

  // -------- Demo tenant para mock auth y validación end-to-end --------
  console.log('Seeding Colegio Demo...');
  await db
    .insert(organizations)
    .values({
      id: DEMO_ORG_ID,
      type: 'school',
      name: 'Colegio Demo',
      rbd: '00000-0',
    })
    .onConflictDoNothing();

  console.log('Seeding demo users...');
  await db
    .insert(users)
    .values(
      DEMO_USERS.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        provider: 'google' as const,
        providerId: `seed-${u.role}`,
      })),
    )
    .onConflictDoNothing();

  console.log('Seeding demo memberships...');
  await db
    .insert(orgMemberships)
    .values(
      DEMO_USERS.map((u) => ({
        userId: u.id,
        orgId: DEMO_ORG_ID,
        role: u.role,
        isActive: true,
      })),
    )
    .onConflictDoNothing();

  // -------- Segundo tenant para testing multi-tenancy --------
  console.log('Seeding Colegio San Patricio...');
  await db
    .insert(organizations)
    .values({
      id: DEMO_ORG2_ID,
      type: 'school',
      name: 'Colegio San Patricio',
      rbd: '00001-0',
    })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: DEMO2_USER_IDS.admin,
      email: 'admin@sanpatricio.cl',
      name: 'Admin San Patricio',
      provider: 'google' as const,
      providerId: 'seed-school_admin-org2',
    })
    .onConflictDoNothing();

  await db
    .insert(orgMemberships)
    .values({
      userId: DEMO2_USER_IDS.admin,
      orgId: DEMO_ORG2_ID,
      role: 'school_admin',
      isActive: true,
    })
    .onConflictDoNothing();

  // -------- Usuario multi-org para testear el selector de organización --------
  // Admin Demo pertenece a AMBOS colegios, con distinto rol en cada uno:
  // school_admin en Colegio Demo y academic_director en San Patricio. Al iniciar
  // sesión aterriza en Colegio Demo (rol de mayor jerarquía) y, vía el selector
  // "Cambiar colegio", puede saltar a San Patricio — donde roles y permisos se
  // recalculan a academic_director. Login mock: admin.demo@colegiodemo.cl.
  console.log('Seeding membership multi-org (Admin Demo también en San Patricio)...');
  await db
    .insert(orgMemberships)
    .values({
      userId: DEMO_USER_IDS.admin,
      orgId: DEMO_ORG2_ID,
      role: 'academic_director',
      isActive: true,
    })
    .onConflictDoNothing();

  // Año académico vigente de San Patricio para que la vista directiva del
  // segundo colegio tenga contexto y no caiga en el wizard de configuración.
  await db
    .insert(academicYears)
    .values({
      id: DEMO_ORG2_ACADEMIC_YEAR_ID,
      orgId: DEMO_ORG2_ID,
      year: 2026,
      isCurrent: true,
    })
    .onConflictDoNothing();

  console.log('Seeding platform admins...');
  await db
    .insert(users)
    .values(
      PLATFORM_ADMINS.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        provider: 'google' as const,
        providerId: `seed-platform-admin-${a.id.slice(-2)}`,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(platformAdmins)
    .values(
      PLATFORM_ADMINS.map((a) => ({
        userId: a.id,
        notes: a.notes,
      })),
    )
    .onConflictDoNothing();

  console.log('Seeding demo academic year + class group + subject classes...');
  // Reutilizar el academic_year vigente si la org ya fue configurada vía wizard.
  // Solo crear DEMO_ACADEMIC_YEAR_ID cuando la org está virgen para evitar
  // dejar dos academic_years current en paralelo (que rompe el scoping del UI).
  let demoAcademicYearId: string;
  const [existingCurrentYear] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(and(eq(academicYears.orgId, DEMO_ORG_ID), eq(academicYears.isCurrent, true)))
    .limit(1);

  if (existingCurrentYear) {
    demoAcademicYearId = existingCurrentYear.id;
  } else {
    await db
      .insert(academicYears)
      .values({
        id: DEMO_ACADEMIC_YEAR_ID,
        orgId: DEMO_ORG_ID,
        year: 2026,
        isCurrent: true,
      })
      .onConflictDoNothing();
    demoAcademicYearId = DEMO_ACADEMIC_YEAR_ID;
  }

  // Asegurar que exista al menos un subject_class de Lenguaje en ese año para
  // poder asignar al profesor demo. Si la org ya fue configurada vía wizard,
  // usar el primer subject_class de Lenguaje existente; si no, crear el demo.
  const [lang] = await db.select().from(subjects).where(eq(subjects.code, 'LANG'));
  let demoSubjectClassId: string | null = null;
  if (lang) {
    const [existingSubjectClass] = await db
      .select({ id: subjectClasses.id })
      .from(subjectClasses)
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(
        and(
          eq(classGroups.orgId, DEMO_ORG_ID),
          eq(subjectClasses.academicYearId, demoAcademicYearId),
          eq(subjectClasses.subjectId, lang.id),
        ),
      )
      .limit(1);

    if (existingSubjectClass) {
      demoSubjectClassId = existingSubjectClass.id;
    } else {
      const [firstMedio] = await db.select().from(grades).where(eq(grades.code, '1ST_MEDIO'));
      if (firstMedio) {
        await db
          .insert(classGroups)
          .values({
            id: DEMO_CLASS_GROUP_ID,
            orgId: DEMO_ORG_ID,
            academicYearId: demoAcademicYearId,
            gradeId: firstMedio.id,
            name: '1° Medio B',
          })
          .onConflictDoNothing();

        await db
          .insert(subjectClasses)
          .values({
            id: DEMO_SUBJECT_CLASS_LANG_ID,
            classGroupId: DEMO_CLASS_GROUP_ID,
            subjectId: lang.id,
            academicYearId: demoAcademicYearId,
          })
          .onConflictDoNothing();
        demoSubjectClassId = DEMO_SUBJECT_CLASS_LANG_ID;
      }
    }
  }

  if (demoSubjectClassId) {
    console.log('Seeding demo teacher assignment...');
    await db
      .insert(teacherAssignments)
      .values({
        userId: DEMO_USER_IDS.teacher,
        subjectClassId: demoSubjectClassId,
        role: 'primary',
      })
      .onConflictDoNothing();
  }

  console.log('Seeding demo students...');
  await db
    .insert(students)
    .values([
      {
        id: DEMO_STUDENT_IDS.juan,
        orgId: DEMO_ORG_ID,
        rut: '12345678-9',
        firstName: 'Juan',
        lastName: 'Pérez',
        gender: 'M',
        profile: { nee: ['dislexia'], sensitiveNotes: 'Apoyo psicopedagógico semanal' },
      },
      {
        id: DEMO_STUDENT_IDS.maria,
        orgId: DEMO_ORG_ID,
        rut: '98765432-1',
        firstName: 'María',
        lastName: 'González',
        gender: 'F',
        profile: {},
      },
      {
        id: DEMO_STUDENT_IDS.pedro,
        orgId: DEMO_ORG_ID,
        rut: '11111111-1',
        firstName: 'Pedro',
        lastName: 'Soto',
        gender: 'M',
        profile: {},
      },
    ])
    .onConflictDoNothing();

  console.log('Seed completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
