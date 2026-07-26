# Helpers vs Services — Where Logic Lives

> Applies to files you **create or modify** in `apps/api/`. See CLAUDE.md §4.3 for the Controller → Service → Drizzle layering this rule sits inside.

A **helper** holds reusable logic that operates **only on its parameters** — it does not take `db`, does not query Drizzle, and does not import another `*Service`. The moment logic touches the DB or calls a service, it stops being a helper and must live at the service level.

## Decide by where it's used first, then by what it touches

Lead with **how many places use it**, not with purity. Logic with a single caller stays in the file that uses it — do **not** spin off a `*.helpers.ts` (or any new file) for it. Scattering single-use functions into separate helper files just spreads the code across the tree and makes it harder for both people and Claude to follow. A shared file earns its place only once the logic is reused across files.

| Where it's used | Pure (params only) | Touches `db` (Drizzle) / a `*Service` |
|---|---|---|
| **One service only** | **Private method** of that service — same file, no separate `helpers.ts`. | **Private method** of that service |
| **Reused across files** | Shared `*.helpers.ts` | **Its own service** (`*.service.ts`) |

```
Is it used only inside this one service?
├─ Yes → keep it in the same file
│        ├─ pure (params only)      → private method
│        └─ touches db / a service  → private method
└─ No (reused across files)
         ├─ pure (params only)      → shared *.helpers.ts
         └─ touches db / a service  → its own service
```

Inline (nested) functions aren't banned — a trivial one-off transform can stay a local arrow. Just don't reach for one as the default: if the logic is worth a name, prefer a private method.

## Reuse before adding — search first, then promote

Before writing a new helper, search for one that already does the job:

- `packages/types/src/utils/` — cross-cutting pure helpers shared by `api` and `web`: `rut.ts` (`normalizeRut`), `curso-parser.ts` (`parseCursoLabel`), `grade-calculator.ts`, `roles.ts` (`userHasRole`, `userHasAnyRole`).
- `packages/types/src/access-policies.ts` — role/access constants (`CURRICULUM_ROLES`, `IMPORT_ROLES`, etc.) and `canAccess()`. Never duplicate a role list inline in a controller or page (CLAUDE.md §6.3).
- `packages/db/src/` — schema (`packages/db/src/schema/`) and `withOrgContext` (`packages/db/src/with-org-context.ts`), the RLS-context wrapper every query on a tenant table must run inside (CLAUDE.md §5.2).
- The feature's own `<domain>/<domain>.helpers.ts` inside `apps/api/src/<domain>/`, and sibling `*.service.ts` files in the same module.

Generic-sounding logic (RUT normalization, curso-label parsing, role checks) almost always already exists in `packages/types`.

If you find one that fits:

- **Reuse it in place** when it already lives at a scope you can import from.
- **Promote it up** when it lives at a narrower scope than you now need — a helper local to one module that a second module now needs moves up to the nearest shared level (`packages/types/src/utils/` for cross-app, `apps/api/src/<domain>/` for cross-file within one domain). Move it and update the original caller's import; never copy-paste it into a second location.

Only add a new helper when the search comes up empty.

## Failure handling — no `Result<T>`/`BaseService`

AcademOS services do **not** use a `Result<T>`/`BaseService` wrapper pattern — there is no such abstraction in `apps/api/src` (grep it: `BaseService` and `Result<` don't appear as a shared convention). Services return typed values directly and signal failure by **throwing standard NestJS exceptions**, which NestJS's exception filters turn into the `{ statusCode, message, error }` response shape from CLAUDE.md §6.2:

```typescript
// apps/api/src/students/students-import.service.ts
if (!row) {
  throw new BadRequestException(
    'Debes configurar el año académico antes de importar alumnos.',
  );
}

if (willCreateCount > 0 && !confirmCreateMissingCourses) {
  throw new ConflictException({
    message: 'Se detectaron cursos que aún no existen. Confirma su creación para continuar.',
    newClassGroups: /* ... */,
  });
}
```

`BadRequestException`, `ConflictException`, `NotFoundException`, `ForbiddenException` (from `@nestjs/common`) are used this way throughout `apps/api/src/**/*.service.ts` (e.g. `items.service.ts`, `heatmap.service.ts`, `assessment-results.service.ts`). Prefer this over inventing a result envelope.

## Worked example (real pattern already in the codebase)

`apps/api/src/students/students-import.service.ts` (`StudentsImportService`) and `apps/api/src/students/students-import.helpers.ts` show the split cleanly:

- `students-import.helpers.ts` is pure — `parseStudentRosterCsv(buffer)`, `chunk(arr, size)`. No `db`, no service imports. It's reused (helpers are imported by the service and unit-tested standalone in `students-import.helpers.spec.ts`), so it earns its own file.
- `StudentsImportService` injects Drizzle the standard way — `constructor(@InjectDb() private readonly db: Database) {}` — and does all the DB work: `requireCurrentAcademicYearId`, `resolveCourses`, and the `withOrgContext(this.db, orgId, async (tx) => { ... })` transaction in `commit()`. These are **private methods** of the service, not a `helpers.ts`, because each is used only inside `StudentsImportService`.

```typescript
@Injectable()
export class StudentsImportService {
  constructor(@InjectDb() private readonly db: Database) {}

  async commit(/* ... */) {
    const parsed = this.parseCsvOrThrow(file);          // wraps the pure helper, throws on failure
    // ...
    const jobId = await withOrgContext(this.db, orgId, async (tx) => {
      // inserts/upserts using tx, not this.db — see CLAUDE.md §5.2
    });
    return { jobId, /* ... */ };
  }

  private parseCsvOrThrow(file: Buffer) {
    const parsed = parseStudentRosterCsv(file);          // pure helper from students-import.helpers.ts
    if (!parsed.ok) throw new BadRequestException(/* ... */);
    return parsed;
  }

  private async requireCurrentAcademicYearId(orgId: string): Promise<string> { /* db query */ }
  private async resolveCourses(/* ... */) { /* db query */ }
}
```

If `resolveCourses` or `requireCurrentAcademicYearId` needed to be called from a second service (e.g. a future bulk-enrollment feature), that's the trigger to promote it into its own service under `apps/api/src/students/` — not before.

## Exception

A thin wrapper that only forwards `db` without querying is a judgment call — prefer the service form when in doubt. Don't stretch "helper" to avoid creating a service.
