# Roles & Permissions in `apps/web`

> Backend counterpart: `.claude/rules/backend/05-rbac-guards.md` (the NestJS guard chain and where
> the shared `access-policies/<domain>.ts` constants live). Same `UserRole` union, same constants,
> consumed on both sides — read that file when you're adding the API side of a new gated feature.

> This is the practical "how to write a role-gated page/component" companion to
> **CLAUDE.md §6.3** (multi-role JWT model: `roles` union vs `activeRole`, `RolesGuard`/
> `SensitiveDataGuard` union authorization, the "Mis cursos" `activeRole` exception,
> `POST /auth/switch-role`). Read §6.3 for the *model* — this file is the frontend *call sites*,
> grounded in real files, not a restatement of the JWT design.

## The three things you need, and where they live

| What | Where | Import |
|---|---|---|
| The role union type | `UserRole` (11 values: `platform_admin`, `foundation_director`, `school_admin`, `academic_director`, `cycle_director`, `dept_head`, `coordinator`, `teacher`, `homeroom_teacher`, `eval_coordinator`, `guardian`) | `@soe/types` (`packages/types/src/enums.ts:12-23`) |
| Role-set constants per feature | `STAFF_MANAGEMENT_ROLES`, `IMPORT_ROLES`, `DASHBOARD_VIEWER_ROLES`, `ITEM_BANK_ROLES`, `ITEM_VIEWER_ROLES`, `RESULTS_VIEWER_ROLES`, `AI_ANALYSIS_VIEWER_ROLES`, `REMEDIAL_VIEWER_ROLES`, `BENCHMARKING_VIEWER_ROLES`, `GRADING_SCALE_ROLES`, `LLM_SETTINGS_ROLES`, and ~25 more | `@soe/types` (`packages/types/src/access-policies.ts`) |
| Union-aware check helpers | `userHasRole(roles, role)`, `userHasAnyRole(roles, allowed)`, `canAccess(roles, allowed)` (alias of `userHasAnyRole`, meant for UI call sites) | `@soe/types` (`packages/types/src/utils/roles.ts`) |

