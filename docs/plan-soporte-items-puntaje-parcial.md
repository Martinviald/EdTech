# Plan — Soporte de ítems de respuesta corta y de puntaje parcial por pauta

> Estado: propuesta de diseño, pendiente de aprobación.
> Alcance: F1. No introduce corrección con IA ni corrección manual en la plataforma.

---

## 1. Objetivo

Que la plataforma puntúe dos familias de ítems que hoy quedan sin corregir y aparecen como 0% de logro:

1. **Respuesta corta** — el alumno escribe un valor (número, fracción, secuencia) que se compara contra la clave publicada en la pauta del instrumento.
2. **Ítem evaluado por pauta** — no tiene respuesta correcta; se evalúa con un código de nivel (en DIA: Código 2 / 1 / 0) que **ya viene asignado** en la planilla de ingesta. El sistema no corrige: recibe el nivel y lo convierte en puntaje.

En ambos casos el puntaje debe incorporarse al resultado de la evaluación del alumno, a las habilidades y a la analítica de cohorte.

### Fuera de alcance

- Corrección con IA (`ai_grading_jobs`, `LlmService`) — F4 según `docs/Sprints/Planificación F1.md:231`.
- Pantalla de corrección manual dentro de la plataforma. No hace falta: el puntaje llega en la ingesta.
- Carga de las tablas `rubrics` / `rubric_criteria` / `rubric_levels`. El texto de la rúbrica es documentación para el docente, no insumo del cálculo.
- Psicometría politómica (alfa de Cronbach para ítems de crédito parcial). Ver D6.

---

## 2. Estado verificado

### 2.1 Los datos (medidos en la BDD demo, carga `dia-2026-monitoreo-intermedio`)

41 ítems únicos hoy tipados `open_ended` con respuestas cargadas:

| Familia                   | Ítems | Respuestas | `points` actual | Evidencia                                                    |
| ------------------------- | ----: | ---------: | --------------- | ------------------------------------------------------------ |
| **A · puntaje por pauta** |    25 |      1.711 | 1               | vocabulario ⊆ `{0,1,2}`, `responseFormat: develop`           |
| **B · respuesta corta**   |    16 |      1.082 | 1               | numéricos, fracciones, secuencias; `responseFormat: fill_in` |

La clave de la familia B **está publicada** en la ficha técnica oficial y nuestra extracción no la capturó (`correctKey: null`). Ejemplo textual de `7_ficha_tecnica_matematica_monitoreo_2026_7_basico.pdf`:

```
Nº pregunta   Respuesta correcta
     6              24
    12              30
    15        Preg. desarrollo
    29               2
    33        21/10 o equivalente
```

Muestra de valores reales que debe tolerar el comparador (familia B):

```
5,6 · 5.5 · 56 · 5645        0,025 · 0.025 · 0025 · 00.25
10/21 · 1/10 · 14/15         119 · 119m
0=16.5 · 2,5-2 · 1 4 · 0 4   ← indecidibles
```

Dos ítems de la familia A traen marcas dobles del escáner (`01`, `02`, `12`): 5 respuestas sobre 164, en Ciencias 6° pos. 29 e Historia 8° pos. 28.

### 2.2 El sustrato de la plataforma

| Pieza                                                                     | Estado                                                                  | Ubicación                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Contrato `ScoringStrategy` + registro `Record<ItemType, ScoringStrategy>` | ✅ Extensible por diseño                                                | `apps/api/src/answer-sheets/scoring/scoring-strategy.ts:26-89`   |
| Estrategias puras, **sin NestJS ni Drizzle**                              | ✅ Verificado: solo importan `@soe/types`                               | `apps/api/src/answer-sheets/scoring/strategies/`                 |
| `aggregateStudentResults` — % ponderado por puntaje                       | ✅                                                                      | `packages/types/src/utils/grade-calculator.ts:378-383`           |
| `aggregateSkillResults` — % ponderado por puntaje                         | ✅ (`correctCount` binario es legado documentado)                       | `grade-calculator.ts:468-484`                                    |
| `classifyDevelopmentResponse` — puntaje → `RC`/`RPC`/`RI`                 | ✅ Ya representa parciales sin alternativas                             | `packages/types/src/utils/item-stats-calculator.ts:128-136`      |
| `responses.raw_score` / `final_score` / `scored_by`                       | ✅ Contrato §8.3 completo                                               | `packages/db/src/schema/responses.ts:17-54`                      |
| Precedente de crédito parcial en producción                               | ✅ `matching` (`partialCredit`) y `multi_select` (`requireExact:false`) | `matching.strategy.ts:101-109`, `multi-select.strategy.ts:74-85` |

