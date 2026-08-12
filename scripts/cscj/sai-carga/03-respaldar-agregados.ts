/**
 * Respalda a JSON los assessments `aggregate_only` que la carga del SAI
 * reemplaza, ANTES de borrarlos, para que la decisión sea reversible.
 *
 * Son los que dejó el importador de informes oficiales (`config.source =
 * 'dia_official_report'`) en los cursos que ahora pasan a tener respuestas por
 * alumno. La regla es la §9.3 del plan de analítica agregada: en conflicto de
 * granularidad gana el dato granular. Lo que se pierde al reemplazarlos es la
 * dimensión de desarrollo, que el SAI no exporta.
 *
 * Vuelca el assessment, su read-model (`assessment_item_stats`,
 * `assessment_skill_stats`), sus `assessment_results` y sus `import_jobs`.
 *
 *   DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx \
 *     scripts/cscj/sai-2025/03-respaldar-agregados.ts --input=<artefacto.json>[,<otro.json>]
 */
import postgres from 'postgres';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const INPUTS = opt('input', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => resolve(s));
if (!INPUTS.length) throw new Error('Falta --input=<artefacto.json>[,<otro.json>]');
const SALIDA = join(__dirname, 'out');

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const sql = postgres(url, { max: 1, connect_timeout: 20, ssl: { rejectUnauthorized: false } });

type Curso = {
  gradeCode: string;
  section: string;
  subjectName: string;
  applicationPeriod: string;
};

async function main(): Promise<void> {
  await sql`select set_config('app.current_org_id', ${ORG_ID}, false)`;

  const cursos: Curso[] = INPUTS.flatMap(
    (f) => (JSON.parse(readFileSync(f, 'utf8')) as { courses: Curso[] }).courses,
  );

  const respaldo: unknown[] = [];
  const ids: string[] = [];

  for (const c of cursos) {
    const rows = await sql`
      select a.id, a.name, a.config, a.data_granularity, a.administered_at, a.created_at,
             g.code as grade_code, sub.name as subject_name, i.application_period, cg.name as seccion
      from assessments a
      join instruments i on i.id = a.instrument_id
      join grades g on g.id = i.grade_id
      join subjects sub on sub.id = i.subject_id
      left join assessment_course_assignments aca on aca.assessment_id = a.id
      left join class_groups cg on cg.id = aca.class_group_id
      where a.org_id = ${ORG_ID} and i.year = 2025
        and a.data_granularity = 'aggregate_only'
        and i.application_period = ${c.applicationPeriod}
        and g.code = ${c.gradeCode} and sub.name = ${c.subjectName}
        and cg.name = ${c.section}`;

    for (const a of rows) {
      const id = a.id as string;
      if (ids.includes(id)) continue;
      ids.push(id);
      const [itemStats, skillStats, results, jobs] = await Promise.all([
        sql`select * from assessment_item_stats where assessment_id = ${id}`,
        sql`select * from assessment_skill_stats where assessment_id = ${id}`,
        sql`select * from assessment_results where assessment_id = ${id}`,
        sql`select * from import_jobs where assessment_id = ${id}`,
      ]);
      respaldo.push({
        assessment: a,
        itemStats,
        skillStats,
        results,
        importJobs: jobs,
      });
      console.log(
        `  ${a.grade_code} ${a.seccion} · ${a.subject_name} · ${a.application_period} — ${a.name} · item_stats=${itemStats.length} skill_stats=${skillStats.length} results=${results.length}`,
      );
    }
  }

  mkdirSync(SALIDA, { recursive: true });
  const destino = join(SALIDA, 'respaldo-agregados-2025.json');
  writeFileSync(destino, JSON.stringify({ orgId: ORG_ID, ids, respaldo }, null, 2), 'utf8');
  console.log(`\n  ${ids.length} assessments respaldados → ${destino}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
