/**
 * Carga del roster real 2025 del Colegio Sagrado Corazón de La Reina (CSCJ).
 *
 * Lee el artefacto JSON producido por `scripts/cscj/01-extract-roster.cjs`
 * (extracción + validación + inferencia ya aplicadas) y lo persiste de forma
 * IDEMPOTENTE. No vuelve a parsear el Excel: esta etapa solo escribe en BDD.
 *
 *   Dry-run (default):   tsx src/seed/import-cscj-roster.ts
 *   Commit real:         tsx src/seed/import-cscj-roster.ts --commit
 *
 * Decisiones: alcance COMPLETO (género, fecha nac.), SOLO ACTIVOS, INFERIR Y
 * MARCAR (las marcas quedan en students.profile.sensitiveNotes).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { and, eq, sql } from 'drizzle-orm';
import { createDbClient } from '../client';
import { withOrgContext } from '../with-org-context';
import { organizations, academicYears } from '../schema/organizations';
import { grades, classGroups } from '../schema/academic';
import { students, studentEnrollments } from '../schema/students';
import { importJobs } from '../schema/assessments';

config({ path: resolve(__dirname, '../../../../.env') });

// UUIDs determinísticos (solo hex) para idempotencia y referencia desde tests.
const FOUNDATION_ID = 'c5c10000-0000-0000-0000-0000000000f0';
const SCHOOL_ID = 'c5c10000-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_2025_ID = 'c5c10000-0000-0000-0000-000000002025';
const IMPORT_USER_ID: string | null = null; // carga operativa, sin usuario creador

type LoadRecord = {
  rut: string;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F' | 'unspecified';
  birthDate: string | null;
  gradeCode: string;
  section: string;
  status: 'active';
  needsReview: boolean;
  marks: string[];
};

const COMMIT = process.argv.includes('--commit');
const ARTIFACT = resolve(__dirname, '../../../../scripts/cscj/out/roster-active.json');

// Grados de preescolar que el seed base no incluye (el parser ya los espera).
const PRESCHOOL_GRADES = [
  { name: 'Pre-Kínder', shortName: 'PK', code: 'PRE_KINDER', cycle: 0, order: -1 },
  { name: 'Kínder', shortName: 'K', code: 'KINDER', cycle: 0, order: 0 },
];

const SCHOOL_CONFIG: Record<string, unknown> = {
  legalName: 'Fundación Educacional Tupungato',
  sostenedorRut: '65.135.369-6',
  address: 'Av. José Arrieta 8220',
  city: 'Santiago',
  phones: ['+56 2 2278 0472', '+56 2 2292 9965'],
  email: 'contacto@colegiosc.cl',
  website: 'https://www.colegiosc.cl',
  tipoEnsenanza: 'Humanístico-Científico Mixto',
  niveles: ['Pre-básica', 'Básica', 'Media'],
  jornada: 'Jornada escolar completa diurna',
  financiamiento: 'Particular subvencionado de financiamiento compartido',
  source: 'colegiosc.cl/informacion-util/antecedentes-generales',
};

async function main() {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  const records: LoadRecord[] = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  console.log(`\n=== CARGA ROSTER CSCJ 2025 (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  console.log(`Registros en artefacto: ${records.length}`);

  // Cursos únicos presentes en el roster.
  const courseKeys = new Map<string, { gradeCode: string; section: string }>();
  for (const r of records) {
    const k = `${r.gradeCode}|${r.section}`;
    if (!courseKeys.has(k)) courseKeys.set(k, { gradeCode: r.gradeCode, section: r.section });
  }
  console.log(`Cursos (class_groups) requeridos: ${courseKeys.size}`);

  if (!COMMIT) {
    // Resolver grados solo para validar que todos los gradeCode existen/existirán.
    const existing = await db.select({ code: grades.code }).from(grades);
    const haveCodes = new Set(existing.map((g) => g.code).concat(PRESCHOOL_GRADES.map((g) => g.code)));
    const missing = [...new Set(records.map((r) => r.gradeCode))].filter((c) => !haveCodes.has(c));
    console.log('Grados faltantes (tras agregar PK/K):', missing.length ? missing.join(', ') : 'ninguno');
    console.log('Marcados para revisión (se cargarán con nota):', records.filter((r) => r.needsReview).length);
    console.log('\nDRY-RUN: no se escribió nada. Re-ejecuta con --commit para persistir.');
    await db.$client.end();
    return;
  }

  // ---------- 1) Sostenedor (foundation) + Colegio (school) ----------
  await db
    .insert(organizations)
    .values({ id: FOUNDATION_ID, type: 'foundation', name: 'Fundación Educacional Tupungato', config: { rut: '65.135.369-6' } })
    .onConflictDoNothing();

  await db
    .insert(organizations)
    .values({
      id: SCHOOL_ID,
      type: 'school',
      parentId: FOUNDATION_ID,
      name: 'Colegio Sagrado Corazón de La Reina',
      rbd: '25520-3',
      commune: 'La Reina',
      region: 'Metropolitana',
      dependence: 'particular_subvencionado',
      config: SCHOOL_CONFIG,
    })
    .onConflictDoNothing();

  // ---------- 2) Año académico 2025 (vigente) ----------
  const [existingYear] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(and(eq(academicYears.orgId, SCHOOL_ID), eq(academicYears.year, 2025)))
    .limit(1);
  const academicYearId = existingYear?.id ?? ACADEMIC_YEAR_2025_ID;
  if (!existingYear) {
    await db
      .insert(academicYears)
      .values({ id: academicYearId, orgId: SCHOOL_ID, year: 2025, isCurrent: true })
      .onConflictDoNothing();
  }

  // ---------- 3) Grados PK/K (idempotente) ----------
  await db.insert(grades).values(PRESCHOOL_GRADES).onConflictDoNothing();

  // ---------- 4) Resolver grados -> id ----------
  const gradeRows = await db.select({ id: grades.id, code: grades.code }).from(grades);
  const gradeIdByCode = new Map(gradeRows.map((g) => [g.code, g.id]));
  for (const c of new Set(records.map((r) => r.gradeCode))) {
    if (!gradeIdByCode.has(c)) throw new Error(`Grado no resuelto: ${c}`);
  }

  // ---------- 5) class_groups (crear faltantes) ----------
  const existingCG = await db
    .select({ id: classGroups.id, gradeId: classGroups.gradeId, name: classGroups.name })
    .from(classGroups)
    .where(and(eq(classGroups.orgId, SCHOOL_ID), eq(classGroups.academicYearId, academicYearId)));
  const cgIdByKey = new Map<string, string>();
  for (const cg of existingCG) cgIdByKey.set(`${cg.gradeId}|${cg.name}`, cg.id);

  let cgCreated = 0;
  for (const { gradeCode, section } of courseKeys.values()) {
    const gradeId = gradeIdByCode.get(gradeCode)!;
    const key = `${gradeId}|${section}`;
    if (cgIdByKey.has(key)) continue;
    const [row] = await db
      .insert(classGroups)
      .values({ orgId: SCHOOL_ID, academicYearId, gradeId, name: section })
      .returning({ id: classGroups.id });
    cgIdByKey.set(key, row!.id);
    cgCreated++;
  }
  console.log(`class_groups creados: ${cgCreated} (existentes: ${existingCG.length})`);

  // ---------- 6) students + enrollments + import_job (dentro de RLS context) ----------
  let inserted = 0;
  let updated = 0;
  const jobId = await withOrgContext(db, SCHOOL_ID, async (tx) => {
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      const batch = records.slice(i, i + chunkSize);

      const upserted = await tx
        .insert(students)
        .values(
          batch.map((r) => ({
            orgId: SCHOOL_ID,
            rut: r.rut,
            firstName: r.firstName,
            lastName: r.lastName,
            gender: r.gender,
            birthDate: r.birthDate,
            profile: r.needsReview ? { sensitiveNotes: r.marks.join(' | ') } : undefined,
          })),
        )
        .onConflictDoUpdate({
          target: [students.orgId, students.rut],
          set: {
            firstName: sql`excluded.first_name`,
            lastName: sql`excluded.last_name`,
            gender: sql`excluded.gender`,
            birthDate: sql`excluded.birth_date`,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: students.id,
          rut: students.rut,
          createdAt: students.createdAt,
          updatedAt: students.updatedAt,
        });

      const idByRut = new Map<string, string>();
      for (const s of upserted) {
        idByRut.set(s.rut, s.id);
        if (s.createdAt.getTime() === s.updatedAt.getTime()) inserted++;
        else updated++;
      }

      const enrollmentValues = batch.map((r) => {
        const gradeId = gradeIdByCode.get(r.gradeCode)!;
        const classGroupId = cgIdByKey.get(`${gradeId}|${r.section}`)!;
        return {
          studentId: idByRut.get(r.rut)!,
          classGroupId,
          academicYearId,
          status: 'active' as const,
        };
      });

      await tx
        .insert(studentEnrollments)
        .values(enrollmentValues)
        .onConflictDoUpdate({
          target: [studentEnrollments.studentId, studentEnrollments.academicYearId],
          set: {
            classGroupId: sql`excluded.class_group_id`,
            status: sql`excluded.status`,
          },
        });
    }

    const [job] = await tx
      .insert(importJobs)
      .values({
        orgId: SCHOOL_ID,
        type: 'student_roster',
        status: 'completed',
        fileUrl: null,
        mappingConfig: { source: 'docs/Listas de curso CSCJ/Cursos 2025.xlsx', stage: 'cscj-roster-2025' },
        result: { rowsProcessed: records.length, errors: 0, warnings: records.filter((r) => r.needsReview).length },
        errorLog: [],
        createdById: IMPORT_USER_ID,
        completedAt: new Date(),
      })
      .returning({ id: importJobs.id });
    return job!.id;
  });

  console.log(`students -> insertados: ${inserted}, actualizados: ${updated}`);
  console.log(`import_job: ${jobId}`);
  console.log('=== CARGA COMPLETA ===');
  await db.$client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
