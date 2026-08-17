# Plan de desarrollo — Servidor MCP analítico

> Companion de [`propuesta-mcp-analitico.md`](./propuesta-mcp-analitico.md) (el _qué_ y el _por qué_).
> Este documento es el _cómo_: fases ordenadas, archivos, tareas, tests y estructura de PRs que
> ejecutan el diseño completo. **Branch base sugerido: `mcp-analitico`** (desde `main`).
>
> **Estado (2026-08-16): F0–F7 implementadas** en la branch `mcp-analytics-design` (código en
> `apps/api/src/mcp/`). Suite MCP+asistente en verde y build de producción OK; `MCP_ENABLED=false`
> hasta configurar WorkOS. Pendiente: provisioning WorkOS + prueba E2E OAuth con Claude/ChatGPT (F0,
> tarea del usuario). F8 (extensiones) queda post-MVP.

## Cómo leer este plan

- Cada **fase = 1 PR atómico** que compila y aporta valor observable.
- `[ ]` son tareas ordenadas dentro de la fase (respetar el orden: types → db → api-core → adapter).
- **Puerta de calidad** al final de cada fase (obligatoria antes del PR):
  ```bash
  pnpm typecheck && pnpm lint          # raíz del monorepo
  pnpm --filter @soe/types test        # si tocó packages/types
  pnpm --filter api test               # si tocó apps/api  (o cwd apps/api: pnpm test)
  pnpm --filter @soe/db db:migrate     # local, si tocó schema/RLS
  ```
- Cada fase cierra con un commit conventional en español (skill `commit`) y PR con `create-pr`.
- El MVP son las fases **F0–F6**. F7 es hardening opcional; F8 son extensiones post-MVP.

## Secuenciación

```
F0 ── F1 ── F2 ── F3 ──┬── F4a ── F5
                       ├── F4b
                       └────────── F6  (in-app; depende de F1 + F4)
F7 (hardening auth actual) — independiente, en cualquier momento
```

| Fase | Título | Toca DB | Riesgo | Depende de |
| ---- | ------ | ------- | ------ | ---------- |
| F0   | Preparación (WorkOS + deps + env + verif. constantes) | No | Bajo | — |
| F1   | Núcleo desacoplado (registry + interfaces + facade + `whoami`) | No | Medio | F0 |
| F2   | Adaptador MCP externo + `McpAuthGuard` (OAuth WorkOS) + PRM | No | **Alto** | F1 |
| F3   | Gating por org (flag `mcp`) + auditoría + rate limiting | Sí | Medio | F2 |
| F4a  | Trío del caso estrella (`blueprint`, `item_statistics`, `skill_gaps`) | No | Medio | F3 |
| F4b  | Tools restantes (`list_assessments`, `assessment_overview`, `skill_heatmap`) | No | Bajo | F3 |
| F5   | Resources + Prompts + demo del caso estrella | No | Bajo | F4a |
| F6   | Adaptador in-app (`AssistantService` → `Facade`) | No | Medio | F1, F4 |
| F7   | (opc.) Hardening de la auth actual (§13 del diseño) | No | Bajo | — |
| F8   | (futuro) Extensiones: benchmark, PII por alumno, binario separado | — | — | F4 |

**Estructura de carpetas objetivo** (`apps/api/src/mcp/`, módulo independiente):

```
mcp/
  mcp.module.ts
  core/           analytics-principal.ts · analytics-tool.ts (+ @AnalyticsTool) · tool-registry.ts · analytics-tools.facade.ts
  auth/           mcp-auth.guard.ts · mcp-principal.resolver.ts · protected-resource.controller.ts
  adapter/        mcp.controller.ts        (bridge tools/list + tools/call → facade)
  observability/  mcp-audit.interceptor.ts
  tools/          whoami.tool.ts · get-instrument-blueprint.tool.ts · get-item-statistics.tool.ts · …
  resources/      taxonomy.resource.ts · performance-bands.resource.ts · analytics-capabilities.resource.ts
  prompts/        contrastar-dificultad.prompt.ts · …
```

---

## Fase 0 — Preparación (provisioning + deps, desbloquea el código)

**Objetivo:** dejar listas las decisiones operativas y el entorno para no bloquear a mitad de fase.
Ver §4 y §11 del diseño.

### Provisioning WorkOS (sin tarjeta, environment Staging)

