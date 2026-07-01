# Contratos — E21 Ola 5: Bandeja de Contexto Fijable del Asistente

> Fuente de verdad del sprint. Backend y frontend compilan contra los mismos
> Models de `@soe/types`. **Leer COMPLETO antes de codear.**

## 1. Objetivo

Permitir que el usuario **fije referencias** (`{kind, id}`) a la conversación del
asistente desde dos puntos de entrada:

1. **Botón "Adjuntar lo que veo"** — fija el `pageContext` (auto) de la vista actual.
2. **Buscador en el panel** — busca y fija cualquier entidad por nombre (instrumento,
   evaluación, curso, alumno, asignatura, grado, período, ítem).

Las refs **persisten entre turnos** (bandeja sticky, guardada en
`assistant_conversations.pinned_context`). **No se inyectan datos crudos**: el LLM
resuelve cada ref vía tools (preserva grounding, RLS y PII opción B). El `label` del
chip NUNCA viaja al LLM (`buildUserTurnText` serializa solo `kind+id`).

## 2. Decisión de diseño (no negociable)

- **Referencias, no snapshots.** Nunca pegar el informe/instrumento renderizado en el
  prompt. Se fija `{kind, id}`; el detalle lo trae una tool.
- **Bandeja persistida server-side.** El cliente NO reenvía la bandeja en cada mensaje:
  el backend la lee de `pinned_context` y la fusiona con el `pageContext` (auto).
- **Matriz kind→tool.** Cada `kind` fijable debe tener una tool que lo resuelva. El
  único hueco actual es `instrument` → se crea `get_instrument`.

## 3. Contrato de tipos (ya en `packages/types/src/schemas/assistant.schema.ts`)

Ya committeado en `sprint-e21-ola5`. Resumen de lo nuevo/cambiado:

| Símbolo | Tipo |
|---|---|
| `assistantConversationDetailSchema` | **+ `pinnedContext: AssistantPageContext`** (default `[]`) |
| `updateAssistantContextSchema` | `{ pinnedContext: AssistantContextRef[] }` (body PUT …/context) |
| `assistantContextUpdateResponseSchema` | `{ pinnedContext: AssistantContextRef[] }` (respuesta PUT) |
| `assistantContextSearchQuerySchema` | `{ kind, q, limit }` |
| `assistantContextSearchResultSchema` | `{ kind, id, label }` |
| `assistantContextSearchResponseSchema` | `{ data: AssistantContextSearchResult[] }` |

`AssistantContextRef = { kind: AssistantContextKind; id: uuid; label?: string }`.
`AssistantContextKind = 'assessment' | 'classGroup' | 'grade' | 'subject' | 'instrument' | 'academicYear' | 'item' | 'student'`.

## 4. Endpoints (verbo + path → request DTO → response Model)

| Verbo + Path | Request | Response Model | Notas |
|---|---|---|---|
| `GET /assistant/context-search` | query `AssistantContextSearchQueryDto` | `AssistantContextSearchResponse` | Busca por `kind`+`q`, scoped `org_id`. `label` solo a cliente. |
| `PUT /assistant/conversations/:id/context` | `UpdateAssistantContextDto` | `AssistantContextUpdateResponse` | Reemplaza la bandeja del hilo (set completo). |
| `GET /assistant/conversations/:id` | — | `AssistantConversationDetail` | **Ahora incluye `pinnedContext`**. |
| `POST /assistant/conversations/:id/messages` | `SendAssistantMessageDto` | SSE (sin cambios de wire) | Backend fusiona `pinned_context` + `pageContext` al armar el turno. |

Gating de todos: `@RequireFeature('ai_assistant')` + `ASSISTANT_USER_ROLES` (igual que el módulo hoy).

## 5. Workstream BACKEND (`apps/api/src/assistant/` + `packages/db`)

