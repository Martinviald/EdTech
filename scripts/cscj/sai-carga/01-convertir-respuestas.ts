/**
 * Conversor: planillas del SAI identificado
 * (`Histórico Pruebas DIA/respuestas/sai-identificado/<año>/`)
 * -> el artefacto JSON que consume `packages/db/src/seed/import-dia-2026-responses.ts`.
 *
 * Las planillas son la salida de `scripts/cscj/sai-match/04-emitir.ts`: el export
 * SAI de la Agencia ya cruzado con el informe nominado. Hoja única, encabezado
 * `N Lista | Nombre | RUT | metodo | distancia | alu_id | P1..Pn`. El nivel, la
 * asignatura y el momento salen de la ruta; la sección, del nombre del archivo.
 *
 * Emite UN artefacto POR MOMENTO, no uno global: el importador borra por
 * `config.loadKey` antes de insertar, así que un `loadKey` por lote acota el
 * borrado a lo que ese lote vuelve a escribir. Acotar con `--only` sobre un
 * artefacto global NO acota el borrado.
 *
 * Ver `docs/plan-carga-sai-2025.md` para por qué se excluye cada combinación.
 *
 *   pnpm --filter @soe/db exec tsx scripts/cscj/sai-carga/01-convertir-respuestas.ts --anio=2025
 */
import { createRequire } from 'module';
import { mkdirSync, readdirSync, writeFileSync } from 'fs';
import { basename, join, relative, resolve, sep } from 'path';

const REPO = resolve(__dirname, '../../..');
const require_ = createRequire(__filename);
const XLSX = require_(
  join(REPO, 'node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js'),
) as typeof import('xlsx');

const argv = process.argv.slice(2);
const anioArg = argv.find((a) => a.startsWith('--anio='));
const YEAR = parseInt(anioArg ? anioArg.slice('--anio='.length) : '2025', 10);
if (!Number.isInteger(YEAR)) throw new Error(`--anio inválido: "${anioArg}"`);

const ENTRADA = resolve(REPO, `../Histórico Pruebas DIA/respuestas/sai-identificado/${YEAR}`);
const SALIDA = join(__dirname, 'out');

const GRADE_POR_CARPETA: Record<string, string> = {
  '1ro_basico': '1RD_BASIC',
  '2do_basico': '2ND_BASIC',
  '3ro_basico': '3RD_BASIC',
  '4to_basico': '4TH_BASIC',
  '5to_basico': '5TH_BASIC',
  '6to_basico': '6TH_BASIC',
  '7mo_basico': '7TH_BASIC',
  '8vo_basico': '8TH_BASIC',
  i_medio: '1ST_MEDIO',
  ii_medio: '2ND_MEDIO',
};

const SUBJECT_POR_CARPETA: Record<string, string> = {
  lectura: 'Lenguaje y Comunicación',
  matematica: 'Matemáticas',
  ciencias_naturales: 'Ciencias Naturales',
  historia_geografia_y_ciencias_sociales: 'Historia, Geografía y Cs. Sociales',
};

const PERIODO_POR_CARPETA: Record<string, string> = {
  diagnostico: 'diagnostico',
  monitoreo_intermedio: 'intermedio',
  evaluacion_de_cierre: 'cierre',
};

/**
 * Combinaciones que NO se cargan, con el motivo. Es una tabla por año y no una
 * regla porque cada exclusión tiene una causa distinta que hay que poder
 * auditar. 2026 no tiene ninguna.
 *
 * Todas las exclusiones de 2025 son ahora «ya cargada»: los 23 instrumentos que
 * faltaban en el catálogo se extrajeron de sus cuadernillos y se cargaron, así
 * que ya no hay combinación sin instrumento.
 */
