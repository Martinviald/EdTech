/**
 * Deduce la clave de los ítems de respuesta corta de 2025 y la emite en el
 * formato de extracción que consume `packages/db/src/scripts/load-fill-answers.ts`.
 *
 * Los instrumentos 2025 se cargaron sin clave para estos ítems (0 de 86 la
 * tienen), así que quedan como `open_ended` y el motor los manda a corrección
 * humana aunque el SAI traiga la respuesta escrita del alumno.
 *
 * No se adivina. La clave se busca contra una fuente independiente: el
 * `correct_count` por ítem y por curso que dejó el informe oficial de la Agencia
 * (respaldado por `03-respaldar-agregados.ts` antes de reemplazarlo). Una clave
 * es válida sólo si, aplicada a las respuestas del SAI, reproduce EXACTO el
 * conteo de correctas de LOS DOS cursos del nivel. Con ~40 alumnos por curso y
 * dos observaciones independientes, una clave equivocada no sobrevive.
 *
 * La comparación la hace `matchesAcceptedAnswer`, la misma que usará la app al
 * corregir: si acá una clave reproduce el conteo, allá puntúa igual.
 *
 * Si sobrevive más de un candidato se declara ambigua y no se emite: es
 * preferible dejar el ítem pendiente a fijar una clave que no se puede
 * distinguir de otra.
 *
 *   pnpm --filter @soe/db exec tsx scripts/cscj/sai-2025/05-deducir-claves-respuesta-corta.ts
 */
import postgres from 'postgres';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { inferComparisonMode, matchesAcceptedAnswer } from '@soe/types';

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const SALIDA = join(__dirname, 'out/claves-deducidas');
const RESPALDO = join(__dirname, 'out/respaldo-agregados-2025.json');
const MOMENTOS = ['diagnostico', 'intermedio', 'cierre'];

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const sql = postgres(url, { max: 1, connect_timeout: 20, ssl: { rejectUnauthorized: false } });

type Curso = {
  gradeCode: string;
  section: string;
  subjectName: string;
  applicationPeriod: string;
  rows: Array<{ answers: Record<string, string | null> }>;
};

type Respaldo = {
  respaldo: Array<{
    assessment: {
      grade_code: string;
      subject_name: string;
      application_period: string;
      seccion: string;
    };
    itemStats: Array<{ item_id: string; correct_count: number }>;
  }>;
};

function cuentaAciertos(respuestas: Array<string | null>, clave: string): number {
  const comparison = inferComparisonMode([clave]);
  let n = 0;
  for (const r of respuestas) {
    if (r === null) continue;
    if (matchesAcceptedAnswer(r, [clave], { comparison }) === 'match') n += 1;
  }
  return n;
}

/**
 * `"8,9"` y `"8,90"` no son dos claves: son la misma cantidad escrita distinto, y
 * el comparador las puntúa igual. Sin colapsarlas, un ítem perfectamente resuelto
 * se declararía ambiguo. Se conserva la escritura más corta como representante.
 */
function colapsarEquivalentes(claves: string[]): string[] {
  const clases: string[] = [];
  for (const c of [...claves].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const yaEsta = clases.some(
      (rep) =>
        matchesAcceptedAnswer(c, [rep], { comparison: inferComparisonMode([rep]) }) === 'match',
    );
    if (!yaEsta) clases.push(c);
  }
  return clases;
}

