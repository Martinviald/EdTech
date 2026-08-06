# Diseño — Clave/pauta, distribución y "Analizar con IA" en el panel de detalle de pregunta

> **Estado:** propuesta aprobada en decisiones de producto, pendiente de organizar desarrollo.
> **Branch:** `item-detail-clave-y-analisis-ia`.
> **Alcance:** panel lateral de detalle de pregunta en **Resultados** (respuestas de una
> evaluación) y — parcialmente — en el **Banco de contenido** (vista del instrumento).

---

## 1. Objetivo

Cuando un docente abre el detalle de una pregunta para analizar por qué el curso obtuvo cierto
resultado, hoy le faltan tres cosas:

1. **La clave / respuesta correcta no se muestra para ítems que no son de alternativas**
   (desarrollo, respuesta corta, ordenamiento, evaluados por pauta). Solo ve un mensaje "esta
   pregunta no tiene alternativas".
2. **En el panel de respuestas de una evaluación no hay distribución para ítems no-MC.** Para
   selección múltiple sí hay barras por alternativa; para desarrollo solo aparece el % de logro
   agregado, sin desglose de cuántos respondieron correcto / parcial / incorrecto.
3. **No hay forma de pedir un análisis pedagógico con IA desde el propio panel.** La funcionalidad
   existe pero vive en otra página (`/analisis-ia`) y hay que elegir la pregunta desde un desplegable.

Este documento diseña cómo cerrar esas tres brechas reutilizando al máximo lo ya construido.

---

## 2. Estado actual (diagnóstico preciso)

### 2.1 Hay dos paneles, no uno

Ambos comparten el shell `QuestionDetailSheet`
(`apps/web/src/components/question-detail/question-detail-sheet.tsx`): un `Sheet` anclado a la
derecha, redimensionable, con header accesible y botones para "Ver texto de lectura" / "Ver imagen".

|                   | **Panel A — `ItemDetailPanel`**                                                                                     | **Panel B — `QuestionDetailPanel`**                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Archivo           | `app/(dashboard)/banco-contenido/[instrumentId]/ItemDetailPanel.tsx`                                                | `app/(dashboard)/resultados/components/question-detail-panel.tsx`                   |
| Contexto          | Vista del **instrumento** (el ítem, sin respuestas)                                                                 | **Respuestas de una evaluación**                                                    |
| Se abre desde     | `ItemsTable`, `SpecTableReview`, `CollectionDetailView`, `ItemBankExplorer`                                         | `resultados/detalle/cross-table.tsx`, `resultados/informe/items-analysis-table.tsx` |
| Fuente de datos   | `ItemModel` ya cargado (incluye `content` crudo + `tags`)                                                           | `QuestionAnalysisResponse` cargado on-demand con `fetchQuestionAnalysis`            |
| Clave que muestra | MC (`isCorrect`), matching (`MatchingContentView`), V/F (`TrueFalseContentView`); resto → _"no tiene alternativas"_ | Solo `correctKey` en un badge del header; resto → _"no es de selección múltiple"_   |
| Distribución      | ❌                                                                                                                  | ✅ barras por alternativa + distractor dominante — **solo MC**                      |
| Botón IA          | ❌                                                                                                                  | ❌                                                                                  |

### 2.2 Qué data existe pero no se renderiza

La clave de los tipos no-MC **ya está** en `content` (`packages/types/src/schemas/item-content.schema.ts`):

| Tipo (`item_type`)                 | Campo con la clave                                                | Ubicación           |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------- |
| `open_ended`                       | `sampleAnswer?: string`, `rubricId?: uuid`                        | schema línea 90-96  |
| `writing`                          | `rubricId?: uuid`                                                 | 98-104              |
| `oral_reading` / `oral_expression` | `rubricId?: uuid`                                                 | 106-116             |
| `short_answer`                     | `acceptedAnswers: string[]`                                       | 232                 |
| `ordering`                         | `correctOrder: string[]`                                          | 204                 |
| `matching`                         | `correctPairs: {leftId,rightId}[]`                                | 159 (ya se muestra) |
| `true_false`                       | `correctAnswer: boolean`                                          | 86 (ya se muestra)  |
| `rubric_scored`                    | `levels: {code,label?,descriptor?,creditFraction}[]`, `rubricId?` | 250-260             |
| `multi_select`                     | `alternatives[].isCorrect` (conjunto; `correctKey`=null)          | —                   |

