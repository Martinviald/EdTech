/* Genera planillas de digitación DIA 2025 para 3°–6° básico, UNA por periodo
   (diagnóstico / intermedio / cierre). Cada archivo trae una hoja por curso y
   asignatura (Leng/Mate), con una columna por pregunta de ALTERNATIVA (MC),
   rotulada con el número real de pregunta (las abiertas se omiten).

   Roster: BDD (fuente de verdad). Nº de preguntas MC: pautas oficiales.
   Salida: docs/Listas de curso CSCJ/Digitación DIA 2025/DIA 2025 - <Periodo>.xlsx
*/
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..'); // repositorio/
const XLSX = require(path.join(ROOT, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'));
const postgres = require(path.join(ROOT, 'node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/cjs/src/index.js'));
require(path.join(ROOT, 'node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv')).config({
  path: path.join(ROOT, '.env'),
});

const SCHOOL = 'c5c10000-0000-0000-0000-000000000001';
const PROJECT = path.resolve(ROOT, '..'); // EdTech/
const PAUTAS_DIR = path.join(PROJECT, 'Histórico Pruebas DIA/Resultados/pautas');
const OUT_DIR = path.join(PROJECT, 'docs/Listas de curso CSCJ/Digitación DIA 2025');

const PERIODS = [
  { key: 'diagnostico', label: 'Diagnóstico' },
  { key: 'intermedio', label: 'Intermedio' },
  { key: 'cierre', label: 'Cierre' },
];
const SUBJECTS = [
  { folder: 'lenguaje', code: 'LANG', tab: 'Leng' },
  { folder: 'matematicas', code: 'MATH', tab: 'Mate' },
];
const GRADE_LABEL = { '3RD_BASIC': '3°', '4TH_BASIC': '4°', '5TH_BASIC': '5°', '6TH_BASIC': '6°' };
const GRADES = Object.keys(GRADE_LABEL);

// Index de preguntas MC: `${gradeCode}|${subjectCode}|${period}` -> [nums]
function buildMcIndex() {
  const idx = new Map();
  for (const s of SUBJECTS) {
    const dir = path.join(PAUTAS_DIR, s.folder);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pauta.json'))) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (j.source?.year !== 2025 || !j.keys) continue;
      const mc = Object.keys(j.keys)
        .filter((n) => j.keys[n] && j.keys[n].correctKey != null)
        .map(Number)
        .sort((a, b) => a - b);
      idx.set(`${j.source.gradeCode}|${j.source.subjectCode}|${j.source.applicationPeriod}`, mc);
    }
  }
  return idx;
}

async function main() {
  const mcIndex = buildMcIndex();

  const sql = postgres(process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL);
  const roster = await sql`
    select g.code grade, g."order" gord, cg.name section, s.rut, s.last_name, s.first_name
    from student_enrollments e
    join students s on s.id = e.student_id
    join class_groups cg on cg.id = e.class_group_id
    join grades g on g.id = cg.grade_id
    where s.org_id = ${SCHOOL} and e.status = 'active' and s.deleted_at is null
      and g.code = any(${GRADES})
    order by g."order", cg.name, s.last_name, s.first_name`;
  await sql.end();

  // Agrupar roster por curso (grade|section).
  const byCourse = new Map();
  for (const r of roster) {
    const key = `${r.grade}|${r.section}`;
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(r);
  }

  // Limpiar salidas previas (.xlsx) para no dejar archivos huérfanos de estructuras anteriores.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR).filter((x) => x.endsWith('.xlsx'))) {
    fs.unlinkSync(path.join(OUT_DIR, f));
  }
  const summary = [];

  // 6 archivos = asignatura × periodo. Cada archivo: 1 hoja por curso (3°A…6°B).
  for (const subj of SUBJECTS) {
    for (const period of PERIODS) {
      const wb = XLSX.utils.book_new();
      const subjName = subj.code === 'LANG' ? 'Lenguaje' : 'Matemáticas';

      const instr = [
        [`DIGITACIÓN DIA 2025 — ${subjName} — ${period.label} — CSCJ 3° a 6° básico`],
        [],
        ['• Una hoja por curso (3°A … 6°B). Asigna una hoja por corrector para trabajar en paralelo.'],
        ['• Cada columna es una PREGUNTA DE ALTERNATIVA, rotulada con su número real (P1, P2, …).'],
        ['  Las preguntas abiertas/desarrollo NO aparecen (se corrigen aparte).'],
        ['• Escribe una sola letra por celda: A B C D E. Deja la celda vacía si quedó en blanco.'],
        ['• NO edites N°, Apellidos y Nombres ni RUT (pre-llenados desde la nómina).'],
        [],
        ['Al terminar: descarga como .xlsx y pásalo para convertir e importar.'],
      ];
      const wsI = XLSX.utils.aoa_to_sheet(instr);
      wsI['!cols'] = [{ wch: 95 }];
      XLSX.utils.book_append_sheet(wb, wsI, 'Instrucciones');

      for (const grade of GRADES) {
        for (const section of ['A', 'B']) {
          const students = byCourse.get(`${grade}|${section}`);
          if (!students) continue;
          const mc = mcIndex.get(`${grade}|${subj.code}|${period.key}`);
          if (!mc || mc.length === 0) {
            summary.push(`! ${subjName} ${period.label} ${GRADE_LABEL[grade]}${section}: sin pauta MC — hoja omitida`);
            continue;
          }
          const header = ['N°', 'Apellidos y Nombres', 'RUT', ...mc.map((n) => `P${n}`)];
          const aoa = [header];
          students.forEach((s, i) => {
            aoa.push([i + 1, `${s.last_name} ${s.first_name}`.trim(), s.rut, ...mc.map(() => '')]);
          });
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          ws['!cols'] = [{ wch: 5 }, { wch: 40 }, { wch: 13 }, ...mc.map(() => ({ wch: 5 }))];
          const tab = `${GRADE_LABEL[grade]}${section}`; // ej "3°A"
          XLSX.utils.book_append_sheet(wb, ws, tab);
          summary.push(`  ${subjName} ${period.label} ${tab}: ${students.length} alumnos × ${mc.length} preguntas (P${mc[0]}–P${mc[mc.length - 1]})`);
        }
      }

      const outFile = path.join(OUT_DIR, `DIA 2025 - ${subjName} - ${period.label}.xlsx`);
      XLSX.writeFile(wb, outFile);
      summary.push(`>> archivo: ${path.basename(outFile)}\n`);
    }
  }

  console.log('=== PLANILLAS DIA 2025 GENERADAS (6 archivos = asignatura × periodo) ===');
  console.log('Salida:', OUT_DIR, '\n');
  console.log(summary.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
