# Plan de desarrollo — Clave/pauta, distribución y "Analizar con IA" en el panel de pregunta

> Companion de [`diseno-item-detail-clave-y-analisis-ia.md`](./diseno-item-detail-clave-y-analisis-ia.md)
> (el _qué_ y el _por qué_). Este documento es el _cómo_: tareas ordenadas, archivos, comandos,
> tests y estructura de PRs. Branch base: `item-detail-clave-y-analisis-ia`.

## Cómo leer este plan

- Cada **fase = 1 PR atómico** que compila y aporta valor observable.
- `[ ]` son tareas ordenadas dentro de la fase (respetar el orden: types → db/api → web).
- **Puerta de calidad** al final de cada fase (obligatoria antes de PR):
  ```bash
  pnpm typecheck && pnpm lint          # raíz del monorepo
  pnpm --filter @soe/types test        # si tocó packages/types
  pnpm --filter api test               # si tocó apps/api  (cwd apps/api: pnpm test)
  ```
- Cada fase cierra con un commit conventional en español (skill `commit`) y PR con `create-pr`.

## Secuenciación

```
F1 ──┬── F2 (rúbrica) ─────────────┐
     └── F3 (Panel B) ── F4 (IA) ──┴── F5 (fullscreen) ── F6 (pulido, opc.)
```

- **F1** es prerequisito de todo (define `deriveAnswerKey` + `AnswerKeyView`).
- **F2** y **F3** pueden ir en paralelo tras F1 (distintas capas, poco solapamiento).
- **F4** requiere F3 (reusa `answerKey`/`scoreDistribution`).
- **F5** requiere el body final (F3/F4).

| Fase | Título                                   | Backend           | Riesgo | Depende de |
| ---- | ---------------------------------------- | ----------------- | ------ | ---------- |
| F1   | `AnswerKey` compartido + clave en Banco  | No                | Bajo   | —          |
| F2   | Endpoint rúbrica + `RubricDialog`        | Sí (módulo nuevo) | Medio  | F1         |
| F3   | Clave + distribución no-MC en Resultados | Sí                | Medio  | F1         |
| F4   | "Analizar con IA" inline + prompt no-MC  | Sí                | Medio  | F3         |
| F5   | Pantalla completa                        | No                | Bajo   | F3, F4     |
| F6   | Pulido y consistencia                    | —                 | Bajo   | F1–F5      |

---

## Fase 0 — Preparación (antes de F1, decisiones que desbloquean código)

Cerrar las decisiones abiertas §10 del diseño para no bloquear a mitad de fase:

- [ ] **Rótulos/colores RC/RPC/RI:** `RC=Correcta` (credit 1, `--level-adequate`/verde),
      `RPC=Parcial` (credit 0.5, `--level-elementary`/ámbar), `RI=Incorrecta` (credit 0,
      `--level-insufficient`/rojo). Confirmar con producto.
- [ ] **Roles `GET /rubrics/:id`:** decidir constante en `packages/types/src/access-policies/`
      (propuesta: reusar/alias de `ITEM_VIEWER_ROLES`).
- [ ] **`multi_select` en header:** decidir si el badge "Clave correcta" del header desaparece en
      favor de `AnswerKeyView` (`kind:'multi_choice'`) o se mantiene. Propuesta: `AnswerKeyView` es
      la fuente; el header solo muestra badge para `kind:'choice'`.
- [ ] Verificar exports actuales de `MatchingContentView`/`TrueFalseContentView` y sus consumidores
      (`grep -rn "MatchingContentView\|TrueFalseContentView" apps/web/src`) para migrarlos sin romper.

---

## Fase 1 — `AnswerKey` compartido + clave inline en el Banco (Panel A)

**Objetivo:** el Banco muestra la respuesta correcta de _todos_ los tipos, no solo MC/matching/V-F.
**Sin backend.**

### Tareas

- [ ] `packages/types/src/schemas/answer-key.schema.ts` — `answerKeySchema` (unión discriminada por
      `kind`), tipos `AnswerKey`, `AlternativeKey`, `RubricLevelInline`. Exportar desde el index de
      `@soe/types`.
- [ ] `packages/types/src/utils/answer-key.ts` — `deriveAnswerKey(type: ItemType, content:
  ItemContent): AnswerKey`. Puro, sin `db`, sin imports de services. Mapea cada `item_type` a su
      `kind` (ver tabla §2.2 del diseño); default → `{ kind: 'none' }`.