### 2.3 Lo que está roto hoy (y este trabajo debe arreglar)

| #   | Defecto                                                                                                                     | Ubicación                                                                                                                                                | Severidad  |
| --- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R1  | `aggregateItemStats` cuenta un ítem **pendiente** (`isCorrect === null`) como incorrecto: suma a `maxSum` y no a `scoreSum` | `item-stats-calculator.ts:239-245`                                                                                                                       | Bloqueante |
| R2  | El % de logro por pregunta se calcula `correctCount / responseCount` (binario) en 5 sitios                                  | `item-analysis.service.ts:666-680`, `:496-499`, `:849-863`, `:699-700`; `assessment-report.service.ts:648-649`                                           | Crítico    |
| R3  | KR-20 / alfa / punto-biserial / discriminación se construyen sobre matriz booleana                                          | `instrument-quality.service.ts:272-292`; `ai-analysis.snapshot.ts:295-322`; `item-insight.snapshot.ts:291-317`; `assessment-report.service.ts:1245-1259` | Crítico    |
| R4  | El frontend usa **dos predicados contradictorios** para el mismo parcial: `isCorrect === false` vs `isCorrect === null`     | `cross-table.tsx:86` vs `student-report.tsx:208`                                                                                                         | Alto       |
| R5  | El motor remedial asigna `gap = 100` a todo ítem parcial → acapara el material                                              | `failed-stimulus.service.ts:82-103`                                                                                                                      | Medio      |

R4 y R5 **ya afectan a producción** con `matching` parcial, sin ítems nuevos.

### 2.4 Deuda que este trabajo pisa y debe pagar

| #   | Deuda                                                                                                            | Ubicación                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| T1  | `ITEM_TYPES` redeclarado localmente **sin `multi_select`** → la API rechaza ese tipo                             | `apps/api/src/items/dto/item.dto.ts:11-22`                  |
| T2  | El seed de ingesta DIA tiene un `scoreAnswer()` paralelo que no usa el registro y no cubre `ordering`/`gap_fill` | `packages/db/src/seed/import-dia-2026-responses.ts:238-249` |

---

## 3. Principio rector

> **El puntaje es el dato; `is_correct` es una vista binaria de ese dato.**

Todo el diseño se deriva de ahí. Donde hoy el sistema cuenta aciertos, debe sumar puntaje. `is_correct` se conserva —es el vocabulario de la UI y de la psicometría— pero deja de ser la fuente del % de logro.

---

## 4. Decisiones de diseño

### D1 — `is_correct` significa "obtuvo el puntaje máximo", y nunca es `null` en un ítem corregido

`is_correct` carga hoy tres roles: compuerta de "está corregido" (`!== null`), numerador de conteos (`=== true`) y discriminador de bucket. Un ítem de pauta **no tiene respuesta correcta**, y la tentación es marcarlo `null`.

**Sería un error grave.** `aggregateStudentResults:378` filtra `isCorrect !== null` para armar numerador y denominador: un ítem con `null` **desaparece del % del alumno** aunque tenga puntaje, y deja el resultado marcado incompleto para siempre.

Decisión:

| Situación                                   | `is_correct` | `raw_score`                 |
| ------------------------------------------- | ------------ | --------------------------- |
| Nivel máximo de la pauta (Código 2)         | `true`       | `maxScore`                  |
| Nivel intermedio (Código 1)                 | `false`      | `creditFraction × maxScore` |
| Nivel mínimo (Código 0)                     | `false`      | `0`                         |
| Código no declarado / respuesta indecidible | `null`       | `null`                      |

