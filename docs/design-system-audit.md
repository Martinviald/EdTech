# Auditoría del Design System — AcademOS (`apps/web`)

> Fecha: 2026-07-14 · Alcance: `apps/web/src` (Next.js 15 / React 19 / Tailwind v3).
> Este documento **solo describe** el estado actual + una **evaluación** (rendimiento,
> accesibilidad, factibilidad del plan). El plan de acción vive en
> [`design-system-migration-plan.md`](./design-system-migration-plan.md).

> **Actualización 2026-07-14 (revisión con `/react-best-practices` + `/web-design-guidelines`).**
> Se re-verificaron todas las métricas contra el código y se añadieron cuatro secciones:
> **§5 rendimiento**, **§6 accesibilidad/UX**, **§7 arquitectura de tokens y brechas SaaS**,
> y **§8 factibilidad del plan (D1 → HeroUI)**. Dos conclusiones nuevas de alto impacto:
> 1. Las clases de color de escala son **~531** (medidas), no 483 — el problema es **mayor**.
> 2. El plan de migración describe **HeroUI v2** (plugin + provider + framer-motion), pero la
>    versión vigente (jul-2026) es **HeroUI v3**, una reescritura sobre **Tailwind v4** con API
>    incompatible. Esto **cambió D1** → ver §8. **Decidido (2026-07-14): se mantiene shadcn** y se
>    ejecuta *consolidación + reskin por tokens* para lograr un **diseño propio más moderno** sin
>    cambiar de librería (ya arregla el 100 % de los bloqueantes).

---

## Resumen ejecutivo (5 líneas)

1. Las **fundaciones ya existen**: shadcn/ui configurado (`components.json`), `cva` + `clsx` + `tailwind-merge`, 17 primitivas en `components/ui`, tokens semánticos HSL en `globals.css`, una capa "shared" de facto en `components/patterns/` y `components/layout/`, y hasta un `/styleguide`. Esto **no es un greenfield** sino una **adopción incompleta**.
2. El problema central es la **fuente de verdad de color duplicada y evadida**: hay dos `globals.css` con paletas divergentes, y **~531 clases de color de escala Tailwind** (`bg-amber-100`, `text-emerald-700`…, medidas con `rg -o`) que saltan los tokens semánticos.
3. El concepto de dominio más repetido — los **4 niveles de logro** (insuficiente/elemental/adecuado/avanzado) — **no tiene token semántico**; se re-implementa con escalas de color en ≥5 archivos.
4. `packages/ui` está **muerto** (nadie importa su `cn` ni su CSS) y define un segundo `cn()` y una paleta zinc por defecto que contradice la real.
5. **No hay enforcement**: ESLint es el default de Next (sin `eslint-plugin-tailwindcss` ni prohibición de `style`), y CI solo despliega (no corre lint/typecheck). Nada impide la regresión.

---

## 1. Inventario del stack

| Área | Estado |
|---|---|
| Monorepo | pnpm workspaces + Turborepo. Apps: `apps/web`, `apps/api`. Packages: `db`, `types`, `ui`. |
| Framework | **Next.js `^15.1.3`** (App Router, RSC). |
| React | **`^19.0.0`**. |
| Tailwind | **v3.4.17** → config en `apps/web/tailwind.config.ts` (`darkMode: 'class'`, tokens vía `hsl(var(--x))`). **No** es v4. |
| shadcn/ui | **Sí** — `apps/web/components.json` (style `default`, baseColor `zinc`, `cssVariables: true`, aliases `@/components`, `@/lib/utils`, `@/components/ui`). |
| Radix | alert-dialog, avatar, dialog, dropdown-menu, label, select, slot, tooltip. |
| Variantes | `class-variance-authority ^0.7.1`. |
| Utilidad de clases | `clsx ^2.1.1` + `tailwind-merge ^2.6.1` → `cn()`. |
| Otras soluciones de estilo | **Ninguna** conviviendo (no styled-components / emotion / CSS modules). Solo Tailwind + un `globals.css`. |
| Charts | **Recharts `^3.8.1`** + tooltips custom (`components/ui/chart-tooltip.tsx`). |
| Librerías de componentes pesadas (MUI/Chakra) | **Ninguna**. |
| Otros UI | `lucide-react` (íconos), `sonner` (toasts), `next-themes` (dark mode), `react-dropzone`, `react-markdown`+`remark-gfm`, `jspdf`/`xlsx` (export). |
| ESLint | `apps/web/.eslintrc.json` → solo `next/core-web-vitals` + `next/typescript`. |
| Prettier | `.prettierrc` en raíz. |
| TS paths | `apps/web/tsconfig.json` → `@/* → ./src/*` (único alias). |
| CI | `.github/workflows/deploy-frontend.yml` + `deploy-backend.yml`. **No hay** workflow de lint/test/typecheck. |

