# Plan de consolidación del Design System + reskin moderno — AcademOS (`apps/web`)

> Basado en [`design-system-audit.md`](./design-system-audit.md) y la resolución **D1
> (2026-07-14): se mantiene shadcn/ui** (se descartó HeroUI, ver Audit §8). Objetivo del
> equipo: **darle al producto un diseño propio más moderno** sin cambiar de librería.
>
> **Idea central:** en esta arquitectura el *look* lo dirigen **tokens + variantes `cva`**.
> Las primitivas de `components/ui` solo referencian tokens semánticos; las features solo
> usan primitivas + clases respaldadas por tokens. Por lo tanto **reestilizar = editar
> tokens y variantes**, no reescribir vistas. Esa es la palanca que hace factible el rediseño.
>
> Convenciones: esfuerzo **S** (<½ día) / **M** (½–2 días) / **L** (>2 días).
> Cada tarea = un PR que deja la app corriendo, con criterio de aceptación verificable.
> Las tareas son autocontenidas: se pueden ejecutar en sesiones separadas de agente.

---

## Principio arquitectónico: el diseño vive en 3 capas de tokens

```
Capa 1 · Referencia (paleta cruda)     --brand-500, --neutral-900, --emerald-600 …
   │                                    (la "marca": editar aquí cambia todo el producto)
   ▼
Capa 2 · Semántica (rol de uso)         --primary, --surface, --muted, --destructive,
   │                                    --success, --warning, --info, --level-* → var(capa 1)
   ▼
Capa 3 · Consumo (Tailwind + cva)       bg-primary, text-muted-foreground, rounded-lg,
                                        shadow-md → hsl(var(--token)) en tailwind.config
```

Reglas invariantes (las verifica el ESLint de Fase 0):
- **`ui/` solo usa tokens semánticos** (capa 2/3). Nunca hex, ni escalas (`bg-blue-500`), ni la capa 1 directa.
- **`shared/` importa solo `ui/` + `lib/`**; una feature nunca importa de otra feature.
- **Prohibido** `style={}` (salvo dimensión/color dinámico de datos en charts, con comentario) y clases de color de escala en className.
- El **reskin moderno** se logra editando capas 1–2 y las variantes `cva` de `ui/`. Ninguna feature debería cambiar por un cambio de marca.

Esto además deja lista (sin implementarla aún) la vía de **theming multi-tenant / white-label**:
overrides por scope (`[data-org] { --brand-500: … }`) apoyados en la capa de referencia.

---

## Fase 0 — Fundaciones de tokens (habilita el rediseño, sin tocar UI existente)

### 0-T1 · Unificar la fuente de verdad de tokens · **S**
- **Qué:** dejar `apps/web/src/app/globals.css` como **único** origen de tokens. Quitar `@soe/ui` del grafo de build: `next.config.ts:11` (`transpilePackages`) y `apps/web/package.json` (dep `@soe/ui`). No borrar aún `packages/ui` (eso es 4-T3), solo desconectarlo.
- **Archivos:** `apps/web/next.config.ts`, `apps/web/package.json`, `apps/web/tailwind.config.ts` (quitar el glob `../../packages/ui/src/**`).
- **Aceptación:** `rg "@soe/ui" apps/web` → 0 · `pnpm --filter @soe/web build` verde · app arranca igual.
- **Riesgo:** que algún import oculto lo use. **Mitigación:** el `rg` de arriba ya lo confirma en 0 (Audit §2.1).

### 0-T2 · Arquitectura de tokens en 3 niveles · **M**
- **Qué:** reestructurar `globals.css` para separar **referencia** y **semántica**, conservando el formato HSL de canales (compatible con `hsl(var(--x))` de `tailwind.config.ts`, y soporta `/opacity`). Ejemplo:
  ```css
  :root {
    /* Capa 1 · Referencia */
    --brand-50: 214 100% 97%;  --brand-500: 221 83% 53%;  --brand-600: 221 83% 45%;
    --neutral-0: 0 0% 100%;    --neutral-900: 222 47% 11%; /* … ramp completo */
    --emerald-600: 142 76% 36%; --amber-500: 38 92% 50%;  --red-500: 0 84% 60%;
    /* Capa 2 · Semántica (apunta a capa 1) */
    --primary: var(--brand-500);        --primary-foreground: var(--neutral-0);
    --surface: var(--neutral-0);        --foreground: var(--neutral-900);
    --success: var(--emerald-600);      --warning: var(--amber-500);  --destructive: var(--red-500);
  }
  .dark { /* re-mapea capa 2 a otros peldaños de capa 1 */ }
  ```
