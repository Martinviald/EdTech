# Propuesta de diseño — Servidor MCP analítico (AcademOS)

> Estado: **propuesta / RFC — v2** (decisiones del equipo integradas). Objetivo: exponer los datos
> pedagógicos de AcademOS a asistentes de IA (Claude, ChatGPT y el asistente in-app) vía **Model
> Context Protocol (MCP)**, con enfoque **100% analítico y de solo lectura**, para ver instrumentos,
> evaluaciones, resultados, identificar brechas y —sobre todo— **contrastar los resultados contra la
> dificultad/calidad del instrumento y sus ítems**.
>
> Principio rector adicional (v2): el MCP es un **módulo desacoplado, independiente y open/closed**.
> El núcleo de tools no conoce el transporte ni la auth; se extiende agregando clases, sin modificar
> lo existente; y lo consumen dos adaptadores (MCP externo + asistente in-app).

---

## Decisiones tomadas (v2)

| # | Decisión | Resolución |
|---|---|---|
| 1 | Authorization Server | **WorkOS AuthKit** (comparativa en §4.1). Hace **authN** (federa a Google/Microsoft, gestiona el directorio de usuarios + orgs); **AcademOS retiene authZ** (org/roles en su DB). El MCP es un resource server que **solo valida JWT** (sin middleware de sesión). Free hasta 1M MAU. |
| 2 | Consumidor | **Doble consumidor**: asistente in-app *y* asistentes externos (Claude / ChatGPT con modelos más potentes). Tools reutilizables por ambos → **núcleo desacoplado + dos adaptadores**. |
| 3 | PII | **Resuelta.** MVP **no invierte** en protección estricta de PII (prioridad: velocidad). Las 6 tools son agregadas por naturaleza y no exponen PII individual igual; `piiLevel` queda como **semilla declarativa de costo cero** para endurecer después sin tocar el núcleo. |
| 4 | Alcance MVP | **6 tools**, **sin benchmarking** por ahora (queda como extensión). |
| 5 | Despliegue | **Mismo proceso NestJS** que `apps/api` inicialmente. |
| + | Arquitectura | **Módulo desacoplado, independiente, open/closed.** |

---

## 1. Resumen ejecutivo

**Decisión central:** construir el MCP como un **módulo NestJS independiente dentro de `apps/api`**
(`apps/api/src/mcp/`), con un **núcleo de tools desacoplado del transporte y de la auth**, expuesto
por **dos adaptadores**:

