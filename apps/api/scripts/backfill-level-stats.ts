/**
 * Backfill de la distribución por nivel (`assessment_level_stats`) para cohortes de
 * informes DIA que YA están cargadas en demo como `aggregate_only` pero SIN nivel
 * (se importaron cuando `levelDistribution` salía vacío).
 *
 * Re-extrajimos los informes: ahora ~24 JSON traen `levelDistribution` poblado. Este
 * script escribe SOLO ese read-model contra los assessments EXISTENTES —no re-importa,
 * no crea assessments ni import_jobs, no toca item/skill stats ni assessment_results—
 * para esquivar el bug de idempotencia del importador (que duplicaría assessments).
 *
 * Reusa la MISMA lógica de resolución que la carga original (`cargar-informes-dia.ts`):
 * instrumento por (subject+grade+period, oficial org_id NULL) y class group por
 * courseLabel del año del informe. Así apunta a los mismos assessments.
 *
 * Para cada JSON con `levelDistribution` NO vacío:
 *   1. Resuelve instrument + classGroup (como la carga).
 *   2. Encuentra el assessment `aggregate_only` de informe oficial para ese
 *      (instrument, classGroup, period) vía `assessment_course_assignments`.
 *      Si no existe o hay ambigüedad → warn y skip (no crea nada).
 *   3. Carga las performance bands del instrumento (`loadInstrumentBands`, igual que
 *      el importador).
 *   4. `buildLevelStatCounts(...)` de `@soe/types` → filas por banda. Si devuelve []
 *      (nivel no matchea banda, etc.) → warn y skip.
 *   5. Delete+reinsert idempotente por (assessmentId, classGroupId), `source='imported'`.
 *
 * Todo por-org dentro de `withOrgContext(db, orgId, tx => ...)` (RLS: assessments y
 * assessment_level_stats son FORCE RLS). Usa `DATABASE_ADMIN_URL`.
 *
 * ⚠️ Los JSON re-extraídos viven FUERA del repo, así que esto NO va a CI: es un paso
 * MANUAL post-deploy, se corre a mano contra demo (con el túnel arriba, ver skill
 * demo-db-access), igual que la carga original.
 *
 * Los JSON con `levelDistribution: []` (los 16 Diagnóstico + 8 que no pasaron el gate
 * de re-extracción) se saltan en silencio: no es un error, es que no hay dato de nivel.
 *
 * Uso (DRY-RUN por defecto: NO escribe, solo reporta qué escribiría):
 *   DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
 *     pnpm --filter @soe/api exec tsx scripts/backfill-level-stats.ts <dirJson>
 *
 * Para persistir:
 *   DATABASE_ADMIN_URL="..." \
 *     pnpm --filter @soe/api exec tsx scripts/backfill-level-stats.ts <dirJson> --confirm
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentLevelStats,
  assessments,
  createDbClient,
  withOrgContext,
  type Database,
} from '@soe/db';
import {
  buildLevelStatCounts,
  officialReportImportFileSchema,
  type OfficialReportImportFile,
  type PerformanceBandInput,
} from '@soe/types';
import { loadInstrumentBands } from '../src/performance-bands/lib/load-instrument-bands';

const CSCJ_ORG = 'c5c10000-0000-0000-0000-000000000001';
const REPORT_YEAR = 2025;

// period del JSON → palabra que lleva el nombre del instrumento en demo.
const PERIOD_LABEL: Record<string, string> = {
  diagnostico: 'Diagnóstico',
  intermedio: 'Intermedio',
  cierre: 'Cierre',
};
const SUBJECT_WORD: Record<string, string> = { LANG: 'Lectura', MATH: 'Matemática' };
const GRADE_WORD: Record<string, string> = {
  '3RD_BASIC': '3°',
  '4TH_BASIC': '4°',
  '5TH_BASIC': '5°',
  '6TH_BASIC': '6°',
};

/** (subjectCode|gradeCode|nombre) → instrumentId. Igual que la carga original. */
async function buildInstrumentLookup(db: Database): Promise<Map<string, string>> {
  const rows = await db.execute(sql`
    select i.id, i.name, s.code as subject, g.code as grade
    from instruments i
    left join subjects s on s.id = i.subject_id
    left join grades g on g.id = i.grade_id
    where i.type = 'dia' and i.deleted_at is null and i.org_id is null
  `);
  const map = new Map<string, string>();
  for (const r of rows as unknown as Array<{
    id: string;
    name: string;
    subject: string;
    grade: string;
  }>) {
    map.set(`${r.subject}|${r.grade}|${r.name}`, r.id);
  }
  return map;
}

