/**
 * Borra los assessments `aggregate_only` que la carga del SAI reemplazó.
 *
 * Sólo borra los ids que están en el respaldo de `03-respaldar-agregados.ts`, y
 * antes de tocar nada verifica que cada uno cumpla las tres condiciones que lo
 * hacen reemplazable: sigue siendo `aggregate_only`, no tiene respuestas, y su
 * curso ya tiene un assessment `item_level` con respuestas cargadas. Si alguna
 * falla, aborta sin borrar: es preferible no avanzar a borrar de más.
 *
 * Dry-run por defecto.
 *
 *   DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx \
 *     scripts/cscj/sai-2025/04-borrar-agregados.ts [--commit]
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const RESPALDO = opt('respaldo', join(__dirname, 'out/respaldo-agregados-2025.json'));

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const sql = postgres(url, { max: 1, connect_timeout: 20, ssl: { rejectUnauthorized: false } });

async function main(): Promise<void> {
  await sql`select set_config('app.current_org_id', ${ORG_ID}, false)`;
  const { ids } = JSON.parse(readFileSync(RESPALDO, 'utf8')) as { ids: string[] };
  if (!ids.length) throw new Error('El respaldo no tiene ids');

  const chequeo = await sql`
    select a.id, a.name, a.data_granularity,
           (select count(*) from responses r where r.assessment_id = a.id)::int as respuestas,
           (select count(*)
              from assessments b
              join assessment_course_assignments acb on acb.assessment_id = b.id
              join assessment_course_assignments aca on aca.assessment_id = a.id
                 and aca.class_group_id = acb.class_group_id
             where b.org_id = a.org_id and b.instrument_id = a.instrument_id
               and b.id <> a.id and b.data_granularity = 'item_level'
               and exists (select 1 from responses r where r.assessment_id = b.id))::int as reemplazo
    from assessments a
    where a.id in ${sql(ids)} and a.org_id = ${ORG_ID}`;

  if (chequeo.length !== ids.length) {
    throw new Error(`El respaldo tiene ${ids.length} ids pero la BDD devuelve ${chequeo.length}`);
  }
  const problemas = chequeo.filter(
    (r) =>
      r.data_granularity !== 'aggregate_only' ||
      Number(r.respuestas) > 0 ||
      Number(r.reemplazo) === 0,
  );
  if (problemas.length) {
    console.error('  ✗ no se cumplen las condiciones de reemplazo:');
    for (const p of problemas) {
      console.error(
        `    ${p.name}: granularidad=${p.data_granularity} respuestas=${p.respuestas} reemplazo_item_level=${p.reemplazo}`,
      );
    }
    throw new Error('Abortado sin borrar nada');
  }

  console.log(`\n== Borrado de agregados reemplazados · ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ==`);
  console.log(
    `  ${ids.length} assessments cumplen las 3 condiciones (aggregate_only · 0 respuestas · reemplazo item_level con respuestas)`,
  );

  if (!COMMIT) {
    console.log('\n(dry-run: no se borró nada. Re-corre con --commit)');
    await sql.end();
    return;
  }

  const borradas: Record<string, number> = {};
  for (const tabla of [
    'assessment_item_stats',
    'assessment_skill_stats',
    'assessment_level_stats',
    'skill_results',
    'assessment_results',
    'import_jobs',
    'assessment_course_assignments',
  ]) {
    const r = await sql.unsafe(`delete from ${tabla} where assessment_id = any($1::uuid[])`, [ids]);
    borradas[tabla] = r.count;
  }
  const fin = await sql`delete from assessments where id in ${sql(ids)}`;
  borradas['assessments'] = fin.count;

  console.log('\n✅ borrado:');
  for (const [t, n] of Object.entries(borradas)) console.log(`  ${t}: ${n}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
