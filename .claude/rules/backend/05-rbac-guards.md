# RBAC Guards (`apps/api`)

> Backend half of the role-gating story; `.claude/rules/frontend/04-roles-and-permissions.md` is
> the frontend half — same role-set constants, same `UserRole` union, consumed on both sides from
> `packages/types`. Read that file for the frontend call sites (`canAccess()`, page gates); this
> file is the NestJS guard chain and where the shared role-set constants live.

## The guard chain

Three guards, each with a different scope:

| Guard | Scope | How it's wired | What it checks |
|---|---|---|---|
| `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) | **Global** — every route | `APP_GUARD` in `app.module.ts` | Valid JWT present, sets `request.user: JwtPayload`. `@Public()` opts a route out. |
| `RolesGuard` (`apps/api/src/common/guards/roles.guard.ts`) | **Per-controller/route** | `@UseGuards(RolesGuard)` on the controller (or route), `@Roles(...)` per route | `userHasAnyRole(user.roles, required)` — union check. `platform_admin` bypasses. |
| `FeatureGuard` (`apps/api/src/common/guards/feature.guard.ts`) | **Per-controller/route, chained after `RolesGuard`** | `@UseGuards(RolesGuard, FeatureGuard)` + `@RequireFeature('x')` | Org's `config.allowedFeatures` allowlist (paid-tier gating). |

`RolesGuard`/`FeatureGuard` are **not** global — every controller that needs role checks adds
`@UseGuards(RolesGuard)` itself. This is intentional (some routes are "any authenticated user"), but
it means a new controller with no `@Roles(...)` anywhere is either deliberately open to any
authenticated user (rare — e.g. `GET /organizations/me/features`) or a mistake. When adding a new
controller, decide this explicitly, don't leave it unstated.

```typescript
// apps/api/src/remedial/remedial.controller.ts
@UseGuards(RolesGuard, FeatureGuard)
@RequireFeature('remedial')
export class RemedialController {
  @Post()
  @Roles(...REMEDIAL_GENERATOR_ROLES)
  generate() { /* ... */ }
}
```

## Roles are already per-active-org — don't re-derive an org check

`request.user.roles` in the JWT is **not** a flat union across every org a user belongs to — it's
recomputed from the user's memberships in their **active org** on login and on every org switch
(`apps/api/src/auth/auth.service.ts:137`, and `:338` on switch: "los roles son por-org, así que
cambian al saltar [orgs]"). So `RolesGuard`'s union check is already an org-scoped check — a
`teacher` in Org A and `school_admin` in Org B only has `school_admin` in their JWT while Org B is
active. Don't add a second "does this role apply in this org" check anywhere; it's already true by
construction. (Row-level tenant isolation — "can this user's org see this *data*" — is a separate
concern, enforced by RLS via `withOrgContext`, see CLAUDE.md §5.2. Guards answer "can this role do
this action"; RLS answers "which rows can this org see." Don't conflate the two.)

## Where role-set constants live — one file per domain

`packages/types/src/access-policies/` is a directory, one file per domain, re-exported from
`packages/types/src/access-policies/index.ts` (itself re-exported from `@soe/types`). Mapped to the
matching `apps/api/src/<domain>/` module wherever one exists: `staff-org.ts`, `item-bank.ts`,
`remedial.ts`, `benchmarking.ts`, `ai-analysis.ts`, `results-dashboards.ts`, etc. —
**this replaced a single flat 259-line file** that grouped constants by the sprint that introduced
them (`// ── F2 S4 ──`) instead of by the domain they gate.

**To add a role to an endpoint tomorrow:**

1. Find the domain file under `packages/types/src/access-policies/` (e.g. `remedial.ts` for a
   `RemedialController` route). If the domain doesn't have a file yet, create one — don't add a 28th
   file's worth of constants to an unrelated existing file.
2. Add or edit the `readonly UserRole[]` constant there. If it's really the same audience as an
   existing constant elsewhere (e.g. "same as who can view results"), alias it explicitly —
   `results-dashboards.ts` has 3 aliases of `RESULTS_VIEWER_ROLES` (`DASHBOARD_VIEWER_ROLES`,
   `ANALYTICS_VIEWER_ROLES`, `HEATMAP_VIEWER_ROLES`) with a comment explaining they're intentionally
   the same set, not copy-pasted — do the same rather than duplicating the array.
3. Use it in the controller: `@Roles(...YOUR_CONSTANT_ROLES)`. **Never** inline a role-string array
   — `@Roles('school_admin', 'academic_director', 'platform_admin')` — even for what looks like a
   one-off. `apps/api/src/organizations/organizations.controller.ts` had this exact 3-role array
   copy-pasted across **11 routes** before being consolidated into `ORG_ACADEMIC_ADMIN_ROLES`
   (`access-policies/staff-org.ts`) — that's the failure mode this rule exists to prevent. A bare
   single-role `@Roles('platform_admin')` is the one accepted exception (see `admin.controller.ts`,
   and the 2 remaining solo `platform_admin` routes in `organizations.controller.ts`) — there's no
   list to keep in sync for a single literal.
4. If the same feature has a frontend page/action, mirror the constant on the frontend side —
   `canAccess(session.user.roles, YOUR_CONSTANT_ROLES)` — importing the **same** constant from
   `@soe/types`, per `04-roles-and-permissions.md`. One constant, two call sites, never two lists.

## `SensitiveDataGuard` is the one exception to the decorator pattern

`apps/api/src/common/guards/sensitive-data.guard.ts` doesn't read a `@Roles(...)` decorator — it
hardcodes `SENSITIVE_DATA_ROLES` (`access-policies/sensitive-data.ts`) directly, because it's meant
to gate a fixed, deliberately-narrow set of PII-adjacent routes, not something each controller opts
into per-route. If you're adding a new sensitive-data endpoint, use this guard rather than
reinventing a role check inline — don't confuse it with `RolesGuard` (which is generic and
decorator-driven).
