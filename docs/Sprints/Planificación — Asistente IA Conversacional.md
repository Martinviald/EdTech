# Planificación — Asistente IA Conversacional de Resultados

> **Epic E21 — "Pregúntale a tus datos": asistente conversacional que ayuda a
> directivos (y luego profesores) a comprender resultados, responder dudas y
> tomar decisiones, ejecutando _tools_ que leen las métricas reales de la
> plataforma.**
>
> Construye sobre toda la capa determinista y de IA ya entregada (Informe de
> Evaluación H6.13, Análisis IA H7, dashboards, heatmap, analítica). No reemplaza
> esos módulos: los **orquesta** mediante un agente que decide qué consultar para
> responder en lenguaje natural.
>
> **Principio rector (CLAUDE.md §8.3):** la IA **propone**, el humano **aprueba**.
> El asistente nunca calcula métricas ni inventa cifras — _razona sobre_ los
> resultados que devuelven las tools. Toda afirmación numérica proviene de una
> tool auditable. En v1 el asistente es **solo lectura**: no muta estado.

---

## 0. Decisiones de alcance (cerradas)

| Decisión | Valor elegido | Implicancia de diseño |
|---|---|---|
| **Alcance v1** | Solo lectura / análisis | El asistente consulta, explica, diagnostica y recomienda. **No** ejecuta acciones que muten estado (generar remedial, recalcular). Las tools son todas `GET`. Acciones → v2. |
| **Motor LLM** | Configurable por org | Se diseña el loop de tool-use sobre la abstracción `LlmModule` existente, soportando **Claude (Anthropic)** y **Gemini** vía `llm_settings` por org. Default recomendado para el agente: Claude (tool-use multipaso más confiable). |
| **Audiencia v1** | Solo directivos | `platform_admin`, `school_admin`, `academic_director`, `cycle_director`. Menor superficie de PII inicial. Profesores (con scoping por curso) → v2. |
| **Superficie** | **Asistente embebido** (botón flotante + panel lateral en todas las vistas) + sección `/asistente` (foco/historial) | Chat transversal, no anclado a una evaluación. El panel auto-carga el **contexto de la vista actual** (refs tipadas por UUID) para responder sobre "lo que el usuario está mirando" sin que tenga que explicarlo. Ver §3.4. |
| **Gating** | Feature de tier pago `ai_assistant` | Upsell PLG. `@RequireFeature('ai_assistant')` + entrada en `FeatureKey`. |
| **Persistencia** | Conversaciones + mensajes en DB | Historial recuperable por usuario, auditable, con trazas de tool-calls y costo. |

> **Consideración de fase:** este es territorio **F2+** (capa de _upsell_ del PLG).
> Respeta los guardrails de F1/F2: multi-tenant, RLS, taxonomía universal, sin
> hardcodear "DIA", async donde aplique, tipado estricto, Zod en `packages/types`.

---

## 1. Concepto: por qué un agente, no otro informe

El Análisis IA (H7) ya genera informes estructurados de **una** evaluación. La
brecha que llena este módulo es la **conversación abierta y transversal**: el
directivo no quiere otro PDF, quiere _preguntar_ —"¿qué cursos de 4° básico
vienen arrastrando brecha en comprensión lectora hace dos años?"— y que el
sistema **decida qué datos mirar**, los cruce y responda con evidencia.

```
  Usuario (directivo)
        │  "¿Por qué bajó el 8°B en la última evaluación de matemática?"
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  AGENTE (loop de tool-use)                                    │
  │  system + historial + definición de tools                    │
  │     │                                                        │
  │     ├─► decide llamar get_assessment_report(...)  ──┐        │
  │     │◄──────────────── resultado (métricas reales) ◄┘        │
  │     ├─► decide llamar get_progression(8°B, mat) ───┐        │
  │     │◄──────────────── serie temporal ◄────────────┘        │
  │     └─► sintetiza y responde en prosa (stream)              │
  └──────────────────────────────────────────────────────────────┘
        │  respuesta citada a datos + sugerencia de decisión
        ▼
  Chat con streaming · historial persistido · trazas auditables
```

