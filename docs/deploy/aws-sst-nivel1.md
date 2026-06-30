# Despliegue AWS — Nivel 1 (dev, optimizado para costo)

Despliegue 100% por CLI/código con **SST v3**. Un solo `sst.config.ts` provisiona todo:

| Capa | Corre en (AWS) | Componente SST |
|---|---|---|
| Frontend (Next.js) | CloudFront + Lambda (OpenNext) | `sst.aws.Nextjs` |
| Backend (NestJS) | ECS Fargate ARM (0.25 vCPU / 0.5 GB) tras ALB público | `sst.aws.Service` |
| BDD (Postgres) | RDS `t4g.micro` Single-AZ | `sst.aws.Postgres` |
| Archivos | S3 | `sst.aws.Bucket` |
| Red | VPC con fck-nat (`nat: "ec2"`) + bastion | `sst.aws.Vpc` |

> Región: `us-east-1`. Stage de ejemplo: `dev`.

---

## 0. Prerrequisitos (una vez)

- **Docker Desktop** corriendo (SST construye la imagen del backend localmente; tu Mac es ARM → build nativo arm64, rápido).
- **Node 20 + pnpm 10** (ya en el repo).
- **Cuenta AWS** con acceso a la consola.

---

## 1. Crear credenciales IAM (ÚNICO paso manual)

Algo tiene que autenticar el primer comando. Esto se hace una vez.

1. Consola AWS → **IAM** → **Users** → **Create user**.
   - Nombre: `edtech-deployer`.
   - **No** marcar "provide user access to the Console" (solo se usará por CLI).
2. **Permissions** → Attach policies directly → `AdministratorAccess`
   _(En dev es lo pragmático. Más adelante se restringe con una policy mínima de SST.)_
3. Crear el usuario → entrar al usuario → pestaña **Security credentials** → **Create access key** → caso de uso **Command Line Interface (CLI)** → confirmar.
4. Copiar **Access key ID** y **Secret access key** (el secret se muestra una sola vez).

Configurar el perfil local:

```bash
aws configure --profile edtech
# AWS Access Key ID:     <pegar>
# AWS Secret Access Key: <pegar>
# Default region name:   us-east-1
# Default output format:  json
```

Usar este perfil en toda la sesión:

```bash
export AWS_PROFILE=edtech
```

---

## 2. Instalar SST

Desde la raíz del repo (worktree `infra/aws-sst`):

```bash
pnpm add -D -w sst
```

---

## 3. Definir secretos (por CLI, no consola)

`AuthSecret`, `SoeAppPassword` y `DbMasterPassword` no tienen default → hay que setearlos.
`AuthSecret` **debe** ser el mismo valor para web y api (NestJS valida el JWE de NextAuth).

```bash
# Genera valores aleatorios fuertes:
npx sst secret set AuthSecret        "$(openssl rand -base64 32)" --stage dev
npx sst secret set InternalApiSecret "$(openssl rand -base64 32)" --stage dev
npx sst secret set SoeAppPassword    "$(openssl rand -base64 24 | tr -d '/+=')" --stage dev
npx sst secret set DbMasterPassword  "$(openssl rand -base64 24 | tr -d '/+=')" --stage dev

# LLM (opcional para la demo base; setear la key del proveedor activo):
npx sst secret set LlmProvider  gemini --stage dev
npx sst secret set GeminiApiKey "<tu-key>" --stage dev

# Auth: 'mock' para la primera demo (dropdown del seed). Cambiar a 'sso' cuando
# tengas las apps OAuth (ver §7).
npx sst secret set AuthMode mock --stage dev
```

> Los passwords de Postgres evitan `/ + =` para no romper la URL de conexión.

---

## 4. Desplegar la infraestructura

```bash
npx sst deploy --stage dev
```

Crea VPC, RDS, ECS/Fargate, ALB, CloudFront, S3, Lambdas. Al final imprime los outputs:
`web` (URL CloudFront), `api` (URL del ALB), `dbHost`, `bucket`.

> ⚠️ **Orden BDD (chicken-and-egg):** la API arranca conectando con el rol `soe_app`,
> que aún no existe. Mientras ECS descarga la imagen y levanta la task (~2-3 min),
> ejecutá el §5 en otra terminal para provisionar la BD. Cuando el rol exista y las
> migraciones estén aplicadas, la task pasa a *healthy* (ECS reintenta sola).

---

## 5. Provisionar BDD: roles RLS + migraciones

El RDS está en subred privada. Abrí un túnel con el bastion (otra terminal):

