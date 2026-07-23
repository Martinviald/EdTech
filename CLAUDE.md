# Lineamientos del Proyecto — Sistema Operativo Educativo EdTech

> Este archivo es el contrato técnico y de producto del proyecto. Toda decisión de código, diseño de datos y arquitectura debe respetar estas reglas sin excepción. No hay código provisional: lo que se construye en F1 es la base de F2-F5.

---

## 1. Identidad del Proyecto

**Producto:** Plataforma B2B SaaS para colegios chilenos. Procesa evaluaciones estandarizadas (DIA, SIMCE, PAES, Cambridge), genera dashboards pedagógicos y predice brechas de aprendizaje.

**Estrategia comercial:** Product-Led Growth (PLG). El punto de entrada es resolver el dolor del DIA gratis. El upsell es benchmarking, IA remedial y AI Grading.

**Usuarios principales:** directivos (visibilidad macro), profesores (eficiencia operativa). No hay usuarios finales alumnos en F1.

**Fase actual:** F1 — "Caballo de Troya". Scope estricto: ingesta DIA + dashboards. Ver `docs/Srpints/Planificación F1.md`.

---

## 2. Stack Tecnológico (No Negociable)

| Capa | Tecnología | Restricción |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript | Solo App Router. Nunca Pages Router. |
| Estilos | Tailwind CSS + shadcn/ui | No instalar otras librerías UI sin consenso. |
| Estado cliente | Zustand | Solo para estado global ligero. No Redux. |
| Backend | NestJS + TypeScript | Arquitectura modular. Un módulo por dominio. |
| ORM | Drizzle ORM | Nunca Prisma ni TypeORM. |
| Base de datos | PostgreSQL | Motor único. No SQLite en ningún entorno. |
| Validación | Zod (en `packages/types`) | Toda validación de entrada usa Zod. Sin class-validator standalone. |
| Monorepo | Turborepo + pnpm workspaces | No mezclar npm ni yarn. |
| IA | Gemini 2.0 Flash (multimodal) | Claude API para etiquetado IA de ítems (H3.11). |
| Queue | BullMQ + Redis (F3+) | En F1 los jobs asíncronos usan `import_jobs` en DB. |
| Infra | AWS + SST | No deployar en Vercel sin consultar. |

---

## 3. Estructura del Monorepo

```
/
├── apps/
│   ├── api/          # NestJS — Backend Core
│   │   └── src/
│   │       ├── {dominio}/
│   │       │   ├── {dominio}.module.ts
│   │       │   ├── {dominio}.controller.ts
│   │       │   ├── {dominio}.service.ts
│   │       │   └── dto/
│   │       └── database/
│   └── web/          # Next.js — Frontend B2B
│       └── src/
│           ├── app/           # Rutas App Router
│           ├── components/    # Componentes reutilizables
│           ├── store/         # Zustand stores
│           └── lib/           # Utilidades y helpers
├── packages/
│   ├── db/           # Drizzle schemas + migraciones (fuente de verdad de BD)
│   │   └── src/
│   │       ├── schema/        # Un archivo por dominio
│   │       └── seed/
│   ├── types/        # Zod schemas + DTOs compartidos entre api y web
│   │   └── src/
│   │       ├── schemas/       # Un archivo por entidad
│   │       ├── utils/         # Helpers compartidos (roles, rut, curso-parser)
│   │       └── access-policies.ts  # Constantes de acceso por rol (CURRICULUM_ROLES, etc.)
│   └── ui/           # Componentes shadcn/ui compartidos
└── docs/             # Documentación del proyecto
```

**Regla:** si algo puede ir en `packages/`, va en `packages/`. Los tipos y validaciones son siempre compartidos.

---

## 4. Principios de Diseño de Código

### 4.1 SOLID

