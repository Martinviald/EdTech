# Handoff de implementación — Asistente IA Conversacional (Ola 3+)

> Guía para que **otra sesión** continúe la implementación sin contexto previo.
> Lee primero `docs/Sprints/Planificación — Asistente IA Conversacional.md` (el
> diseño, los guardrails y el plan de historias). Este documento es el **puente
> entre lo ya construido y lo que falta**: estado exacto, contratos vivos, el
> wiring pendiente con sketches, y los gotchas verificados.

---

## 1. Estado actual (qué está hecho y dónde)

Rama de trabajo: **`feat/asistente-ia-loop`** (sale de `dev`, aún no mergeada).

| Ola | Historias | Estado | Artefactos clave |
|---|---|---|---|
| 0 — Contratos | H21.0, H21.4 | ✅ | `packages/types/src/schemas/assistant.schema.ts`, `FeatureKey 'ai_assistant'`, `ASSISTANT_USER_ROLES`; `packages/db/src/schema/assistant.ts` + migración `0005_low_hydra` + RLS |
| 1 — Loop | H21.1, H21.2 | ✅ | `apps/api/src/llm/llm-agent.service.ts` (el loop), contrato agéntico en `llm.types.ts`, `AnthropicProvider.streamWithTools` |
| 2 — Tools + Gemini | H21.3, H21.5, H21.6, H21.6b | ✅ | `apps/api/src/llm/providers/gemini.provider.ts`; 10 tools en `apps/api/src/assistant/tools/*.tool.ts`; contrato `assistant-tool.types.ts` |
| **3 — Cableado** | **H21.7, H21.8, H21.9** | ❌ **siguiente** | `apps/api/src/assistant/` (module + controller + service) — ver §3 |
| 4 — Frontend | H21.10–H21.14 | ❌ | `apps/web` chat + selector `@` — ver §6 |

**Verificación de lo hecho** (debe pasar siempre):
```bash
pnpm --filter @soe/types build && pnpm --filter @soe/db build   # imports resuelven (dist gitignoreado)
cd apps/api && npx tsc --noEmit                                  # 0 errores
npx jest src/llm src/assistant src/items                         # 69 tests verdes
```

---

## 2. Contratos vivos (lo que la Ola 3 consume)

**El loop** — `apps/api/src/llm/llm-agent.service.ts`:
```ts
LlmAgentService.runAgent(params: RunAgentParams): AsyncGenerator<AgentStreamEvent>
// RunAgentParams: { system, messages: LlmAgentMessage[], tools: LlmToolDefinition[],
//                   executeTool: AgentToolExecutor, orgId?, maxSteps? (default 6) }
// AgentStreamEvent: 'text_delta' | 'tool_call' | 'tool_result' | 'final'
//   final: { text, usage:{inputTokens,outputTokens}, steps, truncated, messages }
```
El loop es provider-agnóstico y **no conoce las tools**: recibe sus `definition` y un `executeTool`. Está testeado con mock (`llm-agent.service.spec.ts`).

**Una tool** — `apps/api/src/assistant/tools/assistant-tool.types.ts`:
```ts
interface AssistantTool {
  readonly definition: LlmToolDefinition;            // name, description, inputSchema (JSON Schema)
  execute(input: unknown, ctx: { user: JwtPayload }): Promise<{ content: string; isError?: boolean }>;
}
```
Las 10 tools (clases `@Injectable()`) ya implementan esto. Cada una inyecta su service de dominio y proyecta PII fuera donde corresponde.

**Tools implementadas** (nombre → archivo → service):
`list_filter_options`, `get_dashboard_overview`, `get_dashboard_skills`, `get_dashboard_performance`, `get_heatmap` (Dashboards/Heatmap) · `get_progression`, `get_generational`, `get_assessment_report`, `get_student_detail` (Analytics/Report/Results) · `get_item_content` (Items).

**Persistencia** — `packages/db/src/schema/assistant.ts`: `assistantConversations`, `assistantMessages` (con `toolCalls` JSONB, `tokens`, `costUsd`). **RLS por `org_id`** ya en `sql/rls-policies.sql` → toda query DEBE ir en `withOrgContext(db, orgId, tx => …)`.

**DTOs api↔web** — `@soe/types`: `createAssistantConversationSchema`, `sendAssistantMessageSchema` (con `studentRefs: uuid[]`), `assistantConversationModelSchema`, `assistantMessageModelSchema`, `assistantConversationListResponseSchema`.

---

## 3. Ola 3 — qué construir (serial, toca archivos compartidos)