La **rúbrica completa** vive en tablas relacionales, referenciada por `content.rubricId`:

- `rubrics` (`packages/db/src/schema/items.ts:103`): `id, orgId, name, type ('analytic'|'holistic'), subjectId, isShared`.
- `rubricCriteria` (`:115`): `id, rubricId, name, description, maxPoints, order, taxonomyNodeId`.
- `rubricLevels` (`:127`): `id, criterionId, score, descriptor, examples[]`.

**No existe** módulo `rubrics` en `apps/api/src` ni ningún endpoint que sirva una rúbrica — hay que
crearlo.

La **distribución de desarrollo** también se calcula pero se descarta. El read-model
`assessment_item_stats.answerCounts` guarda, para ítems de desarrollo, buckets por categoría de
puntaje: `DEVELOPMENT_BUCKETS = ['RC','RPC','RI']`
(`packages/types/src/utils/item-stats-calculator.ts:40`), clasificados por
`score <= 0 → RI`, `score >= maxScore → RC`, resto → `RPC` (`:133-135`). En
`ItemAnalysisService.getQuestionAnalysis` estos buckets se acumulan en `countByKey`
(`apps/api/src/item-analysis/item-analysis.service.ts:486-511`) y contribuyen a `correctRate`, pero
**no se exponen**: la respuesta arma `alternatives[]` solo desde `content.alternatives`
(`:533-543`), que en desarrollo está vacío.

### 2.3 La IA por-pregunta ya está construida

- **Endpoint:** `POST /api/ai-analysis/items/:itemId/generate`
  (`apps/api/src/ai-analysis/item-insight.controller.ts`), gateado por feature `ai_analysis` +
  `AI_ANALYSIS_GENERATOR_ROLES`. Polling con `GET /api/ai-analysis/:id`.
- **Snapshot determinista** (`item-insight.snapshot.ts`): reúsa `getQuestionAnalysis`
  (enunciado, `correctKey`, alternativas+distribución, distractor dominante, tags) +
  `AssessmentReportService.getReport` (% logro, `contentName`) + pasaje de la sección +
  **imágenes del ítem y de la sección descargadas a base64** (best-effort, ≤4 MiB, solo URLs http(s)).
- **Multimodal:** las imágenes se envían por `llm.completeMultimodal(...)`. Providers Anthropic y
  Gemini soportan el canal.
- **Prompt** (`prompts/item-insight.prompt.ts`, versión `s2-item-insight-v2`): hoy está **acotado a
  selección múltiple** — el system dice literal _"Analizas UNA pregunta de selección múltiple"_ y
  todo el razonamiento gira sobre distractores. Output validado con `itemInsightOutputSchema`:
  `headline, performanceSummary, likelyCause, misconception, distractorAnalysis, passageInsight,
visualInsight, recommendedActions, confidence, caveats`.
- **Frontend:** `ItemInsightDialog`
  (`app/(dashboard)/analisis-ia/components/item-insight-dialog.tsx`) hace generate + polling +
  render, con disclaimer "validar antes de actuar", estados running/error, regenerar. Se dispara
  hoy desde `ItemInsightSection` (un `<Select>` de preguntas), no desde el panel.
- Los padres del Panel B (`cross-table.tsx`, `items-analysis-table.tsx`) **ya disponen de
  `assessmentId` y `classGroupId`**, que es lo que el endpoint de IA necesita.

---

## 3. Decisiones de producto (confirmadas)

1. **Pauta:** se muestra la **rúbrica completa**, detrás de un **botón "Ver pauta"** que abre un
   **modal** con la rúbrica (criterios × niveles). No se incrusta inline para no saturar el panel.
2. **Análisis IA:** se **embebe inline dentro del sheet, al final** (lo más abajo). Además, el
   panel lateral gana un **botón "pantalla completa"** arriba a la derecha que abre un **modal
   amplio** con el mismo detalle pero mejor espaciado, y ahí el análisis IA tiene una **sección
   destacada**. El modal se cierra con click fuera, con la **X** o con **Esc**.
3. **Alcance del botón IA:** **solo en el panel de Resultados (Panel B)** por ahora — el Banco de
   contenido no tiene respuestas de alumnos, así que el análisis de resultados no aplica.
