/**
 * Valida el artefacto del conversor contra el informe oficial YA cargado, antes
 * de escribir nada.
 *
 * Son dos fuentes independientes de la misma prueba: las respuestas del SAI
 * (alumno por alumno) y el read-model `imported` que dejó el informe PDF de la
 * Agencia (`assessment_item_stats.correct_count` por ítem y por curso). Si al
 * corregir el SAI con la clave del instrumento se reproduce el conteo del
 * informe, entonces la alineación de posiciones, la clave del ítem y el cruce
 * alumno↔RUT están bien los tres a la vez. Un desalineamiento de una posición
 * rompe el conteo de inmediato.
 *
 * La corrección la hace `getScoringStrategy`, la misma de la app y la del
 * importador — este script no reimplementa nada.
 *
 * Los ítems que el informe no sabe corregir (`correct_count = 0` con todas las
 * alternativas marcadas incorrectas) se reportan aparte: ahí el informe no es
 * una referencia, no es que el SAI esté mal.
 *
 *   DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx \
 *     scripts/cscj/sai-2025/02-validar-contra-informe.ts --input=<artefacto.json>
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getScoringStrategy,
  parsePositionalMatchingAnswer,
  type ItemContent,
  type MatchingSide,
  type ScoringConfig,
} from '@soe/types';

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const INPUT = resolve(opt('input', ''));
const YEAR = parseInt(opt('anio', '2025'), 10);
if (!INPUT) throw new Error('Falta --input=<artefacto.json>');

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const sql = postgres(url, { max: 1, connect_timeout: 20, ssl: { rejectUnauthorized: false } });

type Curso = {
  sourceFile: string;
  gradeCode: string;
  section: string;
  subjectName: string;
  applicationPeriod: string;
  rows: Array<{ rut: string; answers: Record<string, string | null> }>;
};

type ItemRow = {
  id: string;
  position: number;
  type: string;
  content: unknown;
  scoring_config: unknown;
};

function matchingSides(content: unknown, lado: 'leftItems' | 'rightItems'): MatchingSide[] {
  const raw = (content as Record<string, unknown> | null)?.[lado];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const { id } = e as { id?: unknown };
    return typeof id === 'string' ? [{ id }] : [];
  });
}

function corregir(item: ItemRow, respuesta: string | null): boolean | null {
  const sc = (item.scoring_config ?? {}) as Record<string, unknown>;
  const raw =
    respuesta !== null && item.type === 'matching'
      ? parsePositionalMatchingAnswer(
          respuesta,
          matchingSides(item.content, 'leftItems'),
          matchingSides(item.content, 'rightItems'),
        )
      : respuesta;
  return getScoringStrategy(item.type as never).score({
    item: {
      id: item.id,
      type: item.type as never,
      content: item.content as ItemContent,
      maxScore: Number(sc.points ?? 1),
      scoringConfig: sc as ScoringConfig,
    },
    rawAnswer: raw,
  }).isCorrect;
}

async function main(): Promise<void> {
  await sql`select set_config('app.current_org_id', ${ORG_ID}, false)`;
  const artefacto = JSON.parse(readFileSync(INPUT, 'utf8')) as { courses: Curso[] };

  let calzan = 0;
  let difieren = 0;
  let sinReferencia = 0;
  let noAutocorregibles = 0;
  const detalle: string[] = [];

  for (const curso of artefacto.courses) {
    const items = (await sql`
      select it.id, it.position, it.type, it.content, it.scoring_config
      from items it
      join instruments i on i.id = it.instrument_id
      join grades g on g.id = i.grade_id
      join subjects s on s.id = i.subject_id
      where i.org_id is null and i.deleted_at is null and i.year = ${YEAR}
        and i.application_period = ${curso.applicationPeriod}
        and g.code = ${curso.gradeCode} and s.name = ${curso.subjectName}
      order by it.position`) as unknown as ItemRow[];

    const stats = await sql`
      select s.item_id, s.correct_count, s.response_count, s.answer_counts
      from assessment_item_stats s
      join assessments a on a.id = s.assessment_id
      join instruments i on i.id = a.instrument_id
      join grades g on g.id = i.grade_id
      join subjects sub on sub.id = i.subject_id
      join class_groups cg on cg.id = s.class_group_id
      where a.org_id = ${ORG_ID} and s.source = 'imported' and i.year = ${YEAR}
        and i.application_period = ${curso.applicationPeriod}
        and g.code = ${curso.gradeCode} and sub.name = ${curso.subjectName}
        and cg.name = ${curso.section}`;
    const porItem = new Map(stats.map((s) => [s.item_id as string, s]));

    for (const item of items) {
      const ref = porItem.get(item.id);
      let correctos = 0;
      let autocorregibles = 0;
      for (const row of curso.rows) {
        const respuesta = row.answers[String(item.position)] ?? null;
        const ok = corregir(item, respuesta);
        if (ok === null) continue;
        autocorregibles += 1;
        if (ok) correctos += 1;
      }
      if (autocorregibles === 0) {
        noAutocorregibles += 1;
        continue;
      }
      if (!ref) {
        sinReferencia += 1;
        continue;
      }
      const counts = (ref.answer_counts ?? []) as Array<{ isCorrect?: boolean }>;
      if (Number(ref.correct_count) === 0 && !counts.some((c) => c.isCorrect)) {
        sinReferencia += 1;
        detalle.push(
          `  ~ ${curso.gradeCode} ${curso.section} ${curso.subjectName} P${item.position}: el informe no marca alternativa correcta (SAI=${correctos})`,
        );
        continue;
      }
      if (Number(ref.correct_count) === correctos) {
        calzan += 1;
      } else {
        difieren += 1;
        detalle.push(
          `  ✗ ${curso.gradeCode} ${curso.section} ${curso.subjectName} P${item.position}: SAI=${correctos} informe=${ref.correct_count} (n_sai=${autocorregibles} n_informe=${ref.response_count})`,
        );
      }
    }
  }

  console.log(`\n== Validación ${INPUT.split('/').pop()} ==`);
  console.log(`  ítems que reproducen el informe : ${calzan}`);
  console.log(`  ítems que DIFIEREN             : ${difieren}`);
  console.log(`  sin referencia en el informe   : ${sinReferencia}`);
  console.log(`  no autocorregibles (sin clave) : ${noAutocorregibles}`);
  if (detalle.length) {
    console.log('');
    detalle.forEach((d) => console.log(d));
  }
  await sql.end();
  if (difieren > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
