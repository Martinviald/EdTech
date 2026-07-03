# Guía de Testing — E21 Ola 5: Bandeja de Contexto Fijable del Asistente

> Pruebas E2E manuales. Requiere BD con la migración aplicada: en el worktree del
> sprint, con `DATABASE_ADMIN_URL` apuntando a la BD, correr `pnpm --filter @soe/db
> db:migrate` (aplica `0007_outgoing_veda.sql` → columna `pinned_context`).

## Pre-requisitos
- API levantada (`cd apps/api && pnpm dev`) y web (`cd apps/web && pnpm dev`).
- Usuario con rol de `ASSISTANT_USER_ROLES` (directivo) y feature `ai_assistant` activa.
- Al menos un instrumento, una evaluación y alumnos cargados en la org.

## H1 — Adjuntar la vista actual ("Adjuntar lo que veo")
1. Abre una evaluación (`/evaluaciones/[id]`) → abre el panel del asistente.
2. Sobre el input debe verse la bandeja con el botón **"Adjuntar lo que veo"** habilitado.
3. Click → aparece un chip por cada ref del `pageContext` (evaluación, curso…).
4. Pregunta algo sobre "esta evaluación" → la respuesta usa esos UUIDs vía tools.
5. ✅ Esperado: el asistente responde con datos reales del instrumento/evaluación fijados.

## H2 — Buscar y fijar (picker)
1. Click en **"Agregar"** (botón "+") → se abre el picker.
2. Selecciona kind **Instrumento**, escribe parte del nombre → aparecen resultados.
3. Elige uno → se agrega como chip; el picker se cierra.
4. Repite con kind **Alumno** y **Curso**.
5. ✅ Esperado: cada selección agrega un chip; sin duplicados si lo eliges dos veces.

## H3 — Persistencia (sticky)
1. Con 2-3 refs fijadas, recarga la página y reabre el hilo desde el historial.
2. ✅ Esperado: la bandeja se rehidrata con los mismos chips (`pinnedContext` persistido).
3. Quita un chip ("x") → recarga → ✅ ese chip ya no aparece.

## H4 — get_instrument (tool nueva)
1. Fija un **instrumento** y pregunta "¿qué secciones y cuántos ítems tiene?".
2. ✅ Esperado: responde con secciones + conteo de ítems del instrumento (sin inventar).
3. Verifica en la traza de tools del turno que se llamó `get_instrument`.

## H5 — Aislamiento multi-tenant (RLS)
1. Como usuario de la org A, intenta buscar en el picker → solo aparecen entidades de A.
2. ✅ Esperado: ninguna entidad de otra org en los resultados.

## Casos de error
- Picker con query de 0 resultados → estado vacío, sin crash.
- Fijar refs antes del primer mensaje (hilo aún no existe) → se persisten al crear el hilo.
- Bandeja con >20 refs → el merge del turno la capa a 20 (cap server-side).

## Guardrails a verificar (no visibles en UI)
- El `label` (nombre del alumno) NUNCA viaja al LLM: la línea de contexto del turno
  solo lleva `kind=UUID` (cubierto por test `buildUserTurnText`).
- `PUT …/context` y `GET …/context-search` exigen rol directivo + feature `ai_assistant`.
