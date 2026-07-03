# @soe/db — Base de datos (Drizzle + PostgreSQL)

Fuente de verdad del schema, migraciones, seeds y del **Row Level Security (RLS)** multi-tenant.

## ⚠️ Regla crítica: el RLS NO vive en el schema Drizzle

Las políticas RLS de PostgreSQL (aislamiento multi-tenant, Ley 19.628) **no** se pueden
expresar en los archivos `src/schema/*.ts`. Por eso viven en SQL plano versionado:

- **`sql/rls-policies.sql`** — fuente de verdad de las políticas. Idempotente
  (`DROP POLICY IF EXISTS` + `CREATE`, `ENABLE` + `FORCE ROW LEVEL SECURITY`).
- **`src/migrate.ts`** lo aplica **siempre** al final de `db:migrate`, después de
  `migrate()`. Como drizzle-kit no conoce este SQL, **cualquier `db:generate` o
  aplanamiento de migraciones NO lo afecta** y se vuelve a aplicar solo.

> **Por qué existe este mecanismo:** el RLS ya se perdió una vez (commit `53aa242`)
> al aplanar 9 migraciones en una sola — drizzle-kit regeneró el SQL desde los
> `schema/*.ts`, que nunca tuvieron RLS, y las políticas desaparecieron sin error.
> **No borres `sql/rls-policies.sql` ni quites su aplicación en `migrate.ts`.**

### Si agregas una tabla con datos sensibles por colegio

1. Agrégala al schema y genera la migración (`pnpm db:generate`).
2. Añade su `ENABLE`/`FORCE ROW LEVEL SECURITY` + política `*_tenant_isolation` a
   `sql/rls-policies.sql` (con `org_id` directo, o `EXISTS` sobre `assessments` si
   hereda el tenant).
3. En la API, toda query a esa tabla debe correr dentro de
   `withOrgContext(db, orgId, tx => ...)`.

## Tablas con RLS activo

`students`, `assessments`, `import_jobs` (org_id directo) y `responses`,
`assessment_results`, `skill_results` (heredan el tenant vía `assessments`).

`performance_bands` y `llm_settings` usan `org_id` **NULLABLE**: las filas con
`org_id IS NULL` son catálogo/config GLOBAL de plataforma (visibles a todos los
tenants y legibles sin contexto de org). En `llm_settings` la config global la
escribe la API (panel /configuracion/modelos-ia); la autorización es el role guard
`platform_admin`, no el RLS.

## withOrgContext (regla de la capa de aplicación)

`set_config('app.current_org_id', orgId, true)` se fija por transacción mediante
`withOrgContext` (`src/with-org-context.ts`). **Sin contexto, RLS devuelve 0 filas**
(safe default). Por eso TODA query de la API a las 6 tablas debe envolverse:

```ts
return withOrgContext(this.db, orgId, async (tx) => {
  return tx.select().from(students).where(...); // RLS filtra por org automáticamente
});
```

## Roles de Postgres (enforcement real)

RLS solo filtra si la conexión **no** bypassa RLS. Superusers y roles `BYPASSRLS`
siempre bypassan. Modelo de dos roles (ver `sql/roles.sql`):

| Conexión | Variable de entorno | Rol | RLS |
|---|---|---|---|
| API runtime | `DATABASE_URL` | `soe_app` (NOBYPASSRLS) | **aplica** |
| migrate / seed / reset | `DATABASE_ADMIN_URL` (cae a `DATABASE_URL`) | owner/superuser | bypassa |

`FORCE ROW LEVEL SECURITY` asegura que el RLS aplique incluso al dueño de la tabla.
La API emite un warning de arranque si detecta que conecta con un rol que bypassa RLS.

## Scripts

```bash
pnpm db:generate   # genera migración desde schema (NO toca rls-policies.sql)
pnpm db:migrate    # aplica migraciones + re-aplica rls-policies.sql (idempotente)
pnpm db:seed       # carga datos demo base (usa DATABASE_ADMIN_URL → bypassa RLS)
pnpm db:seed:dev   # ⭐ SEED MAESTRO dev/testing: las 6 seeds en orden (ver abajo)
pnpm db:migrate:dev # migra y luego corre db:seed:dev — el flujo post-migración
pnpm db:reset      # reset-schema + migrate:dev (destructivo, solo local)
```

### Seed maestro de dev/testing (`db:seed:dev`)

Reseedea un entorno local completo para testear cambios. Corre las 6 seeds en el
**orden de dependencias correcto** (todas idempotentes: borran-y-recrean por
namespace de UUID, así que se puede re-ejecutar sin duplicar):

| # | Seed | Aporta | Depende de |
|---|---|---|---|
| 1 | `index.ts` | Orgs demo + usuarios mock (admin/director/teacher) | — |
| 2 | `taxonomy-real.ts` | Taxonomía real (marcos Currículum Nacional + DIA) | — |
| 3 | `import-instruments.ts` | 24 instrumentos · 77 secciones · 612 ítems | (2) taxonomía |
| 4 | `import-item-tags.ts` | ~2131 `item_taxonomy_tags` | (2)(3) |
| 5 | `e2e-testing.ts` | 5 cursos · 74 alumnos · 10 evals · respuestas + resultados | (1)(2) |
| 6 | `benchmark-demo.ts` | Cohorte de benchmarking (modo global + red) | — |

**Uso típico tras una migración** (para validar los cambios en local):

```bash
pnpm db:migrate:dev   # = db:migrate + db:seed:dev
```

> Solo dev/testing. NO ejecutar en staging/producción (carga data demo).
> `import-cscj-roster.ts` (roster real de CSCJ, PII) NO está incluida a propósito:
> es data real, tiene dry-run por defecto y se corre aparte con `--commit`.