### 1.1 Fuente de verdad de tokens (hallazgo bloqueante)

Existen **dos** `globals.css` con paletas **distintas**:

- `apps/web/src/app/globals.css` — **la activa** (importada por `app/layout.tsx:5`). Paleta rica: `--primary: 221.2 83.2% 53.3%` (azul) + `success`/`warning`/`info`/`accent`.
- `packages/ui/src/styles/globals.css` — paleta **zinc por defecto de shadcn** (`--primary: 222.2 47.4% 11.2%`, casi negro; sin success/warning/info). **Nadie la importa** (`rg "ui/styles/globals"` → 0 hits).

Además hay **dos definiciones de `cn()`** idénticas: `apps/web/src/lib/utils.ts` (usada por 56 archivos) y `packages/ui/src/lib/utils.ts` (nadie la importa). `packages/ui` aparece en `next.config.ts:11` (`transpilePackages`) pero es un no-op porque no se consume.

---

## 2. Inventario de estilos y componentes

### 2.1 Métricas (medidas con ripgrep sobre `apps/web/src`)

| Métrica | Valor |
|---|---|
| Archivos `.ts`/`.tsx` | **341** |
| Usos de `style={…}` inline | **35** (concentrados en charts) |
| Colores **hex** únicos hardcodeados | **5** (`#ef4444`, `#10b981`, `#f59e0b`, `#3b82f6`, `#94a3b8`) en **4 archivos** |
| `rgb/rgba/hsl` literales | 11 |
| Clases de color **escala Tailwind** (`bg/text/border-<familia>-<shade>`) | **~531** (medido con `rg -o`; la cifra 483 previa era una subestimación) |
| Valores arbitrarios `[...]` no-color (spacing/tamaño) | 277 |
| Primitivas en `components/ui` | 17 |
| Capa "shared" de facto (`components/patterns`) | 8 |
| Capa layout (`components/layout`) | 10 |

### 2.2 Estilos inline (`style={…}`) — top archivos

Total 35, dominado por gráficos (donde el `fill`/`width` dinámico es **legítimo**):

| Archivo | usos |
|---|---|
| `components/official-reports/report-charts.tsx` | 10 |
| `components/instrument-bands/bands-form.tsx` | 5 |
| `components/ui/chart-tooltip.tsx` | 3 |
| `app/(dashboard)/resultados/components/distribution-bar.tsx` | 3 |
| `app/(dashboard)/resultados/components/question-detail-panel.tsx` | 2 |
| `app/(dashboard)/observabilidad-ia/components/cost-timeseries.tsx` | 2 |
| (resto: 1 c/u) | badge/assistant/informe/skills/budget-bar/TreeView/network-table/band-comparison |

**Lectura:** la mayoría es dimensión/color dinámico de datos → aceptable. Los candidatos a limpiar son los pocos usos con valores **estáticos** que podrían ser clases.

### 2.3 Colores hardcodeados

- **Hex**: muy limpio. Los 5 valores viven en `app/(dashboard)/resultados/components/performance-level.ts:54-57` (`PERFORMANCE_LEVEL_CHART_COLOR`, requeridos por recharts que no acepta clases) más `#94a3b8` (gris neutro fallback, `performance-level.ts:107`). No hay `bg-[#...]` arbitrarios (0).
- **El verdadero problema son las ~531 clases de escala** (evaden los tokens; el desglose por familia abajo es la muestra clasificada, no el total exacto):

| Familia | Ocurrencias | Intención semántica inferida |
|---|---|---|
| amber | 138 | Warning / nivel "Elemental" / rango medio |
| emerald | 122 | Success / nivel "Adecuado" / respuesta correcta |
| red | 75 | Error / destructive / nivel "Insuficiente" |
| blue | 58 | Info / nivel "Avanzado" / detalle |
| gray | 24 | Muted / neutro |
| green | 21 | **Publicado/Aprobado** (concepto de éxito distinto a emerald) |
| yellow | 17 | Borrador/Pendiente/confianza media |
| purple/violet/slate/rose/orange/cyan | 27 | acentos varios |

**Duplicación semántica (inconsistencia real):** "éxito" se expresa como **emerald** (nivel adecuado, import success) **y** como **green** (publicado/aprobado). Ejemplos concretos:
- `app/(dashboard)/resultados/components/performance-level.ts:34` → `adequate: bg-emerald-100`
- `app/(dashboard)/banco-items/[instrumentId]/ItemsTable.tsx:35` → `published: bg-green-100`
- `app/(dashboard)/banco-items/[instrumentId]/ItemEditProposals.tsx:29` → `approved: bg-green-100`
- `app/(admin)/admin/instrumentos/page.tsx:39` → `published: bg-green-100`