4. **Entrega:** este documento cubre **todas las fases**; el desarrollo se organiza después.

Corolario de alcance por panel:

| Feature                                    | Panel A (banco)        | Panel B (resultados) |
| ------------------------------------------ | ---------------------- | -------------------- |
| Clave inline (no-MC)                       | ✅                     | ✅                   |
| Botón "Ver pauta" + modal rúbrica          | ✅                     | ✅                   |
| Distribución no-MC (RC/RPC/RI)             | ❌ (no hay respuestas) | ✅                   |
| Análisis IA inline + sección en fullscreen | ❌                     | ✅                   |
| Botón "pantalla completa"                  | ✅ (opcional)          | ✅                   |

---

## 4. Arquitectura de la solución

### 4.1 Principio rector: una sola fuente para la clave

Para no duplicar la lógica de "qué es la respuesta correcta según el tipo" entre el Panel A (que
tiene `content` crudo) y el backend (que la expone al Panel B), se centraliza en un **helper puro
compartido** en `packages/types` (DRY, §4.2 CLAUDE.md):

```
packages/types/src/utils/answer-key.ts
  deriveAnswerKey(type: ItemType, content: ItemContent): AnswerKey   // puro, sin db
```

`AnswerKey` es una **unión discriminada** (nueva, en `packages/types/src/schemas/`):

```ts
type AnswerKey =
  | { kind: 'choice'; correctKey: string; alternatives: AlternativeKey[] } // multiple_choice
  | { kind: 'multi_choice'; correctKeys: string[]; alternatives: AlternativeKey[] } // multi_select
  | { kind: 'true_false'; correctAnswer: boolean }
  | { kind: 'matching'; leftItems; rightItems; correctPairs } // reusa lo existente
  | { kind: 'ordering'; correctOrder: string[] }
  | { kind: 'short_answer'; acceptedAnswers: string[] }
  | { kind: 'sample_answer'; sampleAnswer: string | null; rubricId: string | null } // open_ended/writing/oral_*
  | { kind: 'rubric_levels'; levels: RubricLevelInline[]; rubricId: string | null } // rubric_scored
  | { kind: 'none' }; // sin clave registrada
```

- **Panel A** llama `deriveAnswerKey(item.type, item.content)` directamente (sin backend).
- **Backend** (`getQuestionAnalysis`) llama el mismo helper y expone el resultado como
  `answerKey` en `QuestionAnalysisResponse`.
- **`AnswerKeyView`** (componente de UI compartido) renderiza cualquier `AnswerKey`, y ambos
  paneles lo usan. Sustituye a los actuales `MatchingContentView` / `TrueFalseContentView` sueltos
  (que pasan a ser ramas internas de `AnswerKeyView`, sin perder su código).

### 4.2 Distribución no-MC: exponer lo ya calculado

Se añade a `QuestionAnalysisResponse` un campo:

```ts
scoreDistribution: ScoreCategoryDistribution[] | null;

type ScoreCategoryDistribution = {
  key: 'RC' | 'RPC' | 'RI';   // reusa DEVELOPMENT_BUCKETS
  label: string;              // 'Correcta' | 'Parcial' | 'Incorrecta'
  count: number;
  percentage: number;         // sobre totalResponses (excluye blancos, que ya tienen su fila)
  credit: number;             // 1 | 0.5 | 0 → color por nivel de logro
};
```

- Es `null` para ítems de selección múltiple (ahí se sigue usando `alternatives[]`).
- Se llena en `getQuestionAnalysis` a partir de los buckets que hoy se descartan (`countByKey`
  cuando `altDefs` está vacío y el tipo es de desarrollo).
- El frontend elige qué mostrar: si `alternatives.length > 0` → barras por alternativa (actual);
  si `scoreDistribution != null` → barras por categoría (nuevo); si ninguna → el mensaje actual.

### 4.3 Rúbrica: endpoint nuevo + modal

- **Backend:** módulo nuevo `apps/api/src/rubrics/` con `GET /rubrics/:id` que devuelve la rúbrica
  con sus criterios y niveles anidados. RLS: `rubrics` lleva `orgId`; la query corre dentro de
  `withOrgContext`. Roles: los mismos que ya ven ítems/resultados (`ITEM_VIEWER_ROLES` /
  `RESULTS_VIEWER_ROLES`, a confirmar en `access-policies`).