- **S — Single Responsibility:** cada clase/módulo tiene una razón para cambiar. Un `Service` no hace parsing de CSV y también calcula notas. Se divide.
- **O — Open/Closed:** las entidades de dominio se extienden por configuración (`config JSONB`, `type enum`), no por modificación de código. Ejemplo: agregar un nuevo tipo de ítem no requiere una nueva tabla, solo un nuevo valor en `item_type` enum.
- **L — Liskov Substitution:** los `Service` y `Repository` se inyectan por interfaz/abstracción en NestJS. Los tests pueden reemplazar implementaciones sin romper contratos.
- **I — Interface Segregation:** no crear DTOs o interfaces "Dios". Un DTO de creación es diferente al de actualización y al de respuesta.
- **D — Dependency Inversion:** los módulos de alto nivel (controllers, use cases) dependen de abstracciones (services), no de implementaciones concretas (Drizzle queries directas).

### 4.2 DRY (Don't Repeat Yourself)

- La lógica de negocio vive **una sola vez** en el `Service` del módulo correspondiente.
- Las validaciones Zod viven en `packages/types` y se importan tanto en `api` como en `web`. Nunca duplicar un schema.
- Los tipos de Drizzle (`$inferSelect`, `$inferInsert`) se re-exportan desde `packages/db` y se usan directamente. No redefinir tipos que ya existen.
- Las utilidades de formateo (fechas, RUT, notas) viven en `packages/types` o en helpers compartidos.

### 4.3 Clean Architecture (Capas)

En `apps/api`, el flujo de datos es siempre unidireccional:

```
Request → Controller (valida con Zod DTO) → Service (lógica de negocio) → Repository/Drizzle (acceso a datos) → Response
```

- Los **Controllers** solo reciben requests, validan entrada y llaman al Service. Cero lógica de negocio.
- Los **Services** contienen toda la lógica de negocio. No hacen queries directas a Drizzle — usan el cliente inyectado y encapsulan las queries.
- Las **queries Drizzle** complejas o reutilizadas se extraen en funciones del propio Service o en un archivo `queries/` dentro del módulo.
- Nunca pasar el objeto `req` de HTTP a un Service.

### 4.4 TypeScript Estricto

- `strict: true` en todos los `tsconfig.json`. Sin excepciones.
- No usar `any`. Si el tipo es desconocido, usar `unknown` y narrowing explícito.
- Inferir tipos desde Drizzle (`typeof tabla.$inferSelect`) y desde Zod (`z.infer<typeof schema>`). No redefinir interfaces manualmente para lo que ya está tipado.
- Todos los `JSONB` en el schema de Drizzle deben tener su tipo genérico definido con `.$type<T>()`.

---

## 5. Reglas de Base de Datos

### 5.1 Convenciones de Schema (Drizzle)

- **PKs:** siempre `uuid().defaultRandom().primaryKey()`. Nunca enteros autoincrementales.
- **Timestamps:** toda tabla tiene `created_at timestamp NOT NULL DEFAULT now()`. Las que modifican datos también tienen `updated_at`.
- **Soft deletes:** todo dato sensible (alumnos, usuarios, instrumentos) usa `deleted_at timestamp` en lugar de `DELETE`. Las queries deben filtrar `WHERE deleted_at IS NULL` por defecto.
- **Nombres de columnas:** `snake_case` en la DB, `camelCase` en el código TypeScript (Drizzle mapea automáticamente).
- **Archivos de schema:** uno por dominio en `packages/db/src/schema/`. Exportar todo desde `index.ts`.
- **Relaciones:** siempre declarar `relations()` de Drizzle junto a la tabla para habilitar joins tipados.

### 5.2 Multi-Tenancy (No Negociable)