**Escala de niveles de logro (el patrón más repetido):** centralizado en
`app/(dashboard)/resultados/components/performance-level.ts` (H6.4), con la ironía de que su docstring dice *"Colores via tokens Tailwind (NO hardcodeados)"* pero usa **escalas** (`bg-red-100`), no tokens semánticos:

```
insufficient → red-500     elementary → amber-500
adequate     → emerald-500 advanced   → blue-500
```

Ese mapeo está **duplicado** (no reutilizado) en:
- `app/(dashboard)/benchmarking/components/band-presentation.ts:29-45`
- `app/(dashboard)/resultados/mapa-calor/heatmap-table.tsx:30-34`
- `app/(dashboard)/resultados/informe/report-export-button.tsx:40-50` (como RGB)
- `components/official-reports/dia-levels.ts:28-32` (mapeo al DIA oficial I/II/III)

→ **No existe token `--level-*`**. Crear esos 4 tokens y hacer que `performance-level.ts` sea el único puente es la corrección de mayor apalancamiento.

### 2.4 Tipografía ad hoc

- Micro-tamaños arbitrarios: **`text-[10px]` ×30** y **`text-[11px]` ×9** (39 total). Son etiquetas/metadatos de tablas y charts; deberían ser un token/utilidad (`text-2xs`) en vez de repetirse.
- El resto de la tipografía usa la escala estándar de Tailwind (`text-sm/base/xl…`), documentada en `/styleguide`. Sin combinaciones `text-* font-* leading-*` masivamente repetidas fuera de lo anterior.

### 2.5 Spacing / radios / sombras arbitrarios

277 valores `[...]` no-color. Predominan **anchos de columna de tabla** (`w-[80px]`, `w-[200px]`, `min-w-[160px]`…) que son razonables y difíciles de tokenizar. No hay abuso de `rounded-[…]` ni `shadow-[…]`. **Severidad: cosmética.**

### 2.6 Componentes duplicados / casi-duplicados

| Grupo | Archivos | Veredicto |
|---|---|---|
| **`globals.css` / paleta** | `apps/web/src/app/globals.css` vs `packages/ui/src/styles/globals.css` | **Bloqueante** — paletas divergentes, la de `packages/ui` muerta. |
| **`cn()`** | `apps/web/src/lib/utils.ts` vs `packages/ui/src/lib/utils.ts` | Deuda — segunda copia muerta. |
| **EmptyState** | `components/EmptyState.tsx` (shim `@deprecated`) → `components/patterns/EmptyState.tsx` | Cosmético — ya manejado como re-export; borrar el shim al final. |
| **Colores de banda de nivel** | `performance-level.ts`, `benchmarking/.../band-presentation.ts`, `mapa-calor/heatmap-table.tsx`, `informe/report-export-button.tsx`, `official-reports/dia-levels.ts` | Deuda — mismo mapeo copiado 5×. |
| **Diálogos-formulario** | `equipo/AddMemberDialog.tsx`, `admin/equipo/AddAdminDialog.tsx`, `organizacion/asignaciones/CreateAssignmentDialog.tsx`, `admin/colegios/CreateOrgDialog.tsx` | Deuda — mismo patrón Dialog+form+`useTransition`+toast. |
| **Filter bars** | `resultados/components/dashboard-filter-bar.tsx`, `banco-items/InstrumentFilters.tsx`, `material-remedial/components/remedial-filters.tsx`, `resultados/components/performance-level-filter.tsx` | Deuda — Select(s) + `useRouter`/`useSearchParams`. |
| **Botón "pending"** | Muchos diálogos: `Loader2 animate-spin` + disabled + cambio de label (AddMemberDialog, AddAdminDialog, CreateAssignmentDialog, CreateOrgDialog, GenerateButton…) | Deuda — extraer `<PendingButton>`. |
| **Metric/stat cards** | `resultados/components/summary-card.tsx`, `observabilidad-ia/components/summary-cards.tsx`, `analisis-ia/components/item-cards.tsx` | Deuda — consolidar en un `StatCard` shared. |
| **Export buttons** | `resultados/components/export/export-button.tsx` (marcado "genérico"), `analisis-ia/components/ai-export-button.tsx`, `resultados/components/charts/export-view-button.tsx` | Deuda menor — unificar utilidades de formato. |
| **Wizards** | `banco-items/.../spec-table/SpecTableWizard.tsx`, `organizacion/configurar/SetupWizard.tsx`, `importar/instrumento/DiaImportWizard.tsx` | Deuda — existe `patterns/Stepper` (indicador) pero no un contenedor de pasos. |
| **Row-action dropdown** | `equipo/MembersTable.tsx`, `organizacion/asignaciones/AssignmentsTable.tsx` | Deuda menor — extraer `RowActionMenu`. |
| **Markdown** | `assistant/markdown.tsx` vs `passage-dialog.tsx` | Aceptable — diferencias intencionales (chat vs lectura). |

