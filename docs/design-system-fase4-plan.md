# Fase 4 — Enforcement y limpieza (Design System, `apps/web`)

> Cierra la migración ([`migration-plan`](./design-system-migration-plan.md) Fase 4). F0–F3 completas:
> tokens, primitivas reskineadas, capa `shared/`, y color de escala en ~0. Esta fase hace el trabajo
> **irreversible** (bloquea PRs que reintroduzcan deuda) y borra el código muerto que quedó.

---

## 1. Estado medido (no estimado)

| Ítem | Estado hoy | Implicancia |
|---|---|---|
| ESLint del DS | **No existe.** `apps/web/.eslintrc.json` = solo `next/core-web-vitals` + `next/typescript`. 0-T5 (baseline warning) nunca se hizo. | 4-T1 arranca de cero |
| `eslint-plugin-tailwindcss` | No instalado | No hay regla nativa para "prohibir color de escala" |
| CI | Solo `deploy-backend.yml` + `deploy-frontend.yml`. **Ningún gate** de lint/typecheck en PRs | Un PR roto no se bloquea hoy |
| `packages/ui` | `index.ts` + `lib` + `styles`. **0 importadores** de `@soe/ui` (desconectado en 0-T1) | Muerto → borrable |
| Shim `components/EmptyState.tsx` | Lo importan **8 archivos** (`@/components/EmptyState`) | Migrar los 8 → borrar shim |
| Color de escala | ~0 aplicadas; excepciones: `TagBadge` (categórico), hex de charts, tuplas RGB de jsPDF | El guard debe allowlistear esas excepciones |

---

## 2. 4-T1 · Guard del Design System · **M**

**Objetivo:** que reintroducir una clase de color de escala (`bg-red-500`), un hex, o un `style={}` prohibido **falle el build/PR**.

**Decisión de mecanismo:** un **script guard** (`scripts/check-design-system.mjs`) en vez de reglas ESLint custom.
- *Por qué no ESLint:* no hay `eslint-plugin-tailwindcss`, y "prohibir clases de escala en strings" requiere una regla custom (AST de className) no trivial. El script es determinista, rápido y exacto para lo que se necesita (un gate de PR), sin instalar/plugin-ear.
- *Alternativa (diferible):* si más adelante se quiere feedback en el editor, migrar el guard a una regla ESLint. No es requisito para el gate.

**Qué chequea el guard** (sobre `apps/web/src`, `*.tsx`/`*.ts`):
1. **Clases de color de escala** — regex `(bg|text|border|ring|from|to|via|divide|shadow)-(red|amber|emerald|green|blue|slate|gray|zinc|neutral|stone|violet|yellow|sky|rose|orange|purple|cyan|indigo|teal|lime|pink|fuchsia)-[0-9]{2,3}`.
2. **Hex en className/strings** — `#[0-9a-fA-F]{3,8}` fuera de la allowlist.
3. **Prop `style={`** — fuera de la allowlist.

**Allowlist (excepciones legítimas, F3):**
- Charts: props `fill`/`stroke`, `PERFORMANCE_LEVEL_CHART_COLOR`, `bandChartColor`, `NEUTRAL = '#…'` de `distribution-bar.tsx` (hex para recharts / `style` de dimensión dinámica).
- `report-export-button.tsx` (tuplas RGB de jsPDF — contexto PDF, no CSS).
- `TagBadge.tsx` (paleta **categórica** por tipo de nodo — pendiente de decisión de diseño, ver §5).
- Comentarios/docstrings (el guard ignora líneas que sean comentario, o exige que el match esté dentro de una string de clase).

**Salida:** lista `archivo:línea` de cada violación + exit 1 si hay alguna. Se expone como `pnpm --filter @soe/web lint:ds` (y un `lint:ds` en el root vía turbo si se quiere).

**Aceptación:** con el árbol actual, `pnpm lint:ds` → **verde** (0 violaciones fuera de allowlist). Reintroducir `bg-red-500` en un archivo no-allowlisted → exit 1 con el `archivo:línea`.

---

## 3. 4-T2 · CI gate en PRs · **S**

**Objetivo:** hoy el CI solo despliega; un PR con typecheck/lint roto o con deuda de color pasa. Agregar un gate.

- Nuevo `.github/workflows/ci.yml`, trigger `pull_request` (y push a `dev`/`main`):
  - `pnpm install --frozen-lockfile`
  - `pnpm typecheck` (turbo, todo el monorepo)
  - `pnpm lint` (turbo)
  - `pnpm --filter @soe/web lint:ds` (el guard de 4-T1)
  - (opcional) `pnpm --filter @soe/web build` para atrapar errores de build de Next.
