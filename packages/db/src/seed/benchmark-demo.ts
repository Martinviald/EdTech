/**
 * Seed de DEMO de Benchmarking (F2 S4 — H7.1–H7.4, H7.6).
 *
 * Objetivo: poblar el read-model `benchmark_aggregates` con una cohorte realista
 * para poder PROBAR los dos modos del dashboard /benchmarking de punta a punta:
 *
 *   1. Modo GLOBAL  — pool anónimo de varios colegios sobre el MISMO instrumento
 *      oficial, con k-anonimato satisfecho (≥ 3 colegios y ≥ 20 alumnos). Incluye
 *      un colegio con opt-out para demostrar la exclusión del pool global.
 *   2. Modo RED     — varios colegios bajo un mismo sostenedor (foundation) que se
 *      comparan identificados, sin supresión por k.
 *
 * Diseño (NO destructivo):
 *   - Namespace de UUID propio `b3c00000-...`: todo lo que crea este seed vive en
 *     ese espacio y se BORRA-y-reinserta al inicio (idempotente). No toca Colegio
 *     Demo, San Patricio, el seed base ni e2e-testing.
 *   - Instrumentos OFICIALES compartidos (`org_id = null`, `is_official = true`):
 *     es el modelo correcto para benchmarking — todos los colegios rinden la misma
 *     forma oficial, así la cohorte matchea por `instrument_id` (apples-to-apples).
 *   - Un colegio FOCO ("Colegio Andes Centro") con un usuario directivo propio que
 *     aparece en el login mock: al entrar con él se ven ambos modos (pertenece a la
 *     red Y al pool global).
 *   - Escribe los agregados DIRECTAMENTE (datos de fixture, sin PII). El read-model
 *     es justo lo que lee el motor de comparación (benchmarking.service.ts), así que
 *     no se necesita generar respuestas/resultados crudos. Correr el refresh real
 *     (`POST /api/benchmarking/refresh`) NO pisa estas filas: solo hace upsert por
 *     (org, instrumento, grade, subject) y estas orgs no tienen fuente cruda.
 *
 * Requiere haber corrido antes el seed base (`pnpm --filter @soe/db db:seed`):
 * resuelve grados (2°/3° básico) y asignaturas (Lenguaje/Matemática) ya sembrados.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { eq, inArray, or } from 'drizzle-orm';
import { createDbClient } from '../client';
import { organizations, academicYears } from '../schema/organizations';
import { orgMemberships, users } from '../schema/users';
import { instruments } from '../schema/instruments';
import { grades, subjects } from '../schema/academic';
import { taxonomyNodes } from '../schema/taxonomy';
import {
  benchmarkAggregates,
  benchmarkAccessLogs,
  orgBenchmarkSettings,
} from '../schema/benchmark';
import type { BenchmarkBandDistribution, BenchmarkSkillAggregate } from '@soe/types';

config({ path: resolve(__dirname, '../../../../.env') });

// ── Namespace de UUID propio (borrado idempotente) ───────────────────────────
const FOUNDATION_ID = 'b3c00000-0000-0000-0000-0000000000f0';

// Colegios de la RED (parentId = foundation). El primero es el FOCO (your school).
const ANDES_CENTRO_ID = 'b3c00000-0000-0000-0000-000000000001'; // FOCO
const ANDES_NORTE_ID = 'b3c00000-0000-0000-0000-000000000002';
const ANDES_PONIENTE_ID = 'b3c00000-0000-0000-0000-000000000003';
// Colegios INDEPENDIENTES (sin red) — solo engrosan el pool global.
const ROBLES_ID = 'b3c00000-0000-0000-0000-000000000011';
const AURORA_ID = 'b3c00000-0000-0000-0000-000000000012';
const PACIFICO_ID = 'b3c00000-0000-0000-0000-000000000013'; // opt-out del pool global

const INST_LECT_ID = 'b3c00000-0000-0000-0000-000000000101';
const INST_MAT_ID = 'b3c00000-0000-0000-0000-000000000102';

const FOCUS_USER_ID = 'b3c00000-0000-0000-0000-000000000201';
const FOCUS_AY_ID = 'b3c00000-0000-0000-0000-000000000301';

// UUIDs de habilidades de fallback (perSkill es JSONB sin FK — ids estables seguros).
const FALLBACK_SKILL_IDS = [
  'b3c00000-0000-0000-0000-000000000901',
  'b3c00000-0000-0000-0000-000000000902',
  'b3c00000-0000-0000-0000-000000000903',
  'b3c00000-0000-0000-0000-000000000904',
  'b3c00000-0000-0000-0000-000000000905',
  'b3c00000-0000-0000-0000-000000000906',
];

const ALL_SCHOOL_IDS = [
  ANDES_CENTRO_ID,
  ANDES_NORTE_ID,
  ANDES_PONIENTE_ID,
  ROBLES_ID,
  AURORA_ID,
  PACIFICO_ID,
];
const ALL_ORG_IDS = [FOUNDATION_ID, ...ALL_SCHOOL_IDS];

type Dependence = 'municipal' | 'particular_pagado' | 'particular_subvencionado' | 'delegada';

interface SchoolDef {
  id: string;
  name: string;
  parentId: string | null;
  dependence: Dependence;
  region: string;
  commune: string;
  optOut: boolean;
  /** % logro base por instrumento [lectura, matemática]. */
  avg: { lect: number; mat: number };
  /** alumnos por instrumento [lectura, matemática]. */
  students: { lect: number; mat: number };
}