- **Toda tabla con datos sensibles por colegio lleva `org_id uuid NOT NULL`.**
- Toda query que acceda a datos de un tenant debe incluir `WHERE org_id = :orgId` en el filtro. Nunca confiar en que el frontend filtrará.
- El `org_id` del usuario autenticado viene del contexto de auth (JWT/sesión), no del body de la request.
- **RLS de PostgreSQL es la barrera de aislamiento a nivel de motor.** Toda query a una tabla con RLS activo (`students`, `assessments`, `import_jobs`, `responses`, `assessment_results`, `skill_results`) **debe** correr dentro de `withOrgContext(db, orgId, tx => ...)` (de `@soe/db`), que fija `app.current_org_id` en la transacción. **Sin contexto, RLS devuelve 0 filas** (safe default). Usar `tx` dentro del callback, nunca `this.db` (una query en `this.db` corre sin contexto → 0 filas o falla el insert).
- **Las políticas RLS NO viven en el schema Drizzle.** Están en `packages/db/sql/rls-policies.sql` (idempotente, con `FORCE ROW LEVEL SECURITY`) y `db:migrate` las re-aplica siempre. ⚠️ Al regenerar/aplanar migraciones, NO se pierden — pero si agregas una tabla sensible nueva, debes añadir su política a ese archivo. Ver `packages/db/README.md`. (El RLS ya se perdió una vez al aplanar migraciones, commit `53aa242`; este mecanismo lo previene.)

### 5.3 Taxonomía Universal (Pieza Central)

- **Nunca** crear tablas separadas por currículo (`mineduc_oas`, `simce_skills`, etc.). Todo usa `taxonomy_nodes` con árbol polimórfico.
- **Nunca** hardcodear referencias a "DIA" o "Lenguaje" en queries o lógica. Usar los IDs de `curricula` y `taxonomy_nodes`.
- Los ítems se etiquetan con `item_taxonomy_tags`. Las habilidades evaluadas se derivan de estos tags.
- Toda nueva extensión (SIMCE en F3, Cambridge en F4) solo requiere nuevos registros en `curricula` y `taxonomy_nodes`, no cambios de schema.

### 5.4 JSONB: Cuándo Usarlo

| Usar columnas tipadas | Usar JSONB |
|---|---|
| Campos que siempre existen | Campos que varían por `type` |
| Campos que se filtran/indexan en SQL | Configuración per-tenant o per-instrumento |
| Relaciones FK | Contenido de ítems (`items.content`) |
| Timestamps, booleans, enums | Parámetros IRT, scopes de roles, respuestas de alumnos |

- Todo campo JSONB tiene su tipo TypeScript declarado con `.$type<T>()` en Drizzle.
- La validación del contenido JSONB ocurre en la capa de aplicación con Zod, no en la DB.

### 5.5 Migraciones

- Nunca usar `db:push` en staging o producción. Solo en desarrollo local.
- Todo cambio de schema genera una migración con `pnpm db:generate` y se revisa antes de aplicar.
- Las migraciones son irreversibles en producción — pensar antes de ejecutar.

---

## 6. Reglas de API (NestJS)

### 6.1 Estructura de Módulos

Cada dominio de negocio es un módulo NestJS independiente:

```
src/
├── auth/
├── organizations/
├── users/
├── students/
├── instruments/
├── assessments/
├── responses/
├── results/
└── taxonomy/
```

