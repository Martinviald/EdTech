/**
 * R1 — test de cierre. Es la mitad que hace auditable al gate del deploy: si el grafo
 * de imports del read-model se ensancha y la huella deja de cubrirlo, esto se pone en
 * rojo en CI en vez de dejar la analítica vieja en silencio.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLOWED_EXTERNAL_IMPORTS,
  FINGERPRINT_ENTRIES,
  computeFingerprint,
  computeImportClosure,
  externalPackageName,
  findRepoRoot,
} from './cohort-stats-fingerprint';

const repoRoot = findRepoRoot(__dirname);

describe('cierre de imports del read-model de cohorte', () => {
  const closure = computeImportClosure(repoRoot);

  it('incluye los tres archivos que determinan los números', () => {
    for (const entry of FINGERPRINT_ENTRIES) {
      expect(closure.files).toContain(entry);
    }
  });

  it('arrastra la persistencia y el esquema de las tablas del read-model', () => {
    // No son "entries" pero SÍ influyen: si cambia la definición de las columnas o el
    // wrapper de contexto de org, el read-model escrito cambia.
    expect(closure.files).toContain('packages/db/src/schema/results.ts');
    expect(closure.files).toContain('packages/db/src/with-org-context.ts');
    expect(closure.files).toContain('packages/db/src/client.ts');
  });

  it('no encuentra ningún import externo fuera de la allowlist', () => {
    const paquetes = [...new Set(closure.externals.map(externalPackageName))].sort();
    const inesperados = paquetes.filter((p) => !ALLOWED_EXTERNAL_IMPORTS.includes(p));
    expect(inesperados).toEqual([]);
  });

  it('todos los archivos del cierre existen y son legibles', () => {
    for (const file of closure.files) {
      expect(() => readFileSync(join(repoRoot, file), 'utf-8')).not.toThrow();
    }
  });
});

describe('computeFingerprint', () => {
  it('es determinista: dos corridas sobre el mismo árbol dan la misma huella', () => {
    expect(computeFingerprint(repoRoot).hash).toBe(computeFingerprint(repoRoot).hash);
  });

  it('CAMBIA si cambia el contenido de un archivo del cierre', () => {
    const real = computeFingerprint(repoRoot);
    const objetivo = join(repoRoot, 'packages/types/src/utils/item-stats-calculator.ts');
    const alterado = computeFingerprint(repoRoot, FINGERPRINT_ENTRIES, (p) =>
      p === objetivo
        ? `${readFileSync(p, 'utf-8')}\n// cambio de semántica simulado`
        : readFileSync(p, 'utf-8'),
    );
    expect(alterado.hash).not.toBe(real.hash);
  });

  it('CAMBIA si cambia un archivo del cierre que no es entry (p. ej. el esquema)', () => {
    const real = computeFingerprint(repoRoot);
    const objetivo = join(repoRoot, 'packages/db/src/schema/results.ts');
    const alterado = computeFingerprint(repoRoot, FINGERPRINT_ENTRIES, (p) =>
      p === objetivo ? `${readFileSync(p, 'utf-8')}\n// columna nueva` : readFileSync(p, 'utf-8'),
    );
    expect(alterado.hash).not.toBe(real.hash);
  });

  it('NO cambia si cambia un archivo ajeno al cierre', () => {
    const real = computeFingerprint(repoRoot);
    const ajeno = join(repoRoot, 'packages/db/src/migrate.ts');
    expect(real.files).not.toContain('packages/db/src/migrate.ts');
    const alterado = computeFingerprint(repoRoot, FINGERPRINT_ENTRIES, (p) =>
      p === ajeno ? '// archivo totalmente distinto' : readFileSync(p, 'utf-8'),
    );
    expect(alterado.hash).toBe(real.hash);
  });

  it('la huella depende del PATH, no sólo del contenido (un rename la mueve)', () => {
    const a = computeFingerprint(repoRoot, ['packages/types/src/utils/item-stats-calculator.ts']);
    const b = computeFingerprint(repoRoot, ['packages/db/src/lib/concurrency.ts']);
    expect(a.hash).not.toBe(b.hash);
  });

  it('falla ruidosamente si un entry ya no existe', () => {
    expect(() => computeFingerprint(repoRoot, ['packages/db/src/no-existe.ts'])).toThrow(
      /archivo inexistente/,
    );
  });
});