- Cachear pnpm store + `.next/cache` para velocidad.

**Aceptación:** un PR que rompa typecheck/lint o reintroduzca color de escala queda **rojo** y no mergeable (branch protection sugerido, pero eso es config de repo, no de código).

---

## 4. 4-T3 · Borrar código muerto · **S/M**

1. **`packages/ui`** (0 importadores):
   - Borrar `packages/ui/` completo.
   - Quitar `@soe/ui` de `pnpm-workspace.yaml` (si está listado) y de cualquier `package.json` que lo declare como dep/devDep.
   - `pnpm install` para actualizar el lockfile. Verificar `rg "@soe/ui"` → 0.
2. **Shim `components/EmptyState.tsx`** (8 importadores):
   - Migrar los 8 `import { EmptyState } from '@/components/EmptyState'` → `from '@/components/shared'`.
   - Borrar el shim. `rg "@/components/EmptyState'"` → 0.
3. **CSS vars huérfanas / constantes de color muertas** (auditoría):
   - `rg` de cada `--token` de `globals.css` que ya no se referencie en `tailwind.config.ts` ni en clases.
   - Constantes de color legacy que quedaron sin uso tras F3 (p. ej. mapas viejos si algún consumidor los dejó de importar).
   - Borrar solo las confirmadas sin referencia.

**Aceptación:** `rg "@soe/ui"` → 0 · `rg "@/components/EmptyState'"` → 0 · `pnpm build` verde · no quedan `--*` sin referencia (documentar los que se dejan a propósito).

---

## 5. 4-T4 · Cierre de decisiones + infra opcional

**Decisión pendiente — `TagBadge` (paleta categórica):** hoy allowlisteado. Dos caminos (elegir uno):
- **(a) Escala de tokens categórica** (estilo dataviz): definir `--cat-1..6` en `globals.css` para los 6 tipos de nodo, migrar `TagBadge` y sacarlo de la allowlist. Reutilizable para futuras paletas categóricas.
- **(b) Alinear al estilo neutro canónico** de `question-nodes.tsx` (borde + `bg-card`, sin color por categoría). Menos información visual, cero tokens nuevos.
- Recomendación: (a) si el color por tipo aporta lectura; (b) si no. Es decisión de diseño, no mecánica.

**Opcional (no bloqueante):**
- **Tests axe sobre `/styleguide`** (contraste/roles) — smoke de accesibilidad del catálogo.
- **AGENTS.md — modelo de contribución:** cómo agregar un token / variante / componente `shared` (ya hay §5 "cómo agregar una variante"; extender con el flujo `shared/` + "agregar al styleguide" + "correr `lint:ds`").
- **`recharts` con `next/dynamic`** (diferido de 3-Tperf): requiere wrapper client; hacerlo si el peso de bundle de las rutas de charts lo amerita (medir con `next build`).

---

## 6. Orden y riesgos

1. **4-T1** (guard) → primero: define la red de seguridad. Debe pasar verde con el árbol actual (calibrar la allowlist).
2. **4-T3** (borrar muerto) → en paralelo con 4-T1 (independiente): `packages/ui`, shim, css vars.
3. **4-T2** (CI) → después de 4-T1/4-T3, para que el gate arranque ya en verde.
4. **4-T4** → decisiones + opcionales, al final.

| Riesgo | Mitigación |
|---|---|
| El guard tiene falsos positivos (comentarios, TagBadge, charts) | Calibrar allowlist hasta que el árbol actual dé verde antes de meterlo al CI |
| Borrar `packages/ui` rompe un import oculto | `rg "@soe/ui"` = 0 ya confirmado; `pnpm build` tras borrar |
| CI gate bloquea PRs en verde por flakiness de install | `--frozen-lockfile` + cache; el gate corre lo mismo que localmente |
| Migrar los 8 imports del shim rompe algo | Cambio de path idéntico (`EmptyState` mismo export); typecheck lo valida |

---

## 7. Definición de "terminado" (cierre del Design System)

- `pnpm lint:ds` verde y **en el CI** (reintroducir escala/hex/style falla el PR).
- `packages/ui` y el shim `EmptyState` borrados; `rg` de ambos → 0.
- Decisión de `TagBadge` tomada (migrado o allowlisteado a conciencia).
- `/styleguide` refleja el sistema (ya cubierto en F2).

Con esto el look se cambia **solo** editando tokens/variantes (F0–F1), la deuda de color no puede volver (F4), y no queda código muerto.
