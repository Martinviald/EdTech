/**
 * Carga de variables de entorno para los scripts de calibración.
 *
 * Igual que los otros scripts del repo, lo primero es `process.env`. Si falta una
 * variable, se lee (sin sobrescribir lo ya definido) el `.env` del worktree y, si
 * no, el del checkout principal `repositorio/` (hermano del worktree). Se parsea a
 * mano para no depender de `dotenv` desde la raíz del monorepo (no está hoisteado).
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const REPO_ROOT = resolve(__dirname, '..', '..');

function candidateEnvFiles(): string[] {
  const fromEnv = process.env.SOE_ENV_FILE;
  return [
    ...(fromEnv ? [resolve(fromEnv)] : []),
    resolve(REPO_ROOT, '.env'),
    resolve(REPO_ROOT, '..', 'repositorio', '.env'),
  ];
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Completa `process.env` con los `.env` encontrados. Devuelve las rutas leídas. */
export function loadEnv(): string[] {
  const loaded: string[] = [];
  for (const file of candidateEnvFiles()) {
    if (!existsSync(file)) continue;
    const vars = parseEnvFile(file);
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
    }
    loaded.push(file);
  }
  return loaded;
}

/** Oculta la contraseña de una URL de conexión para imprimirla. */
export function maskUrl(url: string): string {
  return url.replace(/(\/\/[^:/@]+:)[^@]*@/, '$1***@');
}
