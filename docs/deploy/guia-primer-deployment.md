# Guía paso a paso — Primer deployment (App Runner + SST/OpenNext + RDS)

Guía operativa para el **primer despliegue manual** en AWS. Todos los comandos se ejecutan
**desde la raíz del repo** (la rama `infra/aws-sst`), stage `production`, región `us-east-1`.

Arquitectura: Frontend Next.js en CloudFront/Lambda (OpenNext), Backend NestJS en App Runner
desde imagen en ECR, BDD en RDS `t4g.micro`. Todo en un `sst.config.ts`. Ver
`docs/deploy/aws-sst-nivel1.md` para el detalle de arquitectura, CI/CD y costos.

> El despliegue va en **2 fases** porque App Runner exige que la imagen exista en ECR antes
> de crearse: Fase 1 (infra base + ECR) → push imagen + provisionar BDD → Fase 2 (App Runner + front).

> **Nota sobre `.env`:** puedes reusar tu `AUTH_SECRET` local para el secreto `AuthSecret`
> (mantiene paridad con tu entorno local). No es obligatorio: cualquier valor sirve mientras
> web y api usen el mismo.

---

## Paso 0 — Prerrequisitos y verificaciones

```bash
export AWS_PROFILE=edtech          # el perfil configurado con `aws configure`
aws sts get-caller-identity        # debe imprimir tu Account/ARN (confirma credenciales)
docker info >/dev/null && echo "Docker OK"   # Docker Desktop debe estar corriendo
node -v && pnpm -v                 # Node 20+, pnpm 10+
```

Si `aws sts get-caller-identity` falla → `aws configure --profile edtech`
(Access Key, Secret, región `us-east-1`, formato `json`).

---

## Paso 1 — Instalar SST

```bash
pnpm add -D -w sst
```

La primera invocación de `sst` descargará su plataforma y providers (tarda un poco).

---

## Paso 2 — Generar y setear los secretos

Genera los dos passwords de Postgres en variables de shell para reusarlos después en las
cadenas de conexión. **Guarda estos dos valores** (los necesitas en el Paso 5):

```bash
export DB_MASTER_PW="$(openssl rand -base64 24 | tr -d '/+=')"
export SOE_APP_PW="$(openssl rand -base64 24 | tr -d '/+=')"
echo "GUARDA ESTO -> DB_MASTER_PW=$DB_MASTER_PW"
echo "GUARDA ESTO -> SOE_APP_PW=$SOE_APP_PW"
```

Setear todos los secretos:

```bash
npx sst secret set DbMasterPassword  "$DB_MASTER_PW"                --stage production
npx sst secret set SoeAppPassword    "$SOE_APP_PW"                  --stage production
npx sst secret set AuthSecret        "$(openssl rand -base64 32)"   --stage production
npx sst secret set InternalApiSecret "$(openssl rand -base64 32)"   --stage production

# LLM (opcional para la demo de dashboards; setéalo si quieres el etiquetado IA):
npx sst secret set LlmProvider gemini            --stage production
npx sst secret set GeminiApiKey "<tu-key-o-omite>" --stage production

# Auth: 'mock' para la primera demo (dropdown del seed, sin OAuth):
npx sst secret set AuthMode mock --stage production
```

---

## Paso 3 — Fase 1: infra base + ECR

```bash
npx sst deploy --stage production
```

Crea VPC, RDS, S3, ECR, roles IAM y VPC connector (App Runner y front todavía **no**).
Al terminar imprime los outputs: **copia `ecrRepo` y `dbHost`**.

---

## Paso 4 — Build + push de la imagen del backend a ECR

En Mac (Apple Silicon) se construye `linux/amd64`, la arquitectura de App Runner:

```bash
ECR_REPO=$(aws ecr describe-repositories --repository-names edtech-api-production \
  --query 'repositories[0].repositoryUri' --output text)
echo "ECR_REPO=$ECR_REPO"

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "${ECR_REPO%/*}"

docker buildx build --platform linux/amd64 \
  -f apps/api/Dockerfile -t "$ECR_REPO:latest" --push .
```

> La emulación amd64 en ARM es más lenta (varios minutos la primera vez). Si
> `pnpm deploy --legacy` falla en el build, quita `--legacy` de la última línea del stage
> `build` en `apps/api/Dockerfile` y reintenta.

---

## Paso 5 — Provisionar la BDD (rol RLS + migraciones)

**Terminal B** — abre el túnel con el bastion y déjala corriendo:

```bash
export AWS_PROFILE=edtech
sudo npx sst tunnel install          # una sola vez por máquina (pide sudo)
npx sst tunnel --stage production    # dejar corriendo
```

**Terminal A** (con el túnel arriba) — sustituye `<dbHost>` por el output del Paso 3 y usa
los passwords del Paso 2:

```bash
export DATABASE_ADMIN_URL="postgresql://soe_admin:${DB_MASTER_PW}@<dbHost>:5432/soe"
export SOE_APP_PASSWORD="${SOE_APP_PW}"

# 1) Rol soe_app (sin BYPASSRLS) + GRANTs + default privileges:
pnpm --filter @soe/db db:provision-roles

# 2) Migraciones (schema + re-aplica rls-policies.sql):
pnpm --filter @soe/db db:migrate

# 3) (Opcional) datos de demo para stakeholders:
DATABASE_URL="$DATABASE_ADMIN_URL" pnpm --filter @soe/db db:seed
```

> Este paso va **antes** de crear App Runner: el contenedor arranca conectando con `soe_app`;
> si el rol no existe, el health check falla y el deploy se cuelga.

---

## Paso 6 — Fase 2: App Runner + Frontend

```bash
SST_BACKEND_READY=1 npx sst deploy --stage production
```

Crea App Runner (apunta a `edtech-api-production:latest`, auto-deploy ON) y el front
(con `API_URL` real). Imprime **`web`** (URL CloudFront) y **`api`** (URL App Runner).

---

## Paso 7 — Verificar

```bash
# El backend puede tardar ~1-2 min en quedar RUNNING:
curl -i "$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='edtech-api-production'].ServiceUrl" \
  --output text)/api" 2>/dev/null | head -5
```

Luego abre la URL **`web`** en el navegador. Con `AuthMode=mock` entras con el dropdown de
usuarios del seed.

---

## Paso 8 (opcional) — Activar CI/CD

En GitHub → repo → **Settings → Secrets and variables → Actions**, crea:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Desde ahí, cada push a `main` que toque `apps/api/**` rebuildea la imagen (App Runner
auto-deploya) y lo que toque `apps/web/**` corre `sst deploy`.

---

## Si algo falla — los 2 puntos más probables

1. **API con timeouts al RDS** → el VPC connector usa el SG por defecto de la VPC; si el RDS
   no lo acepta como inbound, agrega un ingress `5432` desde ese SG (ver Troubleshooting del
   runbook `aws-sst-nivel1.md`).
2. **App Runner `CREATE_FAILED`** → casi siempre BDD sin provisionar (Paso 5) o
   `SoeAppPassword` distinto al del rol. Revisa los Application Logs en App Runner.