- **Aceptación:** `/styleguide` renderiza idéntico (aún sin cambiar el look) · `pnpm build` verde · toda variable semántica de `tailwind.config.ts` resuelve vía capa 1 (0 valores HSL sueltos en capa 2).
- **Riesgo:** `var()` anidado dentro de `hsl()` — verificar que `hsl(var(--primary))` con `--primary: var(--brand-500)` resuelve en todos los navegadores objetivo (sí lo hace; es CSS estándar). Probar dark mode.

### 0-T3 · Definir el nuevo lenguaje visual moderno (decisión de diseño) · **M/L**
- **Qué:** esta es **la tarea de rediseño**. Ampliar los tokens más allá de color, y **elegir la nueva marca**. Definir en `globals.css` + `tailwind.config.ts`:
  - **Paleta de marca** (capa 1): elegir el nuevo `--brand-*`. *Propuesta de partida* (ajustable): primario más contemporáneo (indigo/violeta 250–260° o azul más saturado), neutros con leve calidez, y acentos. Verificar contraste **AA** en light/dark.
  - **Tipografía:** escala tokenizada con roles (`--text-display/heading/title/body/caption`) tamaño+line-height+tracking; cerrar `text-[10px]/[11px]` con `text-2xs`. Opcional: fuente display moderna (`--font-display`) vía `next/font` — el arquitectura ya lo soporta (`tailwind.config.ts:14` usa `var(--font-inter)`).
  - **Radios:** escala (`--radius-sm/md/lg/xl/full`). Un radio algo mayor (p. ej. base `0.625–0.75rem`) da lectura más moderna. Hoy solo hay uno (`--radius: 0.5rem`).
  - **Elevación:** sistema de sombras suaves en capas (`--shadow-xs/sm/md/lg`) en vez de sombras sueltas.
  - **Motion:** `--duration-fast/base/slow` + `--ease-*`, para transiciones consistentes.
  - **z-index:** escala (`--z-dropdown/sticky/modal/popover/toast`).
  - **Espaciado:** documentar el ritmo (múltiplos de 4) y opcionalmente `--space-*`.
- **Archivos:** `globals.css`, `tailwind.config.ts` (extender `theme.extend` con `boxShadow`, `borderRadius`, `fontSize`, `transitionDuration`, `zIndex`), `app/layout.tsx` (si se añade fuente).
- **Aceptación:** `/styleguide` muestra la nueva paleta + escalas tipográfica/radios/sombras · contraste AA verificado (documentar en el PR) · el cambio de look es visible en `/styleguide` **sin** tocar ninguna feature.
- **Riesgo:** decisión estética subjetiva. **Mitigación:** iterar sobre `/styleguide` (que es aislado); no propagar a features hasta Fase 1/3. Este PR es reversible (solo tokens).

### 0-T4 · `AGENTS.md` con las reglas del DS · **S**
- **Archivos:** `AGENTS.md` (raíz).
- **Contenido:** las 3 capas de tokens y las reglas invariantes de arriba; capas de componente (`ui/` primitivas · `shared/` compuestos · colocación en `app/(group)/<ruta>/components/` para features, D2); prohibiciones (inline `style`, hex, escalas de color); cómo agregar una variante (`cva` en `ui/`, nunca clases sueltas en el call-site); flujo "buscar antes de crear"; cómo reestilizar (editar tokens/variantes, no features).
- **Aceptación:** existe y enlaza a `/styleguide`, al audit y a este plan.

### 0-T5 · ESLint del DS como **warning** · **M**
- **Qué:** `eslint-plugin-tailwindcss` (orden/validez de clases), regla que **prohíbe la prop `style`** (`react/forbid-dom-props`/`forbid-component-props`, salvo allowlist de charts) y regla que **marca clases de color de escala** en className. Todo como **warning** por ahora.
- **Archivos:** `apps/web/.eslintrc.json` (o `eslint.config`).
- **Aceptación:** `pnpm --filter @soe/web lint` corre **sin error** (baseline ≈531 warnings de color + ≈35 de `style`, documentado). Sirve de contador de progreso para Fase 3.

---

## Fase 1 — Reskin de primitivas (aplica el look moderno a `components/ui`)

Reestilizar cada primitiva **vía `cva` + tokens**, mapeando las variantes que HOY existen para que ningún consumidor se rompa. Los 176 consumidores no cambian.

### 1-T1 · `button.tsx` (88 usos) · **M**
- **Qué:** actualizar `buttonVariants` (`components/ui/button.tsx:7`) al nuevo lenguaje: nuevos radios/sombras/motion tokens, estados `hover`/`active`/`focus-visible` refinados. Mantener las 6 variantes (`default/destructive/outline/secondary/ghost/link`) y tamaños (`sm/default/lg/icon`) — mismos nombres, nuevo aspecto. Conservar `asChild` (Radix Slot) tal cual.
- **Aceptación:** `pnpm typecheck` verde sin tocar consumidores · las 6 variantes + 4 tamaños en `/styleguide` con el nuevo look · foco visible AA · `asChild` intacto (72 usos siguen navegando).

