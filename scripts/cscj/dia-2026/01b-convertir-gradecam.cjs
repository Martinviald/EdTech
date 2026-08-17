/* Conversor DIRECTO: JSON crudo de GradeCam (dia-ingesta/data/respuestas_reales)
   -> el mismo artefacto que emite `01-convertir-respuestas.cjs`, que consume
   `packages/db/src/seed/import-dia-2026-responses.ts`.

   El camino largo (planilla `_ingesta.xlsx` de `preparar_ingesta_dia.py`) existe
   porque la INGESTA a la plataforma oficial DIA necesita alinear cada columna a
   la posición del instrumento de la Agencia. Para cargar a NUESTRA BDD eso no
   hace falta cuando las etiquetas de GradeCam ya son 1..N correlativas: el
   importador valida las posiciones contra nuestro instrumento igual, y aborta si
   no calzan. Este conversor cubre ese caso y evita depender de una sesión DIA.

   NO reemplaza al conversor de planillas: las celdas cuyo Excel se corrigió a
   mano (dobles marcas -> NULA, escaneo sucio) deben seguir saliendo del .xlsx.
   `--verify` existe para no descubrir eso tarde.

   Uso:
     node scripts/cscj/dia-2026/01b-convertir-gradecam.cjs --out=<ruta.json>
     node scripts/cscj/dia-2026/01b-convertir-gradecam.cjs --only=2do/2A,4to/4B
     node scripts/cscj/dia-2026/01b-convertir-gradecam.cjs --verify=<artefacto.json>
*/
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const RESPUESTAS_DIR = path.resolve(ROOT, '../dia-ingesta/data/respuestas_reales');
const DEFAULT_OUT = path.join(__dirname, 'out/dia-2026-respuestas-gradecam.json');

const arg = (name) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};
const OUT = arg('out') ? path.resolve(arg('out')) : DEFAULT_OUT;
const VERIFY = arg('verify') ? path.resolve(arg('verify')) : null;
const ONLY = (arg('only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const GRADE_BY_FOLDER = {
  '2do': '2ND_BASIC',
  '3ro': '3RD_BASIC',
  '4to': '4TH_BASIC',
  '5to': '5TH_BASIC',
  '6to': '6TH_BASIC',
  '7mo': '7TH_BASIC',
  '8vo': '8TH_BASIC',
  '1ro medio': '1ST_MEDIO',
  I: '1ST_MEDIO',
  II: '2ND_MEDIO',
};

const SUBJECT_BY_TOKEN = [
  ['matematica', 'Matemáticas'],
  ['ciencias', 'Ciencias Naturales'],
  ['historia', 'Historia, Geografía y Cs. Sociales'],
  ['ingles', 'Inglés'],
  ['lenguaje', 'Lenguaje y Comunicación'],
  ['lectura', 'Lenguaje y Comunicación'],
];

const APPLICATION_PERIOD = 'intermedio';
const YEAR = 2026;

function sinTildes(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function subjectFromFileName(base) {
  const norm = sinTildes(base).toLowerCase();
  const hit = SUBJECT_BY_TOKEN.find(([token]) => norm.includes(token));
  return hit ? hit[1] : null;
}

function sectionFromFolder(courseFolder) {
  const match = courseFolder.toUpperCase().match(/([AB])$/);
  return match ? match[1] : null;
}

function formatRut(uid) {
  const raw = String(uid ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]/g, '');
  if (raw.length < 2) return '';
  return `${raw.slice(0, -1)}-${raw.slice(-1)}`;
}

function fullName(student) {
  const last = String(student?.last_name ?? '').trim();
  const first = String(student?.first_name ?? '').trim();
  return `${last} ${first}`.trim().replace(/\s+/g, ' ');
}

function walkJson(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.name.endsWith('.json') && !entry.name.startsWith('.')) out.push(full);
  }
  return out;
}

function parseGradecamFile(file) {
  const rel = path.relative(RESPUESTAS_DIR, file);
  const parts = rel.split(path.sep);
  if (parts.length < 3) return { skipped: true, file: rel, reason: 'ruta inesperada' };
  const [gradeFolder, courseFolder] = parts;
  const base = path.basename(file, '.json');

  const gradeCode = GRADE_BY_FOLDER[gradeFolder];
  const section = sectionFromFolder(courseFolder);
  const subjectName = subjectFromFileName(base);
  if (!gradeCode || !section || !subjectName) {
    return { skipped: true, file: rel, reason: 'no se pudo derivar grade/section/subject' };
  }

  const scans = JSON.parse(fs.readFileSync(file, 'utf8')).filteredItems ?? [];
  if (!scans.length) return { skipped: true, file: rel, reason: 'sin escaneos' };

  const labels = new Set();
  const itemTypes = {};
  const rows = [];
  for (const scan of scans) {
    const nombre = fullName(scan.student);
    if (!nombre) continue;
    const answers = {};
    for (const a of scan.stats?.answers ?? []) {
      const label = String(a.label ?? '').trim();
      if (!/^\d+$/.test(label)) {
        labels.add(label);
        continue;
      }
      labels.add(label);
      itemTypes[label] = a.type ?? null;
      const value = a.ans === null || a.ans === undefined ? null : String(a.ans).trim();
      answers[label] = value === '' ? null : value;
    }
    rows.push({ rut: formatRut(scan.student?.student_uid), nombre, answers });
  }

  const numeric = [...labels].filter((l) => /^\d+$/.test(l)).map(Number);
  const subNumbered = [...labels].filter((l) => !/^\d+$/.test(l));
  const positions = numeric.sort((a, b) => a - b);
  const isContiguous = positions.every((p, i) => p === i + 1);

  return {
    skipped: false,
    file: rel,
    sourceFile: path.basename(file),
    gradeCode,
    section,
    subjectName,
    year: YEAR,
    applicationPeriod: APPLICATION_PERIOD,
    questionCount: positions.length,
    subNumbered,
    isNormalized: subNumbered.length === 0 && isContiguous,
    itemTypes,
    rows,
  };
}