- [ ] `packages/types/src/utils/answer-key.spec.ts` — un caso por `item_type` (incluye
      `multi_select`, `rubric_scored`, y un tipo sin clave → `none`).
- [ ] `apps/web/src/components/items/answer-key-view.tsx` — componente que renderiza cualquier
      `AnswerKey`. Absorbe la lógica de `MatchingContentView` y `TrueFalseContentView` como ramas
      internas (mueve el código, no lo copia; actualiza imports de los consumidores existentes).
      Para `kind` con `rubricId`, renderiza un botón "Ver pauta" (deshabilitado en F1, placeholder).
- [ ] `apps/web/.../banco-contenido/[instrumentId]/ItemDetailPanel.tsx` — reemplazar el bloque
      "Respuesta correcta / Alternativas" (líneas ~197-229) por
      `<AnswerKeyView answerKey={deriveAnswerKey(item.type, item.content)} itemId={item.id} />`.
      Conservar el render de alternativas-imagen (`altImageKeys`) dentro de `AnswerKeyView`.

### Puerta de calidad + PR

- [ ] `pnpm typecheck && pnpm lint && pnpm --filter @soe/types test`
- [ ] Verificación manual (skill `run`): abrir en el banco un ítem `open_ended`, `short_answer`,
      `ordering`, `rubric_scored`, `matching`, `true_false`, `multiple_choice`.
- [ ] PR: `feat(web): mostrar clave de todos los tipos de ítem en el panel del banco`

**Aceptación:** todo tipo muestra su clave/respuesta modelo; MC/matching/V-F sin regresión; el
botón "Ver pauta" aparece (inactivo) cuando hay `rubricId`.

---

## Fase 2 — Endpoint de rúbrica + `RubricDialog`

**Objetivo:** el botón "Ver pauta" abre la rúbrica real en un modal.

### Backend

- [ ] `packages/types/src/schemas/rubric.schema.ts` — `rubricModelSchema` / `RubricModel`:
      `{ id, name, type, criteria: { id, name, description, maxPoints, order, levels: { id, score,
  descriptor, examples }[] }[] }`. Export desde `@soe/types`.
- [ ] Roles: constante en `access-policies/` (según Fase 0).
- [ ] `apps/api/src/rubrics/rubrics.service.ts` — `getById(user, rubricId): Promise<RubricModel>`.
      Query anidada (rubric + criteria ordenados + levels ordenados) **dentro de
      `withOrgContext(this.db, orgId, tx => ...)`**. `NotFoundException` si no existe / no es del
      tenant / `deletedAt`. Ensamblado en una pasada (Map criterionId→levels, sin `find` en loop).
- [ ] `apps/api/src/rubrics/rubrics.controller.ts` — `GET /rubrics/:id`, `@UseGuards(RolesGuard)`,
      `@Roles(...)`. Controller fino (solo delega).
- [ ] `apps/api/src/rubrics/rubrics.module.ts` + registrar en `app.module.ts`.
- [ ] **RLS:** verificar/añadir política de `rubrics` en `packages/db/sql/rls-policies.sql`
      (lleva `orgId`). Correr `pnpm db:migrate` local para re-aplicar.
- [ ] Tests: `rubrics.service.spec.ts` (fake DB, patrón `heatmap.service.spec.ts`),
      `rubrics.controller.spec.ts` (supertest: 200 tenant propio, 404 cross-tenant).

### Frontend

- [ ] `apps/web/src/components/items/rubric-dialog.tsx` — `Dialog` de shadcn que al abrir fetchea
      `GET /rubrics/:id` on-demand (TanStack Query vía `api-client.ts`, patrón
      `06-client-data-fetching.md`; `getDisplayMessage` para errores). Render matriz criterios ×
      niveles. Cierre overlay/X/Esc (default del `Dialog`).
- [ ] Cablear en `AnswerKeyView`: el botón "Ver pauta" abre `RubricDialog` con el `rubricId`.

### Puerta de calidad + PR

- [ ] `pnpm typecheck && pnpm lint && pnpm --filter api test`
- [ ] Manual: ítem con `rubricId` → "Ver pauta" muestra criterios/niveles; sin rúbrica → sin botón.
- [ ] PR: `feat: endpoint de rúbrica y modal de pauta en el detalle de ítem`

