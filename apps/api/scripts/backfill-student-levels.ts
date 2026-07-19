/**
 * Backfill de la NÓMINA POR ALUMNO (nivel de logro) a `assessment_results`, para las
 * cohortes de informes DIA que YA están cargadas en demo como `aggregate_only` pero SIN
 * el nivel por alumno (se importaron por API sólo con datos de cohorte, o la figura de
 * niveles se extrajo después).
 *
 * Re-extrajimos la "Figura 1" de los informes de MONITOREO: ahora sus JSON traen
 * `students[]` (`{ listNumber, name, level }`), donde `name` es un PREFIJO por OCR —el
 * gráfico corta el nombre en su borde izquierdo, así que al apellido/nombre le puede
 * faltar el final. Este script matchea cada fila contra la nómina real del curso y
 * escribe una fila `metricType: 'band'` en `assessment_results` con la banda del nivel.
 *
 * NO re-importa (esquiva el bug de idempotencia del importador, que crea assessments
 * duplicados: ver docs/revision-carga-informes-dia-2025.md §4). Matchea el assessment
 * `aggregate_only` de informe oficial EXISTENTE y escribe directo, con la MISMA
 * resolución de instrument/classGroup/period que `backfill-level-stats.ts` (su hermano).
 *
 * Sólo aplica a informes de Monitoreo: Diagnóstico/Cierre no traen `students[]` (su
 * figura de niveles no se extrajo) y se saltan en silencio.
 *
 * Para cada JSON con `students[]` NO vacío:
 *   1. Resuelve instrument + classGroup → assessment `aggregate_only` de informe oficial
 *      EXISTENTE (igual que backfill-level-stats). 0 o >1 → warn y skip (NUNCA crea).
 *   2. Carga la nómina del curso (`student_enrollments` activos del classGroup/año) —el
 *      mismo camino que `OfficialReportImportService.loadRoster`.
 *   3. Carga las bandas del instrumento (`loadInstrumentBands`, igual que el importador).
 *   4. Por cada fila del informe: matchea el nombre a un alumno (ver `resolveStudent`),
 *      resuelve la banda del nivel (`resolveLevelBand`) y escribe la fila. Los que no
 *      cruzan o son ambiguos NO se escriben: quedan para revisión manual y se cuentan.
 *   5. Idempotente: `onConflictDoUpdate` sobre (assessmentId, studentId) —idéntico al
 *      importador. Todo dentro de `withOrgContext(db, orgId, tx => ...)` (RLS:
 *      assessment_results es FORCE RLS). Usa `DATABASE_ADMIN_URL`.
 *
 * ⚠️ Los JSON re-extraídos viven FUERA del repo, así que esto NO va a CI: es un paso
 * MANUAL post-deploy, se corre a mano contra demo (con el túnel arriba, ver skill
 * demo-db-access), igual que la carga original.
 *
 * ⚠️ `matchReportName`, `resolveLevelBand`, etc. son la MISMA lógica que el importador
 * (DRY): no se duplica el matcher ni el mapeo nivel→banda.
 *
 * Uso (DRY-RUN por defecto: NO escribe, sólo reporta qué escribiría):
 *   DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
 *     pnpm --filter @soe/api exec tsx scripts/backfill-student-levels.ts <dirJson>
 *
 * Para persistir:
 *   DATABASE_ADMIN_URL="..." \
 *     pnpm --filter @soe/api exec tsx scripts/backfill-student-levels.ts <dirJson> --confirm
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  createDbClient,
  studentEnrollments,
  students,
  withOrgContext,
  type Database,
} from '@soe/db';
import {
  officialReportImportFileSchema,
  type OfficialReportImportFile,
  type PerformanceBandInput,
} from '@soe/types';
import { loadInstrumentBands } from '../src/performance-bands/lib/load-instrument-bands';
import { resolveLevelBand } from '../src/official-report-import/lib/evaluate-gates';
import {
  matchReportName,
  normalizeName,
  type StudentForMatch,
} from '../src/official-report-import/lib/student-name-matcher';

const CSCJ_ORG = 'c5c10000-0000-0000-0000-000000000001';
const REPORT_YEAR = 2025;

/**
 * Largo mínimo (normalizado) del prefijo OCR para aceptar un match por prefijo. Un
 * prefijo corto ("A") matchearía a muchos → no único → ya se rechaza; este piso extra
 * evita que un prefijo corto cruce a UN solo alumno por casualidad.
 */
