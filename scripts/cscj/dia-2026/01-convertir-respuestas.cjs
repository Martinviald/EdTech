/* Conversor: planillas de respuestas DIA 2026 (dia-ingesta/data/respuestas_reales)
   -> un artefacto JSON único que consume `packages/db/src/seed/import-dia-2026-responses.ts`.

   Cada planilla trae la hoja "Respuestas" (Nombre | RUT | P1..Pn) y la hoja
   "Mapeo DIA" (columna -> posición DIA + tipo de ítem). El curso y la asignatura
   se derivan de la ruta y del nombre del archivo.

   Cuando existen las dos variantes de un mismo curso+asignatura (`X.xlsx` y
   `X_ingesta.xlsx`) se prefiere la primera; la `_ingesta` solo se usa si es la única.

   Uso:
     node scripts/cscj/dia-2026/01-convertir-respuestas.cjs [--out=<ruta.json>]
*/
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));

const RESPUESTAS_DIR = path.resolve(ROOT, '../dia-ingesta/data/respuestas_reales');
const DEFAULT_OUT = path.join(__dirname, 'out/dia-2026-respuestas.json');

const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice('--out='.length)) : DEFAULT_OUT;

/* `gradecam_pull.py` nombra la carpeta de media con el romano (`I`, `II`); las
   planillas viejas de I° medio quedaron bajo `1ro medio`. Ambas mapean al mismo
   grado y `pickOnePerCourse` resuelve el duplicado si aparecieran las dos. */
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

const SUBJECT_BY_TOKEN = {
  MATEM: 'Matemáticas',
  CIENCIAS: 'Ciencias Naturales',
  HISTORIA: 'Historia, Geografía y Cs. Sociales',
  INGL: 'Inglés',
  LECTURA: 'Lenguaje y Comunicación',
  LENGUAJE: 'Lenguaje y Comunicación',
};

const APPLICATION_PERIOD = 'intermedio';
const YEAR = 2026;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.xlsx') && !entry.name.startsWith('~$')) out.push(full);
  }
  return out;
}

function subjectFromFileName(base) {
  const token = Object.keys(SUBJECT_BY_TOKEN).find((t) => base.toUpperCase().includes(`_${t}`));
  return token ? SUBJECT_BY_TOKEN[token] : null;
}

function sectionFromFolder(courseFolder) {
  const match = courseFolder.toUpperCase().match(/([AB])$/);
  return match ? match[1] : null;
}

function normalizeRutRaw(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase().replace(/[.\s]/g, '');
}

function readSheetRows(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
}

function parseWorkbook(file) {
  const rel = path.relative(RESPUESTAS_DIR, file);
  const [gradeFolder, courseFolder] = rel.split(path.sep);
  const base = path.basename(file, '.xlsx');

  const gradeCode = GRADE_BY_FOLDER[gradeFolder];
  const section = sectionFromFolder(courseFolder);
  const subjectName = subjectFromFileName(base);
  if (!gradeCode || !section || !subjectName) {
    return { skipped: true, file: rel, reason: `no se pudo derivar grade/section/subject` };
  }

  const workbook = XLSX.readFile(file);
  const respuestas = readSheetRows(workbook, 'Respuestas');
  if (respuestas.length < 2) return { skipped: true, file: rel, reason: 'hoja Respuestas vacía' };

  const header = respuestas[0].map((c) => (c === null ? '' : String(c).trim()));
  const questionColumns = [];
  const subNumbered = [];
  header.forEach((label, index) => {
    if (!/^P\d/i.test(label)) return;
    const m = /^P(\d+)$/i.exec(label);
    if (m) questionColumns.push({ index, position: Number(m[1]) });
    else subNumbered.push(label);
  });
  const positions = questionColumns.map((c) => c.position).sort((a, b) => a - b);
  const isContiguous = positions.every((p, i) => p === i + 1);

  const rutIndex = header.findIndex((h) => h.toUpperCase() === 'RUT');
  const nameIndex = header.findIndex((h) => h.toUpperCase() === 'NOMBRE');

  const rows = [];
  for (const raw of respuestas.slice(1)) {
    if (!raw || !raw[nameIndex]) continue;
    const answers = {};
    for (const { index, position } of questionColumns) {
      const cell = raw[index];
      const value = cell === null || cell === undefined ? null : String(cell).trim();
      answers[String(position)] = value === '' ? null : value;
    }
    rows.push({
      rut: normalizeRutRaw(raw[rutIndex]),
      nombre: String(raw[nameIndex]).trim().replace(/\s+/g, ' '),
      answers,
    });
  }

  const itemTypes = {};
  for (const raw of readSheetRows(workbook, 'Mapeo DIA').slice(1)) {
    if (!raw || !raw[1]) continue;
    itemTypes[String(raw[1]).trim()] = raw[3] === null ? null : String(raw[3]).trim();
  }

  return {
    skipped: false,
    file: rel,
    sourceFile: path.basename(file),
    gradeCode,
    section,
    subjectName,
    year: YEAR,
    applicationPeriod: APPLICATION_PERIOD,
    questionCount: questionColumns.length,
    subNumbered,
    isNormalized: subNumbered.length === 0 && isContiguous,
    itemTypes,
    rows,
  };
}

