# Performance (`apps/web`)

> Grounded in gaps found by cross-checking this codebase against
> `.claude/skills/react-best-practices` (40+ Vercel-authored rules) — not the full checklist.
> Each item below was verified against real files before being written down; where the codebase
> doesn't yet show a violation, this file says so instead of inventing one. It does **not**
> duplicate `02-ui-conventions.md` (component lookup) or `03-process-archetypes.md` (page shells).

## 1. No accidental O(N²) in list/table rendering

Mirrors the backend's `../backend/04-collection-complexity.md` — same discipline, frontend side.
AcademOS renders per-student × per-skill/taxonomy-node data in tables (`resultados/mapa-calor/heatmap-table.tsx`,
`benchmarking/components/network-table.tsx`, `benchmarking/components/skill-heatmap.tsx`) — the
same data shape the backend rule flags as O(N²)-prone. **As of this writing these files don't
have the violation** (`heatmap-table.tsx` only uses `.map()`, no nested `.find()`/`.filter()`) —
this is a preventive guard, not a fix for an existing bug.

```tsx
// Wrong — O(N) lookup per row, O(N²) over the table
{students.map((student) => {
  const result = skillResults.find((r) => r.studentId === student.id); // rescans every row
  return <TableRow key={student.id}>{result?.score}</TableRow>;
})}

// Correct — build the lookup once outside the render loop
const resultsByStudent = new Map(skillResults.map((r) => [r.studentId, r]));
{students.map((student) => {
  const result = resultsByStudent.get(student.id);
  return <TableRow key={student.id}>{result?.score}</TableRow>;
})}
```

Same rule for `Set`-membership checks (`allowedIds.includes(x)` in a `.filter()` → build a `Set`
once, `.has(x)` per item). If you're adding a new table/grid that aggregates a per-student or
per-skill collection, check `HeatmapService.assembleResponse()` (backend) for the reference idiom
before writing the frontend aggregation — the shape of the fix is identical on both sides.

## 2. Dynamic-import chart components

**Confirmed gap:** `resultados/comparacion/page.tsx` (a Server Component) statically imports
`GenerationalChart` — a `'use client'` component that wraps `recharts` — at module scope:

```tsx
// apps/web/src/app/(dashboard)/resultados/comparacion/page.tsx — current
import { GenerationalChart } from '../components/charts/generational-chart';
```

Across the whole app, `recharts` is imported directly in exactly 3 files
(`resultados/components/charts/{generational-chart,progression-chart,generational-distribution-chart}.tsx`),
and `next/dynamic` is used in exactly **one** unrelated file (`components/assistant/assistant-panel.tsx`).
Charts are client-only rendering (already `'use client'`), not needed for the initial HTML, and not
SEO-relevant — they're a textbook `next/dynamic` candidate that isn't being used yet:

```tsx
// Better — chart bundle loads on demand, page shell paints without it
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const GenerationalChart = dynamic(
  () => import('../components/charts/generational-chart').then((m) => m.GenerationalChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
);
```

Apply this to **new** chart components, and treat converting the existing 3 as a reasonable
drive-by fix if you're already touching one of those pages — not a blocking migration.

## 3. `React.cache()` for repeatable per-request Server fetches

**Confirmed:** used in exactly one place today, `apps/web/src/lib/getCurrentOrg.ts`:

```ts
export const getCurrentOrg = cache(async (_orgId: string) => {
  return apiGet<OrgProfile>('/organizations/me');
});
```

This isn't documented anywhere as a general pattern to reach for — only as incidental context in
`04-roles-and-permissions.md`'s org-context section. Promote it: whenever a Server-Component-only
data fetch (not a Client Component, not a Server Action) could plausibly be called from more than
one place within the same request — a shared `layout.tsx` + a nested `page.tsx` both needing the
same lookup, for example — wrap it in `cache()` the same way, so React dedupes it to a single call
per request instead of refetching per call site. Don't reach for this on a fetch that's only ever
called once; it adds no value there.

## 4. Suspense streaming — not used, flagged as an opportunity, not a rule

**Confirmed:** zero `<Suspense>` boundaries in `apps/web/src`. There are exactly two `loading.tsx`
files (`app/(dashboard)/loading.tsx`, `app/(dashboard)/dashboard/loading.tsx`) — both coarse,
whole-route boundaries, not granular per-section streaming. Every dashboard/overview page
(archetype #2 in `03-process-archetypes.md`) blocks its entire render on `await Promise.all([...])`
before returning any JSX — so a slow KPI query delays the whole page shell, not just the section
that needs it.

This is a real architectural opportunity (`react-best-practices`'s "Strategic Suspense Boundaries"
rule), but **this file does not prescribe it as the convention** — none of the current pages do it,
and retrofitting Suspense means designing real fallback skeletons per section, which is a
deliberate feature-by-feature decision, not a drive-by fix. If you're building a new
dashboard-shaped page with a slow, non-critical section (e.g. a chart that isn't needed for the
KPI numbers above it), consider wrapping just that section in `<Suspense fallback={<Skeleton />}>`
with its data fetch moved into its own async component — but don't retrofit existing pages without
a specific reason to.