### Tickets
- [ ] **T1 — `get_instrument` tool** (`tools/get-instrument.tool.ts`): clase `@Injectable()` `GetInstrumentTool` que envuelve el service de `InstrumentsModule`. Input Zod `{ instrumentId: uuid }`. Devuelve metadata del instrumento + secciones + conteo/listado de ítems (sin contenido pesado del ítem; eso lo trae `get_item_content`). Ejecuta dentro de `withOrgContext` con la identidad del JWT (`ctx.user`), nunca del modelo. Registrar en `assistant.module.ts` (`ASSISTANT_TOOL_CLASSES` + `imports: [InstrumentsModule]`).
- [ ] **T2 — Migración `pinned_context`**: la columna ya está en `packages/db/src/schema/assistant.ts`. Generar la migración con `pnpm --filter @soe/db db:generate` y revisarla. NO requiere política RLS nueva (la tabla ya está cubierta). Confirmar que el `default '[]'` quedó en el SQL.
- [ ] **T3 — `searchContext`** en `AssistantService`: método `searchContext(user, { kind, q, limit })` que despacha por `kind`. `student` reusa `searchStudents`. Los demás (`instrument`, `assessment`, `classGroup`, `subject`, `grade`, `academicYear`) hacen `ilike` por nombre sobre su tabla, **scoped por `org_id` dentro de `withOrgContext`**, devolviendo `{ kind, id, label }`. Endpoint `GET /assistant/context-search` en el controller (valida `assistantContextSearchQuerySchema`).
- [ ] **T4 — Persistir/leer bandeja**: `updateContext(user, conversationId, dto)` → valida pertenencia del hilo (mismo `loadConversation`), guarda `pinnedContext` en `withOrgContext`, retorna `{ pinnedContext }`. Endpoint `PUT /assistant/conversations/:id/context`. Incluir `pinnedContext` en `getConversation` (`toConversationDetail`).
- [ ] **T5 — Merge + dedup en el turno**: en `streamReply`, cargar `pinned_context` del hilo y fusionarlo con `dto.pageContext` (auto), **dedup por `kind+id`**, cap total ≤ 20. Pasar el set fusionado a `buildUserTurnText`. La línea `[contexto de la vista actual…]` NO cambia → **NO bumpear `ASSISTANT_PROMPT_VERSION`**.
- [ ] **T6 — Tests** (≥8): `get-instrument.tool.spec.ts` (resuelve + RLS), `searchContext` por kind, `buildUserTurnText` con merge+dedup+cap, `updateContext` (pertenencia + persistencia).
- [ ] **T7 — Compilación**: `cd apps/api && npx tsc --noEmit` limpio.

### Criterios de aceptación
- [ ] CA1: Cada `kind` fijable tiene resolver (matriz kind→tool completa; `get_instrument` creada).
- [ ] CA2: `searchContext` y `updateContext` corren TODA query dentro de `withOrgContext(this.db, orgId, tx => …)` usando `tx`, filtran `org_id` y `deleted_at IS NULL`.
- [ ] CA3: El `label` NUNCA se serializa hacia el LLM (verificar `buildUserTurnText`).
- [ ] CA4: Merge dedup por `kind+id`; cap ≤ 20.
- [ ] CA5: Roles vía `ASSISTANT_USER_ROLES` de `@soe/types/access-policies`, no inline.
- [ ] CA6: `ASSISTANT_PROMPT_VERSION` sin cambios.
- [ ] CA7: `tsc --noEmit` limpio; ≥8 tests.

### Archivos de referencia
- `apps/api/src/assistant/assistant.service.ts` (patrón service + `withOrgContext` + `buildUserTurnText`)
- `apps/api/src/assistant/tools/get-item-content.tool.ts` + `get-item-content.tool.spec.ts` (patrón tool + test)
- `apps/api/src/assistant/tools/assistant-tool.types.ts` (interfaz `AssistantTool`)
- `apps/api/src/instruments/` (service a envolver en `get_instrument`)
- `apps/api/src/auth/jwt-payload.types.ts`

