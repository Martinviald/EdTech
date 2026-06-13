/* ETAPA 1 — Extracción READ-ONLY del Excel "Cursos 2025.xlsx" a un artefacto JSON
   revisable. No toca la base de datos.

   Reutiliza las funciones REALES del repo (sin duplicar lógica):
     - normalizeRut       (packages/types/dist/utils/rut.js)        Módulo 11.
     - parseCursoLabel    (packages/types/dist/utils/curso-parser.js)

   Decisiones aplicadas (acordadas con el usuario):
     - Alcance COMPLETO: rut, nombre, apellido, género, fecha nac., estado.
     - SOLO ACTIVOS: los alumnos con "Retiro" en Observaciones y la hoja
       "Consolidado Retiros" (bajas 2024) se EXCLUYEN del set de carga (se reportan).
     - INFERIR Y MARCAR: RUT inválido se corrige por el RUT del email si valida;
       duplicados en 2 secciones se resuelven quedándose con la última sección.
*/
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..'); // repositorio/
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));
const { normalizeRut } = require(path.join(ROOT, 'packages/types/dist/utils/rut.js'));
const { parseCursoLabel } = require(path.join(ROOT, 'packages/types/dist/utils/curso-parser.js'));

const FILE = path.resolve(ROOT, '../docs/Listas de curso CSCJ/Cursos 2025.xlsx');
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const wb = XLSX.readFile(FILE, { cellDates: true });
const COURSE_SHEETS = wb.SheetNames.filter((n) => n !== 'Consolidado Retiros');

// Media viene en romano en los nombres de hoja; el parser espera arábigo + "Medio".
// Mapeo de token de hoja -> etiqueta que parseCursoLabel reconoce.
// Media va en romano; "PK" debe expandirse (el parser no matchea "PK", sí "PREKINDER").
const GRADE_TOKEN_TO_LABEL = {
  PK: 'Prekinder',
  I: '1 Medio',
  II: '2 Medio',
  III: '3 Medio',
  IV: '4 Medio',
};
function sheetToCursoLabel(name) {
  const m = name.match(/^([A-Za-z]+|\d+)-([A-Z])$/);
  if (!m) return null;
  const [, grade, section] = m;
  return GRADE_TOKEN_TO_LABEL[grade] ? `${GRADE_TOKEN_TO_LABEL[grade]} ${section}` : `${grade} ${section}`;
}

const FOOTER_NAMES = new Set(['mujeres', 'hombres', 'total alumnos', 'total', 'matricula', 'matrícula']);
function isFooterRow(name, birth, email) {
  if (FOOTER_NAMES.has(String(name).trim().toLowerCase())) return true;
  // Las filas de alumno SIEMPRE traen fecha de nac. y email; los totales no.
  return birth == null && email == null;
}

function splitName(full) {
  const parts = String(full).trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length <= 2) return { lastName: parts[0] ?? '', firstName: parts.slice(1).join(' ') };
  // Convención chilena: 2 apellidos. lastName+firstName reconstruye el original.
  return { lastName: parts.slice(0, 2).join(' '), firstName: parts.slice(2).join(' ') };
}

function mapGender(sexo) {
  if (sexo == null) return 'unspecified';
  const s = String(sexo).trim().toUpperCase();
  if (s === 'M') return 'M';
  if (s === 'F') return 'F';
  return 'unspecified';
}

function toDateOnly(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10); // medianoche local CL == fecha UTC
  return null;
}

function classifyStatus(obs) {
  if (!obs) return 'active';
  return /retir/i.test(String(obs)) ? 'withdrawn' : 'active';
}

function emailDigits(email) {
  if (!email) return null;
  const m = String(email).match(/^([0-9kK]+)@/);
  return m ? m[1] : null;
}

// ---------- pase 1: extraer todas las filas de alumno ----------
const all = [];
for (const sheet of COURSE_SHEETS) {
  const cursoLabel = sheetToCursoLabel(sheet);
  const parsed = parseCursoLabel(cursoLabel);
  if (!parsed) throw new Error(`No se pudo parsear el curso de la hoja "${sheet}" (label="${cursoLabel}")`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null });
  for (const r of rows.slice(1)) {
    const name = r[1] == null ? '' : String(r[1]).trim();
    if (!name) continue;
    if (isFooterRow(name, r[4], r[5])) continue;
    const { lastName, firstName } = splitName(name);
    all.push({
      sheet,
      gradeCode: parsed.gradeCode,
      section: parsed.section,
      fullName: name,
      lastName,
      firstName,
      gender: mapGender(r[2]),
      rawGender: r[2] ?? null,
      rawRut: r[3] == null ? null : String(r[3]),
      birthDate: toDateOnly(r[4]),
      email: r[5] == null ? null : String(r[5]),
      observaciones: r[6] == null ? null : String(r[6]).trim(),
      status: classifyStatus(r[6]),
      marks: [],
    });
  }
}

