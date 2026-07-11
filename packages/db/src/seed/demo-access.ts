/**
 * Seed de ACCESO DEMO (stage demo).
 *
 * Crea la org **CSCJ** shell (fundación Tupungato + colegio) y da acceso a los
 * stakeholders para login **SSO Google**, de forma robusta ante cualquier estado
 * previo de la BDD:
 *   - Si el email YA tiene users row → adjunta la membership por su userId.
 *   - Si NO → crea la membership como **invitación pendiente** (userId NULL + email);
 *     en el primer login SSO el callback signIn (Caso A) crea el user y la promueve.
 *   - Platform admin: requiere users row → query-or-create + platform_admins.
 *
 * Idempotente (onConflictDoNothing). NO carga PII de alumnos. Correr con DATABASE_ADMIN_URL.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';
import { createDbClient } from '../client';
import { organizations, academicYears } from '../schema/organizations';
import { users, orgMemberships } from '../schema/users';
import { platformAdmins } from '../schema/platform-admins';
import type { UserRole } from '@soe/types';

config({ path: resolve(__dirname, '../../../../.env') });

const CSCJ_FOUNDATION_ID = 'c5c10000-0000-0000-0000-0000000000f0';
const CSCJ_SCHOOL_ID = 'c5c10000-0000-0000-0000-000000000001';
const CSCJ_AY_2025_ID = 'c5c10000-0000-0000-0000-000000002025';
const ANDES_CENTRO_ID = 'b3c00000-0000-0000-0000-000000000001';

type Person = {
  email: string;
  name: string;
  orgId?: string;
  role?: UserRole;
  platformAdmin?: boolean;
};

const PEOPLE: Person[] = [
  { email: 'mvial@cscj.cl', name: 'M. Vial', orgId: CSCJ_SCHOOL_ID, role: 'school_admin' },
  { email: 'ariztia.tomas@cscj.cl', name: 'Tomás Ariztía (CSCJ)', orgId: CSCJ_SCHOOL_ID, role: 'school_admin' },
  { email: 'celton@cscj.cl', name: 'C. Elton', orgId: CSCJ_SCHOOL_ID, role: 'school_admin' },
  { email: 'fgutierrez@cscj.cl', name: 'F. Gutiérrez', orgId: CSCJ_SCHOOL_ID, role: 'academic_director' },
  { email: 'tlagos@cscj.cl', name: 'T. Lagos', orgId: CSCJ_SCHOOL_ID, role: 'academic_director' },
  { email: 'martinviald@gmail.com', name: 'Martín Vial (Plataforma)', platformAdmin: true },
  { email: 'ariztia.tomas@gmail.com', name: 'Tomás Ariztía (Andes)', orgId: ANDES_CENTRO_ID, role: 'school_admin' },
  { email: 'cristobalelton@cscj.cl', name: 'Cristóbal Elton', orgId: ANDES_CENTRO_ID, role: 'school_admin' },
];

async function findUserId(db: ReturnType<typeof createDbClient>, email: string): Promise<string | undefined> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return rows[0]?.id;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL requerido');
  const db = createDbClient(databaseUrl);

  // 1. Org CSCJ (shell) + academic year 2025.
  console.log('Creando org CSCJ (shell)...');
  await db
    .insert(organizations)
    .values([
      { id: CSCJ_FOUNDATION_ID, type: 'foundation', name: 'Fundación Educacional Tupungato', config: { rut: '65.135.369-6' } },
      { id: CSCJ_SCHOOL_ID, type: 'school', parentId: CSCJ_FOUNDATION_ID, name: 'Colegio Sagrado Corazón de La Reina', rbd: '25520-3', commune: 'La Reina', region: 'Región Metropolitana', dependence: 'particular_pagado' },
    ])
    .onConflictDoNothing();
  await db
    .insert(academicYears)
    .values({ id: CSCJ_AY_2025_ID, orgId: CSCJ_SCHOOL_ID, year: 2025, isCurrent: true })
    .onConflictDoNothing();

  // 2. Memberships (adjuntar por userId si el email ya existe; si no, invitación pendiente).
  for (const p of PEOPLE.filter((x) => x.orgId && x.role)) {
    const userId = await findUserId(db, p.email);
    if (userId) {
      await db
        .insert(orgMemberships)
        .values({ userId, orgId: p.orgId as string, role: p.role as UserRole, isActive: true })
        .onConflictDoNothing();
      console.log(`  membership (existente) ${p.email} → ${p.role}`);
    } else {
      await db
        .insert(orgMemberships)
        .values({ orgId: p.orgId as string, role: p.role as UserRole, email: p.email, isActive: true, invitedAt: new Date() })
        .onConflictDoNothing();
      console.log(`  invitación (whitelist) ${p.email} → ${p.role}`);
    }
  }

  // 3. Platform admin: query-or-create user + platform_admins.
  for (const p of PEOPLE.filter((x) => x.platformAdmin)) {
    let userId = await findUserId(db, p.email);
    if (!userId) {
      const ins = await db
        .insert(users)
        .values({ email: p.email, name: p.name, provider: 'google', providerId: 'seed-demo-platform-admin' })
        .returning({ id: users.id });
      userId = ins[0]!.id;
    }
    await db.insert(platformAdmins).values({ userId, notes: 'seed demo-access' }).onConflictDoNothing();
    console.log(`  platform admin ${p.email}`);
  }

  console.log('✅ demo-access cargado (CSCJ + accesos).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error en demo-access seed:', err);
    process.exit(1);
  });
