/* Conversor: planilla de digitación (.xlsx llena) -> un CSV por curso listo para
   el importador de respuestas de la plataforma (formato genérico: rut,p1,p2,...).

   Valida integridad ANTES de emitir:
     - caracteres permitidos: A B C D E . X  (mayúsculas; "." omitida, "X" anulada)
     - largo uniforme dentro del curso (atrapa el "drift" de una letra de más/menos)
     - alumnos sin respuestas => se reportan como ausentes (no se emiten)

   Uso:
     node 02-convertir-respuestas.cjs [archivo.xlsx] [--preguntas=N]
   Si se omite el archivo, usa la planilla generada por defecto.
   --preguntas=N fuerza el largo esperado en todos los cursos; si se omite, se
   infiere por curso como el largo más frecuente y se marca cualquier desviación.
*/
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));

const DEFAULT_IN = path.resolve(
  ROOT,
  '../docs/Listas de curso CSCJ/Digitación/Digitacion_Respuestas_3-6_basico.xlsx',
);

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith('--'));
const preguntasArg = args.find((a) => a.startsWith('--preguntas='));
const forcedN = preguntasArg ? Number(preguntasArg.split('=')[1]) : null;

const IN_FILE = fileArg ? path.resolve(fileArg) : DEFAULT_IN;
const OUT_DIR = path.join(path.dirname(IN_FILE), 'csv');

const ALLOWED = /^[ABCDEabcde.xX]+$/;

function mode(nums) {
  const c = new Map();
  for (const n of nums) c.set(n, (c.get(n) || 0) + 1);
  let best = null, bestCount = -1;
  for (const [n, k] of c) if (k > bestCount || (k === bestCount && n > best)) { best = n; bestCount = k; }
  return best;
}

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error('No existe el archivo:', IN_FILE);
    process.exit(1);
  }
  const wb = XLSX.readFile(IN_FILE);
  const courseTabs = wb.SheetNames.filter((n) => n !== 'Instrucciones');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const report = [];
  let emittedCourses = 0;

  for (const tab of courseTabs) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { defval: '' });
    const present = [];   // {rut, resp}
    const absent = [];    // rut o nombre
    const errors = [];    // {rut, resp, motivo}

    for (const r of rows) {
      const rut = String(r['RUT'] ?? '').trim();
      const respRaw = String(r['Respuestas'] ?? '').trim();
      const who = rut || String(r['Apellidos y Nombres'] ?? '').trim() || '(sin id)';
      if (!rut) continue; // fila no-alumno
      if (respRaw === '') { absent.push(who); continue; }
      if (!ALLOWED.test(respRaw)) {
        const bad = [...respRaw].filter((ch) => !/[ABCDEabcde.xX]/.test(ch));
        errors.push({ who, resp: respRaw, motivo: `caracteres inválidos: ${[...new Set(bad)].join(' ')}` });
        continue;
      }
      present.push({ rut, resp: respRaw.toUpperCase() });
    }

    if (present.length === 0) {
      report.push(`• ${tab}: sin respuestas digitadas (ausentes: ${absent.length}) — no se genera CSV`);
      continue;
    }

    const lengths = present.map((p) => p.resp.length);
    const expectedN = forcedN ?? mode(lengths);
    const lengthErrors = present.filter((p) => p.resp.length !== expectedN);

    if (lengthErrors.length > 0) {
      report.push(
        `✗ ${tab}: largo inconsistente (esperado ${expectedN}). NO se genera CSV hasta corregir:`,
      );
      lengthErrors.forEach((p) =>
        report.push(`     - ${p.rut}: largo ${p.resp.length} ("${p.resp}")`),
      );
      errors.forEach((e) => report.push(`     - ${e.who}: ${e.motivo} ("${e.resp}")`));
      continue;
    }
    if (errors.length > 0) {
      report.push(`✗ ${tab}: caracteres inválidos. NO se genera CSV hasta corregir:`);
      errors.forEach((e) => report.push(`     - ${e.who}: ${e.motivo} ("${e.resp}")`));
      continue;
    }

    // Emitir CSV: rut,p1..pN  ("." y "X" -> celda vacía = sin respuesta)
    const header = ['rut', ...Array.from({ length: expectedN }, (_, i) => `p${i + 1}`)];
    const lines = [header.join(',')];
    for (const p of present) {
      const cells = [p.rut];
      for (let i = 0; i < expectedN; i++) {
        const ch = p.resp[i];
        cells.push(ch === '.' || ch === 'X' ? '' : ch);
      }
      lines.push(cells.join(','));
    }
    const safeName = tab.replace(/[°/\\]/g, '').replace(/\s+/g, '_');
    const outCsv = path.join(OUT_DIR, `${safeName}.csv`);
    fs.writeFileSync(outCsv, lines.join('\n') + '\n');
    emittedCourses++;
    report.push(
      `✓ ${tab}: ${present.length} alumnos, ${expectedN} preguntas, ausentes ${absent.length} -> ${path.basename(outCsv)}`,
    );
  }

  console.log('=== CONVERSIÓN DE RESPUESTAS ===');
  console.log('Entrada:', IN_FILE);
  console.log('Salida CSVs:', OUT_DIR);
  console.log('Cursos con CSV generado:', emittedCourses, '/', courseTabs.length, '\n');
  console.log(report.join('\n'));
  console.log('\nAl subir cada CSV usa formato "CSV Genérico" con mapping { rut: "rut", questionsPrefix: "p" }.');
}

main();
