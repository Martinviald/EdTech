/**
 * Carga a la BDD el artefacto de `01-convertir-respuestas.cjs`: crea un
 * `assessment` por (instrumento × curso), sus `responses`, y persiste
 * `assessment_results`, `skill_results` y el read-model de cohorte, replicando
 * la lógica de `AnswerSheetsService.confirm()` en modo batch.
 *
 * El instrumento se resuelve por (gradeId, subjectId, year, applicationPeriod)
 * sobre los instrumentos de catálogo (`org_id is null`), nunca por nombre.
 *
 * Matching de alumnos, en orden, quedándose sólo con el candidato ÚNICO:
 *   1. RUT exacto (normalizeRut, con dígito verificador válido)
 *   2. cuerpo del RUT (absorbe dígitos verificadores mal escaneados)
 *   3. identificador crudo, comparado como string — un IPE (Identificador
 *      Provisorio Escolar, para alumnos extranjeros sin RUN) no pasa Módulo 11
 *      y no es un RUT, pero el roster lo guarda literal y así se encuentra
 *   4. nombre: TODOS los apellidos del roster más su primer nombre presentes en
 *      el nombre del informe, como multiconjunto (un apellido repetido exige dos
 *      apariciones) y sin importar el orden — el informe alterna entre
 *      "APELLIDOS NOMBRES" y "NOMBRES APELLIDOS"
 *   5. nombre tolerando UN typo por token de 5+ letras (Campo/Campos,
 *      Cisterna/Cisternas, Guilermo/Guillermo)
 * Si ninguna vía deja un candidato único y la fila trae identificador, el alumno
 * se crea y se matricula en el curso del año destino. Una fila sin identificador
 * y sin match por nombre se reporta como `sin match` y no se carga.
 *
 * Se autocorrige cada tipo con la clave que le corresponde, porque cada uno la
 * guarda en un lugar distinto: `multiple_choice` en `content.correctKey` o la
 * alternativa marcada, `true_false` en `content.correctAnswer`, `multi_select`
 * en el conjunto de alternativas correctas, y `matching` en
 * `scoring_config.matchPairs`. Usar el extractor de MC para todos los marcaba
 * SIEMPRE incorrectos.
 *
 * `open_ended` no es autocorregible, y tampoco lo es una respuesta que no se
 * puede interpretar sin adivinar. Esos quedan con score null, pendientes de
 * corrección humana, excluidos del numerador y del denominador.
 *
 * Las posiciones de la planilla deben coincidir EXACTAMENTE con las del
 * instrumento: una planilla con columnas sub-numeradas (`P19.1`) desplaza todo
 * lo que viene después y corrige contra el ítem equivocado sin fallar nunca.
 *
 * Idempotente: borra y reinserta los assessments con el mismo `config.loadKey`.
 *
 *   Dry-run:  DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx "src/seed/import-dia-2026-responses.ts"
 *   Commit:   ... --commit
 *
 * Args: --org=<uuid> --year=<año> --loadKey=<clave> --input=<ruta.json>
 *       --only=<GRADE_CODE:SECCION:Asignatura,...>  (subconjunto, para pruebas)
 *       --administeredAt=<YYYY-MM-DD>  (fecha de aplicación; por defecto, hoy)
 *
 * `--administeredAt` importa en las cargas históricas: `resolveAssessmentYear`
 * deriva el año lectivo de esa fecha para bucketizar el read-model cuando el
 * alumno no está matriculado en el curso asignado. Fechar una evaluación de 2025
 * con la fecha de hoy la ancla al año equivocado.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '../schema';
import { withOrgContext } from '../with-org-context';
import { instruments } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import { classGroups, grades, subjects } from '../schema/academic';
import { academicYears } from '../schema/organizations';
import { students, studentEnrollments } from '../schema/students';
import { assessments, assessmentCourseAssignments, importJobs } from '../schema/assessments';
import { responses } from '../schema/responses';
import { assessmentResults, skillResults } from '../schema/results';
import { recomputeCohortStatsFromResponses } from '../queries/cohort-stats';
import {
  aggregateStudentResults,
  aggregateSkillResults,
  DEFAULT_GRADING_SCALE,
  normalizeRut,
  getScoringStrategy,
  parsePositionalMatchingAnswer,
  type ItemContent,
  type MatchingSide,
  type ResponseForCalculation,
  type ResponseForItemStats,
  type ScoringConfig,
} from '@soe/types';

type CalcRow = ResponseForCalculation & ResponseForItemStats;

type ScorableItem = Pick<
  typeof items.$inferSelect,
  'id' | 'type' | 'content' | 'scoringConfig' | 'position'
>;

type CourseArtifact = {
  file: string;
  sourceFile: string;
  gradeCode: string;
  section: string;
  subjectName: string;
  year: number;
  applicationPeriod: string;
  questionCount: number;
  itemTypes: Record<string, string | null>;
  rows: Array<{ rut: string; nombre: string; answers: Record<string, string | null> }>;
};

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const YEAR = parseInt(opt('year', '2026'), 10);
const LOAD_KEY = opt('loadKey', 'dia-2026-monitoreo-intermedio');
const DEFAULT_INPUT = resolve(
  __dirname,
  '../../../../scripts/cscj/dia-2026/out/dia-2026-respuestas.json',
);
const INPUT = resolve(opt('input', DEFAULT_INPUT));
const ONLY_FILE = opt('onlyFile', '');
const ONLY = (
  ONLY_FILE ? readFileSync(resolve(ONLY_FILE), 'utf8').split('\n') : opt('only', '').split(',')
)
  .map((s) => s.trim())
  .filter(Boolean);
if (ONLY_FILE && opt('only', '')) throw new Error('Usá --only o --onlyFile, no los dos');
const IMPORT_FORMAT = 'generic_csv';
const CHUNK = 3000;
const ADMINISTERED_AT = opt('administeredAt', '');
if (ADMINISTERED_AT && !/^\d{4}-\d{2}-\d{2}$/.test(ADMINISTERED_AT)) {
  throw new Error(`--administeredAt debe ser YYYY-MM-DD, llegó "${ADMINISTERED_AT}"`);
}

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});
const db = drizzle(client, { schema });

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function safeRut(value: string): string | null {
  try {
    const n = normalizeRut(value);
    return n && typeof n === 'string' ? n : null;
  } catch {
    return null;
  }
}

function rutBody(value: string): string | null {
  const body = rawIdentifier(value).split('-')[0];
  return body && /^\d+$/.test(body) ? body : null;
}

function rawIdentifier(value: string): string {
  return value.replace(/[.\s]/g, '').toUpperCase();
}

const MIN_TOKEN_LENGTH_FOR_TYPO_TOLERANCE = 5;

function nameTokens(value: string): string[] {
  const normalized = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.split(' ') : [];
}

function differsByAtMostOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (
    a.length < MIN_TOKEN_LENGTH_FOR_TYPO_TOLERANCE ||
    b.length < MIN_TOKEN_LENGTH_FOR_TYPO_TOLERANCE ||
    Math.abs(a.length - b.length) > 1
  ) {
    return false;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return (previous[b.length] as number) <= 1;
}

function consumesEveryToken(
  required: string[],
  available: string[],
  tolerateTypo: boolean,
): boolean {
  const pool = [...available];
  for (const token of required) {
    const at = pool.findIndex((candidate) =>
      tolerateTypo ? differsByAtMostOneEdit(candidate, token) : candidate === token,
    );
    if (at < 0) return false;
    pool.splice(at, 1);
  }
  return true;
}

function itemHasAlternatives(content: unknown): boolean {
  const alternatives = (content as { alternatives?: unknown } | null)?.alternatives;
  return Array.isArray(alternatives) && alternatives.length > 0;
}

function matchingSidesOf(content: unknown, side: 'leftItems' | 'rightItems'): MatchingSide[] {
  const raw = (content as Record<string, unknown> | null)?.[side];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { id } = entry as { id?: unknown };
    return typeof id === 'string' ? [{ id }] : [];
  });
}

/**
 * Traduce la celda de la planilla al `rawAnswer` que espera la estrategia del
 * tipo. Sólo `matching` necesita traducción: la hoja trae una secuencia
 * posicional de dígitos ("2,5,3,4") y la estrategia corrige contra
 * `content.correctPairs`. Los demás tipos consumen el string tal cual.
 *
 * Este es el único conocimiento del formato de la planilla que queda en el
 * importador. La corrección en sí no vive acá: la hace `getScoringStrategy`, la
 * misma que usa la app, para que la ingesta y el análisis por ítem no puedan
 * volver a discrepar.
 */