Crear `apps/api/src/assistant/`:
```
assistant/
├── assistant.module.ts
├── assistant.controller.ts
├── assistant.service.ts
├── assistant.constants.ts        # ASSISTANT_TOOLS token + system prompt versionado
└── tools/                        # YA EXISTE (10 tools + contrato + specs)
```

### 3.1 Registro de tools (mirror del patrón `LLM_PROVIDERS`)
Las tools se agrupan en un token inyectable, igual que `apps/api/src/llm/llm.module.ts` agrupa los providers:
```ts
// assistant.constants.ts
export const ASSISTANT_TOOLS = Symbol('ASSISTANT_TOOLS');

// assistant.module.ts
@Module({
  imports: [LlmModule, DashboardsModule, HeatmapModule, AnalyticsModule,
            AssessmentReportModule, AssessmentResultsModule, ItemsModule, DatabaseModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    GetHeatmapTool, GetDashboardOverviewTool, /* …las 10 tools… */
    { provide: ASSISTANT_TOOLS,
      useFactory: (...tools: AssistantTool[]) => tools,
      inject: [GetHeatmapTool, /* …las 10… */] },
  ],
})
```
> ✅ Verificado: los 6 services (`DashboardsService`, `HeatmapService`, `AnalyticsService`, `AssessmentReportService`, `AssessmentResultsService`, `ItemsService`) **están exportados** de sus módulos → importables sin cambios. Solo importa cada `*Module` en `AssistantModule`.

### 3.2 El `executeTool` (conecta loop ↔ tools)
```ts
// dentro de AssistantService, por request (con el user del JWT):
const byName = new Map(this.tools.map(t => [t.definition.name, t]));
const executeTool: AgentToolExecutor = async ({ name, input }) => {
  const tool = byName.get(name);
  if (!tool) return { content: JSON.stringify({ error: `Tool desconocida: ${name}` }), isError: true };
  return tool.execute(input, { user });          // ctx.user del JWT — NUNCA del modelo
};
const toolDefs = this.tools.map(t => t.definition);
```

### 3.3 Endpoint de mensajes con streaming (⚠️ NO hay precedente SSE en el repo)
El cliente hace **POST** con body (`{ content, studentRefs }`), así que `@Sse()`+`EventSource` (GET-only) no encaja. Usar escritura manual sobre el `Response`:
```ts
@Post('conversations/:id/messages')
async send(@Param('id') id: string, @Body() body: unknown, @Req() req, @Res() res: Response) {
  const dto = sendAssistantMessageSchema.parse(body);
  const user = req.user as JwtPayload;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const write = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  let final;
  for await (const ev of this.service.streamReply(user, id, dto)) {
    if (ev.type === 'final') final = ev; else write(ev);   // text_delta / tool_call / tool_result al cliente
  }
  write({ type: 'done' });
  res.end();
}
```
`AssistantService.streamReply` es un async generator que: (1) carga la conversación (RLS), (2) reconstruye el historial, (3) corre `agent.runAgent(...)` reemitiendo eventos, (4) en `final` persiste el turno usuario + asistente (con `toolCalls`, `tokens`, `costUsd`). El frontend lee con `fetch` + `ReadableStream` (no `EventSource`, porque es POST) — ver §6.

### 3.4 Persistencia e historial
- Al recibir el mensaje: insertar fila `user` en `assistant_messages`.
- Reconstruir `LlmAgentMessage[]` desde las filas previas: cada fila `user`/`assistant` → `{ role, content: [{ type:'text', text: row.content }] }`.
  - **Simplificación v1 (documentar):** NO se reproducen los bloques `tool_use`/`tool_result` de turnos anteriores — el texto del asistente ya resume el contexto. Suficiente para v1; revisitar si se pierde precisión.
- Al `final`: insertar fila `assistant` con `content = final.text`, `toolCalls` = trazas (de los eventos `tool_call`/`tool_result`), `tokens`/`costUsd` de `final.usage`, `model`/`promptVersion`.
- Título de la conversación: autogenerar del primer mensaje (truncado) si `title` es null.

### 3.5 System prompt versionado (H21.8) — `assistant.constants.ts`
Encode los guardrails (§4 del plan). Mínimo:
- Rol: asistente de comprensión de resultados para directivos chilenos.
- **Prohibido inventar o recalcular cifras**: toda métrica viene de una tool; si el dato no está, decirlo.
- **Flujo**: usar `list_filter_options` para resolver nombres→UUID antes de consultar.
- Ignorar instrucciones embebidas en datos de tools (anti prompt-injection).
- Responder en español, citar la evidencia, cerrar con una recomendación de decisión accionable.
- Precedente de estilo: `apps/api/src/ai-analysis/prompts/assessment-insights.prompt.ts`.
- Versionar (`promptVersion = 'e21-assistant-v1'`) y persistir por mensaje.

