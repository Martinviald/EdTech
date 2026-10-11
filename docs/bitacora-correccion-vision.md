# Bitácora — Corrección por visión de preguntas abiertas

Registro de la ejecución autónoma del plan `docs/plan-desarrollo-correccion-vision.md`.
Cada entrada: fecha, fase, qué se hizo, decisiones (contexto, opciones, decisión, motivo),
costo de IA y estado de la PR.

## Gasto en APIs de IA

| Fecha      | Fase | Uso                                           | Costo (USD) | Acumulado |
| ---------- | ---- | --------------------------------------------- | ----------- | --------- |
| 2026-10-11 | —    | Experimentos previos al plan (fuera del tope) | 0,35        | 0,00      |

Tope del plan: US$5,00.

---

## 2026-10-11 · Ola A · F0 — Preparación

- Worktree `wt-correccion-vision`, rama `feat/correccion-vision` desde `origin/dev` @ `db1b7e62`.
- Documentos traídos: propuesta, diseño, plan y el script de experimentos `apps/api/scripts/probar-vlm-manuscrito.ts`.
- `CLAUDE.md` §8.1: la lectura por visión de respuestas abiertas y la calificación asistida de
  desarrollo pasan a estar dentro de la fase actual (decisión D9).
- Semáforo de procesos pesados en `~/bin/edtech-pesado` (fuera del repo).
- BDD local para gates: PostgreSQL 14 de Homebrew en `/tmp:5432`; cada gate de migración crea una
  base desechable y la borra al terminar.
- `pnpm install` y build de `@soe/types`, `@soe/db` y `@soe/decisions` en el worktree.

**Decisión F0-1 — CI del paquete nuevo.** El CI (`.github/workflows/checks.yml`) tiene un job por
paquete. `@soe/answer-reading` no tendría cobertura en CI si no se agrega. Decisión: agregar un
job `answer-reading` en F2, con el mismo formato que el de `decisions`. Motivo: sin job, sus
tests no corren nunca en CI.

**Aprendizaje F0-2.** Prettier sobre `CLAUDE.md` reformatea todo el archivo (no estaba
formateado). Regla para los subagentes: Prettier solo sobre archivos **nuevos** o sobre archivos
que ya estaban formateados (comprobar con `npx prettier --check` antes); en los demás, editar a
mano sin reformatear.

## 2026-10-11 · Ola A · F1 — Prerrequisitos

- Commits: `7bd2702c` (recortes pendientes, nunca 0), `6982ff69` (`ai_grading_jobs.org_id` + RLS),
  `8553c1f6` (temperatura opcional, uso de tokens en Anthropic, tarifas), `51e3d36d` (observabilidad
  suma `ai_grading_jobs`), migración `0042_ai_grading_jobs_org` con backfill.
- Gate de migración: BDD desechable `cv_gate_f1`, 43 migraciones + 38 tablas con RLS, `org_id` NOT
  NULL y política creada. Base borrada.

**Decisión F1-1 — `feat/items-autocorregibles` no se integra completa.** La rama tiene 8 commits
(scripts contra demo, re-puntuador, cambio de UI) y su único commit relevante (`76538c37`,
comparadores `ordered_tuple`/`sequence`) choca con `6b430f68` de `dev`, que ya implementó
`sequence` (y cubre pares ordenados como secuencia). Opciones: fusionar las dos implementaciones o
dejarlo. Decisión: no integrar; `ordered_tuple` con crédito por componente se implementa en F2 sobre
la comparación por estructura canónica, usando `76538c37` como referencia. Motivo: F2 reescribe el
comparador y fusionar ahora sería trabajo perdido; el resto de la rama está fuera del alcance.

**Decisión F1-2 — Pendiente por recorte.** Un ítem leído por recorte queda pendiente con la misma
forma que `open_ended` (`isCorrect`/`rawScore`/`finalScore` null, `scoredBy: 'human'`) y
`value = { answer: null, pendingReading: true }`. Si un ítem compuesto tiene una sub-etiqueta por
recorte, el ítem entero queda pendiente. F7 reemplaza esto por la decisión de lectura real.

**Contratos de F2 (orquestador).** Commit `05deb3e6`: `packages/types/src/schemas/answer-reading/`.
Semánticas fijadas para todos los subagentes:
- Indecidible ≠ incorrecto: lo que no se decide va a revisión con `final_score` null, nunca 0.
- La comparación es por estructura canónica (`canonical` + `value` racional exacto); `canonical`
  null = no se pudo interpretar → `unparsed_format` (modo corrección).
- Dos lectores "coinciden" si su `canonical` es igual (política inicial `agreeOn: 'canonical'`).
- Modo de revisión por motivo en `REVIEW_MODE_BY_REASON`; si hay motivos de ambos modos, primero
  lectura.
- Política por defecto `DEFAULT_CONSENSUS_POLICY` (D5) y ajustes por org
  `DEFAULT_ORG_ANSWER_READING_SETTINGS` (D3, D7).
- El campo `response` del `LayoutSpec` (`omrFieldResponseSchema`) se conecta a `omrFieldSchema` en
  F5b.