`canAccess` and `userHasAnyRole` are literally the same function — `canAccess` exists as the
"semantic alias for access checks from the UI" per its own doc comment. **Use `canAccess` in
`apps/web`** (it's what every real page uses); `userHasAnyRole`/`userHasRole` show up more in
lower-level role-set composition.

There is no `access-policies.ts` in `apps/web` — all the role-set constants are defined once in
`packages/types` and imported by both `apps/api` guards and `apps/web` pages. Never redeclare a
role list inline in a page (CLAUDE.md's anti-pattern table already forbids this) — if the feature
you're gating doesn't have a constant yet, add one to `packages/types/src/access-policies.ts`
rather than inlining `['platform_admin', 'school_admin']` in the page.

## Pattern A — gate an entire page (Server Component)

Every gated page in `apps/web` opens with this exact two-check shape. From
`apps/web/src/app/(dashboard)/equipo/page.tsx`:

```tsx
export default async function EquipoPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, STAFF_MANAGEMENT_ROLES)) redirect('/dashboard');

  const members = await apiGet<MemberModel[]>('/organizations/me/members');
  // ...
}
```

- `session.user.roles` is the **union** of all active memberships' roles (not `activeRole`) — this
  is deliberate: CLAUDE.md §6.3 says guards (and by extension page gates) authorize if *any* of the
  user's roles qualifies.
- First check is "is there a session at all" (→ `/login`); second is "does this session's role
  union satisfy the feature's role set" (→ `/dashboard`, the safe landing page for an authenticated
  but unauthorized user). Don't collapse these into one check — they redirect to different places.
- Never write `session.user.role === 'school_admin'` — there is no singular `role` field to compare
  against on the frontend session type in the first place; always go through `canAccess`.

For a record/detail page where "not found" and "no access" should look identical to the user (avoid
leaking existence), use `try { apiGet(...) } catch { notFound(); }` instead of a role check —
`apps/web/src/app/(dashboard)/evaluaciones/[assessmentId]/layout.tsx` does exactly this: the
backend 403/404s and the frontend can't tell the difference, so it calls `notFound()` either way.

## Pattern B — conditionally render an action/nav item

Compute a boolean once per role-set, then use it both to decide what to fetch and what to render.
From `apps/web/src/app/(dashboard)/dashboard/page.tsx:114-211`:

```tsx
const canImport = canAccess(user.roles, IMPORT_ROLES);
const [overview, assessments, instruments] = await Promise.all([
  apiGet<OrgOverview>('/organizations/me/overview').catch(() => null),
  apiGet<AssessmentListResponse>('/item-analysis/assessments').catch(() => null),
  canImport ? apiGet<{ total: number }>('/instruments?limit=1').catch(() => null) : Promise.resolve(null),
]);

// later, building a links array:
const links = [
  { href: '/resultados', label: 'Panorama pedagógico', icon: BarChart3, show: canAccess(roles, RESULTS_VIEWER_ROLES) },
  { href: '/analisis-ia', label: 'Análisis IA', icon: Sparkles, show: canAccess(roles, AI_ANALYSIS_VIEWER_ROLES) },
  { href: '/importar/resultados', label: 'Importar resultados', icon: FileUp, show: canImport },
];
const visible = links.filter((l) => l.show);
if (visible.length === 0) return null;
```

Same idea for gating tabs in a hub layout — `evaluaciones/[assessmentId]/layout.tsx` builds its
`tabs` array with `...(canAccess(roles, ANALYTICS_VIEWER_ROLES) ? [{ href: ..., label: 'Resultados' }] : [])`
per tab, so a role that can't see a tab never gets a link to it (defense in depth — the tab's own
`page.tsx` still has to re-check, since a stale/shared URL can be typed directly).

The nav sidebar (`apps/web/src/components/layout/nav-items.ts`) filters the same way, via
`visibleNavItems`/`visibleNavGroups`, both of which call `canAccess(roles, item.roles)` — the
shared helper, not an inline `.some()`. Follow that when adding nav filtering.

## Pattern D — client components gate on `canAccess`, with `roles` threaded as props

**There is deliberately no `useCan()`/`usePermissions()` hook and no `<Can>` wrapper in this
codebase.** The app reads the session **once** in a Server Component (`auth()`) and passes
`roles`/`activeRole` **down as props** — `UserNav`, `SidebarNav`, `MobileSidebar`, `report-actions`,
`item-insight-section` all receive `roles: readonly UserRole[]` (or `activeRole: UserRole`) as a
prop and never call `useSession()` for gating. The only `useSession()` call sites (`RoleSwitcher`,
`OrgSwitcher`, `OrgSelector`) use it to *switch* role/org (Pattern C flow), not to *gate*.

This is intentional: a client-side permissions hook that reads `useSession()` would trigger a
per-component session read (a client waterfall) and fight the prop-threading grain. So:

- **A client component that gates on role uses the same `canAccess(roles, SET)`** as a Server
  Component (`canAccess` is a pure helper — it runs identically on both sides), against the `roles`
  prop it already receives. Don't reach for a hook.
- **If a client component needs `roles` and doesn't have them, thread them as a prop** from the
  nearest Server Component ancestor that called `auth()` — don't introduce `useSession()` just to
  gate.
- Reserve `useSession()` for the role/org *switch* flow (Pattern C), where the client genuinely
  needs the live, mutable session.

Same golden rule as everywhere: `canAccess(roles, SOME_ROLES_CONSTANT)` against the **union**, never
`role === 'xxx'` — see below.

## Pattern C — the `activeRole` exception ("Mis cursos" / teacher view)