function isBetterCandidate(candidate, current) {
  if (candidate.isNormalized !== current.isNormalized) return candidate.isNormalized;
  const candidateIsIngesta = candidate.sourceFile.includes('_ingesta');
  const currentIsIngesta = current.sourceFile.includes('_ingesta');
  return currentIsIngesta && !candidateIsIngesta;
}

function pickOnePerCourse(parsed, discarded) {
  const byKey = new Map();
  for (const course of parsed) {
    const key = `${course.gradeCode}|${course.section}|${course.subjectName}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, course);
      continue;
    }
    const winner = isBetterCandidate(course, current) ? course : current;
    const loser = winner === course ? current : course;
    discarded.push({ loser, winner });
    byKey.set(key, winner);
  }
  return [...byKey.values()];
}

function main() {
  const files = walk(RESPUESTAS_DIR).sort();
  const parsed = [];
  const skipped = [];
  for (const file of files) {
    const result = parseWorkbook(file);
    if (result.skipped) skipped.push(result);
    else parsed.push(result);
  }

  const discarded = [];
  const courses = pickOnePerCourse(parsed, discarded).sort((a, b) =>
    `${a.gradeCode}${a.section}${a.subjectName}`.localeCompare(
      `${b.gradeCode}${b.section}${b.subjectName}`,
    ),
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ year: YEAR, courses }, null, 2), 'utf8');

  console.log(`\n== Conversión respuestas DIA ${YEAR} ==`);
  console.log(`  archivos leídos: ${files.length}`);
  console.log(`  cursos emitidos: ${courses.length}`);
  for (const s of skipped) console.warn(`  ⚠ omitido ${s.file}: ${s.reason}`);
  for (const { loser, winner } of discarded) {
    console.log(`  duplicado: se usa ${winner.sourceFile} y se descarta ${loser.sourceFile}`);
  }
  for (const c of courses) {
    if (c.subNumbered.length) {
      console.warn(
        `  ⚠ ${c.sourceFile}: columnas sub-numeradas sin equivalente entero [${c.subNumbered.join(',')}] — las posiciones NO calzarán con el instrumento`,
      );
    }
  }

  const bySubject = new Map();
  for (const c of courses) {
    const entry = bySubject.get(c.subjectName) ?? { cursos: 0, alumnos: 0 };
    entry.cursos += 1;
    entry.alumnos += c.rows.length;
    bySubject.set(c.subjectName, entry);
  }
  for (const [subject, entry] of bySubject) {
    console.log(`  ${subject}: ${entry.cursos} cursos · ${entry.alumnos} filas`);
  }
  console.log(`\n  → ${OUT}`);
}

main();