**El asistente = LLM + tools (wrappers delgados sobre services existentes) + un
loop que itera hasta responder.** Las tools heredan RLS, scoping por rol y lógica
de negocio ya testeada de los services. El agente nunca toca Drizzle.

### Lo que ya existe y se reutiliza

| Pieza | Estado | Rol en este módulo |
|---|---|---|
| `LlmService` / `LlmModule` (agnóstico Gemini/Claude) | ✅ | Base del motor; se **extiende** con tool-use + streaming |
| `DashboardsService`, `AnalyticsService`, `HeatmapService`, `AssessmentReportService`, `AssessmentResultsService` | ✅ | **Son las tools** (wrappers 1:1) |
| `withOrgContext` + scoping por rol en cada service | ✅ | Aislamiento multi-tenant y profesor/directivo **gratis** |
| `AiObservabilityService` + tablas con `tokens`/`costUsd` | ✅ | Trazado de costo del chat (mismo patrón) |
| `@RequireFeature` + `FeatureGuard` | ✅ | Gating de tier pago (`ai_assistant`) |
| Prompt versionado + salida tipada (Zod) | ✅ (patrón H7) | Versionado del system prompt del agente |

### El único gap arquitectónico real

`LlmService.complete()` es hoy `texto → texto` (one-shot, sin tools, sin stream).
Un agente conversacional necesita un **loop de tool-use con streaming**. Ese es el
corazón técnico de este módulo (ver §3.1).

---

## 2. Jobs-to-be-done (directivo) → qué responde el asistente

| Decisión que toma el directivo | Cómo la resuelve el asistente | Tools que orquesta |
|---|---|---|
| ¿Dónde están mis peores brechas ahora mismo? | Cruza heatmap + dashboard de habilidades, prioriza | `get_heatmap`, `get_dashboard_skills` |
| ¿Por qué bajó este curso en esta evaluación? | Lee el informe psicométrico y lo interpreta | `get_assessment_report`, `get_dashboard_overview` |
| ¿Es brecha sistémica o aislada de un curso? | Compara cursos y generaciones | `get_generational`, `get_dashboard_performance` |
| ¿Esto viene arrastrándose o es nuevo? | Serie temporal de progresión | `get_progression` |
| ¿Qué instrumentos están mal hechos (ítems malos)? | Flags psicométricos del informe | `get_assessment_report` (item flags) |
| ¿Por qué se equivocaron los alumnos en esta pregunta? | Distractor dominante + lee el enunciado → hipótesis de misconcepción | `get_assessment_report`, `get_item_content` |
| ¿A qué cursos/temas asigno recursos primero? | Síntesis priorizada cruzando varias tools | varias |
| ¿Cómo le explico esto a mi equipo? | Redacta narrativa pedagógica sobre datos reales | — (razonamiento) |

> Cada respuesta termina, cuando aplica, con una **recomendación de decisión**
> accionable (no solo descripción) y una invitación a profundizar.

---

## 3. Arquitectura técnica

### 3.1 El loop de tool-use (corazón del módulo)

Se extiende `LlmModule` con una capacidad nueva, sin romper `complete()`
(la usan H7 y `ai-tagging`):

```ts
// apps/api/src/llm/llm.types.ts (extensión del contrato)
interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;          // derivado de un schema Zod (packages/types)
}

type LlmAgentEvent =
  | { type: 'text_delta'; text: string }              // para streaming a la UI
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done'; usage: { inputTokens; outputTokens } };

interface LlmProvider {
  // ...existentes: complete, completeMultimodal, isAvailable
  streamWithTools?(req: {                              // opcional → degradación
    system: string;
    messages: LlmMessage[];
    tools: LlmToolDefinition[];
    options: LlmOptions;
  }): AsyncIterable<LlmAgentEvent>;
}
```

- **`AnthropicProvider`** y **`GeminiProvider`** implementan `streamWithTools`
  traduciendo el contrato agnóstico a su SDK (Anthropic `tools` / Gemini
  `functionDeclarations`). La normalización vive en el provider, no en el caller.
- **`LlmAgentService`** (nuevo, en `LlmModule`) corre el loop: emite eventos de
  texto → cuando llega un `tool_call`, **el módulo del asistente** ejecuta la tool
  y reinyecta el resultado como mensaje `tool_result`, hasta que el modelo
  responde sin más tool-calls. Tope de iteraciones (`maxSteps`, p.ej. 6) como
  cortafuegos.