async function main(): Promise<void> {
  await sql`select set_config('app.current_org_id', ${ORG_ID}, false)`;

  const cursos: Curso[] = MOMENTOS.flatMap(
    (m) =>
      (
        JSON.parse(readFileSync(join(__dirname, `out/sai-2025-${m}.json`), 'utf8')) as {
          courses: Curso[];
        }
      ).courses,
  );
  const respuestasPorCurso = new Map<string, Curso>();
  for (const c of cursos) {
    respuestasPorCurso.set(
      `${c.applicationPeriod}|${c.gradeCode}|${c.subjectName}|${c.section}`,
      c,
    );
  }

  const { respaldo } = JSON.parse(readFileSync(RESPALDO, 'utf8')) as Respaldo;
  const refPorItemCurso = new Map<string, number>();
  for (const r of respaldo) {
    const a = r.assessment;
    for (const s of r.itemStats) {
      refPorItemCurso.set(
        `${a.application_period}|${a.grade_code}|${a.subject_name}|${a.seccion}|${s.item_id}`,
        Number(s.correct_count),
      );
    }
  }

  const items = await sql`
    select it.id, it.position, i.name as instrument_name, g.code as grade_code,
           s.name as subject_name, i.application_period as period,
           (it.scoring_config->>'responseFormat') as fmt
    from items it
    join instruments i on i.id = it.instrument_id
    join grades g on g.id = i.grade_id
    join subjects s on s.id = i.subject_id
    where i.org_id is null and i.deleted_at is null and i.year = 2025
      and it.type = 'open_ended'
      and (it.scoring_config->>'responseFormat') in ('fill_in','completacion','multiple_response')
    order by g."order", s.name, i.application_period, it.position`;

  const porInstrumento = new Map<string, Array<{ position: number; fillAnswer: string }>>();
  let deducidas = 0;
  let ambiguas = 0;
  let sinCandidato = 0;
  let sinReferencia = 0;

  for (const item of items) {
    const base = `${item.period}|${item.grade_code}|${item.subject_name}`;
    const secciones = ['A', 'B'];
    const observaciones: Array<{ respuestas: Array<string | null>; correctas: number }> = [];
    for (const sec of secciones) {
      const curso = respuestasPorCurso.get(`${base}|${sec}`);
      const ref = refPorItemCurso.get(`${base}|${sec}|${item.id}`);
      if (!curso || ref === undefined) continue;
      observaciones.push({
        respuestas: curso.rows.map((r) => r.answers[String(item.position)] ?? null),
        correctas: ref,
      });
    }
    const etiqueta = `${item.period} ${item.grade_code} ${String(item.subject_name).slice(0, 12)} P${item.position} (${item.fmt})`;
    if (observaciones.length < 2) {
      sinReferencia += 1;
      console.log(`  ~ ${etiqueta}: sólo ${observaciones.length} observación(es), no se deduce`);
      continue;
    }

    const candidatos = [
      ...new Set(observaciones.flatMap((o) => o.respuestas.filter((r): r is string => r !== null))),
    ];
    const sobreviven = colapsarEquivalentes(
      candidatos.filter((c) =>
        observaciones.every((o) => cuentaAciertos(o.respuestas, c) === o.correctas),
      ),
    );

    if (sobreviven.length === 1) {
      deducidas += 1;
      const clave = sobreviven[0] as string;
      const lista = porInstrumento.get(item.instrument_name as string) ?? [];
      lista.push({ position: Number(item.position), fillAnswer: clave });
      porInstrumento.set(item.instrument_name as string, lista);
      console.log(
        `  ✓ ${etiqueta}: "${clave}"  (correctas ${observaciones.map((o) => o.correctas).join(' / ')})`,
      );
    } else if (sobreviven.length > 1) {
      ambiguas += 1;
      console.log(`  ? ${etiqueta}: AMBIGUA entre [${sobreviven.join(' | ')}]`);
    } else {
      sinCandidato += 1;
      console.log(
        `  ✗ ${etiqueta}: ningún valor reproduce ${observaciones.map((o) => o.correctas).join(' / ')} correctas`,
      );
    }
  }

  mkdirSync(SALIDA, { recursive: true });
  for (const [nombre, lista] of porInstrumento) {
    const archivo = join(SALIDA, `${nombre.replace(/[^\w]+/g, '-')}.json`);
    writeFileSync(
      archivo,
      JSON.stringify(
        {
          instrument: { name: nombre },
          sections: [{ items: lista.sort((a, b) => a.position - b.position) }],
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  console.log(
    `\n  ítems evaluados: ${items.length} · deducidas: ${deducidas} · ambiguas: ${ambiguas} · sin candidato: ${sinCandidato} · sin referencia: ${sinReferencia}`,
  );
  console.log(`  ${porInstrumento.size} archivos → ${SALIDA}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