- **Contrato:** `RubricModel` (nuevo schema en `packages/types`): `{ id, name, type, criteria:
{ id, name, description, maxPoints, order, levels: { score, descriptor, examples }[] }[] }`.
- **Frontend:** `RubricDialog` (nuevo, en `apps/web/src/components/items/`), un `Dialog` que
  fetchea la rúbrica on-demand al abrir (TanStack Query, patrón de
  `06-client-data-fetching.md`) y la renderiza como matriz criterios × niveles. Lo dispara el
  botón "Ver pauta" que `AnswerKeyView` muestra cuando el `AnswerKey` trae `rubricId`.

### 4.4 Análisis IA inline + fullscreen

- **Extraer el cuerpo** de `ItemInsightDialog` a un componente **presentacional** reutilizable
  `ItemInsightInline` (genera + polling + render, sin el `Dialog` que lo envuelve hoy). El
  `ItemInsightDialog` actual pasa a ser un wrapper delgado que monta `ItemInsightInline` dentro de
  su `Dialog` (mantiene `/analisis-ia` funcionando sin cambios).
- **Panel B** monta `ItemInsightInline` al final del cuerpo, precedido de un encabezado "Análisis
  pedagógico con IA" y — mientras no se haya gatillado — un botón **"Analizar con IA"** (`Sparkles`)
  que dispara la generación. Recibe `itemId`, `assessmentId`, `classGroupId`, `activeRole` (prop-drilling
  desde los padres, que ya los tienen).
- **Fullscreen:** el `QuestionDetailSheet` gana un botón "pantalla completa" (`Maximize2`) en
  `headerActions`. Al pulsarlo se abre un `Dialog` amplio (`max-w-5xl`, alto ~90vh) que renderiza el
  **mismo cuerpo** con un layout de dos columnas (contenido/distribución a la izquierda, análisis IA
  destacado a la derecha o debajo con más aire). Cierre por overlay / X / Esc (comportamiento por
  defecto de `Dialog` de shadcn).
- Para compartir cuerpo entre sheet y modal fullscreen se extrae el contenido del panel a un
  componente `QuestionDetailBody` con una prop `layout: 'panel' | 'fullscreen'`.

### 4.5 Generalización del prompt IA a no-MC

El snapshot y el prompt actuales asumen selección múltiple. Para que "Analizar con IA" sea útil en
desarrollo:

- **`ItemInsightSnapshot`** (`packages/types`) gana campos opcionales:
  `answerKey?: AnswerKey`, `scoreDistribution?: ScoreCategoryDistribution[]`,
  `rubricSummary?: { criteria: { name; maxPoints }[] } | null`.
- **`item-insight.snapshot.ts`** los llena reusando `deriveAnswerKey` + `scoreDistribution` del
  análisis + (si hay `rubricId`) un resumen liviano de la rúbrica.
- **`item-insight.prompt.ts`**: el system deja de decir "selección múltiple". Se ramifica:
  - Con alternativas → razona sobre distractores (comportamiento actual).
  - Sin alternativas (desarrollo) → razona sobre la distribución RC/RPC/RI, la respuesta modelo /
    rúbrica, y qué revela la brecha entre lo esperado (pauta) y lo logrado. `distractorAnalysis`
    puede quedar vacío; se apoya en `misconception` / `recommendedActions`.
  - Se **bumpea** `ITEM_INSIGHT_PROMPT_VERSION` a `s2-item-insight-v3` (invalida caché).
- El `itemInsightOutputSchema` **no cambia de forma** (sigue sirviendo); solo cambia cómo se llena
  para no-MC. Si se decide añadir un campo específico de desarrollo, sería aditivo y opcional.

---

## 5. Cambios por capa

### `packages/types`

- `schemas/answer-key.schema.ts` — `answerKeySchema`, tipo `AnswerKey`, `AlternativeKey`,
  `RubricLevelInline`.
- `utils/answer-key.ts` — `deriveAnswerKey(type, content)` (puro) + `answer-key.spec.ts`.
- `schemas/item-analysis.schema.ts` — extender `questionAnalysisResponseSchema` con `answerKey` y
  `scoreDistribution`.