### 1-T2 · `card.tsx` (75), `badge.tsx` (44) + variantes `level-*` · **M**
- **Card:** aplicar nueva elevación/radio/borde. **Badge:** añadir variantes semánticas que hoy se hacen a mano (`success/warning/info/destructive`) y las **4 de nivel** (`level-insufficient/elementary/adequate/advanced`) respaldadas por `--level-*` (definidos en 0-T3). Esto habilita reemplazar los `bg-*-100` sueltos por `<Badge variant="level-adequate">`.
- **Aceptación:** variantes en `/styleguide` · 44 consumidores de badge sin cambios de API · existe `variant="level-*"`.

### 1-T3 · Controles de formulario: `input`, `label`, `select` · **M**
- Reskin de `input.tsx` (24), `label.tsx` (17) y `select.tsx` (29, Radix) con tokens: borde/anillo de foco, altura, radio. Mantener API. Decidir en el PR si se adopta el patrón `patterns/Field` de forma consistente.
- **Aceptación:** consumidores intactos · foco/estado de error visibles AA · `/styleguide`.

### 1-T4 · Overlays: `dialog`, `alert-dialog`, `sheet`, `dropdown-menu`, `tooltip`, `popover` · **M**
- Reskin de superficies flotantes: usar `--shadow-lg`, `--radius-lg`, `--z-*`, animaciones con `--duration-*`. Añadir `overscroll-behavior: contain` en modales/drawers (guía UX). Mantener API Radix.
- **Aceptación:** todos abren/cierran con el nuevo look en `/styleguide` · impresión/PDF sin regresión (reglas `@media print` de `globals.css` intactas).

### 1-T5 · `table.tsx` (25) + `Typography` · **S/M**
- **Table:** reskin sutil (zebra/hover/bordes con tokens) + asegurar `tabular-nums` en celdas numéricas. **Typography:** crear primitiva `components/ui/typography.tsx` (o utilidades `text-*` tokenizadas incl. `text-2xs`) para los roles de 0-T3.
- **Aceptación:** tabla en `/styleguide` · existe `text-2xs` · componente/utilidad tipográfica documentada.

> Al cerrar Fase 1, el producto ya se ve moderno en las **primitivas**; las features heredan el
> cambio automáticamente donde usan primitivas, y quedan solo los call-sites con color de escala
> (Fase 3).

---

## Fase 2 — Capa shared (compuestos reutilizables sobre las primitivas)

### 2-T1 · `patterns/` → `shared/` + promover shared escondidos · **M**
- Renombrar `components/patterns/` → `components/shared/` (8 componentes). Mover a `shared/` los compuestos que hoy viven en rutas: `resultados/components/summary-card.tsx` (→ `StatCard`), `export-button.tsx`, `performance-badge.tsx`, `tag-filter-menu.tsx`. Reescribir sobre primitivas ya reskineadas.
- **Aceptación:** `rg "@/components/patterns" apps/web/src` → 0 · `pnpm build` verde.

### 2-T2 · Extraer compuestos duplicados · **L**
- Crear en `shared/` los patrones que la auditoría detectó duplicados (Audit §2.6), extrayendo solo los de **≥3 usos**: `FormDialog` (×4), `FilterBar` (×4), `PendingButton` (×N; usa `disabled`+`Loader2` de forma consistente), `StatCard` (×3). `RowActionMenu` (×2) opcional.
- **Aceptación:** cada uno en `/styleguide` con ≥1 consumidor real migrado · `pnpm typecheck` verde.

---

## Fase 3 — Migración por feature (tokens + limpieza, menor→mayor riesgo)

Ya reskineadas las primitivas, cada PR de feature: reemplaza clases de color de escala por
tokens semánticos / `--level-*`, aplica code-split y fixes de a11y, y (si aplica) reubica dominio.
Orden sugerido: marketing/styleguide → equipo/admin → organización → dashboard/observabilidad →
banco-items → material-remedial/importar → benchmarking/marcos-academicos → resultados →
official-reports (el más denso en color, va al final).

### 3-T0 · `performance-level.ts` como puente único a `--level-*` · **M** (hacer primero)
- Mover a `components/shared/performance-level.ts`; badge/barra vía variantes `level-*` (1-T2); `PERFORMANCE_LEVEL_CHART_COLOR` en hex como **único** origen para recharts. Eliminar los mapeos duplicados en `benchmarking/components/band-presentation.ts`, `resultados/mapa-calor/heatmap-table.tsx`, `resultados/informe/report-export-button.tsx`, `official-reports/dia-levels.ts`.
- **Aceptación:** `rg -l "red-500|amber-500|emerald-500|blue-500" apps/web/src/app apps/web/src/components` → solo `performance-level.ts`.