Es exactamente la convención que ya usan `matching` y `multi_select` (`isCorrect: allCorrect`). **Una sola semántica en toda la plataforma**, no dos (DRY).

### D2 — El crédito parcial ya está persistido: no se agrega ninguna columna

`assessment_item_stats` ya guarda `score_sum` y `max_sum` junto a `correct_count`. El crédito de una respuesta es `effectiveScore / maxScore`, derivable. **No se crea un campo `credit`.**

Propiedad clave que hace segura la migración de R2:

> Para un ítem dicotómico, `scoreSum / maxSum ≡ correctCount / responseCount` (el puntaje solo vale 0 o máximo). El cambio de fórmula **no altera ningún número existente**; solo deja de mentir en los parciales.

_Diferido con criterio (YAGNI):_ `AnswerCount` no lleva `credit`, así que no se puede responder "¿cuánto puntúa quien marcó B?". Solo importa en ítems **con alternativas y crédito parcial** (`multi_select` con `requireExact:false`), que este trabajo no introduce. El vocabulario para resolverlo ya existe en `official-report-import/lib/report-to-item-stats.ts:92-100` (`bucketCredit`) y se promoverá cuando haga falta.

### D3 — Dos `ItemType` nuevos

Se agregan al enum en lugar de reutilizar `gap_fill` (que exige `textWithGaps` y cuyo pipeline colapsa la respuesta a un escalar que la estrategia no matchea) o de meter un flag en `scoring_config`. Es el mecanismo de extensión que fija CLAUDE.md §4.1: _"agregar un nuevo tipo de ítem no requiere una nueva tabla, solo un nuevo valor en `item_type` enum"_.

**`short_answer`** — respuesta escrita comparable contra una clave.

```ts
export const shortAnswerContentSchema = z.object({
  prompt: z.string().min(1),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  comparison: z.enum(['numeric', 'text']).optional(),
  unit: z.string().min(1).optional(),
  caseSensitive: z.boolean().optional(),
  ...baseContent,
});
```

`comparison` omitido se deriva: si **todas** las `acceptedAnswers` parsean como número o fracción → `numeric`, si no → `text`. `unit` declara un sufijo tolerado (`"149 m"` con `unit: "m"`); nunca se remueven unidades no declaradas.

**`rubric_scored`** — ítem evaluado por pauta, con el nivel ingresado.

```ts
export const rubricScoredContentSchema = z.object({
  prompt: z.string().min(1),
  levels: z
    .array(
      z.object({
        code: z.string().min(1),
        label: z.string().optional(),
        descriptor: z.string().optional(),
        creditFraction: z.number().min(0).max(1),
      }),
    )
    .min(2),
  rubricId: z.string().uuid().optional(),
  ...baseContent,
});
```

`creditFraction` (0..1) y no un puntaje absoluto: compone con `maxScore` (que viene de `scoring_config.points`), así cambiar el peso del ítem no obliga a reescribir la pauta. **Nada de 0/1/2 queda en el código** — DIA se expresa como datos:

```json
{
  "levels": [
    { "code": "0", "label": "Incorrecta", "creditFraction": 0 },
    { "code": "1", "label": "Parcialmente correcta", "creditFraction": 0.5 },
    { "code": "2", "label": "Correcta", "creditFraction": 1 }
  ]
}
```

Un colegio con una pauta de 4 niveles o pesos no lineales solo declara otros `levels`. El nombre `rubric_scored` describe **el ítem**, no el canal de ingesta: cuando exista corrección en pantalla, el mismo tipo sirve sin cambios (Open/Closed).

Ambos entran en `ITEM_CONTENT_SCHEMAS` y `AUTO_SCORABLE_ITEM_TYPES` (`item-content.schema.ts:224-281`).

> `rubric_scored` es auto-scorable en el sentido del registro: su puntaje se **deriva determinísticamente** del dato ingresado. No requiere juicio humano en la plataforma.