### 2.7 Clasificación por capa (objetivo)

**Primitivas de UI puras — `components/ui/` (17, ya correctas):** `alert-dialog`, `api-error`, `avatar`, `badge`, `button`, `card`, `chart-tooltip`, `dialog`, `dropdown-menu`, `input`, `label`, `select`, `sheet`, `skeleton`, `sonner`, `table`, `tooltip`.

**Shared (reutilizable con lógica) — ya en `components/patterns/` (8):** `PageContainer`, `PageHeader`, `StatusBadge`, `AlertCallout`, `Field`, `Stepper`, `EmptyState`, `MetricComparison`. **Candidatos a promover a shared** (hoy escondidos en rutas): `resultados/components/summary-card.tsx`, `resultados/components/export/export-button.tsx`, `resultados/components/performance-badge.tsx`, `resultados/components/tag-filter-menu.tsx`, y el patrón `PendingButton`/`RowActionMenu`/`FormDialog` (aún inexistentes).

**Layout — `components/layout/` (10, ya correctas):** `Sidebar`, `SidebarNav`, `MobileSidebar`, `Topbar`, `UserNav`, `OrgSwitcher`, `RoleSwitcher`, `ThemeToggle`, `SkipLink`, `nav-items.ts`.

**Feature (específicos de dominio):** dos ubicaciones distintas hoy:
- **Colocados en ruta** `app/(dashboard|admin)/<ruta>/components/` (69 archivos) — idiomático de App Router. ✅
- **Mezclados en `components/` global** (deuda de ubicación): `official-reports/` (7), `instruments/`, `import/`, `ai-models/`, `instrument-bands/`, `assistant/` (11), `question-detail/`, `feature-gate.tsx`, `passage-dialog.tsx`. Estos son de dominio y no deberían estar junto a lo global-compartido.

### 2.8 Estructura de carpetas actual (real) e inconsistencias

```
apps/web/src/
├── app/                      # App Router
│   ├── (admin)/ (dashboard)/ (marketing)/   # route groups
│   │   └── <ruta>/
│   │       ├── page.tsx
│   │       └── components/   # ← feature components colocados (69) ✅ patrón OK
│   ├── api/                  # route handlers
│   ├── styleguide/page.tsx   # referencia visual del DS ✅
│   └── globals.css           # ← tokens ACTIVOS (fuente de verdad real)
├── components/
│   ├── ui/                   # 17 primitivas shadcn ✅
│   ├── patterns/             # 8 "shared" de facto (nombre no estándar) ⚠️
│   ├── layout/               # 10 shell/nav ✅
│   ├── assistant/ official-reports/ instruments/ import/
│   │   ai-models/ instrument-bands/ question-detail/   # ← dominio en carpeta global ⚠️
│   ├── marketing/            # secciones landing
│   ├── EmptyState.tsx        # ← shim @deprecated ⚠️
│   ├── feature-gate.tsx  passage-dialog.tsx   # ← dominio suelto ⚠️
├── hooks/  lib/  types/
└── (packages/ui/  ← MUERTO: cn() y globals.css sin consumidores) 🔴
```

**Inconsistencias señaladas:**
1. 🔴 Dos fuentes de token (`app/globals.css` viva vs `packages/ui` zinc muerta) y dos `cn()`.
2. ⚠️ La capa "shared" se llama `patterns/` (no `shared/`) y componentes claramente shared viven dentro de rutas (`summary-card`, `export-button`, `performance-badge`, `tag-filter-menu`).
3. ⚠️ Carpetas de **feature/dominio** (`official-reports`, `import`, `ai-models`, `instrument-bands`, `assistant`, `question-detail`) mezcladas en `components/` global en vez de colocarse con su ruta o en `features/`.
4. ⚠️ El concepto de nivel de logro (H6.4) es un `const`+funciones en `resultados/components/`; es transversal (lo usan informe, benchmarking, mapa-calor, official-reports) → debería ser shared/lib, no de una ruta.

---