- [ ] Crear cuenta WorkOS + environment **Staging**. No requiere tarjeta.
- [ ] AuthKit: configurar redirect URI; habilitar login social **Google** y **Microsoft** (en Staging
      alcanzan las credenciales compartidas de WorkOS para probar).
- [ ] MCP: en **Connect → Configuration**, habilitar **DCR** y/o **CIMD**; registrar la **URI canónica
      del MCP** como Resource Indicator (define el `aud` de los tokens).
- [ ] Copiar credenciales del environment: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, dominio AuthKit
      (issuer) y URL de **JWKS**.

### Repo

- [ ] Definir la **URI canónica** del MCP (p. ej. `https://mcp.academos.../mcp`) y la ruta/subdominio
      en la config de deploy (SST). Para dev local, `http://localhost:4000/mcp`.
- [ ] Agregar deps en `apps/api`: `@rekog/mcp-nest`, `@modelcontextprotocol/sdk`, `@nestjs/throttler`.
      (`jose` ya está por NextAuth; reusarlo para validar el JWT de WorkOS.)
- [ ] `.env.example` + config: `WORKOS_JWKS_URL`, `WORKOS_ISSUER`, `MCP_CANONICAL_URI`,
      `MCP_ENABLED` (default false hasta F2). Validarlas con `ConfigService.getOrThrow` donde se usen.
- [ ] **Verificar** que existen las constantes de rol de las 6 tools en
      `packages/types/src/access-policies/`: `ITEM_ANALYSIS_VIEWER_ROLES`, `ITEM_VIEWER_ROLES`,
      `DASHBOARD_VIEWER_ROLES`, `HEATMAP_VIEWER_ROLES`. Si falta alguna, agregarla al archivo de
      dominio correspondiente (regla `05-rbac-guards`), **nunca inline**.

**Aceptación:** environment de WorkOS operativo, deps instaladas, env vars documentadas, constantes
de rol confirmadas. Sin código de negocio. (Puede cerrarse como PR de scaffolding o ir junto a F1.)

---

## Fase 1 — Núcleo desacoplado (sin transporte, sin auth)

**Objetivo:** el corazón open/closed del módulo, testeable en aislamiento total (cero HTTP/MCP/OAuth).
Ver §3 del diseño.

### Tareas

- [ ] `apps/api/src/mcp/core/analytics-principal.ts` — interfaz `AnalyticsPrincipal`
      (`userId`, `orgId`, `roles`, `isPlatformAdmin`, `features`, `channel: 'mcp-external' | 'in-app'`).
      `JwtPayload` debe ser estructuralmente asignable (verificar con un type-test).
- [ ] `apps/api/src/mcp/core/analytics-tool.ts` — interfaz `AnalyticsTool<I, O>`
      (`descriptor` + `execute(principal, input)`), tipo `ToolDescriptor` (`name`, `description`,
      `inputSchema: ZodType`, `outputSchema: ZodType`, `requiredRoles: readonly UserRole[]`,
      `requiredFeature?: FeatureKey`, `piiLevel: 'aggregate' | 'individual'`), y el decorador
      `@AnalyticsTool()` (marca la clase para descubrimiento por DI).
- [ ] `apps/api/src/mcp/core/tool-registry.ts` — `ToolRegistry` (injectable). Usa `DiscoveryService`
      de `@nestjs/core` para colectar todas las clases marcadas `@AnalyticsTool()` en `onModuleInit`.
      Expone `list(): ToolDescriptor[]`, `listVisible(principal): ToolDescriptor[]` (filtra por
      `requiredRoles` con `userHasAnyRole` + `requiredFeature` contra `principal.features`), y
      `get(name): AnalyticsTool`. Sin `find` en loop: indexar por `name` en un `Map` una vez.
- [ ] `apps/api/src/mcp/core/analytics-tools.facade.ts` — `AnalyticsToolsFacade.execute(name,
      principal, input)`: (1) resuelve la tool del registry (404 si no existe), (2) **hard gate** de
      rol/feature (403 con `ForbiddenException` si no pasa, aunque el listado ya filtre),
      (3) valida `input` con `descriptor.inputSchema` (`BadRequestException` en fallo), (4) llama
      `execute`. Es el punto único que ambos adaptadores consumen.
