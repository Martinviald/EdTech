/**
 * Carga de la planta docente (asignaciones curso × asignatura × profesor y
 * jefaturas de curso) desde el artefacto JSON producido por
 * `scripts/cscj/planta-docente/01-extract-planta.cjs`.
 *
 * No vuelve a parsear el Excel: esta etapa sólo escribe en BDD, de forma
 * IDEMPOTENTE (la unique `(user_id, subject_class_id)` de `teacher_assignments`
 * y `(user_id, org_id, role)` de `org_memberships` hacen el trabajo).
 *
 *   Dry-run (default):  tsx src/seed/import-planta-docente.ts --org <uuid> --year 2026
 *   Commit real:        tsx src/seed/import-planta-docente.ts --org <uuid> --year 2026 --commit
 *
 * Decisiones (docs/diseno-alcance-docente.md):
 *  - Sólo las 5 asignaturas evaluadas; el resto de la planta es descarte
 *    esperado y ya quedó fuera en la extracción.
 *  - Un docente sin `users` se registra como invitación pendiente
 *    (`org_memberships` con `user_id NULL` + email), soportado por el schema.
 *  - Las jefaturas se cargan como membership `homeroom_teacher`; el alcance
 *    transversal del jefe de curso se deriva de ese rol, no de subject_classes.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createDbClient } from '../client';
import { academicYears } from '../schema/organizations';
import { classGroups, grades, subjectClasses, subjects } from '../schema/academic';
import { orgMemberships, teacherAssignments, users } from '../schema/users';

config({ path: resolve(__dirname, '../../../../.env') });

type Assignment = {
  gradeCode: string;
  section: string;
  subjectCode: string;
  teacher: string;
  email: string;
};
type Homeroom = { gradeCode: string; section: string; teacher: string; email: string | null };
type Artifact = {
  year: number;
  assignments: Assignment[];
  homerooms: Homeroom[];
  discarded: Array<{ reason: string }>;
  unmapped: unknown[];
};

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.split('=').slice(1).join('=') : fallback;
};

const COMMIT = args.includes('--commit');
/**
 * Crea la fila `users` de cada docente en vez de dejarlo como invitación
 * pendiente. Necesario para poder asignarle cursos: `teacher_assignments.user_id`
 * es NOT NULL, así que sin usuario no hay asignación posible.
 */
const CREATE_USERS = args.includes('--create-users');
const ORG_ID = opt('org');
const YEAR = Number(opt('year', '2026'));
const ARTIFACT = resolve(
  __dirname,
  '../../../../scripts/cscj/planta-docente/out/planta-docente.json',
);

/**
 * UUID determinista a partir del correo: la misma planta re-importada produce
 * los mismos ids, así que la carga es idempotente y las asignaciones no se
 * duplican ni quedan huérfanas entre corridas.
 */
function userIdFromEmail(email: string): string {
  const h = createHash('sha256').update(`planta-docente:${email.toLowerCase()}`).digest('hex');
  // Variante/versión fijas para que sea un UUID válido (v4-shaped, no aleatorio).
  const v = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return v;
}