## 3. Tabla de hallazgos por severidad

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| H1 | Dos `globals.css` con paletas divergentes; la de `packages/ui` (zinc default) está muerta | `apps/web/src/app/globals.css` vs `packages/ui/src/styles/globals.css` | 🔴 Bloqueante |
| H2 | No existe token semántico para los 4 niveles de logro; se re-implementan con escalas en ≥5 archivos | `performance-level.ts`, `band-presentation.ts`, `heatmap-table.tsx`, `report-export-button.tsx`, `dia-levels.ts` | 🔴 Bloqueante |
| H3 | ~531 clases de escala de color evaden los tokens; "éxito" ambiguo (emerald vs green) | ver §2.3 | 🔴 Bloqueante |
| H4 | Sin enforcement: ESLint default de Next, sin plugin tailwind ni prohibición de `style`; CI sin lint/typecheck | `.eslintrc.json`, `.github/workflows/*` | 🔴 Bloqueante |
| H5 | `packages/ui` muerto (segundo `cn()`, `transpilePackages` no-op) | `packages/ui/src/*`, `next.config.ts:11` | 🟠 Deuda |
| H6 | Patrones compuestos duplicados: FormDialog×4, FilterBar×4, PendingButton×N, StatCard×3, Wizard×3, RowActionMenu×2 | ver §2.6 | 🟠 Deuda |
| H7 | Componentes de dominio mezclados en `components/` global | `official-reports/`, `import/`, `ai-models/`, `instrument-bands/`, `assistant/`, `question-detail/` | 🟠 Deuda |
| H8 | Colores de banda duplicados en 5 archivos | ver H2 | 🟠 Deuda |
| H9 | Capa shared nombrada `patterns/` y componentes shared escondidos en rutas | `resultados/components/{summary-card,export-button,performance-badge,tag-filter-menu}` | 🟠 Deuda |
| H10 | Micro-tipografía arbitraria (`text-[10px]`×30, `text-[11px]`×9) | ver §2.4 | 🟡 Cosmético |
| H11 | 35 `style={}` inline (mayoría charts legítimos; revisar los estáticos) | ver §2.2 | 🟡 Cosmético |
| H12 | Shim `EmptyState.tsx` `@deprecated` aún presente | `components/EmptyState.tsx` | 🟡 Cosmético |
| H13 | Libs de export pesadas (`xlsx` ~430 KB, `jspdf`+autotable ~380 KB) importadas estáticamente en 4 client components → entran al bundle inicial de `resultados`/`informe` aunque no se exporte | §5 P1 | 🟠 Deuda |
| H14 | Animaciones sin `prefers-reduced-motion` (0 usos) y `aria-live` ausente (0) para polling/jobs | §6 A1/A5 | 🟠 Deuda (a11y) |
| H15 | El sistema de tokens cubre **solo color + 1 radio**; faltan capas (referencia, tipografía, spacing, elevación, z-index, motion) y theming multi-tenant — insuficiente para un DS SaaS | §7 | 🟠 Deuda |
| H16 | El plan D1→HeroUI apunta a la arquitectura **v2** (obsoleta: plugin+provider+framer-motion); la versión vigente **v3** exige **Tailwind v4** y otra API. Ningún bloqueante (H1-H4) se resuelve migrando de librería | §8 | 🔴 Bloqueante (decisión) |

---

## 4. Los 10 archivos que más urgente necesitan refactor

Priorizados por concentración de color + apalancamiento (un fix arriba propaga hacia abajo):

| # | Archivo | Motivo |
|---|---|---|
| 1 | `app/(dashboard)/resultados/components/performance-level.ts` | 13 clases de escala. **Máximo apalancamiento**: convertirlo en el puente a tokens `--level-*` arregla a todos sus consumidores. |
| 2 | `app/(dashboard)/resultados/informe/report-body.tsx` | ~19-21 clases de escala; el peor call-site. |
| 3 | `components/import/student-import-flow.tsx` | 13 clases; variantes success/info/warning hechas a mano. |
| 4 | `app/(dashboard)/resultados/informe/report-export-button.tsx` | 8; duplica los colores de banda como RGB. |
| 5 | `app/(dashboard)/benchmarking/components/band-presentation.ts` | 8; duplica el mapeo de niveles. |
| 6 | `app/(dashboard)/resultados/detalle/cross-table.tsx` | 8; rangos de color por tasa de respuesta. |
| 7 | `app/(dashboard)/banco-items/[instrumentId]/spec-table/SpecTableWizard.tsx` | 8; colores + patrón wizard duplicado. |
| 8 | `app/(dashboard)/resultados/components/question-detail-panel.tsx` | 7; incluye `style={}` inline. |
| 9 | `components/official-reports/student-report.tsx` | 6; marca de correcto/incorrecto e "requiere apoyo". |
| 10 | `app/(dashboard)/observabilidad-ia/components/budget-bar.tsx` | 6 + `style={}`; semáforo de presupuesto (red/amber/green). |

---

## 5. Evaluación de rendimiento (`/react-best-practices`)