- [ ] `apps/api/src/mcp/tools/whoami.tool.ts` — tool canario `@AnalyticsTool()`: devuelve
      `{ userId, orgId, roles, isPlatformAdmin, features, channel }` del principal. `piiLevel:
      'aggregate'`, `requiredRoles`: cualquier rol autenticado (usar el set más amplio disponible).
- [ ] `apps/api/src/mcp/mcp.module.ts` — declara el core (`DiscoveryModule`, registry, facade, tools)
      y **exporta** `AnalyticsToolsFacade` (para el adaptador in-app en F6). Registrar en `app.module.ts`.
- [ ] Tests (`.spec.ts` junto a cada archivo, patrón regla `01-testing`):
  - `tool-registry.spec.ts` — descubre las tools marcadas; `listVisible` filtra por rol/feature.
  - `analytics-tools.facade.spec.ts` — 403 por rol, 400 por input inválido, ejecuta OK con principal
    válido (tool fake). Sin DB.

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test`.
PR: `feat(api): núcleo desacoplado del MCP (registry + facade + tool canario)`.

**Aceptación:** agregar una clase `@AnalyticsTool()` la hace visible en el registry **sin editar el
registry ni el facade** (open/closed verificado en test). `whoami` ejecuta vía el facade con un
principal fabricado. Cero dependencia de HTTP/MCP/OAuth.

---

## Fase 2 — Adaptador MCP externo + auth OAuth (WorkOS)

**Objetivo:** exponer el `whoami` sobre Streamable HTTP como OAuth 2.1 Resource Server; que Claude/
ChatGPT completen el flujo OAuth de punta a punta. Ver §4 del diseño. **Fase de mayor riesgo.**

### Decisión de librería (primera tarea, innegociable open/closed)

- [ ] Elegir el mecanismo de exposición con **registro dinámico desde el `ToolRegistry`** (agregar
      una tool = clase nueva, cero edits al adaptador):
  - **(a) `@rekog/mcp-nest`** si soporta registro programático/dinámico de tools (guards NestJS
      nativos). Preferido si aplica.
  - **(b) `@modelcontextprotocol/sdk` crudo** (`StreamableHTTPServerTransport`) montado en una ruta
      NestJS, iterando el registry en el bootstrap. Fallback si (a) solo permite `@Tool` estáticos.
  - En ambos casos: transporte **Streamable HTTP stateless**; el bridge `tools/list`/`tools/call`
      delega en `ToolRegistry.listVisible` y `AnalyticsToolsFacade.execute`.

### Auth (el core de la fase)

- [ ] `apps/api/src/mcp/auth/mcp-principal.resolver.ts` — dado el `email`/`sub` del token validado,
      resuelve `AnalyticsPrincipal` desde la DB: usuario por `email`, memberships → org **por defecto**
      (`pickDefaultActiveOrg`) → `roles` de esa org, `features` desde `organizations.config`.
      **Reusar la lógica de resolución de roles-por-org de `auth.service.ts`** (la de `validateUser`/
      `switchActiveOrg`); si no está expuesta como método reutilizable, **promoverla** (regla
      `03-helpers-vs-services`), no duplicar. Si el email no existe como usuario provisionado →
      `ForbiddenException` (propiedad clave: WorkOS autentica, pero solo usuarios nuestros acceden).
- [ ] `apps/api/src/mcp/auth/mcp-auth.guard.ts` — `McpAuthGuard`: extrae `Bearer`, valida el JWT con
      `jose.jwtVerify(token, remoteJWKS, { issuer: WORKOS_ISSUER, audience: MCP_CANONICAL_URI })`
      (rechaza `aud` incorrecta → 401, RFC 8707), llama al resolver y setea `request.user` =
      `AnalyticsPrincipal` con `channel: 'mcp-external'`. Cachear el JWKS (`createRemoteJWKSet`).
- [ ] `apps/api/src/mcp/auth/protected-resource.controller.ts` — `GET /.well-known/oauth-protected-
      resource` (`@Public()`): devuelve `{ resource, authorization_servers: [WORKOS_ISSUER] }` (RFC
      9728). Asegurar `WWW-Authenticate` con la URL de metadata en las respuestas 401 del MCP.
- [ ] La ruta MCP se marca `@Public()` (salta el `AuthGuard` global de NextAuth) y aplica
      `@UseGuards(McpAuthGuard)` — dos modelos de token distintos conviviendo (§4 del diseño).

### Adapter

- [ ] `apps/api/src/mcp/adapter/mcp.controller.ts` — bridge: `tools/list` → `registry.listVisible
      (principal)` mapeado al shape MCP (name/description/inputSchema/outputSchema); `tools/call` →
      `facade.execute(name, principal, input)` con **structured output** (el `outputSchema` del
      descriptor). Deny-by-default: solo se anuncian las tools visibles.
- [ ] Registrar solo `whoami` en esta fase (las 6 tools llegan en F4).

### Tests

- [ ] `mcp-auth.guard.spec.ts` — DB fake (patrón `heatmap.service.spec.ts`): token válido → principal;
      `aud` incorrecta → 401; expirado → 401; email desconocido → 403.
- [ ] `mcp.controller.spec.ts` — `supertest`: sin token → 401 + `WWW-Authenticate`; con token válido →
      `tools/list` incluye `whoami`; `tools/call whoami` → identidad + org/roles resueltos.

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test` + **prueba manual
E2E**: conectar Claude (connector remoto) **y** ChatGPT al MCP de Staging, completar el OAuth
(Google/Microsoft) y ejecutar `whoami`.
PR: `feat(api): adaptador MCP externo con OAuth 2.1 (WorkOS) y tool canario`.

