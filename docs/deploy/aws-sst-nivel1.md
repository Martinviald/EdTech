# Despliegue AWS — App Runner + SST/OpenNext + RDS

Despliegue por código (un solo `sst.config.ts`, SST corre sobre Pulumi así que App Runner
se define con el provider crudo `aws.*`). Stage: `production`. Región: `us-east-1`.

| Capa | Corre en (AWS) | Definido con |
|---|---|---|
| Frontend (Next.js) | CloudFront + Lambda (OpenNext) | `sst.aws.Nextjs` |
| Backend (NestJS) | **App Runner** desde imagen en **ECR** | `aws.apprunner.*` (crudo) |
| BDD (Postgres) | RDS `t4g.micro` Single-AZ | `sst.aws.Postgres` |
| Archivos | S3 | `sst.aws.Bucket` |
| Red | VPC **sin NAT** + bastion (para `sst tunnel`) | `sst.aws.Vpc` |

**Costo idle ~$22-26/mes** (sin ALB, sin NAT, sin Fargate). Ver §7.

> ⚠️ **Deploy en 2 fases:** App Runner exige que la imagen exista en ECR antes de crearse.
> Fase 1 deja la infra base (incl. ECR); se pushea la imagen y se provisiona la BDD;
> Fase 2 (`SST_BACKEND_READY=1`) crea App Runner + front. Después el CI/CD mantiene todo.

---

## 0. Prerrequisitos

- **Docker Desktop** corriendo (para construir la imagen del backend la 1ª vez).
- **Node 20 + pnpm 10** (ya en el repo).
- **Credenciales AWS** ya configuradas: `aws configure --profile edtech` + `export AWS_PROFILE=edtech`.

---

## 1. Instalar SST y definir secretos

```bash
pnpm add -D -w sst

# Secretos sin default (obligatorios). AuthSecret debe ser el mismo en web y api.
npx sst secret set AuthSecret        "$(openssl rand -base64 32)"            --stage production
npx sst secret set InternalApiSecret "$(openssl rand -base64 32)"            --stage production
npx sst secret set SoeAppPassword    "$(openssl rand -base64 24 | tr -d '/+=')" --stage production
npx sst secret set DbMasterPassword  "$(openssl rand -base64 24 | tr -d '/+=')" --stage production

# LLM (opcional para la demo de dashboards):
npx sst secret set LlmProvider gemini   --stage production
npx sst secret set GeminiApiKey "<key>" --stage production

# Auth: 'mock' para la primera demo (dropdown del seed); 'sso' cuando tengas OAuth (§6).
npx sst secret set AuthMode mock --stage production
```

---

## 2. Fase 1 — Infra base + ECR

```bash
npx sst deploy --stage production
```

Crea VPC, RDS, S3, **ECR**, roles IAM y VPC connector. Imprime `ecrRepo`, `dbHost`, `bucket`.
(App Runner y el front todavía NO se crean.)

---

## 3. Build + push de la imagen del backend a ECR

La 1ª imagen se sube a mano (después lo hace el CI). En Mac (ARM) construimos `linux/amd64`
porque App Runner corre x86_64:

```bash
ECR_REPO=$(aws ecr describe-repositories --repository-names edtech-api-production \
  --query 'repositories[0].repositoryUri' --output text)

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "${ECR_REPO%/*}"

docker buildx build --platform linux/amd64 \
  -f apps/api/Dockerfile -t "$ECR_REPO:latest" --push .
```

---

## 4. Provisionar BDD: roles RLS + migraciones

El RDS es privado. Abrí el túnel con el bastion (otra terminal, dejar corriendo):

```bash
sudo npx sst tunnel install        # una sola vez por máquina (pide sudo)
npx sst tunnel --stage production
```

Con el túnel abierto, **en este orden**:

```bash
export DATABASE_ADMIN_URL="postgresql://soe_admin:<DbMasterPassword>@<dbHost>:5432/soe"
export SOE_APP_PASSWORD="<SoeAppPassword>"

# 1) Rol soe_app (sin BYPASSRLS) + GRANTs + default privileges:
pnpm --filter @soe/db db:provision-roles

# 2) Migraciones (schema + re-aplica rls-policies.sql):
pnpm --filter @soe/db db:migrate

# 3) (Opcional) datos de demo:
DATABASE_URL="$DATABASE_ADMIN_URL" pnpm --filter @soe/db db:seed
```

> Provisionar la BDD **antes** de crear App Runner: el contenedor arranca conectando con
> `soe_app`; si el rol no existe, el health check de App Runner falla y el deploy se cuelga.

---

## 5. Fase 2 — App Runner + Frontend

```bash
SST_BACKEND_READY=1 npx sst deploy --stage production
```