const SCHOOLS: SchoolDef[] = [
  // ── Red "Andes" (sostenedor) ──
  {
    id: ANDES_CENTRO_ID,
    name: 'Colegio Andes Centro',
    parentId: FOUNDATION_ID,
    dependence: 'particular_subvencionado',
    region: 'Metropolitana',
    commune: 'Santiago',
    optOut: false,
    avg: { lect: 72, mat: 68 },
    students: { lect: 28, mat: 28 },
  },
  {
    id: ANDES_NORTE_ID,
    name: 'Colegio Andes Norte',
    parentId: FOUNDATION_ID,
    dependence: 'particular_subvencionado',
    region: 'Metropolitana',
    commune: 'Huechuraba',
    optOut: false,
    avg: { lect: 64, mat: 70 },
    students: { lect: 25, mat: 25 },
  },
  {
    id: ANDES_PONIENTE_ID,
    name: 'Colegio Andes Poniente',
    parentId: FOUNDATION_ID,
    dependence: 'particular_subvencionado',
    region: 'Metropolitana',
    commune: 'Maipú',
    optOut: false,
    avg: { lect: 58, mat: 55 },
    students: { lect: 22, mat: 22 },
  },
  // ── Independientes (solo pool global) ──
  {
    id: ROBLES_ID,
    name: 'Colegio Los Robles',
    parentId: null,
    dependence: 'municipal',
    region: 'Metropolitana',
    commune: 'Puente Alto',
    optOut: false,
    avg: { lect: 51, mat: 49 },
    students: { lect: 30, mat: 30 },
  },
  {
    id: AURORA_ID,
    name: 'Liceo Aurora',
    parentId: null,
    dependence: 'particular_subvencionado',
    region: 'Valparaíso',
    commune: 'Viña del Mar',
    optOut: false,
    avg: { lect: 66, mat: 63 },
    students: { lect: 24, mat: 24 },
  },
  {
    id: PACIFICO_ID,
    name: 'Colegio Pacífico',
    parentId: null,
    dependence: 'particular_pagado',
    region: 'Metropolitana',
    commune: 'Las Condes',
    optOut: true, // excluido del pool global anónimo
    avg: { lect: 80, mat: 78 },
    students: { lect: 20, mat: 20 },
  },
];

// ── Helpers de generación de agregados (deterministas, sin PII) ──────────────

/** Reparte `n` alumnos en 4 bandas según el % logro promedio. Suma exacta = n. */
function bandsFromAvg(n: number, avg: number): BenchmarkBandDistribution {
  // Proporciones [insufficient, elementary, adequate, advanced].
  let props: readonly [number, number, number, number];
  if (avg >= 75) props = [0.07, 0.18, 0.4, 0.35];
  else if (avg >= 65) props = [0.1, 0.25, 0.43, 0.22];
  else if (avg >= 55) props = [0.17, 0.33, 0.38, 0.12];
  else if (avg >= 45) props = [0.26, 0.38, 0.3, 0.06];
  else props = [0.37, 0.4, 0.2, 0.03];

  const [pIns, pEle, pAdq, pAdv] = props;
  const insufficient = Math.round(pIns * n);
  const elementary = Math.round(pEle * n);
  const adequate = Math.round(pAdq * n);
  const advanced = Math.round(pAdv * n);
  const bands: BenchmarkBandDistribution = { insufficient, elementary, adequate, advanced };
  // Corrige el redondeo cargando la diferencia a la banda de mayor proporción.
  const diff = n - (insufficient + elementary + adequate + advanced);
  const maxProp = Math.max(pIns, pEle, pAdq, pAdv);
  if (maxProp === pAdv) bands.advanced += diff;
  else if (maxProp === pAdq) bands.adequate += diff;
  else if (maxProp === pEle) bands.elementary += diff;
  else bands.insufficient += diff;
  return bands;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 100) / 100));

