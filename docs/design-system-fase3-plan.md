# Fase 3 — Migración de color de escala a tokens (Design System, `apps/web`)

> Continúa [`design-system-migration-plan.md`](./design-system-migration-plan.md) (Fase 3). Fases 0–2
> completas: tokens, reskin de primitivas, y capa `shared/` (FilterBar, StatCard, MetricsGroup,
> PageTabs, hubs). Esta fase elimina la **deuda de color hardcodeado**: las clases de escala Tailwind
> (`bg-red-500`, `text-emerald-600`, `bg-amber-950`, …) se reemplazan por **tokens semánticos**
> theme-aware.

---

## 1. Estado medido (no estimado)

**475 clases de color de escala** en `apps/web/src`. Distribución:

| Zona | Clases | Notas |
|---|---|---|
| `resultados/` | 117 | El más denso; incluye niveles DIA, alertas, heatmap |
| `banco-items/` | 114 | Badges de estado, tags, dificultad |
| `components/` | 88 | `official-reports`, `MetricComparison`, charts |
| `importar/` | 64 | Estados de job, previews, validación |
| `marcos-academicos/` | 24 | |
| `(admin)/` | 18 | |
| `equipo/` · `configuracion/` · `benchmarking/` · `organizacion/` | ~10–12 c/u | |
| `comparar-instrumentos/` | 4 | |

**Patrón clave (define la estrategia):** las clases NO son arbitrarias — se agrupan en **4 familias
semánticas**, casi siempre con su par `dark:` manual (`bg-amber-50` + `dark:bg-amber-950/30`, etc.).
Las 20 clases más frecuentes son todas `amber/emerald/red/blue` en tinte claro + variante oscura.

> **Consecuencia central:** los tokens semánticos ya son theme-aware (resuelven claro/oscuro solos).
> Migrar a tokens **elimina los `dark:` manuales** — ~40% de las 475 clases *desaparecen*, no se
> reescriben. No es un swap 1:1; es colapsar cada par claro/oscuro a un token único.

---

## 2. Principio: mapear a rol semántico, no a otro hue

Cada clase de escala se traduce a **qué significa**, no a "otro color":

| Familia | Clases típicas (claro + dark) | Token destino |
|---|---|---|
| **Feedback / callout** — info | `bg-blue-50 dark:bg-blue-950/30`, `text-blue-700 dark:text-blue-200`, `border-blue-200` | `bg-info/10 text-info` · o el componente `AlertCallout tone="info"` |
| — éxito | `bg-emerald-50`, `text-emerald-700`, `bg-emerald-950`, `text-emerald-400` | `bg-success/10 text-success` · `AlertCallout tone="success"` |
| — advertencia | `bg-amber-50`, `text-amber-800/900`, `bg-amber-950`, `text-amber-200` | `bg-warning/15 text-warning` · `AlertCallout tone="warning"` |
| — error/peligro | `bg-red-50`, `text-red-600/700`, `bg-red-950`, `text-red-400` | `bg-destructive/10 text-destructive` · `AlertCallout tone="danger"` |
| **Estado (badge)** | `bg-green-100 text-green-800`, `bg-yellow-100`, etc. | `<Badge variant="success/warning/info/destructive">` o `<StatusBadge tone=…>` |
| **Nivel de logro DIA** | `red/amber/emerald/blue` como Insuficiente→Avanzado | `--level-*` (Badge `variant="level-*"`) · `performance-level.ts` (ver 3-T0) |
| **Neutrales** | `slate/gray/zinc/neutral-*` | `bg-muted` · `text-muted-foreground` · `border-border` · `text-foreground` |
| **Marca** | `indigo/violet-*` | `bg-primary` · `text-primary` · `bg-accent` |
| **Charts** (`fill`/`stroke`) | hex o escala en `<Cell>`/recharts | **Excepción**: se permite hex vía `PERFORMANCE_LEVEL_CHART_COLOR` (con comentario). No se migra. |

Tokens ya existen todos (`--success/--warning/--info/--destructive` + foreground, `--level-*`,
`--muted/--border/--foreground/--primary/--accent`). **No hay que crear tokens nuevos.** Si aparece
un caso sin token (raro), se evalúa antes de inventar uno.

---

## 3. Sub-tareas (en orden de ejecución)

### 3-T0 · `performance-level.ts` como fuente única de niveles DIA · **M** — *primero*
- **Qué:** el mapa de 4 niveles (Insuficiente→Avanzado) está duplicado con clases de escala en:
  `resultados/mapa-calor/heatmap-table.tsx`, `resultados/informe/report-export-button.tsx`,
  `benchmarking/components/skill-heatmap.tsx`, `benchmarking/components/band-presentation.ts`,
  `components/official-reports/dia-levels.ts`.
- **Cómo:** un solo origen — `resultados/components/performance-level.ts` (o promoverlo a `shared/`):
  - Badges/labels → `Badge variant="level-*"` / clases `bg-level-*` (tokens de 1-T2, ya existen).
  - `PERFORMANCE_LEVEL_CHART_COLOR` (hex) → **único** origen para `fill`/`stroke` de recharts.
  - Eliminar los mapeos locales en los 5 archivos; que importen del único módulo.
- **Aceptación:** `rg "red-500|amber-500|emerald-500|blue-500|red-100|emerald-100" resultados benchmarking components/official-reports` → solo `performance-level.ts` (charts exceptuados con comentario).

### 3-Talert · Consolidar callouts ad-hoc · **M** — *alto retorno*
- **Qué:** los clusters `bg-{amber,emerald,red,blue}-50 + dark:*-950 + text-*` que son avisos/banners
  (el más repetido en el conteo). Ej: el aviso amber de setup, `ALERT_TONE` en `resultados/page.tsx`
  (`border-l-red-500 bg-red-50 …`), banners de estado en `importar/`.