- `schemas/rubric.schema.ts` — `rubricModelSchema` / `RubricModel`.
- `schemas/*item-insight*` — extender `itemInsightSnapshotSchema` (`answerKey`, `scoreDistribution`,
  `rubricSummary` opcionales).
- `access-policies/` — si hace falta, constante de roles para leer rúbricas (o alias de una existente).

### `packages/db`

- Sin cambios de schema. Las tablas `rubrics/rubricCriteria/rubricLevels` ya existen.
- Verificar que `rubrics` esté cubierta por RLS: lleva `orgId`, así que su política debe estar en
  `packages/db/sql/rls-policies.sql` (§5.2 CLAUDE.md). **Añadirla si falta.**

### `apps/api`

- `item-analysis/item-analysis.service.ts` — `getQuestionAnalysis`: llamar `deriveAnswerKey`,
  poblar `answerKey`; construir `scoreDistribution` desde los buckets RC/RPC/RI para tipos de
  desarrollo (sin re-query: reusar `countByKey`). Extraer helper privado
  `buildScoreDistribution(...)`.
- `rubrics/` — módulo nuevo: `rubrics.module.ts`, `rubrics.controller.ts` (`GET /rubrics/:id`,
  `@Roles(...)`, `@UseGuards(RolesGuard)`), `rubrics.service.ts` (query anidada dentro de
  `withOrgContext`, `NotFoundException` si no existe o no es del tenant).
- `ai-analysis/item-insight.snapshot.ts` — poblar `answerKey`/`scoreDistribution`/`rubricSummary`.
- `ai-analysis/prompts/item-insight.prompt.ts` — generalizar system+user; bump de versión.
- Registrar `RubricsModule` en `app.module.ts`.

### `apps/web`

- `components/items/answer-key-view.tsx` — nuevo, render de `AnswerKey` (absorbe matching y V/F).
- `components/items/rubric-dialog.tsx` — nuevo, modal de rúbrica (fetch on-demand).
- `components/question-detail/question-detail-body.tsx` — extraer cuerpo compartido con
  `layout: 'panel' | 'fullscreen'`.
- `components/question-detail/question-detail-sheet.tsx` — botón "pantalla completa" + estado del
  modal fullscreen (o gestionarlo en un wrapper).
- `banco-contenido/[instrumentId]/ItemDetailPanel.tsx` — usar `deriveAnswerKey` + `AnswerKeyView`.
- `resultados/components/question-detail-panel.tsx` — usar `AnswerKeyView`, render de
  `scoreDistribution`, montar `ItemInsightInline` + botón "Analizar con IA".
- `resultados/detalle/cross-table.tsx` y `resultados/informe/items-analysis-table.tsx` — pasar
  `assessmentId`/`classGroupId`/`activeRole` al panel.
- `analisis-ia/components/item-insight-dialog.tsx` — refactor: extraer `ItemInsightInline`; el
  dialog pasa a ser wrapper.
- Server actions de IA (`generateItemInsight`/`fetchItemInsight`) — ya sirven; se reusan tal cual.
  Considerar moverlas a un lugar compartido si el import cruzado entre features molesta.

---

## 6. Fases de desarrollo

Ordenadas por dependencia. Cada fase es un PR atómico, compila (`pnpm typecheck && pnpm lint`) y
aporta valor observable.

### Fase 1 — `AnswerKey` compartido + clave inline en Banco (Panel A)

**Objetivo:** que el Banco muestre la respuesta correcta de _todos_ los tipos, no solo MC/matching/V-F.

- `deriveAnswerKey` + `answerKeySchema` + tests unitarios (helper puro, sin DB).
- `AnswerKeyView` (absorbe `MatchingContentView`/`TrueFalseContentView`).
- Cablear en `ItemDetailPanel` usando el `content` ya cargado.
- Botón "Ver pauta" visible cuando hay `rubricId`, **deshabilitado/placeholder** (se activa en Fase 2).
  **Sin backend.** **Criterio de aceptación:** abrir en el banco un ítem de desarrollo /
  respuesta corta / ordenamiento / rubric_scored muestra su clave; MC/matching/V-F siguen igual.

### Fase 2 — Endpoint de rúbrica + `RubricDialog`

**Objetivo:** el botón "Ver pauta" abre la rúbrica real.

