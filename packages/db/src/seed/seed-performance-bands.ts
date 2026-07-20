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

// El DIA usa DISTINTA cantidad de niveles según el período:
//  · Diagnóstico → BINARIO ("Requiere mayor apoyo" / "No requiere") — 2 bandas.
//  · Monitoreo (Intermedio) / Cierre → 3 niveles (Nivel I / II / III).
// Por eso el seed siembra 2 o 3 bandas según el período (detectado por el NOMBRE del
// instrumento). Ver docs/plan-fidelidad-niveles-informe-dia.md.

// ── Monitoreo/Cierre: 3 bandas, corte por (subject|grade) ────────────────────────
// `iToII` = corte Nivel I→II ; `iiToIII` = corte Nivel II→III (fracciones 0..1).
// Monitoreo y Cierre comparten la geometría del gráfico → mismo corte por instrumento.
type Cut3 = { iToII: number; iiToIII: number };
const DIA_3BAND_CUTS: Readonly<Record<string, Cut3>> = {
  // LANG: cortes REALES reverse-engineered (docs/analisis-clasificacion-niveles-dia.md).
  'LANG|3RD_BASIC': { iToII: 0.32, iiToIII: 0.89 },
  'LANG|4TH_BASIC': { iToII: 0.35, iiToIII: 0.73 },
  'LANG|5TH_BASIC': { iToII: 0.34, iiToIII: 0.78 },
  'LANG|6TH_BASIC': { iToII: 0.35, iiToIII: 0.75 },
  // MATH: derivados de la geometría de la Figura 1 (aprox, err ~0.03; 5°/6° baja
  // confianza). Corregibles vía el endpoint platform_admin cuando haya corte oficial.
  'MATH|3RD_BASIC': { iToII: 0.478, iiToIII: 0.804 },
  'MATH|4TH_BASIC': { iToII: 0.439, iiToIII: 0.76 },
  'MATH|5TH_BASIC': { iToII: 0.444, iiToIII: 0.741 },
  'MATH|6TH_BASIC': { iToII: 0.448, iiToIII: 0.776 },
};
const DIA_3BAND_GENERIC: Cut3 = { iToII: 0.34, iiToIII: 0.79 };

// ── Diagnóstico: 2 bandas, corte binario por (subject|grade) ─────────────────────
// Derivado del roster de la Figura 1 (posición del umbral "requiere mayor apoyo").
// No afecta el display (el flag "requiere apoyo" viene del informe); aproximado.
const DIA_DIAG_CUTS: Readonly<Record<string, number>> = {
  'LANG|3RD_BASIC': 0.691,
  'LANG|4TH_BASIC': 0.654,
  'LANG|5TH_BASIC': 0.66,
  'LANG|6TH_BASIC': 0.75,
  'MATH|3RD_BASIC': 0.772,
  'MATH|4TH_BASIC': 0.768,
  'MATH|5TH_BASIC': 0.789,
  'MATH|6TH_BASIC': 0.792,
};
const DIA_DIAG_GENERIC = 0.72;

// Presentación de las 3 bandas DIA (I / II / III), de menor a mayor logro.
const DIA_BANDS_META = [
  { key: 'dia_nivel_1', label: 'Nivel I', order: 0, color: '#ef4444' },
  { key: 'dia_nivel_2', label: 'Nivel II', order: 1, color: '#f59e0b' },
  { key: 'dia_nivel_3', label: 'Nivel III', order: 2, color: '#10b981' },
] as const;

// Presentación de las 2 bandas del Diagnóstico (binario).
const DIA_DIAG_BANDS_META = [
  { key: 'dia_diag_apoyo', label: 'Requiere mayor apoyo', order: 0, color: '#ef4444' },
  { key: 'dia_diag_logrado', label: 'No requiere mayor apoyo', order: 1, color: '#10b981' },
] as const;

/** Período DIA del instrumento, por su nombre (robusto: `version` no siempre viene). */
function diaPeriod(name: string): 'diagnostico' | 'cierre' | 'intermedio' {
  if (/diagn/i.test(name)) return 'diagnostico';
  if (/cierre/i.test(name)) return 'cierre';
  return 'intermedio';
}

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

  let seeded3 = 0;
  let seeded2 = 0;
  let skipped = 0;

  for (const inst of diaInstruments) {
    const sg = `${inst.subjectCode}|${inst.gradeCode}`;
    const period = diaPeriod(inst.name);

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

    // Diagnóstico → 2 bandas (binario); Monitoreo/Cierre → 3 bandas (I/II/III).
    const rows =
      period === 'diagnostico'
        ? (() => {
            const cut = DIA_DIAG_CUTS[sg] ?? DIA_DIAG_GENERIC;
            const ranges: Record<string, [number, number]> = {
              dia_diag_apoyo: [0, cut],
              dia_diag_logrado: [cut, 1],
            };
            return DIA_DIAG_BANDS_META.map((b) => ({ b, r: ranges[b.key]! }));
          })()
        : (() => {
            const cut = DIA_3BAND_CUTS[sg] ?? DIA_3BAND_GENERIC;
            const ranges: Record<string, [number, number]> = {
              dia_nivel_1: [0, cut.iToII],
              dia_nivel_2: [cut.iToII, cut.iiToIII],
              dia_nivel_3: [cut.iiToIII, 1],
            };
            return DIA_BANDS_META.map((b) => ({ b, r: ranges[b.key]! }));
          })();

    await db.insert(performanceBandsTable).values(
      rows.map(({ b, r }) => ({
        instrumentId: inst.id,
        scaleId: null,
        orgId: null, // banda global compartida por todas las orgs
        key: b.key,
        label: b.label,
        order: b.order,
        minThreshold: r[0].toFixed(4),
        maxThreshold: r[1].toFixed(4),
        color: b.color,
      })),
    );

    if (period === 'diagnostico') {
      seeded2++;
      console.log(`  ✓ 2 bandas (Diagnóstico) — ${inst.name}`);
    } else {
      seeded3++;
      console.log(`  ✓ 3 bandas (${period}) — ${inst.name}`);
    }
  }

  console.log(
    `Performance bands DIA: ${seeded3} con 3 bandas (Mon/Cierre) · ${seeded2} con 2 bandas (Diagnóstico) · ${skipped} ya existentes (de ${diaInstruments.length} instrumentos DIA).`,
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
