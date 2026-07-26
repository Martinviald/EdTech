# Navigation Reactivity — Stream the Shell, Never Block on Data (`apps/web`)

> Sits between `03-process-archetypes.md` (the page *shapes*) and `06-client-data-fetching.md`
> (client polling/mutations). This file is the *timing* contract: when a user navigates or changes
> a filter, the **shell must paint immediately** and the data must arrive into a **loading state**,
> never the other way around. Grounded in the two hubs that already implement it end-to-end:
> `/resultados` (`app/(dashboard)/resultados/`) and the Banco de contenido hub
> (`app/(dashboard)/banco-items/(hub)/`).

## The rule

**A `page.tsx` must never `await` its screen data before returning JSX.** `await auth()` and
`await searchParams` (cheap, cookie/URL-local) are fine — they gate and parse. But the moment you
`await apiGet('/instruments?…')` at the top of the component, the entire route is blocked until that
fetch resolves: the old view stays frozen, then snaps to the new one. That is exactly the "wait for
data, *then* switch" behavior this rule exists to kill.

Instead: compute the query at the top, return the shell immediately, and move each data fetch into an
**async child wrapped in `<Suspense>`** with a skeleton fallback.

```tsx
// ❌ Blocks the whole route until /instruments resolves
export default async function Page({ searchParams }) {
  const { data } = await apiGet(`/instruments?${query}`);   // route frozen here
  return <><Filters /><List data={data} /></>;
}

// ✅ Shell paints now; the list streams into a skeleton
export default async function Page({ searchParams }) {
  const session = await auth();                              // cheap gate — ok to await
  const query = buildQuery(await searchParams);             // cheap parse — ok to await
  return (
    <>
      <Filters />                                            {/* shell, instant */}
      <Suspense fallback={<TableSkeleton />}>
        <ListSection query={query} />                        {/* async child, streams */}
      </Suspense>
    </>
  );
}

async function ListSection({ query }) {
  const { data } = await apiGet(`/instruments?${query}`);   // suspends only this box
  return <List data={data} />;
}
```

`app/(dashboard)/banco-items/(hub)/page.tsx` (`InstrumentsSection`) and every `resultados/**/page.tsx`
(`OverviewSections`, `FiltersSection`, …) are the reference implementations.

## Three mechanisms, three jobs — use all three

| Mechanism | Fires on | Job |
|---|---|---|
| **`loading.tsx`** | Segment navigation (route → route, tab → tab) | Instant full-segment skeleton while the new `page.tsx` resolves. |
| **`<Suspense>` in the page** | First paint **and** in-place re-render (searchParam change) | Streams each section independently into its own skeleton; shell stays. |
| **Shared `layout.tsx`** (often via a route group) | — | Keeps the header/tabs **mounted** across tab switches so only the content area streams. |

You need all three. A `loading.tsx` alone still lets a filter change block (see below). A `<Suspense>`
alone still remounts the header on every tab switch. The shared layout alone doesn't help first paint.

## `loading.tsx` lives next to the `page.tsx`, and holds only what the layout doesn't

When the header/tabs are in a shared `layout.tsx`, the sibling `loading.tsx` must render **only the
tab body skeleton** — no `PageContainer`, no hub header (the layout already painted those and they
persist under the Suspense boundary). Compare `resultados/loading.tsx` and
`banco-items/(hub)/loading.tsx`: both are just the filter-row + table skeletons, nothing else.

## The searchParam trap — why filters need `useTransition` + `TopProgressBar`

`loading.tsx` does **not** re-fire when only the searchParams change (same segment). And Next wraps
`router.push` in a React transition, so on a filter change React **keeps the old content visible**
and does **not** show the `<Suspense>` fallback — good (no skeleton flash) but it means **zero visual
feedback** unless you add it. So a filter control that writes searchParams must:

1. wrap the `router.push` in `startTransition` (from `useTransition`), and
2. surface `isPending` as a thin `TopProgressBar`.

```tsx
const [isPending, startTransition] = useTransition();
const updateFilter = (key, value) => {
  const params = new URLSearchParams(searchParams.toString());
  // …mutate params…
  startTransition(() => router.push(`${ROUTES.bancoItems}?${params}` as Route));
};
return (
  <div className="relative flex flex-wrap items-center gap-3">
    <TopProgressBar active={isPending} />
    {/* selects/inputs */}
  </div>
);
```