- `rubric.schema.ts` (`RubricModel`), módulo `rubrics` (`GET /rubrics/:id`), RLS verificado.
- `RubricDialog` (fetch on-demand con TanStack Query) cableado en `AnswerKeyView`.
- Funciona en Panel A (y quedará listo para Panel B en Fase 3).
  **Criterio de aceptación:** en un ítem con `rubricId`, "Ver pauta" abre un modal con criterios y
  niveles; cierra por overlay/X/Esc; un ítem sin rúbrica no muestra el botón.

### Fase 3 — Clave + distribución no-MC en Resultados (Panel B)

**Objetivo:** el panel de respuestas muestra clave y distribución también para desarrollo.

- Extender `QuestionAnalysisResponse` (`answerKey`, `scoreDistribution`) y poblarlos en
  `getQuestionAnalysis` (reusar `deriveAnswerKey` + buckets RC/RPC/RI).
- `question-detail-panel.tsx`: `AnswerKeyView` + barras de `scoreDistribution` (reusar el estilo de
  `AlternativeRow`, color por `credit`).
- Tests del service (fake DB, patrón `heatmap.service.spec.ts`): verificar `scoreDistribution` para
  un ítem de desarrollo y `answerKey` por tipo.
  **Criterio de aceptación:** una evaluación con ítems de desarrollo muestra en el panel la
  respuesta modelo / pauta y las barras Correcta/Parcial/Incorrecta con % consistente con el logro.

### Fase 4 — "Analizar con IA" inline en Panel B + generalización no-MC

**Objetivo:** botón de IA dentro del panel, útil para todos los tipos.

- Extraer `ItemInsightInline` de `ItemInsightDialog`; wrapper delgado para `/analisis-ia`.
- Montar inline al final del Panel B + botón "Analizar con IA"; prop-drilling de
  `assessmentId`/`classGroupId`/`activeRole`.
- Extender `ItemInsightSnapshot` + `item-insight.snapshot.ts` (`answerKey`, `scoreDistribution`,
  `rubricSummary`).
- Generalizar `item-insight.prompt.ts`; bump a `s2-item-insight-v3`; actualizar
  `item-insight.runner.spec.ts` / `snapshot.spec.ts`.
  **Criterio de aceptación:** desde el panel de una evaluación, "Analizar con IA" genera y muestra el
  análisis (con polling y disclaimer) para un ítem MC **y** para uno de desarrollo, con lectura
  coherente de la distribución y la pauta.

### Fase 5 — Modo pantalla completa

**Objetivo:** ver el detalle con más aire, con la IA en sección destacada.

- Extraer `QuestionDetailBody` (`layout: 'panel' | 'fullscreen'`).
- Botón "pantalla completa" en el header del sheet; `Dialog` amplio que reusa el body en layout
  expandido con la sección IA destacada.
- Aplicar al menos a Panel B; opcionalmente a Panel A.
  **Criterio de aceptación:** el botón abre un modal amplio con el mismo detalle mejor distribuido y
  la sección IA prominente; cierra por overlay/X/Esc; el sheet y el modal no desincronizan estado.

### Fase 6 (opcional) — Pulido y consistencia

- Unificar el badge "Clave correcta: X" del header con `AnswerKeyView` (evitar doble fuente).
- Revisar accesibilidad (roles ARIA de las barras, foco al abrir modales).
- QA de tipos de ítem menos comunes (`gap_fill`, `listening`, `oral_*`).

**Dependencias:** F1 → F2 (botón necesita endpoint) · F1 → F3 (Panel B reusa `AnswerKeyView`) ·
F3 → F4 (la IA reusa `answerKey`/`scoreDistribution`) · F3/F4 → F5 (fullscreen reusa el body final).
F2 y F3 pueden avanzar en paralelo tras F1.

---

## 7. Contratos de datos (resumen)

Campos **nuevos** en `QuestionAnalysisResponse`:

```ts
answerKey: AnswerKey;                              // siempre presente (kind:'none' si no hay)
scoreDistribution: ScoreCategoryDistribution[] | null;  // null en MC
```

Campos **nuevos** en `ItemInsightSnapshot` (todos opcionales, aditivos):

```ts
answerKey?: AnswerKey;
scoreDistribution?: ScoreCategoryDistribution[];
rubricSummary?: { criteria: { name: string; maxPoints: number }[] } | null;
```

