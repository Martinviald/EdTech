/* Genera la planilla de DIGITACIÓN de respuestas para 3°–6° básico de CSCJ.
   Una pestaña por curso, pre-llenada desde la BDD (fuente de verdad → el RUT
   calza exacto al importar). El corrector SOLO escribe la columna "Respuestas".

   Salida: docs/Listas de curso CSCJ/Digitación/Digitacion_Respuestas_3-6_basico.xlsx
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
const GRADES = ['3RD_BASIC', '4TH_BASIC', '5TH_BASIC', '6TH_BASIC'];
const GRADE_LABEL = { '3RD_BASIC': '3°', '4TH_BASIC': '4°', '5TH_BASIC': '5°', '6TH_BASIC': '6°' };

const OUT_DIR = path.resolve(ROOT, '../docs/Listas de curso CSCJ/Digitación');

async function main() {
  const sql = postgres(process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL);
  const rows = await sql`
    select g.code grade, g."order" gord, cg.name section,
           s.rut, s.last_name, s.first_name
    from student_enrollments e
    join students s on s.id = e.student_id
    join class_groups cg on cg.id = e.class_group_id
    join grades g on g.id = cg.grade_id
    where s.org_id = ${SCHOOL} and e.status = 'active' and s.deleted_at is null
      and g.code = any(${GRADES})
    order by g."order", cg.name, s.last_name, s.first_name`;
  await sql.end();

  // Agrupar por curso.
  const byCourse = new Map();
  for (const r of rows) {
    const key = `${GRADE_LABEL[r.grade]}${r.section}`; // ej "3°A"
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(r);
  }

  const wb = XLSX.utils.book_new();

  // ---- Pestaña de instrucciones ----
  const instr = [
    ['DIGITACIÓN DE RESPUESTAS — CSCJ 3° a 6° básico'],
    [],
    ['Cómo usar esta planilla:'],
    ['1) Cada pestaña es un curso. Asigna UN curso por corrector (para trabajar en paralelo sin pisarse).'],
    ['2) Ordena las pruebas físicas por orden de lista (alfabético) y avanza fila por fila.'],
    ['3) Escribe SOLO en la columna "Respuestas": una letra por pregunta, en orden, sin espacios.'],
    ['     Ejemplo (30 preguntas):  ABCDABCDABBADCABCDABCDABCDABCD'],
    ['4) Convenciones de marca:'],
    ['     A B C D E  = alternativa elegida'],
    ['     .          = pregunta en blanco / omitida (NO la saltes: pon el punto para no correr las posiciones)'],
    ['     X          = doble marca / anulada'],
    ['5) Mira la columna "Largo": debe ser igual al N° de preguntas de la prueba en TODAS las filas.'],
    ['     Si un alumno está ausente, deja "Respuestas" vacío.'],
    ['6) NO edites las columnas N°, Apellidos y Nombres ni RUT (vienen pre-llenadas).'],
    [],
    ['Cuando terminen: descarga este archivo como .xlsx y pásalo para convertir e importar.'],
    ['(El conversor valida largo y caracteres y genera el CSV listo para la plataforma.)'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instr);
  wsInstr['!cols'] = [{ wch: 95 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  // ---- Una pestaña por curso ----
  const HEADER = ['N°', 'Apellidos y Nombres', 'RUT', 'Respuestas', 'Largo'];
  for (const [course, students] of byCourse) {
    const aoa = [HEADER];
    students.forEach((s, i) => {
      aoa.push([i + 1, `${s.last_name} ${s.first_name}`.trim(), s.rut, '', '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 5 }, { wch: 42 }, { wch: 13 }, { wch: 40 }, { wch: 7 }];
    // Columna "Largo" = LEN(Respuestas) por fila (feedback en vivo al digitar).
    for (let r = 0; r < students.length; r++) {
      const rowIdx = r + 2; // 1-based, +1 por header
      ws[`E${rowIdx}`] = { t: 'n', f: `IF(D${rowIdx}="",0,LEN(D${rowIdx}))` };
    }
    XLSX.utils.book_append_sheet(wb, ws, course); // nombre de tab = "3°A", etc.
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'Digitacion_Respuestas_3-6_basico.xlsx');
  XLSX.writeFile(wb, outFile);

  console.log('Planilla generada:', outFile);
  console.log('Pestañas:', ['Instrucciones', ...byCourse.keys()].join(', '));
  for (const [c, s] of byCourse) console.log(`  ${c}: ${s.length} alumnos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