**Aceptación:** la pauta se abre desde ambos usos de `AnswerKeyView`; cross-tenant devuelve 404.

---

## Fase 3 — Clave + distribución no-MC en Resultados (Panel B)

**Objetivo:** el panel de respuestas muestra clave y distribución RC/RPC/RI también en desarrollo.

### Backend

- [ ] `packages/types/src/schemas/item-analysis.schema.ts` — extender
      `questionAnalysisResponseSchema`:
      `answerKey: answerKeySchema` y
      `scoreDistribution: z.array(scoreCategoryDistributionSchema).nullable()`.
      Definir `scoreCategoryDistributionSchema` (`key, label, count, percentage, credit`).
- [ ] `apps/api/src/item-analysis/item-analysis.service.ts` → `getQuestionAnalysis`:
  - [ ] poblar `answerKey` con `deriveAnswerKey(item.type, content)`.
  - [ ] helper privado `buildScoreDistribution(countByKey, totalResponses, blankCount)` que, cuando
        `altDefs` está vacío y el tipo es de desarrollo, proyecta los buckets `RC/RPC/RI` (usar
        `DEVELOPMENT_BUCKETS`, rótulos/credit de Fase 0) a `ScoreCategoryDistribution[]`; en MC
        devuelve `null`. Una pasada sobre `countByKey` (ya es `Map`).
  - [ ] agregar ambos al objeto de retorno (`:545-566`).
- [ ] Tests `item-analysis.service.spec.ts`: `answerKey` por tipo (MC vs desarrollo) y
      `scoreDistribution` para un ítem de desarrollo (verificar % y credit).

### Frontend

- [ ] `apps/web/.../resultados/components/question-detail-panel.tsx`:
  - [ ] insertar `<AnswerKeyView answerKey={data.answerKey} itemId={data.itemId} />` (sección
        "Respuesta correcta / Pauta").
  - [ ] en "Distribución de respuestas": si `data.alternatives.length > 0` → barras por alternativa
        (actual); else si `data.scoreDistribution` → barras por categoría (reusar el estilo de
        `AlternativeRow`, color por `credit` con tokens `--level-*`); else → mensaje actual.
  - [ ] mantener la fila de blancos (`BlankRow`).

### Puerta de calidad + PR

- [ ] `pnpm typecheck && pnpm lint && pnpm --filter api test`
- [ ] Manual: evaluación con ítem de desarrollo → panel muestra respuesta modelo/pauta + barras
      Correcta/Parcial/Incorrecta coherentes con el % de logro; MC sin regresión.
- [ ] PR: `feat: clave y distribución por categoría para ítems de desarrollo en resultados`

**Aceptación:** desarrollo muestra clave + distribución; MC intacto; % consistente con `correctRate`.

---

## Fase 4 — "Analizar con IA" inline en Panel B + generalización a no-MC

**Objetivo:** botón de IA dentro del panel, útil para todos los tipos.

### Frontend (refactor + montaje)

- [ ] `apps/web/.../analisis-ia/components/item-insight-dialog.tsx` — extraer el cuerpo (generate +
      polling + estados running/error/done + render) a `ItemInsightInline`
      (`.../analisis-ia/components/item-insight-inline.tsx`). `ItemInsightDialog` pasa a ser wrapper
      que monta `ItemInsightInline` dentro de su `Dialog` (sin regresión en `/analisis-ia`).
- [ ] `question-detail-panel.tsx` — al final del cuerpo: encabezado "Análisis pedagógico con IA" +
      botón "Analizar con IA" (`Sparkles`); al gatillar, montar `ItemInsightInline` con
      `itemId/assessmentId/classGroupId/activeRole`.
- [ ] Prop-drilling en padres: `resultados/detalle/cross-table.tsx` y
      `resultados/informe/items-analysis-table.tsx` pasan `assessmentId/classGroupId/activeRole` al
      `QuestionDetailPanel`. (Los dos ya tienen `assessmentId`/`classGroupId`; `activeRole` viene de
      `session.user.activeRole`, threaded desde el Server Component padre.)

### Backend (snapshot + prompt)

- [ ] `packages/types` — extender `itemInsightSnapshotSchema`: `answerKey?`, `scoreDistribution?`,
      `rubricSummary?` (todos opcionales, aditivos).