/** perSkill: habilidades con logro alrededor del promedio del colegio. */
function buildPerSkill(
  skills: { nodeId: string; nodeName: string }[],
  avg: number,
  studentCount: number,
): BenchmarkSkillAggregate[] {
  const offsets = [-7, 2, 8] as const;
  return skills.map((s, i) => ({
    nodeId: s.nodeId,
    nodeName: s.nodeName,
    achievement: clamp(avg + (offsets[i % offsets.length] ?? 0)),
    studentCount,
  }));
}

async function main() {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  }
  const db = createDbClient(databaseUrl);

  // ── Resolver referencias del seed base ──
  const [grade2] = await db.select().from(grades).where(eq(grades.code, '2ND_BASIC'));
  const [langSubject] = await db.select().from(subjects).where(eq(subjects.code, 'LANG'));
  const [mathSubject] = await db.select().from(subjects).where(eq(subjects.code, 'MATH'));
  if (!grade2 || !langSubject || !mathSubject) {
    throw new Error(
      'Faltan referencias del seed base (grado 2°/asignaturas). Corre primero `pnpm --filter @soe/db db:seed`.',
    );
  }

  // Habilidades reales para perSkill (realismo en el heatmap); fallback a ids estables.
  const realSkills = await db
    .select({ id: taxonomyNodes.id, name: taxonomyNodes.name })
    .from(taxonomyNodes)
    .where(eq(taxonomyNodes.type, 'skill'))
    .limit(6);
  const skillPool = FALLBACK_SKILL_IDS.map((id, i) => ({
    nodeId: realSkills[i]?.id ?? id,
    nodeName: realSkills[i]?.name ?? `Habilidad ${i + 1}`,
  }));
  const lectSkills = skillPool.slice(0, 3);
  const matSkills = skillPool.slice(3, 6);

  // ── Limpieza idempotente (borra solo el namespace b3c...) ──
  console.log('Limpiando datos previos del seed de benchmarking...');
  // Los logs de auditoría (H7.6) referencian al usuario foco y a las orgs del
  // namespace por FK; hay que borrarlos ANTES que usuarios/orgs o el delete falla.
  await db
    .delete(benchmarkAccessLogs)
    .where(
      or(
        inArray(benchmarkAccessLogs.orgId, ALL_SCHOOL_IDS),
        eq(benchmarkAccessLogs.userId, FOCUS_USER_ID),
      ),
    );
  await db.delete(benchmarkAggregates).where(inArray(benchmarkAggregates.orgId, ALL_SCHOOL_IDS));
  await db.delete(orgBenchmarkSettings).where(inArray(orgBenchmarkSettings.orgId, ALL_SCHOOL_IDS));
  await db.delete(orgMemberships).where(inArray(orgMemberships.orgId, ALL_SCHOOL_IDS));
  await db.delete(academicYears).where(inArray(academicYears.orgId, ALL_SCHOOL_IDS));
  await db.delete(users).where(eq(users.id, FOCUS_USER_ID));
  await db.delete(instruments).where(inArray(instruments.id, [INST_LECT_ID, INST_MAT_ID]));
  await db.delete(organizations).where(inArray(organizations.id, ALL_ORG_IDS));

  // ── 1) Sostenedor (foundation) ──
  console.log('Creando sostenedor Red Educativa Andes...');
  await db.insert(organizations).values({
    id: FOUNDATION_ID,
    type: 'foundation',
    name: 'Red Educativa Andes',
    config: { rut: '70.000.111-2' },
  });

  // ── 2) Colegios (red + independientes) ──
  console.log(`Creando ${SCHOOLS.length} colegios...`);
  await db.insert(organizations).values(
    SCHOOLS.map((s) => ({
      id: s.id,
      type: 'school' as const,
      parentId: s.parentId,
      name: s.name,
      commune: s.commune,
      region: s.region,
      dependence: s.dependence,
      // El colegio foco habilita explícitamente el tier pago (H18.1).
      config:
        s.id === ANDES_CENTRO_ID
          ? { allowedFeatures: ['benchmarking', 'ai_analysis', 'remedial', 'ai_assistant'] }
          : {},
    })),
  );

  // ── 3) Instrumentos oficiales compartidos (cross-org) ──
  console.log('Creando instrumentos oficiales compartidos...');
  await db.insert(instruments).values([
    {
      id: INST_LECT_ID,
      orgId: null,
      name: 'DIA Lectura 2° Básico (Oficial 2026)',
      type: 'dia',
      subjectId: langSubject.id,
      gradeId: grade2.id,
      year: 2026,
      isOfficial: true,
      status: 'published',
    },
    {
      id: INST_MAT_ID,
      orgId: null,
      name: 'DIA Matemática 2° Básico (Oficial 2026)',
      type: 'dia',
      subjectId: mathSubject.id,
      gradeId: grade2.id,
      year: 2026,
      isOfficial: true,
      status: 'published',
    },
  ]);

  // ── 4) Usuario directivo del colegio foco (login mock) ──
  console.log('Creando usuario directivo del colegio foco...');
  await db.insert(users).values({
    id: FOCUS_USER_ID,
    email: 'directora.andes@redandes.cl',
    name: 'Patricia Soto — Andes Centro',
    provider: 'google',
    providerId: 'seed-benchmark-academic_director',
  });
  await db.insert(orgMemberships).values({
    userId: FOCUS_USER_ID,
    orgId: ANDES_CENTRO_ID,
    role: 'academic_director',
    isActive: true,
  });
  await db.insert(academicYears).values({
    id: FOCUS_AY_ID,
    orgId: ANDES_CENTRO_ID,
    year: 2026,
    isCurrent: true,
  });

  // ── 5) Participación en benchmarking (opt-in/opt-out) ──
  console.log('Registrando participación en benchmarking...');
  await db.insert(orgBenchmarkSettings).values(
    SCHOOLS.map((s) => ({
      orgId: s.id,
      optOutGlobalPool: s.optOut,
      consentGrantedAt: s.optOut ? null : new Date(),
    })),
  );

  // ── 6) Read-model: una fila por (colegio × instrumento) ──
  console.log('Poblando read-model benchmark_aggregates...');
  const now = new Date();
  const rows = SCHOOLS.flatMap((s) => {
    const networkOrgId = s.parentId === FOUNDATION_ID ? FOUNDATION_ID : null;
    return [
      {
        instrumentId: INST_LECT_ID,
        gradeId: grade2.id,
        subjectId: langSubject.id,
        avg: s.avg.lect,
        n: s.students.lect,
        skills: lectSkills,
        networkOrgId,
        s,
      },
      {
        instrumentId: INST_MAT_ID,
        gradeId: grade2.id,
        subjectId: mathSubject.id,
        avg: s.avg.mat,
        n: s.students.mat,
        skills: matSkills,
        networkOrgId,
        s,
      },
    ];
  }).map((r) => ({
    orgId: r.s.id,
    instrumentId: r.instrumentId,
    gradeId: r.gradeId,
    subjectId: r.subjectId,
    dependence: r.s.dependence,
    region: r.s.region,
    commune: r.s.commune,
    networkOrgId: r.networkOrgId,
    studentCount: r.n,
    avgAchievement: r.avg.toFixed(2),
    bandDistribution: bandsFromAvg(r.n, r.avg),
    perSkill: buildPerSkill(r.skills, r.avg, r.n),
    optOutGlobalPool: r.s.optOut,
    refreshedAt: now,
    updatedAt: now,
  }));
  await db.insert(benchmarkAggregates).values(rows);

  console.log('\n✓ Seed de benchmarking listo.');
  console.log(`  Sostenedor: Red Educativa Andes (3 colegios en red)`);
  console.log(`  Pool global: ${SCHOOLS.filter((s) => !s.optOut).length} colegios (1 con opt-out)`);
  console.log(`  Instrumentos oficiales: Lectura y Matemática 2° Básico`);
  console.log(`  Login mock: directora.andes@redandes.cl (Colegio Andes Centro)`);
  console.log(`  → Dashboard /benchmarking: modo GLOBAL (k-anon OK) y modo RED disponibles.`);

  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