Reference: `resultados/components/dashboard-filter-bar.tsx` (via `FilterBar`'s `pending` prop) and
`banco-items/InstrumentFilters.tsx`. A filter that does a bare `router.push` (no transition, no bar)
is the bug — it reads as a frozen UI on slow fetches.

## Tab hubs: shared `layout.tsx`, and a route group when there are non-tab subroutes

To keep the header/tabs from remounting on every tab switch, put them in a `layout.tsx` that wraps
the tab pages. Two cases:

- **All children are tabs (or redirect-only):** a plain `layout.tsx` at the hub root works —
  `resultados/layout.tsx` (its `detalle`/`informe` children are redirect-only, so wrapping them is
  harmless).
- **The hub has real non-tab subroutes** (a detail page, a create wizard): a root `layout.tsx` would
  wrongly wrap those too. Use a **route group** so the layout only covers the tabs. Banco de
  contenido is the worked example — the tabs live in `banco-items/(hub)/`:

  ```
  banco-items/
    (hub)/                 ← route group: transparent to the URL
      layout.tsx           ← PageContainer + BancoHubHeader (title + tabs) — persists
      page.tsx             ← /banco-items          (tab "Instrumentos")
      loading.tsx          ← tab body skeleton only
      explorar/
        page.tsx           ← /banco-items/explorar (tab "Ítems")
        loading.tsx
    [instrumentId]/        ← NOT under (hub): detail view, its own header
    nuevo/                 ← NOT under (hub): create flow
  ```

  The group `(hub)` is stripped from the URL, so `/banco-items` and `/banco-items/explorar` still
  resolve, while `[instrumentId]` and `nuevo` sit outside the hub layout. Per-tab actions (e.g.
  "Nuevo instrumento") move **into the tab page's body**, since the shared header no longer takes an
  `actions` slot (`BancoHubHeader` dropped it when it moved to the layout).

  Moving pages into a `(hub)` group shifts relative imports one level deeper (`../X` → `../../X`) and
  can leave **stale `.next/types/**/page.ts`** pointing at the old path — delete those stale generated
  files if `tsc` complains about a missing `…/page.js` after the move (they regenerate on build).

## Nav triggers need click→commit feedback — `useOptimisticRoute`

The three mechanisms above cover everything **after** the navigation commits. But `usePathname()`
only changes **at commit**, so a nav highlight derived from it leaves the UI mute between the click
and the commit — on a slow RSC fetch (or dev-mode on-demand compile) the sidebar/tab looks frozen
even though navigation is in flight. The shared fix is
`useOptimisticRoute()` (`components/shared/use-optimistic-route.ts`):

```tsx
const { activePath, isPending, navigate } = useOptimisticRoute();
// active state computed against activePath (jumps to the target ON CLICK, reverts on failure)
// isPending drives a <TopProgressBar active={isPending} />
// keep the normal <Link href=...> and add: onClick={(e) => navigate(e, href)}
```

Internally it's `useOptimistic(pathname)` + `startTransition(() => router.push(href))`. The `<Link>`
stays (prefetch, a11y, middle-click); `navigate` lets modified clicks (cmd/ctrl/shift/alt, non-primary
button) fall through to native behavior and only hijacks plain left-clicks.

Consumers today: `SidebarNav` (sidebar items + collapsed flyout children) and `PageTabs` (which
`ResultadosNav`, `AssessmentTabsNav`, the admin `TabNav`, and every hub header inherit). **Don't
hand-roll a tab/nav bar with raw `<Link>` + `usePathname` active state** — render `PageTabs`, or if
the shape really doesn't fit, use `useOptimisticRoute` directly so the highlight still moves on click.

## Checklist for a new data-backed page

- [ ] `page.tsx` awaits only `auth()`/`searchParams`, never screen data, before returning JSX.
- [ ] Each fetch is in an async child inside `<Suspense fallback={<Skeleton…/>}>`.
- [ ] A sibling `loading.tsx` renders the tab-body skeleton (no header if a layout owns it).
- [ ] Any filter/searchParam control uses `useTransition` + `TopProgressBar`.
- [ ] If it's a tab in a hub: header/tabs are in a shared `layout.tsx` (route group if the hub has
      non-tab subroutes).
- [ ] Nav/tab bars use `PageTabs` (or `useOptimisticRoute`) — never a raw `<Link>` list with
      `usePathname()`-only active state.
