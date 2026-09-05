/**
 * Extrae la nómina actualizada de IV° medio 2026 (un archivo con hojas IVA/IVB/IVC)
 * al mismo artefacto que consume el importador de roster.
 *
 * Reusa `splitName` y `normalizeRut` del extractor 2025 (`01-extract-roster.cjs`):
 * la convención chilena de dos apellidos y la corrección de RUT ya están resueltas ahí.
 *
 *   node scripts/cscj/02-extract-roster-iv-2026.cjs "<ruta del xlsx>"
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));
const { normalizeRut } = require(path.join(ROOT, 'packages/types/dist/utils/rut.js'));

const FILE = process.argv[2];
if (!FILE) throw new Error('Falta la ruta del xlsx');
const OUT = path.join(__dirname, 'out', 'roster-iv-2026.json');

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
for (const hoja of wb.SheetNames) {
  const seccion = hoja.replace(/^IV/i, '').trim().toUpperCase(); // "IVA" -> "A"
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
      gradeCode: '4TH_MEDIO',
      section: seccion,
      status: 'active',
      needsReview: false,
      marks: [],
    });
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ year: 2026, records: registros }, null, 1));
const porSeccion = registros.reduce((a, r) => ({ ...a, [r.section]: (a[r.section] ?? 0) + 1 }), {});
console.log(`${registros.length} alumnos →`, porSeccion);
if (avisos.length) console.log('avisos:', avisos);
console.log('artefacto:', path.relative(ROOT, OUT));