- **Cómo:** reemplazar por `<AlertCallout tone="info|success|warning|danger">` (ya existe) donde sea un
  bloque de aviso; donde sea inline, por `bg-{info|success|warning|destructive}/10 text-…`. Esto colapsa
  cada par claro/oscuro a un token.
- **Aceptación:** `rg "bg-(amber|emerald|red|blue)-50" app/(dashboard)` → 0 (o solo dentro de `AlertCallout`).

### 3-Tperf · Code-split de libs pesadas + shell de export · **S/M** — *independiente*
- **Qué:** 4 archivos importan `xlsx`/`jspdf`/`jspdf-autotable` estáticos; 4 usan `recharts`.
- **Cómo:**
  - `xlsx`/`jspdf` → `await import()` dentro del handler de click (los export buttons).
  - De paso, extraer el **shell** común de los 4 export buttons (`ExportButton` genérico ya existe en
    `resultados/components/export/`) → `shared/ExportButton` con callbacks `onExportExcel/onExportPdf`;
    los 4 variantes pasan sus builders. (Cierra el pendiente de Fase 2 que se difirió aquí.)
  - `recharts` → `next/dynamic({ ssr:false, loading: <Skeleton/> })` para `generational-chart`,
    `progression-chart`, `generational-distribution-chart`.
- **Aceptación:** `rg "^import .*(xlsx|jspdf)" app` → 0 · export a Excel/PDF sigue funcionando (smoke) ·
  `next build` muestra bundle de `resultados`/`informe` reducido.

### 3-Ta11y · Cerrar brechas de accesibilidad · **S**
- **Qué:** `aria-live` = 0 hoy; `transition-all` en 5 archivos.
- **Cómo:** `aria-live="polite"` en los pollers (`material-remedial/components/remedial-poller`,
  `analisis-ia/components/analysis-poller`, `importar/resultados/.../job-status-card`); reemplazar
  `transition-all` por transición específica + `motion-reduce:transition-none`.
- **Aceptación:** `rg "aria-live" app` ≥ 3 · `rg "transition-all" app` → 0.

### 3-T1 … 3-Tn · Sweep por feature · **L** (repartido)
Ya cubiertos los patrones transversales (3-T0/3-Talert), cada feature se barre en orden de riesgo
creciente. Además de tokens, cada PR reubica carpetas de dominio sueltas a `app/(group)/<ruta>/components/`
si aplica (D2 del plan base).

| PR | Feature | Clases | Riesgo |
|---|---|---|---|
| 3-T1 | `equipo` · `configuracion` · `organizacion` | ~34 | bajo |
| 3-T2 | `(admin)` · `comparar-instrumentos` | ~22 | bajo |
| 3-T3 | `marcos-academicos` · `benchmarking` | ~36 | medio |
| 3-T4 | `banco-items` | 114 | medio |
| 3-T5 | `importar` | 64 | medio (estados de job) |
| 3-T6 | `resultados` (excl. informe) | ~90 | alto |
| 3-T7 | `components/official-reports` + `resultados/informe` | resto | **alto** (impresión/PDF) — al final |

- **Aceptación por PR:**
  - `rg "(bg|text|border|ring|from|to|divide)-(red|amber|emerald|green|blue|slate|gray|zinc|neutral|violet|yellow|sky|rose|orange|purple|cyan|indigo|teal)-[0-9]{2,3}" <ruta>` → 0 (charts `fill`/`stroke` exceptuados, con comentario).
  - `pnpm --filter @soe/web typecheck` verde.
  - Smoke visual en claro **y** oscuro (los tokens deben dar paridad; es el chequeo clave).
  - En informes: prueba "Guardar como PDF" (las reglas `@media print` + `print-color-adjust` deben seguir sacando los colores).

---

## 4. Orden y paralelización

1. **3-T0** (niveles) → primero: desbloquea resultados/benchmarking/official-reports.
2. **3-Talert** + **3-Ta11y** + **3-Tperf** → en paralelo (independientes entre sí).
3. **Sweep por feature** (3-T1→3-T7) → paralelizable con **subagentes**, uno por feature, con el mismo
   spec de mapeo (§2). `official-reports`/`informe` va **último y solo** (impresión/PDF, mayor riesgo).

Cada subagente recibe: la tabla de mapeo §2, la ruta asignada, la regla "tokens no hue", el criterio
de aceptación (rg → 0 + typecheck + paridad claro/oscuro), y la excepción de charts.

---

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| Paridad claro/oscuro se rompe al colapsar `dark:` | Revisar cada feature en ambos modos; los tokens ya están calibrados AA (Fase 0) |
| Regresión de impresión/PDF en informes | `official-reports` al final, aislado; smoke "Guardar como PDF"; `print-color-adjust` intacto |
| Migrar un color de chart que debía ser hex | Charts (`fill`/`stroke`) son excepción explícita; no tocarlos |
| Un tono sin token semántico exacto | Raro; evaluar antes de inventar token (no hardcodear "por ahora") |
| Subagentes divergen en el mapeo | Spec §2 idéntico en cada prompt; PR chico por feature; verificación `rg`+typecheck por PR |

---

## 6. Cierre → habilita Fase 4

Al terminar Fase 3 con `rg` de escala ≈ 0 (fuera de charts), la **Fase 4** puede subir la regla ESLint
del DS de *warning* a *error* sin romper el build, y agregar el CI gate. Antes de Fase 3, esa regla no
puede ser bloqueante.