// ---------- pase 2: resolver RUT (normalizar / inferir / marcar) ----------
const rutUnresolved = [];
const rutInferred = [];
for (const rec of all) {
  const direct = normalizeRut(rec.rawRut);
  if (direct) {
    rec.rut = direct;
    continue;
  }
  // intento de inferencia por el RUT del email
  const fromEmail = normalizeRut(emailDigits(rec.email));
  if (fromEmail) {
    rec.rut = fromEmail;
    rec.marks.push(`RUT corregido por email: "${rec.rawRut}" -> ${fromEmail}`);
    rutInferred.push({ sheet: rec.sheet, fullName: rec.fullName, rawRut: rec.rawRut, fixed: fromEmail });
    continue;
  }
  // no se puede inferir un RUT chileno válido (posible IPE/extranjero): se conserva
  // el valor crudo limpio como identificador y se marca para revisión humana.
  const cleaned = String(rec.rawRut ?? '').replace(/[.\s-]/g, '').toUpperCase();
  rec.rut = cleaned ? `IPE:${cleaned}` : `SINRUT:${rec.sheet}:${rec.lastName}`;
  rec.marks.push(`RUT inválido y no inferible (orig "${rec.rawRut}") — REVISAR (posible IPE/extranjero)`);
  rutUnresolved.push({ sheet: rec.sheet, fullName: rec.fullName, rawRut: rec.rawRut, stored: rec.rut });
}

// ---------- pase 3: separar activos / retirados (solo activos se cargan) ----------
const withdrawn = all.filter((r) => r.status === 'withdrawn');
let active = all.filter((r) => r.status === 'active');

// ---------- pase 4: deduplicar RUT entre secciones (quedarse con última sección) ----------
const byRut = new Map();
for (const r of active) {
  if (!byRut.has(r.rut)) byRut.set(r.rut, []);
  byRut.get(r.rut).push(r);
}
const duplicatesResolved = [];
const dropped = new Set();
for (const [rut, recs] of byRut) {
  if (recs.length <= 1) continue;
  // ordenar por sección asc y conservar la última (mayor letra)
  const sorted = [...recs].sort((a, b) => a.section.localeCompare(b.section));
  const keep = sorted[sorted.length - 1];
  const drop = sorted.slice(0, -1);
  keep.marks.push(`Duplicado resuelto: aparecía en [${recs.map((x) => x.sheet).join(', ')}], se conserva ${keep.sheet}`);
  for (const d of drop) dropped.add(d);
  duplicatesResolved.push({
    rut,
    fullName: keep.fullName,
    keptSheet: keep.sheet,
    droppedSheets: drop.map((d) => d.sheet),
  });
}
active = active.filter((r) => !dropped.has(r));

// ---------- reconciliación por curso ----------
const perCourse = {};
for (const r of active) {
  const key = `${r.gradeCode} ${r.section}`;
  perCourse[key] = (perCourse[key] || 0) + 1;
}

const genderNull = active.filter((r) => r.gender === 'unspecified')
  .map((r) => ({ sheet: r.sheet, fullName: r.fullName }));

// ---------- emitir artefactos ----------
const loadRecords = active.map((r) => ({
  rut: r.rut,
  firstName: r.firstName,
  lastName: r.lastName,
  gender: r.gender,
  birthDate: r.birthDate,
  gradeCode: r.gradeCode,
  section: r.section,
  status: 'active',
  needsReview: r.marks.length > 0,
  marks: r.marks,
}));

const report = {
  generatedFromSheets: COURSE_SHEETS.length,
  totals: {
    rowsExtracted: all.length,
    withdrawnExcluded: withdrawn.length,
    duplicatesDropped: dropped.size,
    activeToLoad: loadRecords.length,
    needsReview: loadRecords.filter((r) => r.needsReview).length,
    genderUnspecified: genderNull.length,
  },
  rutInferred,
  rutUnresolved,
  duplicatesResolved,
  withdrawnExcluded: withdrawn.map((r) => ({ sheet: r.sheet, fullName: r.fullName, obs: r.observaciones })),
  genderNull,
  perCourseActiveCounts: perCourse,
};

fs.writeFileSync(path.join(OUT_DIR, 'roster-active.json'), JSON.stringify(loadRecords, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'roster-report.json'), JSON.stringify(report, null, 2));

console.log('=== ETAPA 1: EXTRACCIÓN COMPLETA (sin tocar BDD) ===');
console.log(JSON.stringify(report.totals, null, 2));
console.log('\nRUT inferidos por email:', rutInferred.length);
rutInferred.forEach((x) => console.log('   ', x.sheet, x.fullName, x.rawRut, '->', x.fixed));
console.log('RUT no inferibles (marcados):', rutUnresolved.length);
rutUnresolved.forEach((x) => console.log('   ', x.sheet, x.fullName, x.rawRut, '-> stored', x.stored));
console.log('Duplicados resueltos:', duplicatesResolved.length);
duplicatesResolved.forEach((x) => console.log('   ', x.fullName, x.rut, 'keep', x.keptSheet, 'drop', x.droppedSheets.join(',')));
console.log('\nArtefactos escritos en', OUT_DIR);
console.log('  roster-active.json  (', loadRecords.length, 'registros listos para cargar )');
console.log('  roster-report.json  ( reporte de integridad )');