> Añadido 2026-07-14. La auditoría original no cubría rendimiento. Medido sobre
> `apps/web/src` (Next 15 App Router). Postura general **sana**; el problema real es
> de **bundle** en las rutas de export, no de re-render.

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| **P1** | **Libs de export pesadas importadas estáticamente en client components.** `xlsx` (~430 KB) y `jspdf`+`jspdf-autotable` (~380 KB) están en el top-level de 4 botones → entran al bundle de la ruta aunque el usuario nunca exporte. **El fix de mayor retorno de esta sección.** | `resultados/components/export/export-button.tsx:15-17` · `resultados/informe/report-export-button.tsx:19-21` · `resultados/components/charts/export-view-button.tsx:9-10` · `analisis-ia/components/ai-export-button.tsx:15` | 🟠 Deuda |
| **P2** | **Solo 1 `dynamic import`/`await import()` en toda la app** (`assistant/assistant-panel.tsx`). Ninguna lib pesada se carga bajo demanda. | `rg "next/dynamic\|await import" → 1` | 🟠 Deuda |
| **P3** | **`lucide-react` como barrel import en ~160 archivos.** Riesgo clásico de bundle. **Matiz importante:** Next 15 **auto-optimiza** `lucide-react` vía su lista interna de `optimizePackageImports`, así que probablemente ya está mitigado — pero conviene declararlo explícito en `next.config.ts` y medir con `next build`. | ~160 archivos; `next.config.ts` sin `experimental.optimizePackageImports` | 🟡 Cosmético |
| **P4** | **`recharts` (~100 KB+) estático en 3 charts cliente sin code-split.** Aceptable si esas vistas son "pesadas por diseño"; medir. | `resultados/components/charts/{generational-distribution,progression,generational}-chart.tsx` | 🟡 Cosmético |
| **P5** | **Waterfalls de datos** en varias `page.tsx`: `auth → feature-check → apiGet` secuenciales. Parte es inherente (auth debe preceder), pero hay `apiGet` encadenables. | `comparar-instrumentos/page.tsx:17-27` · `benchmarking/page.tsx:57-145` · `material-remedial/[id]/page.tsx:47-153` | 🟡 Cosmético |
| **P6** | Re-render: `useMemo`×40, `useCallback`×80, `React.memo`×0. Conciencia razonable; sin componentes memoizados (oportunidad puntual en tablas grandes). | `rg` | 🟡 Cosmético |

**Mitigación P1/P2 (barata, alto impacto):** mover el import dentro del handler de click
(`const XLSX = await import('xlsx'); const { jsPDF } = await import('jspdf');`) o envolver el
botón en `next/dynamic({ ssr: false })`. Saca ~800 KB del bundle inicial de las rutas de
resultados/informe sin cambiar UX. **Independiente de shadcn vs HeroUI.**

---

## 6. Evaluación de accesibilidad / UX (`/web-design-guidelines`)

> Añadido 2026-07-14. Postura general **buena** — la mayor parte del mérito es de **Radix**
> (teclado, foco, `aria-*` gratis en las primitivas). Positivos confirmados: **0** `<div onClick>`
> (todo semántico), `outline-none` siempre pareado con `focus-visible:ring-*` (correcto),
> `tabular-nums` en ~60 usos, botones icon-only etiquetados, sin `<img>` sin optimizar.

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| **A1** | **Animaciones no respetan `prefers-reduced-motion`** (0 usos) pese a `tailwindcss-animate`, `transition-colors` y `scroll-behavior: smooth`. | `rg prefers-reduced-motion → 0`; `globals.css:69` | 🟠 Deuda |
| **A5** | **Sin regiones `aria-live`** (0) para actualizaciones asíncronas: polling de material remedial y estado de jobs de import cambian en silencio para lectores de pantalla. | `material-remedial/components/remedial-poller.tsx` · `importar/resultados/components/job-status-card.tsx` | 🟠 Deuda |
| **A2** | `transition-all` en ~6 lugares (la guía pide animar solo `transform`/`opacity`). | `rg transition-all` | 🟡 Cosmético |
| **A3** | Micro-tipografía `text-[10px]/[11px]` puede caer bajo el mínimo legible en densidad alta; tokenizar como `text-2xs` y revisar contraste. | §2.4 | 🟡 Cosmético |

> **Nota clave para D1:** esta buena postura de a11y **la aporta Radix**. Migrar a **React Aria**
> (base de HeroUI) mantiene el nivel pero obliga a **re-verificar los 176 consumidores** por
> diferencias de foco/teclado/aria — un costo de a11y que el plan actual **no** contabiliza.

---

## 7. Arquitectura de tokens y brechas para un DS SaaS escalable

> El objetivo declarado es "un sistema escalable para un SaaS". Hoy los tokens cubren **solo
> color + un radio** (`globals.css:6-33`). Para escalar (multi-establecimiento, densidad,
> potencial white-label por organización — habitual en EdTech) faltan capas:

