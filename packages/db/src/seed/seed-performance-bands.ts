/**
 * Seed idempotente de niveles/umbrales de logro (performance_bands) por instrumento.
 * Reference-data, replicable en prod:
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:seed:performance-bands
 *
 * Siembra las 3 bandas DIA (Nivel I / II / III) para TODOS los instrumentos DIA
 * oficiales (org_id NULL). Cada instrumento recibe bandas GLOBALES → las comparten
 * todas las organizaciones que usen ese instrumento. Sin bandas, el scoring cae al
 * enum legacy 40/70/85.
 *
 * ── Umbrales: reales vs provisionales ────────────────────────────────────────────
 * El corte de nivel del DIA es POR INSTRUMENTO (docs/analisis-clasificacion-niveles-dia.md):
 * cada grado/forma tiene su propio standard-setting, no hay un % universal.
 *  · Los 4 de **Lectura Intermedio 3°–6° 2025** tienen cortes REALES, reverse-engineered
 *    de los datos por-alumno (única cohorte con ese detalle). Ver `DIA_KNOWN_CUTS`.
 *  · El resto (Matemática, y Lectura Cierre/Diagnóstico) NO tiene datos por-alumno para
 *    derivar su corte, así que se siembra con un corte GENÉRICO **provisional** (promedio
 *    de los 4 conocidos). Es corregible por instrumento vía el endpoint platform_admin
 *    (PUT /instruments/:id/performance-bands) cuando haya cortes oficiales.
 *
 * ⚠️ El corte provisional NO afecta lo que el usuario ve del informe DIA: la
 * distribución por nivel y "requiere apoyo" salen del propio informe (conteos por
 * nivel), colgados de la banda por su IDENTIDAD (order I/II/III), no clasificando un
 * porcentaje. El umbral solo interviene en la etiqueta derivada logro→nivel del curso,
 * que el DIA ni siquiera reporta. Por eso un corte aproximado es aceptable aquí.
 *
 * ⚠️ CAVEAT (provisional, para los 4 reales): los cortes están sobre el % de selección
 * múltiple (MC), que es lo único cargado hoy. Al cargar la sección de desarrollo hay que
 * re-expresarlos contra el total oficial; la clasificación exacta pende de 2 casos de
 * error de datos (ver el doc).
 *
 * Idempotencia: si el instrumento ya tiene bandas globales activas, se OMITE (no se
 * recrea) — para corregir cortes usar el endpoint platform_admin, que hace soft-delete
 * + insert sin romper las FK de assessment_results.performance_band_id.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, isNull } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { performanceBands as performanceBandsTable } from '../schema/results';
import { grades, subjects } from '../schema/academic';

// Corte de nivel de un instrumento DIA. Fracciones 0..1 del % de logro.
// `iToII` = corte Nivel I→II ; `iiToIII` = corte Nivel II→III.
type DiaCut = { iToII: number; iiToIII: number };

// Cortes REALES reverse-engineered (docs/analisis-clasificacion-niveles-dia.md).
// Solo existen para Lectura Intermedio 3°–6° 2025 (la única cohorte con datos por-alumno
// para el standard-setting). Clave: `${subjectCode}|${gradeCode}|${version}`.
const DIA_KNOWN_CUTS: Readonly<Record<string, DiaCut>> = {
  'LANG|3RD_BASIC|intermedio': { iToII: 0.32, iiToIII: 0.89 },
  'LANG|4TH_BASIC|intermedio': { iToII: 0.35, iiToIII: 0.73 },
  'LANG|5TH_BASIC|intermedio': { iToII: 0.34, iiToIII: 0.78 },
  'LANG|6TH_BASIC|intermedio': { iToII: 0.35, iiToIII: 0.75 },
};

// Corte GENÉRICO provisional para los instrumentos DIA sin corte propio derivable.
// Promedio de los 4 conocidos (iToII≈0.34, iiToIII≈0.79). Documentado como aproximado:
// no afecta la distribución por nivel ni "requiere apoyo" (que vienen del informe).
const DIA_GENERIC_CUT: DiaCut = { iToII: 0.34, iiToIII: 0.79 };

// Presentación de las 3 bandas DIA (I / II / III), de menor a mayor logro.
const DIA_BANDS_META = [
  { key: 'dia_nivel_1', label: 'Nivel I', order: 0, color: '#ef4444' },
  { key: 'dia_nivel_2', label: 'Nivel II', order: 1, color: '#f59e0b' },
  { key: 'dia_nivel_3', label: 'Nivel III', order: 2, color: '#10b981' },
] as const;

export async function seedPerformanceBands(db: Database): Promise<void> {
  // Todos los instrumentos DIA oficiales (org_id NULL → reference-data global).
  const diaInstruments = await db
    .select({
      id: instruments.id,
      name: instruments.name,
      version: instruments.version,
      subjectCode: subjects.code,
      gradeCode: grades.code,
    })
    .from(instruments)
    .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
    .innerJoin(grades, eq(grades.id, instruments.gradeId))
    .where(
      and(eq(instruments.type, 'dia'), isNull(instruments.orgId), isNull(instruments.deletedAt)),
    );

  let seededReal = 0;
  let seededProvisional = 0;
  let skipped = 0;

  for (const inst of diaInstruments) {
    const key = `${inst.subjectCode}|${inst.gradeCode}|${inst.version ?? ''}`;
    const known = DIA_KNOWN_CUTS[key];
    const cut = known ?? DIA_GENERIC_CUT;

    // Idempotencia: si ya hay bandas globales activas, no recrear.
    const existing = await db
      .select({ id: performanceBandsTable.id })
      .from(performanceBandsTable)
      .where(
        and(
          eq(performanceBandsTable.instrumentId, inst.id),
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
        instrumentId: inst.id,
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

    if (known) {
      seededReal++;
      console.log(`  ✓ Bandas DIA (corte real) — ${inst.name}`);
    } else {
      seededProvisional++;
      console.log(`  ✓ Bandas DIA (corte provisional) — ${inst.name}`);
    }
  }

  console.log(
    `Performance bands DIA: ${seededReal} con corte real · ${seededProvisional} con corte provisional · ${skipped} ya existentes (de ${diaInstruments.length} instrumentos DIA).`,
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
