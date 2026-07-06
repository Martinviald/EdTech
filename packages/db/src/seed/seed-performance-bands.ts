/**
 * Seed idempotente de niveles/umbrales de logro (performance_bands) por instrumento.
 * Reference-data, replicable en prod:
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:seed:performance-bands
 *
 * Siembra los cortes oficiales del DIA Lectura 2025 — Intermedio (3° a 6° básico)
 * reverse-engineered en docs/analisis-clasificacion-niveles-dia.md. Cada instrumento
 * recibe 3 bandas GLOBALES (org_id NULL) → las comparten todas las organizaciones
 * que usen ese instrumento. Sin bandas, el scoring cae al enum legacy 40/70/85.
 *
 * ⚠️ CAVEAT (provisional): los cortes están expresados sobre el % de selección
 * múltiple (MC), que es lo único cargado hoy en la BDD. Cuando se cargue la sección
 * de desarrollo, los umbrales deben re-expresarse contra el total oficial. Además la
 * clasificación exacta pende de validar 2 casos de error de datos (ver el doc).
 *
 * Idempotencia: si el instrumento ya tiene bandas globales activas, se OMITE (no se
 * recrea) — para corregir cortes usar el endpoint platform_admin
 * (PUT /instruments/:id/performance-bands), que hace soft-delete + insert sin romper
 * las FK de assessment_results.performance_band_id.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, isNull } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { performanceBands as performanceBandsTable } from '../schema/results';
import { grades, subjects } from '../schema/academic';

// Cortes DIA Lectura 2025 — Intermedio, por gradeCode. Fracciones 0..1 del % MC.
// `iToII` = corte Nivel I→II ; `iiToIII` = corte Nivel II→III (ver anexo del doc).
type DiaCut = { gradeCode: string; iToII: number; iiToIII: number };
const DIA_LECTURA_INTERMEDIO_2025: readonly DiaCut[] = [
  { gradeCode: '3RD_BASIC', iToII: 0.32, iiToIII: 0.89 },
  { gradeCode: '4TH_BASIC', iToII: 0.35, iiToIII: 0.73 },
  { gradeCode: '5TH_BASIC', iToII: 0.34, iiToIII: 0.78 },
  { gradeCode: '6TH_BASIC', iToII: 0.35, iiToIII: 0.75 },
];

// Presentación de las 3 bandas DIA (I / II / III), de menor a mayor logro.
const DIA_BANDS_META = [
  { key: 'dia_nivel_1', label: 'Nivel I', order: 0, color: '#ef4444' },
  { key: 'dia_nivel_2', label: 'Nivel II', order: 1, color: '#f59e0b' },
  { key: 'dia_nivel_3', label: 'Nivel III', order: 2, color: '#10b981' },
] as const;

export async function seedPerformanceBands(db: Database): Promise<void> {
  const [lang] = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.code, 'LANG'));
  if (!lang) {
    console.log('  ⚠️ Falta subject LANG — omito seed de performance_bands DIA.');
    return;
  }

  let seeded = 0;
  let skipped = 0;
  let missing = 0;

  for (const cut of DIA_LECTURA_INTERMEDIO_2025) {
    const [grade] = await db.select({ id: grades.id }).from(grades).where(eq(grades.code, cut.gradeCode));
    if (!grade) {
      missing++;
      continue;
    }

    const [instrument] = await db
      .select({ id: instruments.id, name: instruments.name })
      .from(instruments)
      .where(
        and(
          eq(instruments.type, 'dia'),
          eq(instruments.subjectId, lang.id),
          eq(instruments.gradeId, grade.id),
          eq(instruments.year, 2025),
          eq(instruments.version, 'intermedio'),
          isNull(instruments.deletedAt),
        ),
      )
      .limit(1);

    if (!instrument) {
      console.log(`  ⚠️ Instrumento DIA Lectura Intermedio ${cut.gradeCode} no encontrado — omito.`);
      missing++;
      continue;
    }

    // Idempotencia: si ya hay bandas globales activas, no recrear.
    const existing = await db
      .select({ id: performanceBandsTable.id })
      .from(performanceBandsTable)
      .where(
        and(
          eq(performanceBandsTable.instrumentId, instrument.id),
          isNull(performanceBandsTable.orgId),
          isNull(performanceBandsTable.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const ranges: Record<string, [number, number]> = {
      dia_nivel_1: [0, cut.iToII],
      dia_nivel_2: [cut.iToII, cut.iiToIII],
      dia_nivel_3: [cut.iiToIII, 1],
    };

    await db.insert(performanceBandsTable).values(
      DIA_BANDS_META.map((b) => ({
        instrumentId: instrument.id,
        scaleId: null,
        orgId: null, // banda global compartida por todas las orgs
        key: b.key,
        label: b.label,
        order: b.order,
        minThreshold: ranges[b.key]![0].toFixed(4),
        maxThreshold: ranges[b.key]![1].toFixed(4),
        color: b.color,
      })),
    );
    console.log(`  ✓ Bandas DIA sembradas para ${instrument.name}`);
    seeded++;
  }

  console.log(
    `Performance bands DIA: ${seeded} instrumentos sembrados · ${skipped} ya existentes · ${missing} sin instrumento.`,
  );
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  seedPerformanceBands(createDbClient(url))
    .then(() => {
      console.log('✅ Performance bands sembradas.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('ERROR seed performance bands:', e);
      process.exit(1);
    });
}
