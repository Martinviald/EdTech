/* ETAPA 1 — Extracción READ-ONLY de la planta docente (Excel) a un artefacto
   JSON revisable. No toca la base de datos.

   Entrada:  el facsímil de planta docente del colegio (hojas "COMPLETAR PLANTA
             DOCENTE" con la carga curso × asignatura × profesor, y "LISTADO
             PERSONAL" con el correo de cada persona).
   Salida:   out/planta-docente.json  { assignments[], homerooms[], discarded[], unmapped[] }

   Uso:
     node scripts/cscj/planta-docente/01-extract-planta.cjs --file "<ruta.xlsx>" [--year 2026]

   El cruce planta↔correo es por nombre normalizado sin tildes ni guiones y con
   los tokens ordenados: la planta escribe "NOMBRES APELLIDOS" y el listado
   "APELLIDOS NOMBRES".
*/
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..'); // repositorio/
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));
const { parseCursoLabel } = require(path.join(ROOT, 'packages/types/dist/utils/curso-parser.js'));
const { mapSubject, normalizeLabel, toParsableCurso } = require('./subject-map.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.split('=').slice(1).join('=') : fallback;
};

const FILE = opt('file');
const YEAR = Number(opt('year', '2026'));
if (!FILE) throw new Error('Falta --file <ruta al Excel de planta docente>');

const SHEET_PLANTA = 'COMPLETAR PLANTA DOCENTE';
const SHEET_PERSONAL = 'LISTADO PERSONAL';

/** Clave de identidad de una persona: tokens del nombre ordenados. */
function nameKey(s) {
  return normalizeLabel(s).replace(/-/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
function displayName(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nivel + letra de la planta → etiqueta de curso parseable. */
function cursoFromRow(nivel, letra) {
  const n = normalizeLabel(nivel);
  const l = normalizeLabel(letra);
  if (!l || !/^[A-Z]$/.test(l)) return null;
  const NIVEL = {
    PK: 'Prekinder',
    K: 'Kinder',
    1: '1',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    I: '1 Medio',
    II: '2 Medio',
    III: '3 Medio',
    IV: '4 Medio',
  };
  // La planta guarda los niveles básicos como números con decimal ("1.0").
  const key = n.replace(/\.0$/, '');
  const label = NIVEL[key];
  if (!label) return null;
  return `${label} ${l}`;
}

const wb = XLSX.readFile(FILE);
const rowsPlanta = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_PLANTA], { header: 1, defval: '' });
const rowsPersonal = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_PERSONAL], { header: 1, defval: '' });

// ── Correos por persona ───────────────────────────────────────────────────────
const emailByName = new Map();
for (const r of rowsPersonal.slice(1)) {
  const name = r[1];
  const email = String(r[7] ?? '').trim();
  if (!name || !email.includes('@')) continue;
  emailByName.set(nameKey(name), email.toLowerCase());
}

// ── Filas de la planta ────────────────────────────────────────────────────────
const assignments = [];
const homerooms = [];
const discarded = [];
const unmapped = [];
const seenAssignment = new Set();
const seenHomeroom = new Set();