async function main() {
  if (!ORG_ID) throw new Error('--org <uuid> es requerido');
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  const art: Artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  console.log(`\n=== PLANTA DOCENTE ${YEAR} (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  console.log(`Asignaciones en artefacto: ${art.assignments.length}`);
  console.log(`Jefaturas en artefacto:    ${art.homerooms.length}`);
  console.log(`Descartes esperados:       ${art.discarded.length} (política, no error)`);
  if (art.unmapped.length > 0) {
    console.log(
      `\n⚠️  ${art.unmapped.length} filas SIN MAPEAR en el artefacto — revisa la extracción.`,
    );
  }

  // ── Resolución de catálogos ────────────────────────────────────────────────
  const [year] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(and(eq(academicYears.orgId, ORG_ID), eq(academicYears.year, YEAR)))
    .limit(1);
  if (!year) throw new Error(`No existe academic_year ${YEAR} para la org ${ORG_ID}`);

  const gradeIdByCode = new Map(
    (await db.select({ id: grades.id, code: grades.code }).from(grades)).map((g) => [g.code, g.id]),
  );
  const subjectIdByCode = new Map(
    (await db.select({ id: subjects.id, code: subjects.code }).from(subjects)).map((s) => [
      s.code,
      s.id,
    ]),
  );
  const cgRows = await db
    .select({ id: classGroups.id, gradeId: classGroups.gradeId, name: classGroups.name })
    .from(classGroups)
    .where(and(eq(classGroups.orgId, ORG_ID), eq(classGroups.academicYearId, year.id)));
  const cgIdByKey = new Map(cgRows.map((c) => [`${c.gradeId}|${c.name}`, c.id]));

  const emails = [
    ...new Set([
      ...art.assignments.map((a) => a.email),
      ...art.homerooms.map((h) => h.email).filter((e): e is string => !!e),
    ]),
  ];
  // Nombre a mostrar de cada docente, tomado de la planta (la primera aparición).
  const nameByEmail = new Map<string, string>();
  for (const a of art.assignments)
    if (!nameByEmail.has(a.email)) nameByEmail.set(a.email, a.teacher);
  for (const h of art.homerooms) {
    if (h.email && !nameByEmail.has(h.email)) nameByEmail.set(h.email, h.teacher);
  }

  const userRows = emails.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(inArray(users.email, emails), isNull(users.deletedAt)))
    : [];
  const userIdByEmail = new Map(userRows.map((u) => [u.email.toLowerCase(), u.id]));

  // ── Diagnóstico previo ─────────────────────────────────────────────────────
  const classGroupKey = (a: { gradeCode: string; section: string }): string | null => {
    const gradeId = gradeIdByCode.get(a.gradeCode);
    return gradeId ? `${gradeId}|${a.section}` : null;
  };
  const missingCourses = new Set<string>();
  const missingSubjects = new Set<string>();
  for (const a of art.assignments) {
    const key = classGroupKey(a);
    if (!key || !cgIdByKey.has(key)) missingCourses.add(`${a.gradeCode} ${a.section}`);
    if (!subjectIdByCode.has(a.subjectCode)) missingSubjects.add(a.subjectCode);
  }
  const knownUsers = emails.filter((e) => userIdByEmail.has(e)).length;

  console.log(`\nAño académico:      ${YEAR} (${year.id})`);
  console.log(`Cursos existentes:  ${cgRows.length}`);
  console.log(
    `Docentes distintos: ${emails.length} (con usuario: ${knownUsers}, por invitar: ${emails.length - knownUsers})`,
  );
  if (missingSubjects.size > 0) {
    throw new Error(`Asignaturas ausentes del catálogo: ${[...missingSubjects].join(', ')}`);
  }
  if (missingCourses.size > 0) {
    console.log(
      `\n⚠️  Cursos del artefacto que NO existen en la org (se omiten): ${missingCourses.size}`,
    );
    for (const c of [...missingCourses].slice(0, 20)) console.log('   ', c);
  }

  // subject_classes requeridos (curso × asignatura × año)
  const requiredSC = new Map<string, { classGroupId: string; subjectId: string }>();
  for (const a of art.assignments) {
    const key = classGroupKey(a);
    const classGroupId = key ? cgIdByKey.get(key) : undefined;
    const subjectId = subjectIdByCode.get(a.subjectCode);
    if (!classGroupId || !subjectId) continue;
    requiredSC.set(`${classGroupId}|${subjectId}`, { classGroupId, subjectId });
  }

  const existingSC = await db
    .select({
      id: subjectClasses.id,
      classGroupId: subjectClasses.classGroupId,
      subjectId: subjectClasses.subjectId,
    })
    .from(subjectClasses)
    .where(eq(subjectClasses.academicYearId, year.id));
  const scIdByKey = new Map(existingSC.map((s) => [`${s.classGroupId}|${s.subjectId}`, s.id]));
  const scToCreate = [...requiredSC.values()].filter(
    (s) => !scIdByKey.has(`${s.classGroupId}|${s.subjectId}`),
  );

  console.log(
    `\nsubject_classes requeridos: ${requiredSC.size} (existentes: ${requiredSC.size - scToCreate.length}, a crear: ${scToCreate.length})`,
  );

  if (!COMMIT) {
    const faltantes = emails.filter((e) => !userIdByEmail.has(e)).length;
    console.log(
      CREATE_USERS
        ? `usuarios a crear: ${faltantes}`
        : `docentes sin usuario (quedarían como invitación, SIN cursos asignados): ${faltantes}`,
    );
    console.log('\nDRY-RUN: no se escribió nada. Re-ejecuta con --commit para persistir.');
    await db.$client.end();
    return;
  }

  // ── 1) subject_classes faltantes ───────────────────────────────────────────
  if (scToCreate.length > 0) {
    await db
      .insert(subjectClasses)
      .values(scToCreate.map((s) => ({ ...s, academicYearId: year.id })))
      .onConflictDoNothing();
    const refreshed = await db
      .select({
        id: subjectClasses.id,
        classGroupId: subjectClasses.classGroupId,
        subjectId: subjectClasses.subjectId,
      })
      .from(subjectClasses)
      .where(eq(subjectClasses.academicYearId, year.id));
    scIdByKey.clear();
    for (const s of refreshed) scIdByKey.set(`${s.classGroupId}|${s.subjectId}`, s.id);
  }
  console.log(`subject_classes creados: ${scToCreate.length}`);

  // ── 1.5) Usuarios de los docentes ──────────────────────────────────────────
  if (CREATE_USERS) {
    const missing = emails.filter((e) => !userIdByEmail.has(e));
    for (const email of missing) {
      const name = nameByEmail.get(email) ?? email;
      const id = userIdFromEmail(email);
      await db
        .insert(users)
        .values({
          id,
          email,
          name,
          provider: 'google',
          // El proveedor real se sella en el primer login SSO; este marcador
          // sólo satisface el NOT NULL y deja rastro del origen de la fila.
          providerId: `planta-docente:${email}`,
        })
        .onConflictDoNothing();
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (row) userIdByEmail.set(email, row.id);
    }
    console.log(`usuarios creados: ${missing.length}`);
  }

  // ── 2) Memberships (teacher / homeroom_teacher) ────────────────────────────
  const homeroomEmails = new Set(art.homerooms.map((h) => h.email).filter((e): e is string => !!e));
  const teacherEmails = new Set(art.assignments.map((a) => a.email));

  // Cursos de jefatura por docente: el rol `homeroom_teacher` NO dice de qué
  // curso es jefe — eso vive en `org_memberships.scope.classGroupIds`, que es lo
  // que lee el alcance transversal del profesor jefe
  // (apps/api/src/common/helpers/class-group-scope.helper.ts).
  const homeroomCoursesByEmail = new Map<string, Set<string>>();
  for (const h of art.homerooms) {
    if (!h.email) continue;
    const key = classGroupKey(h);
    const classGroupId = key ? cgIdByKey.get(key) : undefined;
    if (!classGroupId) continue;
    const set = homeroomCoursesByEmail.get(h.email) ?? new Set<string>();
    set.add(classGroupId);
    homeroomCoursesByEmail.set(h.email, set);
  }

  const memberships: Array<{
    userId: string | null;
    orgId: string;
    role: 'teacher' | 'homeroom_teacher';
    email: string | null;
    scope?: { classGroupIds: string[] };
  }> = [];
  for (const email of teacherEmails) {
    const userId = userIdByEmail.get(email) ?? null;
    memberships.push({
      userId,
      orgId: ORG_ID,
      role: 'teacher',
      email: userId ? null : email,
    });
  }
  for (const email of homeroomEmails) {
    const userId = userIdByEmail.get(email) ?? null;
    const courses = [...(homeroomCoursesByEmail.get(email) ?? [])];
    memberships.push({
      userId,
      orgId: ORG_ID,
      role: 'homeroom_teacher',
      email: userId ? null : email,
      scope: { classGroupIds: courses },
    });
  }
  // La unique es (user_id, org_id, role): sólo aplica a memberships con usuario.
  // Las invitaciones pendientes se filtran a mano contra lo ya existente.
  const existingPending = await db
    .select({ email: orgMemberships.email, role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, ORG_ID), isNull(orgMemberships.userId)));
  const pendingKeys = new Set(
    existingPending.map((m) => `${(m.email ?? '').toLowerCase()}|${m.role}`),
  );
  const toInsert = memberships.filter(
    (m) => m.userId !== null || !pendingKeys.has(`${(m.email ?? '').toLowerCase()}|${m.role}`),
  );
  if (toInsert.length > 0) {
    await db
      .insert(orgMemberships)
      .values(toInsert.map((m) => ({ ...m, invitedAt: m.userId ? null : new Date() })))
      // El scope de jefatura debe reflejar el curso VIGENTE: si el membership ya
      // existía con otra jefatura, se actualiza (no se conserva la del año pasado).
      .onConflictDoUpdate({
        target: [orgMemberships.userId, orgMemberships.orgId, orgMemberships.role],
        set: { scope: sql`excluded.scope`, isActive: true },
      });
  }
  console.log(
    `org_memberships procesados: ${toInsert.length} (teacher: ${teacherEmails.size}, homeroom_teacher: ${homeroomEmails.size})`,
  );

  // ── 3) teacher_assignments ─────────────────────────────────────────────────
  let assigned = 0;
  let skippedNoUser = 0;
  let skippedNoCourse = 0;
  const rows: Array<{ userId: string; subjectClassId: string }> = [];
  for (const a of art.assignments) {
    const userId = userIdByEmail.get(a.email);
    if (!userId) {
      skippedNoUser++;
      continue;
    }
    const key = classGroupKey(a);
    const classGroupId = key ? cgIdByKey.get(key) : undefined;
    const subjectId = subjectIdByCode.get(a.subjectCode);
    if (!classGroupId || !subjectId) {
      skippedNoCourse++;
      continue;
    }
    const scId = scIdByKey.get(`${classGroupId}|${subjectId}`);
    if (!scId) {
      skippedNoCourse++;
      continue;
    }
    rows.push({ userId, subjectClassId: scId });
  }
  if (rows.length > 0) {
    await db
      .insert(teacherAssignments)
      .values(rows.map((r) => ({ ...r, role: 'primary' })))
      .onConflictDoNothing();
    assigned = rows.length;
  }
  console.log(`teacher_assignments procesados: ${assigned}`);
  console.log(`  omitidos por docente sin usuario (invitación pendiente): ${skippedNoUser}`);
  console.log(`  omitidos por curso inexistente en la org:                ${skippedNoCourse}`);

  console.log('\nListo.');
  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
