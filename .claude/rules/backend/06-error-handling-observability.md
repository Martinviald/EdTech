# Error Handling & Observability (`apps/api`)

> Backend half of the error-currency story; `.claude/rules/frontend/01-error-notifications.md` and
> `.claude/rules/frontend/06-client-data-fetching.md` are the frontend half. Same split on both
> sides: intentional/controlled errors (4xx, curated message) vs unhandled ones (5xx, opaque to the
> client, logged server-side). This file is new — before it, `apps/api` had **zero** centralized
> error logging (confirmed: no `ExceptionFilter` anywhere, 5 `Logger.error(...)` call sites total
> across the whole codebase).

## Keep throwing domain exceptions the way you already do

Nothing changes about `03-helpers-vs-services.md`'s "Failure handling" section — services still
throw `BadRequestException`/`ConflictException`/`NotFoundException`/`ForbiddenException` directly
with a curated Spanish message, same as today. This file only adds what happens to **unhandled**
exceptions (bugs, unexpected `undefined`, a third-party call throwing) that were never wrapped in
an `HttpException` — those used to just bubble to NestJS's default handler with no logging at all.

## `GlobalExceptionFilter` — additive, doesn't change the 4xx response shape

`apps/api/src/common/filters/global-exception.filter.ts`, registered globally via `APP_FILTER` in
`app.module.ts` (same `providers: [...]` array as `AuthGuard`'s `APP_GUARD`):

```typescript
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const request = host.switchToHttp().getRequest<RequestWithUser>();
    reportServerError(exception, {
      method: request.method,
      url: request.url,
      userId: request.user?.userId,
      orgId: request.user?.orgId,
    });

    response.status(500).json({ statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' });
  }
}
```

Two paths:
- **`HttpException`** (every `BadRequestException`/`ConflictException`/etc a service throws) — passed
  through via `exception.getResponse()` unchanged. This is the exact same body NestJS's default
  filter would have produced — `apps/web/src/lib/api.ts`'s `body.message` extraction (which
  `ApiRequestError`/`getDisplayMessage` depend on) needed zero changes.
- **Anything else** (unhandled) — logged via `reportServerError` with request context
  (`method`/`url`/`userId`/`orgId` — pulled from `request.user: JwtPayload`, so you get *who* hit
  the bug, not just *that* a bug happened), then responds with NestJS's own default 500 shape. This
  is new: before this filter, an unhandled exception logged nothing anywhere.

## `reportServerError` — the one swap-in point for real observability tooling

`apps/api/src/common/observability/report-error.ts`:

```typescript
const logger = new Logger('Observability');

export function reportServerError(error: unknown, context?: Record<string, unknown>): void {
  logger.error(/* message, stack */, JSON.stringify(context ?? {}));
  // Swap in a real observability SDK here later (Sentry.captureException, etc).
}
```

Today it's `Logger.error` only — no Sentry/Datadog/etc is installed, and that's deliberate (F1 scope,
CLAUDE.md §8.1). When one gets added, this is the **only** function that changes — don't scatter
`Logger.error`/future `Sentry.captureException` calls through individual services for this purpose.
If a service-level catch block needs to report something it handles itself (not an unhandled
exception reaching the filter), call `reportServerError` from there too rather than a raw
`Logger.error` — same single point, same future swap-in.

The frontend has a **mirrored** (not shared — different runtime, `Logger` vs `console.error`)
function with the same name and contract: `apps/web/src/lib/observability.ts`'s
`reportServerError(error, context)`, called from `lib/api.ts` and from the client-fetch proxy route
(`app/api/proxy/[...path]/route.ts`) on any `>= 500` response. Backend and frontend each report their
own 5xx at the point they're observed — the backend filter has the real stack trace and request
context; the frontend's is a defense-in-depth log of "the backend returned a 500," useful even if the
backend-side log is ever lost or the failure happens between the proxy and the backend (network).

## What NOT to do

- Don't add a second global exception filter, or override `GlobalExceptionFilter`'s HttpException
  branch to reshape 4xx bodies — that branch's whole job is to be a no-op vs NestJS's default.
- Don't call `reportServerError` for expected `HttpException`s (a `BadRequestException` from bad
  user input is not a bug to report to observability tooling) — the filter already only calls it on
  the unhandled path. Don't add ad hoc calls to it from a `catch` block around a domain exception.
- Don't reach for a `Result<T>`/`BaseService` wrapper to "catch errors properly" — that pattern
  doesn't exist here (`03-helpers-vs-services.md`) and this filter is not a reason to introduce one;
  it operates at the HTTP boundary, not inside services.