for (const r of rowsPlanta.slice(1)) {
  const [, tipo, , asignatura, nivel, letra, , docente] = r;
  if (!docente || !asignatura) continue;

  const cursoLabel = cursoFromRow(nivel, letra);
  const curso = cursoLabel ? parseCursoLabel(toParsableCurso(cursoLabel)) : null;
  const person = displayName(docente);
  const email = emailByName.get(nameKey(person)) ?? null;
  const label = normalizeLabel(asignatura);

  // Jefatura: es un rol sobre el curso, no una asignatura.
  if (label === 'JEFATURA DE CURSO') {
    if (!curso) continue;
    const k = `${curso.gradeCode}|${curso.section}|${nameKey(person)}`;
    if (seenHomeroom.has(k)) continue;
    seenHomeroom.add(k);
    homerooms.push({ gradeCode: curso.gradeCode, section: curso.section, teacher: person, email });
    continue;
  }

  const mapped = mapSubject(asignatura);
  if (mapped.skip) {
    // `non_teaching` (reuniones, cargos) y `not_evaluated` (asignaturas sin
    // instrumentos) son descartes ESPERADOS por política, no errores.
    discarded.push({ reason: mapped.skip, subject: displayName(asignatura), teacher: person });
    continue;
  }

  if (!curso) {
    // Los electivos de III°/IV° usan "elect"/"TALLER" como sección: son grupos
    // que cruzan las secciones del nivel, así que NO tienen class_group y no
    // pueden modelarse como subject_class. Descarte estructural esperado.
    const seccionNoLectiva = !/^[A-Z]$/.test(normalizeLabel(letra));
    if (seccionNoLectiva) {
      discarded.push({
        reason: 'electivo_sin_seccion',
        subject: displayName(asignatura),
        nivel: String(nivel),
        seccion: String(letra),
        teacher: person,
      });
      continue;
    }
    unmapped.push({
      reason: 'curso_no_resuelto',
      nivel: String(nivel),
      letra: String(letra),
      teacher: person,
    });
    continue;
  }
  if (!email) {
    // Vacantes sin nombrar ("NN <asignatura>") no son personas: no hay a quién
    // asignar. Cualquier otro nombre sin correo SÍ es un error a revisar.
    if (/^NN\b/.test(normalizeLabel(person))) {
      discarded.push({
        reason: 'vacante_sin_nombrar',
        subject: displayName(asignatura),
        teacher: person,
      });
      continue;
    }
    unmapped.push({ reason: 'sin_email', teacher: person, subject: displayName(asignatura) });
    continue;
  }

  const key = `${curso.gradeCode}|${curso.section}|${mapped.code}|${nameKey(person)}`;
  if (seenAssignment.has(key)) continue;
  seenAssignment.add(key);
  assignments.push({
    gradeCode: curso.gradeCode,
    section: curso.section,
    subjectCode: mapped.code,
    teacher: person,
    email,
  });
}

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = {
  year: YEAR,
  source: path.basename(FILE),
  assignments,
  homerooms,
  discarded,
  unmapped,
};
fs.writeFileSync(path.join(OUT_DIR, 'planta-docente.json'), JSON.stringify(out, null, 2));

const bySubject = assignments.reduce(
  (a, x) => ((a[x.subjectCode] = (a[x.subjectCode] ?? 0) + 1), a),
  {},
);
console.log(`\n=== EXTRACCIÓN PLANTA DOCENTE ${YEAR} ===`);
console.log(`Asignaciones (curso × asignatura × docente): ${assignments.length}`, bySubject);
console.log(`Docentes distintos: ${new Set(assignments.map((a) => a.email)).size}`);
console.log(
  `Jefaturas de curso: ${homerooms.length} (sin email: ${homerooms.filter((h) => !h.email).length})`,
);
console.log(`Descartes esperados: ${discarded.length}`);
console.log(
  `  - no lectivas:        ${discarded.filter((d) => d.reason === 'non_teaching').length}`,
);
console.log(
  `  - asignatura sin evaluaciones: ${discarded.filter((d) => d.reason === 'not_evaluated').length}`,
);
console.log(
  `  - electivos sin sección:       ${discarded.filter((d) => d.reason === 'electivo_sin_seccion').length}`,
);
console.log(
  `  - vacantes sin nombrar:        ${discarded.filter((d) => d.reason === 'vacante_sin_nombrar').length}`,
);
console.log(`SIN MAPEAR (revisar): ${unmapped.length}`);
for (const u of unmapped.slice(0, 20)) console.log('   ', JSON.stringify(u));
console.log(`\nArtefacto: ${path.join(OUT_DIR, 'planta-docente.json')}`);
