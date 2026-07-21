# Client-Side Data Fetching (TanStack Query)

> Companion to `01-error-notifications.md` (the `ApiRequestError`/`getDisplayMessage` error
> currency this file reuses, unchanged) and `03-process-archetypes.md` (the RSC-first page shells
> this file does **not** replace). AcademOS fetches almost everything from Server Components via
> `apps/web/src/lib/api.ts` — that stays the default. TanStack Query (`@tanstack/react-query`) is
> for the narrower case: data a Client Component needs to poll, refetch, or invalidate without a
> full page reload.

## When to reach for what

| Need | Use | Why |
|---|---|---|
| Initial page data, SEO-relevant content | Server Component `apiGet`/`apiPost` (`lib/api.ts`) | Default. No client bundle cost, no loading state to design. See `03-process-archetypes.md`. |
| A mutation from a dialog/form | Server Action returning a `Result` (pattern #2, `01-error-notifications.md`) or the `useTransition` + `toast` shape (pattern #1) | Established, works today, no new infra needed. |
| A Client Component that needs to **poll** an async job, **refetch** on an interval, or **invalidate** a cache after a mutation without `router.refresh()` | TanStack Query (`useQuery`/`useMutation`, this file) | The only real gap in the existing toolkit — see the worked example below. |

Don't reach for TanStack Query to fetch something a Server Component could fetch once on load — that's
what `apiGet` is for. TanStack Query is additive, not a replacement for the RSC-first pattern.

## The two-layer fetch stack

`lib/api.ts` is `server-only` and can't be called from a Client Component — it attaches the Bearer
token by reading the httpOnly session cookie directly, which only works server-side. TanStack Query
hooks run in the browser, so they go through a parallel stack instead:

```
Client Component (useQuery)
  → apps/web/src/lib/api-client.ts (apiClientGet/Post/Patch/Delete — NOT server-only)
    → same-origin fetch('/api/proxy/...')  (browser attaches the session cookie automatically)
      → apps/web/src/app/api/proxy/[...path]/route.ts  (reads the cookie server-side, forwards
        `Authorization: Bearer <token>` to the NestJS backend, streams the response back)
        → apps/api (AuthGuard/RolesGuard/FeatureGuard re-validate exactly as they do for any
          other request — the proxy adds zero trust, it's a cookie→header translator)
```

This generalizes a pattern that already existed for the assistant feature
(`apps/web/src/app/api/assistant/*/route.ts` — 3 hand-written proxies) into one catch-all route, so
a new TanStack Query hook never needs its own Route Handler. The 3 assistant routes stay as they are
(they're streaming-SSE-specific); don't migrate them to the generic proxy.

**Both `api.ts` and `api-client.ts` throw the same `ApiRequestError`** (`lib/errors.ts`) — the
4xx-curated-message / 5xx-generic-fallback split documented in `01-error-notifications.md` applies
identically whether the fetch came from a Server Component or a TanStack Query hook. There is no
second error taxonomy to learn.

## Error handling is centralized — don't write it per-hook

`apps/web/src/app/providers.tsx` wires a single `QueryCache`/`MutationCache` `onError` at the
`QueryClient` level:

```tsx
function onQueryError(error: unknown): void {
  toast.error(getDisplayMessage(error, DEFAULT_ERROR_MESSAGE));
}
```

Every `useQuery`/`useMutation` in the app gets this for free — **don't** add a per-hook `onError`
that duplicates the toast call. 5xx logging already happened server-side, inside the proxy route
handler, before the response ever reached the browser (see `reportServerError` in
`apps/web/src/lib/observability.ts`) — the client only ever needs to toast, never to report.

## Hook colocation — mirrors the backend's helper-vs-service decision

Same rule as `03-helpers-vs-services.md` (backend), applied to hooks instead of private methods:

- A hook used by **one component only** stays inline in that component's file, or — if it's already
  non-trivial (a `useQuery` with a `refetchInterval` function, a query-key factory) — gets its own
  file **colocated under the route**: `app/(group)/<route>/hooks/use-x.ts`. This is the extension of
  AGENTS.md §3's existing feature-colocation convention (`app/(group)/<route>/components/`) to hooks.
- A hook **reused across routes** is the trigger to promote it — same threshold as the backend's
  "used once → keep it where it is; reused → promote" rule. There's no shared `hooks/` directory in
  this codebase yet; don't create one preemptively for a single-route hook.

Each hook file also owns its query-key factory, so invalidation stays typed and colocated instead of
scattering raw key arrays across call sites:

```ts
export const remedialStatusKeys = {
  detail: (materialId: string) => ['remedial-material', materialId, 'status'] as const,
};
```

## Worked example — `RemedialPoller` / `AnalysisPoller`

Both were previously hand-rolled: `'use client'` + `useEffect` + a recursive `window.setTimeout`
every 3000ms + a `'use server'` Server Action wrapping `apiGet` + `router.refresh()` once the status
left `pending`/`processing`. Migrated to
`apps/web/src/app/(dashboard)/material-remedial/hooks/use-remedial-status.ts` (and the `analisis-ia`
equivalent):

```ts
export function useRemedialStatus(materialId: string, initialStatus: RemedialStatus) {
  const attempts = useRef(0);
  return useQuery({
    queryKey: remedialStatusKeys.detail(materialId),
    queryFn: () => {
      attempts.current += 1;
      return apiClientGet<RemedialMaterialModel>(`/remedial/${materialId}`);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? initialStatus;
      if (!isPolling(status)) return false;
      return attempts.current < MAX_ATTEMPTS ? POLL_INTERVAL_MS : false;
    },
  });
}
```

`refetchInterval` as a function of the latest fetched data is TanStack Query's built-in equivalent
of the hand-rolled "stop polling once terminal" logic — no manual timers, no `stopped` ref, no
cleanup bookkeeping. The component itself only keeps a tiny `useEffect` to call `router.refresh()`
once when the status becomes terminal (so the parent Server Component re-renders with the final
content) — everything else (the interval, the retry-on-mount, the cache) is TanStack Query's job now.

## What NOT to do

- Don't call `lib/api.ts` (`apiGet`/`apiPost`/etc) from a Client Component — it will fail at runtime
  (`server-only`). Use `api-client.ts` instead.
- Don't add a bespoke Route Handler per new client-fetched endpoint — the generic
  `app/api/proxy/[...path]/route.ts` already covers it; adding a one-off route is exactly the
  boilerplate this file exists to avoid.
- Don't invent a second error-display convention for TanStack Query call sites — `getDisplayMessage`
  is already wired globally; a local `onError` in a specific hook should be rare and justified (e.g.
  a mutation that needs to do something *in addition to* the toast, not instead of it).