function findInstrument(
  lookup: Map<string, string>,
  subj: string,
  grade: string,
  period: string,
): string | null {
  const wantWord = PERIOD_LABEL[period];
  if (!wantWord) return null;
  for (const [key, id] of lookup) {
    const [s, g, name] = key.split('|');
    if (s === subj && g === grade && name.includes(wantWord)) return id;
  }
  return null;
}

async function resolveClassGroup(
  db: Database,
  grade: string,
  courseLabel: string,
): Promise<string | null> {
  const letter = courseLabel.trim().slice(-1).toUpperCase();
  const rows = await db.execute(sql`
    select cg.id, cg.name
    from class_groups cg
    join grades g on g.id = cg.grade_id
    join academic_years ay on ay.id = cg.academic_year_id
    where cg.org_id = ${CSCJ_ORG} and g.code = ${grade} and ay.year = ${REPORT_YEAR}
  `);
  for (const r of rows as unknown as Array<{ id: string; name: string }>) {
    if (r.name.trim().toUpperCase().endsWith(letter)) return r.id;
  }
  return null;
}

/**
 * Encuentra el assessment `aggregate_only` de informe oficial EXISTENTE para
 * (instrument, classGroup, period) vía `assessment_course_assignments`. Corre dentro
 * del contexto de org (RLS: assessments es FORCE RLS).
 *
 * Devuelve `{ id }` si hay exactamente uno; `'none'` si ninguno; `'ambiguous'` si más
 * de uno (no se toca nada en esos casos).
 */
async function findExistingAssessment(
  tx: Database,
  orgId: string,
  instrumentId: string,
  classGroupId: string,
  period: string,
): Promise<{ id: string } | 'none' | 'ambiguous'> {
  const rows = await tx
    .select({ id: assessments.id })
    .from(assessments)
    .innerJoin(
      assessmentCourseAssignments,
      eq(assessmentCourseAssignments.assessmentId, assessments.id),
    )
    .where(
      and(
        eq(assessments.orgId, orgId),
        eq(assessments.instrumentId, instrumentId),
        eq(assessmentCourseAssignments.classGroupId, classGroupId),
        eq(assessments.dataGranularity, 'aggregate_only'),
        sql`${assessments.config}->>'source' = 'dia_official_report'`,
        sql`${assessments.config}->>'period' = ${period}`,
      ),
    );
  if (rows.length === 0) return 'none';
  if (rows.length > 1) return 'ambiguous';
  return { id: rows[0]!.id };
}

type ParsedReport = { file: string; doc: OfficialReportImportFile; label: string };

