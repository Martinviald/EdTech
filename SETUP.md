# Setup del Repositorio — EdTech

Guía paso a paso para configurar el monorepo desde cero hasta tener `pnpm dev` corriendo con web (Next.js) y api (NestJS) levantados y conectados a PostgreSQL.

---

## Tabla de contenidos

1. [Prerrequisitos](#1-prerrequisitos)
2. [Clonar el repo](#2-clonar-el-repo)
3. [Instalar dependencias](#3-instalar-dependencias)
4. [Configurar PostgreSQL](#4-configurar-postgresql)
5. [Configurar variables de entorno](#5-configurar-variables-de-entorno)
6. [Aplicar migraciones y seed](#6-aplicar-migraciones-y-seed)
7. [Construir packages workspace](#7-construir-packages-workspace)
8. [Levantar las aplicaciones en dev](#8-levantar-las-aplicaciones-en-dev)
9. [Verificación](#9-verificación)
10. [Comandos útiles](#10-comandos-útiles)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerrequisitos

Asegúrate de tener instalado:

| Herramienta | Versión mínima | Instalación |
|---|---|---|
| **Node.js** | 20.0.0+ | `brew install node` o [nvm](https://github.com/nvm-sh/nvm) |
| **pnpm** | 9.0.0+ | `npm install -g pnpm` |
| **PostgreSQL** | 14+ | `brew install postgresql@14` |
| **Git** | 2.x | `brew install git` |

Verifica que todo esté disponible:

```bash
node --version    # v20.x.x o superior
pnpm --version    # 9.x.x o superior
psql --version    # PostgreSQL 14.x o superior
git --version     # 2.x.x
```

> **Alternativa para Postgres:** puedes usar Docker en lugar de instalación local. Ver sección [Troubleshooting](#11-troubleshooting).

---

## 2. Clonar el repo

```bash
cd ~/Desktop
git clone <REPO_URL> EdTech
cd EdTech
```

Si ya tienes la carpeta, simplemente:

```bash
cd ~/Desktop/EdTech
```

---

## 3. Instalar dependencias

```bash
pnpm install
```

Esto instala dependencias de todo el monorepo (apps + packages) usando pnpm workspaces. Toma 1-2 minutos la primera vez.

Si ves advertencias sobre scripts ignorados (`@nestjs/core`, `esbuild`, `sharp`), no es un problema — son opcionales.

---

## 4. Configurar PostgreSQL

### Opción A — PostgreSQL local (recomendado en Mac con Homebrew)

```bash
# Iniciar el servicio de PostgreSQL
brew services start postgresql@14

# Verificar que está corriendo
pg_isready -h localhost -p 5432
# Debe responder: localhost:5432 - accepting connections

# Crear la base de datos
psql -U $USER -h localhost -d postgres -c "CREATE DATABASE soe_dev;"

# Verificar acceso
psql -U $USER -h localhost -d soe_dev -c "SELECT current_database();"
```

### Opción B — PostgreSQL con Docker

```bash
docker run -d --name soe-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=soe_dev \
  -p 5432:5432 \
  postgres:16

# Verificar que está listo
docker exec soe-pg pg_isready
```

---

## 5. Configurar variables de entorno

Crea el archivo `.env` en la raíz del proyecto:

```bash
cp .env.example .env
```

Edita `.env` y ajusta el `DATABASE_URL` según tu setup:

**Para PostgreSQL local (Homebrew, sin password, usuario actual):**
```env
DATABASE_URL=postgresql://TU_USUARIO@localhost:5432/soe_dev
```
> Reemplaza `TU_USUARIO` con el resultado de `echo $USER` (en Mac suele ser tu nombre de usuario del sistema).

**Para PostgreSQL con Docker:**
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/soe_dev
```

El resto de las variables se llenan más adelante (SSO, Anthropic). En desarrollo no son obligatorias.

---

## 6. Aplicar migraciones y seed

### 6.1 Generar las migraciones SQL desde los schemas de Drizzle

```bash
pnpm --filter @soe/db db:generate
```

Esto crea archivos SQL en `packages/db/drizzle/` basados en los schemas TypeScript.
> Solo necesitas correr esto si cambias los schemas. Si ya existe el directorio `drizzle/`, puedes saltarlo.

### 6.2 Aplicar las migraciones a PostgreSQL

```bash
pnpm --filter @soe/db db:migrate
```

Esto ejecuta los SQL contra la base de datos definida en `DATABASE_URL`.

Output esperado:
```
Running migrations...
Migrations completed.
```

### 6.3 Sembrar datos iniciales

```bash
pnpm --filter @soe/db db:seed
```

Esto carga:
- **12 grades** (1° básico a 4° medio)
- **5 subjects** (Lenguaje, Matemáticas, Ciencias, Historia, Inglés)
- **2 curricula** (MINEDUC 2024, DIA 2025)

### 6.4 Verificar que la BD quedó lista

```bash
psql -U $USER -h localhost -d soe_dev -c "\dt"
```

Debes ver **31 tablas** (`organizations`, `users`, `students`, `taxonomy_nodes`, `items`, `assessments`, `responses`, `skill_results`, etc.).

---

## 7. Construir packages workspace

Los packages compartidos (`@soe/db`, `@soe/types`) tienen que estar compilados a JS antes de que la API de NestJS pueda importarlos en runtime.

```bash
pnpm --filter "@soe/types" build
pnpm --filter "@soe/db" build
```

Esto compila las fuentes TypeScript a `packages/*/dist/`.

> **Nota:** este paso se ejecuta automáticamente cuando corres `pnpm dev` (gracias a `dependsOn: ["^build"]` en `turbo.json`), pero hacerlo una vez al inicio hace que el primer `pnpm dev` arranque más rápido.

---

## 8. Levantar las aplicaciones en dev

```bash
pnpm dev
```

Esto arranca **3 procesos en paralelo** vía Turborepo:

| Proceso | Qué hace | Puerto |
|---|---|---|
| `@soe/db:dev` | Watch de tipos del package db | — |
| `@soe/web:dev` | Next.js dev server | `http://localhost:3000` |
| `@soe/api:dev` | NestJS dev server | `http://localhost:4000` |

Espera a ver estos logs:

```
@soe/web:dev:  ✓ Ready in 2.5s
@soe/api:dev:  🚀 API running on http://localhost:4000/api
```

**Para detener:** `Ctrl+C` (Turbo termina los 3 procesos automáticamente).

---

## 9. Verificación

Con los apps corriendo, abre otra terminal y verifica:

```bash
# 1. API root (info de la plataforma)
curl http://localhost:4000/api
# → {"name":"Sistema Operativo Educativo API","version":"0.1.0",...}

# 2. API health (verifica conexión a la BD)
curl http://localhost:4000/api/health
# → {"status":"ok","timestamp":"...","services":{"database":"ok"}}

# 3. Web home page
curl -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000
# → HTTP 200
```

O simplemente abre en tu navegador:
- **Web:** http://localhost:3000
- **API:** http://localhost:4000/api
- **Health:** http://localhost:4000/api/health

---

## 10. Comandos útiles

```bash
# === Desarrollo ===
pnpm dev                  # arranca todos los apps en dev
pnpm build                # build de producción de todo
pnpm typecheck            # verifica tipos en todo el monorepo
pnpm lint                 # corre ESLint en todos los packages
pnpm format               # formatea con Prettier
pnpm clean                # limpia caches y dist (no toca node_modules)

# === Base de datos ===
pnpm db:generate          # genera migraciones SQL desde schemas
pnpm db:migrate           # aplica migraciones pendientes
pnpm db:push              # push directo del schema (solo dev)
pnpm db:studio            # UI visual de Drizzle (http://localhost:4983)
pnpm --filter @soe/db db:seed   # carga seed data

# === Filtrar por package ===
pnpm --filter @soe/web dev      # solo el frontend
pnpm --filter @soe/api dev      # solo el backend
pnpm --filter @soe/db build     # solo compilar el package db
```

---

## 11. Troubleshooting

### "PostgreSQL connection refused"

```bash
brew services list | grep postgresql
# Si dice "stopped" o no aparece:
brew services start postgresql@14
```

### "database soe_dev does not exist"

```bash
psql -U $USER -h localhost -d postgres -c "CREATE DATABASE soe_dev;"
```

### "role TU_USUARIO does not exist" (Docker)

Si usas Docker, asegúrate de que `DATABASE_URL` apunte a `postgres:postgres@localhost`, no a tu usuario del sistema.

### "Cannot find module '@soe/db'" o "@soe/types"

Los packages workspace necesitan estar construidos:

```bash
pnpm --filter "@soe/types" build
pnpm --filter "@soe/db" build
```

### El API arranca pero los controllers tiran `Cannot read properties of undefined`

Esto pasa si NestJS no tiene la metadata de decoradores (problema de DI). Asegúrate de:
1. Usar `nest start --watch` (no `tsx watch`) en el script `dev` de la api
2. Tener `experimentalDecorators` y `emitDecoratorMetadata` en `apps/api/tsconfig.json`

### Puerto ya en uso (3000 o 4000)

```bash
# Encontrar el proceso
lsof -i :3000
lsof -i :4000

# Matarlo
kill -9 <PID>

# O matar todos los procesos de dev
pkill -f "turbo run dev"
```

### Drizzle Kit no encuentra `DATABASE_URL`

Asegúrate de que `.env` está en la raíz del proyecto (no dentro de `packages/db/`). Drizzle Kit lee de `process.env`, así que la variable debe estar exportada al ejecutar:

```bash
set -a && source .env && set +a
pnpm --filter @soe/db db:migrate
```

O usa una herramienta como `dotenv-cli`:

```bash
pnpm dlx dotenv-cli -- pnpm --filter @soe/db db:migrate
```

### Rehacer todo desde cero

```bash
# Limpiar todo
pnpm clean
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -rf packages/db/drizzle apps/*/dist packages/*/dist

# Reinstalar
pnpm install

# Resetear BD (CUIDADO: borra todos los datos)
psql -U $USER -h localhost -d postgres -c "DROP DATABASE IF EXISTS soe_dev; CREATE DATABASE soe_dev;"

# Volver a generar, migrar y sembrar
pnpm --filter @soe/db db:generate
pnpm --filter @soe/db db:migrate
pnpm --filter @soe/db db:seed

# Construir packages
pnpm --filter "@soe/types" build
pnpm --filter "@soe/db" build

# Levantar dev
pnpm dev
```

---

## Estructura del monorepo

```
EdTech/
├── apps/
│   ├── web/                Next.js 15 (Tailwind + Zustand)
│   └── api/                NestJS 10 (Drizzle ORM)
├── packages/
│   ├── db/                 Schemas Drizzle + migraciones + seed
│   ├── types/              Zod schemas y enums compartidos
│   └── ui/                 Utilidades de UI (cn, tokens)
├── turbo.json              Pipeline Turborepo
├── pnpm-workspace.yaml     Definición de workspaces
├── tsconfig.base.json      TypeScript base compartido
├── .env                    Variables locales (NO commitear)
└── .env.example            Plantilla de variables
```

---

## Siguiente paso

Una vez que tienes `pnpm dev` corriendo, el próximo hito del Sprint 0 es:
- **H1.7** — SSO Google/Microsoft (NextAuth)
- **H19.4** — Row-Level Security en PostgreSQL por `org_id`
- **H19.10** — Componentes shadcn/ui base

Ver `docs/Planificación F1 — Sprints.md` para el roadmap completo.
