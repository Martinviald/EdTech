---
name: demo-db-access
description: >-
  Procedimiento seguro para leer, modificar o escribir datos en la base de datos
  DEMO (RDS Postgres privado) del proyecto EdTech en AWS (cuenta AcademOS, stage
  demo). Usar cuando el usuario pida consultar, actualizar, insertar, borrar o
  cargar datos (seeds, usuarios, accesos, resultados, evaluaciones) en la BDD demo
  del ambiente AWS. Cubre el acceso temporal al RDS privado (abrir→trabajar→revertir),
  las credenciales, ejecución de SQL vía tsx, el manejo de Row Level Security (RLS),
  la convención de acceso concurrente/en paralelo (túnel compartido) y los gotchas aprendidos.
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
cd "/Users/macbook/Dropbox/Mi Mac (MacBook Pro de MacBook)/Desktop/EdTech/repositorio"
export AWS_PROFILE=edtech
sudo npx sst tunnel install     # una sola vez por máquina (pide sudo)
npx sst tunnel --stage demo     # dejar CORRIENDO (no cerrar la terminal)
```

⚠️ **El `sst.config.ts` vive en `repositorio/`, no en un worktree `infra-aws-sst`** — ese
directorio NO existe (verificado 2026-08-30). Correr el túnel desde ahí falla con "no such
file or directory" y el mensaje no dice que el problema sea el cwd.

⚠️ **Conectate a la IP PRIVADA, no al hostname.** El DNS del RDS resuelve a su IP **pública**
aunque el túnel esté arriba (el RDS quedó con `PubliclyAccessible: true`), así que el
hostname NO se rutea por el túnel y el `nc` al puerto 5432 da timeout. La IP privada sale de
la ENI del RDS:

```bash
aws ec2 describe-network-interfaces --profile edtech --region us-east-1 \
  --query "NetworkInterfaces[?contains(Description,'RDS')].PrivateIpAddress" --output text