```
loop (máx maxSteps):
  evento = siguiente del stream
  si text_delta  → push al SSE hacia el frontend
  si tool_call   → ejecutar tool (con orgId del JWT) → append tool_result → continuar
  si done        → cerrar stream, persistir mensaje + usage + costo
```

### 3.2 Modelo de conversación (nuevo dominio `assistant`)

Nuevo módulo NestJS `apps/api/src/assistant/` y schema
`packages/db/src/schema/assistant.ts`:

| Tabla | Campos clave | Notas |
|---|---|---|
| `assistant_conversations` | `id`, `org_id`, `user_id`, `title`, `created_at`, `updated_at`, `deleted_at` | Una por hilo de chat. RLS por `org_id`. Soft delete. |
| `assistant_messages` | `id`, `conversation_id`, `org_id`, `role` (`user`/`assistant`/`tool`), `content` (text), `tool_calls` (JSONB), `model`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_usd`, `created_at` | Historial completo + trazas. Mismos campos de costo que `ai_analyses` → reutiliza `AiObservabilityService`. |

- **RLS:** ambas tablas son sensibles → política en `packages/db/sql/rls-policies.sql`
  (CLAUDE.md §5.2). Toda query dentro de `withOrgContext`.
- **JSONB tipado** con `.$type<T>()` para `tool_calls` (qué tool, input, resumen
  del output) — auditoría de qué datos vio el modelo.
- El `content` de mensajes `tool` puede truncarse/resumirse para no inflar el
  historial; el detalle completo queda en `tool_calls`.

### 3.3 Contrato de tools (v1 — todas read-only)

Cada tool es un wrapper delgado en `AssistantToolsService` que: (1) valida input
con Zod, (2) **resuelve el `orgId` y roles desde el JWT, nunca desde el LLM**,
(3) llama al service existente, (4) devuelve un payload compacto y _grounded_.

| Tool | Service subyacente | Para qué la usa el agente |
|---|---|---|
| `list_filter_options` | `DashboardsService.getFilterOptions` | **Resolver nombres → IDs** ("4°A", "matemática") antes de consultar |
| `get_dashboard_overview` | `DashboardsService.getOverview` | KPIs macro + alertas del scope |
| `get_dashboard_skills` | `DashboardsService.getSkills` | % logro por habilidad |
| `get_dashboard_performance` | `DashboardsService.getPerformance` | Distribución + alumnos por nivel |
| `get_heatmap` | `HeatmapService.getHeatmap` | Matriz habilidad×asignatura (brechas) |
| `get_progression` | `AnalyticsService.progression` | Evolución temporal (alumno/curso/habilidad) |
| `get_generational` | `AnalyticsService.generational` | Comparación entre años/generaciones |
| `get_assessment_report` | `AssessmentReportService.getReport` | Informe psicométrico de una evaluación (ítems, flags, distractor dominante, recomendaciones) |
| `get_item_content` | `ItemsService` / `AssessmentReportService` (método nuevo de lectura) | **Enunciado + alternativas de un ítem** (stem, texto de cada clave, clave correcta). Convierte "eligieron la C" en "creen que se suman los denominadores": permite nombrar la **misconcepción** detrás del distractor dominante. **Cero PII** (solo contenido del ítem). |
| `get_student_detail` | `AssessmentResultsService.getStudentDetail` | Detalle de un alumno (**ver §5 PII**) |

> **Principio:** ninguna tool nueva accede a Drizzle directo. Si una respuesta
> requiere una agregación que no existe, se agrega un método al **service del
> dominio** correspondiente (Clean Architecture, §4.3), no una query en el módulo
> del asistente.

### 3.4 Frontend (Next.js — App Router)

**Superficie dual** (misma lógica de chat, dos contenedores):
- **Asistente embebido (entrada primaria)**: un **botón flotante** + **panel lateral**
  (`Sheet`/drawer de shadcn) montados UNA sola vez en el layout del dashboard → el
  asistente está disponible en **todas** las vistas. Gating UI con
  `canAccess(roles, ASSISTANT_USER_ROLES)` + feature `ai_assistant`.
- **Sección `/asistente` (foco/historial)**: ruta full-page (Server Component shell +
  chat `'use client'`) para conversaciones largas y el panel de historial. **Reusa el
  mismo componente de chat** que el panel (DRY: un chat, un contrato, una vía de SSE).

**Streaming vía SSE**: el endpoint `POST /api/assistant/conversations/:id/messages`
responde `text/event-stream`. Como es POST con body, el cliente lo consume con
`fetch` + `response.body.getReader()` (NO `EventSource`, que es GET): renderiza
`text_delta` incrementalmente y muestra "consultando datos…" durante
`tool_call`/`tool_result`. Estado de chat local con `useState`; solo sesión/feature
en Zustand. Tokens de diseño Tailwind, responsive (H19.2), shadcn/ui.

**Contexto de la vista actual (auto-carga) — pieza clave del asistente embebido.**
En vez de un mapa central "vista → contexto" (frágil, no extensible), se usa **un
solo contrato declarativo** que cada vista rellena localmente:
- Contrato compartido `assistantPageContext` en `@soe/types`: una lista de
  **referencias tipadas** `{ kind, id, label? }`. Los `kind` son FINITOS y derivan de
  los inputs de las tools (`assessment`, `classGroup`, `grade`, `subject`,
  `instrument`, `academicYear`, `item`, `student`) — agregar una vista NO amplía el
  enum. Solo `kind`+`id` (UUID) viajan al LLM; el `label` es para el chip de la UI y
  **nunca** sale del cliente (PII opción B).
- Cada página **declara su contexto** vía un hook/registry (`useAssistantContext([...])`),
  reactivo (p. ej. al abrir una pregunta concreta se agrega su `item`). El panel lee lo
  que la vista registró y lo envía en `pageContext` **por mensaje** (el usuario puede
  navegar mientras chatea → el contexto refleja "dónde está ahora").
- El backend inyecta esas refs como **datos delimitados** en el turno (no como
  instrucciones, §4.3); el modelo pasa esos UUIDs directo a las tools y se **salta**
  `list_filter_options`. El grounding se mantiene: el contexto son IDs, no cifras — la
  IA igual debe llamar tools para obtener números.
- **Unifica el deep-link** "Pregúntale a la IA sobre esto" (H21.12): deja de ser una
  feature aparte — es *abrir el panel con el contexto que la vista ya declara* (+ un
  prompt sugerido por `kind`, opcional).
- El **selector `@`** de alumno (H21.11b) es un caso del mismo contrato
  (`kind: 'student'`): la UI inserta el UUID en `pageContext` y muestra un chip con el
  nombre; el resolver nombre→UUID ocurre en el cliente.

> **Por qué este enfoque y no un mapeo por-vista hardcodeado:** (1) extensibilidad
> §8.2 — vista nueva = declarar contexto local, sin tocar nada central ni hardcodear
> "DIA"; (2) DRY — un contrato + una inyección (generaliza la anotación de refs) + un
> chat; (3) grounding y PII intactos — solo viajan UUIDs opacos, nunca nombres ni
> métricas. El "mapeo" que sí se hace es ligero y colocado en cada página, acotado por
> los inputs de las tools (ver tabla en §6, H21.10b).

### 3.5 Endpoints (REST + SSE)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| `POST` | `/api/assistant/conversations` | `ASSISTANT_USER_ROLES` + `@RequireFeature('ai_assistant')` | Crea conversación |
| `GET` | `/api/assistant/conversations` | idem | Lista paginada del usuario |
| `GET` | `/api/assistant/conversations/:id` | idem | Conversación + mensajes |
| `POST` | `/api/assistant/conversations/:id/messages` | idem | Envía mensaje (`{ content, pageContext? }`) → **stream SSE** de la respuesta |
| `DELETE` | `/api/assistant/conversations/:id` | idem | Soft delete |

### 3.5 Endpoints (REST + SSE)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| `POST` | `/api/assistant/conversations` | `ASSISTANT_USER_ROLES` + `@RequireFeature('ai_assistant')` | Crea conversación |
| `GET` | `/api/assistant/conversations` | idem | Lista paginada del usuario |
| `GET` | `/api/assistant/conversations/:id` | idem | Conversación + mensajes |
| `POST` | `/api/assistant/conversations/:id/messages` | idem | Envía mensaje → **stream SSE** de la respuesta |
| `DELETE` | `/api/assistant/conversations/:id` | idem | Soft delete |

---

## 4. Guardrails (no negociables)

1. **Anti-alucinación:** el system prompt prohíbe inventar o recalcular cifras;
   toda métrica debe venir de una tool. Si el dato no está disponible, el
   asistente lo dice ("no tengo resultados de ese curso") en vez de fabricar.
   Precedente directo: el system prompt de `ai-analysis`.
2. **Multi-tenancy:** el `orgId` y los roles **siempre** vienen del JWT; el LLM
   no puede proveerlos ni alterarlos. Las tools corren dentro de `withOrgContext`
   vía los services → RLS como barrera de motor (§5.2). Verificación explícita en
   tests: un usuario no puede obtener datos de otra org ni vía prompt injection.
3. **Prompt injection:** los datos que devuelven las tools (nombres de ítems,
   contenido) se inyectan como **datos delimitados**, nunca como instrucciones.
   El system prompt instruye a ignorar instrucciones embebidas en datos.
4. **PII (Ley 19.628 / 21.719) — decisión cerrada (opción B):** las tools operan
   por `studentId` (UUID, pseudónimo opaco fuera de la DB) + banda de desempeño,
   **nunca nombre ni RUT al LLM**. El frontend re-hidrata el nombre (join
   UUID→alumno) solo al renderizar. Dos caminos de entrada del alumno:
   (a) **descubrimiento** — el agente obtiene los UUIDs vía tool, sin selección
   del usuario (flujo dominante en v1); (b) **por nombre** — vía **selector/mención
   `@`** en la UI: el usuario elige al alumno de un autocompletado y la UI inserta
   el **UUID** en el contexto del mensaje (ve el nombre, el LLM recibe el ID). El
   resolver nombre→UUID ocurre en el cliente. v1 es solo directivos
   (§`SENSITIVE_DATA_ROLES`). Riesgo residual de nombres tipeados a mano →
   mitigado por el selector + aceptado bajo la capa contractual (§4.7).
5. **Costo:** cada respuesta persiste `tokens`/`cost_usd`; el presupuesto por org
   (`organizations.config.aiBudgetUsd`) y los alertas ya existen en
   `AiObservabilityService`. Tope de `maxSteps` por turno + límite de longitud de
   historial enviado al modelo.
6. **Determinismo de la verdad:** la IA solo redacta sobre lo que la tool calculó.
   Los números siguen siendo auditables y reproducibles fuera del chat.

### 4.7 Cumplimiento Ley 19.628 / 21.719 (gate previo al piloto)

La minimización por UUID (§4.4) es **defensa en profundidad**, no suficiente por
sí sola: los resultados de las tools siguen siendo datos personales de desempeño
de menores cruzando a un procesador externo. Antes del **piloto en producción**
(no bloquea el spike ni desarrollo en datos de prueba) deben estar:

| Requisito | Detalle |
|---|---|
| **DPA con el/los proveedor(es) LLM** | Anthropic / Google nombrados como encargados de tratamiento |
| **Zero-retention + no-entrenamiento** | Confirmado/activado en la cuenta API (la API de Anthropic no entrena con datos por defecto; verificar retención cero) |
| **Divulgación** | Política de privacidad declara el uso de subprocesadores de IA |
| **Revisión legal** | Abogado de datos (Chile) valida DPA + política antes del piloto |

> La reforma **Ley 21.719** moderniza el régimen (Agencia de Protección de Datos
> con poder sancionatorio y multas), lo que eleva las apuestas. Dejar esta capa
> resuelta desde v1. **Nota:** esto no es asesoría legal.

---

## 5. Modelo de datos — resumen de cambios

- **Nuevo** schema `assistant.ts`: `assistant_conversations`, `assistant_messages`
  (§3.2). Migración con `pnpm db:generate` + políticas RLS en `rls-policies.sql`.
- **`packages/types`:** nuevos schemas Zod en `schemas/assistant.schema.ts`
  (DTOs de conversación/mensaje + el contrato de input de cada tool, del que se
  deriva el `inputSchema` JSON de las tools). Nueva `FeatureKey: 'ai_assistant'`.
  - **Contrato de contexto de vista** (asistente embebido, §3.4):
    `assistantPageContext` = `Array<{ kind, id, label? }>` con
    `ASSISTANT_CONTEXT_KINDS` (enum finito acotado por los inputs de las tools).
    `sendAssistantMessageSchema` lleva `pageContext?` — que **subsume** el antiguo
    `studentRefs` (un alumno es `{ kind: 'student', id }`): una sola vía para el
    selector `@` y el contexto auto-cargado. El `label` no viaja al backend/LLM.
- **`access-policies.ts`:** `ASSISTANT_USER_ROLES` (v1 = directivos:
  `platform_admin`, `school_admin`, `academic_director`, `cycle_director`).
- **Sin tablas nuevas por instrumento** ni hardcodeo de "DIA": el asistente opera
  sobre IDs de `curricula`/`taxonomy_nodes` que devuelven las tools.

---

## 6. Plan de sprint (historias)

> Numeración tentativa **E21 / H21.x** (ajustar al backlog real). Orden pensado
> para entregar valor incremental y des-riesgar el loop de tool-use temprano.

### Sprint A — Fundaciones del agente

| Historia | Descripción | Entregable |
|---|---|---|
| **H21.0** ✅ | Decisiones de diseño **cerradas**: PII = opción B (UUID + selector `@`, §4.4); motor default = Claude Sonnet 4.x (Gemini opt-in por org); contrato de eventos del loop = §3.1. Pendientes menores no bloqueantes: `maxSteps` (en 6, ✅ implementado), política de truncado de historial | Esta planificación + ADR corto |
| **H21.1** ✅ | Extender `LlmModule` con `streamWithTools` en el contrato `LlmProvider` + `LlmAgentService` (loop) | Loop agnóstico con tope de pasos, testeado con provider mock (4 tests verdes) — commit `da657a5` |
| **H21.2** ✅ | Implementar `streamWithTools` en `AnthropicProvider` | Tool-use real Claude sobre Messages API (`stream: true`) — commit `da657a5` |
| **H21.3** ✅ | Implementar `streamWithTools` en `GeminiProvider` (paridad tool-use con Anthropic) | Commit `eda2bb2`. La resolución por org (`llm_settings`) queda como sub-tarea diferida — el provider ya es configurable vía `LlmConfigService`/env |
| **H21.4** ✅ | Schema `assistant.ts` + migración + políticas RLS + DTOs Zod en `packages/types` | Persistencia con RLS por org_id + `FeatureKey 'ai_assistant'` + `ASSISTANT_USER_ROLES` — commit `1371819` |

### Sprint B — Tools y módulo del asistente

| Historia | Descripción | Entregable |
|---|---|---|
| **H21.5** ✅ | Tools read-only `list_filter_options`, `get_dashboard_*`, `get_heatmap` (wrappers sobre services, input Zod, orgId del JWT) — implementadas como clases `AssistantTool` (contrato `assistant-tool.types.ts`), una por archivo | Commit `bb445e6` — 5 tools |
| **H21.6** ✅ | Tools de análisis: `get_progression`, `get_generational`, `get_assessment_report`, `get_student_detail` con proyección PII opción B (sin nombre/RUT) | Commit `97036df` — 4 tools |
| **H21.6b** ✅ | Tool `get_item_content` + `ItemsService.getContentForAssistant` (normaliza el `items.content` JSONB polimórfico, sin hardcodear type, PII-free) | Commit `4a9d6a6` — habilita análisis de misconcepciones |
| **H21.7** ✅ | `AssistantModule` (controller + service): CRUD de conversaciones + endpoint de mensajes con streaming, orquestando el loop y ejecutando tools (registra las tools, construye el `executeTool`) | API conversacional completa — **Ola 3** |
| **H21.8** ✅ | System prompt versionado (guardrails §4) + `@RequireFeature('ai_assistant')` + `ASSISTANT_USER_ROLES` | Agente gated y con guardrails |
| **H21.9** ✅ | Trazado de costo: persistir `tokens`/`cost_usd` por mensaje + integrar `source: 'assistant'` en `AiObservabilityService` | Observabilidad del chat |

### Sprint C — Frontend y cierre

| Historia | Descripción | Entregable |
|---|---|---|
| **H21.10** | Componente de chat con streaming (SSE vía `fetch`+`getReader`), indicador de tool-calls, render markdown, responsive — reusable por el panel y por `/asistente`. Ruta `/asistente` (full-page) como contenedor de foco/historial | Chat funcional para directivos |
| **H21.10b** | **Asistente embebido**: botón flotante + panel lateral (`Sheet`) en el layout del dashboard (gated por rol+feature) + contrato `assistantPageContext` en `@soe/types` + hook `useAssistantContext` (registry por vista, reactivo). Cada vista declara sus refs; el panel las envía en `pageContext` por mensaje. **Mapeo de vistas → refs** (ligero, colocado por página, acotado por los inputs de las tools): Informe→`assessment`(+`classGroup`); detalle de ítem/pregunta→`assessment`+`item`; dashboard habilidades→`grade`/`subject`/`academicYear`; heatmap→filtros activos; detalle de alumno→`student`(+`classGroup`); progresión/generacional→`classGroup`/`subject`/años | Asistente accesible en toda la app con contexto auto-cargado |
| **H21.11** | Panel de historial de conversaciones (lista, abrir, borrar) | Continuidad de conversaciones |
| **H21.11b** | **Selector/mención `@` de alumno** (§4.4) como caso del contrato `pageContext` (`kind: 'student'`): autocompletado de alumnos del scope; al elegir, la UI inserta el **UUID** y muestra un chip con el nombre. Resolución nombre→UUID en el cliente — el nombre nunca viaja al LLM | Preguntar por un alumno puntual sin enviar PII |
| **H21.12** | "Pregúntale a la IA sobre esto" desde dashboards/Informe — **subsumido por H21.10b**: abre el panel con el `pageContext` que la vista ya declara, opcionalmente con un prompt sugerido por `kind` | Punto de entrada contextual (sin código de contexto adicional) |
| **H21.13** | Tests: aislamiento multi-tenant vía prompt (no leak entre orgs), guardrail anti-alucinación, scoping por rol; e2e del loop | Suite de seguridad/calidad |
| **H21.14** | Pulido de prompts con casos reales + doc de uso para directivos | Listo para piloto |

---

## 7. Fuera de alcance de v1 (evolución)

| Diferido | A dónde |
|---|---|
| **Acciones desde el chat** (generar remedial, recalcular resultados, disparar Análisis IA) — siempre con aprobación humana §8.3 | v2 |
| **Profesores** como usuarios (con scoping por `teacher_assignments` ya existente en los services) | v2 |
| **Memoria/insights persistentes** entre conversaciones, alertas proactivas ("este curso empeoró") | v3 |
| **Multimodal** (subir una imagen de una prueba y preguntar) — la base ya existe en `completeMultimodal` | v3 |
| **Comparación cross-tenant** vía `benchmarking` como tool (cuidado con k-anonimato) | v2/v3 |

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Tool-use de Gemini menos confiable en multipaso | Default Claude para el agente; Gemini opt-in por org tras validar calidad (H21.3) |
| Costo por conversación largo (muchos tool-calls) | `maxSteps`, truncado de historial, payloads de tool compactos, presupuesto por org |
| Latencia percibida | Streaming desde el primer token + indicador de "consultando datos" en tool-calls |
| Leak multi-tenant vía prompt | orgId/roles solo del JWT + RLS + tests de inyección (H21.13) |
| Alucinación de cifras | Guardrail de prompt + toda métrica citada a tool + nada de recálculo |
| PII al LLM | Opción B: UUID + bandas, nombres solo en UI; selector `@` para alumno puntual (§4.4) + DPA/zero-retention como gate de piloto (§4.7) |
| Nombre tipeado a mano en el chat | Riesgo residual bajo: mitigado por el selector `@` + cubierto por la capa contractual (DPA/zero-retention); documentado y aceptado |