- [ ] `apps/api/src/ai-analysis/item-insight.snapshot.ts` — poblar los nuevos campos reusando
      `deriveAnswerKey` + `scoreDistribution` del análisis; `rubricSummary` liviano si hay
      `rubricId` (solo `{ name, maxPoints }[]`, sin descriptores completos).
- [ ] `apps/api/src/ai-analysis/prompts/item-insight.prompt.ts` — generalizar system+user:
      rama con alternativas (actual, distractores) vs rama desarrollo (distribución RC/RPC/RI +
      respuesta modelo/pauta + brecha esperado vs logrado). Bump
      `ITEM_INSIGHT_PROMPT_VERSION → 's2-item-insight-v3'`.
- [ ] Actualizar `item-insight.snapshot.spec.ts` y `item-insight.runner.spec.ts` (snapshot no-MC
      bien formado; output MC sin romper).

### Puerta de calidad + PR

- [ ] `pnpm typecheck && pnpm lint && pnpm --filter api test`
- [ ] Manual: desde el panel, "Analizar con IA" en un ítem MC **y** en uno de desarrollo → genera,
      polling, disclaimer, lectura coherente. Verificar que `/analisis-ia` sigue funcionando.
- [ ] PR: `feat: analizar ítem con IA desde el panel de resultados, incluyendo desarrollo`

**Aceptación:** IA disponible inline para MC y desarrollo; caché invalidada por bump de versión;
`/analisis-ia` sin regresión.

---

## Fase 5 — Modo pantalla completa

**Objetivo:** ver el detalle con más aire, con la IA en sección destacada.

### Tareas

- [ ] `apps/web/src/components/question-detail/question-detail-body.tsx` — extraer el cuerpo del
      panel a un componente con `layout: 'panel' | 'fullscreen'`. Panel B (y opcionalmente A) lo
      consumen; `layout='fullscreen'` usa 2 columnas y sección IA destacada.
- [ ] `question-detail-sheet.tsx` — botón "pantalla completa" (`Maximize2`) en `headerActions`;
      estado del modal (o gestionarlo en un wrapper del panel).
- [ ] `Dialog` amplio (`max-w-5xl`, `max-h-[90vh]`, overflow) que reusa `QuestionDetailBody` en
      `layout='fullscreen'`. Cierre overlay/X/Esc.
- [ ] **Estado IA compartido** (decisión abierta §10.4): elevar el estado de `ItemInsightInline` al
      padre del panel para que abrir el fullscreen no re-dispare ni pierda el análisis cargado.
      Alternativa: una única instancia del inline reubicada. Elegir e implementar.

### Puerta de calidad + PR

- [ ] `pnpm typecheck && pnpm lint`
- [ ] Manual: maximizar/minimizar sin perder el análisis IA ni desincronizar; cierre por overlay/X/Esc.
- [ ] PR: `feat(web): vista de pantalla completa del detalle de pregunta con análisis IA destacado`

**Aceptación:** modal amplio con el mismo detalle mejor distribuido; IA prominente; sin
desincronización de estado con el sheet.

---

## Fase 6 (opcional) — Pulido y consistencia

- [ ] Unificar el badge "Clave correcta: X" del header con `AnswerKeyView` (una sola fuente).
- [ ] Accesibilidad: roles ARIA de las barras, manejo de foco al abrir `RubricDialog` / fullscreen.
- [ ] QA de tipos menos comunes: `gap_fill`, `listening`, `oral_reading`, `oral_expression`.
- [ ] Revisar duplicación de `type ApiError` en actions si se tocó alguna (regla frontend 01).
- [ ] PR: `refactor(web): consistencia y accesibilidad del detalle de pregunta`

---

## Checklist transversal (aplicar en cada fase)

- [ ] Toda query a tabla con RLS corre en `withOrgContext` usando `tx` (no `this.db`).
- [ ] `orgId` siempre del token, nunca del body/query.
- [ ] Sin literales "DIA"/"Lenguaje"/grados hardcodeados; ramificar por `item_type` (enum).
- [ ] Sin comentarios en código (regla backend 02); nombres autoexplicativos.
- [ ] Roles vía constantes de `access-policies` + `canAccess`/`@Roles`, nunca listas inline.
- [ ] Sin O(N²): agregaciones en una pasada con `Map`, sin `find`/spread en loop.
- [ ] Componentes UI desde `@/components/ui` y `patterns/`; colores por tokens (`--level-*`).
- [ ] Commit conventional en español por fase (skill `commit`); PR con `create-pr`.