```bash
# Una sola vez por máquina (instala routing; pide sudo):
sudo npx sst tunnel install

# Abrir el túnel (dejar corriendo):
npx sst tunnel --stage dev
```

Con el túnel abierto, obtené las URLs de conexión y corré, **en este orden**:

```bash
# Las URLs reales (con el host del RDS) las da el deploy / `sst shell`.
# Atajo: exportá ADMIN y la password de soe_app.
export DATABASE_ADMIN_URL="postgresql://soe_admin:<DbMasterPassword>@<dbHost>:5432/soe"
export SOE_APP_PASSWORD="<SoeAppPassword>"

# 1) Crear el rol soe_app (sin BYPASSRLS) + GRANTs + default privileges:
pnpm --filter @soe/db db:provision-roles

# 2) Migraciones (schema + re-aplica rls-policies.sql) con el rol admin:
pnpm --filter @soe/db db:migrate

# 3) (Opcional) Datos de demo para stakeholders:
DATABASE_URL="$DATABASE_ADMIN_URL" pnpm --filter @soe/db db:seed
```

> Usar `pnpm --filter @soe/db db:migrate` (no `pnpm db:migrate`): el script directo
> deja pasar `DATABASE_ADMIN_URL`; el de turbo lo filtra del entorno.

A los pocos segundos la task de la API queda *healthy*. Verificá:

```bash
curl <api-url>/api/health   # o el endpoint de health que exponga app.controller
```

---

## 6. Abrir la app

Andá a la URL `web` (CloudFront) que imprimió el deploy. Con `AuthMode=mock` entrás con
el dropdown de usuarios del seed.

---

## 7. (Después) Activar SSO real

1. Crear apps OAuth en Google Cloud / Azure AD.
2. **Redirect URI** = `https://<web-url>/api/auth/callback/google` (y el de Microsoft).
3. Cargar secretos y cambiar el modo:

```bash
npx sst secret set GoogleClientId     "<id>"     --stage dev
npx sst secret set GoogleClientSecret "<secret>" --stage dev
npx sst secret set AuthMode           sso        --stage dev
npx sst deploy --stage dev
```

`AUTH_TRUST_HOST=true` ya está seteado, así que NextAuth infiere el host sin `NEXTAUTH_URL`.

---

## 8. Costo aproximado (Nivel 1, idle)

| Recurso | ~USD/mes |
|---|---|
| RDS `t4g.micro` Single-AZ | ~13 |
| ALB (base del Service público) | ~16 |
| Fargate 0.25 vCPU / 0.5 GB ARM | ~9 |
| fck-nat (`t4g.nano`) | ~3 |
| Bastion (`t4g.nano`) | ~3 |
| CloudFront + Lambda (web) | ~0-1 (pago por uso) |
| S3 | ~0 |
| **Total** | **~$45/mes** |

**Para bajar más** (Nivel 2): backend en Lambda (elimina ALB + Fargate), RDS con
auto-pause y quitar el bastion → idle ≈ casi $0. Trade-off: cold starts y el límite de
15 min de Lambda en imports grandes.

**Ahorro inmediato sin cambiar de nivel:** una vez provisionada la BD, podés quitar
`bastion: true` del `sst.config.ts` y redeployar (re-agregalo cuando necesites migrar).

---

## 9. Iterar y limpiar

```bash
# Preview aislada por rama/PR (URL propia para un stakeholder):
npx sst deploy --stage pr-123
npx sst remove --stage pr-123     # borra TODO ese stage

# Desarrollo local del día a día (no uses el cloud para esto):
npx sst dev --stage <tu-nombre>

# Bajar el entorno dev completo:
npx sst remove --stage dev
```

---

## Troubleshooting

- **`pnpm deploy --legacy` falla en el Docker build:** quitá `--legacy` (depende de la
  versión de pnpm). Es la línea final del stage `build` en `apps/api/Dockerfile`.
- **La task de la API hace crash-loop:** casi siempre es la BDD sin provisionar (§5) o el
  `SoeAppPassword` del secreto distinto al que se le puso al rol. Re-corré
  `db:provision-roles` con el mismo `SOE_APP_PASSWORD` y revisá CloudWatch Logs del servicio.
- **`sst tunnel` no conecta:** confirmá `bastion: true` en el VPC y que el deploy lo creó;
  reinstalá con `sudo npx sst tunnel install`.
- **CORS desde el browser:** hoy las llamadas son server-side (no aplica CORS). Si agregás
  fetch desde el cliente, usá un dominio propio y fijá `CORS_ORIGIN` al host del front.
