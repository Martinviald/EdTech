/**
 * Huella (fingerprint) del código que decide QUÉ NÚMEROS tiene el read-model de cohorte.
 *
 * El deploy ya no corre el backfill completo en cada push (10 min de 11). Para que eso
 * sea seguro hace falta una señal que diga "la semántica del recálculo cambió, hay que
 * repoblar". Esta huella es esa señal: SHA-256 sobre el contenido del CIERRE TRANSITIVO
 * de imports relativos de los archivos que producen el read-model.
 *
 * Por qué el cierre de imports y no una lista de paths en el YAML del workflow: una
 * lista escrita a mano se desactualiza sola y nadie se entera — que es exactamente el
 * fallo silencioso que hay que evitar. El cierre se deriva del grafo real, y el test
 * `cohort-stats-fingerprint.spec.ts` falla si aparece un import externo nuevo (que el
 * cierre no puede seguir) para forzar una decisión consciente.
 *
 * ⚠️ LÍMITE CONOCIDO, dicho de frente. La huella cubre CÓDIGO, no SEMÁNTICA RÍO ARRIBA.
 * Si cambia la forma del JSONB `responses.value`, o el significado de `is_correct`, sin
 * tocar ninguno de estos archivos, la huella no se mueve y el read-model queda viejo en
 * silencio. Ese hueco no lo cierra ningún gate basado en código: lo cubre el backfill
 * completo programado semanal (.github/workflows/backfill-cohort-stats.yml), que
 * auto-cura cualquier deriva en ≤7 días, y el smoke check que corre en TODO deploy.
 * Ver docs/plan-optimizar-backfill-cohort-stats.md §2.3 y §5.
 *
 * Nota: la huella es sobre el contenido crudo, comentarios incluidos. Un cambio de sólo
 * comentarios dispara un backfill de más. Es el lado seguro del error: preferimos
 * repoblar de más que no repoblar cuando había que hacerlo.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Puntos de entrada del cierre. Son los tres archivos que, entre los tres, determinan
 * cada número que termina en `assessment_item_stats` / `assessment_skill_stats`:
 *  · el calculador puro (la agregación en sí),
 *  · la capa de persistencia (bucketización por curso, delete+reinsert, escalas), y
 *  · el script del backfill (qué filas se leen y cómo se adaptan antes de agregar:
 *    `hasAlternatives`, el /100 de `percentage`).
 */
export const FINGERPRINT_ENTRIES: readonly string[] = [
  'packages/types/src/utils/item-stats-calculator.ts',
  'packages/db/src/queries/cohort-stats.ts',
  'packages/db/src/scripts/backfill-cohort-stats.ts',
];

/**
 * Imports NO relativos que el cierre no sigue (viven en node_modules o son del runtime).
 * El test R1 falla si aparece uno fuera de esta lista: obliga a decidir a mano si el
 * paquete nuevo influye en los números o no, en vez de ampliar el hueco en silencio.
 *
 * `@soe/types` está acá y NO se sigue como paquete: su archivo que importa —el
 * calculador— ya es un entry explícito. Seguir el barrel entero haría que cualquier
 * cambio en `packages/types` dispare un backfill.
 */
export const ALLOWED_EXTERNAL_IMPORTS: readonly string[] = [
  '@soe/types',
  'dotenv',
  'drizzle-orm',
  'node:crypto',
  'node:fs',
  'node:path',
  'postgres',
];

/**
 * Nombre de paquete de un especificador externo: `drizzle-orm/pg-core` → `drizzle-orm`,
 * `@soe/types/utils/x` → `@soe/types`. La allowlist se compara contra esto, no contra
 * el subpath, para no tener que listar cada entrypoint de una misma librería.
 */
export function externalPackageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
}

export type ImportClosure = {
  /** Rutas relativas al repo, ordenadas. */
  files: string[];
  /** Especificadores no relativos encontrados, ordenados y sin repetir. */
  externals: string[];
};

/** Raíz del monorepo: sube hasta encontrar `pnpm-workspace.yaml`. */
export function findRepoRoot(from: string = __dirname): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No encontré la raíz del monorepo desde ${from}`);
    dir = parent;
  }
}

const IMPORT_RE =
  /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;}])import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec) out.push(spec);
  }
  return out;
}

/** `./x` → `<dir>/x.ts` o `<dir>/x/index.ts`. Devuelve null si no resuelve. */
function resolveRelative(fromFile: string, spec: string, repoRoot: string): string | null {
  const base = resolve(dirname(join(repoRoot, fromFile)), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return relative(repoRoot, candidate).split(sep).join('/');
  }
  return null;
}

export function computeImportClosure(
  repoRoot: string,
  entries: readonly string[] = FINGERPRINT_ENTRIES,
  read: (absPath: string) => string = (p) => readFileSync(p, 'utf-8'),
): ImportClosure {
  const files = new Set<string>();
  const externals = new Set<string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (files.has(file)) continue;
    const abs = join(repoRoot, file);
    if (!existsSync(abs)) {
      throw new Error(
        `La huella del read-model apunta a un archivo inexistente: ${file}. ` +
          `Si se movió o renombró, actualizá FINGERPRINT_ENTRIES.`,
      );
    }
    files.add(file);

    for (const spec of extractSpecifiers(read(abs))) {
      if (!spec.startsWith('.')) {
        externals.add(spec);
        continue;
      }
      const resolved = resolveRelative(file, spec, repoRoot);
      if (resolved === null) {
        throw new Error(`No pude resolver el import "${spec}" desde ${file}`);
      }
      if (!files.has(resolved)) pending.push(resolved);
    }
  }

  return {
    files: [...files].sort(),
    externals: [...externals].sort(),
  };
}

/** SHA-256 de `<path>\0<sha256 del contenido>` por archivo, en orden. */
export function computeFingerprint(
  repoRoot: string,
  entries: readonly string[] = FINGERPRINT_ENTRIES,
  read: (absPath: string) => string = (p) => readFileSync(p, 'utf-8'),
): { hash: string; files: string[] } {
  const { files } = computeImportClosure(repoRoot, entries, read);
  const outer = createHash('sha256');
  for (const file of files) {
    const content = read(join(repoRoot, file)).replace(/\r\n/g, '\n');
    outer.update(file);
    outer.update('\0');
    outer.update(createHash('sha256').update(content).digest('hex'));
    outer.update('\n');
  }
  return { hash: outer.digest('hex'), files };
}