Endpoint **nuevo:** `GET /api/rubrics/:id → RubricModel`.

`itemInsightOutputSchema` **no cambia**. `generateItemInsightSchema` **no cambia** (el botón del
panel usa la misma server action).

---

## 8. Consideraciones transversales (CLAUDE.md)

- **Multi-tenancy / RLS (§5.2, §11):** el endpoint de rúbrica y toda query nueva corren dentro de
  `withOrgContext`; `rubrics` debe tener política en `rls-policies.sql`. `orgId` siempre del token.
- **Taxonomía universal / no hardcode (§5.3, §8.2):** `deriveAnswerKey` ramifica por `item_type`
  (enum), no por instrumento; RC/RPC/RI ya son genéricos. Ningún literal "DIA"/"Lenguaje".
- **DRY (§4.2):** una sola definición de "clave" (`deriveAnswerKey`) para backend y front; el
  componente `AnswerKeyView` y el body del panel se comparten entre ambos paneles y el fullscreen.
- **Clean architecture (§4.3):** controllers finos; lógica en services; `deriveAnswerKey` es helper
  puro en `packages/types`; el snapshot reusa services existentes, no re-query.
- **Colección/complejidad (backend §04):** `buildScoreDistribution` en una pasada sobre `countByKey`
  (ya es un `Map`), sin `find`/spread en loop.
- **La IA propone, el humano aprueba (§8.3):** el análisis se muestra siempre con disclaimer; los
  números vienen deterministas del snapshot, la IA solo interpreta (ya es así).
- **Sin comentarios en código (regla backend 02):** el código nuevo se autodocumenta; este doc y los
  contratos Zod son la documentación.
- **Frontend (§7, reglas 02/06/07):** `Dialog`/`Sheet` de shadcn; TanStack Query para el fetch
  on-demand de la rúbrica; tokens de color (`--level-*` para las barras por crédito); el panel no
  bloquea render (los datos ya llegan por props / on-demand).

---

## 9. Testing

- **`answer-key.spec.ts`** (packages/types): `deriveAnswerKey` por cada `item_type` (incluye
  `kind:'none'` y multi_select).
- **`item-analysis.service.spec.ts`**: `answerKey` y `scoreDistribution` para MC y desarrollo (fake
  DB, patrón existente).
- **`rubrics.service.spec.ts`** / **`rubrics.controller.spec.ts`**: rúbrica del tenant, 404
  cross-tenant.
- **`item-insight.snapshot.spec.ts` / `.runner.spec.ts`**: snapshot no-MC bien formado; prompt
  ramifica sin romper el output MC.
- **Front:** smoke de `AnswerKeyView` por tipo; `RubricDialog` abre/cierra; Panel B muestra IA y
  distribución.

---

## 10. Riesgos y decisiones abiertas

1. **Taxonomía de categorías de desarrollo:** hoy son RC/RPC/RI (3 buckets). Confirmar rótulos en
   español y color por `credit` (1/0.5/0). Si a futuro hay ítems con más de un umbral parcial, el
   modelo `ScoreCategoryDistribution` ya lo admite (es una lista).
2. **Roles para `GET /rubrics/:id`:** definir la constante en `access-policies` (¿reusar
   `ITEM_VIEWER_ROLES`? ¿`RESULTS_VIEWER_ROLES`?). La rúbrica no es PII, pero sí contenido del
   instrumento.
3. **`multi_select` en `answerKey`:** decidir si el badge del header sigue mostrando `correctKey`
   (null en multi_select) o pasa a describirse vía `AnswerKeyView` (`kind:'multi_choice'`).
4. **Fullscreen y estado compartido:** el `ItemInsightInline` tiene estado de generación/polling;
   al abrir el fullscreen no debe re-disparar ni perder el análisis ya cargado. Opciones: elevar el
   estado del inline al padre del panel, o montar una sola instancia y "portarla" al modal. A
   resolver en Fase 5.
5. **Coste/latencia IA:** el análisis por-pregunta ya tiene caché por `promptVersion`; el bump a v3
   invalida y regenera. Aceptable, pero conviene comunicar el "regenerar".
6. **Panel A y fullscreen:** confirmado que el botón IA no va en el Banco; el fullscreen en el Banco
   es opcional (Fase 5) — decidir si se incluye o se pospone.