function courseKey(c) {
  return `${c.gradeCode}|${c.section}|${c.subjectName}`;
}

function diffCourse(mine, theirs) {
  const problems = [];
  if (mine.questionCount !== theirs.questionCount) {
    problems.push(`questionCount ${mine.questionCount} vs ${theirs.questionCount}`);
  }
  const byRut = (course) => new Map(course.rows.map((r) => [r.rut, r]));
  const a = byRut(mine);
  const b = byRut(theirs);
  const soloMio = [...a.keys()].filter((k) => !b.has(k));
  const soloSuyo = [...b.keys()].filter((k) => !a.has(k));
  if (soloMio.length) problems.push(`${soloMio.length} alumno(s) sólo en GradeCam`);
  if (soloSuyo.length) problems.push(`${soloSuyo.length} alumno(s) sólo en la planilla`);
  let celdas = 0;
  const ejemplos = [];
  for (const [rut, mineRow] of a) {
    const theirsRow = b.get(rut);
    if (!theirsRow) continue;
    for (const pos of new Set([
      ...Object.keys(mineRow.answers),
      ...Object.keys(theirsRow.answers),
    ])) {
      const x = mineRow.answers[pos] ?? null;
      const y = theirsRow.answers[pos] ?? null;
      if (x !== y) {
        celdas += 1;
        if (ejemplos.length < 5) ejemplos.push(`${rut} P${pos}: "${x}" vs "${y}"`);
      }
    }
  }
  if (celdas) problems.push(`${celdas} celda(s) distintas [${ejemplos.join(' · ')}]`);
  return problems;
}

function main() {
  const files = walkJson(RESPUESTAS_DIR).sort();
  const parsed = [];
  const skipped = [];
  for (const file of files) {
    const rel = path.relative(RESPUESTAS_DIR, file);
    if (ONLY.length && !ONLY.some((o) => rel.startsWith(o))) continue;
    const result = parseGradecamFile(file);
    if (result.skipped) skipped.push(result);
    else parsed.push(result);
  }

  const byKey = new Map();
  const duplicados = [];
  for (const course of parsed) {
    const key = courseKey(course);
    if (byKey.has(key)) duplicados.push({ key, sourceFile: course.sourceFile });
    else byKey.set(key, course);
  }
  const courses = [...byKey.values()].sort((a, b) => courseKey(a).localeCompare(courseKey(b)));

  console.log(`\n== Conversión GradeCam -> artefacto DIA ${YEAR} ==`);
  console.log(`  archivos leídos: ${files.length}`);
  console.log(`  cursos emitidos: ${courses.length}`);
  for (const s of skipped) console.warn(`  ⚠ omitido ${s.file}: ${s.reason}`);
  for (const d of duplicados) console.warn(`  ⚠ duplicado ignorado ${d.key}: ${d.sourceFile}`);
  for (const c of courses) {
    const flag = c.isNormalized ? '' : `  ⚠ etiquetas no 1..N: ${c.subNumbered.join(',')}`;
    console.log(
      `  ${c.gradeCode} ${c.section} · ${c.subjectName}: ${c.rows.length} filas · ${c.questionCount} preguntas${flag}`,
    );
  }

  if (VERIFY) {
    const theirs = JSON.parse(fs.readFileSync(VERIFY, 'utf8')).courses ?? [];
    const theirsByKey = new Map(theirs.map((c) => [courseKey(c), c]));
    console.log(`\n== Verificación contra ${path.relative(ROOT, VERIFY)} ==`);
    let iguales = 0;
    const distintos = [];
    for (const mine of courses) {
      const other = theirsByKey.get(courseKey(mine));
      if (!other) continue;
      const problems = diffCourse(mine, other);
      if (problems.length) distintos.push({ key: courseKey(mine), problems });
      else iguales += 1;
    }
    console.log(`  celdas comparables: ${iguales + distintos.length}`);
    console.log(`  idénticas: ${iguales}`);
    for (const d of distintos) console.log(`  ✗ ${d.key}: ${d.problems.join(' | ')}`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ year: YEAR, courses }, null, 2), 'utf8');
  console.log(`\n  escrito: ${path.relative(ROOT, OUT)}`);
}

main();
