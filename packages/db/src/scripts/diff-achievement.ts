/**
 * Informe de diferencias del % de logro (docs/plan-logro-unificado-y-cohorte.md A5-1).
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:diff:achievement [--out <archivo.csv>] [--org <orgId>]
 *
 * SÓLO LECTURA. Calcula, sobre los MISMOS datos y en el mismo momento, el % de logro con las
 * fórmulas viejas y con la regla única (Σ puntaje ÷ Σ máximo de las respuestas corregidas,
 * docs/diseno-logro-unificado-y-cohorte.md §3.1), y escribe un CSV con una fila por:
 *  · evaluación: viejo = promedio de los % de cada alumno; nuevo = tally de assessment_item_stats.
 *  · evaluación × curso × nodo: viejo A = `assessment_skill_stats.percentage` guardado;
 *    viejo C = aciertos ÷ respuestas (lo que usaban alertas, muestra y panorama del alumno);
 *    nuevo = tally de assessment_item_stats sobre las preguntas etiquetadas con el nodo.
 *
 * ⚠️ Correrlo ANTES del backfill de cohort-stats del deploy: después, el % guardado del read-model
 * ya es el nuevo y la columna "viejo A" deja de mostrar lo que veían los colegios.
 *
 * Usa el rol admin, que lee todas las orgs sin contexto (ver la skill demo-db-access §5); por eso
 * filtra explícitamente por org con `--org`. Para garantizar que no escribe, conectar con
 * `options=-cdefault_transaction_read_only=on` en la URL.
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { sql, type SQL } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';

type Args = { out: string; orgId?: string };

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { out: 'diff-achievement.csv' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i] ?? args.out;
    else if (argv[i] === '--org') args.orgId = argv[++i];
  }
  return args;
}

type Row = Record<string, string | number | null>;

const COLUMNS = [
  'nivel',
  'colegio',
  'evaluacion',
  'curso',
  'nodo',
  'tipo_nodo',
  'origen',
  'viejo_a',
  'viejo_c',
  'nuevo',
  'dif_a',
  'dif_c',
] as const;

function toCsv(rows: readonly Row[]): string {
  const escape = (v: string | number | null) => {
    if (v === null) return '';
    const text = String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    COLUMNS.join(','),
    ...rows.map((r) => COLUMNS.map((c) => escape(r[c] ?? null)).join(',')),
  ].join('\n');
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.round((b - a) * 100) / 100;
}

async function assessmentRows(db: Database, orgFilter: SQL): Promise<Row[]> {
  const rows = await db.execute(sql`
    with old as (
      select assessment_id, avg(percentage::numeric) as pct
      from assessment_results where percentage is not null group by 1
    ), new as (
      select assessment_id, 100 * sum(score_sum) / nullif(sum(max_sum), 0) as pct
      from assessment_item_stats group by 1
    )
    select o.name as colegio, a.name as evaluacion, a.data_granularity::text as origen,
           old.pct as viejo_a, new.pct as nuevo
    from assessments a
    join organizations o on o.id = a.org_id
    left join old on old.assessment_id = a.id
    left join new on new.assessment_id = a.id
    where (old.pct is not null or new.pct is not null) ${orgFilter}
    order by o.name, a.name
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const viejoA = num(r.viejo_a);
    const nuevo = num(r.nuevo);
    return {
      nivel: 'evaluacion',
      colegio: String(r.colegio),
      evaluacion: String(r.evaluacion ?? ''),
      curso: null,
      nodo: null,
      tipo_nodo: null,
      origen: String(r.origen),
      viejo_a: viejoA,
      viejo_c: null,
      nuevo,
      dif_a: diff(viejoA, nuevo),
      dif_c: null,
    };
  });
}

async function nodeRows(db: Database, orgFilter: SQL): Promise<Row[]> {
  const rows = await db.execute(sql`
    with tagged as (
      select s.assessment_id, s.class_group_id, t.node_id,
             100 * sum(s.score_sum) / nullif(sum(s.max_sum), 0) as pct
      from assessment_item_stats s
      join (select distinct item_id, node_id from item_taxonomy_tags) t on t.item_id = s.item_id
      group by 1, 2, 3
    )
    select o.name as colegio, a.name as evaluacion, cg.name as curso, n.name as nodo,
           n.type::text as tipo_nodo, ss.source::text as origen,
           ss.percentage as viejo_a,
           100.0 * ss.correct_count / nullif(ss.total_count, 0) as viejo_c,
           tagged.pct as nuevo
    from assessment_skill_stats ss
    join assessments a on a.id = ss.assessment_id
    join organizations o on o.id = a.org_id
    join class_groups cg on cg.id = ss.class_group_id
    join taxonomy_nodes n on n.id = ss.node_id
    left join tagged on tagged.assessment_id = ss.assessment_id
                    and tagged.class_group_id = ss.class_group_id
                    and tagged.node_id = ss.node_id
    where true ${orgFilter}
    order by o.name, a.name, cg.name, n.name
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const origen = String(r.origen);
    const stored = num(r.viejo_a);
    const viejoA =
      origen === 'imported' && stored !== null && stored <= 1 ? num(stored * 100) : stored;
    const viejoC = num(r.viejo_c);
    const nuevo = num(r.nuevo);
    return {
      nivel: 'nodo',
      colegio: String(r.colegio),
      evaluacion: String(r.evaluacion ?? ''),
      curso: String(r.curso),
      nodo: String(r.nodo),
      tipo_nodo: String(r.tipo_nodo),
      origen,
      viejo_a: viejoA,
      viejo_c: viejoC,
      nuevo,
      dif_a: diff(viejoA, nuevo),
      dif_c: diff(viejoC, nuevo),
    };
  });
}

function summarize(rows: readonly Row[]): void {
  const by = new Map<
    string,
    { n: number; maxA: number; maxC: number; ge5A: number; ge5C: number }
  >();
  for (const r of rows) {
    const key = `${String(r.colegio)} · ${String(r.nivel)}`;
    const acc = by.get(key) ?? { n: 0, maxA: 0, maxC: 0, ge5A: 0, ge5C: 0 };
    acc.n += 1;
    const a = Math.abs(Number(r.dif_a ?? 0));
    const c = Math.abs(Number(r.dif_c ?? 0));
    acc.maxA = Math.max(acc.maxA, a);
    acc.maxC = Math.max(acc.maxC, c);
    if (a >= 5) acc.ge5A += 1;
    if (c >= 5) acc.ge5C += 1;
    by.set(key, acc);
  }
  console.log('[diff-achievement] resumen (|Δ| en pp):');
  for (const [key, v] of by) {
    console.log(
      `  ${key}: ${v.n} filas · máx vs A ${v.maxA.toFixed(2)} (${v.ge5A} ≥ 5) · máx vs C ${v.maxC.toFixed(2)} (${v.ge5C} ≥ 5)`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');

  const db = createDbClient(databaseUrl, { maxConnections: 1 });
  const orgFilter = args.orgId ? sql`and a.org_id = ${args.orgId}::uuid` : sql``;
  try {
    const rows = [...(await assessmentRows(db, orgFilter)), ...(await nodeRows(db, orgFilter))];
    writeFileSync(args.out, toCsv(rows));
    console.log(`[diff-achievement] ${rows.length} filas → ${args.out}`);
    summarize(rows);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[diff-achievement] falló:', err);
  process.exit(1);
});