## 6. Workstream FRONTEND (`apps/web/src/components/assistant/` + route handlers)

### Tickets
- [ ] **T1 — Estado** (`assistant-context.tsx`): agregar `pinnedContext: AssistantContextRef[]` separado de `pageContext` (auto). Acciones `pinContext(ref)`, `unpinContext(kind, id)`, `pinCurrentView()` (copia `pageContext` → bandeja, dedup), e hidratación desde el detalle de la conversación (`pinnedContext`). Al mutar, persistir vía `PUT …/context`.
- [ ] **T2 — Bandeja** (`context-tray.tsx`): chips removibles sobre el input (reusar estilo del chip `@` de alumno). Botón **"Adjuntar lo que veo"** → `pinCurrentView()` (deshabilitado si `pageContext` vacío). Botón **"+"** → abre el picker.
- [ ] **T3 — Picker** (`context-picker.tsx`): `Command` de shadcn con selector de `kind` + query con debounce → `/api/assistant/context-search`. Al elegir → `pinContext({kind, id, label})`.
- [ ] **T4 — Proxies de ruta**: `app/api/assistant/context-search/route.ts` (GET) y `app/api/assistant/conversations/[id]/context/route.ts` (PUT), espejo de los proxies existentes (Bearer desde cookie httpOnly).
- [ ] **T5 — Integración en el chat** (`assistant-chat.tsx`): montar `<ContextTray />` sobre el input. El envío de mensaje sigue mandando solo `pageContext` (auto); la bandeja la fusiona el backend.
- [ ] **T6 — Compilación**: `cd apps/web && npx tsc --noEmit` limpio.

### Criterios de aceptación
- [ ] CA1: Datos de API tipados con Models de `@soe/types` (`AssistantContextSearchResponse`, `AssistantConversationDetail`). Sin tipos locales que dupliquen el Model.
- [ ] CA2: El `label` se usa solo para el chip; el envío de mensaje NO incluye `label` en lo que va al backend para el LLM (el merge/serialización es server-side; el cliente solo persiste la bandeja vía PUT).
- [ ] CA3: `'use client'` solo donde haga falta; el picker hace fetch vía route handler, no fetch directo al API externo.
- [ ] CA4: UI en español, responsive mobile-first, Tailwind + shadcn (sin colores hardcodeados).
- [ ] CA5: NO tocar `lib/api.ts`, `layout.tsx`, `nav-items.ts`.
- [ ] CA6: `tsc --noEmit` limpio.

### Archivos de referencia
- `apps/web/src/components/assistant/assistant-context.tsx` (estado/Context)
- `apps/web/src/components/assistant/assistant-chat.tsx` (chat + selector `@` existente)
- `apps/web/src/components/assistant/register-assistant-context.tsx` (patrón de refs por vista)
- `apps/web/src/app/api/assistant/conversations/[id]/messages/route.ts` (patrón proxy SSE + Bearer)
- `apps/web/src/app/(dashboard)/evaluaciones/[assessmentId]/components/hub-assistant-context.tsx` (vista que ya registra contexto → ahí luce el botón "Adjuntar lo que veo")

## 7. Archivos COMPARTIDOS — solo en integración (NO tocar en paralelo)

- `apps/api/src/app.module.ts` (ya importa `AssistantModule`; sin cambios salvo que falte).
- `apps/web/src/components/layout/nav-items.ts` (no aplica a este sprint).
- `packages/types/src/schemas/assistant.schema.ts` y `packages/db/src/schema/assistant.ts` (CONGELADOS en Fase 0).

## 8. Multi-tenancy (recordatorio CLAUDE.md §5.2)

Toda query del asistente corre dentro de `withOrgContext(this.db, orgId, tx => …)` con
`tx`. `org_id` y roles salen SIEMPRE del JWT (`user`), nunca del body. El buscador de
contexto NO autoriza por el `id`: solo lista lo que RLS deja ver; la barrera real es la
tool que resuelve la ref bajo `withOrgContext`.
