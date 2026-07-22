/**
 * Carga de respuestas DIA reales de un colegio a partir del artefacto JSON
 * producido por el parser del xlsx de digitación (paso 1). Replica FIELMENTE la
 * lógica de `AnswerSheetsService.confirm()` (scoring por estrategia + agregación
 * pura de @soe/types) pero en modo batch para un archivo completo (varios cursos),
 * con pocos INSERT masivos por eficiencia de red (RDS por túnel).
 *
 *   Dry-run (default):  DATABASE_ADMIN_URL=... tsx src/seed/import-dia-responses.ts <courses.json>
 *   Commit real:        DATABASE_ADMIN_URL=... tsx src/seed/import-dia-responses.ts <courses.json> --commit
 *
 * Args de contexto (con defaults para DIA Lenguaje Intermedio 2025 de CSCJ):
 *   --org=<uuid> --subject=Lectura --period=intermedio --periodLabel=Intermedio
 *   --year=2025 --loadKey=<clave-idempotencia> --source=<archivo-origen>
 *
 * Idempotente: borra y reinserta los assessments (y sus hijos) que tengan el
 * mismo `config.loadKey` en la org.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFileSync } from 'fs';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '../schema';
import { withOrgContext } from '../with-org-context';
import { instruments } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import { classGroups, grades } from '../schema/academic';
import { students } from '../schema/students';
import { assessments, assessmentCourseAssignments, importJobs } from '../schema/assessments';
import { responses } from '../schema/responses';
import { assessmentResults, skillResults } from '../schema/results';
import { recomputeCohortStatsFromResponses } from '../queries/cohort-stats';
import {
  aggregateStudentResults,
  aggregateSkillResults,
  DEFAULT_GRADING_SCALE,
  normalizeRut,
  isAutoScorable,
  type ResponseForCalculation,
  type ResponseForItemStats,
} from '@soe/types';

/**
 * Una respuesta lista para los DOS agregadores: resultados por alumno
 * (`ResponseForCalculation`) y read-model de cohorte (`ResponseForItemStats`). Es la
 * misma intersección que usa la API (`ResponseForPersist`).
 */
type CalcRow = ResponseForCalculation & ResponseForItemStats;

/** Ver la nota de `hasAlternatives` en `@soe/types/utils/item-stats-calculator`. */
function itemHasAlternatives(content: unknown): boolean {
  const alternatives = (content as { alternatives?: unknown } | null)?.alternatives;
  return Array.isArray(alternatives) && alternatives.length > 0;
}

// ── Args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const positional = argv.filter((a) => !a.startsWith('--'));
const coursesJsonArg = positional[0];
if (!coursesJsonArg) throw new Error('Falta ruta al courses.json (arg posicional)');
const COURSES_JSON: string = coursesJsonArg;
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001'); // CSCJ
const SUBJECT_LABEL = opt('subject', 'Lectura');
const PERIOD = opt('period', 'intermedio');
const PERIOD_LABEL = opt('periodLabel', 'Intermedio');
const YEAR = parseInt(opt('year', '2025'), 10);
const LOAD_KEY = opt('loadKey', 'dia-lenguaje-intermedio-2025');
const SOURCE_FILE = opt('source', 'DIA 2025 - Lenguaje - Intermedio.xlsx');
const IMPORT_FORMAT = 'generic_csv';

// ── Tipos del artefacto ──────────────────────────────────────────────────────
type Course = {
  sheet: string;
  gradeLevel: number;
  section: string;
  mcPositions: number[];
  rows: Array<{ rut: string; answers: Record<string, string | null> }>;
};

// ── Cliente (RDS: SSL sin verificación de CA; el rol admin NO bypassa FORCE RLS
//    → toda escritura corre en withOrgContext) ───────────────────────────────
const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL para local)');
// SSL solo contra RDS remoto; en Postgres local (localhost) sin TLS lo desactivamos.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});
const db = drizzle(client, { schema });

