# Error & Validation Notifications

> AcademOS (`apps/web`) has **no `reportError`/`globalNotify`/`validateParams` wrapper** — that
> system belongs to a different codebase. Today the app calls `sonner`'s `toast` directly, ad hoc,
> in ~30 files. There's no PostHog, no snackbar abstraction. This file documents the convention
> that already exists in practice (verified against real call sites) so new code stays consistent
> with it, not a system that doesn't exist here.

## The three real error-handling shapes in this codebase

### 1. Client mutation (dialog / form) — `useTransition` + `toast` in a `catch`

The dominant pattern. Confirmed in `apps/web/src/app/(dashboard)/equipo/AddMemberDialog.tsx`,
`BulkImportDialog.tsx`, `apps/web/src/components/layout/RoleSwitcher.tsx`,
`OrgSwitcher.tsx`, `apps/web/src/app/(dashboard)/importar/instrumento/DiaImportWizard.tsx`:

```typescript
const [pending, startTransition] = useTransition();

function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  const parsed = inviteMemberSchema.safeParse({ email, role });
  if (!parsed.success) {
    toast.error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
    return;
  }

  startTransition(async () => {
    try {
      await inviteMember(parsed.data);
      toast.success('Miembro agregado. Avísale para que inicie sesión con Google.');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al invitar');
    }
  });
}
```

Rules to follow (all observed consistently across the files above):
- Client-side Zod validation failures (`safeParse`) → `toast.error` with the first Zod issue
  message or a Spanish fallback, **return early**, never enter `startTransition`.
- Mutation success → `toast.success('<mensaje en español, describe qué pasó>')`.
- Mutation failure → `toast.error(err instanceof Error ? err.message : '<fallback en español>')`.
  Always guard with `instanceof Error` — `err` is `unknown` in a catch block.
- `useTransition`'s `pending` disables the submit button and swaps its label (see
  `apps/web/src/app/(dashboard)/equipo/AddMemberDialog.tsx:138-147`) — don't add separate
  `isLoading` state for this.

### 2. Server Actions never throw to the client — they return a `Result` type

Every `'use server'` action file wraps `apiGet`/`apiPost`/etc. in `try/catch` and returns a
discriminated union instead of throwing, so the client component decides how to surface it (almost
always via `toast.error(result.message)`). Confirmed in
`apps/web/src/app/(dashboard)/banco-items/[instrumentId]/proposal-actions.ts`,
`.../importar/instrumento/actions.ts`, `.../resultados/detalle/actions.ts`, and 6+ other
`actions.ts` files:

```typescript
type ApiError = Error & { status?: number };

export type ProposalActionResult =
  | { ok: true; data: ItemEditProposalModel }
  | { ok: false; message: string };

export async function proposeItemEdit(itemId: string, instruction: string): Promise<ProposalActionResult> {
  try {
    const data = await apiPost<ItemEditProposalModel>('/item-edit-proposals', { itemId, instruction });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}
```

Call site:

```typescript
const result = await previewDiaImport(data, meta);
if (!result.ok) {
  toast.error(result.message);
  return;
}
```

**Known duplication (not yet consolidated):** the `type ApiError = Error & { status?: number; ... }`
alias is copy-pasted at the top of at least 10 `actions.ts` files instead of living in one shared
place (e.g. `@/lib/errors` alongside `ApiConnectionError`). If you're touching one of these files,
consider hoisting it — but this is not blocking, just note it, don't invent a bigger fix mid-task.

### 3. Uncaught errors reaching the App Router boundary → `error.tsx` + `ApiError`