const EXCLUIDAS_2025: Record<string, string> = {
  'diagnostico|3RD_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-diagnostico)',
  'diagnostico|3RD_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-diagnostico)',
  'diagnostico|4TH_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-diagnostico)',
  'diagnostico|4TH_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-diagnostico)',
  'diagnostico|5TH_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-diagnostico)',
  'diagnostico|6TH_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-diagnostico)',
  'intermedio|3RD_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-intermedio)',
  'intermedio|4TH_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-intermedio)',
  'intermedio|5TH_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-intermedio)',
  'cierre|3RD_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|3RD_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|4TH_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|4TH_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|5TH_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|5TH_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|6TH_BASIC|Lenguaje y Comunicación': 'ya cargada (loadKey sai-2025-cierre)',
  'cierre|6TH_BASIC|Matemáticas': 'ya cargada (loadKey sai-2025-cierre)',
  'intermedio|3RD_BASIC|Lenguaje y Comunicación':
    'ya cargada (loadKey dia-lenguaje-intermedio-2025)',
  'intermedio|4TH_BASIC|Lenguaje y Comunicación':
    'ya cargada (loadKey dia-lenguaje-intermedio-2025)',
  'intermedio|5TH_BASIC|Lenguaje y Comunicación':
    'ya cargada (loadKey dia-lenguaje-intermedio-2025)',
  'intermedio|6TH_BASIC|Lenguaje y Comunicación':
    'ya cargada (loadKey dia-lenguaje-intermedio-2025)',
};

const EXCLUIDAS_POR_ANIO: Record<number, Record<string, string>> = { 2025: EXCLUIDAS_2025 };
const EXCLUIDAS = EXCLUIDAS_POR_ANIO[YEAR] ?? {};

type Curso = {
  /**
   * Filas que el cruce SAI↔informe no pudo resolver (`metodo = 'ambiguo'`). Se
   * excluyen: atribuirle las respuestas de un alumno a otro es peor que no
   * cargarlas. Viajan en el artefacto para que queden a la vista.
   */
  ambiguas: string[];
  sourceFile: string;
  gradeCode: string;
  section: string;
  subjectName: string;
  year: number;
  applicationPeriod: string;
  questionCount: number;
  itemTypes: Record<string, string | null>;
  rows: Array<{
    rut: string;
    nombre: string;
    metodo: string;
    answers: Record<string, string | null>;
  }>;
};

function archivosXlsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...archivosXlsx(full));
    else if (entry.name.endsWith('.xlsx') && !entry.name.startsWith('~$')) out.push(full);
  }
  return out;
}

function seccionDesdeNombre(stem: string, carpetaAsignatura: string): string | null {
  const cola = stem.split(`${carpetaAsignatura}_`)[1];
  if (!cola) return null;
  const m = /^(?:\d+|i{1,2})_([a-z])(?:_|$)/.exec(cola);
  return m?.[1]?.toUpperCase() ?? null;
}

function normalizarRut(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim().toUpperCase().replace(/[.\s]/g, '');
}

function leerCurso(file: string): Curso | { omitido: string } {
  const partes = relative(ENTRADA, file).split(sep);
  const [carpetaMomento, carpetaNivel, carpetaAsignatura] = partes;
  if (!carpetaMomento || !carpetaNivel || !carpetaAsignatura) {
    return { omitido: 'ruta inesperada' };
  }
  const applicationPeriod = PERIODO_POR_CARPETA[carpetaMomento];
  const gradeCode = GRADE_POR_CARPETA[carpetaNivel];
  const subjectName = SUBJECT_POR_CARPETA[carpetaAsignatura];
  if (!applicationPeriod || !gradeCode || !subjectName) {
    return { omitido: `no se pudo derivar momento/nivel/asignatura de ${partes.join('/')}` };
  }
  const section = seccionDesdeNombre(basename(file, '.xlsx'), carpetaAsignatura);
  if (!section) return { omitido: `no se pudo derivar la sección de ${basename(file)}` };

  const workbook = XLSX.readFile(file);
  const hoja = workbook.SheetNames[0];
  if (!hoja) return { omitido: 'sin hojas' };
  const filas = XLSX.utils.sheet_to_json<Array<string | null>>(workbook.Sheets[hoja]!, {
    header: 1,
    raw: false,
    defval: null,
  });
  const encabezado = (filas[0] ?? []).map((c) => (c === null ? '' : String(c).trim()));
  const columnasPregunta: Array<{ index: number; position: number }> = [];
  encabezado.forEach((label, index) => {
    const m = /^P(\d+)$/i.exec(label);
    if (m?.[1]) columnasPregunta.push({ index, position: Number(m[1]) });
  });
  const iRut = encabezado.findIndex((h) => h.toUpperCase() === 'RUT');
  const iNombre = encabezado.findIndex((h) => h.toUpperCase() === 'NOMBRE');
  const iMetodo = encabezado.findIndex((h) => h.toLowerCase() === 'metodo');
  if (iNombre < 0 || !columnasPregunta.length) return { omitido: 'encabezado inesperado' };

  const rows: Curso['rows'] = [];
  const ambiguas: string[] = [];
  for (const cruda of filas.slice(1)) {
    if (!cruda?.[iNombre]) continue;
    const metodo = iMetodo >= 0 ? String(cruda[iMetodo] ?? '').trim() : '';
    if (metodo === 'ambiguo') {
      ambiguas.push(String(cruda[iNombre]).trim().replace(/\s+/g, ' '));
      continue;
    }
    const answers: Record<string, string | null> = {};
    for (const { index, position } of columnasPregunta) {
      const celda = cruda[index];
      const valor = celda === null || celda === undefined ? '' : String(celda).trim();
      answers[String(position)] = valor === '' || valor === '-' ? null : valor;
    }
    rows.push({
      rut: iRut >= 0 ? normalizarRut(cruda[iRut]) : '',
      nombre: String(cruda[iNombre]).trim().replace(/\s+/g, ' '),
      metodo,
      answers,
    });
  }

  return {
    ambiguas,
    sourceFile: basename(file),
    gradeCode,
    section,
    subjectName,
    year: YEAR,
    applicationPeriod,
    questionCount: columnasPregunta.length,
    itemTypes: {},
    rows,
  };
}