function labelFor(doc: OfficialReportImportFile): string {
  const r = doc.report;
  return `${SUBJECT_WORD[r.subjectCode] ?? r.subjectCode} ${GRADE_WORD[r.gradeCode] ?? r.gradeCode} ${r.period} ${r.courseLabel}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const doConfirm = args.includes('--confirm');
  if (!dir) {
    throw new Error(
      'Falta el directorio con los JSON. Uso: ... backfill-level-stats.ts <dir> [--confirm]',
    );
  }

  // ── Fase pura: parsear y clasificar los 48 JSON (no toca la BD) ──────────────
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const withLevels: ParsedReport[] = [];
  let emptyCount = 0;
  let parseErrors = 0;

  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));
    } catch {
      console.log(`  ✗ ${f} — no es JSON válido`);
      parseErrors++;
      continue;
    }
    const parsed = officialReportImportFileSchema.safeParse(raw);
    if (!parsed.success) {
      console.log(`  ✗ ${f} — no cumple el contrato: ${parsed.error.issues[0]?.message ?? ''}`);
      parseErrors++;
      continue;
    }
    if (parsed.data.levelDistribution.length === 0) {
      emptyCount++; // 16 Diagnóstico + 8 sin nivel: se saltan en silencio.
      continue;
    }
    withLevels.push({ file: f, doc: parsed.data, label: labelFor(parsed.data) });
  }

  console.log(
    `\nParseados ${files.length} JSON · ${withLevels.length} con distribución por nivel · ` +
      `${emptyCount} sin nivel (omitidos) · ${parseErrors} con error de parseo`,
  );

  if (!process.env.DATABASE_ADMIN_URL) {
    throw new Error('Falta DATABASE_ADMIN_URL (túnel a demo). Fase de parseo OK; sin BD no sigo.');
  }

  const db = createDbClient(process.env.DATABASE_ADMIN_URL);
  const instruments = await buildInstrumentLookup(db);
  console.log(`Instrumentos DIA oficiales en demo: ${instruments.size}`);
  console.log(
    doConfirm
      ? '\n=== MODO CONFIRM (escribe assessment_level_stats) ===\n'
      : '\n=== DRY-RUN (NO escribe; muestra lo que escribiría) ===\n',
  );

  let written = 0;
  let skipped = 0;

  for (const { doc, label } of withLevels) {
    const r = doc.report;

    const instrumentId = findInstrument(instruments, r.subjectCode, r.gradeCode, r.period);
    if (!instrumentId) {
      console.log(`  ⏭️  ${label.padEnd(30)} — instrumento no encontrado en demo`);
      skipped++;
      continue;
    }
    const classGroupId = await resolveClassGroup(db, r.gradeCode, r.courseLabel);
    if (!classGroupId) {
      console.log(
        `  ⏭️  ${label.padEnd(30)} — class group ${r.courseLabel} (${REPORT_YEAR}) no encontrado`,
      );
      skipped++;
      continue;
    }

    const outcome = await withOrgContext(db, CSCJ_ORG, async (tx) => {
      const found = await findExistingAssessment(
        tx,
        CSCJ_ORG,
        instrumentId,
        classGroupId,
        r.period,
      );
      if (found === 'none') {
        console.log(`  ⏭️  ${label.padEnd(30)} — sin assessment aggregate_only existente`);
        return 'skip' as const;
      }
      if (found === 'ambiguous') {
        console.log(`  ⏭️  ${label.padEnd(30)} — ambiguo (>1 assessment); no se toca`);
        return 'skip' as const;
      }

      const bands: PerformanceBandInput[] = await loadInstrumentBands(tx, instrumentId);
      const rows = buildLevelStatCounts({
        levelDistribution: doc.levelDistribution,
        studentCount: r.studentCount,
        bands,
      });
      if (rows.length === 0) {
        console.log(
          `  ⏭️  ${label.padEnd(30)} — niveles no matchean bandas (o distribución inválida)`,
        );
        return 'skip' as const;
      }

      const bandLabelById = new Map(bands.map((b) => [b.id, b.label]));
      const detail = rows
        .map(
          (row) =>
            `${bandLabelById.get(row.performanceBandId) ?? row.performanceBandId}=${row.studentCount}`,
        )
        .join(' · ');
      const total = rows.reduce((acc, row) => acc + row.studentCount, 0);

      if (!doConfirm) {
        console.log(
          `  ✓ ${label.padEnd(30)} — assessment ${found.id} · ${detail} · total ${total}/N ${r.studentCount}`,
        );
        return 'match' as const;
      }

      // Idempotente: delete+reinsert por (assessmentId, classGroupId).
      const now = new Date();
      await tx
        .delete(assessmentLevelStats)
        .where(
          and(
            eq(assessmentLevelStats.assessmentId, found.id),
            eq(assessmentLevelStats.classGroupId, classGroupId),
          ),
        );
      await tx.insert(assessmentLevelStats).values(
        rows.map((row) => ({
          assessmentId: found.id,
          classGroupId,
          performanceBandId: row.performanceBandId,
          studentCount: row.studentCount,
          source: 'imported' as const,
          computedAt: now,
        })),
      );
      console.log(
        `  ✓ ${label.padEnd(30)} — ESCRITO en assessment ${found.id} · ${detail} · total ${total}/N ${r.studentCount}`,
      );
      return 'match' as const;
    });

    if (outcome === 'match') written++;
    else skipped++;
  }

  const verb = doConfirm ? 'escritos' : 'matchearían';
  console.log(
    `\n=== ${written} ${verb} · ${skipped} skipeados · ${emptyCount} sin nivel (de ${files.length} JSON) ===`,
  );
  if (!doConfirm && written > 0) {
    console.log('Re-correr con --confirm para persistir en assessment_level_stats.');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