### D4 — Dos estrategias en el registro existente

Implementan el contrato `ScoringStrategy` sin tocarlo.

**`shortAnswerStrategy`**

| Entrada                                               | Salida                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| Coincide con alguna `acceptedAnswers` tras normalizar | `isCorrect: true`, `rawScore: maxScore`          |
| No coincide                                           | `isCorrect: false`, `rawScore: 0`                |
| Vacía / sin marca                                     | `isCorrect: false`, `rawScore: 0`                |
| **Indecidible** (D5)                                 | `isCorrect: null`, `requiresManualGrading: true` |

**`rubricScoredStrategy`**

| Entrada                                           | Salida                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Código declarado en `levels`                      | `rawScore: creditFraction × maxScore`, `isCorrect: creditFraction >= 1` |
| Código **no declarado** (`01`, `12`, texto libre) | `isCorrect: null`, `requiresManualGrading: true`                        |
| Vacía / sin marca                                 | `isCorrect: null`, `requiresManualGrading: true`                        |

Un nivel no declarado **nunca** se interpreta como 0: una marca doble no es un cero, es una lectura fallida. Regla general del diseño: _el sistema no adivina, y no castiga al alumno por una ambigüedad que no creó._

### D5 — Comparador tolerante como helper puro

Vive en `packages/types/src/utils/short-answer.ts`, junto a sus pares `multi-select.ts` y `true-false.ts`, por el mismo motivo documentado ahí: la corrección y el análisis por ítem deben interpretar la respuesta **igual**, o el % de logro y la distribución de la misma pregunta se contradicen.

```ts
export type ShortAnswerMatch = 'match' | 'mismatch' | 'undecidable';
export function matchesAcceptedAnswer(
  raw: unknown,
  accepted: readonly string[],
  options?: { comparison?: 'numeric' | 'text'; unit?: string; caseSensitive?: boolean },
): ShortAnswerMatch;
```

| Se tolera                                       | Se marca incorrecto               | Se marca indecidible                |
| ----------------------------------------------- | --------------------------------- | ----------------------------------- |
| Espacios al inicio/fin e internos               | `56` cuando la clave es `5,6`     | `0=16.5` (dos valores unidos)       |
| `5,6` ≡ `5.6` (separador decimal)               | `1112` cuando la clave es `11,5`  | `2,5-2`                             |
| `21/10` ≡ `2,1` ≡ `2.1` (equivalencia racional) | `1/10` cuando la clave es `21/10` | `1 4` · `0 4` (dos números sueltos) |
| `119m` ≡ `119` **solo si** `unit: "m"`          |                                   |                                     |
| Mayúsculas/minúsculas en modo texto             |                                   |                                     |

Criterios explícitos, con su razón:

- **No se inventa el separador decimal.** `0025` se parsea como el entero 25, no como `0,025`. Suponer que el escáner perdió una coma es exactamente "dar espacio a errores básicos".
- **Comparación numérica racional**, no de punto flotante: `21/10` y `2.1` se comparan como fracciones para evitar el error de representación binaria.
- **Indecidible ≠ incorrecto.** Un valor con más de un número candidato no permite saber qué respondió el alumno.

### D6 — Un solo predicado para excluir de la psicometría

KR-20 y el punto-biserial están **definidos** para ítems dicotómicos. Incluir parciales sesga la varianza en silencio. Se excluyen, y se declara.

```ts
// packages/types/src/utils/item-scoring.ts
export function isDichotomousItem(type: ItemType, scoringConfig?: ScoringConfig): boolean;
```

Devuelve `false` para `rubric_scored`, para `matching` con `partialCredit: true` y para `multi_select` con `requireExact: false`. Un tipo politómico futuro solo tiene que responder a este predicado — **no se hardcodea ninguna lista de tipos en los consumidores** (Open/Closed).

Los 4 consumidores de R3 filtran por él y reportan la exclusión. El resultado debe declararla en la UI:

> _"Alfa calculado sobre 34 de 38 ítems. Se excluyeron 4 de puntaje parcial."_

