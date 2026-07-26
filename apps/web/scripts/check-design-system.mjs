// Guard del Design System (Fase 4 / 4-T1).
//
// Falla (exit 1) si aparece una clase de color de ESCALA Tailwind
// (bg-red-500, text-emerald-600, dark:bg-amber-950, …) en el código de
// apps/web/src. El look se controla con TOKENS semánticos (--primary, --success,
// --level-*, muted, …), no con la escala cruda; ver AGENTS.md §4 y
// docs/design-system-migration-plan.md.
//
// Alcance deliberado: SOLO clases de escala. Los hex y `style={}` tienen usos
// legítimos mayoritarios (charts, dimensiones dinámicas) y no se gatean acá;
// siguen prohibidos por convención (AGENTS.md), pero sin CI gate.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const ROOT = dirname(SRC);

const SCALE_RE =
  /(bg|text|border|ring|from|to|via|divide|shadow|fill|stroke|outline|decoration|accent|caret|placeholder)-(red|amber|emerald|green|blue|slate|gray|zinc|neutral|stone|violet|yellow|sky|rose|orange|purple|cyan|indigo|teal|lime|pink|fuchsia)-[0-9]{2,3}/;

// Excepciones legítimas (rutas relativas a apps/web). Justificar cada una.
const ALLOWLIST = [];

function isAllowlisted(relPath) {
  return ALLOWLIST.some((entry) => relPath === entry || relPath.endsWith(entry));
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(full, files);
    } else if (/\.(tsx|ts)$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

const violations = [];

for (const file of walk(SRC)) {
  const relFromWeb = relative(ROOT, file);
  if (isAllowlisted(relFromWeb)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  let inBlockComment = false;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Ignorar comentarios (docstrings mencionan clases legacy como ejemplo).
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith('//')) return;
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      if (trimmed.startsWith('/*') && !trimmed.includes('*/')) inBlockComment = true;
      return;
    }

    const match = SCALE_RE.exec(line);
    if (match) violations.push(`${relFromWeb}:${i + 1}: ${match[0]}`);
  });
}

if (violations.length > 0) {
  console.error(
    `\n✖ Design System guard: ${violations.length} clase(s) de color de escala encontradas.\n` +
      `  Usá tokens semánticos (bg-primary, text-success, bg-level-*, text-muted-foreground, …).\n` +
      `  Ver AGENTS.md §4.\n`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error('');
  process.exit(1);
}

console.log('✔ Design System guard: sin clases de color de escala.');
