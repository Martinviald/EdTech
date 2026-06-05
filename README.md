# Sistema Operativo Educativo

Plataforma EdTech con IA para colegios chilenos. Procesamiento de evaluaciones estandarizadas (DIA, SIMCE, PAES), dashboards pedagógicos, predicción ML y generación de contenido remedial.

## Stack

- **Frontend** — Next.js 15 (App Router) · TypeScript · Tailwind CSS · Zustand · shadcn/ui
- **Backend** — NestJS · TypeScript · Drizzle ORM · PostgreSQL
- **Monorepo** — Turborepo + pnpm workspaces

## Estructura

```
sistema-operativo-educativo/
├── apps/
│   ├── web/        # Frontend B2B (Next.js)
│   └── api/        # Backend Core (NestJS)
├── packages/
│   ├── db/         # Schemas Drizzle + migraciones
│   ├── types/      # Zod schemas + DTOs compartidos
│   └── ui/         # Sistema de diseño compartido
├── turbo.json      # Pipeline Turborepo
└── pnpm-workspace.yaml
```

## Comandos

```bash
# Setup inicial
pnpm install

# Desarrollo (todos los apps en paralelo)
pnpm dev

# Build de producción
pnpm build

# Base de datos
pnpm db:generate    # Generar migraciones desde schemas
pnpm db:migrate     # Aplicar migraciones (+ re-aplica RLS de packages/db/sql/rls-policies.sql)
pnpm db:push        # Push del schema (sólo dev)
pnpm db:studio      # Drizzle Studio (UI de la BD)
# Nota: el RLS multi-tenant vive en packages/db/sql/rls-policies.sql (no en el schema
# Drizzle) y no se pierde al regenerar migraciones. Ver packages/db/README.md.

# Calidad
pnpm lint
pnpm typecheck
pnpm test
pnpm format
```

## Variables de entorno

Copia `.env.example` a `.env` en la raíz y completa los valores:

```bash
cp .env.example .env
```

## Documentación del proyecto

Ver carpeta `docs/` para diseño de BD, planificación F1 y roadmap completo.