Sin ese texto el número miente por omisión. La versión politómica queda como trabajo aparte, identificado.

### D7 — El registro de scoring se mueve a `packages/types`

Hoy vive en `apps/api/src/answer-sheets/scoring/`. El seed de ingesta (`packages/db`) **no puede importarlo** —la dependencia va en sentido contrario— y por eso tiene una copia paralela (T2) que ya diverge: no cubre `ordering` ni `gap_fill`.

Las estrategias son funciones puras: verificado que no importan NestJS, Drizzle ni `@soe/db`; solo `@soe/types` y sus propios helpers. Mover `scoring/` a `packages/types/src/scoring/` y exportarlo desde el índice es la resolución correcta según CLAUDE.md §3 (_"si algo puede ir en `packages/`, va en `packages/`"_) y §4.2.

Efecto: `AnswerSheetsService` y el seed consumen **el mismo registro**, y las estrategias nuevas quedan disponibles para ambos sin duplicar nada. Solo hay 2 consumidores no-test, así que el movimiento está contenido.

### D8 — Un solo predicado de presentación en el frontend

`cross-table.tsx:86` detecta el parcial con `isCorrect === false`; `student-report.tsx:208` con `isCorrect === null`. Hoy un `matching` parcial se ve **ámbar `3/4` en la matriz y rojo `✗` en el informe del mismo alumno** (R4).

```ts
// packages/types/src/utils/response-display.ts
export type ResponseOutcome = 'correct' | 'partial' | 'incorrect' | 'ungraded' | 'unanswered';
export function responseOutcome(r: {
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number | null;
  hasAnswer: boolean;
}): ResponseOutcome;
```

Ambos componentes lo consumen. Correcciones que arrastra: el orden de la matriz (`cross-table.tsx:121`, hoy un `0.9/1` ordena igual que un `0/1`) y el tooltip que dice _"(incorrecta)"_ sobre una celda ámbar (`:640`).

Para `rubric_scored` la celda muestra la etiqueta del nivel (`Parcialmente correcta`), no `✓`/`✗`.

### D9 — `aggregateItemStats` deja de contar los pendientes como incorrectos

```ts
// item-stats-calculator.ts — comportamiento objetivo
const graded = r.isCorrect !== null;
if (r.isCorrect === true) cell.correctCount += 1;
if (graded) {
  cell.scoreSum += effectiveScore(r);
  cell.maxSum += r.maxScore;
}
```

Misma semántica que ya aplican `aggregateStudentResults` y `aggregateSkillResults`, y que sus comentarios documentan como intencional. Hoy el read-model es el único de los tres que diverge.

`responseCount` sigue contando todas las respuestas (es "cuántos respondieron"). El número de corregidos es derivable como `maxSum / maxScore`.

### D10 — El % de logro por pregunta pasa a ponderarse por puntaje

Los 5 sitios de R2 sustituyen `correctCount / responseCount` por `scoreSum / maxSum`. Por D2 el cambio es **idéntico en todo ítem dicotómico**, así que no hay riesgo de regresión ni necesidad de recálculo histórico.

`correctCount` se conserva: sigue siendo el dato correcto para "cuántos lo respondieron bien del todo" y para la psicometría dicotómica.

---

## 5. Cambios por capa

### `packages/types`

| Archivo                              | Cambio                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `src/enums.ts`                       | `ITEM_TYPES` + `ITEM_TYPE_LABELS`: `short_answer`, `rubric_scored`              |
| `src/schemas/item-content.schema.ts` | 2 schemas nuevos, alta en `ITEM_CONTENT_SCHEMAS` y `AUTO_SCORABLE_ITEM_TYPES`   |
| `src/scoring/`                       | **nuevo** — registro y estrategias movidos desde `apps/api` (D7) + las 2 nuevas |
| `src/utils/short-answer.ts`          | **nuevo** — comparador tolerante (D5)                                           |
| `src/utils/item-scoring.ts`          | **nuevo** — `isDichotomousItem` (D6)                                            |
| `src/utils/response-display.ts`      | **nuevo** — `responseOutcome` (D8)                                              |
| `src/utils/item-stats-calculator.ts` | D9                                                                              |