function main(): void {
  const archivos = archivosXlsx(ENTRADA).sort();
  const porMomento = new Map<string, Curso[]>();
  const omitidos: string[] = [];
  const excluidos = new Map<string, { cursos: number; filas: number; motivo: string }>();
  const metodosDudosos: string[] = [];

  for (const file of archivos) {
    const leido = leerCurso(file);
    if ('omitido' in leido) {
      omitidos.push(`${basename(file)}: ${leido.omitido}`);
      continue;
    }
    const combo = `${leido.applicationPeriod}|${leido.gradeCode}|${leido.subjectName}`;
    const motivo = EXCLUIDAS[combo];
    if (motivo) {
      const e = excluidos.get(combo) ?? { cursos: 0, filas: 0, motivo };
      e.cursos += 1;
      e.filas += leido.rows.length;
      excluidos.set(combo, e);
      continue;
    }
    const dudosas = leido.rows.filter((r) => r.metodo && r.metodo !== 'vector').length;
    if (dudosas)
      metodosDudosos.push(`${leido.sourceFile}: ${dudosas} fila(s) con metodo=vector-aprox`);
    for (const a of leido.ambiguas) {
      metodosDudosos.push(`${leido.sourceFile}: EXCLUIDA por cruce ambiguo — ${a}`);
    }
    const lista = porMomento.get(leido.applicationPeriod) ?? [];
    lista.push(leido);
    porMomento.set(leido.applicationPeriod, lista);
  }

  mkdirSync(SALIDA, { recursive: true });
  console.log(`\n== Conversión SAI ${YEAR} ==`);
  console.log(`  archivos leídos: ${archivos.length}`);

  for (const [momento, cursos] of [...porMomento.entries()].sort()) {
    cursos.sort((a, b) =>
      `${a.gradeCode}${a.subjectName}${a.section}`.localeCompare(
        `${b.gradeCode}${b.subjectName}${b.section}`,
      ),
    );
    const destino = join(SALIDA, `sai-${YEAR}-${momento}.json`);
    writeFileSync(destino, JSON.stringify({ year: YEAR, courses: cursos }, null, 2), 'utf8');
    const filas = cursos.reduce((n, c) => n + c.rows.length, 0);
    console.log(
      `  ${momento}: ${cursos.length} cursos · ${filas} filas → ${relative(REPO, destino)}`,
    );
    for (const c of cursos) {
      console.log(
        `      ${c.gradeCode} ${c.section} · ${c.subjectName} · ${c.rows.length} filas · ${c.questionCount} preguntas`,
      );
    }
  }

  console.log(`\n  excluidas (${excluidos.size} combinaciones):`);
  for (const [combo, e] of [...excluidos.entries()].sort()) {
    console.log(`      ${combo} — ${e.cursos} cursos, ${e.filas} filas — ${e.motivo}`);
  }
  for (const m of metodosDudosos) console.warn(`  ⚠ ${m}`);
  for (const o of omitidos) console.warn(`  ⚠ omitido ${o}`);
}

main();