const MIN_PREFIX_LEN = 6;

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
 * del contexto de org (RLS: assessments es FORCE RLS). Mismo criterio que
 * `backfill-level-stats.ts`.
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

/**
 * Nómina del curso desde `student_enrollments` — el MISMO camino que
 * `OfficialReportImportService.loadRoster`. Corre dentro del contexto de org (RLS).
 */
async function loadRoster(
  tx: Database,
  orgId: string,
  classGroupId: string,
): Promise<StudentForMatch[]> {
  return tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
    })
    .from(students)
    .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, students.id))
    .where(
      and(
        eq(students.orgId, orgId),
        isNull(students.deletedAt),
        eq(studentEnrollments.classGroupId, classGroupId),
        eq(studentEnrollments.status, 'active'),
      ),
    );
}

type MatchKind = 'auto' | 'prefix' | 'ambiguous' | 'not_found';

/**
 * Resuelve la fila del informe a un alumno de la nómina. Dos caminos:
 *  · `auto`: el matcher difuso propone uno con `confidence >= 0.85 && !ambiguous`
 *    (matchReportName ya sólo devuelve `studentId` en ese caso).
 *  · `prefix`: como el `name` es un PREFIJO OCR truncado, un match fuerte extra: la
 *    forma "APELLIDOS NOMBRE" normalizada de UN ÚNICO alumno EMPIEZA CON el prefijo
 *    normalizado (y el prefijo tiene largo suficiente). Se reporta aparte.
 *  · `ambiguous` / `not_found`: nada se escribe; se acumula para revisión manual.
 */
function resolveStudent(
  reportedName: string,
  roster: readonly StudentForMatch[],
):
  | { studentId: string; kind: 'auto' | 'prefix' }
  | { studentId: null; kind: 'ambiguous' | 'not_found' } {
  const match = matchReportName(reportedName, roster);
  if (match.studentId !== null) {
    return { studentId: match.studentId, kind: 'auto' };
  }

  // Match por prefijo: el nombre del roster ("APELLIDOS NOMBRE") empieza con el prefijo
  // OCR y es el ÚNICO que lo hace.
  const prefix = normalizeName(reportedName);
  if (prefix.length >= MIN_PREFIX_LEN) {
    const hits = roster.filter((s) =>
      normalizeName(`${s.lastName} ${s.firstName}`).startsWith(prefix),
    );
    if (hits.length === 1) {
      return { studentId: hits[0]!.id, kind: 'prefix' };
    }
  }

  // `ambiguous` sólo si el matcher marcó empate; si no, simplemente no cruzó.
  return { studentId: null, kind: match.ambiguous ? 'ambiguous' : 'not_found' };
}

type ParsedReport = { file: string; doc: OfficialReportImportFile; label: string };

function labelFor(doc: OfficialReportImportFile): string {
  const r = doc.report;
  return `${SUBJECT_WORD[r.subjectCode] ?? r.subjectCode} ${GRADE_WORD[r.gradeCode] ?? r.gradeCode} ${r.period} ${r.courseLabel}`;
}

/**
 * Los JSON de MONITOREO traen `students[].listNumber` como NÚMERO, pero el contrato
 * compartido lo tipa `string` (§ el extractor Python no se toca acá). Se normaliza a
 * string ANTES de validar contra el schema compartido, sin tocar el contrato ni el
 * extractor: es un ajuste local de este script standalone. `listNumber` es meramente
 * informativo (no se escribe), así que la coerción no afecta lo que se persiste.
 */
