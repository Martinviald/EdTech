/**
 * Seed E2E de testing — datos analíticos ricos para validar el flujo completo
 * de resultados y los dashboards del Sprint 4.
 *
 * Crea (dentro de Colegio Demo, reutilizando los usuarios mock admin/director/
 * teacher del seed base):
 *  - 3 años académicos (2024, 2025, 2026) para comparación generacional.
 *  - 5 cursos: "2° Básico A" en los 3 años (cohortes distintas) + "2° Básico B"
 *    y "3° Básico A" en 2026.
 *  - ~74 alumnos con RUT válido (Módulo 11) y matrículas por año.
 *  - 2 instrumentos DIA (Lectura y Matemática 2° Básico) con 10 ítems c/u,
 *    clave correcta en content y tags de habilidad de la taxonomía DIA.
 *  - 10 evaluaciones históricas con assessment_course_assignments + respuestas +
 *    resultados calculados con el MISMO aggregate* que usa el backend, con
 *    mejora año-a-año (generacional) y dentro del año (progresión).
 *  - Asignaciones docentes del profesor demo a 2 cursos de 2026 (scoping).
 *
 * Además ESCRIBE archivos CSV de hojas de respuesta en
 * `packages/db/data/e2e-answer-sheets/` para probar el flujo de upload en vivo
 * (esos assessments NO se siembran: los crea el upload).
 *
 * Idempotente: borra todo lo que crea (namespace de UUID `e2e00000-...`) antes
 * de reinsertar. NO toca datos de otros orígenes (instrumentos importados a mano,
 * los 3 alumnos demo, etc.).
 *
 * Requiere haber corrido antes el seed base (`pnpm --filter @soe/db db:seed`):
 * usa Colegio Demo, los grados, asignaturas y las habilidades DIA 2025.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { and, eq, sql, type AnyColumn } from 'drizzle-orm';
import {
  aggregateSkillResults,
  aggregateStudentResults,
  type GradingScaleParams,
  type ResponseForCalculation,
} from '@soe/types';
import { createDbClient } from '../client';
import { classGroups, grades, subjectClasses, subjects } from '../schema/academic';
import { taxonomies, taxonomyNodes } from '../schema/taxonomy';
import { academicYears } from '../schema/organizations';
import { students, studentEnrollments } from '../schema/students';
import { teacherAssignments } from '../schema/users';
import { gradingScales, instruments } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import { assessments, assessmentCourseAssignments } from '../schema/assessments';
import { responses } from '../schema/responses';
import { assessmentResults, skillResults } from '../schema/results';

config({ path: resolve(__dirname, '../../../../.env') });

// ── Constantes del seed base que reutilizamos ────────────────────────────────
const DEMO_ORG_ID = 'dec00000-0000-0000-0000-000000000001';
const DEMO_USER_IDS = {
  teacher: 'dec00000-0000-0000-0000-0000000000c1',
};
const DEMO_AY_2026_ID = 'dec00000-0000-0000-0000-000000000071'; // año 2026 isCurrent

// Namespace de UUID para todo lo que crea este seed (borrado idempotente).
const NS = 'e2e00000-0000-0000-0000-';
const uid = (n: number) => NS + n.toString(16).padStart(12, '0');

// Escala chilena estándar 1-7 / 60% exigencia (= DEFAULT del backend).
const SCALE: GradingScaleParams = {
  type: 'linear_chilean',
  minGrade: 1,
  maxGrade: 7,
  passingGrade: 4,
  passingThreshold: 0.6,
  config: null,
};

const KEYS = ['A', 'B', 'C', 'D'] as const;

// ── PRNG determinístico (reproducible entre corridas) ────────────────────────
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hashStr(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ── Dígito verificador chileno (Módulo 11) ───────────────────────────────────
function computeDv(body: string): string {
  let sum = 0;
  let m = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const mod = 11 - (sum % 11);
  if (mod === 11) return '0';
  if (mod === 10) return 'K';
  return String(mod);
}
function rutFrom(body: number): string {
  const b = String(body);
  return `${b}-${computeDv(b)}`;
}

// ── Nombres chilenos para los alumnos ────────────────────────────────────────
const FIRST = [
  'Sofía', 'Mateo', 'Isidora', 'Agustín', 'Florencia', 'Benjamín', 'Antonia', 'Vicente',
  'Emilia', 'Tomás', 'Catalina', 'Joaquín', 'Josefa', 'Lucas', 'Martina', 'Maximiliano',
  'Valentina', 'Gaspar', 'Amanda', 'Cristóbal', 'Trinidad', 'Diego', 'Renata', 'Bruno',
  'Javiera', 'Felipe', 'Pascuala', 'Ignacio', 'Colomba', 'Matías',
];
const LAST = [
  'González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva',
  'Martínez', 'Sepúlveda', 'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández',
  'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela', 'Castillo', 'Tapia',
  'Reyes', 'Gutiérrez', 'Castro', 'Vargas', 'Álvarez', 'Vergara', 'Bravo', 'Núñez',
];

// ── Definición de habilidades por instrumento (códigos de habilidad del marco real) ─────
const LECT_SKILL_CYCLE = [
  'LANG-SK-LOCALIZAR', 'LANG-SK-INTERPRETAR-Y-RELACIONAR', 'LANG-SK-REFLEXIONAR',
  'LANG-SK-LOCALIZAR', 'LANG-SK-INTERPRETAR-Y-RELACIONAR', 'LANG-SK-REFLEXIONAR',
  'LANG-SK-LOCALIZAR', 'LANG-SK-INTERPRETAR-Y-RELACIONAR', 'LANG-SK-REFLEXIONAR', 'LANG-SK-LOCALIZAR',
];
const MAT_SKILL_CYCLE = [
  'MATH-SK-RESOLVER-PROBLEMAS', 'MATH-SK-MODELAR', 'MATH-SK-REPRESENTAR', 'MATH-SK-ARGUMENTAR-Y-COMUNICAR',
  'MATH-SK-RESOLVER-PROBLEMAS', 'MATH-SK-MODELAR', 'MATH-SK-REPRESENTAR', 'MATH-SK-ARGUMENTAR-Y-COMUNICAR',
  'MATH-SK-RESOLVER-PROBLEMAS', 'MATH-SK-MODELAR',
];

// Banco de enunciados realistas por posición (alineado a LECT/MAT_SKILL_CYCLE).
// La alternativa correcta está en la clave KEYS[idx % 4] (A,B,C,D,A,B,...), igual
// que el correctKey que ya usa el seed para generar respuestas y notas.
type SeedQuestion = { stem: string; options: Record<'A' | 'B' | 'C' | 'D', string> };

// Lectura — basadas en un texto narrativo breve ("Pedro y el perro Tomás").
const LECT_QUESTIONS: SeedQuestion[] = [
  { stem: 'Según el texto, ¿dónde encontró Pedro al perro?', options: { A: 'En el parque', B: 'En la escuela', C: 'En la playa', D: 'En el mercado' } },
  { stem: '¿Por qué Pedro decidió quedarse con el perro?', options: { A: 'Porque era de raza fina', B: 'Porque estaba solo y necesitaba ayuda', C: 'Porque se lo pidieron sus amigos', D: 'Porque quería venderlo' } },
  { stem: '¿Cuál es el propósito principal del texto?', options: { A: 'Explicar cómo cuidar perros', B: 'Describir un parque', C: 'Mostrar el valor de la compasión', D: 'Enseñar a entrenar mascotas' } },
  { stem: '¿Qué nombre le puso Pedro al perro?', options: { A: 'Rocky', B: 'Max', C: 'Bobby', D: 'Tomás' } },
  { stem: "¿Qué quiere decir la frase 'el perro movía la cola sin parar'?", options: { A: 'Que estaba feliz', B: 'Que tenía frío', C: 'Que estaba enojado', D: 'Que quería irse' } },
  { stem: '¿Qué enseñanza nos deja la historia?', options: { A: 'No conviene tener mascotas', B: 'Ayudar a otros nos hace bien', C: 'Los parques son peligrosos', D: 'Los perros son difíciles de cuidar' } },
  { stem: '¿En qué momento del día ocurre la historia?', options: { A: 'En la noche', B: 'Al mediodía', C: 'En la mañana', D: 'En la madrugada' } },
  { stem: '¿Cómo se sentía Pedro al final del texto?', options: { A: 'Aburrido', B: 'Asustado', C: 'Triste', D: 'Contento' } },
  { stem: 'Si tú fueras Pedro, ¿qué habrías hecho?', options: { A: 'Ayudar al perro, como él', B: 'Ignorarlo y seguir', C: 'Pedir que se lo llevaran', D: 'Asustarlo para que se fuera' } },
  { stem: '¿Con quién vivía Pedro?', options: { A: 'Con sus abuelos', B: 'Con su familia', C: 'Solo', D: 'Con sus amigos' } },
];

// Matemática — problemas de 2°/3° básico (RES/MOD/REP/ARG).
const MAT_QUESTIONS: SeedQuestion[] = [
  { stem: 'María tiene 75 láminas y le regalan 50 más. ¿Cuántas tiene en total?', options: { A: '125', B: '25', C: '100', D: '135' } },
  { stem: 'Hay 3 bolsas con 6 manzanas cada una. ¿Qué operación da el total de manzanas?', options: { A: '3 + 6', B: '3 × 6', C: '6 − 3', D: '6 ÷ 3' } },
  { stem: '¿Qué figura tiene 4 lados iguales y 4 ángulos rectos?', options: { A: 'El triángulo', B: 'El rectángulo', C: 'El cuadrado', D: 'El círculo' } },
  { stem: 'Pedro dice que 5 filas de 4 sillas son 20 sillas. ¿Cuál es la mejor justificación?', options: { A: 'Porque 5 + 4 = 9', B: 'Porque 5 − 4 = 1', C: 'Porque 20 ÷ 4 = 5', D: 'Porque 5 × 4 = 20' } },
  { stem: 'Ana tenía 90 stickers y regaló 35. ¿Cuántos le quedan?', options: { A: '55', B: '125', C: '65', D: '45' } },
  { stem: 'Un cuaderno cuesta $500. ¿Qué operación da el costo de 4 cuadernos?', options: { A: '500 + 4', B: '500 × 4', C: '500 ÷ 4', D: '500 − 4' } },
  { stem: '¿Cuál es una propiedad correcta del cubo?', options: { A: 'Tiene 4 caras', B: 'Tiene 5 vértices', C: 'Tiene 6 caras cuadradas', D: 'Tiene 3 aristas' } },
  { stem: '¿Por qué 2 kilogramos equivalen a 2.000 gramos?', options: { A: 'Porque 1 kg = 100 g', B: 'Porque 1 kg = 10 g', C: 'Porque 1 kg = 500 g', D: 'Porque 1 kg = 1.000 g' } },
  { stem: 'Si hay 3 botellas de 500 ml, ¿cuántos ml hay en total?', options: { A: '1.500 ml', B: '800 ml', C: '1.000 ml', D: '2.000 ml' } },
  { stem: 'Pedro tiene 96 figuritas y las reparte en partes iguales entre 2 amigos. ¿Qué operación usa?', options: { A: '96 × 2', B: '96 ÷ 2', C: '96 + 2', D: '96 − 2' } },
];

/** Construye el content del ítem con enunciado + alternativas reales. */
function buildItemContent(
  bank: SeedQuestion[],
  idx: number,
  position: number,
  correctKey: string,
  fallbackLabel: string,
) {
  const q = bank[idx];
  const stem = q?.stem ?? `${fallbackLabel} · pregunta ${position}`;
  const alternatives = KEYS.map((k) => ({
    key: k,
    text: q?.options[k] ?? `Alternativa ${k}`,
    isCorrect: k === correctKey,
  }));
  return { stem, correctKey, alternatives };
}
// Dificultad base por habilidad (probabilidad de acierto antes de ajustes).
// Calibrado para un colegio "con brechas": LOC y REP relativamente sanas, pero
// REF / MOD / ARG quedan por debajo del umbral crítico (<50% → critical_skill)
// y los cursos promedian <60% (→ low_achievement), de modo que salten alertas y
// haya hartos alumnos en nivel insuficiente (<40%). La mejora año-a-año y por
// período se mantiene vía YEAR_FACTOR / PERIOD_FACTOR.
const BASE_SKILL: Record<string, number> = {
  'LANG-SK-LOCALIZAR': 0.62,
  'LANG-SK-INTERPRETAR-Y-RELACIONAR': 0.45,
  'LANG-SK-REFLEXIONAR': 0.3,
  'MATH-SK-RESOLVER-PROBLEMAS': 0.5,
  'MATH-SK-MODELAR': 0.34,
  'MATH-SK-REPRESENTAR': 0.55,
  'MATH-SK-ARGUMENTAR-Y-COMUNICAR': 0.28,
};
const YEAR_FACTOR: Record<number, number> = { 2024: 0, 2025: 0.06, 2026: 0.11 };
const PERIOD_FACTOR: Record<string, number> = {
  diagnostico: 0,
  intermedia: 0.05,
  final: 0.1,
};