- **Adaptador MCP externo** — usando **[`@rekog/mcp-nest`](https://github.com/rekog-labs/mcp-nest)**
  sobre **Streamable HTTP**, como **OAuth 2.1 Resource Server** (spec MCP 2025-06-18). Por ser
  spec-compliant, **sirve tanto a Claude como a ChatGPT** (ambos soportan conectores MCP remotos) →
  así se accede a los modelos frontier de cada proveedor.
- **Adaptador in-app** — el `AssistantService` existente invoca el **mismo núcleo de tools**
  directamente, sin pasar por OAuth/HTTP.

Ambos adaptadores llaman al **mismo `ToolRegistry`**, que ejecuta tools que envuelven los *services
analíticos ya existentes* (`HeatmapService`, `DashboardsService`, `ItemAnalysisService`,
`AssessmentResultsService`, `InstrumentsService`, `ItemsService`). Esos services ya corren dentro de
`withOrgContext(db, orgId, tx => ...)`, así que **la aislación de tenant y la RLS se heredan sin
duplicar una sola query**.

**Por qué esta forma cumple open/closed:** agregar una tool nueva = **crear una clase que se
autoregistra**; cero ediciones al registry, a los adaptadores o al handler de `tools/list`. Agregar
un transporte nuevo (p. ej. un adaptador para otra plataforma) = **un adaptador nuevo** que consume
el mismo núcleo; cero cambios a las tools. El módulo es **independiente**: el resto de `apps/api` no
depende de él (solo el módulo importa services analíticos, no al revés) — se puede quitar sin romper
la app.

**Seguridad (idéntica al stack probado en producción):** el adaptador MCP valida un **token OAuth
con audiencia acotada al MCP** (RFC 8707), lo traduce a un `AnalyticsPrincipal` (superset del
`JwtPayload` actual) y aplica los mismos `RolesGuard` / `FeatureGuard` por tool. Aislación por
`withOrgContext` + RLS. Sin token passthrough (evita *confused deputy*). Las 6 tools del MVP son
agregadas por naturaleza (no exponen PII individual); la protección estricta de PII se **difiere**
(MVP prioriza velocidad), dejando `piiLevel` como semilla de costo cero. Auditoría en
`mcp_access_logs`.

**Lo que NO es:** no escribe nada (read-only), no expone corrección IA ni generación de contenido,
no rompe la taxonomía universal ni hardcodea "DIA".

---

## 2. Contexto: qué ya existe y por qué es la base

El proyecto ya tiene, probado y en producción, casi todo lo que un MCP seguro necesita. El diseño se
apoya en reutilizar, no en construir:

| Pieza existente | Archivo | Rol en el MCP |
|---|---|---|
| `JwtPayload` (`userId`, `orgId`, `roles[]`, `activeRole`, `isPlatformAdmin`) | `apps/api/src/auth/jwt-payload.types.ts` | Base del `AnalyticsPrincipal` que ambos adaptadores producen |
| `RolesGuard` + `@Roles()` (unión, bypass `platform_admin`) | `apps/api/src/common/guards/roles.guard.ts` | Gating por rol **por tool** |
| `FeatureGuard` + `@RequireFeature()` | `apps/api/src/common/guards/feature.guard.ts` | Gating de tools premium (extensión) |
| `SensitiveDataGuard` + `SENSITIVE_DATA_ROLES` | `apps/api/src/common/guards/sensitive-data.guard.ts` | Gating de tools con PII (fase posterior) |
| `withOrgContext(db, orgId, fn)` | `packages/db/src/with-org-context.ts` | Aislación de tenant (RLS) dentro de cada tool |
| Políticas RLS (`FORCE ROW LEVEL SECURITY`, rol `soe_app` sin `BYPASSRLS`) | `packages/db/sql/rls-policies.sql` | Barrera de aislamiento a nivel motor |
| Constantes de acceso por dominio (`DASHBOARD_VIEWER_ROLES`, `ITEM_ANALYSIS_VIEWER_ROLES`, `HEATMAP_VIEWER_ROLES`, …) | `packages/types/src/access-policies/` | Una sola lista de roles, compartida con la web y los controllers |
| Zod DTOs de request/response de cada dominio | `packages/types/src/schemas/` | `inputSchema`/`outputSchema` de las tools (structured output) |
| `AssistantService` (asistente in-app) | `apps/api/src/assistant/` | **Adaptador in-app**: consume el mismo `ToolRegistry` |
| Services analíticos (heatmap, dashboards, item-analysis, results, official-reports, instruments, items) | `apps/api/src/*/` | La lógica que las tools envuelven |

**Materia prima para "contrastar resultados vs calidad del instrumento":** ya está en el modelo.

- **Dificultad declarada** del ítem: `items.difficulty` (`easy|medium|hard`) e `items.irtParams`
  (`{ a?, b?, c? }` — discriminación, dificultad, azar del modelo 3PL).
- **Dificultad empírica**: `assessment_item_stats` (`correctCount`, `responseCount`,
  `answerCounts: [{key, count, isCorrect}]`) → p-value y **distribución de distractores** por
  ítem/curso.
- **Brechas**: `skill_results` / `assessment_skill_stats` por `taxonomy_node`, con `performance_bands`.
- **Vínculo ítem ↔ habilidad**: `item_taxonomy_tags`.
- **Profundidad disponible**: `assessments.dataGranularity` (`item_level` vs `aggregate_only`), ver
  `packages/types/src/analytics-capabilities.ts`.

---

## 3. Arquitectura desacoplada (open/closed + doble consumidor)

Ésta es la sección que materializa tus decisiones #2 y la de "módulo desacoplado e independiente".
Tres capas de núcleo + dos adaptadores finos.

```
                    ┌──────────────────────────────────────────────────────────┐
                    │  NÚCLEO DESACOPLADO (no conoce HTTP / MCP / OAuth)         │
   Claude  ─┐       │                                                            │
   ChatGPT  ├─ MCP ─┤  ToolRegistry ──► AnalyticsTool.execute(principal, input) │──► services analíticos
            │ adapt.│                        │                                   │      (Heatmap, Dashboards,
 Asistente ─┘       │        (agregar tool = nueva clase, 0 edits) ◄── open/closed│       ItemAnalysis, …)
 in-app ───────────►│  AnalyticsToolsFacade ─┘                                   │──► withOrgContext / RLS
 (JwtPayload)       └──────────────────────────────────────────────────────────┘
```

### Capa 1 — Contratos de tool (declarativa, sin lógica)

Cada tool se describe como **dato**, no comportamiento: `name`, `description`, `inputSchema` (Zod),
`outputSchema` (Zod), `requiredRoles: readonly UserRole[]`, `requiredFeature?: FeatureKey`,
`piiLevel: 'aggregate' | 'individual'`. Vive en `packages/types` (compartible con la web si hace
falta) o en el módulo. Es lo que se usa para: validar entrada, tipar la salida (structured output),
filtrar el catálogo por rol/feature/PII y auditar.

### Capa 2 — Handlers de tool (núcleo reutilizable, desacoplado de transporte/auth)

Interfaz común que toda tool implementa:

```typescript
export interface AnalyticsPrincipal {
  userId: string;
  orgId: string | null;
  roles: readonly UserRole[];
  isPlatformAdmin: boolean;
  features: readonly FeatureKey[];
  channel: 'mcp-external' | 'in-app';   // habilita la política de PII por canal
}

export interface AnalyticsTool<I, O> {
  readonly descriptor: ToolDescriptor<I, O>;
  execute(principal: AnalyticsPrincipal, input: I): Promise<O>;
}
```

- Depende **solo** de: los services analíticos (inyectados por DI) + `AnalyticsPrincipal`.
- **No** conoce HTTP, MCP ni el formato del token OAuth (Dependency Inversion).
- `JwtPayload` es estructuralmente compatible con `AnalyticsPrincipal` → el adaptador in-app casi no
  mapea; el adaptador MCP construye el principal desde el token validado.
- Cada `execute` termina llamando un service que corre en `withOrgContext(db, principal.orgId, …)`.

### Registro — el mecanismo open/closed

Un `ToolRegistry` colecciona todas las tools vía DI: cada tool es un provider bajo un token
multi-provider `ANALYTICS_TOOL` (o auto-descubierto con un decorador `@AnalyticsTool()` +
`DiscoveryService`). **Agregar una tool = crear la clase + registrarla como provider. Cero ediciones
al registry, a los adaptadores o al handler de `tools/list`.** Esto es Open/Closed literal.

### Adaptador A — MCP externo (Claude / ChatGPT)

`@McpController` (de `@rekog/mcp-nest`) que, para cada tool del registry, la expone sobre Streamable
HTTP con OAuth:

- `McpAuthGuard` valida el token (firma JWKS + `aud` + `exp`) → `AnalyticsPrincipal` con
  `channel: 'mcp-external'`.
- `tools/list` **filtra**: solo anuncia tools donde `canAccess(principal.roles, requiredRoles)` **y**
  feature habilitada **y** `piiLevel !== 'individual'` (política externa). Deny-by-default.
- `tools/call` → `registry.get(name).execute(principal, input)`, con `RolesGuard`/`FeatureGuard`
  como hard gate por si el cliente invoca una tool no anunciada.
- Spec-compliant (OAuth 2.1 RS + Streamable HTTP) → **Claude y ChatGPT** conectan igual.

### Adaptador B — In-app (asistente existente)

El módulo exporta un `AnalyticsToolsFacade` (fachada sobre el `ToolRegistry`) que el
`AssistantService` invoca directo, construyendo el `AnalyticsPrincipal` (`channel: 'in-app'`) desde
el `JwtPayload` de la sesión. Mismo núcleo, sin OAuth/HTTP. Puede usar un modelo más barato/rápido
para el uso cotidiano; el canal externo desbloquea los modelos frontier.

### Independencia del módulo

El acoplamiento es **unidireccional**: el módulo MCP importa services analíticos (a través de sus
interfaces públicas); el resto de `apps/api` **no** importa el módulo MCP. Se puede desactivar o
extraer a un binario separado (decisión #5, a futuro) sin tocar el resto de la app.

---

## 4. Autorización — OAuth 2.1 Resource Server (adaptador externo)

El consumidor externo es **un tercero** (Claude/ChatGPT), no el navegador. Por eso el adaptador MCP
**no** reusa el token de sesión NextAuth. El spec MCP exige que el servidor sea **OAuth 2.1 Resource
Server**:

- Sirve **`/.well-known/oauth-protected-resource`** (RFC 9728) apuntando al AS gestionado (decisión
  #1), y responde **`401` con `WWW-Authenticate`** cuando falta/expira el token.
- El cliente hace OAuth 2.1 con **PKCE**, incluyendo el **`resource` parameter** (RFC 8707) = URI
  canónica del MCP.
- El **access token** (JWT) llega como `Authorization: Bearer` en **cada** request. `McpAuthGuard`
  **valida audiencia**: `aud == https://mcp.<dominio>/mcp` o rechaza con `401`. Esto impide que un
  token de otro servicio sirva acá.
- **Prohibido token passthrough** (*confused deputy*): las tools llaman services in-process; si
  alguna llamara a la API de Claude/OpenAI, usa **su propia credencial** de servidor, no el token
  del usuario.

### 4.1 Proveedor: WorkOS AuthKit (recomendado)

Comparados los proveedores MCP-aware contra tus dos restricciones —(a) mismo modelo actual
(gestionar usuarios + delegar authN en Google/Microsoft) y (b) sin middleware/wrappers de sesión
tipo Auth0— gana **WorkOS AuthKit**:

| Criterio | WorkOS AuthKit | Stytch (Twilio) | Scalekit | Auth0 |
|---|---|---|---|---|
| "Gestiono usuarios + federo a Google/MS" | ✅ directorio + orgs + roles, social (Google/MS) + SSO enterprise; B2B-first, calza con colegios=orgs multi-rol | ⚠️ orientado a ser el issuer; sin *bring-your-own-users* limpio | ⚠️ capa de auth MCP, menos como directorio primario | ✅ pero DX pesada |
| MCP = solo validar JWT (sin middleware de sesión) | ✅ `jwtVerify(token, JWKS, {issuer, audience})` y nada más | ✅ | ✅ | ⚠️ sus SDK empujan sesión/cookies (lo que querés evitar) |
| DCR (RFC 7591) + CIMD | ✅ ambos | ✅ | ✅ ambos | ⚠️ configurable |
| Resource indicators / `aud` (RFC 8707) | ✅ | ✅ | ✅ | ✅ |
| Costo | **Free hasta 1M MAU** | Incierto post-adquisición Twilio (nov-2025) | Vendor menor/nuevo | Caro |

WorkOS hostea el AS OAuth completo (login, consent, emisión de tokens, DCR/CIMD, endpoint de AS
metadata), federa a Google/Microsoft y gestiona el directorio de usuarios + orgs — **exactamente tu
modelo actual**. Del lado del MCP, el resource server **solo valida el JWT** contra el JWKS con
`jose` (`jwtVerify(token, JWKS, { issuer, audience: 'https://mcp.academos.../mcp' })`) y sirve el
`.well-known/oauth-protected-resource` (un JSON chico). **Cero middleware de sesión, cero SDK
wrapper.**

### 4.2 Split authN / authZ — WorkOS autentica, AcademOS autoriza

Clave para respetar "solo gestionamos usuarios y delegamos la autenticación": **WorkOS hace authN,
AcademOS retiene authZ.**

- **WorkOS (authN):** identifica al usuario (vía Google/Microsoft) y emite el access token con `aud`
  = URI canónica del MCP. El token lleva **solo identidad** (`sub`, `email`, `aud`, `exp`, `scope`).
- **AcademOS (authZ):** el `McpAuthGuard` valida el token, extrae la identidad y **resuelve
  `orgId` + `roles` desde la DB propia** (`users` + `org_memberships`) con la **misma lógica que ya
  usa `auth.service.ts`**. Los roles/orgs **nunca salen de AcademOS** ni se sincronizan al IdP —
  evitamos el anti-patrón de duplicar el RBAC en el proveedor.

```jsonc
// Token de WorkOS: SOLO identidad. org/roles se resuelven en el guard desde nuestra DB.
{
  "sub": "<workos user id>",
  "email": "profe@colegio.cl",
  "aud": "https://mcp.academos.../mcp",   // validado — RFC 8707
  "scope": "analytics:read items:read",    // per-dominio, deny-by-default
  "exp": 1234567890                         // token corto + refresh rotado (lo maneja WorkOS)
}
```

**Multi-org:** como una org por token (invariante RLS), el guard resuelve la **org por defecto** del
usuario (misma heurística `pickDefaultActiveOrg`); operar en otra org se expone como recurso distinto
o vía un parámetro de scope. Para el MVP alcanza la org por defecto.

---

## 5. Aislación de tenant — `withOrgContext` sin excepciones

El `org_id` **siempre** sale del principal (token validado o sesión), nunca de un argumento de la
tool (CLAUDE.md §11). Cada tool llama un service que corre en `withOrgContext(db, orgId, tx => ...)`.
La RLS (`FORCE ROW LEVEL SECURITY`, rol `soe_app` sin `BYPASSRLS`) garantiza que un token de la org A
**físicamente no puede** leer filas de la org B: sin `set_config('app.current_org_id', …)`, la query
devuelve 0 filas. **Tres capas que se refuerzan: audiencia del token + `org_id` + RLS.**

(La única excepción cross-tenant del sistema, `benchmark_aggregates` con k-anonimato, no participa en
el MVP porque benchmarking queda fuera.)

---

## 6. Gating por rol, feature y PII

**Tres filtros, deny-by-default, sobre el mismo catálogo:**

1. **Rol (hard gate + visibilidad):** cada tool declara `requiredRoles` (constantes de
   `packages/types/src/access-policies/`, las mismas que gatean los endpoints REST equivalentes).
   `tools/list` solo anuncia las permitidas; `RolesGuard` bloquea (403) una invocación no permitida.
   El scoping por curso del profesor se hereda de los services (`teacher_assignments`) sin cambios.
2. **Feature (tiers pagos):** `requiredFeature` + `FeatureGuard`. Además, flag **`mcp` opt-in por
   org** en `organizations.config.allowedFeatures`: el MCP como canal se habilita por colegio.
3. **PII (semilla, sin enforcement en el MVP):** cada tool declara `piiLevel`. En el MVP **no se
   filtra** por este campo (las 6 tools son `aggregate`); queda declarado para que, al sumar tools
   `individual`, el adaptador externo las rechace con **una línea** (Fase 3).

### La decisión de PII (decisión #3 — resuelta)

Contexto: todo lo que una tool devuelve, el LLM (Anthropic/OpenAI, un tercero) lo procesa y puede
retener/loguear. Mandar datos que identifican a un alumno (nombre, RUT, fecha de nacimiento,
`students.profile.sensitiveNotes`, NEE) a un LLM externo es un tratamiento de datos personales bajo
**Ley 19.628**. El dato **agregado** (logro de curso, distribución por banda, brecha por habilidad,
estadística de ítem) casi no tiene ese riesgo.

**Decisión (v2): el MVP prioriza velocidad y NO invierte esfuerzo en gobernanza de PII ahora.** En
la práctica esto casi no cambia el MVP, porque **las 6 tools son agregadas por naturaleza** (cohorte
e ítem) y no devuelven PII individual de todos modos. Lo único que hacemos —por costar cero— es
**pavimentar el camino**:

- Cada tool declara `piiLevel` (metadato, sin enforcement activo). Endurecer después = filtrar por
  ese campo en `tools/list` + sumar `SensitiveDataGuard`: **cambio localizado, sin tocar el núcleo**
  (open/closed).
- **No** construimos ahora: enforcement por canal, seudonimización, gating con `SensitiveDataGuard`.
  Quedan como extensión (Fase 3) cuando se agreguen tools de detalle por alumno.

---

## 7. Anatomía de una tool

```
Claude / ChatGPT (MCP client)                         Asistente in-app
  │ Bearer <token: aud=MCP, org_id, roles, scope>       │ JwtPayload (sesión)
  ▼                                                      ▼
McpAuthGuard (JWKS + aud + exp) ─► AnalyticsPrincipal    AnalyticsToolsFacade ─► AnalyticsPrincipal
  ▼                                                      ▼
        ┌───────────────── ToolRegistry ─────────────────┐
        │  RolesGuard (@Roles(...ITEM_ANALYSIS_VIEWER))   │
        │  FeatureGuard (solo tools premium)              │
        │  AnalyticsTool.execute(principal, input)        │  input validado con Zod DTO
        └───────────────────────┬─────────────────────────┘
                                ▼
        ItemAnalysisService.getQuestionAnalysis(principal, itemId, query)
                                ▼
        withOrgContext(db, principal.orgId, tx => ...)   ── RLS: app.current_org_id
                                ▼
        structured output (outputSchema = Zod DTO existente)
                                │
                                └─► McpAuditInterceptor → mcp_access_logs
```

**Structured output:** las tools declaran `outputSchema` reusando DTOs Zod de
`packages/types/src/schemas/` (p. ej. `QuestionAnalysisResponse`). JSON tipado y validado, no texto
libre — el contrato ya existe y está testeado.

**Boceto (una tool):**

```typescript
@AnalyticsTool()                                   // auto-registro (open/closed)
export class GetItemStatisticsTool
  implements AnalyticsTool<QuestionAnalysisQueryDto, QuestionAnalysisResponse>
{
  readonly descriptor = {
    name: 'get_item_statistics',
    description:
      'Estadística empírica por ítem: p-value (% correcto), distribución de respuestas por ' +
      'alternativa (distractores) y omitidas. Úsalo para contrastar dificultad REAL vs declarada.',
    inputSchema: questionAnalysisQuerySchema,       // Zod de @soe/types
    outputSchema: questionAnalysisResponseSchema,
    requiredRoles: ITEM_ANALYSIS_VIEWER_ROLES,
    piiLevel: 'aggregate' as const,
  };

  constructor(private readonly itemAnalysis: ItemAnalysisService) {}

  execute(principal: AnalyticsPrincipal, input: QuestionAnalysisQueryDto) {
    return this.itemAnalysis.getQuestionAnalysis(principal, input.itemId, input);
  }
}
```

El `@McpController` no cambia al agregar esta clase: la descubre por el registry.

---

## 8. Catálogo del MVP — 6 tools

Todas: **read-only, org-scoped por principal, `piiLevel: 'aggregate'`, structured output.** "Servicio
reusado" = ya existe.

| # | Tool | Qué entrega | Servicio reusado | Roles (constante) |
|---|---|---|---|---|
| 1 | `list_assessments` | Evaluaciones filtrables (asignatura, grado, curso, período, año) + estado de resultados | `ItemAnalysisService.listAssessments` / `DashboardsService.getFilterOptions` | `ITEM_ANALYSIS_VIEWER_ROLES` |
| 2 | `get_instrument_blueprint` | Instrumento → secciones → ítems: tipo, puntaje, **`difficulty` declarada**, **`irtParams`**, tags de taxonomía (habilidad medida) | `InstrumentsService.getById` + `ItemsService.list` | `ITEM_VIEWER_ROLES` |
| 3 | `get_assessment_overview` | Logro global de la cohorte, distribución por banda, comparabilidad, alertas | `DashboardsService.getOverview` / `CourseReportService.getCourseReport` | `DASHBOARD_VIEWER_ROLES` |
| 4 | `get_skill_gaps` | Habilidades bajo umbral, ranqueadas, con los **ítems que las midieron** | `DashboardsService.getSkills` + `getSkillBreakdown` / `HeatmapService.getHeatmap` | `DASHBOARD_VIEWER_ROLES` |
| 5 | `get_item_statistics` | Por ítem: **p-value (dificultad empírica)**, distribución de distractores, discriminación aprox. | `ItemAnalysisService.getMatrix` / `getQuestionAnalysis` | `ITEM_ANALYSIS_VIEWER_ROLES` |
| 6 | `get_skill_heatmap` | Matriz habilidad × asignatura (curso/grado) con niveles de logro | `HeatmapService.getHeatmap` | `HEATMAP_VIEWER_ROLES` |

**Resources (referencia que el asistente lee sin gastar una tool):**
- `taxonomy://{taxonomyId}` — árbol de `taxonomy_nodes` (habilidades/ejes).
- `performance-bands://{instrumentId}` — bandas y umbrales del instrumento.
- `analytics-capabilities://{assessmentId}` — qué análisis es posible según `dataGranularity`.

**Prompts (flujos guiados):**
- `contrastar_dificultad_declarada_vs_empirica` — el caso estrella (ver §9).
- `diagnostico_brechas_curso` — skill-gaps (4) + heatmap (6) + overview (3).
- `auditar_calidad_instrumento` — blueprint (2) + item-stats (5) + skill-gaps (4).

**Extensiones (fuera del MVP, puntos de extensión documentados):** `compare_benchmark`
(`@RequireFeature('benchmarking')`, k-anon), tools de detalle por alumno (PII, `SensitiveDataGuard` +
scope, canal in-app). Ninguna requiere tocar el núcleo: se agregan como clases nuevas (open/closed).

---

## 9. El caso estrella: contrastar resultados vs calidad del instrumento

El razonamiento lo hace el LLM sobre el dato correcto; el MCP lo habilita en 2–3 tool calls:

1. `get_instrument_blueprint(instrumentId)` → dificultad **declarada** por ítem (`difficulty`,
   `irtParams.b`) + qué habilidad mide cada ítem (`item_taxonomy_tags`).
2. `get_item_statistics(assessmentId)` → dificultad **empírica** (p-value) + distractores.
3. `get_skill_gaps(assessmentId)` → brechas por habilidad + ítems que las sostienen.

Análisis que hoy nadie hace a mano, por ejemplo:
- **Ítem miscalibrado:** declarado `hard` (`b`=1.8) pero p-value 0.94 → mide por debajo de su
  dificultad nominal; su aporte a la "brecha" es engañoso.
- **Brecha que es artefacto del instrumento:** descansa en un solo ítem con distractor dominante →
  antes que remediar, revisar la clave/redacción.
- **Instrumento fácil que infla el logro:** 78% de ítems con p-value > 0.85 → el logro alto no
  refleja dominio real.
- **Discriminación pobre:** cruzando `get_item_statistics` (por alumno × ítem), ítems que buenos
  alumnos fallan y malos aciertan → candidatos a retirar del banco.

---

## 10. Seguridad — amenazas MCP y mitigación

| Amenaza (MCP 2026) | Mitigación |
|---|---|
| Token de otra audiencia aceptado | `McpAuthGuard` valida `aud == URI canónica` (RFC 8707); 401 |
| **Token passthrough / confused deputy** | Tools in-process; cero reenvío del token del usuario |
| Cross-tenant leak | `org_id` del principal → `withOrgContext` → RLS `FORCE`, rol `soe_app`; sin contexto = 0 filas |
| Escalada / tool prohibida | `@Roles` por tool (403) + catálogo filtrado por rol/feature/PII |
| Exfiltración de PII al LLM | `piiLevel` por tool; externo = solo `aggregate`; sin RUT/nombres |
| Tier pago sin pagar | `@RequireFeature` + flag `mcp` opt-in por org |
| Token robado | Tokens cortos + refresh rotado (AS gestionado) + rate limiting + audit log |
| Registro/consentimiento de clientes | DCR (RFC 7591) + PKCE + consentimiento en el AS gestionado |
| Falta de trazabilidad | `mcp_access_logs` vía interceptor: quién, qué tool, cuándo |
| Transporte inseguro | Streamable HTTP solo HTTPS; metadata/redirects solo HTTPS/localhost |

---

## 11. Plan de implementación por fases

**Fase 0 — Cimientos (núcleo + auth, sin lógica de negocio).**
- `McpModule` independiente en `apps/api/src/mcp/`, **mismo proceso** que `apps/api` (decisión #5).
- Núcleo desacoplado: interfaces `AnalyticsPrincipal` / `AnalyticsTool` / `ToolDescriptor`,
  `ToolRegistry` con auto-registro (`@AnalyticsTool()` + `DiscoveryService`), `AnalyticsToolsFacade`.
- Adaptador MCP con `@rekog/mcp-nest` (Streamable HTTP stateless) + `McpAuthGuard` (JWKS + audiencia
  → `AnalyticsPrincipal`) + `/.well-known/oauth-protected-resource` + `401`/`WWW-Authenticate`.
- AS gestionado (decisión #1) federando al SSO; app registrada como recurso, audiencia canónica.
- Flag `mcp` en `orgConfigSchema`; `mcp_access_logs` + `McpAuditInterceptor` + `@nestjs/throttler`.
- Tool canario (`whoami`) + una prueba E2E del flujo OAuth con Claude **y** con ChatGPT.

**Fase 1 — Las 6 tools + el caso estrella.**
- Tools 1–6 (§8) como clases auto-registradas que envuelven services existentes; structured output
  con DTOs Zod.
- Resources (`taxonomy://`, `performance-bands://`, `analytics-capabilities://`).
- Filtro de visibilidad por **rol/feature** en `tools/list` (el `piiLevel` queda declarado pero sin
  filtrar en el MVP).
- Prompt `contrastar_dificultad_declarada_vs_empirica` (§9) como demo.

**Fase 2 — Adaptador in-app + flujos guiados.**
- Cablear `AssistantService` al `AnalyticsToolsFacade` (canal `in-app`).
- Prompts `auditar_calidad_instrumento`, `diagnostico_brechas_curso`.

**Fase 3 — Extensiones (si el negocio lo pide, sin tocar el núcleo).**
- `compare_benchmark` (feature `benchmarking`).
- **[Gobernanza]** tools de detalle por alumno (PII) para el canal in-app con DPA + seudonimización.
- Extracción a binario/subdominio separado si el perfil de carga lo justifica.

**Testing** (según `.claude/rules/backend/01-testing.md`): helpers/registry puros testeados directo;
`McpAuthGuard` y el filtro de visibilidad con `Database` fake por-test; controllers MCP con
`supertest`. Los services analíticos ya tienen specs; las tools solo los envuelven.

---

## 12. Diseño cerrado

Todas las decisiones (#1–#5 + arquitectura + PII) están resueltas arriba. **Próximo paso: Fase 0**
(§11) — `McpModule` independiente, núcleo desacoplado (`ToolRegistry` + interfaces), `McpAuthGuard`
con validación de audiencia y tool canario `whoami` para probar el flujo OAuth de punta a punta con
Claude y ChatGPT, sin lógica de negocio todavía.

---

## 13. Seguridad de la autenticación actual (base que hereda el MCP)

El MCP hereda la postura de auth de `apps/api`, que se auditó leyendo el código y es **sólida**.

**Validación actual — bien hecha:**
- `AuthGuard` global como `APP_GUARD` (`apps/api/src/app.module.ts:114-120`): **deny-by-default** —
  toda ruta pide JWT salvo `@Public()` explícito.
- Token = **JWE de NextAuth v5** (`dir` + `A256CBC-HS512`): encriptado **y** autenticado (MAC). No se
  puede forjar, manipular ni leer sin `AUTH_SECRET`; `jose.jwtDecrypt` valida el claims set incluido
  `exp` (`apps/api/src/auth/auth.guard.ts:45,120-125`).
- La API **revalida en cada request**; el proxy web no es barrera de confianza → pegarle directo a la
  API sin token válido = `401`. Parsing defensivo de roles + RLS como defensa en profundidad.

**Hardening pendiente (endurecimientos, no agujeros):**

| Item | Severidad | Dónde |
|---|---|---|
| Comparación del token interno no constant-time (`!==`) → `crypto.timingSafeEqual` | Baja | `auth.controller.ts:18` |
| Endpoints `@Public` con `x-internal-token` dependen solo de un secreto compartido → restringir por red al tier web | Media si la API está expuesta | `auth.controller.ts:24-79` |
| `mock-users`/`AUTH_MODE=mock` = login-bypass si corriera en prod → gatear también por `NODE_ENV` | Alta *si* se mal-configura | `auth.controller.ts:73-79` |
| Modelo simétrico: `AUTH_SECRET` compartido permite **emitir** sesiones → secreto tightly-held + rotación | Media (blast radius alto) | `auth.guard.ts:121` |
| Sin rate limiting global (`@nestjs/throttler` ausente) | Baja-Media | `main.ts` |

**Cómo el MCP mejora esto:**
- **No reusa** el JWE de sesión (sin `aud`/`iss` validados → no apto para entregar a un tercero como
  Claude/ChatGPT). Usa el token OAuth de WorkOS con audiencia acotada (RFC 8707).
- WorkOS emite **JWT asimétricos**: el MCP solo tiene la clave pública (JWKS) y **no puede emitir**
  tokens → menor blast radius que el secreto simétrico actual.

---

## 14. Referencias

- MCP — Authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP TypeScript SDK (Streamable HTTP): https://github.com/modelcontextprotocol/typescript-sdk
- `@rekog/mcp-nest` (NestJS, guards nativos + Streamable HTTP): https://github.com/rekog-labs/mcp-nest
- Por qué MCP deprecó SSE: https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/
- MCP spec update (auth, junio 2025) — Auth0: https://auth0.com/blog/mcp-specs-update-all-about-auth/
- Enterprise MCP Authorization — multi-tenant reference: https://wavect.io/blog/enterprise-mcp-authorization-architecture/
- MCP security best practices 2026: https://blog.mcpservers.org/posts/mcp-security-best-practices
- RFC 9728 (Protected Resource Metadata), RFC 8707 (Resource Indicators), RFC 7591 (Dynamic Client Registration), OAuth 2.1 draft.