CLAUDE.md §6.3 calls out one deliberate exception to the "always use the role union" rule: whether
to show the teacher-scoped view is decided by `activeRole`, not the union, so a
`teacher`+`academic_director` user can toggle between the admin view and the teacher view by
switching their active role. The frontend mirror of the backend's
`ClassGroupsService.shouldShowTeacherView()` is in
`apps/web/src/app/(dashboard)/dashboard/page.tsx:51-53`:

```tsx
// La vista del profesor se decide por el rol ACTIVO (no la unión), para que un
// usuario admin+profesor pueda alternar — coherente con shouldShowTeacherView.
const isTeacherView = user.activeRole === 'teacher' || user.activeRole === 'homeroom_teacher';
```

This is the **only** place `activeRole` should be compared directly against literal role strings
for a *branching* decision — everywhere else, gate with `canAccess(user.roles, ROLE_SET)` against
the union. If you're adding a new role-scoped alternate view (not just hiding a button, but
switching the whole page body like this), it's a judgment call whether it belongs with the union or
the `activeRole` exception — default to the union unless the feature is specifically about "let a
multi-role user toggle between two full views of the same page," which is what this exception
exists for.

## Switching role / org from the client

`RoleSwitcher` (`apps/web/src/components/layout/RoleSwitcher.tsx`) and `OrgSwitcher`
(`apps/web/src/components/layout/OrgSwitcher.tsx`) are the only two places that mutate
`activeRole`/active org. Both follow the same three-step flow (doc-commented in both files):

```tsx
startTransition(async () => {
  try {
    const result = await switchRoleAction(role);       // 1. POST /auth/switch-role (server action)
    await update({ activeRole: result.activeRole });    // 2. useSession().update() → re-run jwt callback
    router.refresh();                                    // 3. re-fetch Server Components with new session
    toast.success(`Rol activo: ${ROLE_LABELS[result.activeRole] ?? result.activeRole}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'No se pudo cambiar el rol');
  }
});
```

Don't build a new role/org-switching UI without this three-step sequence — skipping `update()` or
`router.refresh()` leaves the client `useSession()` and the already-rendered Server Components out
of sync with the new JWT.

Both switchers early-return `null` when there's only one role/org (`if (roles.length <= 1) return null;`)
— they render as a sub-menu inside `UserNav`, not a standalone control, so there's nothing to
switch *to* for a single-role/single-org user.

## Org context on the frontend

`apps/web/src/lib/getCurrentOrg.ts` wraps a single `apiGet<OrgProfile>('/organizations/me')` in
React's `cache()` (request-scoped memoization, not cross-request):

```ts
export const getCurrentOrg = cache(async (_orgId: string) => {
  return apiGet<OrgProfile>('/organizations/me');
});
export type CurrentOrg = Awaited<ReturnType<typeof getCurrentOrg>>;
```

Note the backend endpoint itself is `/organizations/me` — it derives the org from the authenticated
session server-side (per CLAUDE.md §11: never trust an org id from the client), so `_orgId` here is
effectively just a `cache()` key, not a value forwarded to the API call. The frontend's actual
`orgId` comes from `session.user.orgId` (set from the JWT via `auth()`), which is what you pass to
`apiGet`/`apiPost` calls that need to scope a mutation — you don't need to (and shouldn't) pass an
org id explicitly to endpoints that already infer it from the bearer token.

## Golden rule (restated with a real counter-example)

CLAUDE.md's anti-pattern table already says it: never compare `user.role === 'xxx'` directly.
Concretely in `apps/web`, that means every gate looks like Pattern A/B above
(`canAccess(session.user.roles, SOME_ROLES_CONSTANT)`), **not**:

```tsx
// Wrong — ignores the user's other roles, and SOME_ROLES_CONSTANT should come from access-policies.ts
if (session.user.activeRole !== 'school_admin') redirect('/dashboard');
```

The only sanctioned direct-comparison exception is Pattern C above (`activeRole === 'teacher' || activeRole === 'homeroom_teacher'`), and that's for choosing which *view* to render for a
multi-role user, never for authorization.
