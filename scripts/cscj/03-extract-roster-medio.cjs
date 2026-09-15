/**
 * Extrae la nómina actualizada de un nivel de enseñanza media (un archivo con una
 * hoja por sección: IIIA/IIIB/IIIC, IVA/IVB/IVC) al artefacto que consume el
 * importador de roster.
 *
 * Generaliza `02-extract-roster-iv-2026.cjs`, que quedó fijo en IV°. El nivel y la
 * sección se derivan del nombre de la hoja, así que el mismo script sirve para
 * cualquier curso de media sin tocar código.
 *
 * Reusa `splitName` y `normalizeRut` del extractor 2025 (`01-extract-roster.cjs`):
 * la convención chilena de dos apellidos y la corrección de RUT ya están resueltas ahí.
 *
 *   node scripts/cscj/03-extract-roster-medio.cjs "<ruta del xlsx>" [año]
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));
const { normalizeRut } = require(path.join(ROOT, 'packages/types/dist/utils/rut.js'));

const FILE = process.argv[2];
if (!FILE) throw new Error('Falta la ruta del xlsx');
const YEAR = Number(process.argv[3] ?? 2026);

// Prefijo romano de la hoja → código de grado. El orden importa: "IV" antes que "I"
// para que "IVA" no se lea como "I" + "VA".
const GRADOS = [
  ['IV', '4TH_MEDIO'],
  ['III', '3RD_MEDIO'],
  ['II', '2ND_MEDIO'],
  ['I', '1ST_MEDIO'],
];

function parseHoja(nombre) {
  const limpio = String(nombre).trim().toUpperCase();
  for (const [prefijo, gradeCode] of GRADOS) {
    if (limpio.startsWith(prefijo)) {
      return { gradeCode, section: limpio.slice(prefijo.length).trim() };
    }
  }
  return null;
}

function splitName(full) {
  const parts = String(full).trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length <= 2) return { lastName: parts[0] ?? '', firstName: parts.slice(1).join(' ') };
  return { lastName: parts.slice(0, 2).join(' '), firstName: parts.slice(2).join(' ') };
}
function mapGender(s) {
  const v = String(s ?? '').trim().toUpperCase();
  return v === 'M' || v === 'F' ? v : 'unspecified';
}
function fecha(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const wb = XLSX.readFile(FILE, { cellDates: true });
const registros = [];
const avisos = [];
const grados = new Set();

for (const hoja of wb.SheetNames) {
  const destino = parseHoja(hoja);
  if (!destino) {
    avisos.push(`Hoja ignorada (no se pudo derivar el nivel): ${hoja}`);
    continue;
  }
  grados.add(destino.gradeCode);
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null });
  for (const f of filas) {
    const rutCrudo = f['Rut'];
    if (!rutCrudo) continue;
    // El Excel trae el RUT sin guion ni puntos y con la K pegada al final.
    const bruto = String(rutCrudo).trim().toUpperCase();
    const rut = normalizeRut(`${bruto.slice(0, -1)}-${bruto.slice(-1)}`);
    if (!rut) { avisos.push(`RUT no normalizable en ${hoja}: ${bruto}`); continue; }
    const { firstName, lastName } = splitName(f['Apellidos y Nombres']);
    registros.push({
      rut, firstName, lastName,
      gender: mapGender(f['Sexo']),
      birthDate: fecha(f['Fecha de Nac.']),
      gradeCode: destino.gradeCode,
      section: destino.section,
      status: 'active',
      needsReview: false,
      marks: [],
    });
  }
}

if (grados.size !== 1) {
  // Un artefacto mezcla niveles sólo si el archivo los mezcla: es mejor detenerse que
  // dejar un roster ambiguo que el importador tome como la nómina completa de un nivel.
  throw new Error(`El archivo mezcla niveles (${[...grados].join(', ')}): procesa uno por vez`);
}
const gradeCode = [...grados][0];
const sufijo = gradeCode.toLowerCase().replace('_medio', '').replace(/^(\d)(st|nd|rd|th)$/, '$1');
const OUT = path.join(__dirname, 'out', `roster-${sufijo}-medio-${YEAR}.json`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ year: YEAR, records: registros }, null, 1));
const porSeccion = registros.reduce((a, r) => ({ ...a, [r.section]: (a[r.section] ?? 0) + 1 }), {});
console.log(`${registros.length} alumnos de ${gradeCode} →`, porSeccion);
if (avisos.length) console.log('avisos:', avisos);
console.log('artefacto:', path.relative(ROOT, OUT));