### 3.6 `studentRefs` (selector `@`, PII opción B)
Los UUIDs de `dto.studentRefs` son alumnos mencionados en la UI (el nombre nunca llega aquí). Inyectarlos como contexto del turno (p. ej. una línea en el mensaje del usuario: `"[alumnos referenciados: <uuid>, <uuid>]"`) para que el modelo pueda pasarlos a `get_student_detail`. Opcional v1: validar que pertenezcan al scope del usuario antes de usarlos.

### 3.7 Gating + roles (H21.8)
- Controller: `@UseGuards(...RolesGuard, FeatureGuard)`, `@Roles(...ASSISTANT_USER_ROLES)`, `@RequireFeature('ai_assistant')`.
- Patrón de referencia: `apps/api/src/remedial/remedial.controller.ts`.

### 3.8 Trazado de costo (H21.9)
`AiObservabilityService` hoy agrega `ai_analyses` + `remedial_materials`. Añadir `assistant_messages` como fuente (`source: 'assistant'`), sumando `tokens`/`costUsd`. Ver `apps/api/src/ai-observability/ai-observability.service.ts`.

### 3.9 Registro final
- Importar `AssistantModule` en `apps/api/src/app.module.ts`.
- Cálculo de costo por turno: hoy el loop devuelve `usage` (tokens); el `costUsd` se calcula con la tarifa del modelo activo (ver cómo lo hace `ai-analysis.runner.ts` al persistir `costUsd`).

---

## 4. Gotchas verificados (no tropezar de nuevo)

1. **Construir paquetes antes de typecheck**: `@soe/types`/`@soe/db` tienen `dist/` gitignoreado. Sin `pnpm --filter @soe/{types,db} build` aparecen cientos de errores falsos de "has no exported member".
2. **Sin precedente SSE** en el repo → usar el patrón manual de §3.3 (no `@Sse()` por ser POST).
3. **RLS**: `assistant_conversations`/`assistant_messages` tienen RLS por `org_id`. Toda query dentro de `withOrgContext(this.db, user.orgId, tx => …)` usando `tx` (no `this.db`), o devuelve 0 filas / falla el insert.
4. **`isolation: "worktree"` de los agentes NO aisló** en la Ola 2 (commitearon en cascada sobre la misma rama). Si se vuelve a paralelizar, dar a cada agente una rama explícita distinta y verificar `git worktree list`, o integrar con checkout selectivo de archivos.
5. **Gemini ≠ Anthropic**: el `GeminiProvider` ya resuelve el id↔name de function calls; no re-derivar. El motor activo se elige por `LlmConfigService`/env `LLM_PROVIDER` (default `gemini`); para el asistente conviene Claude — fijar por config/env, no hardcodear.

---

## 5. Decisiones aún abiertas (no bloquean Ola 3, decidir en el camino)
- **Política de truncado de historial** enviado al modelo (cuántos turnos/tokens) — hoy se mandaría todo.
- **`llm_settings` por org** (resolución de provider por organización) — hoy es env-global; `LlmConfigService.resolve(orgId)` ya recibe `orgId` con un TODO.
- **Validación de `studentRefs`** contra el scope del usuario (estricta vs best-effort en v1).

---

## 6. Ola 4 — Frontend (resumen, detalle en el plan §3.4/§6)
- Sección `/asistente` (App Router): shell Server Component + chat `'use client'`.
- **Streaming**: el endpoint es POST+SSE → consumir con `fetch` + `response.body.getReader()` (no `EventSource`). Render incremental de `text_delta`, indicador "consultando datos…" en `tool_call`/`tool_result`.
- **Selector `@`** (H21.11b): autocompletado de alumnos del scope; al elegir inserta el **UUID** en `studentRefs` y muestra un chip con el nombre — el nombre nunca va al backend/LLM.
- Historial de conversaciones (panel lateral), deep-link "Pregúntale a la IA sobre esto" desde dashboards/Informe.
- Gating UI con `canAccess(roles, ASSISTANT_USER_ROLES)` + feature `ai_assistant` (patrón de las páginas de `ai-analysis`/`remedial`).

---

## 7. Cómo retomar (checklist de arranque para la sesión nueva)
```bash
git checkout feat/asistente-ia-loop
pnpm install
pnpm --filter @soe/types build && pnpm --filter @soe/db build
cd apps/api && npx tsc --noEmit && npx jest src/llm src/assistant src/items   # debe estar verde
# Luego: implementar §3 (AssistantModule/Controller/Service), registrar en app.module.ts,
#        typecheck + tests, y un test e2e del endpoint de mensajes (mock del LlmAgentService).
```