### `packages/db`

| Archivo                                  | Cambio                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| `src/schema/enums.ts`                    | `itemTypeEnum` + los 2 valores (espejo de `packages/types`)   |
| `drizzle/migrations/`                    | `ALTER TYPE item_type ADD VALUE` ×2                           |
| `src/seed/import-dia-2026-responses.ts`  | Elimina el `scoreAnswer()` paralelo; consume el registro (T2) |
| `src/scripts/retype-open-ended-items.ts` | **nuevo** — re-tipificación in-place (§6.2)                   |

### `apps/api`

| Archivo                                              | Cambio                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `src/answer-sheets/scoring/`                         | Se elimina; los imports apuntan a `@soe/types` (D7)              |
| `src/items/dto/item.dto.ts`                          | Importa `ITEM_TYPES` de `@soe/types` en vez de redeclararlo (T1) |
| `src/item-analysis/item-analysis.service.ts`         | D10 en 4 sitios                                                  |
| `src/assessment-report/assessment-report.service.ts` | D10 en 1 sitio                                                   |
| `src/instrument-quality/`, `src/ai-analysis/`        | Filtro `isDichotomousItem` + reporte de exclusión (D6)           |
| `src/remedial/stimulus/failed-stimulus.service.ts`   | `gap` por puntaje, no por acierto binario (R5)                   |

### `apps/web`

| Archivo                                          | Cambio                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| `resultados/detalle/cross-table.tsx`             | Consume `responseOutcome`; corrige orden y tooltip (D8) |
| `components/official-reports/student-report.tsx` | Consume `responseOutcome` (D8)                          |
| `banco-contenido/.../ItemDetailPanel.tsx`        | Render de los 2 tipos nuevos                            |
| Vista de calidad de instrumento                  | Muestra la nota de exclusión psicométrica (D6)          |

---

## 6. Datos: migración, re-extracción y re-tipificación

### 6.1 Migración del enum

PostgreSQL 17.9. `ALTER TYPE ... ADD VALUE` admite ejecutarse dentro de transacción, **pero el valor nuevo no puede usarse en la misma transacción**. La migración del enum y cualquier backfill que lo utilice van en pasos separados.

Sin tablas nuevas ⇒ sin cambios en `packages/db/sql/rls-policies.sql`.

### 6.2 Re-extracción y re-tipificación

**No se re-importan los instrumentos.** Un `import-instruments` borra y recrea ítems, lo que regenera sus UUID y orfana/borra en cascada los `item_taxonomy_tags` y las `responses` ya cargadas. Se actualiza **in place**, con el precedente de `packages/db/src/scripts/retype-matching-truefalse-items.ts` (match por `instruments.config->>'sourceJson'` + `position`).

1. **Extractor de ficha técnica** — capturar de la tabla "Respuestas correctas" las entradas que no son letra (`24`, `30`, `21/10 o equivalente`) como `acceptedAnswers`, separando las variantes de _"o equivalente"_. Marcar como `rubric_scored` las filas `Preg. desarrollo`.
2. **Script de re-tipificación** — `open_ended` → `short_answer` o `rubric_scored`, poblando `content` según D3.
3. **Recarga de respuestas** — el importador es idempotente por `config.loadKey`: borra y reinserta sin duplicar.
4. **Backfill del read-model** — `db:backfill:cohort-stats` para que la analítica agregada recoja los puntajes nuevos.

### 6.3 Salvaguarda ya implementada

El importador valida que las posiciones de la planilla coincidan **exactamente** con las del instrumento y falla duro si no. Esa validación nació de un desalineamiento real (planillas con columnas `P19.1…P19.5` que corrían todo lo posterior); no debe relajarse.

---

## 7. Fases entregables

Cada fase entrega valor por sí sola y es desplegable de forma independiente.

### Fase 0 — Fundaciones, sin cambio de comportamiento