Crea App Runner (apunta a `edtech-api-production:latest`, `autoDeployments` ON) y el front
(con `API_URL` = URL real de App Runner). Imprime `web` (CloudFront) y `api` (App Runner).

Abrí la URL `web`. Con `AuthMode=mock` entrás con el dropdown del seed.

---

## 6. CI/CD (push a main)

Dos workflows en `.github/workflows/`:

| Workflow | Dispara con | Hace |
|---|---|---|
| `deploy-backend.yml` | cambios en `apps/api`, `packages/db`, `packages/types`, lockfile | **(1) migra el RDS** (port-forward SSM por el bastión — gatea el deploy) → **(2)** build de la imagen → push a ECR `:latest` → App Runner **auto-deploya** |
| `deploy-frontend.yml` | cambios en `apps/web`, `packages`, `sst.config.ts` | `SST_BACKEND_READY=1 sst deploy` (reconciliación idempotente) |

**Secrets de GitHub** (Settings → Secrets and variables → Actions):

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
DB_MASTER_PASSWORD      # = SST secret DbMasterPassword (stage demo). Lo usa el job `migrate`.
```

> **Migración automática (job `migrate` en `deploy-backend.yml`):** corre `db:migrate` contra el
> RDS privado **antes** del build/push, vía un **port-forward SSM** por el bastión (la NAT
> instance de SST, gestionada por SSM — no usa `sst tunnel`, evita sudo/TUN en el runner).
> Las migraciones son **aditivas** → el código viejo no se rompe mientras corre; cuando App Runner
> levanta la imagen nueva la BDD ya está a la par. Si la migración falla, el build/push **no**
> ocurre (`needs: migrate`). Descubre el RDS y el bastión por tags; requiere el secret
> `DB_MASTER_PASSWORD` (= `DbMasterPassword` de SST) y que las AWS keys tengan permisos SSM
> `StartSession` (`EdTech-deployer` con `AdministratorAccess` los tiene). Para migrar a mano
> fuera de CI, seguí usando `sst tunnel` (§4). **Esto cierra el bug de "column … does not exist"**
> cuando un deploy agrega columnas y el RDS quedó sin migrar.

> Para producción real, migrar a **GitHub OIDC** (rol asumible sin llaves de larga vida)
> en vez de access keys. Para dev/demo, las keys en secrets son suficientes.

### Activar SSO real (cuando toque)

1. Apps OAuth en Google/Azure. Redirect URI = `https://<web-url>/api/auth/callback/google`.
2. `npx sst secret set GoogleClientId/GoogleClientSecret ... --stage production`
3. `npx sst secret set AuthMode sso --stage production` → re-deploy del front (push o manual).

---

## 7. Costo aproximado (idle)

| Recurso | ~USD/mes |
|---|---|
| RDS `t4g.micro` Single-AZ | ~13 |
| App Runner 0.25 vCPU / 0.5 GB (min 1 instancia) | ~5-8 |
| Bastion `t4g.nano` | ~3 |
| CloudFront + Lambda (web) | ~0-1 |
| ECR (storage de imágenes) | ~0-1 |
| S3 | ~0 |
| **Total** | **~$22-26/mes** |

**Ahorros adicionales:**
- Quitar `bastion: true` del `sst.config.ts` tras provisionar la BDD (re-agregar para migrar).
- App Runner no escala a 0 (mínimo 1 instancia). Para idle ≈ $0 habría que ir a Lambda.

---

## 8. Operación y limpieza

```bash
# Preview aislada por rama (URL propia para un stakeholder):
SST_BACKEND_READY=1 npx sst deploy --stage pr-123   # requiere imagen :latest del repo ECR de ese stage
npx sst remove --stage pr-123

# Bajar producción completa:
npx sst remove --stage production
```

---

## Troubleshooting

- **App Runner queda en `CREATE_FAILED` / rolling back:** casi siempre la BDD sin provisionar
  (§4) o `SoeAppPassword` distinto al del rol. Revisá los Application Logs del servicio en
  App Runner. Re-corré `db:provision-roles` con el mismo `SOE_APP_PASSWORD`.
- **La API no conecta al RDS (timeouts):** el VPC connector usa el SG por defecto de la VPC;
  si el RDS no lo acepta como inbound, agregá un ingress 5432 desde ese SG al SG del RDS.
- **`pnpm deploy --legacy` falla en el Docker build:** quitá `--legacy` (depende de la versión
  de pnpm). Última línea del stage `build` en `apps/api/Dockerfile`.
- **El front buildeó pero las llamadas a la API fallan:** revisá que `API_URL` (output `api`)
  apunte a `https://<...>.awsapprunner.com` y que App Runner esté `RUNNING`.
- **`sst tunnel` no conecta:** confirmá `bastion: true` y reinstalá con `sudo npx sst tunnel install`.