| Brecha | Estado actual | Objetivo |
|---|---|---|
| **Jerarquía de tokens** | 1 nivel: semántico → HSL directo en `:root`. | 3 niveles: **referencia** (`--blue-600`) → **semántico** (`--primary: var(--blue-600)`) → componente. Sin la capa de referencia, no hay paleta reutilizable ni theming por marca. |
| **Tipografía** | Escala cruda de Tailwind + `text-[10px]/[11px]` sueltos. | Roles tokenizados (`display/heading/body/caption`) con tamaño+line-height+tracking; `text-2xs`. |
| **Espaciado / elevación / z-index / motion** | 277 valores `[...]` de spacing ad-hoc; sombras y anchos sin sistema; **sin escala de z-index**. | `--shadow-*`, `--z-{dropdown,sticky,modal,popover,toast}`, `--duration-*`/`--ease-*`. Para un SaaS con overlays/drawers/toasts, la ausencia de escala z-index es fuente futura de bugs. |
| **Radios** | Un solo `--radius`. | Escala semántica por componente (`--radius-sm/md/lg/full`). |
| **Theming multi-tenant** | Imposible sin refactor (semánticos hardcodeados). | Override por scope (`[data-org]` / provider) apoyado en la capa de referencia. |
| **Infra de DS** | `/styleguide` (bueno) pero sin tests. | Storybook o equiv. por componente + tests axe (a11y) + regresión visual + modelo de contribución. |
| **Reglas para agentes** | No hay `CLAUDE.md`/`AGENTS.md` de DS. | Reglas de capa + prohibiciones + "buscar antes de crear" (ya previsto en el plan). |

**Boceto de tokens objetivo (independiente de la librería):**

```css
:root {
  /* 1 · Referencia (paleta cruda) */
  --blue-600: 221 83% 53%;  --emerald-600: 142 76% 36%;  --amber-500: 38 92% 50%;  --red-500: 0 84% 60%;
  /* 2 · Semántico */
  --primary: var(--blue-600);  --success: var(--emerald-600);  --warning: var(--amber-500);  --destructive: var(--red-500);
  --level-insufficient: var(--red-500);  --level-elementary: var(--amber-500);
  --level-adequate: var(--emerald-600);  --level-advanced: var(--blue-600);
  /* 3 · Escalas sistémicas */
  --shadow-sm: …;  --z-dropdown: 40;  --z-modal: 50;  --z-toast: 60;  --duration-base: 150ms;
}
```

Esto **resuelve H2/H8** (token de nivel) y **habilita** el white-label sin reescribir call-sites.

---

## 8. Factibilidad del plan de migración (D1 → HeroUI)

> Añadido 2026-07-14 tras investigar el estado real de HeroUI (jul-2026).
> **Veredicto: el plan es internamente coherente pero apunta a una arquitectura de HeroUI
> que ya no es la vigente, y su relación costo/beneficio no se sostiene. Recomiendo reabrir D1.**

**1. El plan describe HeroUI v2; la versión vigente es v3, una reescritura incompatible.**
El plan se apoya en `plugin heroui()` en `tailwind.config`, `HeroUIProvider`, `framer-motion`
como peer-dep, `Chip`, `useDisclosure` y `asChild→as`. Todo eso es **HeroUI v2** (linaje NextUI).
La línea vigente **HeroUI v3** (marzo 2026; actual v3.2.0, jun-2026):
- está construida sobre **Tailwind CSS v4** — el proyecto usa **Tailwind v3.4.17**;
- **elimina** el plugin `heroui()` y el **provider**;
- **elimina framer-motion** (animaciones en CSS, OKLCH, API *compound*);
- **v2 y v3 no coexisten** en el mismo proyecto.

→ Adoptar HeroUI hoy obliga a elegir entre: **(a) v2**, que entra en **modo mantenimiento**
(la inversión de la librería va a v3) — mal punto de partida para un SaaS de vida larga; o
**(b) v3**, que exige **primero migrar Tailwind v3→v4** (migración transversal aparte) e
**invalida por completo** la "tabla de mapeo shadcn→HeroUI" y la estrategia de adapter del plan
(escritas para v2). En ambos casos el gate `0-T1` del plan prueba la arquitectura equivocada.

**2. La estrategia "capa adaptadora sin reescritura" es más *leaky* de lo que el plan asume.**
shadcn = Radix (DOM que tú controlas) + cva; HeroUI = React Aria (comportamiento y DOM propios).
Los **72 usos de `asChild` en 47 archivos** — de los cuales **~32 envuelven triggers no-enlace**
(Tooltip/Dialog/Dropdown/Sheet/Select) que **no** mapean a `as`/`href` — requieren reescritura
caso a caso, no un alias. Y los 176 consumidores deben re-testearse (foco/teclado/aria, §6).

**3. Ningún bloqueante de esta auditoría se resuelve migrando de librería.**
H1 (doble `globals.css`), H2 (sin token de nivel), H3 (~531 clases evasivas), H4 (sin
enforcement), H5 (`packages/ui` muerto), H6-H9 (duplicados/ubicación), H13-H15 (bundle, a11y,
tokens) son **independientes de shadcn vs HeroUI**. Se arreglan con: unificar tokens, crear
`--level-*`, lint que prohíba escalas, code-split de export y mover carpetas. Migrar a HeroUI
**no** los arregla; los **re-introduce** sobre una base nueva y **suma** una migración de Tailwind
y el riesgo de una librería de ~4 meses.