type SeedItem = { id: string; position: number; nodeId: string; correctKey: string };
type SeedStudent = { id: string; rut: string; firstName: string; lastName: string };

/** Probabilidad de acierto de un alumno en un ítem, dado año y período. */
function correctProbability(
  studentId: string,
  nodeCode: string,
  year: number,
  period: string,
): number {
  const ability = rng(`ability:${studentId}`)() * 0.4 - 0.2; // [-0.2, 0.2] estable
  const base = BASE_SKILL[nodeCode] ?? 0.6;
  return clamp(base + ability + (YEAR_FACTOR[year] ?? 0) + (PERIOD_FACTOR[period] ?? 0), 0.05, 0.97);
}

/** Genera la respuesta (correcta/incorrecta + clave elegida) de un alumno-ítem. */
function answerFor(
  assessmentSeed: string,
  studentId: string,
  item: SeedItem,
  nodeCode: string,
  year: number,
  period: string,
): { isCorrect: boolean; chosen: string } {
  const p = correctProbability(studentId, nodeCode, year, period);
  const r = rng(`${assessmentSeed}:${studentId}:${item.id}`)();
  if (r < p) return { isCorrect: true, chosen: item.correctKey };
  const wrong = KEYS.filter((k) => k !== item.correctKey);
  const chosen = wrong[Math.floor(rng(`w:${assessmentSeed}:${studentId}:${item.id}`)() * wrong.length)]!;
  return { isCorrect: false, chosen };
}

