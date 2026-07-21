# UI Conventions — Quick Reference (`apps/web`)

> For the *why* (token architecture, component-layer rules, prohibitions) see
> [`AGENTS.md`](../../../AGENTS.md). This file is the *what to import* companion: a concrete
> "need X → use Y" table verified against the real source in `apps/web/src/components/`. If a
> component/prop isn't listed here, it doesn't exist yet — check `AGENTS.md` §6 ("buscar antes de
> crear") before building a new one.

## `patterns/` → `shared/` rename is pending

Everything below that says `components/patterns` is still at that path today
(`docs/design-system-migration-plan.md` task `2-T1`). The plan renames the folder to
`components/shared/` and promotes a few route-local composites into it (`summary-card` →
`StatCard`, `export-button`, `performance-badge`, `tag-filter-menu`). Import from
`@/components/patterns` until that PR lands — don't pre-emptively import from a `shared/` path
that doesn't exist yet.

## Quick reference table

| Need | Component | Import | Notes (verified from source) |
|---|---|---|---|
| Page title + description + right-aligned actions | `PageHeader` | `@/components/patterns` | Props: `title`, `description?`, `actions?`, `breadcrumb?`, `className?`. Renders `<h1 className="text-2xl font-semibold tracking-tight">`. |
| Standard vertical rhythm wrapper for a page | `PageContainer` | `@/components/patterns` | Just `space-y-6`. Wrap top-level page content in it instead of a bare `<div className="space-y-6">`. |
| Button | `Button` | `@/components/ui/button` | Variants: `default \| destructive \| outline \| secondary \| ghost \| link`. Sizes: `default \| sm \| lg \| icon`. Supports `asChild` (Radix `Slot`) — use for `<Button asChild><Link href=...>` instead of nesting an `<a>` styled by hand. |
| Card / metric container | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | `@/components/ui/card` | Compose directly; no `variant` prop on `Card` itself. |
| Card with a value + trend delta(s) | `MetricComparison` | `@/components/patterns` | Props: `label`, `value` (pre-formatted string), `comparisons?: MetricDelta[]`, `hint?`, `icon?`. Server Component (no `'use client'`). **Known gap:** its internal `TONE_CLASS` uses raw `text-emerald-700`/`text-red-700` scale classes, not tokens — a pre-existing AGENTS.md §4 violation in this file itself; don't copy that pattern into new code. |
| Table | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableFooter`, `TableCaption` | `@/components/ui/table` | Plain composition, no built-in sorting/pagination. `TableRow` already has `hover:bg-muted/50`. Wrap in `<div className="overflow-x-auto">` for wide tables (see `resultados/page.tsx`). |
| Modal / confirmation dialog | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` | `@/components/ui/dialog` | Radix-based. Pair `DialogTrigger asChild` with a `Button`. |
| Destructive confirmation ("¿Eliminar X?") | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel` | `@/components/ui/alert-dialog` | Use this (not `Dialog`) when the action is irreversible — see `equipo/MembersTable.tsx`'s revoke-member flow. |
| Slide-over panel | `Sheet` + subcomponents | `@/components/ui/sheet` | Same Radix-`Dialog`-derived API shape as `Dialog`. |
| Row action menu | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, and `DropdownMenuRadioGroup`/`DropdownMenuRadioItem`/`DropdownMenuSub*` for role/org switching | `@/components/ui/dropdown-menu` | Destructive item: add `className="text-destructive"` to `DropdownMenuItem` (see `/styleguide`'s "Eliminar" example). **`RowActionMenu` as a standalone composite does not exist yet** — audit H6 flags it as a candidate (2 usages: `equipo/MembersTable.tsx`, `organizacion/asignaciones/AssignmentsTable.tsx`), not yet extracted. |
| Empty list / "no data" state | `EmptyState` | `@/components/patterns` | Props: `title`, `description?`, `icon?: LucideIcon`, `action?`. This is the *only* empty-state pattern — don't hand-roll a dashed-border `div`. |
| Loading placeholder | `Skeleton` | `@/components/ui/skeleton` | Single primitive: `<div className="animate-pulse rounded-md bg-muted" />` + your own size classes (`h-4 w-32`, etc.). No skeleton "shapes" library — compose from this primitive. |
| Status/tag badge with semantic color | `Badge` | `@/components/ui/badge` | Variants: `default \| secondary \| destructive \| outline \| success \| warning \| info`. **No `level-*` variants yet** — see "Achievement levels" below. |
| Status badge driven by a domain tone (not a raw Badge variant) | `StatusBadge` | `@/components/patterns` | Props: `tone: 'success' \| 'warning' \| 'info' \| 'neutral' \| 'danger'`, maps to `Badge` variants internally (`danger`→`destructive`, `neutral`→`secondary`). Prefer this over calling `Badge` directly when you're expressing a domain state (published/draft/archived) — it's the intended replacement for ad hoc `bg-green-100`/`bg-yellow-100` maps like the one still in `banco-items/[instrumentId]/InstrumentDetailView.tsx:24-28` (`STATUS_COLORS`, not yet migrated). |
| Inline info/success/warning/danger callout box | `AlertCallout` | `@/components/patterns` | Props: `tone?: 'info' \| 'success' \| 'warning' \| 'danger'` (default `info`), `title?`, `icon?` (overrides the tone's default Lucide icon), `children`. Renders `role="status"`. |
| Multi-step wizard progress indicator | `Stepper` | `@/components/patterns` | Props: `steps: { id, label }[]`, `currentStep` (0-based index). This is only the *indicator* — there is no `WizardContainer`/step-state-machine component; each wizard (`DiaImportWizard`, `SpecTableWizard`, `SetupWizard`) reimplements its own `useState<Step>` + conditional render (see `03-process-archetypes.md`). |
| Text input | `Input` | `@/components/ui/input` | Plain styled `<input>`, all native props pass through (`type`, `disabled`, etc.). |
| Label | `Label` | `@/components/ui/label` | Radix `Label`. |
| Select dropdown | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` | `@/components/ui/select` | Radix-based, controlled via `value`/`onValueChange`. |
| Labeled form field (label + control + hint/error) | `Field` | `@/components/patterns` | Props: `label`, `htmlFor?`, `required?`, `hint?`, `error?` (error replaces hint when present), `children`. Use this instead of hand-writing `<Label>` + error `<p>` per field — see `AddMemberDialog.tsx`. |
| Avatar | `Avatar` + subcomponents | `@/components/ui/avatar` | Radix-based. |
| Tooltip | `Tooltip` + subcomponents | `@/components/ui/tooltip` | Radix-based; distinct from `chart-tooltip.tsx` (Recharts-specific, not a general UI tooltip). |
| Connection/generic error full-page state | `ApiError` | `@/components/ui/api-error` | Props: `type: 'connection' \| 'generic'`, `message?`, `onRetry?`. Used only from `app/error.tsx` / `app/(dashboard)/error.tsx` — see `01-error-notifications.md`. |
| Toast notification | `toast` (sonner) | `sonner` | See `01-error-notifications.md` for the convention; `Toaster` itself is configured in `@/components/ui/sonner.tsx`. |

## Achievement-level colors — the most-violated pattern (Audit H2/H8)

The four DIA performance levels (`insufficient` / `elementary` / `adequate` / `advanced`) are the
single most repeated domain concept in the app, and per the audit are re-implemented with raw
Tailwind color scales in **5 separate files** instead of going through one bridge.

**Current state on this branch** (verified against `apps/web/src/app/globals.css` and
`tailwind.config.ts`): the `--level-insufficient/elementary/adequate/advanced` semantic tokens
**already exist** (`globals.css:111-118`) and are wired into Tailwind as `bg-level-*` /
`text-level-*-foreground` utilities (`tailwind.config.ts:64-79`) — you can see them rendered in
`/styleguide` today. **What has not landed yet:**
- `components/ui/badge.tsx` has no `level-*` `cva` variant (migration plan `1-T2`) — only
  `default/secondary/destructive/outline/success/warning/info` exist today.
- `apps/web/src/app/(dashboard)/resultados/components/performance-level.ts` — the intended single
  bridge (per its own docstring) — still exports `PERFORMANCE_LEVEL_BADGE_CLASS` /
  `PERFORMANCE_LEVEL_BAR_CLASS` as raw `bg-red-100`/`bg-emerald-500`/etc. scale-class strings, not
  token references (migration plan `3-T0`, not done).
- The same 4-level color mapping is still duplicated in `benchmarking/components/band-presentation.ts`,
  `resultados/mapa-calor/heatmap-table.tsx`, `resultados/informe/report-export-button.tsx`, and
  `components/official-reports/dia-levels.ts`.

**What this means for new code today:**
- For **recharts fills** (a `fill`/`stroke` prop, which cannot take a Tailwind class): import
  `PERFORMANCE_LEVEL_CHART_COLOR` from `resultados/components/performance-level.ts` — it's the one
  hex-color source of truth (`#ef4444`/`#f59e0b`/`#10b981`/`#3b82f6`), already deliberately
  centralized (Audit §2.3) even though it's hex.
- For **badges/labels/bars in className-driven UI**, prefer the new `bg-level-*`/`text-level-*-foreground`
  Tailwind utilities directly (they exist and are token-backed) over reaching for
  `PERFORMANCE_LEVEL_BADGE_CLASS`'s raw scale strings — even though `performance-level.ts` hasn't
  been refactored to use them internally yet, you don't have to inherit its debt in new call sites.
- **Never** re-derive the insufficient→red / elementary→amber / adequate→emerald / advanced→blue
  mapping locally (as `band-presentation.ts`, `heatmap-table.tsx`, `report-export-button.tsx`, and
  `dia-levels.ts` currently do). Import from `performance-level.ts`, or from the `--level-*` tokens
  directly. If you're touching one of those 4 duplicate files, migrating it to import from
  `performance-level.ts` (or its future `--level-*`-based rewrite) is in scope of migration plan
  `3-T0` — flag it rather than adding a 6th copy.

## `/styleguide` is the living reference

`apps/web/src/app/styleguide/page.tsx` demonstrates: the raw brand/violet color ramps, the 4
`--level-*` swatches, the radius scale (`rounded-sm/md/lg/xl/full`), the shadow scale
(`shadow-sm` → `shadow-xl`), the tokenized type scale (`text-display/heading/title/body/caption`
plus `text-2xs` — the replacement for the `text-[10px]`/`text-[11px]` arbitrary values flagged in
Audit H10), all `Button` variants/sizes, `Input` states, `Card`, `Dialog`, `DropdownMenu`, all
`Badge` variants, and the `patterns/` composites (`PageHeader`, `StatusBadge`, `AlertCallout`,
`Stepper`, `Field`, `EmptyState`). When adding a new variant to a primitive, add it here too
(AGENTS.md §5).
