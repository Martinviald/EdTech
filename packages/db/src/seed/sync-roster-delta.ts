/**
 * Sincroniza el roster de un (año × grado) contra una nómina actualizada: da de alta a los
 * alumnos nuevos, mueve a los que cambiaron de sección y marca como RETIRADOS a los que ya
 * no aparecen.
 *
 * Existe porque `import-cscj-roster.ts` sólo carga altas (`status: 'active'`) y no sabe qué
 * hacer con los que salieron: cargar la nómina nueva con él dejaría a los retirados activos
 * para siempre.
 *
 * ⚠️ **Nunca borra alumnos.** Un alumno retirado conserva sus respuestas y sus resultados
 * (Ley 19.628 y, más práctico: son datos de evaluaciones ya rendidas). Lo que cambia es la
 * MATRÍCULA: `student_enrollments.status = 'withdrawn'` + `withdrawn_at`.
 *
 * Dry-run por defecto; escribe sólo con `--commit`.
 *
 *   DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx src/seed/sync-roster-delta.ts \
 *     --org=<uuid> --year=2026 --grade=4TH_MEDIO --input=<artefacto.json> [--commit]
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { withOrgContext } from '../with-org-context';
import { academicYears } from '../schema/organizations';
import { classGroups, grades } from '../schema/academic';
import { studentEnrollments, students } from '../schema/students';

type Registro = {
  rut: string;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F' | 'unspecified';
  birthDate: string | null;
  gradeCode: string;
  section: string;
};

const arg = (n: string, d = '') =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const COMMIT = process.argv.includes('--commit');

const ORG_ID = arg('org');
const YEAR = Number(arg('year'));
const GRADE = arg('grade');
const INPUT = arg('input');
if (!ORG_ID || !YEAR || !GRADE || !INPUT) {
  throw new Error('Faltan --org, --year, --grade o --input');
}

/** Un RUT sin puntos ni guion y en mayúsculas; el dígito verificador K se conserva. */
const canon = (r: string | null) => (r ?? '').toUpperCase().replace(/[.\-]/g, '');

export async function syncRosterDelta(db: Database): Promise<void> {
  const { records } = JSON.parse(readFileSync(resolve(INPUT), 'utf-8')) as { records: Registro[] };
  const nomina = new Map(records.map((r) => [canon(r.rut), r]));

  const [ay] = await db.select({ id: academicYears.id }).from(academicYears)
    .where(and(eq(academicYears.orgId, ORG_ID), eq(academicYears.year, YEAR)));
  if (!ay) throw new Error(`No existe el año académico ${YEAR} para la org`);
  const [grade] = await db.select({ id: grades.id }).from(grades).where(eq(grades.code, GRADE));
  if (!grade) throw new Error(`No existe el grado ${GRADE}`);

  const cgs = await db.select({ id: classGroups.id, name: classGroups.name }).from(classGroups)
    .where(and(eq(classGroups.orgId, ORG_ID), eq(classGroups.academicYearId, ay.id),
               eq(classGroups.gradeId, grade.id)));
  const cgPorNombre = new Map(cgs.map((c) => [c.name, c.id]));
  const cgPorId = new Map(cgs.map((c) => [c.id, c.name]));

  await withOrgContext(db, ORG_ID, async (tx) => {
    const actuales = await tx
      .select({
        studentId: students.id, rut: students.rut,
        enrollmentId: studentEnrollments.id, classGroupId: studentEnrollments.classGroupId,
        status: studentEnrollments.status,
      })
      .from(students)
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, students.id))
      .where(and(eq(students.orgId, ORG_ID), eq(studentEnrollments.academicYearId, ay.id),
                 inArray(studentEnrollments.classGroupId, cgs.map((c) => c.id))));

    const enBdd = new Map(actuales.map((a) => [canon(a.rut), a]));

    const altas = records.filter((r) => !enBdd.has(canon(r.rut)));
    const movidos = records.flatMap((r) => {
      const a = enBdd.get(canon(r.rut));
      if (!a) return [];
      const destino = cgPorNombre.get(r.section);
      return destino && destino !== a.classGroupId
        ? [{ ...a, destino, desde: cgPorId.get(a.classGroupId) ?? '?', hacia: r.section }]
        : [];
    });
    const retirados = actuales.filter(
      (a) => !nomina.has(canon(a.rut)) && a.status === 'active',
    );

    console.log(`nómina ${records.length} · en BDD ${actuales.length}`);
    console.log(`  altas: ${altas.length} → ${altas.map((a) => `${a.rut}(${a.section})`).join(' ')}`);
    console.log(`  cambios de sección: ${movidos.length} → ${movidos.map((m) => `${m.rut} ${m.desde}→${m.hacia}`).join(' ')}`);
    console.log(`  a retirar: ${retirados.length} → ${retirados.map((r) => `${r.rut}(${cgPorId.get(r.classGroupId)})`).join(' ')}`);

    if (!COMMIT) {
      console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)');
      return;
    }

    for (const r of altas) {
      const cgId = cgPorNombre.get(r.section);
      if (!cgId) { console.log(`  ⚠ sin class_group para la sección ${r.section}`); continue; }
      const [s] = await tx.insert(students)
        .values({ orgId: ORG_ID, rut: r.rut, firstName: r.firstName, lastName: r.lastName,
                  gender: r.gender, birthDate: r.birthDate })
        .onConflictDoUpdate({
          target: [students.orgId, students.rut],
          set: { firstName: sql`excluded.first_name`, lastName: sql`excluded.last_name`,
                 gender: sql`excluded.gender`, birthDate: sql`excluded.birth_date`,
                 deletedAt: null, updatedAt: new Date() },
        })
        .returning({ id: students.id });
      await tx.insert(studentEnrollments)
        .values({ studentId: s!.id, classGroupId: cgId, academicYearId: ay.id, status: 'active' })
        .onConflictDoUpdate({
          target: [studentEnrollments.studentId, studentEnrollments.academicYearId],
          set: { classGroupId: cgId, status: 'active', withdrawnAt: null },
        });
    }
    for (const m of movidos) {
      await tx.update(studentEnrollments)
        .set({ classGroupId: m.destino, status: 'active', withdrawnAt: null })
        .where(eq(studentEnrollments.id, m.enrollmentId));
    }
    for (const r of retirados) {
      await tx.update(studentEnrollments)
        .set({ status: 'withdrawn', withdrawnAt: new Date().toISOString().slice(0, 10) })
        .where(eq(studentEnrollments.id, r.enrollmentId));
    }
    console.log(`\n✅ ${altas.length} altas · ${movidos.length} movidos · ${retirados.length} retirados`);
  });
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  syncRosterDelta(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => { console.error('ERROR:', e); process.exit(1); });
}
