import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

type AllowedException = { file: string; reason: string };

type Offense = { file: string; line: number; pattern: string; text: string };

const SOURCE_ROOT = join(__dirname, '..', '..');

const ALLOWLIST: AllowedException[] = [
  {
    file: 'official-reports/lib/sex-comparison.ts',
    reason: 'estadístico del t de Welch sobre el % de cada alumno',
  },
];

const ANTI_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'avg() sobre un porcentaje', regex: /\bavg\s*\(\s*(?:\$\{)?[^)]*?percentage/gi },
  { name: 'promedio ponderado de porcentajes', regex: /\b(?:pctSum|pctWeight|pctCount)\b/g },
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(path);
    }
  }
  return files;
}

function toRelative(path: string): string {
  return relative(SOURCE_ROOT, path).split(sep).join('/');
}

function blankComments(source: string): string {
  return source
    .split('\n')
    .map((line) => (/^\s*(?:\/\/|\/\*|\*)/.test(line) ? '' : line))
    .join('\n');
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function findOffenses(): Offense[] {
  const allowed = new Set(ALLOWLIST.map((entry) => entry.file));
  const offenses: Offense[] = [];
  for (const path of listSourceFiles(SOURCE_ROOT)) {
    const file = toRelative(path);
    if (allowed.has(file)) continue;
    const original = readFileSync(path, 'utf8');
    const code = blankComments(original);
    const lines = original.split('\n');
    for (const { name, regex } of ANTI_PATTERNS) {
      for (const match of code.matchAll(regex)) {
        const line = lineOf(code, match.index ?? 0);
        offenses.push({ file, line, pattern: name, text: (lines[line - 1] ?? '').trim() });
      }
    }
  }
  return offenses;
}

describe('guarda de la fórmula del % de logro de grupo (Σ puntaje ÷ Σ máximo)', () => {
  it('ningún archivo de apps/api/src promedia porcentajes para el logro de un grupo', () => {
    const offenses = findOffenses();
    const report = offenses.map((o) => `${o.file}:${o.line} [${o.pattern}] ${o.text}`).join('\n');
    expect(
      offenses.length === 0
        ? ''
        : `El % de un grupo se calcula como Σ puntaje ÷ Σ máximo (tallies), nunca promediando porcentajes:\n${report}`,
    ).toBe('');
  });

  it('cada excepción de la lista permitida apunta a un archivo existente y explica por qué', () => {
    const existing = new Set(listSourceFiles(SOURCE_ROOT).map(toRelative));
    for (const entry of ALLOWLIST) {
      expect({ file: entry.file, exists: existing.has(entry.file) }).toEqual({
        file: entry.file,
        exists: true,
      });
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});