function coerceListNumbers(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as { students?: unknown };
  if (!Array.isArray(obj.students)) return raw;
  const students = obj.students.map((s) => {
    if (s && typeof s === 'object' && 'listNumber' in s) {
      const ln = (s as { listNumber: unknown }).listNumber;
      if (typeof ln === 'number') return { ...s, listNumber: String(ln) };
    }
    return s;
  });
  return { ...obj, students };
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const doConfirm = args.includes('--confirm');
  if (!dir) {
    throw new Error(
      'Falta el directorio con los JSON. Uso: ... backfill-student-levels.ts <dir> [--confirm]',
    );
  }

  // ── Fase pura: parsear y clasificar los JSON (no toca la BD) ─────────────────
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const withStudents: ParsedReport[] = [];
  let noStudentsCount = 0;
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
    const parsed = officialReportImportFileSchema.safeParse(coerceListNumbers(raw));
    if (!parsed.success) {
      console.log(`  ✗ ${f} — no cumple el contrato: ${parsed.error.issues[0]?.message ?? ''}`);
      parseErrors++;
      continue;
    }
    if (!parsed.data.students || parsed.data.students.length === 0) {
      noStudentsCount++; // Diag/Cierre sin figura de niveles: se saltan en silencio.
      continue;
    }
    withStudents.push({ file: f, doc: parsed.data, label: labelFor(parsed.data) });
  }

  console.log(
    `\nParseados ${files.length} JSON · ${withStudents.length} con nómina por alumno · ` +
      `${noStudentsCount} sin nómina (omitidos) · ${parseErrors} con error de parseo`,
  );

  if (!process.env.DATABASE_ADMIN_URL) {
    throw new Error('Falta DATABASE_ADMIN_URL (túnel a demo). Fase de parseo OK; sin BD no sigo.');
  }

  const db = createDbClient(process.env.DATABASE_ADMIN_URL);
  const instruments = await buildInstrumentLookup(db);
  console.log(`Instrumentos DIA oficiales en demo: ${instruments.size}`);
  console.log(
    doConfirm
      ? '\n=== MODO CONFIRM (escribe assessment_results) ===\n'
      : '\n=== DRY-RUN (NO escribe; muestra lo que escribiría) ===\n',
  );

  let cohortsWritten = 0;
  let cohortsSkipped = 0;
  let studentsWritten = 0;

  for (const { doc, label } of withStudents) {
    const r = doc.report;
    const reported = doc.students ?? [];

    const instrumentId = findInstrument(instruments, r.subjectCode, r.gradeCode, r.period);
    if (!instrumentId) {
      console.log(`  ⏭️  ${label.padEnd(30)} — instrumento no encontrado en demo`);
      cohortsSkipped++;
      continue;
    }
    const classGroupId = await resolveClassGroup(db, r.gradeCode, r.courseLabel);
    if (!classGroupId) {
      console.log(
        `  ⏭️  ${label.padEnd(30)} — class group ${r.courseLabel} (${REPORT_YEAR}) no encontrado`,
      );
      cohortsSkipped++;
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

      const roster = await loadRoster(tx, CSCJ_ORG, classGroupId);
      const bands: PerformanceBandInput[] = await loadInstrumentBands(tx, instrumentId);

      // Resolver cada fila del informe. Se acumula por (studentId → {band, kind}).
      const byStudent = new Map<string, { band: PerformanceBandInput; kind: 'auto' | 'prefix' }>();
      let auto = 0;
      let prefix = 0;
      let ambiguous = 0;
      let notFound = 0;
      let noBand = 0;
      let conflict = 0;
      const unmatchedExamples: string[] = [];

      for (const s of reported) {
        const res = resolveStudent(s.name, roster);
        if (res.studentId === null) {
          if (res.kind === 'ambiguous') ambiguous++;
          else notFound++;
          if (unmatchedExamples.length < 2) {
            // Sin PII: sólo listNumber y el veredicto.
            unmatchedExamples.push(`#${s.listNumber ?? '?'}(${res.kind})`);
          }
          continue;
        }
        const band = resolveLevelBand(s.level, bands);
        if (!band) {
          noBand++;
          continue;
        }
        // Un mismo alumno de la nómina cruzado por 2 filas → conflicto: no se escribe
        // ninguna (igual criterio que el importador, que rechaza el par duplicado).
        if (byStudent.has(res.studentId)) {
          conflict++;
          byStudent.delete(res.studentId);
          continue;
        }
        byStudent.set(res.studentId, { band, kind: res.kind });
        if (res.kind === 'auto') auto++;
        else prefix++;
      }

      const writable = byStudent.size;
      const rate = reported.length > 0 ? ((writable / reported.length) * 100).toFixed(0) : '0';
      const examples =
        unmatchedExamples.length > 0 ? ` · sin match: ${unmatchedExamples.join(', ')}` : '';
      const summary =
        `assessment ${found.id} · N ${reported.length} · auto ${auto} · prefijo ${prefix} · ` +
        `ambiguo ${ambiguous} · no encontrado ${notFound} · sin banda ${noBand} · ` +
        `conflicto ${conflict} · escribibles ${writable} (${rate}%)${examples}`;

      if (writable === 0) {
        console.log(`  ⏭️  ${label.padEnd(30)} — 0 escribibles · ${summary}`);
        return 'skip' as const;
      }

      if (!doConfirm) {
        console.log(`  ✓ ${label.padEnd(30)} — ${summary}`);
        studentsWritten += writable;
        return 'match' as const;
      }

      // Idempotente: onConflictDoUpdate sobre (assessmentId, studentId) — idéntico al
      // importador (official-report-import.service.ts). `percentage` va NULL a
      // propósito: el informe entrega el nivel, no el % del alumno.
      const now = new Date();
      await tx
        .insert(assessmentResults)
        .values(
          [...byStudent.entries()].map(([studentId, { band }]) => ({
            assessmentId: found.id,
            studentId,
            totalScore: null,
            maxScore: null,
            percentage: null,
            grade: null,
            metricType: 'band' as const,
            bandLabel: band.label,
            performanceBandId: band.id,
            performanceLevel: null,
            isComplete: true,
            completedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [assessmentResults.assessmentId, assessmentResults.studentId],
          set: {
            totalScore: sql`excluded.total_score`,
            maxScore: sql`excluded.max_score`,
            percentage: sql`excluded.percentage`,
            grade: sql`excluded.grade`,
            metricType: sql`excluded.metric_type`,
            bandLabel: sql`excluded.band_label`,
            performanceBandId: sql`excluded.performance_band_id`,
            performanceLevel: sql`excluded.performance_level`,
            isComplete: sql`excluded.is_complete`,
            completedAt: sql`excluded.completed_at`,
            updatedAt: now,
          },
        });
      console.log(`  ✓ ${label.padEnd(30)} — ESCRITO · ${summary}`);
      studentsWritten += writable;
      return 'match' as const;
    });

    if (outcome === 'match') cohortsWritten++;
    else cohortsSkipped++;
  }

  const verb = doConfirm ? 'escritas' : 'matchearían';
  console.log(
    `\n=== ${cohortsWritten} cohorte(s) ${verb} · ${studentsWritten} alumno(s) ${doConfirm ? 'escritos' : 'a escribir'} · ` +
      `${cohortsSkipped} cohorte(s) skipeadas · ${noStudentsCount} sin nómina (de ${files.length} JSON) ===`,
  );
  if (!doConfirm && cohortsWritten > 0) {
    console.log('Re-correr con --confirm para persistir en assessment_results.');
    console.log('Los alumnos sin match quedan para revisión manual (no se escriben).');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