const CHUNK = 3000; // filas por INSERT (bajo el límite de bind-params de PG)
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Deriva la clave correcta de un content MCQ (igual que multiple-choice.strategy). */
function extractMcqCorrectKey(content: unknown): string {
  const c = content as { correctKey?: unknown; alternatives?: unknown };
  if (typeof c.correctKey === 'string' && c.correctKey.trim()) return c.correctKey.trim().toUpperCase();
  if (Array.isArray(c.alternatives)) {
    for (const alt of c.alternatives) {
      if (alt && typeof alt === 'object' && (alt as { isCorrect?: unknown }).isCorrect === true) {
        const k = (alt as { key?: unknown }).key;
        if (typeof k === 'string') return k.trim().toUpperCase();
      }
    }
  }
  return '';
}

async function main() {
  const courses: Course[] = JSON.parse(readFileSync(COURSES_JSON, 'utf8'));
  const now = new Date();

  await withOrgContext(db, ORG_ID, async (tx) => {
    // 1. Roster de la org: mapa RUT normalizado → studentId.
    const roster = await tx
      .select({ id: students.id, rut: students.rut })
      .from(students)
      .where(and(eq(students.orgId, ORG_ID), dsql`${students.deletedAt} is null`));
    const rutToId = new Map<string, string>();
    for (const s of roster) {
      const n = safeRut(s.rut);
      if (n) rutToId.set(n, s.id);
    }

    // 2. Class_groups de la org por (gradeLevel, section) → id.
    //    grades.shortName = '3B'..'6B'; classGroups.name = 'A'/'B'.
    const cgRows = await tx
      .select({ id: classGroups.id, name: classGroups.name, gshort: grades.shortName })
      .from(classGroups)
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(eq(classGroups.orgId, ORG_ID));
    const cgKey = (lvl: number, sec: string) => `${lvl}B|${sec.toUpperCase()}`;
    const cgMap = new Map<string, string>();
    for (const c of cgRows) cgMap.set(`${c.gshort}|${(c.name ?? '').toUpperCase()}`, c.id);

    // 3. Instrumentos objetivo por grado (uno por gradeLevel presente).
    const gradeLevels = [...new Set(courses.map((c) => c.gradeLevel))];
    const instByGrade = new Map<number, { id: string; name: string; gradingScaleId: string | null }>();
    for (const lvl of gradeLevels) {
      const name = `DIA ${SUBJECT_LABEL} ${lvl}° Básico ${YEAR} — ${PERIOD_LABEL}`;
      const [inst] = await tx
        .select({ id: instruments.id, name: instruments.name, gradingScaleId: instruments.gradingScaleId })
        .from(instruments)
        .where(and(eq(instruments.name, name), dsql`${instruments.orgId} is null`, dsql`${instruments.deletedAt} is null`));
      if (!inst) throw new Error(`Instrumento no encontrado: "${name}"`);
      instByGrade.set(lvl, inst);
    }

    // 4. Cargar items + tags de cada instrumento.
    const instIds = [...instByGrade.values()].map((i) => i.id);
    const allItems = await tx
      .select({ id: items.id, instrumentId: items.instrumentId, position: items.position, type: items.type, content: items.content, scoringConfig: items.scoringConfig })
      .from(items)
      .where(inArray(items.instrumentId, instIds));
    const allTags = await tx
      .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
      .from(itemTaxonomyTags)
      .where(inArray(itemTaxonomyTags.itemId, allItems.map((i) => i.id)));
    const tagsByItem = new Map<string, string[]>();
    for (const t of allTags) {
      const l = tagsByItem.get(t.itemId) ?? [];
      l.push(t.nodeId);
      tagsByItem.set(t.itemId, l);
    }
    const itemsByInst = new Map<string, typeof allItems>();
    for (const it of allItems) {
      if (it.instrumentId == null) continue; // items siempre traen instrumentId (filtrados por inArray)
      const l = itemsByInst.get(it.instrumentId) ?? [];
      l.push(it);
      itemsByInst.set(it.instrumentId, l);
    }

    // 5. Idempotencia: borrar carga previa con el mismo loadKey.
    const prior = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.orgId, ORG_ID), dsql`${assessments.config}->>'loadKey' = ${LOAD_KEY}`));
    const priorIds = prior.map((p) => p.id);
    if (COMMIT && priorIds.length) {
      await tx.delete(responses).where(inArray(responses.assessmentId, priorIds));
      await tx.delete(assessmentResults).where(inArray(assessmentResults.assessmentId, priorIds));
      await tx.delete(skillResults).where(inArray(skillResults.assessmentId, priorIds));
      await tx.delete(importJobs).where(inArray(importJobs.assessmentId, priorIds));
      await tx.delete(assessmentCourseAssignments).where(inArray(assessmentCourseAssignments.assessmentId, priorIds));
      await tx.delete(assessments).where(inArray(assessments.id, priorIds));
      console.log(`  idempotencia: borrados ${priorIds.length} assessments previos (loadKey=${LOAD_KEY})`);
    }

    // 6. Procesar cada curso → construir filas en memoria.
    type PendingCourse = {
      course: Course;
      instId: string;
      classGroupId: string;
      studentIds: string[];
      unmatched: string[];
      responseRows: Array<typeof responses.$inferInsert>;
      calc: CalcRow[];
    };
    const pending: PendingCourse[] = [];
    let totalUnmatched = 0;

    for (const course of courses) {
      const inst = instByGrade.get(course.gradeLevel)!;
      const cgId = cgMap.get(cgKey(course.gradeLevel, course.section));
      if (!cgId) throw new Error(`class_group no encontrado: ${course.sheet} (${cgKey(course.gradeLevel, course.section)})`);
      const instItems = itemsByInst.get(inst.id)!;
      // validar alineación de posiciones MC
      const instMcPos = instItems.filter((i) => i.type === 'multiple_choice').map((i) => i.position).sort((a, b) => a - b);
      const sheetPos = [...course.mcPositions].sort((a, b) => a - b);
      if (JSON.stringify(instMcPos) !== JSON.stringify(sheetPos))
        console.warn(`  ⚠ ${course.sheet}: posiciones MC no calzan inst=[${instMcPos}] sheet=[${sheetPos}]`);

      const responseRows: Array<typeof responses.$inferInsert> = [];
      const calc: CalcRow[] = [];
      const studentIds: string[] = [];
      const unmatched: string[] = [];

      for (const row of course.rows) {
        const n = safeRut(row.rut);
        const studentId = n ? rutToId.get(n) : undefined;
        if (!studentId) { unmatched.push(row.rut); totalUnmatched++; continue; }
        studentIds.push(studentId);

        for (const item of instItems) {
          const maxScore = ((item.scoringConfig as { points?: number } | null)?.points) ?? 1;
          const rawAnswer = row.answers[String(item.position)] ?? null;
          const nodeIds = tagsByItem.get(item.id) ?? [];

          if (!isAutoScorable(item.type)) {
            // no autocorregible (open_ended...) → pendiente, scores null
            responseRows.push({
              assessmentId: '', studentId, itemId: item.id, value: { answer: rawAnswer },
              isCorrect: null, rawScore: null, maxScore: maxScore.toFixed(2), finalScore: null,
              scoredBy: 'human', scoredAt: null,
            });
            calc.push({ studentId, itemId: item.id, itemPosition: item.position, rawScore: null, maxScore, finalScore: null, isCorrect: null, taxonomyNodeIds: nodeIds, value: { answer: rawAnswer }, hasAlternatives: itemHasAlternatives(item.content) });
            continue;
          }
          // autocorregible: nuestros ítems son multiple_choice
          const key = extractMcqCorrectKey(item.content);
          const ans = typeof rawAnswer === 'string' && rawAnswer.trim() ? rawAnswer.trim() : null;
          const isCorrect = ans === null ? false : ans.toUpperCase() === key;
          const rawScore = isCorrect ? maxScore : 0;
          responseRows.push({
            assessmentId: '', studentId, itemId: item.id, value: { answer: rawAnswer },
            isCorrect, rawScore: rawScore.toFixed(2), maxScore: maxScore.toFixed(2), finalScore: rawScore.toFixed(2),
            scoredBy: 'auto', scoredAt: now,
          });
          calc.push({ studentId, itemId: item.id, itemPosition: item.position, rawScore, maxScore, finalScore: rawScore, isCorrect, taxonomyNodeIds: nodeIds, value: { answer: rawAnswer }, hasAlternatives: itemHasAlternatives(item.content) });
        }
      }
      pending.push({ course, instId: inst.id, classGroupId: cgId, studentIds, unmatched, responseRows, calc });
    }

    // 7. Insert de assessments (1 insert), assignments (1 insert).
    const assessmentValues = pending.map((p) => ({
      orgId: ORG_ID,
      instrumentId: p.instId,
      name: `DIA ${SUBJECT_LABEL} ${p.course.gradeLevel}° Básico ${YEAR} — ${PERIOD_LABEL} · ${p.course.section}`,
      mode: 'paper' as const,
      status: 'completed' as const,
      administeredAt: now,
      administeredById: null,
      config: { source: IMPORT_FORMAT, period: PERIOD, subject: SUBJECT_LABEL, loadKey: LOAD_KEY, classGroupId: p.classGroupId, sourceFile: SOURCE_FILE },
    }));

    // Reportar (dry-run y commit).
    console.log(`\n== ${SOURCE_FILE} → org ${ORG_ID} (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ==`);
    let totResp = 0;
    for (const p of pending) {
      const scored = p.calc.filter((c) => c.isCorrect !== null);
      const correct = scored.filter((c) => c.isCorrect).length;
      const pct = scored.length ? ((100 * correct) / scored.length).toFixed(1) : '–';
      totResp += p.responseRows.length;
      console.log(`  ${p.course.sheet}: alumnos=${p.studentIds.length} unmatched=${p.unmatched.length} responses=${p.responseRows.length} %correcto_curso=${pct}${p.unmatched.length ? ' RUTsinmatch=' + p.unmatched.join(',') : ''}`);
    }
    console.log(`  TOTAL: assessments=${pending.length} responses=${totResp} unmatched=${totalUnmatched}`);

    if (!COMMIT) { console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)'); return; }

    const insertedAssess = await tx.insert(assessments).values(assessmentValues).returning({ id: assessments.id });
    const assessIdByIdx = insertedAssess.map((a) => a.id);
    await tx.insert(assessmentCourseAssignments).values(
      pending.map((p, i) => {
        const assessmentId = assessIdByIdx[i];
        if (!assessmentId) throw new Error(`Falta assessmentId para el curso índice ${i}`);
        return { assessmentId, classGroupId: p.classGroupId };
      }),
    );

    // 8. Responses (chunked), results, skills y read-model de cohorte por curso.
    const allResponses: Array<typeof responses.$inferInsert> = [];
    const arValues: Array<typeof assessmentResults.$inferInsert> = [];
    const srValues: Array<typeof skillResults.$inferInsert> = [];
    const cohortStatsInput: Array<{ assessmentId: string; calc: CalcRow[]; skills: Array<{ studentId: string; nodeId: string; correctCount: number; totalCount: number; percentage: number | null }> }> = [];
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const assessmentId = assessIdByIdx[i];
      if (!p || !assessmentId) continue; // ambos garantizados por construcción (misma longitud)
      for (const r of p.responseRows) allResponses.push({ ...r, assessmentId });

      const scale = DEFAULT_GRADING_SCALE; // instrumentos DIA: gradingScaleId null
      const autoScored = p.calc.filter((c) => c.isCorrect !== null);
      const withPending = new Set(p.calc.filter((c) => c.isCorrect === null).map((c) => c.studentId));
      const studentAgg = aggregateStudentResults(autoScored, scale);
      const skillAgg = aggregateSkillResults(p.calc, scale);
      for (const a of studentAgg) {
        arValues.push({
          assessmentId, studentId: a.studentId,
          totalScore: a.totalScore.toFixed(2), maxScore: a.maxScore.toFixed(2),
          percentage: (a.percentage * 100).toFixed(2), grade: a.grade.toFixed(2),
          performanceLevel: a.performanceLevel,
          isComplete: a.isComplete && !withPending.has(a.studentId),
          completedAt: now,
        });
      }
      for (const a of skillAgg) {
        srValues.push({
          assessmentId, studentId: a.studentId, nodeId: a.nodeId,
          correctCount: a.correctCount, totalCount: a.totalCount,
          percentage: (a.percentage * 100).toFixed(2), performanceLevel: a.performanceLevel,
        });
      }
      cohortStatsInput.push({
        assessmentId,
        calc: p.calc,
        // El escritor del read-model trabaja en 0..1; la columna es 0..100.
        skills: skillAgg.map((a) => ({ studentId: a.studentId, nodeId: a.nodeId, correctCount: a.correctCount, totalCount: a.totalCount, percentage: a.percentage })),
      });
    }
    for (const c of chunk(allResponses, CHUNK)) await tx.insert(responses).values(c);
    for (const c of chunk(arValues, CHUNK)) await tx.insert(assessmentResults).values(c);
    for (const c of chunk(srValues, CHUNK)) await tx.insert(skillResults).values(c);

    // 8b. Read-model de cohorte (assessment_item_stats / assessment_skill_stats).
    // NO es opcional: los dashboards de habilidades, el heatmap y la matriz
    // alumno×pregunta LEEN de acá, no de `responses`. Sin estas filas la carga deja la
    // analítica vacía aunque las respuestas estén completas. Se usa el MISMO escritor
    // que la API para que este script no sea un camino paralelo que pueda divergir.
    let itemStatRows = 0;
    let skillStatRows = 0;
    let orphanTotal = 0;
    for (const s of cohortStatsInput) {
      const res = await recomputeCohortStatsFromResponses(tx, {
        assessmentId: s.assessmentId,
        responses: s.calc,
        skillResults: s.skills,
      });
      itemStatRows += res.itemRows;
      skillStatRows += res.skillRows;
      orphanTotal += res.orphanResponses;
    }
    if (orphanTotal > 0) {
      console.warn(`  ⚠️ ${orphanTotal} respuesta(s) de alumnos sin matrícula quedaron FUERA del read-model`);
    }

    // 9. import_jobs (1 insert, uno por assessment/curso).
    await tx.insert(importJobs).values(
      pending.map((p, i) => ({
        orgId: ORG_ID, assessmentId: assessIdByIdx[i], type: 'answer_sheet_csv' as const,
        status: (p.unmatched.length ? 'partial' : 'completed') as 'partial' | 'completed',
        fileUrl: null,
        mappingConfig: { format: IMPORT_FORMAT, instrumentId: p.instId, columnMapping: { rut: 'rut', questionsPrefix: 'P' }, sourceFile: SOURCE_FILE },
        result: { rowsProcessed: p.studentIds.length, errors: p.unmatched.length, warnings: 0 },
        errorLog: p.unmatched.map((rut) => ({ row: 0, message: `RUT sin match: ${rut}` })),
        createdById: null, completedAt: now,
      })),
    );

    console.log(`\n✅ COMMIT: ${insertedAssess.length} assessments · ${allResponses.length} responses · ${arValues.length} assessment_results · ${srValues.length} skill_results · ${itemStatRows} assessment_item_stats · ${skillStatRows} assessment_skill_stats`);
  });

  await client.end();
}

function safeRut(r: string): string | null {
  try {
    const n = normalizeRut(r);
    return n && typeof n === 'string' ? n : null;
  } catch {
    return null;
  }
}

main().catch((e) => { console.error('ERR:', e); process.exit(1); });
