/**
 * Extrae los goldsets de calibración del motor de decisiones desde la BDD LOCAL.
 *
 *   npx tsx scripts/decisions/extract-goldsets.ts
 *
 * - SOLO lectura: todo corre en una transacción `read only`. Se niega a correr si
 *   la URL no apunta a localhost (nunca demo ni AWS).
 * - Usa `DATABASE_ADMIN_URL` si existe, si no `DATABASE_URL` (del entorno o de los
 *   `.env`, ver `env.ts`). En local el rol suele ser superusuario y no ve RLS; las
 *   tablas leídas aquí (`items`, `taxonomy_*`, `instrument_sections`) no tienen RLS
 *   y `remedial_materials` sí: si ese rol respeta RLS, pasa `--org <uuid>` y se fija
 *   `app.current_org_id` dentro de la transacción.
 * - Sin datos de alumnos: solo contenido de ítems, pasajes y taxonomía.
 *
 * Salida (gitignoreada: el contenido de las pruebas DIA/PAES no se sube):
 *   scripts/decisions/data/goldset-remedial.json
 *   scripts/decisions/data/goldset-taxonomy.json
 */
import { mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { loadEnv, maskUrl, REPO_ROOT } from './env';
import type {
  GoldAlternative,
  GoldDimension,
  GoldTreeNode,
  RemedialGoldItem,
  RemedialGoldset,
  StoredJudgeVerdict,
  TaxonomyGoldItem,
  TaxonomyGoldset,
  TaxonomyGoldTask,
} from './goldset-types';

// ── Cliente `postgres` (el mismo de los scripts de `packages/db`) ────────────
// No está hoisteado a la raíz: se resuelve desde `packages/db`. Se tipa solo la
// superficie que se usa, para no depender de los tipos del paquete desde aquí.

type Row = Record<string, unknown>;
interface PgTx {
  unsafe(query: string, params?: unknown[]): Promise<Row[]>;
}
interface PgSql {
  begin<T>(options: string, fn: (tx: PgTx) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}
type PostgresFactory = (url: string, options: Record<string, unknown>) => PgSql;

function loadPostgres(): PostgresFactory {
  const req = createRequire(resolve(REPO_ROOT, 'packages', 'db', 'package.json'));
  const mod: unknown = req('postgres');
  const factory =
    typeof mod === 'function'
      ? mod
      : typeof mod === 'object' && mod !== null && 'default' in mod
        ? (mod as { default: unknown }).default
        : null;
  if (typeof factory !== 'function') throw new Error('No se pudo cargar el cliente `postgres`');
  return factory as PostgresFactory;
}

// ── Argumentos ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
const ORG_ID = flag('org');

/** Cupos del banco para completar el set remedial (el set generado es chico). */
const REMEDIAL_BANK_QUOTA: Record<string, { n: number; needsPassage: boolean }> = {
  LANG: { n: 12, needsPassage: true },
  MATH: { n: 12, needsPassage: false },
  HIST: { n: 8, needsPassage: false },
  SCI: { n: 8, needsPassage: false },
};
/** Cupos del set de taxonomía por asignatura. */
const TAXONOMY_QUOTA: Record<string, number> = { LANG: 10, MATH: 10, HIST: 10, SCI: 10 };

const MATH_CODES = new Set(['MATH']);

// ── Helpers de lectura de filas ──────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function reqStr(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`Se esperaba texto en ${what}`);
  return v;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseAlternatives(content: unknown): GoldAlternative[] | null {
  if (!isRecord(content) || !Array.isArray(content.alternatives)) return null;
  const alts: GoldAlternative[] = [];
  for (const a of content.alternatives) {
    if (!isRecord(a)) return null;
    const key = str(a.key);
    const text = str(a.text);
    if (!key || text === null || !text.trim()) return null;
    alts.push({ key, text: text.trim(), isCorrect: a.isCorrect === true });
  }
  return alts;
}

function stemOf(content: unknown): string | null {
  if (!isRecord(content)) return null;
  const s = str(content.stem);
  return s && s.trim() ? s.trim() : null;
}

function parseVerdict(v: unknown): (StoredJudgeVerdict & { position: number }) | null {
  if (!isRecord(v) || typeof v.position !== 'number') return null;
  return {
    position: v.position,
    answerable: v.answerable === true,
    derivedAnswer: str(v.derivedAnswer),
    uniqueCorrect: v.uniqueCorrect === true,
    factual: v.factual === true,
    skillMatch: v.skillMatch === true,
  };
}

/**
 * Heurística de texto roto por la extracción desde PDF (fórmulas que perdieron sus
 * símbolos: "Si p  7 46  7 44", "¿...? log 20", "p , q"). Esos ítems no se pueden
 * responder desde el texto y ensuciarían la exactitud de `clave`.
 */
function looksGarbled(text: string): boolean {
  return (
    /\S\s{2,}\S/.test(text) ||
    /\s[,.;:]/.test(text) ||
    /\?\s+\S/.test(text) ||
    /[”"]\s+\d+\s*$/.test(text)
  );
}
function itemLooksGarbled(stem: string, alternatives: GoldAlternative[]): boolean {
  return looksGarbled(stem) || alternatives.some((a) => /\s{2,}/.test(a.text));
}

function subjectFromCode(code: string | null): string | null {
  if (!code) return null;
  const m = /^(LANG|MATH|HIST|SCI|ENG)\b/.exec(code);
  return m?.[1] ?? null;
}

/** Filtro común: selección múltiple sin figura (el estado debe bastar para responder). */
const NO_FIGURE_SQL = `
  i.type = 'multiple_choice'
  AND i.deleted_at IS NULL
  AND coalesce((i.scoring_config->>'hasFigure')::boolean, false) = false
  AND NOT (coalesce(i.scoring_config, '{}'::jsonb) ? 'imageRef')
  AND NOT (coalesce(i.scoring_config, '{}'::jsonb) ? 'altImageRefs')
  AND jsonb_typeof(i.content->'alternatives') = 'array'
  AND jsonb_array_length(i.content->'alternatives') >= 3
  AND (SELECT count(*) FROM jsonb_array_elements(i.content->'alternatives') a
        WHERE (a->>'isCorrect')::boolean) = 1
  AND coalesce(i.content->>'stem', '') <> ''
  AND i.content->>'stem' !~* '(imagen|gr[aá]fico|tabla|figura|dibujo|ilustraci[oó]n|esquema|diagrama|mapa)'
  AND (sec.passage_text IS NOT NULL
       OR i.content->>'stem' !~* '(fuente|documento|texto|fragmento|cita|l[aá]mina)')
`;

// ── Juez remedial ────────────────────────────────────────────────────────────

async function extractRemedial(tx: PgTx): Promise<RemedialGoldItem[]> {
  const out: RemedialGoldItem[] = [];

  // 1) Ítems generados por el motor remedial + veredicto guardado del juez LLM.
  const materials = await tx.unsafe(`
    SELECT m.id, m.method, m.content, m.quality_report, n.name AS node_name, n.code AS node_code,
           s.code AS subject_code
      FROM remedial_materials m
      LEFT JOIN taxonomy_nodes n ON n.id = m.node_id
      LEFT JOIN subjects s ON s.id = n.subject_id
     WHERE m.type = 'practice_set' AND m.deleted_at IS NULL AND m.content IS NOT NULL
     ORDER BY m.created_at`);

  for (const m of materials) {
    const materialId = reqStr(m.id, 'remedial_materials.id');
    const content = m.content;
    if (!isRecord(content) || !Array.isArray(content.items)) continue;
    const refs = content.items.filter(isRecord);
    const skillFocus = str(content.skillFocus);
    const subjectCode = str(m.subject_code) ?? subjectFromCode(str(m.node_code));

    const verdicts = new Map<number, StoredJudgeVerdict>();
    if (isRecord(m.quality_report) && Array.isArray(m.quality_report.verdicts)) {
      for (const raw of m.quality_report.verdicts) {
        const v = parseVerdict(raw);
        if (v) {
          const { position, ...rest } = v;
          verdicts.set(position, rest);
        }
      }
    }

    // Pasaje reutilizado (reuse_stimulus): la sección oficial referida en `stimuli`.
    let stimulus: RemedialGoldItem['stimulus'] = null;
    const stimuli = Array.isArray(content.stimuli) ? content.stimuli.filter(isRecord) : [];
    const sectionId = stimuli.length > 0 ? str(stimuli[0]?.sectionId) : null;
    if (sectionId) {
      const [sec] = await tx.unsafe(
        `SELECT passage_title, passage_text FROM instrument_sections WHERE id = $1`,
        [sectionId],
      );
      const text = str(sec?.passage_text);
      if (text) stimulus = { title: str(sec?.passage_title), text };
    }

    const ids = refs.map((r) => str(r.itemId)).filter((x): x is string => x !== null);
    const rows = await tx.unsafe(
      `SELECT id, content FROM items WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    const byId = new Map(rows.map((r) => [reqStr(r.id, 'items.id'), r.content]));

    for (const ref of refs) {
      const itemId = str(ref.itemId);
      const position = typeof ref.position === 'number' ? ref.position : null;
      if (!itemId || !byId.has(itemId)) continue;
      const itemContent = byId.get(itemId);
      const alternatives = parseAlternatives(itemContent);
      const stem = stemOf(itemContent);
      if (!alternatives || !stem) continue;
      const correct = alternatives.filter((a) => a.isCorrect);
      if (correct.length !== 1 || !correct[0]) continue;
      out.push({
        itemId,
        origin: 'remedial',
        subjectCode,
        isMath: subjectCode !== null && MATH_CODES.has(subjectCode),
        sourceLabel: `remedial_materials:${materialId}`,
        stimulus,
        stem,
        alternatives,
        correctKey: correct[0].key,
        declaredSkill: skillFocus ?? str(m.node_name),
        judgeVerdict: position !== null ? (verdicts.get(position) ?? null) : null,
      });
    }
  }

  // 2) Complemento: ítems del banco (oficiales/importados) con clave. Sin veredicto.
  for (const [subject, quota] of Object.entries(REMEDIAL_BANK_QUOTA)) {
    const rows = await tx.unsafe(
      `
      SELECT i.id, i.content, ins.name AS instrument_name,
             sec.passage_title, sec.passage_text,
             (SELECT n.name FROM item_taxonomy_tags tg JOIN taxonomy_nodes n ON n.id = tg.node_id
               WHERE tg.item_id = i.id AND tg.tagged_by = 'human' AND n.type = 'skill'
               ORDER BY n.code LIMIT 1) AS skill
        FROM items i
        JOIN instruments ins ON ins.id = i.instrument_id AND ins.deleted_at IS NULL
        JOIN subjects s ON s.id = ins.subject_id
        LEFT JOIN instrument_sections sec ON sec.id = i.section_id
       WHERE s.code = $1 AND i.source IN ('official', 'imported')
         AND ${NO_FIGURE_SQL}
         AND ($2::boolean = false OR sec.passage_text IS NOT NULL)
       ORDER BY md5(i.id::text)
       LIMIT $3`,
      [subject, quota.needsPassage, quota.n * 4],
    );
    const seenStems = new Set<string>();
    let taken = 0;
    for (const r of rows) {
      if (taken >= quota.n) break;
      const alternatives = parseAlternatives(r.content);
      const stem = stemOf(r.content);
      if (!alternatives || !stem || seenStems.has(stem)) continue;
      if (itemLooksGarbled(stem, alternatives)) continue;
      const correct = alternatives.find((a) => a.isCorrect);
      if (!correct) continue;
      seenStems.add(stem);
      const passage = str(r.passage_text);
      out.push({
        itemId: reqStr(r.id, 'items.id'),
        origin: 'bank',
        subjectCode: subject,
        isMath: MATH_CODES.has(subject),
        sourceLabel: str(r.instrument_name) ?? 'banco',
        stimulus: passage ? { title: str(r.passage_title), text: passage } : null,
        stem,
        alternatives,
        correctKey: correct.key,
        declaredSkill: str(r.skill),
        judgeVerdict: null,
      });
      taken++;
    }
  }
  return out;
}

// ── Taxonomía ────────────────────────────────────────────────────────────────

interface NodeRow {
  id: string;
  parentId: string | null;
  type: string;
  code: string | null;
  name: string;
  description: string | null;
  order: number;
}

async function loadNodes(tx: PgTx, taxonomyId: string): Promise<NodeRow[]> {
  const rows = await tx.unsafe(
    `SELECT id, parent_id, type::text AS type, code, name, description, "order"
       FROM taxonomy_nodes WHERE taxonomy_id = $1`,
    [taxonomyId],
  );
  return rows.map((r) => ({
    id: reqStr(r.id, 'taxonomy_nodes.id'),
    parentId: str(r.parent_id),
    type: reqStr(r.type, 'taxonomy_nodes.type'),
    code: str(r.code),
    name: reqStr(r.name, 'taxonomy_nodes.name'),
    description: str(r.description),
    order: typeof r.order === 'number' ? r.order : 0,
  }));
}

/**
 * Construye la dimensión (taxonomía, tipo de hoja): el bosque podado a los caminos
 * que terminan en nodos `leafType`, con las raíces únicas colapsadas.
 */
function buildDimension(
  key: string,
  taxonomy: { type: string; name: string },
  leafType: string,
  nodes: NodeRow[],
): { dimension: GoldDimension; idOf: Map<string, string> } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, NodeRow[]>();
  for (const n of nodes) {
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  // Nodos que conservan: hojas del tipo pedido y todos sus ancestros.
  const keep = new Set<string>();
  for (const n of nodes) {
    if (n.type !== leafType) continue;
    let cur: NodeRow | undefined = n;
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  const idOf = new Map<string, string>(nodes.map((n) => [n.id, n.code ?? n.id]));
  const sortNodes = (list: NodeRow[]) =>
    [...list].sort(
      (a, b) => a.order - b.order || (a.code ?? a.name).localeCompare(b.code ?? b.name),
    );

  const build = (n: NodeRow): GoldTreeNode => {
    const node: GoldTreeNode = { id: idOf.get(n.id) ?? n.id, label: n.name };
    if (n.description && n.description.trim()) node.description = n.description.trim();
    if (n.type !== leafType) {
      const kids = sortNodes((children.get(n.id) ?? []).filter((c) => keep.has(c.id)));
      if (kids.length > 0) node.children = kids.map(build);
    }
    return node;
  };

  let forest = sortNodes((children.get(null) ?? []).filter((n) => keep.has(n.id))).map(build);
  const collapsedPrefix: string[] = [];
  while (forest.length === 1 && forest[0]?.children && forest[0].children.length > 0) {
    collapsedPrefix.push(forest[0].label);
    forest = forest[0].children;
  }

  // Ancestros en el espacio de ids del árbol (solo los que quedaron en el árbol).
  const ancestors: Record<string, string[]> = {};
  const walk = (list: GoldTreeNode[], path: string[]) => {
    for (const n of list) {
      ancestors[n.id] = path;
      if (n.children) walk(n.children, [...path, n.id]);
    }
  };
  walk(forest, []);

  return {
    dimension: {
      key,
      taxonomyType: taxonomy.type,
      taxonomyName: taxonomy.name,
      leafType,
      collapsedPrefix,
      tree: forest,
      ancestors,
    },
    idOf,
  };
}

async function extractTaxonomy(
  tx: PgTx,
): Promise<{ dimensions: GoldDimension[]; items: TaxonomyGoldItem[] }> {
  // Ítems con tags HUMANOS y ningún tag IA (las sugerencias IA sin confirmar quedan fuera).
  const picked: Row[] = [];
  for (const [subject, n] of Object.entries(TAXONOMY_QUOTA)) {
    const rows = await tx.unsafe(
      `
      SELECT i.id, i.content, ins.name AS instrument_name, g.name AS grade_name, s.name AS subject_name,
             s.code AS subject_code, sec.passage_title, sec.passage_text
        FROM items i
        JOIN instruments ins ON ins.id = i.instrument_id AND ins.deleted_at IS NULL
        JOIN subjects s ON s.id = ins.subject_id
        LEFT JOIN grades g ON g.id = ins.grade_id
        LEFT JOIN instrument_sections sec ON sec.id = i.section_id
       WHERE s.code = $1 AND i.source IN ('official', 'imported')
         AND ${NO_FIGURE_SQL}
         AND EXISTS (SELECT 1 FROM item_taxonomy_tags tg WHERE tg.item_id = i.id AND tg.tagged_by = 'human')
         AND NOT EXISTS (SELECT 1 FROM item_taxonomy_tags tg WHERE tg.item_id = i.id AND tg.tagged_by <> 'human')
       ORDER BY md5('tax' || i.id::text)
       LIMIT $2`,
      [subject, n * 4],
    );
    const seen = new Set<string>();
    let taken = 0;
    for (const r of rows) {
      if (taken >= n) break;
      const stem = stemOf(r.content);
      const alts = parseAlternatives(r.content);
      if (!stem || !alts || seen.has(stem) || itemLooksGarbled(stem, alts)) continue;
      seen.add(stem);
      picked.push(r);
      taken++;
    }
  }

  const itemIds = picked.map((r) => reqStr(r.id, 'items.id'));
  const tagRows = await tx.unsafe(
    `SELECT tg.item_id, tg.node_id, n.type::text AS node_type, t.id AS taxonomy_id, t.type::text AS taxonomy_type,
            t.name AS taxonomy_name
       FROM item_taxonomy_tags tg
       JOIN taxonomy_nodes n ON n.id = tg.node_id
       JOIN taxonomies t ON t.id = n.taxonomy_id
      WHERE tg.item_id = ANY($1::uuid[]) AND tg.tagged_by = 'human'`,
    [itemIds],
  );

  // Una dimensión por (taxonomía, tipo de nodo etiquetado).
  const dims = new Map<string, { dimension: GoldDimension; idOf: Map<string, string> }>();
  const nodeCache = new Map<string, NodeRow[]>();
  for (const t of tagRows) {
    const taxonomyId = reqStr(t.taxonomy_id, 'taxonomies.id');
    const taxonomyType = reqStr(t.taxonomy_type, 'taxonomies.type');
    const leafType = reqStr(t.node_type, 'taxonomy_nodes.type');
    const key = `${taxonomyType}:${leafType}`;
    if (dims.has(key)) continue;
    let nodes = nodeCache.get(taxonomyId);
    if (!nodes) {
      nodes = await loadNodes(tx, taxonomyId);
      nodeCache.set(taxonomyId, nodes);
    }
    dims.set(
      key,
      buildDimension(
        key,
        { type: taxonomyType, name: reqStr(t.taxonomy_name, 'taxonomies.name') },
        leafType,
        nodes,
      ),
    );
  }

  const items: TaxonomyGoldItem[] = [];
  for (const r of picked) {
    const itemId = reqStr(r.id, 'items.id');
    const tasksByDim = new Map<string, Set<string>>();
    for (const t of tagRows) {
      if (t.item_id !== itemId) continue;
      const key = `${reqStr(t.taxonomy_type, 'taxonomies.type')}:${reqStr(t.node_type, 'node_type')}`;
      const dim = dims.get(key);
      const goldId = dim?.idOf.get(reqStr(t.node_id, 'node_id'));
      if (!dim || !goldId || !(goldId in dim.dimension.ancestors)) continue;
      const set = tasksByDim.get(key) ?? new Set<string>();
      set.add(goldId);
      tasksByDim.set(key, set);
    }
    const tasks: TaxonomyGoldTask[] = [...tasksByDim.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dimension, gold]) => ({ dimension, goldNodeIds: [...gold].sort() }));
    if (tasks.length === 0) continue;
    const alternatives = (parseAlternatives(r.content) ?? []).map(({ key, text }) => ({
      key,
      text,
    }));
    const passage = str(r.passage_text);
    const subjectCode = str(r.subject_code);
    items.push({
      itemId,
      subjectCode,
      isMath: subjectCode !== null && MATH_CODES.has(subjectCode),
      instrumentName: str(r.instrument_name) ?? '',
      gradeName: str(r.grade_name),
      subjectName: str(r.subject_name),
      stimulus: passage ? { title: str(r.passage_title), text: passage } : null,
      stem: stemOf(r.content) ?? '',
      alternatives,
      tasks,
    });
  }

  const dimensions = [...dims.values()]
    .map((d) => d.dimension)
    .sort((a, b) => a.key.localeCompare(b.key));
  return { dimensions, items };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (o DATABASE_ADMIN_URL) en el entorno o en repositorio/.env');
    process.exit(1);
  }
  const host = /@([^:/?]+)/.exec(url)?.[1] ?? /\/\/([^:/?@]+)/.exec(url)?.[1] ?? '';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Me niego a leer una BDD que no es local (${maskUrl(url)}). Solo BDD local.`);
    process.exit(1);
  }
  console.log(`BDD: ${maskUrl(url)} (solo lectura)`);

  const postgres = loadPostgres();
  const sql = postgres(url, { max: 1, connect_timeout: 20, onnotice: () => undefined });
  try {
    const { remedial, taxonomy } = await sql.begin('read only', async (tx) => {
      if (ORG_ID) await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_ID]);
      return { remedial: await extractRemedial(tx), taxonomy: await extractTaxonomy(tx) };
    });

    const dataDir = resolve(__dirname, 'data');
    mkdirSync(dataDir, { recursive: true });
    const generatedAt = new Date().toISOString();
    const database = maskUrl(url);

    const remedialSet: RemedialGoldset = { generatedAt, database, items: remedial };
    const taxonomySet: TaxonomyGoldset = { generatedAt, database, ...taxonomy };
    writeFileSync(resolve(dataDir, 'goldset-remedial.json'), JSON.stringify(remedialSet, null, 2));
    writeFileSync(resolve(dataDir, 'goldset-taxonomy.json'), JSON.stringify(taxonomySet, null, 2));

    const count = <T>(xs: T[], f: (x: T) => string) =>
      xs.reduce<Record<string, number>>((acc, x) => ((acc[f(x)] = (acc[f(x)] ?? 0) + 1), acc), {});
    console.log(
      `Remedial: ${remedial.length} ítems`,
      count(remedial, (i) => `${i.origin}/${i.subjectCode ?? '?'}`),
    );
    console.log(`  con veredicto del juez LLM: ${remedial.filter((i) => i.judgeVerdict).length}`);
    console.log(
      `Taxonomía: ${taxonomy.items.length} ítems`,
      count(taxonomy.items, (i) => i.subjectCode ?? '?'),
    );
    console.log(
      `  tareas: ${taxonomy.items.reduce((s, i) => s + i.tasks.length, 0)}`,
      count(
        taxonomy.items.flatMap((i) => i.tasks),
        (t) => t.dimension,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