Cada módulo contiene: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` (con schemas Zod).

### 6.2 Endpoints REST

- Seguir convenciones REST estrictas: `GET /assessments`, `POST /assessments`, `GET /assessments/:id`, `PATCH /assessments/:id`.
- Los DTOs de entrada se validan con Zod en el Controller antes de llegar al Service.
- Las respuestas de error siguen el formato estándar de NestJS (`{ statusCode, message, error }`).
- Toda respuesta exitosa de lista incluye paginación: `{ data: [], total, page, limit }`.

### 6.3 Autenticación y Autorización

- Auth exclusivamente via SSO (Google / Microsoft). Sin contraseñas propias.
- Todo endpoint protegido verifica el JWT y extrae `userId` y `orgId` del token.
- **Multi-rol:** un usuario puede tener varios `org_memberships` con distintos roles en la misma org. El JWT carga `roles: UserRole[]` (todos los memberships activos) + `activeRole: UserRole` (el elegido por el usuario). El campo `role` (singular) es un mirror deprecated de `activeRole` durante la migración.
- **Guards por unión:** `RolesGuard` y `SensitiveDataGuard` autorizan si **alguno** de los roles del usuario está permitido, no sólo el `activeRole`. Un usuario que es `teacher` + `eval_coordinator` accede a endpoints de ambos sin cambiar de rol.
- **Excepción — vista "Mis cursos":** `ClassGroupsService.shouldShowTeacherView()` decide en base a `activeRole` (no la unión) para que un usuario admin+teacher pueda alternar entre vista de admin y vista de profesor cambiando el rol activo.
- **`POST /auth/switch-role`:** endpoint autenticado que valida que el `role` solicitado esté en `user.roles` y retorna `{ activeRole, roles }`. El frontend luego llama `useSession().update({ activeRole })` y `router.refresh()`.
- **Helpers de roles:** usar `userHasRole()`, `userHasAnyRole()`, `canAccess()` de `@soe/types` para chequeos de rol. No comparar `user.role === 'xxx'` directamente — usar siempre `user.roles` con los helpers.
- **Access policies:** las constantes de acceso por feature (`CURRICULUM_ROLES`, `STAFF_MANAGEMENT_ROLES`, `IMPORT_ROLES`, etc.) viven en `packages/types/src/access-policies.ts`. No duplicar listas de roles inline en páginas o controllers.
- Un profesor solo puede ver datos de los cursos a los que está asignado (`teacher_assignments`). Un directivo ve toda la organización.

---

## 7. Reglas de Frontend (Next.js)

### 7.1 App Router

- Toda página es un Server Component por defecto. Solo marcar `'use client'` cuando sea estrictamente necesario (interactividad, hooks de estado).
- Los datos se fetchean en Server Components con `fetch` o directamente desde el API. Sin `useEffect` para fetch inicial.
- Las rutas siguen la jerarquía de la app: `/dashboard`, `/dashboard/assessments`, `/dashboard/assessments/[id]`.

### 7.2 Componentes

- Componentes de UI genéricos (botones, tablas, inputs) viven en `packages/ui/src/`.
- Componentes específicos de dominio (dashboard de habilidades, heatmap, tabla de resultados) viven en `apps/web/src/components/`.
- No crear componentes con más de una responsabilidad. Un `AssessmentTable` muestra datos. Un `AssessmentFilters` maneja filtros. No los mezclar.

### 7.3 Estado Global (Zustand)

- Zustand solo para estado que necesitan múltiples componentes no relacionados (sesión de usuario, filtros globales de dashboard).
- No usar Zustand para estado local de un componente. Usar `useState`.
- Los stores viven en `apps/web/src/store/`. Uno por dominio (`auth.store.ts`, `filters.store.ts`).

### 7.4 Diseño Visual

- Tailwind CSS como único sistema de estilos. Sin CSS Modules ni styled-components.
- Usar los tokens de diseño (colores, tipografía) configurados en `tailwind.config.ts`. No usar colores hardcodeados (`text-[#FF0000]`).
- Responsive desde el inicio en cada vista (H19.2). Mobile-first. No dejarlo para después.
- shadcn/ui como librería base de componentes. Customizar via `className`, no modificar los archivos internos de shadcn.

---

## 8. Principios de Producto

### 8.1 Scope de F1 (Qué Construir Ahora)

**Está dentro de F1:**
- Onboarding del colegio (alta, nómina de alumnos, roles)
- Banco de ítems DIA con pautas oficiales
- Ingesta de respuestas DIA (CSV Gradecam/ZipGrade/oficial)
- Cálculo de resultados por alumno × pregunta × habilidad
- Dashboards de directivo y profesor
- Exportación Excel/PDF
- Design system base (H17.1)

**Está FUERA de F1 (no implementar):**
- Escaneo con cámara en tiempo real → F3
- Corrección IA de preguntas de desarrollo → F4
- Benchmarking inter-colegios → F2
- Predicción ML → F3
- Generación de contenido IA → F2
- Portal apoderados → F3
- LMS y planificación curricular → F4

### 8.2 Extensibilidad por Diseño

- **Nunca hardcodear** referencias a "DIA", "Lenguaje" o "3° básico" en la lógica de negocio. Usar IDs y enums.
- Toda decisión de F1 debe poder extenderse a SIMCE, PAES y Cambridge en F3 sin migración de schema.
- Al terminar F1, H19.1 valida que ningún código esté hardcodeado para un instrumento específico.
- Si para implementar algo hay que hacer una excepción a la taxonomía universal o al modelo polimórfico de ítems, la decisión correcta es **no hacer la excepción**.

### 8.3 La IA Propone, el Humano Aprueba

- En `responses`: `ai_score` y `human_score` son siempre campos separados. El `final_score` es el que cuenta.
- Nunca sobreescribir evidencia de lo que generó la IA ni el override humano.
- El etiquetado IA de ítems (H3.11) es sugerencia. Un administrador siempre confirma antes de guardar.
- Los jobs de IA (`ai_grading_jobs`) corren de forma asíncrona. Nunca bloquean el event loop transaccional.

---

## 9. Convenciones de Nombres

| Contexto | Convención | Ejemplo |
|---|---|---|
| Archivos TypeScript | `kebab-case` | `health.controller.ts`, `user.schema.ts` |
| Clases TypeScript | `PascalCase` | `AssessmentService`, `CreateUserDto` |
| Variables/funciones TS | `camelCase` | `orgId`, `calculatePercentage()` |
| Columnas en DB | `snake_case` | `org_id`, `created_at`, `deleted_at` |
| Tablas en DB | `snake_case` | `org_memberships`, `assessment_results` |
| Enums en DB | `snake_case` | `org_type`, `user_role` |
| Enums en TypeScript | `UPPER_SNAKE_CASE` para valores, `PascalCase` para el tipo | `USER_ROLES`, `ItemType` |
| Rutas API | `kebab-case` | `/api/assessment-results`, `/api/import-jobs` |
| Rutas Next.js | `kebab-case` | `/dashboard/class-groups/[id]` |
| Variables de entorno | `UPPER_SNAKE_CASE` | `DATABASE_URL`, `NEXT_PUBLIC_API_URL` |

---

## 10. Calidad y CI

### 10.1 Antes de Hacer Commit

```bash
pnpm typecheck   # Sin errores de TypeScript
pnpm lint        # Sin warnings de ESLint
pnpm format      # Prettier aplicado
```

No hacer commit con errores de typecheck o lint. El CI bloquea PRs que fallen.

### 10.2 Testing

- Los Services tienen tests unitarios. Los Controllers tienen tests de integración (con supertest).
- No mockear la base de datos en tests de integración — usar una DB de test real con datos de seed.
- Los componentes de UI críticos (dashboards, formularios de importación) tienen tests con React Testing Library.

### 10.3 Commits

- Mensajes en español o inglés, imperativos y descriptivos: `feat: agregar endpoint de importación DIA`, `fix: corregir cálculo de porcentaje en skill_results`.
- Un commit por feature/fix atómico. No agrupar cambios no relacionados.

---

## 11. Seguridad

- **Nunca** exponer `org_id` de otro tenant en una respuesta de API.
- **Nunca** confiar en el `orgId` que viene del body/query de la request para filtrar datos — usar siempre el `orgId` del token de sesión autenticado.
- Los archivos subidos (hojas de respuesta) van a S3 via Presigned URLs. El backend nunca recibe el archivo directamente en memoria para archivos grandes.
- Las variables de entorno sensibles (`DATABASE_URL`, claves de API) nunca se hardcodean ni se commitean. Usar `.env` (gitignoreado) y `.env.example` como referencia.
- RLS (Row Level Security) en PostgreSQL es la barrera de aislamiento multi-tenant. Si una query "rompe RLS" (devuelve 0 filas) es porque no se envolvió en `withOrgContext` — **se corrige envolviendo la query, no se deshabilita RLS**. Ver §5.2 y `packages/db/README.md`.
- La API debe conectar con un rol **sin** `BYPASSRLS` (`DATABASE_URL` → `soe_app`); migrate/seed usan `DATABASE_ADMIN_URL` (rol privilegiado). Superusers y roles `BYPASSRLS` saltan RLS y lo vuelven un no-op. La API emite un warning de arranque si detecta una conexión que bypassa RLS.

---

## 12. Procesamiento Asíncrono

- Las operaciones que toman más de 2 segundos (importar CSV, calcular resultados de un curso completo) son siempre asíncronas.
- En F1, el estado del proceso se trackea en la tabla `import_jobs` (polling desde el frontend).
- En F3+, los jobs migran a BullMQ + Redis. El schema de `import_jobs` ya está diseñado para esta transición.
- El frontend muestra un estado de progreso mientras el job procesa. Nunca dejar al usuario sin feedback.

---

## 13. Documentación Viva

- `docs/Diseño bdd.md` — Fuente de verdad del modelo de datos. Actualizar si cambia el schema.
- `docs/lineamientos proyecto.md` — Estrategia de negocio, stack y roadmap. No modificar sin consenso del equipo.
- `docs/Srpints/Planificación F1.md` — Historias de usuario F1. Marcar historias como completadas al terminarlas.
- Este archivo (`CLAUDE.md`) — Lineamientos técnicos y de producto para el desarrollo asistido por IA.

---

## 14. Patrones Anti-Prohibidos

| Anti-patrón | Por qué está prohibido | Alternativa |
|---|---|---|
| Tablas separadas por tipo de ítem | Rompe la extensibilidad a nuevos instrumentos | `items` polimórfico con `type` + `content JSONB` |
| Hardcodear "DIA" o IDs en código | Bloquea F3 sin reescritura | Usar `curricula.type` y `taxonomy_nodes` |
| Lógica de negocio en Controllers | Viola SRP y hace el código intestable | Mover al Service correspondiente |
| `any` en TypeScript | Elimina la seguridad de tipos end-to-end | `unknown` + narrowing, o inferir desde Drizzle/Zod |
| Duplicar schemas Zod entre api y web | DRY violation | Definir en `packages/types`, importar en ambos |
| `db:push` en staging/prod | Puede romper datos sin reversión | `db:generate` + `db:migrate` con revisión |
| Agregar features de F2+ en F1 | Aumenta complejidad sin valor demostrable hoy | Dejar el punto de extensión documentado, no implementar |
| Query a tabla con RLS fuera de `withOrgContext` | Devuelve 0 filas (o falla el insert) bajo RLS | Envolver en `withOrgContext(db, orgId, tx => ...)` y usar `tx` (ver §5.2) |
| Definir políticas RLS solo en el `.sql` de migración | Se pierden al regenerar/aplanar (pasó en `53aa242`) | Declararlas en `packages/db/sql/rls-policies.sql` (re-aplicado en `db:migrate`) |
| Queries sin filtro `org_id` | Riesgo de data leak entre tenants | Filtrar por `org_id` del token Y correr dentro de `withOrgContext` |
| Borrar registros de alumnos con `DELETE` | Datos legalmente sensibles (Ley 19.628) | Soft delete con `deleted_at` |
| Comparar `user.role === 'xxx'` directamente | No funciona con multi-rol; ignora los otros roles del usuario | `userHasRole(user.roles, 'xxx')` o `userHasAnyRole(user.roles, ALLOWED)` |
| Duplicar listas de roles inline en páginas/controllers | DRY violation, riesgo de desincronización | Usar constantes de `packages/types/src/access-policies.ts` con `canAccess()` |

---

## 15. Reglas Granulares de Backend (`apps/api`)

Este archivo fija el contrato arquitectónico. Los patrones de código más finos (dónde vive la lógica, cómo estructurar tests, cómo evitar complejidad accidental) viven en archivos aparte para no inflar este documento — pero se cargan siempre junto con él:

@.claude/rules/backend/01-testing.md
@.claude/rules/backend/02-no-comments.md
@.claude/rules/backend/03-helpers-vs-services.md
@.claude/rules/backend/04-collection-complexity.md
@.claude/rules/backend/05-rbac-guards.md
@.claude/rules/backend/06-error-handling-observability.md