function toStrategyAnswer(item: ScorableItem, answer: string | null): unknown {
  if (answer === null) return null;
  if (item.type !== 'matching') return answer;
  return parsePositionalMatchingAnswer(
    answer,
    matchingSidesOf(item.content, 'leftItems'),
    matchingSidesOf(item.content, 'rightItems'),
  );
}

function scoreWithRegistry(item: ScorableItem, maxScore: number, answer: string | null) {
  return getScoringStrategy(item.type).score({
    item: {
      id: item.id,
      type: item.type,
      content: item.content as ItemContent,
      maxScore,
      scoringConfig: (item.scoringConfig ?? undefined) as ScoringConfig | undefined,
    },
    rawAnswer: toStrategyAnswer(item, answer),
  });
}

function splitFullName(nombre: string): { firstName: string; lastName: string } {
  const parts = nombre.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: nombre, lastName: nombre };
  const firstName = parts[parts.length - 1] as string;
  const lastName = parts.slice(0, -1).join(' ');
  return { firstName, lastName };
}

async function main() {
  const artifact = JSON.parse(readFileSync(INPUT, 'utf8')) as {
    year: number;
    courses: CourseArtifact[];
  };
  const courseKey = (c: CourseArtifact) => `${c.gradeCode}:${c.section}:${c.subjectName}`;
  const courses = ONLY.length
    ? artifact.courses.filter((c) => ONLY.includes(courseKey(c)))
    : artifact.courses;
  if (!courses.length) throw new Error('El artefacto no tiene cursos que procesar');
  if (ONLY.length) {
    const enArtefacto = new Set(artifact.courses.map(courseKey));
    const sinCalce = ONLY.filter((k) => !enArtefacto.has(k));
    if (sinCalce.length) {
      throw new Error(
        `--only pide ${ONLY.length} cursos y ${sinCalce.length} no existen en el artefacto: ` +
          `${sinCalce.join(' · ')}. El borrado por loadKey NO se acota con --only, así que seguir ` +
          `dejaría esos cursos borrados y sin recrear.`,
      );
    }
  }
  const now = new Date();
  const administeredAt = ADMINISTERED_AT ? new Date(`${ADMINISTERED_AT}T12:00:00Z`) : now;

  await withOrgContext(db, ORG_ID, async (tx) => {
    const [year] = await tx
      .select({ id: academicYears.id })
      .from(academicYears)
      .where(and(eq(academicYears.orgId, ORG_ID), eq(academicYears.year, YEAR)));
    if (!year) throw new Error(`No existe academic_year ${YEAR} para la org`);

    const gradeRows = await tx
      .select({ id: grades.id, code: grades.code, name: grades.name })
      .from(grades);
    const gradeByCode = new Map(gradeRows.map((g) => [g.code, g]));

    const subjectRows = await tx.select({ id: subjects.id, name: subjects.name }).from(subjects);
    const subjectByName = new Map(subjectRows.map((s) => [s.name, s]));

    const groupRows = await tx
      .select({ id: classGroups.id, name: classGroups.name, gradeId: classGroups.gradeId })
      .from(classGroups)
      .where(and(eq(classGroups.orgId, ORG_ID), eq(classGroups.academicYearId, year.id)));
    const groupByKey = new Map(
      groupRows.map((g) => [`${g.gradeId}|${g.name.toUpperCase()}`, g.id]),
    );

    const instrumentRows = await tx
      .select({
        id: instruments.id,
        name: instruments.name,
        gradeId: instruments.gradeId,
        subjectId: instruments.subjectId,
        applicationPeriod: instruments.applicationPeriod,
      })
      .from(instruments)
      .where(
        and(
          eq(instruments.year, YEAR),
          dsql`${instruments.orgId} is null`,
          dsql`${instruments.deletedAt} is null`,
        ),
      );
    /**
     * Varios instrumentos pueden compartir (grado, asignatura, momento, año): en
     * 2026 el catálogo tiene el instrumento real de 2° Básico y además fixtures
     * `[DEMO]` sin ítems que sostienen el benchmarking. Quedarse con el último
     * del Map elegía uno en silencio y podía tocar el equivocado, así que se
     * resuelve por el que TIENE ítems y se falla si hay más de uno.
     */
    const itemCountRows = await tx
      .select({ instrumentId: items.instrumentId, n: dsql<number>`count(*)::int` })
      .from(items)
      .groupBy(items.instrumentId);
    const itemCountByInstrument = new Map(
      itemCountRows.flatMap((r) => (r.instrumentId ? [[r.instrumentId, Number(r.n)]] : [])),
    );
    const instrumentsByKey = new Map<string, typeof instrumentRows>();
    for (const i of instrumentRows) {
      const key = `${i.gradeId}|${i.subjectId}|${i.applicationPeriod}`;
      const list = instrumentsByKey.get(key) ?? [];
      list.push(i);
      instrumentsByKey.set(key, list);
    }
    const itemCountOf = (id: string): number => itemCountByInstrument.get(id) ?? 0;
    const resolveInstrument = (key: string, etiqueta: string) => {
      const candidatos = instrumentsByKey.get(key) ?? [];
      const conItems = candidatos.filter((c) => itemCountOf(c.id) > 0);
      if (conItems.length === 1) return conItems[0];
      if (conItems.length === 0) {
        const vacios = candidatos.map((c) => `"${c.name}"`).join(', ');
        throw new Error(
          `Instrumento no encontrado para ${etiqueta}` +
            (vacios ? ` — hay ${candidatos.length} sin ítems: ${vacios}` : ''),
        );
      }
      throw new Error(
        `Instrumento ambiguo para ${etiqueta}: ${conItems.map((c) => `"${c.name}" (${itemCountOf(c.id)} ítems)`).join(' · ')}`,
      );
    };

    const roster = await tx
      .select({
        id: students.id,
        rut: students.rut,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .where(and(eq(students.orgId, ORG_ID), dsql`${students.deletedAt} is null`));
    const byExactRut = new Map<string, string>();
    const byRutBody = new Map<string, string[]>();
    const byRawIdentifier = new Map<string, string[]>();
    const byRequiredNameTokens: Array<{ id: string; required: string[] }> = [];

    const indexStudent = (student: {
      id: string;
      rut: string;
      firstName: string;
      lastName: string;
    }) => {
      const exact = safeRut(student.rut);
      if (exact) byExactRut.set(exact, student.id);
      const body = rutBody(student.rut);
      if (body) byRutBody.set(body, [...(byRutBody.get(body) ?? []), student.id]);
      const raw = rawIdentifier(student.rut);
      if (raw) byRawIdentifier.set(raw, [...(byRawIdentifier.get(raw) ?? []), student.id]);
      const surnames = nameTokens(student.lastName);
      const givenNames = nameTokens(student.firstName);
      if (surnames.length && givenNames.length) {
        byRequiredNameTokens.push({
          id: student.id,
          required: [...surnames, givenNames[0] as string],
        });
      }
    };
    for (const s of roster) indexStudent(s);

    const matchByName = (nombre: string, tolerateTypo: boolean): string | null => {
      const available = nameTokens(nombre);
      if (!available.length) return null;
      const hits = byRequiredNameTokens.filter((entry) =>
        consumesEveryToken(entry.required, available, tolerateTypo),
      );
      return hits.length === 1 ? (hits[0] as { id: string }).id : null;
    };

    type Resolution = {
      id: string;
      via: 'rut' | 'cuerpo-rut' | 'identificador' | 'nombre' | 'nombre~';
    };
    const resolveStudent = (rut: string, nombre: string): Resolution | null => {
      const exact = safeRut(rut);
      const exactHit = exact ? byExactRut.get(exact) : undefined;
      if (exactHit) return { id: exactHit, via: 'rut' };

      const body = rutBody(rut);
      const byBody = body ? (byRutBody.get(body) ?? []) : [];
      if (byBody.length === 1) return { id: byBody[0] as string, via: 'cuerpo-rut' };

      const raw = rawIdentifier(rut);
      const byRaw = raw ? (byRawIdentifier.get(raw) ?? []) : [];
      if (byRaw.length === 1) return { id: byRaw[0] as string, via: 'identificador' };

      const exactName = matchByName(nombre, false);
      if (exactName) return { id: exactName, via: 'nombre' };

      const typoTolerantName = matchByName(nombre, true);
      return typoTolerantName ? { id: typoTolerantName, via: 'nombre~' } : null;
    };
    const resolutionsByRoute = new Map<Resolution['via'], number>();

    type Resolved = {
      course: CourseArtifact;
      instrumentId: string;
      instrumentName: string;
      classGroupId: string;
    };
    const resolved: Resolved[] = [];
    for (const course of courses) {
      const grade = gradeByCode.get(course.gradeCode);
      if (!grade)
        throw new Error(`Grade no encontrado: ${course.gradeCode} (${course.sourceFile})`);
      const subject = subjectByName.get(course.subjectName);
      if (!subject)
        throw new Error(`Subject no encontrado: "${course.subjectName}" (${course.sourceFile})`);
      const instrument = resolveInstrument(
        `${grade.id}|${subject.id}|${course.applicationPeriod}`,
        `${grade.name} · ${subject.name} · ${course.applicationPeriod} ${YEAR}`,
      );
      if (!instrument) throw new Error(`Instrumento no resuelto para ${course.sourceFile}`);
      const classGroupId = groupByKey.get(`${grade.id}|${course.section.toUpperCase()}`);
      if (!classGroupId)
        throw new Error(
          `class_group ${YEAR} no encontrado: ${grade.name} ${course.section}. Corre 02-promover-roster.ts primero.`,
        );
      resolved.push({
        course,
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        classGroupId,
      });
    }

    const instrumentIds = [...new Set(resolved.map((r) => r.instrumentId))];
    const allItems = await tx
      .select({
        id: items.id,
        instrumentId: items.instrumentId,
        position: items.position,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(inArray(items.instrumentId, instrumentIds));
    const allTags = await tx
      .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
      .from(itemTaxonomyTags)
      .where(
        inArray(
          itemTaxonomyTags.itemId,
          allItems.map((i) => i.id),
        ),
      );
    const tagsByItem = new Map<string, string[]>();
    for (const t of allTags) {
      const list = tagsByItem.get(t.itemId) ?? [];
      list.push(t.nodeId);
      tagsByItem.set(t.itemId, list);
    }
    const itemsByInstrument = new Map<string, typeof allItems>();
    for (const item of allItems) {
      if (item.instrumentId == null) continue;
      const list = itemsByInstrument.get(item.instrumentId) ?? [];
      list.push(item);
      itemsByInstrument.set(item.instrumentId, list);
    }

    const newStudents = new Map<string, { rut: string; nombre: string; classGroupId: string }>();
    for (const r of resolved) {
      for (const row of r.course.rows) {
        if (resolveStudent(row.rut, row.nombre)) continue;
        if (!row.rut) continue;
        if (!newStudents.has(row.rut))
          newStudents.set(row.rut, {
            rut: row.rut,
            nombre: row.nombre,
            classGroupId: r.classGroupId,
          });
      }
    }

    console.log(`\n== Ingesta DIA ${YEAR} · org ${ORG_ID} · ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ==`);
    console.log(`  cursos a procesar: ${resolved.length}`);
    console.log(`  alumnos nuevos a crear: ${newStudents.size}`);
    for (const s of newStudents.values()) {
      const { firstName, lastName } = splitFullName(s.nombre);
      console.log(`    ${s.rut}  apellido="${lastName}"  nombre="${firstName}"`);
    }

    if (COMMIT && newStudents.size) {
      const inserted = await tx
        .insert(students)
        .values(
          [...newStudents.values()].map((s) => {
            const { firstName, lastName } = splitFullName(s.nombre);
            return { orgId: ORG_ID, rut: s.rut, firstName, lastName };
          }),
        )
        .onConflictDoUpdate({
          target: [students.orgId, students.rut],
          set: { updatedAt: now },
        })
        .returning({ id: students.id, rut: students.rut });
      for (const s of inserted) {
        const source = newStudents.get(s.rut);
        const { firstName, lastName } = splitFullName(source?.nombre ?? s.rut);
        indexStudent({ id: s.id, rut: s.rut, firstName, lastName });
      }
      const enrollmentValues = inserted.flatMap((s) => {
        const source = newStudents.get(s.rut);
        if (!source) return [];
        return [
          {
            studentId: s.id,
            classGroupId: source.classGroupId,
            academicYearId: year.id,
            status: 'active' as const,
          },
        ];
      });
      if (enrollmentValues.length) {
        await tx
          .insert(studentEnrollments)
          .values(enrollmentValues)
          .onConflictDoUpdate({
            target: [studentEnrollments.studentId, studentEnrollments.academicYearId],
            set: { classGroupId: dsql`excluded.class_group_id`, status: 'active' },
          });
      }
      console.log(
        `  alumnos creados/actualizados: ${inserted.length} · matriculados: ${enrollmentValues.length}`,
      );
    }

    const prior = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(
        and(eq(assessments.orgId, ORG_ID), dsql`${assessments.config}->>'loadKey' = ${LOAD_KEY}`),
      );
    const priorIds = prior.map((p) => p.id);
    if (COMMIT && priorIds.length) {
      await tx.delete(responses).where(inArray(responses.assessmentId, priorIds));
      await tx.delete(assessmentResults).where(inArray(assessmentResults.assessmentId, priorIds));
      await tx.delete(skillResults).where(inArray(skillResults.assessmentId, priorIds));
      await tx.delete(importJobs).where(inArray(importJobs.assessmentId, priorIds));
      await tx
        .delete(assessmentCourseAssignments)
        .where(inArray(assessmentCourseAssignments.assessmentId, priorIds));
      await tx.delete(assessments).where(inArray(assessments.id, priorIds));
      console.log(
        `  idempotencia: borrados ${priorIds.length} assessments previos (loadKey=${LOAD_KEY})`,
      );
    }

    type Pending = Resolved & {
      studentIds: string[];
      unmatched: string[];
      responseRows: Array<typeof responses.$inferInsert>;
      calc: CalcRow[];
      autoScorableItems: number;
      pendingItems: number;
    };
    const pending: Pending[] = [];

    for (const r of resolved) {
      const instrumentItems = itemsByInstrument.get(r.instrumentId) ?? [];
      const itemPositions = [...new Set(instrumentItems.map((i) => i.position))].sort(
        (a, b) => a - b,
      );
      const sheetPositions = [
        ...new Set(Object.keys(r.course.rows[0]?.answers ?? {}).map(Number)),
      ].sort((a, b) => a - b);
      if (JSON.stringify(itemPositions) !== JSON.stringify(sheetPositions)) {
        const faltan = itemPositions.filter((p) => !sheetPositions.includes(p));
        const sobran = sheetPositions.filter((p) => !itemPositions.includes(p));
        throw new Error(
          `Posiciones desalineadas en ${r.course.sourceFile} (${r.instrumentName}): ` +
            `instrumento=${itemPositions.length} planilla=${sheetPositions.length}` +
            (faltan.length ? ` · sin columna en la planilla: [${faltan.join(',')}]` : '') +
            (sobran.length ? ` · sin ítem en el instrumento: [${sobran.join(',')}]` : ''),
        );
      }

      const responseRows: Array<typeof responses.$inferInsert> = [];
      const calc: CalcRow[] = [];
      const studentIds: string[] = [];
      const unmatched: string[] = [];
      let autoScorableItems = 0;
      let pendingItems = 0;

      for (const row of r.course.rows) {
        const resolution = resolveStudent(row.rut, row.nombre);
        if (!resolution) {
          unmatched.push(`${row.rut} (${row.nombre})`);
          continue;
        }
        resolutionsByRoute.set(resolution.via, (resolutionsByRoute.get(resolution.via) ?? 0) + 1);
        const studentId = resolution.id;
        studentIds.push(studentId);

        for (const item of instrumentItems) {
          const maxScore = (item.scoringConfig as { points?: number } | null)?.points ?? 1;
          const rawAnswer = row.answers[String(item.position)] ?? null;
          const nodeIds = tagsByItem.get(item.id) ?? [];

          const answer =
            typeof rawAnswer === 'string' && rawAnswer.trim() ? rawAnswer.trim() : null;
          const outcome = scoreWithRegistry(item, maxScore, answer);
          const isCorrect = outcome.isCorrect;
          const scoreOrNull = outcome.rawScore;

          if (outcome.requiresManualGrading || isCorrect === null || scoreOrNull === null) {
            pendingItems += 1;
            responseRows.push({
              assessmentId: '',
              studentId,
              itemId: item.id,
              value: { answer: rawAnswer },
              isCorrect: null,
              rawScore: null,
              maxScore: maxScore.toFixed(2),
              finalScore: null,
              scoredBy: 'human',
              scoredAt: null,
            });
            calc.push({
              studentId,
              itemId: item.id,
              itemPosition: item.position,
              rawScore: null,
              maxScore,
              finalScore: null,
              isCorrect: null,
              taxonomyNodeIds: nodeIds,
              value: { answer: rawAnswer },
              hasAlternatives: itemHasAlternatives(item.content),
            });
            continue;
          }

          autoScorableItems += 1;
          const rawScore = scoreOrNull;
          responseRows.push({
            assessmentId: '',
            studentId,
            itemId: item.id,
            value: { answer: rawAnswer },
            isCorrect,
            rawScore: rawScore.toFixed(2),
            maxScore: maxScore.toFixed(2),
            finalScore: rawScore.toFixed(2),
            scoredBy: 'auto',
            scoredAt: now,
          });
          calc.push({
            studentId,
            itemId: item.id,
            itemPosition: item.position,
            rawScore,
            maxScore,
            finalScore: rawScore,
            isCorrect,
            taxonomyNodeIds: nodeIds,
            value: { answer: rawAnswer },
            hasAlternatives: itemHasAlternatives(item.content),
          });
        }
      }

      pending.push({
        ...r,
        studentIds,
        unmatched,
        responseRows,
        calc,
        autoScorableItems: autoScorableItems / Math.max(studentIds.length, 1),
        pendingItems: pendingItems / Math.max(studentIds.length, 1),
      });
    }

    let totalResponses = 0;
    let totalUnmatched = 0;
    console.log('');
    for (const p of pending) {
      const scored = p.calc.filter((c) => c.isCorrect !== null);
      const correct = scored.filter((c) => c.isCorrect).length;
      const pct = scored.length ? ((100 * correct) / scored.length).toFixed(1) : '–';
      totalResponses += p.responseRows.length;
      totalUnmatched += p.unmatched.length;
      console.log(
        `  ${p.course.gradeCode} ${p.course.section} · ${p.course.subjectName}: alumnos=${p.studentIds.length} ` +
          `autocorregidos/alumno=${p.autoScorableItems} pendientes/alumno=${p.pendingItems} ` +
          `responses=${p.responseRows.length} %correcto=${pct}`,
      );
      if (p.unmatched.length) console.log(`      sin match: ${p.unmatched.join(' | ')}`);
    }
    console.log(
      `\n  TOTAL: assessments=${pending.length} responses=${totalResponses} sin_match=${totalUnmatched}`,
    );
    console.log(
      `  filas resueltas por: ${[...resolutionsByRoute.entries()]
        .map(([via, n]) => `${via}=${n}`)
        .join(' ')}`,
    );

    if (!COMMIT) {
      console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)');
      return;
    }

    const insertedAssessments = await tx
      .insert(assessments)
      .values(
        pending.map((p) => ({
          orgId: ORG_ID,
          instrumentId: p.instrumentId,
          name: `${p.instrumentName} · ${p.course.section}`,
          mode: 'paper' as const,
          status: 'completed' as const,
          administeredAt,
          administeredById: null,
          config: {
            source: IMPORT_FORMAT,
            period: p.course.applicationPeriod,
            subject: p.course.subjectName,
            loadKey: LOAD_KEY,
            classGroupId: p.classGroupId,
            sourceFile: p.course.sourceFile,
          },
        })),
      )
      .returning({ id: assessments.id });

    await tx.insert(assessmentCourseAssignments).values(
      pending.map((p, i) => {
        const assessmentId = insertedAssessments[i]?.id;
        if (!assessmentId) throw new Error(`Falta assessmentId para el curso índice ${i}`);
        return { assessmentId, classGroupId: p.classGroupId };
      }),
    );

    const allResponses: Array<typeof responses.$inferInsert> = [];
    const resultValues: Array<typeof assessmentResults.$inferInsert> = [];
    const skillValues: Array<typeof skillResults.$inferInsert> = [];
    const cohortInput: Array<{
      assessmentId: string;
      calc: CalcRow[];
      skills: Array<{
        studentId: string;
        nodeId: string;
        correctCount: number;
        totalCount: number;
        percentage: number | null;
      }>;
    }> = [];

    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const assessmentId = insertedAssessments[i]?.id;
      if (!p || !assessmentId) continue;
      for (const r of p.responseRows) allResponses.push({ ...r, assessmentId });

      const scale = DEFAULT_GRADING_SCALE;
      const autoScored = p.calc.filter((c) => c.isCorrect !== null);
      const withPending = new Set(
        p.calc.filter((c) => c.isCorrect === null).map((c) => c.studentId),
      );
      const studentAgg = aggregateStudentResults(autoScored, scale);
      const skillAgg = aggregateSkillResults(p.calc, scale);

      for (const a of studentAgg) {
        resultValues.push({
          assessmentId,
          studentId: a.studentId,
          totalScore: a.totalScore.toFixed(2),
          maxScore: a.maxScore.toFixed(2),
          percentage: (a.percentage * 100).toFixed(2),
          grade: a.grade.toFixed(2),
          performanceLevel: a.performanceLevel,
          isComplete: a.isComplete && !withPending.has(a.studentId),
          completedAt: administeredAt,
        });
      }
      for (const a of skillAgg) {
        skillValues.push({
          assessmentId,
          studentId: a.studentId,
          nodeId: a.nodeId,
          correctCount: a.correctCount,
          totalCount: a.totalCount,
          percentage: (a.percentage * 100).toFixed(2),
          performanceLevel: a.performanceLevel,
        });
      }
      cohortInput.push({
        assessmentId,
        calc: p.calc,
        skills: skillAgg.map((a) => ({
          studentId: a.studentId,
          nodeId: a.nodeId,
          correctCount: a.correctCount,
          totalCount: a.totalCount,
          percentage: a.percentage,
        })),
      });
    }

    for (const c of chunk(allResponses, CHUNK)) await tx.insert(responses).values(c);
    for (const c of chunk(resultValues, CHUNK)) await tx.insert(assessmentResults).values(c);
    for (const c of chunk(skillValues, CHUNK)) await tx.insert(skillResults).values(c);

    let itemStatRows = 0;
    let skillStatRows = 0;
    let orphanTotal = 0;
    for (const s of cohortInput) {
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
      console.warn(
        `  ⚠️ ${orphanTotal} respuesta(s) de alumnos sin matrícula quedaron FUERA del read-model`,
      );
    }

    await tx.insert(importJobs).values(
      pending.map((p, i) => ({
        orgId: ORG_ID,
        assessmentId: insertedAssessments[i]?.id,
        type: 'answer_sheet_csv' as const,
        status: (p.unmatched.length ? 'partial' : 'completed') as 'partial' | 'completed',
        fileUrl: null,
        mappingConfig: {
          format: IMPORT_FORMAT,
          instrumentId: p.instrumentId,
          columnMapping: { rut: 'RUT', questionsPrefix: 'P' },
          sourceFile: p.course.sourceFile,
        },
        result: { rowsProcessed: p.studentIds.length, errors: p.unmatched.length, warnings: 0 },
        errorLog: p.unmatched.map((rut) => ({ row: 0, message: `RUT sin match: ${rut}` })),
        createdById: null,
        completedAt: now,
      })),
    );

    console.log(
      `\n✅ COMMIT: ${insertedAssessments.length} assessments · ${allResponses.length} responses · ` +
        `${resultValues.length} assessment_results · ${skillValues.length} skill_results · ` +
        `${itemStatRows} assessment_item_stats · ${skillStatRows} assessment_skill_stats`,
    );
  });

  await client.end();
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