**Aceptación:** un usuario provisionado conecta Claude/ChatGPT, se autentica vía Google/Microsoft,
y `whoami` devuelve su identidad + `orgId`/`roles` resueltos desde nuestra DB. Un email no
provisionado o un token con `aud` ajena son rechazados.

---

## Fase 3 — Gating por org (flag `mcp`) + auditoría + rate limiting

**Objetivo:** que el MCP sea opt-in por colegio, con trazabilidad total y protección anti-abuso.
Ver §3.5–§3.7 del diseño.

### DB + types

- [ ] `packages/types` — extender `orgConfigSchema.allowedFeatures` con `'mcp'` (agregar a
      `FEATURE_KEYS`/`FeatureKey`). Actualizar `feature.schema.spec` si existe.
- [ ] `packages/db/src/schema/mcp.ts` — tabla `mcp_access_logs` (`id`, `orgId NOT NULL`, `userId`,
      `tool`, `argsHash`, `resultSummary`, `channel`, `createdAt`). Export desde el index de schema.
- [ ] `packages/db/sql/rls-policies.sql` — política de aislamiento `org_id` para `mcp_access_logs`
      (regla CLAUDE.md §5.2; el `.sql` es la fuente que `db:migrate` re-aplica). Generar migración con
      `pnpm db:generate` y correr `db:migrate` local.

### API

- [ ] `apps/api/src/mcp/auth/mcp-auth.guard.ts` — sumar chequeo de feature `mcp`: la org del principal
      debe tener `mcp` en `allowedFeatures` (reusar `isFeatureAllowed`). Sin el flag → 403 aunque el
      rol sea válido. `platform_admin` bypass.
- [ ] `apps/api/src/mcp/observability/mcp-audit.interceptor.ts` — interceptor que registra cada
      `tools/call` en `mcp_access_logs` dentro de `withOrgContext` (quién, qué tool, `argsHash`,
      canal, timestamp). Aplicar al `mcp.controller`.
