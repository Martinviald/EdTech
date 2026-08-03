# Plan — Correcciones QA Feedback v2 (antes de `dev → main`)

> Plan de desarrollo de los pendientes P1–P4 detectados en QA del sprint Feedback v2.
> Rama: `fix/feedback-v2-qa` (worktree aislado desde `dev`). Commits atómicos por fase; **un solo PR** a `dev`.
> Fuente de los pendientes: `docs/pendientes-correccion-feedback-v2.md`.

## Pendientes

| # | Área | Tipo | Resumen |
|---|---|---|---|
| P1 | Colecciones (T2-22) | 🐛 | "Guardar en lista" no muestra las listas creadas en el dropdown |
| P2 | Colecciones (T2-22) | ✨ | Kebab en panel de ítem (sin/con respuestas) → "Agregar a una colección" |
| P3 | Filtros dashboard (T2-14) | ✨ | Dropdown "Instrumento" solo con instrumentos con datos |
| P4 | Referencias informe (T2-17) | 🧹 | Eliminar "% de logro por colegio" (`references.org`); sobrevive "% del nivel" |

**Orden:** P1 → P2 (misma superficie, P1 bloquea a P2), luego P3 y P4 (independientes; P4 al final por tocar tipos compartidos).

---

## Fase 1 — Colecciones (P1 → P2)

### P1 · El dropdown "Seleccionar una lista" no muestra las listas
Diagnóstico: `SaveToCollectionDialog` mapea `collections` → `SelectItem` correctamente, así que el bug está **aguas arriba** (la data que llega). Cadena: `getItemCollections()` → `GET /item-collections?limit=100` → página → `ItemBankExplorer` → diálogo.
- Revisar `item-collections.service.ts` `list()` (query `count(...)` + `GROUP BY`, scoping por `org_id` + `withOrgContext`).
- Revisar caché/refresh: `getItemCollections` va con `cache()`; al crear una lista se hace `router.refresh()`. Confirmar que no sirve stale y que la página fetchea (hoy solo si `canManageCollections`).
- Fix donde rompa + test unit del `list()` (fake db).

### P2 · Kebab "Agregar a una colección" en el panel de ítem *(depende de P1)*
- Menú kebab (shadcn `DropdownMenu`) arriba-derecha en:
  - `banco-contenido/[instrumentId]/ItemDetailPanel.tsx` (sin respuestas)
  - `resultados/components/question-detail-panel.tsx` (con respuestas)
- Opción "Agregar a una colección" → abre `SaveToCollectionDialog` con `itemIds=[item.id]` (reusar el mismo).
- Proveer `collections` en cada contexto (en el banco ya se fetchean; en resultados traerlas de `/item-collections`).
- Gating por rol (`ITEM_BANK_ROLES` / `canManageCollections`).

## Fase 2 — Dashboard (P3)

### P3 · Dropdown "Instrumento" solo con instrumentos con datos
- Backend `dashboards.service.ts` → `getFilterOptions`: acotar `instrumentRows` a instrumentos con ≥1 evaluación con datos en el scope (`assessment_results` / `assessment_item_stats`), respetando el scope de profesor.
- Frontend sin cambios o mínimos (ya deriva `instrumentOptions` de `options.instruments`).
- Test unit del `getFilterOptions`.

## Fase 3 — Referencias T2-17 (P4) · riesgo alto

### P4 · Eliminar "% de logro por colegio" (`references.org`)
1. Tipos (`packages/types/.../item-analysis.schema.ts`): quitar `org` de `QuestionReferences`; ajustar `QuestionAnalysisResponse.references` y el tipo de la matriz.
2. Backend `item-analysis.service.ts`: `loadQuestionReferences` deja de calcular `org`; `attachOrgReferences` (tabla cruzada) pasa a poblar la referencia de **nivel** (misma cifra), no colegio.
3. Frontend: `question-detail-panel.tsx` quita la línea "% colegio"; `resultados/detalle/cross-table.tsx` / `SchoolReferenceRow` → colegio→**nivel** (baseline conservado).
4. Regresión: typecheck (ripple a web) + tabla cruzada mantiene su línea de comparación.

---

## Cierre
- `pnpm typecheck` + `pnpm lint` + tests de API verdes. Prettier solo sobre archivos propios (**nunca** `pnpm format`).
- Un PR a `dev` con las 3 fases (commits atómicos por pendiente).