async function main() {
  // Rol privilegiado (bypassa RLS) para cargar datos sin contexto de org.
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  // ── 0. Prerrequisitos del seed base ────────────────────────────────────────
  const gradeRows = await db.select().from(grades);
  const grade2 = gradeRows.find((g) => g.code === '2ND_BASIC');
  const grade3 = gradeRows.find((g) => g.code === '3RD_BASIC');
  const [langSubject] = await db.select().from(subjects).where(eq(subjects.code, 'LANG'));
  const [mathSubject] = await db.select().from(subjects).where(eq(subjects.code, 'MATH'));
  if (!grade2 || !grade3 || !langSubject || !mathSubject) {
    throw new Error(
      'Faltan prerrequisitos. Corre primero el seed base: pnpm --filter @soe/db db:seed',
    );
  }
  // Las habilidades viven en el marco real (Currículum Nacional); se buscan por code.
  const skillNodes = await db
    .select({ id: taxonomyNodes.id, code: taxonomyNodes.code })
    .from(taxonomyNodes)
    .where(eq(taxonomyNodes.type, 'skill'));
  const nodeByCode = new Map(skillNodes.map((n) => [n.code as string, n.id]));
  for (const code of [...new Set([...LECT_SKILL_CYCLE, ...MAT_SKILL_CYCLE])]) {
    if (!nodeByCode.has(code)) {
      throw new Error(`Falta el nodo de habilidad "${code}". Corre el seed base: pnpm --filter @soe/db db:seed`);
    }
  }
  // Marco de evaluación DIA (al que pertenecen los instrumentos DIA demo).
  const [diaMarco] = await db
    .select({ id: taxonomies.id })
    .from(taxonomies)
    .where(and(eq(taxonomies.type, 'dia'), eq(taxonomies.version, 'vigente')));
  if (!diaMarco) {
    throw new Error('Falta el marco DIA. Corre el seed base: pnpm --filter @soe/db db:seed');
  }

  // ── 1. Limpieza idempotente (borra solo el namespace e2e) ──────────────────
  console.log('Limpiando datos E2E previos...');
  const like = (col: AnyColumn) => sql`${col}::text LIKE ${NS + '%'}`;
  // Borra los assessments sembrados (id e2e) Y los que el usuario haya creado
  // subiendo CSVs contra los instrumentos E2E (instrument_id e2e). Eso cascada a
  // responses, results, skill_results y course_assignments. Sin la condición por
  // instrument_id, las respuestas de un upload referenciarían ítems e2e y
  // bloquearían el borrado de items (FK).
  await db
    .delete(assessments)
    .where(sql`${assessments.id}::text LIKE ${NS + '%'} OR ${assessments.instrumentId}::text LIKE ${NS + '%'}`);
  // Defensa extra: cualquier respuesta que aún referencie un ítem E2E.
  await db.delete(responses).where(like(responses.itemId));
  await db.delete(itemTaxonomyTags).where(like(itemTaxonomyTags.id));
  await db.delete(items).where(like(items.id));
  await db.delete(instruments).where(like(instruments.id));
  await db.delete(teacherAssignments).where(like(teacherAssignments.id));
  // Los students cascada a enrollments, responses y results.
  await db.delete(students).where(like(students.id));
  await db.delete(subjectClasses).where(like(subjectClasses.id));
  await db.delete(classGroups).where(like(classGroups.id));
  await db.delete(academicYears).where(like(academicYears.id));
  await db.delete(gradingScales).where(like(gradingScales.id));

  // ── 2. Escala de notas ─────────────────────────────────────────────────────
  const scaleId = uid(0x100);
  await db.insert(gradingScales).values({
    id: scaleId,
    orgId: DEMO_ORG_ID,
    name: 'Escala Chilena 1-7 (60%) · E2E',
    type: 'linear_chilean',
    minGrade: '1.00',
    maxGrade: '7.00',
    passingGrade: '4.00',
    passingThreshold: '0.60',
  });

  // ── 3. Años académicos (2026 ya existe en el seed base) ────────────────────
  const AY = { 2024: uid(0x241), 2025: uid(0x251), 2026: DEMO_AY_2026_ID };
  await db.insert(academicYears).values([
    { id: AY[2024], orgId: DEMO_ORG_ID, year: 2024, isCurrent: false },
    { id: AY[2025], orgId: DEMO_ORG_ID, year: 2025, isCurrent: false },
  ]);

  // ── 4. Cursos (class_groups) ───────────────────────────────────────────────
  const CG = {
    a2024: uid(0x10),
    a2025: uid(0x11),
    a2026: uid(0x12),
    b2026: uid(0x13),
    c2026: uid(0x14),
  };
  await db.insert(classGroups).values([
    { id: CG.a2024, orgId: DEMO_ORG_ID, academicYearId: AY[2024], gradeId: grade2.id, name: '2° Básico A' },
    { id: CG.a2025, orgId: DEMO_ORG_ID, academicYearId: AY[2025], gradeId: grade2.id, name: '2° Básico A' },
    { id: CG.a2026, orgId: DEMO_ORG_ID, academicYearId: AY[2026], gradeId: grade2.id, name: '2° Básico A' },
    { id: CG.b2026, orgId: DEMO_ORG_ID, academicYearId: AY[2026], gradeId: grade2.id, name: '2° Básico B' },
    { id: CG.c2026, orgId: DEMO_ORG_ID, academicYearId: AY[2026], gradeId: grade3.id, name: '3° Básico A' },
  ]);

  // ── 5. Subject classes (Lenguaje + Matemática por curso) ───────────────────
  const cgDefs = [
    { id: CG.a2024, ay: AY[2024] },
    { id: CG.a2025, ay: AY[2025] },
    { id: CG.a2026, ay: AY[2026] },
    { id: CG.b2026, ay: AY[2026] },
    { id: CG.c2026, ay: AY[2026] },
  ];
  const scValues: Array<typeof subjectClasses.$inferInsert> = [];
  const scId = new Map<string, string>(); // `${cgId}:${subjectCode}` -> id
  cgDefs.forEach((cg, i) => {
    [langSubject, mathSubject].forEach((subj, j) => {
      const id = uid(0x200 + i * 2 + j);
      scId.set(`${cg.id}:${subj.code}`, id);
      scValues.push({ id, classGroupId: cg.id, subjectId: subj.id, academicYearId: cg.ay });
    });
  });
  await db.insert(subjectClasses).values(scValues);

  // ── 6. Asignaciones del profesor demo (scoping: 2° A y 2° B 2026, Lenguaje) ─
  await db.insert(teacherAssignments).values([
    { id: uid(0x280), userId: DEMO_USER_IDS.teacher, subjectClassId: scId.get(`${CG.a2026}:LANG`)!, role: 'primary' },
    { id: uid(0x281), userId: DEMO_USER_IDS.teacher, subjectClassId: scId.get(`${CG.b2026}:LANG`)!, role: 'primary' },
  ]);

  // ── 7. Alumnos + matrículas (cohortes por curso) ───────────────────────────
  const cohorts: Array<{ cgId: string; ay: string; n: number; label: string }> = [
    { cgId: CG.a2024, ay: AY[2024], n: 14, label: '2°A 2024' },
    { cgId: CG.a2025, ay: AY[2025], n: 14, label: '2°A 2025' },
    { cgId: CG.a2026, ay: AY[2026], n: 16, label: '2°A 2026' },
    { cgId: CG.b2026, ay: AY[2026], n: 16, label: '2°B 2026' },
    { cgId: CG.c2026, ay: AY[2026], n: 14, label: '3°A 2026' },
  ];
  const studentsByCg = new Map<string, SeedStudent[]>();
  const studentValues: Array<typeof students.$inferInsert> = [];
  const enrollmentValues: Array<typeof studentEnrollments.$inferInsert> = [];
  let counter = 0;
  let rutBody = 21000000;
  for (const cohort of cohorts) {
    const list: SeedStudent[] = [];
    for (let k = 0; k < cohort.n; k++) {
      const id = uid(0x1000 + counter);
      const firstName = FIRST[counter % FIRST.length]!;
      const lastName = `${LAST[counter % LAST.length]!} ${LAST[(counter * 7 + 3) % LAST.length]!}`;
      const rut = rutFrom(rutBody++);
      list.push({ id, rut, firstName, lastName });
      studentValues.push({
        id,
        orgId: DEMO_ORG_ID,
        rut,
        firstName,
        lastName,
        gender: counter % 2 === 0 ? 'F' : 'M',
        profile: {},
      });
      enrollmentValues.push({
        id: uid(0x4000 + counter),
        studentId: id,
        classGroupId: cohort.cgId,
        academicYearId: cohort.ay,
        status: 'active',
      });
      counter++;
    }
    studentsByCg.set(cohort.cgId, list);
  }
  await db.insert(students).values(studentValues);
  await db.insert(studentEnrollments).values(enrollmentValues);

  // ── 8. Instrumentos + ítems + tags ─────────────────────────────────────────
  const INST_LECT = uid(0x500);
  const INST_MAT = uid(0x501);
  await db.insert(instruments).values([
    {
      id: INST_LECT,
      orgId: DEMO_ORG_ID,
      taxonomyId: diaMarco.id,
      name: 'DIA Lectura 2° Básico',
      shortName: 'DIA Lectura 2°B',
      type: 'dia',
      subjectId: langSubject.id,
      gradeId: grade2.id,
      year: 2026,
      isOfficial: false,
      status: 'published',
      gradingScaleId: scaleId,
    },
    {
      id: INST_MAT,
      orgId: DEMO_ORG_ID,
      taxonomyId: diaMarco.id,
      name: 'DIA Matemática 2° Básico',
      shortName: 'DIA Mat 2°B',
      type: 'dia',
      subjectId: mathSubject.id,
      gradeId: grade2.id,
      year: 2026,
      isOfficial: false,
      status: 'published',
      gradingScaleId: scaleId,
    },
  ]);

  const lectPack = (() => {
    const itemRows: Array<typeof items.$inferInsert> = [];
    const tagRows: Array<typeof itemTaxonomyTags.$inferInsert> = [];
    const out: SeedItem[] = [];
    LECT_SKILL_CYCLE.forEach((nodeCode, idx) => {
      const position = idx + 1;
      const correctKey = KEYS[idx % 4]!;
      const id = uid(0x600 + position);
      const nodeId = nodeByCode.get(nodeCode)!;
      out.push({ id, position, nodeId, correctKey });
      itemRows.push({
        id, orgId: DEMO_ORG_ID, instrumentId: INST_LECT, position, type: 'multiple_choice',
        content: buildItemContent(LECT_QUESTIONS, idx, position, correctKey, 'Lectura'),
        scoringConfig: { points: 1, partialCredit: false }, status: 'published', source: 'official',
      });
      tagRows.push({ id: uid(0x630 + position), itemId: id, nodeId, tagType: 'primary', confidence: '1.00', taggedBy: 'human' });
    });
    return { itemRows, tagRows, out };
  })();
  const matPack = (() => {
    const itemRows: Array<typeof items.$inferInsert> = [];
    const tagRows: Array<typeof itemTaxonomyTags.$inferInsert> = [];
    const out: SeedItem[] = [];
    MAT_SKILL_CYCLE.forEach((nodeCode, idx) => {
      const position = idx + 1;
      const correctKey = KEYS[idx % 4]!;
      const id = uid(0x680 + position);
      const nodeId = nodeByCode.get(nodeCode)!;
      out.push({ id, position, nodeId, correctKey });
      itemRows.push({
        id, orgId: DEMO_ORG_ID, instrumentId: INST_MAT, position, type: 'multiple_choice',
        content: buildItemContent(MAT_QUESTIONS, idx, position, correctKey, 'Matemática'),
        scoringConfig: { points: 1, partialCredit: false }, status: 'published', source: 'official',
      });
      tagRows.push({ id: uid(0x6b0 + position), itemId: id, nodeId, tagType: 'primary', confidence: '1.00', taggedBy: 'human' });
    });
    return { itemRows, tagRows, out };
  })();
  await db.insert(items).values([...lectPack.itemRows, ...matPack.itemRows]);
  await db.insert(itemTaxonomyTags).values([...lectPack.tagRows, ...matPack.tagRows]);
  const itemNodeCode = new Map<string, string>(); // itemId -> nodeCode (para prob.)
  LECT_SKILL_CYCLE.forEach((c, i) => itemNodeCode.set(uid(0x600 + i + 1), c));
  MAT_SKILL_CYCLE.forEach((c, i) => itemNodeCode.set(uid(0x680 + i + 1), c));

  // ── 9. Evaluaciones históricas con respuestas + resultados ─────────────────
  type AssessmentDef = {
    id: string; name: string; instrumentItems: SeedItem[]; cgId: string;
    year: number; period: string; date: string; instrumentId: string;
  };
  const A: AssessmentDef[] = [
    // Lenguaje — 2° A a través de 3 años (comparación generacional) + progresión
    { id: uid(0x700), name: 'DIA Lectura · Diagnóstico 2024', instrumentItems: lectPack.out, cgId: CG.a2024, year: 2024, period: 'diagnostico', date: '2024-03-20', instrumentId: INST_LECT },
    { id: uid(0x701), name: 'DIA Lectura · Final 2024', instrumentItems: lectPack.out, cgId: CG.a2024, year: 2024, period: 'final', date: '2024-11-12', instrumentId: INST_LECT },
    { id: uid(0x702), name: 'DIA Lectura · Diagnóstico 2025', instrumentItems: lectPack.out, cgId: CG.a2025, year: 2025, period: 'diagnostico', date: '2025-03-19', instrumentId: INST_LECT },
    { id: uid(0x703), name: 'DIA Lectura · Final 2025', instrumentItems: lectPack.out, cgId: CG.a2025, year: 2025, period: 'final', date: '2025-11-11', instrumentId: INST_LECT },
    { id: uid(0x704), name: 'DIA Lectura · Diagnóstico 2026', instrumentItems: lectPack.out, cgId: CG.a2026, year: 2026, period: 'diagnostico', date: '2026-03-18', instrumentId: INST_LECT },
    { id: uid(0x705), name: 'DIA Lectura · Intermedia 2026', instrumentItems: lectPack.out, cgId: CG.a2026, year: 2026, period: 'intermedia', date: '2026-07-15', instrumentId: INST_LECT },
    // 2° B 2026 — segundo curso con datos
    { id: uid(0x706), name: 'DIA Lectura · Diagnóstico 2026', instrumentItems: lectPack.out, cgId: CG.b2026, year: 2026, period: 'diagnostico', date: '2026-03-18', instrumentId: INST_LECT },
    // Matemática — segunda asignatura
    { id: uid(0x707), name: 'DIA Matemática · Diagnóstico 2025', instrumentItems: matPack.out, cgId: CG.a2025, year: 2025, period: 'diagnostico', date: '2025-03-26', instrumentId: INST_MAT },
    { id: uid(0x708), name: 'DIA Matemática · Diagnóstico 2026', instrumentItems: matPack.out, cgId: CG.a2026, year: 2026, period: 'diagnostico', date: '2026-03-25', instrumentId: INST_MAT },
    { id: uid(0x709), name: 'DIA Matemática · Diagnóstico 2026 (3°A)', instrumentItems: matPack.out, cgId: CG.c2026, year: 2026, period: 'diagnostico', date: '2026-03-25', instrumentId: INST_MAT },
  ];

  let totalResponses = 0;
  for (const a of A) {
    const cohort = studentsByCg.get(a.cgId)!;
    await db.insert(assessments).values({
      id: a.id, orgId: DEMO_ORG_ID, instrumentId: a.instrumentId, name: a.name,
      administeredById: DEMO_USER_IDS.teacher, mode: 'paper', status: 'completed',
      administeredAt: new Date(`${a.date}T12:00:00Z`), config: { period: a.period },
    });
    await db.insert(assessmentCourseAssignments).values({ assessmentId: a.id, classGroupId: a.cgId });

    const respRows: Array<typeof responses.$inferInsert> = [];
    const calcRows: ResponseForCalculation[] = [];
    for (const st of cohort) {
      for (const it of a.instrumentItems) {
        const nodeCode = itemNodeCode.get(it.id)!;
        const { isCorrect, chosen } = answerFor(a.id, st.id, it, nodeCode, a.year, a.period);
        const raw = isCorrect ? '1.00' : '0.00';
        respRows.push({
          assessmentId: a.id, studentId: st.id, itemId: it.id,
          value: { raw: chosen }, isCorrect, rawScore: raw, maxScore: '1.00', finalScore: raw,
          scoredBy: 'auto', scoredAt: new Date(`${a.date}T12:00:00Z`),
        });
        calcRows.push({
          studentId: st.id, itemId: it.id, isCorrect, rawScore: isCorrect ? 1 : 0,
          finalScore: isCorrect ? 1 : 0, maxScore: 1, itemPosition: it.position,
          taxonomyNodeIds: [it.nodeId],
        });
      }
    }
    await db.insert(responses).values(respRows);
    totalResponses += respRows.length;

    const studentAgg = aggregateStudentResults(calcRows, SCALE);
    const skillAgg = aggregateSkillResults(calcRows, SCALE);
    await db.insert(assessmentResults).values(
      studentAgg.map((s) => ({
        assessmentId: a.id, studentId: s.studentId,
        totalScore: s.totalScore.toFixed(2), maxScore: s.maxScore.toFixed(2),
        percentage: (s.percentage * 100).toFixed(2), grade: s.grade.toFixed(2),
        performanceLevel: s.performanceLevel, isComplete: s.isComplete,
        completedAt: new Date(`${a.date}T12:00:00Z`),
      })),
    );
    await db.insert(skillResults).values(
      skillAgg.map((s) => ({
        assessmentId: a.id, studentId: s.studentId, nodeId: s.nodeId,
        correctCount: s.correctCount, totalCount: s.totalCount,
        percentage: (s.percentage * 100).toFixed(2), performanceLevel: s.performanceLevel,
      })),
    );
    console.log(`  ✓ ${a.name} — ${cohort.length} alumnos, ${respRows.length} respuestas`);
  }

  // ── 10. CSVs de hojas de respuesta para probar el flujo de UPLOAD ──────────
  // Estos assessments NO se siembran: los crea el upload en la plataforma.
  const outDir = resolve(__dirname, '../../data/e2e-answer-sheets');
  mkdirSync(outDir, { recursive: true });

  function buildCsv(
    cohort: SeedStudent[], itemsArr: SeedItem[], seed: string, year: number, period: string,
  ): string {
    const header = ['RUT', 'Apellidos', 'Nombres', ...itemsArr.map((i) => `p${i.position}`)].join(',');
    const lines = cohort.map((st) => {
      const ans = itemsArr.map((it) => {
        const nodeCode = itemNodeCode.get(it.id)!;
        return answerFor(seed, st.id, it, nodeCode, year, period).chosen;
      });
      return [st.rut, st.lastName, st.firstName, ...ans].join(',');
    });
    return `${header}\n${lines.join('\n')}\n`;
  }

  const lectFinal2026 = buildCsv(studentsByCg.get(CG.a2026)!, lectPack.out, 'UPLOAD-LECT-FINAL-2026', 2026, 'final');
  writeFileSync(resolve(outDir, 'lectura-2A-final-2026.csv'), lectFinal2026);
  const matDiag2026B = buildCsv(studentsByCg.get(CG.b2026)!, matPack.out, 'UPLOAD-MAT-DIAG-2026B', 2026, 'diagnostico');
  writeFileSync(resolve(outDir, 'matematica-2B-diagnostico-2026.csv'), matDiag2026B);

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed E2E completado:');
  console.log(`   • 3 años académicos (2024, 2025, 2026)`);
  console.log(`   • 5 cursos, ${studentValues.length} alumnos, ${enrollmentValues.length} matrículas`);
  console.log(`   • 2 instrumentos (Lectura + Matemática 2°B), 20 ítems, 20 tags de habilidad`);
  console.log(`   • ${A.length} evaluaciones, ${totalResponses} respuestas, resultados + skill_results`);
  console.log(`   • CSVs para upload en: packages/db/data/e2e-answer-sheets/`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed E2E falló:', err);
  process.exit(1);
});