**4. Lo que ya existe *es* la base SaaS-grade.** shadcn (código **propio en el repo**, no una
dependencia de `node_modules` — máximo control y forkabilidad), Radix (primitivas de a11y maduras),
cva + tailwind-merge, tokens semánticos HSL con dark mode, y `/styleguide`. Es exactamente la
arquitectura recomendada para un DS escalable. El trabajo pendiente es **consolidación y
disciplina**, no sustitución.

**Recomendación:** ejecutar el plan de **consolidación de shadcn** (que el propio plan ya
documenta como el "fallback" tras abortar en Fase 0), reordenado alrededor de:
(0) unificar y **ampliar** la fuente de tokens (§7) · (1) `performance-level.ts` como puente único
a `--level-*` · (2) enforcement ESLint + CI · (3) extraer compuestos duplicados
(FormDialog/FilterBar/PendingButton/StatCard) · (4) **code-split de xlsx/jspdf** (§5) ·
(5) reubicar dominio · (6) cerrar brechas de a11y (A1/A5). Todo esto es **menor riesgo y mayor
apalancamiento** que cambiar de librería. Si aun así se decide HeroUI por estética/velocidad de UI,
hacerlo con **v3 sobre Tailwind v4**, presupuestando esa migración como precondición y descartando
la tabla de mapeo actual.

---

## 9. Decisiones

> Resueltas con el equipo el 2026-07-14. **Actualización 2026-07-14 (tarde): D1 se marca para
> reabrir** a la luz de §8 (HeroUI v3 = reescritura sobre Tailwind v4; el plan describe v2).

> **✅ D1 — RESUELTO (2026-07-14, tarde): se mantiene shadcn.** Tras §8 se descartó migrar a HeroUI.
> Objetivo nuevo del equipo: **darle al producto un diseño propio más moderno**, habilitado por la
> arquitectura de tokens (§7) — el *look* lo dirigen tokens + variantes `cva`, así que se puede
> reestilizar sin reescribir features. El plan `design-system-migration-plan.md` se **reescribió**
> como *consolidación de shadcn + reskin por tokens* (ya no como migración a HeroUI).

La tabla siguiente conserva las resoluciones D2-D5 del equipo (siguen vigentes) y la D1
**histórica** (HeroUI, ya revertida por la resolución de arriba) como registro:

| # | Decisión | Resolución | Consecuencia |
|---|---|---|---|
| **D1** | Librería de componentes: ¿mantener shadcn o migrar? | **Migrar a HeroUI.** El proyecto es temprano y se van a reescribir flujos/páginas igual, así que se cambia la librería en la misma pasada. | El plan pasa de "consolidar shadcn" a "migrar a HeroUI". Se asume reescribir la capa `components/ui` (~176 archivos consumidores) y sustituir Radix por React Aria (base de HeroUI). |
| **D2** | ¿`src/features/` o colocación en `app/`? | **Colocación en `app/`.** Se usa `app/(group)/<ruta>/components/` como capa feature oficial. | No se crea `src/features/`. Solo se mueven a su ruta las carpetas de dominio sueltas en `components/` (official-reports, import, ai-models, instrument-bands, question-detail). |
| **D3** | emerald vs green para "éxito" | **Un solo token `success`.** Logro "adecuado", import ok, publicado y aprobado comparten un mismo verde. | En HeroUI esto es la escala semántica `success`. No se crea `--published`. |
| **D4** | `packages/ui` (muerto) | **Eliminar.** Nadie lo consume y solo `apps/web` tiene frontend. | Borrar `packages/ui` y su entrada en `next.config.ts` (`transpilePackages`). El DS vive dentro de `apps/web`. |
| **D5** | Tokens de nivel de logro (`--level-*`) | **Mantener 4 niveles semánticos** con puente único en `performance-level.ts`. En HeroUI se expresan como colores custom del tema + hex para recharts. | Un solo origen para badge/barra/chart de nivel; elimina la duplicación en 5 archivos (H2/H8). |

**Notas heredadas del cambio a HeroUI:**
- El nombre `components/patterns/` → se renombra a `components/shared/` durante la migración (D2 lo vuelve conveniente, no bloqueante).
- Los tokens semánticos ya no viven como `hsl(var(--x))` en `tailwind.config.ts`, sino en el **tema de HeroUI** (plugin `heroui()`), que es semántico por diseño (`primary/secondary/success/warning/danger/default`). Esto **favorece** el objetivo de la auditoría (H1/H3): un solo sistema de tokens semánticos.
</content>
</invoke>