# → 10.0.12.143 (a hoy). Verificar SIEMPRE: cambia si se recrea la instancia.
nc -z -w 8 10.0.12.143 5432    # así se chequea si el túnel está vivo
```

Luego corres scripts con `DATABASE_ADMIN_URL` (§3/§4). No hay que revertir infra.

---

## 0. Concurrencia — acceso en paralelo (LEER antes de tocar el túnel)

Varias sesiones/agentes pueden trabajar contra la BDD demo a la vez. Postgres maneja las
conexiones concurrentes sin problema; lecturas y escrituras en datos **disjuntos** no chocan.
El viejo riesgo de "ventanas de acceso solapadas" **ya no aplica** (era del hack
`publicly-accessible` + `modify-db-instance`; el túnel SST no toca infra AWS).

**El único recurso contendido es el túnel: hay UN solo proceso por máquina, y se COMPARTE.**
Una vez que un túnel está arriba, es una ruta a nivel de máquina que **todas** las sesiones
usan. No levantes el tuyo si ya hay uno. Reglas:

1. **Antes de levantar, chequea si ya hay túnel:**
   `nc -z edtech-demo-dbinstance-cauoeshr.cm9sce4qi665.us-east-1.rds.amazonaws.com 5432`
   → si responde, **reúsalo** (conéctate directo con `DATABASE_ADMIN_URL`, no levantes otro;
   un segundo `sst tunnel` falla con *"Another tunnel process is already running"*).
2. **NUNCA `pkill -f "sst tunnel"` a ciegas** — eso mata el túnel de *todas* las sesiones.
   Baja solo el que tú levantaste, y solo si nadie más lo usa.
3. **Al terminar, deja el túnel ARRIBA** si otras sesiones pueden estar usándolo (no lo mates
   "por prolijidad"): cortarlo tumba las conexiones ajenas. Levantarlo de nuevo cuesta ~10s.
4. Si el `select 1` da `CONNECT_TIMEOUT` pero el DNS resuelve a `10.0.x.x`, es un túnel
   **muerto con caché DNS vieja** (o un lock stale): no hay proceso vivo → levántalo tú (§2).

**Coordinación de ESCRITURAS en reference-data compartida.** Estas tablas globales
(`orgId=null`) las comparten todas las sesiones; coordinar el timing si más de una las escribe:

| Tabla | Riesgo concurrente | Mitigación |
|---|---|---|
| `instruments` / `instrument_sections` / `items` | Bajo — `db:import:instruments` es idempotente por `config->>'sourceJson'` | Sin choque si los `sourceJson` difieren |
| `item_taxonomy_tags` | Choque solo si dos sesiones tocan los **mismos** ítems | Repartir por instrumento |
| **`taxonomy_nodes`** (re-seed / extensión de catálogo) | **Alto** — otras sesiones LEEN la taxonomía; un re-seed momentáneo puede afectar sus resolves/consultas | **Anunciar antes** de correrlo; no re-sembrar mientras otra sesión importa tags o lee taxonomía |

No hay canal directo entre sesiones: la coordinación es por el usuario (que avise) o por esta
convención. Ante duda con `taxonomy_nodes`, avisa antes de escribir.

---

## 1. Contexto / parámetros

| Qué | Valor |
|---|---|
| Cuenta AWS | AcademOS `604179600768` |
| Perfil / región | `AWS_PROFILE=edtech` · `us-east-1` |
| Stage | `demo` |
| DB instance id | `edtech-demo-dbinstance-cauoeshr` |
| Host | `edtech-demo-dbinstance-cauoeshr.cm9sce4qi665.us-east-1.rds.amazonaws.com` (resuelve a IP **pública**; ver Quick start) |
| IP privada (para el túnel) | `10.0.12.143` — re-verificar con `describe-network-interfaces` |
| Database | `soe` |
| Security group (RDS) | `sg-002c9fafa71da550a` |
| Internet Gateway | `igw-008f7bef242080563` |
| Route tables de las subredes del RDS | `rtb-056f639f179afee49`, `rtb-0afd0f626d2e3622b` |
| Rol admin (DDL/seed) | `soe_admin` (master) — password en Secrets Manager `edtech-demo-DbProxySecret-ksefwadx` |
| Rol runtime (la API) | `soe_app` (sin BYPASSRLS) — NO usar para admin |

Repo con las deps (`pnpm`, `tsx`, `@soe/db`) y con el `sst.config.ts`:
`/Users/macbook/Dropbox/Mi Mac (MacBook Pro de MacBook)/Desktop/EdTech/repositorio`
(cualquier worktree del monorepo sirve para los scripts, pero el túnel se levanta desde
donde esté `sst.config.ts`).

## 2. Acceso a la BDD — `sst tunnel` (por el bastión)

> ⚠️ **El viejo hack (abrir `publicly-accessible` + ruta a IGW) YA NO FUNCIONA.** La VPC
> ahora tiene NAT (`nat: "ec2"` en `sst.config.ts`), así que las subredes privadas rutean
> `0.0.0.0/0 → NAT`: no se puede agregar la ruta a IGW (conflicto) y `publicly-accessible`
> daría ruteo asimétrico. **El `with-db.sh` de este dir usa ese hack y quedó OBSOLETO.**

Usar **`sst tunnel`** (el bastión `bastion: true` ya está desplegado):

1. Una sola vez por máquina: `sudo npx sst tunnel install` (necesita sudo — instala el
   routing local).
2. Abrir el túnel y **dejarlo corriendo** en una terminal:
   `AWS_PROFILE=edtech npx sst tunnel --stage demo` (desde `repositorio/`, donde vive
   `sst.config.ts`).
3. Con el túnel arriba, conectar a la **IP privada** del RDS (ver Quick start), no al
   hostname. Verificar con `nc -z -w 8 10.0.12.143 5432` y luego un `select 1`.
4. **Gotcha DNS**: mientras el RDS siga `PubliclyAccessible: true` (ver §7), su hostname
   resuelve a una IP **pública** y flushear la caché NO lo arregla — no es caché, es el
   registro real. Por eso se usa la IP privada. Si algún día se cierra el acceso público,
   el hostname vuelve a resolver a `10.0.x.x` y sirve directo.
5. **No hay que revertir infra** (el túnel no toca AWS). Cerrar = Ctrl+C en su terminal.

El túnel y las escrituras coexisten sin ventanas ni `modify-db-instance`.

## 3. Credenciales

⚠️ **NO existe el SST secret `DbMasterPassword`** (`sst secret list --stage demo` no lo
lista; verificado 2026-08-30). La credencial de `soe_admin` está en **Secrets Manager**:

```bash
PW=$(aws secretsmanager get-secret-value --profile edtech --region us-east-1 \
  --secret-id edtech-demo-DbProxySecret-ksefwadx --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")

export DATABASE_ADMIN_URL="postgresql://soe_admin:${PW}@10.0.12.143:5432/soe?sslmode=require"
```

`sslmode=require` y no `verify-full`: al conectarse por IP el certificado no matchea el
hostname. Con psql: `psql "host=10.0.12.143 port=5432 user=soe_admin dbname=soe sslmode=require"`
y el password por `PGPASSWORD`.

`with-db.sh` quedó OBSOLETO: arma la URL con el secret inexistente y con el hack de
`publicly-accessible`.

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

- **Los seeds pesados por el túnel tardan ~20 min y hay que correrlos en background.** El
  import de los 20 ensayos PAES (1.407 ítems) son ~1.400 INSERT con latencia de túnel: en
  foreground se come cualquier timeout. `import-instruments.ts` es idempotente por
  `config->>'sourceJson'` y va por instrumento en su propia transacción, así que una corrida
  cortada a la mitad se re-lanza sin limpiar nada.

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
- **⚠️ NO re-importar reference-data por delete+recreate una vez que tiene tags/relaciones dependientes.**
  `import-instruments.ts` borra+recrea instrumentos→ítems (regenera los UUID). Si ya cargaste
  `item_taxonomy_tags` (o cualquier fila que referencie `items.id`), un re-import los **orfana**
  (con `ON DELETE CASCADE` los **borra**). Para agregar un campo a ítems ya cargados (ej. `imageRef`
  en `scoring_config`), usá **UPDATE in-place** matcheando por `instrument.config->>'sourceJson'` +
  `position`, no re-import. (Aprendido cargando figuras DIA 2026 sobre ítems ya tagueados.)
- **Imports largos por el túnel se caen** (`CONNECTION_CLOSED`/`ECONNRESET` a mitad), sobre todo con
  otra sesión usando el túnel a la vez. Solución: **chunkear** — dividir el input en lotes chicos y
  correr un **proceso corto por lote** (idempotente, así re-correr un lote fallido es gratis). Un import
  de 34 instrumentos que se caía a los ~2 min se completó en chunks de 5 sin problemas.
- **Si un seed/script `tsx` falla con `X is not a function` / `undefined` de `@soe/types`** (ej.
  `toApplicationPeriod`), el **dist está stale**: `pnpm --filter @soe/types build` y reintentá. `tsx`
  no typechequea, así que el error solo aparece en runtime.
- **El helper del túnel corre como root** (`sudo -n /opt/sst/tunnel`), así que un `pkill` no-root da
  `Operation not permitted` — no se puede matar sin sudo. Si el túnel quedó zombie, levantá uno
  **fresco** (suele arrancar igual, el lock stale no lo bloquea) en vez de intentar matar el viejo.
- **DNS puede resolver a `10.0.x.x` pero las conexiones dan `ECONNRESET/timeout`**: es túnel muerto +
  caché DNS vieja, o agotamiento de conexiones del RDS por reintentos/otra sesión. Esperá ~30-60 s a
  que el RDS reape las idle, o levantá túnel fresco; no asumas que `nc -z` OK = conexión sana.

## 7. Seguridad

- **NUNCA dejar el RDS público.** Siempre revertir (el `trap` lo garantiza). Verificá
  `PubliclyAccessible=false` al final.

  ⚠️ **Hoy NO se cumple** (verificado 2026-08-30): el RDS demo está con
  `PubliclyAccessible: true` y el security group `sg-002c9fafa71da550a` tiene el 5432 abierto
  a `181.43.242.253/32` — una IP fija, residuo de una sesión vieja del hack obsoleto. Está
  pendiente cerrarlo. Chequeo:

  ```bash
  aws rds describe-db-instances --profile edtech --region us-east-1 \
    --query "DBInstances[].{ep:Endpoint.Address,public:PubliclyAccessible}" --output table
  ```

  Mientras siga público, el DNS del RDS resuelve a la IP pública y hay que conectarse por la
  privada (ver Quick start).
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