`apps/web/src/app/error.tsx` and `apps/web/src/app/(dashboard)/error.tsx` are Next.js
[error boundaries](https://nextjs.org/docs/app/building-your-application/routing/error-handling).
They render the shared `components/ui/api-error.tsx` component, branching on
`isConnectionError(error)` from `@/lib/errors`:

```typescript
'use client';
import { ApiError } from '@/components/ui/api-error';
import { isConnectionError } from '@/lib/errors';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ApiError
      type={isConnectionError(error) ? 'connection' : 'generic'}
      message={error.message}
      onRetry={reset}
    />
  );
}
```

This path only fires for errors thrown out of a Server Component render (e.g. an `apiGet` call in
a `page.tsx` that isn't wrapped in try/catch) — not for client mutations, which use pattern #1.

## Does the API wrapper give you a usable message?

Yes. `apps/web/src/lib/api.ts`'s `request()` extracts `body.message` from the JSON error body on
any non-`ok` response and throws it as an `ApiRequestError` (`apps/web/src/lib/errors.ts`):

```typescript
if (!res.ok) {
  const body = await res.json().catch(() => ({}));
  throw new ApiRequestError(res.status, (body as { message?: string }).message ?? `API error ${res.status}`);
}
```

So `err.message` in a `catch` (pattern #1) or `result.message` (pattern #2) is already the
backend's message when NestJS attaches one (validation errors, domain exceptions), and falls back
to `API error <status>` otherwise. **You don't need to re-parse the response body at the call
site** — the fallback string you pass to `toast.error(err.message ?? fallback)` is your only job.

`ApiConnectionError` (thrown when `fetch` itself fails — network down, backend unreachable) has a
fixed Spanish message (`'No se puede conectar con el servidor'`) and is detected via
`isConnectionError()`, used only by the `error.tsx` boundaries (pattern #3), not in mutation
catch blocks.

## `ApiRequestError` and `displayMessage` — telling controlled errors from crashes

`err.message`/`result.message` (above) is the backend's raw message **whatever the status code**
— for a `BadRequestException`/`ConflictException` that's a curated Spanish string meant for the
user (every domain exception in `apps/api` already throws one, see `../backend/03-helpers-vs-services.md`
§"Failure handling"), but for an unhandled 500 it can be NestJS's generic `"Internal server error"`
or a stack-trace fragment — not something to put in a toast. `ApiRequestError` (thrown by every
`apiGet`/`apiPost`/`apiPatch`/`apiPut`/`apiDelete`/`apiPostFormData` call in `lib/api.ts`) makes
that distinction explicit instead of relying on every call site to know it:

```typescript
// apps/web/src/lib/errors.ts
export class ApiRequestError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly displayMessage: string;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
    // 4xx = our own code threw an HttpException on purpose, message is curated Spanish text.
    // 5xx = unhandled/uncontrolled failure, message may not be safe or meaningful to show.
    this.displayMessage = status < 500 ? message : GENERIC_SERVER_ERROR_MESSAGE;
  }
}

export function getDisplayMessage(error: unknown, fallback = GENERIC_SERVER_ERROR_MESSAGE): string {
  if (error instanceof ApiRequestError) return error.displayMessage;
  if (error instanceof ApiConnectionError) return error.message;
  return fallback;
}
```

**This is a drop-in, backward-compatible change** — `ApiRequestError extends Error` and keeps
`.message`/`.status`/`.details`, so every existing `err instanceof Error ? err.message : fallback`
call site (pattern #1) and every `(e as ApiError).message` cast (pattern #2) keeps behaving exactly
as before. Nothing needed migrating for this to land.

**How to adopt it going forward (progressive, not a mass migration):**

- **New code**: use `getDisplayMessage(err, '<fallback en español>')` instead of
  `err instanceof Error ? err.message : fallback` (pattern #1) or `(e as ApiError).message`
  (pattern #2). One call, no `instanceof`/casting at the call site, and 5xx failures stop leaking
  raw backend text into a toast.
- **Touching an existing file for an unrelated reason**: swapping its `err.message` fallback logic
  for `getDisplayMessage(err, fallback)` is a reasonable drive-by fix — same spirit as the
  `PageHeader`/color-token drive-by fixes elsewhere in these rules — but don't do it as a standalone
  sweep across all ~30 files.
- **The `type ApiError = Error & { status?: number }` duplication** flagged above (10+ `actions.ts`
  files) is the natural thing to retire once a file adopts `getDisplayMessage` — you no longer need
  the local alias or the cast, `ApiRequestError`'s fields are already typed.
- Don't reach for `getDisplayMessage` on errors that never come from `lib/api.ts` (e.g. a client-side
  Zod `safeParse` failure) — those already have a purpose-built message, just pass it to
  `toast.error` directly as pattern #1 does today.

## `Toaster` setup

`apps/web/src/components/ui/sonner.tsx` wires theme (`next-themes`), custom icons per variant
(`CircleCheck`/`Info`/`TriangleAlert`/`OctagonX`/`LoaderCircle`), and token-based classNames
(`bg-background`, `text-foreground`, `border-border` — no hardcoded colors, consistent with
AGENTS.md §4). Don't pass ad hoc `style`/className overrides at call sites for one-off toasts —
if a new toast style is needed, extend `toastOptions` in `sonner.tsx`.

## What NOT to do

- Don't invent a `reportError`/`globalNotify` wrapper — it doesn't exist here. If the team decides
  to centralize toast calls later, that's a deliberate migration, not something to bolt on
  piecemeal in a feature PR.
- Don't hold error messages in component `useState` to render inline — none of the real dialogs do
  this; they all go through `toast.error`.
- Don't swallow an error with a hardcoded message when `err.message` (or `result.message`) already
  carries the backend's specific Spanish text — only override it with a fallback when `err` isn't
  an `Error` instance.