D7 (mover el registro), T1 (DTO duplicado), T2 (colapsar el scorer paralelo). Los tests existentes de `scoring-strategy.spec.ts` deben pasar sin modificación: es el criterio de que el movimiento fue neutro.

### Fase 1 — Crédito parcial correcto en la lectura

D9, D10, D8, D6 y R5. **No depende de los tipos nuevos**: arregla los parciales que `matching` y `multi_select` ya producen hoy en producción, y elimina el 0% falso de todo ítem pendiente. Valor inmediato antes de tocar el modelo.

### Fase 2 — Los dos tipos nuevos

D3, D4, D5 y la migración del enum. Con tests, sin datos migrados todavía.

### Fase 3 — Datos

§6.2 completo: re-extracción, re-tipificación, recarga y backfill.

---

## 8. Tests y criterios de aceptación

### Unitarios

- **Comparador (D5):** tabla de casos con los valores reales observados, incluidos los tres indecidibles.
- **`rubricScoredStrategy`:** cada nivel declarado; código no declarado → pendiente; pauta de 4 niveles no lineales (prueba de que no hay 0/1/2 hardcodeado).
- **`isDichotomousItem`:** los 11 tipos × combinaciones de `scoringConfig`.
- **`responseOutcome`:** los 5 estados.
- **Agregadores:** un parcial suma al % del alumno y de la habilidad; un pendiente no entra al numerador ni al denominador en ninguno de los tres.

### Regresión (la más importante)

> Sobre un instrumento **100% dicotómico y sin pendientes**, `scoreSum/maxSum` produce exactamente los mismos números que `correctCount/responseCount`.

Es la prueba de que D10 no altera nada existente.

### Criterios de aceptación, medidos sobre los 41 ítems reales

Línea base medida el 2026-08-04 sobre la carga `dia-2026-monitoreo-intermedio` (30 evaluaciones, 1.184 resultados de alumno).

| Métrica                                                                          |   Línea base | Objetivo                         |
| -------------------------------------------------------------------------------- | -----------: | -------------------------------- |
| Filas de `assessment_item_stats` en 0% **por estar sin corregir** (`open_ended`) |           73 | 0                                |
| Filas en 0% por mérito propio (nadie acertó: `matching`/`multi_select`)          |            7 | se conservan — no son un defecto |
| Respuestas sin corregir (`is_correct is null`)                                   |        3.035 | ≤ 60 (solo indecidibles reales)  |
| Ítems de la familia A con distribución `RC`/`RPC`/`RI` visible                   |            0 | 25                               |
| Ítems de la familia B con % de logro calculado                                   |            0 | 16                               |
| Alumnos con `is_complete = true`                                                 | 174 de 1.184 | > 1.100                          |
| Instrumentos con parciales que declaran la exclusión psicométrica                |            0 | 100%                             |

---

## 9. Riesgos y deuda diferida

| Riesgo                                                           | Mitigación                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D7 mueve código compartido                                       | Solo 2 consumidores no-test; los tests existentes son la red                                                                                            |
| La re-extracción puede introducir claves erróneas                | Validación cruzada: el % de logro resultante debe caer en un rango plausible y la dispersión de dificultad por ítem no debe aplastarse en torno al azar |
| `ALTER TYPE` es irreversible en la práctica                      | Los valores nuevos son aditivos; no se elimina ninguno                                                                                                  |
| Un `rubric_scored` mal declarado deja todo pendiente en silencio | El importador reporta pendientes por ítem en cada corrida; el dry-run los expone antes de escribir                                                      |

**Deuda explícitamente diferida, con su condición de activación:**

- `credit` por bucket en `AnswerCount` → cuando exista un ítem **con alternativas** y crédito parcial.
- `skill_results.correctCount` binario conviviendo con `percentage` ponderado → hoy inconsistente pero documentado; migrarlo exige tocar columnas `integer` y sus consumidores.
- Psicometría politómica (alfa de Cronbach) → cuando los ítems de crédito parcial dejen de ser marginales.
- Carga de `rubrics` / `rubric_criteria` / `rubric_levels` → cuando se construya corrección en pantalla o con IA.
