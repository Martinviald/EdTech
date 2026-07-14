---
name: demo-db-access
description: >-
  Procedimiento seguro para leer, modificar o escribir datos en la base de datos
  DEMO (RDS Postgres privado) del proyecto EdTech en AWS (cuenta AcademOS, stage
  demo). Usar cuando el usuario pida consultar, actualizar, insertar, borrar o
  cargar datos (seeds, usuarios, accesos, resultados, evaluaciones) en la BDD demo
  del ambiente AWS. Cubre el acceso temporal al RDS privado (abrir→trabajar→revertir),
  las credenciales, ejecución de SQL vía tsx, el manejo de Row Level Security (RLS)
  y los gotchas aprendidos.
---

# Acceso a la BDD demo (RDS) — EdTech en AWS

La BDD demo es un **RDS Postgres PRIVADO dentro de una VPC**: no es alcanzable desde
el laptop por defecto. Para trabajar con ella hay que **abrir acceso temporal**,
hacer el trabajo, y **REVERTIR siempre** (nunca dejar el RDS público).

> ⚠️ Regla de oro: toda apertura de acceso se hace en **un solo comando bash con
> `trap ... EXIT`** para que el cierre ocurra pase lo que pase. Y **dos ventanas de
> acceso NO deben solaparse** (dos `modify-db-instance` concurrentes → `InvalidDBInstanceState`).

## Quick start

El acceso es vía **`sst tunnel`** (por el bastión ya desplegado). Levantar el túnel en una
terminal dedicada y dejarlo CORRIENDO:

```bash
cd "/Users/macbook/Dropbox/Mi Mac (MacBook Pro de MacBook)/Desktop/EdTech/infra-aws-sst"
export AWS_PROFILE=edtech
sudo npx sst tunnel install     # una sola vez por máquina (pide sudo)
npx sst tunnel --stage demo     # dejar CORRIENDO (no cerrar la terminal)
```

Con el túnel arriba, el endpoint del RDS resuelve a su IP privada (10.0.x.x) y se rutea por
el túnel. Luego corres scripts con `DATABASE_ADMIN_URL` (§3/§4). No hay que revertir infra.

---

## 1. Contexto / parámetros

| Qué | Valor |
|---|---|
| Cuenta AWS | AcademOS `604179600768` |
| Perfil / región | `AWS_PROFILE=edtech` · `us-east-1` |
| Stage | `demo` |
| DB instance id | `edtech-demo-dbinstance-cauoeshr` |
| Host | `edtech-demo-dbinstance-cauoeshr.cm9sce4qi665.us-east-1.rds.amazonaws.com` |
| Database | `soe` |
| Security group (RDS) | `sg-002c9fafa71da550a` |
| Internet Gateway | `igw-008f7bef242080563` |
| Route tables de las subredes del RDS | `rtb-056f639f179afee49`, `rtb-0afd0f626d2e3622b` |
| Rol admin (DDL/seed) | `soe_admin` (master) — password = SST secret `DbMasterPassword` |
| Rol runtime (la API) | `soe_app` (sin BYPASSRLS) — NO usar para admin |

Worktree del repo con las deps (`pnpm`, `tsx`, `@soe/db`):
`/Users/macbook/Dropbox/Mi Mac (MacBook Pro de MacBook)/Desktop/EdTech/infra-aws-sst`
(cualquier worktree del monorepo sirve; ese tiene `node_modules` instalado).

## 2. Acceso a la BDD — `sst tunnel` (por el bastión)

> ⚠️ **El viejo hack (abrir `publicly-accessible` + ruta a IGW) YA NO FUNCIONA.** La VPC
> ahora tiene NAT (`nat: "ec2"` en `sst.config.ts`), así que las subredes privadas rutean
> `0.0.0.0/0 → NAT`: no se puede agregar la ruta a IGW (conflicto) y `publicly-accessible`
> daría ruteo asimétrico. **El `with-db.sh` de este dir usa ese hack y quedó OBSOLETO.**

Usar **`sst tunnel`** (el bastión `bastion: true` ya está desplegado):

1. Una sola vez por máquina: `sudo npx sst tunnel install` (necesita sudo — instala el
   routing local).
2. Abrir el túnel y **dejarlo corriendo** en una terminal:
   `AWS_PROFILE=edtech npx sst tunnel --stage demo` (desde un worktree del monorepo).
3. Con el túnel arriba, el endpoint resuelve a la IP privada (10.0.x.x) y se rutea por el
   túnel. Conectar con `DATABASE_ADMIN_URL` (endpoint, §3). Verificar con un `select 1`.
4. **Gotcha DNS**: si el endpoint resuelve a una IP pública (52.x, cacheada de cuando el RDS
   estuvo `publicly-accessible`), flushear: `sudo dscacheutil -flushcache && sudo killall
   -HUP mDNSResponder` (o esperar ~1 min tras un cambio de estado del RDS). Confirmar con
   `nslookup <host>` → debe dar `10.0.x.x`.
5. **No hay que revertir infra** (el túnel no toca AWS). Cerrar = Ctrl+C en su terminal.

El túnel y las escrituras coexisten sin ventanas ni `modify-db-instance`.

## 3. Credenciales

El password del master (`soe_admin`) es el **SST secret `DbMasterPassword`**. Para obtenerlo:

```bash
cd "/Users/macbook/Dropbox/Mi Mac (MacBook Pro de MacBook)/Desktop/EdTech/infra-aws-sst"
AWS_PROFILE=edtech npx sst secret list --stage demo   # muestra "DbMasterPassword = ..."
```

Con eso:
```
DATABASE_ADMIN_URL="postgresql://soe_admin:<DbMasterPassword>@<HOST>:5432/soe"
```
`with-db.sh` lo arma solo (lee el secret si no pasás `DB_MASTER_PW` por env).

## 4. Ejecutar SQL

Usar un **script tsx** con el cliente `postgres` (dep de `@soe/db`), corrido desde un
worktree del repo:

```bash
pnpm --filter @soe/db exec tsx /ruta/al/script.ts
```

Ejemplo mínimo (ver `query.ts` en este dir):
```ts
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_ADMIN_URL as string, { max: 1 });
(async () => {
  const rows = await sql`select id, name from organizations order by name`;
  console.log(rows);
  // DDL / SQL dinámico: sql.unsafe(`ALTER TABLE ...`)
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
```

## 5. RLS (CRÍTICO)

**~9 tablas tienen `FORCE ROW LEVEL SECURITY`:** `students`, `assessments`,
`import_jobs`, `responses`, `assessment_results`, `skill_results`, `performance_bands`,
`ai_analyses`, `org_benchmark_settings`.

El master de RDS **NO es superusuario real** (es `rds_superuser`) → **NO bypassa FORCE RLS**.
Consecuencias:

- **LEER** una de esas tablas como admin devuelve **0 filas** salvo que fijes el contexto de org:
  ```ts
  await sql`select set_config('app.current_org_id', '<orgId>', false)`;
  const n = await sql`select count(*)::int c from students`; // ahora sí ve las de esa org
  ```
- **ESCRIBIR** en esas tablas sin contexto → **falla / bloqueado**. Dos opciones:
  - **(a)** Usar `withOrgContext(db, orgId, tx => ...)` de `@soe/db` (fija `app.current_org_id`
    en la transacción; usar `tx`, no `db`).
  - **(b)** Desactivar FORCE temporalmente, escribir, y restaurar:
    ```ts
    // desactivar en todas las forzadas:
    const t = await sql`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relforcerowsecurity`;
    for (const r of t) await sql.unsafe(`ALTER TABLE public."${r.relname}" NO FORCE ROW LEVEL SECURITY`);
    // ... escribir ...
    ```
    y **restaurar** con `pnpm --filter @soe/db db:migrate` (re-aplica `packages/db/sql/rls-policies.sql`
    con FORCE). Ese `db:migrate` corre dentro de la MISMA ventana de acceso.

Los seeds del repo que respetan RLS usan `withOrgContext` (ej. `import-cscj-roster.ts`);
los que asumen bypass (ej. el seed base `index.ts`) requieren la opción (b) en RDS.

## 6. Gotchas (aprendidos en producción)

- **zsh no hace word-splitting de `$var`** en `for X in $VAR` (trata todo como un token).
  Usar **listas literales** (`for RTB in rtb-aaa rtb-bbb`) o `${=VAR}`. (En cambio `$(cmd)`
  SÍ splitea en zsh.) `with-db.sh` usa `#!/usr/bin/env bash` para evitar esto.
- **`${PIPESTATUS[0]}` es un bashism** → en zsh es `$pipestatus[1]`. Para exit codes fiables:
  redirigir a archivo y `echo $?` (no pipear a `tail`).
- **UUIDs deben ser hex válido** (0-9, a-f). Nada de `d3m0...` (la `m` no es hex) → `string_to_uuid` error.
- **En RDS `ALTER ROLE ... NOSUPERUSER/NOBYPASSRLS` FALLA** (el master no es superuser).
  El `ALTER ROLE` solo debe setear `LOGIN` + `PASSWORD`; los atributos van en el `CREATE`.
- **Idempotencia**: usar UUIDs fijos + `onConflictDoNothing` (o `onConflictDoUpdate`) para
  poder re-correr sin duplicar.
- Los **modify-db-instance tardan minutos**; corré el comando en background y no solapes ventanas.

## 7. Seguridad

- **NUNCA dejar el RDS público.** Siempre revertir (el `trap` lo garantiza). Verificá
  `PubliclyAccessible=false` al final.
- **PII real**: la org **CSCJ** (`c5c10000-0000-0000-0000-000000000001`) tiene el **roster
  REAL de ~1300 alumnos** (nombres/RUTs, Ley 19.628). No exponerla ni volcarla a logs/archivos
  versionados. Otras orgs (Colegio Demo `dec00000-...`, red Andes `b3c00000-...`) son sintéticas.
- El rol de la API en runtime es `soe_app` (sin BYPASSRLS) — no lo uses para admin; usá `soe_admin`.

## IDs de referencia útiles

| Org | UUID | Notas |
|---|---|---|
| CSCJ (Colegio Sagrado Corazón de La Reina) | `c5c10000-0000-0000-0000-000000000001` | roster real (PII) |
| Fundación Tupungato (padre de CSCJ) | `c5c10000-0000-0000-0000-0000000000f0` | |
| Colegio Andes Centro (red demo) | `b3c00000-0000-0000-0000-000000000001` | foco benchmarking |
| Colegio Demo | `dec00000-0000-0000-0000-000000000001` | sintético |
