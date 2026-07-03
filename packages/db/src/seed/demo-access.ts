/**
 * Seed de ACCESO DEMO (stage demo).
 *
 * Crea la org **CSCJ** como shell (fundación Tupungato + colegio, SIN roster real
 * de alumnos — no cargamos PII en el stage demo) y **pre-crea los usuarios/accesos**
 * de los stakeholders para que puedan entrar con **SSO Google**.
 *
 * Patrón: pre-crear `users` (provider google + providerId placeholder) + memberships
 * con UUIDs fijos. En el primer login real, el callback signIn matchea por email
 * (Caso B → /auth/sync-user actualiza el providerId real). Idempotente
 * (onConflictDoNothing). NO toca otras orgs.
 *
 * Requiere: `db:seed` (base) y `db:seed:benchmark` (crea Colegio Andes Centro) antes.
 * Correr con DATABASE_ADMIN_URL.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createDbClient } from '../client';
import { organizations, academicYears } from '../schema/organizations';
import { users, orgMemberships } from '../schema/users';
import { platformAdmins } from '../schema/platform-admins';
import type { UserRole } from '@soe/types';

config({ path: resolve(__dirname, '../../../../.env') });

// ── CSCJ: mismos UUIDs fijos que import-cscj-roster.ts (org shell, sin roster) ──
const CSCJ_FOUNDATION_ID = 'c5c10000-0000-0000-0000-0000000000f0';
const CSCJ_SCHOOL_ID = 'c5c10000-0000-0000-0000-000000000001';
const CSCJ_AY_2025_ID = 'c5c10000-0000-0000-0000-000000002025';

// ── Colegio Andes Centro (foco), creado por el seed de benchmark ──
const ANDES_CENTRO_ID = 'b3c00000-0000-0000-0000-000000000001';

type Person = {
  id: string;
  email: string;
  name: string;
  orgId?: string;
  role?: UserRole;
  platformAdmin?: boolean;
};

// Namespace de UUID propio (d3m0...) para los usuarios demo.
const PEOPLE: Person[] = [
  // CSCJ — school_admin
  { id: 'd3e00000-0000-0000-0000-000000000001', email: 'mvial@cscj.cl', name: 'M. Vial', orgId: CSCJ_SCHOOL_ID, role: 'school_admin' },
  { id: 'd3e00000-0000-0000-0000-000000000002', email: 'ariztia.tomas@cscj.cl', name: 'Tomás Ariztía (CSCJ)', orgId: CSCJ_SCHOOL_ID, role: 'school_admin' },
  { id: 'd3e00000-0000-0000-0000-000000000003', email: 'celton@cscj.cl', name: 'C. Elton', orgId: CSCJ_SCHOOL_ID, role: 'school_admin' },
  // CSCJ — academic_director ("director")
  { id: 'd3e00000-0000-0000-0000-000000000004', email: 'fgutierrez@cscj.cl', name: 'F. Gutiérrez', orgId: CSCJ_SCHOOL_ID, role: 'academic_director' },
  { id: 'd3e00000-0000-0000-0000-000000000005', email: 'tlagos@cscj.cl', name: 'T. Lagos', orgId: CSCJ_SCHOOL_ID, role: 'academic_director' },
  // Platform admin
  { id: 'd3e00000-0000-0000-0000-000000000006', email: 'martinviald@gmail.com', name: 'Martín Vial (Plataforma)', platformAdmin: true },
  // Acceso al Colegio Andes Centro (red demo) — school_admin
  { id: 'd3e00000-0000-0000-0000-000000000007', email: 'ariztia.tomas@gmail.com', name: 'Tomás Ariztía (Andes)', orgId: ANDES_CENTRO_ID, role: 'school_admin' },
  { id: 'd3e00000-0000-0000-0000-000000000008', email: 'cristobalelton@cscj.cl', name: 'Cristóbal Elton', orgId: ANDES_CENTRO_ID, role: 'school_admin' },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL requerido');
  const db = createDbClient(databaseUrl);

  // 1. Org CSCJ (fundación + colegio) — shell, sin alumnos.
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

  // 2. Usuarios (pre-creados; se matchean por email en el primer login SSO).
  console.log(`Pre-creando ${PEOPLE.length} usuarios demo...`);
  await db
    .insert(users)
    .values(
      PEOPLE.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name,
        provider: 'google' as const,
        providerId: `seed-demo-${p.id.slice(-2)}`,
      })),
    )
    .onConflictDoNothing();

  // 3. Memberships (rol × org) para los que tienen org.
  const memberships = PEOPLE.filter((p) => p.orgId && p.role).map((p) => ({
    userId: p.id,
    orgId: p.orgId as string,
    role: p.role as UserRole,
    isActive: true,
  }));
  console.log(`Creando ${memberships.length} memberships...`);
  await db.insert(orgMemberships).values(memberships).onConflictDoNothing();

  // 4. Platform admins.
  const admins = PEOPLE.filter((p) => p.platformAdmin).map((p) => ({
    userId: p.id,
    notes: 'seed demo-access',
  }));
  if (admins.length) {
    console.log(`Creando ${admins.length} platform admin(s)...`);
    await db.insert(platformAdmins).values(admins).onConflictDoNothing();
  }

  console.log('✅ Acceso demo cargado: CSCJ + usuarios + platform admin.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error en demo-access seed:', err);
    process.exit(1);
  });