- [ ] `@nestjs/throttler` — límite por `userId`/`orgId` sobre la ruta MCP. Config conservadora.
- [ ] Tests: guard rechaza org sin flag `mcp`; interceptor inserta un log (DB fake).

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test && pnpm --filter
@soe/db db:migrate`.
PR: `feat(api): opt-in por org, auditoría y rate limiting del MCP`.

**Aceptación:** una org sin `mcp` en `allowedFeatures` recibe 403; cada invocación queda en
`mcp_access_logs`; el throttler corta ráfagas.

---

## Fase 4a — Trío del caso estrella (`blueprint` + `item_statistics` + `skill_gaps`)

**Objetivo:** habilitar el contraste dificultad declarada vs empírica vs brechas — el valor central.
Ver §8 y §9 del diseño. Cada tool es una clase `@AnalyticsTool()` que **envuelve un service
existente**; el adaptador y el registry **no se tocan** (open/closed).

### Tareas

- [ ] `apps/api/src/mcp/tools/get-instrument-blueprint.tool.ts` — envuelve
      `InstrumentsService.getById` + `ItemsService.list`. Descriptor: input `{ instrumentId }`,
      output = instrumento → secciones → ítems con `difficulty`, `irtParams`, tags de taxonomía.
      `requiredRoles: ITEM_VIEWER_ROLES`, `piiLevel: 'aggregate'`. Reusar/definir el `outputSchema`
      en `@soe/types` (preferir DTOs existentes de instruments/items).
- [ ] `apps/api/src/mcp/tools/get-item-statistics.tool.ts` — envuelve `ItemAnalysisService.getMatrix`
      / `getQuestionAnalysis`. Output: p-value, distribución de distractores, omitidas.
      `requiredRoles: ITEM_ANALYSIS_VIEWER_ROLES`. Reusar `questionAnalysisResponseSchema`.
- [ ] `apps/api/src/mcp/tools/get-skill-gaps.tool.ts` — envuelve `DashboardsService.getSkills` +
      `getSkillBreakdown` (o `HeatmapService.getHeatmap`). Output: habilidades bajo umbral ranqueadas
      + ítems que las miden. `requiredRoles: DASHBOARD_VIEWER_ROLES`.
- [ ] Adaptar los services si toman `JwtPayload`: aceptan `AnalyticsPrincipal` (superset compatible)
      o se les pasa el principal tal cual. **No** duplicar lógica de query — solo envolver.
- [ ] Tests por tool: descriptor bien formado; `execute` delega en el service (service fake o mock del
      método puntual, patrón `01-testing`); gating de rol vía facade.

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test` + manual:
`tools/call` de las 3 desde Claude sobre una evaluación real de Staging.
PR: `feat(api): tools MCP de blueprint, estadística de ítem y brechas`.

**Aceptación:** con las 3 tools, Claude puede cruzar dificultad declarada (`irtParams`/`difficulty`)
contra empírica (p-value) contra brechas, y detectar ítems miscalibrados / brechas-artefacto (§9).

---

## Fase 4b — Tools restantes (`list_assessments` + `assessment_overview` + `skill_heatmap`)

**Objetivo:** completar el catálogo de 6 tools del MVP. Mismo patrón que F4a.

### Tareas

- [ ] `list-assessments.tool.ts` — `ItemAnalysisService.listAssessments` /
      `DashboardsService.getFilterOptions`. `ITEM_ANALYSIS_VIEWER_ROLES`.
- [ ] `get-assessment-overview.tool.ts` — `DashboardsService.getOverview` /
      `CourseReportService.getCourseReport`. `DASHBOARD_VIEWER_ROLES`.
- [ ] `get-skill-heatmap.tool.ts` — `HeatmapService.getHeatmap`. `HEATMAP_VIEWER_ROLES`.
- [ ] Tests por tool (idéntico patrón F4a).

**Puerta de calidad + PR:** igual que F4a.
PR: `feat(api): tools MCP de listado de evaluaciones, panorama y heatmap`.

**Aceptación:** las 6 tools visibles/ejecutables según rol; un `teacher` solo ve las permitidas y con
scope de sus cursos (heredado de los services).

---

## Fase 5 — Resources + Prompts + demo del caso estrella

**Objetivo:** datos de referencia y flujos guiados que potencian el análisis. Ver §8 del diseño.

### Tareas

- [ ] `resources/taxonomy.resource.ts` — `taxonomy://{taxonomyId}` (árbol de `taxonomy_nodes`).
- [ ] `resources/performance-bands.resource.ts` — `performance-bands://{instrumentId}`.
- [ ] `resources/analytics-capabilities.resource.ts` — `analytics-capabilities://{assessmentId}`
      (reusar `packages/types/src/analytics-capabilities.ts` / `dataGranularity`).
- [ ] `prompts/contrastar-dificultad.prompt.ts` — orquesta blueprint + item_statistics + skill_gaps
      para una evaluación y pide el dictamen de calibración/validez (el caso estrella, §9).