### 3-Tperf · Code-split de libs de export · **S** (alto retorno, independiente)
- Convertir los imports estáticos de `xlsx`/`jspdf`/`jspdf-autotable` (Audit §5 P1: 4 archivos) a `await import()` dentro del handler de click, o envolver los botones en `next/dynamic({ ssr:false })`.
- **Aceptación:** `rg "^import .*(xlsx|jspdf)" apps/web/src` → 0 (pasan a import dinámico) · export a Excel/PDF sigue funcionando (smoke) · `next build` muestra bundle de `resultados`/`informe` reducido (~800 KB menos).

### 3-Ta11y · Cerrar brechas de accesibilidad · **S/M**
- Añadir `aria-live="polite"` a `material-remedial/components/remedial-poller.tsx` e `importar/resultados/components/job-status-card.tsx` (Audit §6 A5). Añadir guard `motion-reduce:` / `@media (prefers-reduced-motion)` a las animaciones (A1) y sustituir `transition-all` (A2).
- **Aceptación:** `rg "aria-live" apps/web/src` ≥ 2 · `rg "prefers-reduced-motion|motion-reduce" apps/web/src` ≥ 1 · `rg "transition-all" apps/web/src` → 0.

### 3-T1 … 3-Tn · Migración por feature · **L** (repartido en varios PR)
- **Además** de tokens, cada PR reubica la carpeta de dominio suelta que le corresponda a `app/(group)/<ruta>/components/` (D2): `official-reports/`, `import/`, `ai-models/`, `instrument-bands/`, `question-detail/`, `assistant/`, `passage-dialog.tsx`, `feature-gate.tsx`.
- **Aceptación por PR (verificable):**
  - `rg "(bg|text|border|ring)-(red|amber|emerald|green|blue|yellow|slate|gray|purple|violet|rose|orange|cyan)-[0-9]{2,3}" <ruta>` → 0 (charts exceptuados con comentario).
  - `rg "style=\{" <ruta>` → 0 salvo charts (con comentario).
  - `pnpm typecheck` + `next build` verdes · smoke visual + prueba de "Guardar como PDF" en vistas de informe.

---

## Fase 4 — Enforcement y limpieza

- **4-T1 · Reglas ESLint a `error`** (S): pasa solo si Fase 3 dejó ~0 violaciones. `rg` de color de escala global → 0 (fuera de charts).
- **4-T2 · CI gate** (S): nuevo `.github/workflows/ci.yml` con `pnpm lint` + `typecheck` en PRs (hoy CI solo despliega, Audit §1).
- **4-T3 · Borrar muerto** (S): `packages/ui` (D4) y su carpeta; shim `components/EmptyState.tsx`; CSS vars huérfanas; constantes de color muertas.
- **4-T4 · Infra de DS opcional** (M): añadir tests axe sobre `/styleguide` y/o snapshots visuales; documentar el modelo de contribución en `AGENTS.md`.

---

## Decisiones pendientes / diferidas

| # | Tema | Recomendación |
|---|---|---|
| **P-A** | ¿Migrar a **Tailwind v4** (OKLCH, `@theme`)? | **No ahora.** No es necesario para el reskin; Tailwind v3 + la capa de tokens ya lo habilitan. Evaluarlo como proyecto aparte más adelante (mejora tooling de color, no bloquea nada). |
| **P-B** | ¿Fuente **display** propia? | Opcional dentro de 0-T3. La arquitectura ya lo soporta (`--font-*` vía `next/font`). Decisión estética. |
| **P-C** | **Theming multi-tenant / white-label** por establecimiento | La Fase 0 deja la arquitectura lista (overrides `[data-org]` sobre capa de referencia). Implementar solo cuando el producto lo requiera; no incluido en este plan. |
| **P-D** | Paleta de marca exacta | Se resuelve en **0-T3** sobre `/styleguide`. Este plan fija la *arquitectura*; el color final es decisión de diseño iterada ahí. |

---

## Riesgos globales

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| El reskin (0-T3) rompe contraste/legibilidad | media | medio | Verificar AA en `/styleguide` antes de propagar; PR de tokens es reversible |
| `var()` anidado en `hsl()` no resuelve en algún navegador | baja | alto | Es CSS estándar; validar en 0-T2 en navegadores objetivo + dark mode |
| Regresión de impresión/PDF (informes oficiales) al reskinear overlays/superficies | media | medio | Prueba "Guardar como PDF" en cada PR de `resultados`/`official-reports`; reglas `@media print` intactas |
| Migración por feature (Fase 3) muy larga | media | bajo | Está troceada por ruta; cada PR es independiente y verificable; el ESLint-warning mide el avance |
| Extraer un compuesto que no era realmente duplicado | baja | bajo | Solo se extraen los de ≥3 usos; RowActionMenu (×2) queda opcional |