- [ ] `prompts/diagnostico-brechas-curso.prompt.ts`, `prompts/auditar-calidad-instrumento.prompt.ts`.
- [ ] Registrar resources/prompts en el adaptador (mismo bridge dinámico).

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test` + manual: correr
el prompt `contrastar_dificultad` en Claude y validar el análisis.
PR: `feat(api): resources y prompts analíticos del MCP (incl. contraste de dificultad)`.

**Aceptación:** el prompt del caso estrella produce, en 2–3 tool calls, un análisis de calidad del
instrumento contrastado con los resultados.

---

## Fase 6 — Adaptador in-app (asistente existente)

**Objetivo:** que el `AssistantService` reuse el **mismo núcleo** de tools sin pasar por OAuth/HTTP.
Ver §3 (Adaptador B) del diseño. Depende de F1 (facade) + F4 (tools reales).

### Tareas

- [ ] `apps/api/src/assistant/…` — inyectar `AnalyticsToolsFacade`; construir `AnalyticsPrincipal`
      (`channel: 'in-app'`) desde el `JwtPayload` de la sesión; exponer las tools al loop del
      asistente (tool-calling) delegando en `facade.execute`.
- [ ] Auditoría: el interceptor de F3 no aplica al canal in-app (no pasa por el `mcp.controller`);
      registrar en `mcp_access_logs` desde el facade o un wrapper para trazar ambos canales.
- [ ] Tests: el asistente resuelve una consulta analítica invocando una tool vía el facade (mock del
      método del service).

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test`.
PR: `feat(api): el asistente in-app consume las tools analíticas vía el facade`.

**Aceptación:** el asistente in-app responde una pregunta analítica usando las tools, con el mismo
gating de rol; misma lógica que el canal externo, distinto adaptador.

---

## Fase 7 (opcional) — Hardening de la auth actual

**Objetivo:** cerrar los endurecimientos de §13 del diseño. Independiente del MCP.

### Tareas

- [ ] `apps/api/src/auth/auth.controller.ts:18` — reemplazar `token !== expected` por
      `crypto.timingSafeEqual` (comparación constant-time del token interno).
- [ ] `auth.controller.ts:73-79` — gatear `mock-users` también por `NODE_ENV !== 'production'`
      (defensa extra contra login-bypass si `AUTH_MODE=mock` se filtra a prod).
- [ ] (Infra, fuera de código) Restringir por red los endpoints `@Public` con `x-internal-token` al
      tier web; documentar en el runbook de deploy.

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test`.
PR: `fix(api): endurecer comparación del token interno y gatear login mock por entorno`.

**Aceptación:** el token interno se compara en tiempo constante; el login mock es inalcanzable en prod.

---

## Fase 8 (futuro, no MVP) — Extensiones (open/closed, sin tocar el núcleo)

- [ ] `compare_benchmark` — envuelve `BenchmarkingService.compare`; `@RequireFeature('benchmarking')`;
      hereda el k-anonimato del service.
- [ ] Tools de **detalle por alumno** (PII) para el canal **in-app**: `piiLevel: 'individual'`,
      `SensitiveDataGuard` + scope, id seudónimo (no RUT). Activar el filtro `piiLevel` en el
      adaptador externo (una línea) para rechazarlas ahí.
- [ ] Extraer el `McpModule` a un binario/subdominio separado si el perfil de carga lo justifica.

Cada una es **una clase nueva** registrada por DI: cero ediciones al registry, al facade ni al
adaptador.

---

## Checklist transversal (aplicar en cada fase)

- [ ] `orgId` **siempre** del principal (token validado o sesión), nunca de los args de la tool.
- [ ] Toda query a tabla con RLS corre en `withOrgContext` usando `tx` (heredado de los services).
- [ ] `McpAuthGuard` valida **audiencia** del token; **cero token passthrough** a downstream.
- [ ] Roles vía constantes de `access-policies/` + `userHasAnyRole`/registry, **nunca listas inline**.
- [ ] **Open/closed:** agregar una tool/resource/prompt = clase nueva autoregistrada; **cero ediciones**
      al registry, al facade ni al adaptador. Verificarlo en cada fase que sume tools.
- [ ] Toda tool declara `piiLevel` (`aggregate` en el MVP).
- [ ] Structured output vía DTOs Zod de `@soe/types`; reusar los existentes antes de crear.
- [ ] Sin O(N²): agregaciones en una pasada con `Map`, sin `find`/spread en loop (heredado + propio).
- [ ] Sin comentarios en código (regla `02-no-comments`); nombres autoexplicativos.
- [ ] Tests junto al archivo (regla `01-testing`): helpers/registry puros directo; guards/services con
      `Database` fake por-test; controllers con `supertest`.
- [ ] Commit conventional en español por fase (skill `commit`); PR con `create-pr`.
