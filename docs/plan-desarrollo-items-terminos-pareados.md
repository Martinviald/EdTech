# Plan de desarrollo — soporte end-to-end de ítems de términos pareados (`matching`)

> **Insumo:** `docs/plan-items-terminos-pareados.md` (levantamiento del 2026-08-02).
> Este documento es el **plan de ejecución**: decisiones cerradas, diseño del contrato y orden de
> trabajo. Rama: `feat/items-terminos-pareados` (worktree desde `origin/dev`).
>
> **Principio rector:** `matching` es una **abstracción de dominio**, no una transcripción del
> formato DIA. DIA es *un* consumidor del tipo. Todo lo específico de DIA (dos columnas rotuladas
> `A.n`/`B.n`, 4 pares, 1 punto por par, distractores en un lado) vive en el **adaptador de carga**
> y en los **datos**, nunca en el schema, en la estrategia de corrección ni en el render.

---

## 1. Decisiones cerradas

| # | Decisión | Elegido |
|---|---|---|
| D1 (§4 del insumo) | Modelo de puntaje | **(a)** un ítem `matching` con crédito parcial. 1 ítem impreso = 1 fila en `items` = 1 fila en `responses`. |
| D2 (§5 del insumo) | Dirección de `correctPairs` | **`leftItems` = lado que se responde** (una entrada de `correctPairs` por sub-pregunta, `leftId` único). `rightItems` = banco de opciones. |
| D3 (§7 del insumo) | Hueco de `true_false` en el importador | **Se cierra en el mismo trabajo**, mismo archivo, misma clase de hueco. |
| D4 (nueva, por la restricción de generalidad) | Puntaje por par, cardinalidad y tamaño de columnas | **Todo configurable en datos**, con defaults que reproducen el caso DIA. Ver §2.2 y §2.3. |

### Qué significa D2 concretamente

`leftItems` es el **lado respondible**: el conjunto de elementos que el alumno debe resolver, uno
por uno. `rightItems` es el **banco de opciones** del que elige. Los distractores son, por
definición, elementos de `rightItems` que no aparecen en ningún `correctPairs`. Esto es una
invariante del tipo, no una convención de DIA:

- **Ciencias 8° ítem 7** (distractores en la columna A del impreso) → `leftItems` = B.1..B.4,
  `rightItems` = A.1..A.6. Se invierte respecto del rótulo impreso; el rótulo se preserva en el
  campo `label` de cada elemento (§2.1) para no perder la traza al PDF.
- **Historia 6° ítem 16** (distractores en la columna B del impreso) → `leftItems` = las 3 fotos,
  `rightItems` = las 4 regiones. Acá **no** se invierte.

El adaptador decide qué lado es el respondible; el schema no necesita saber de qué documento vino.

---

## 2. Diseño del contrato (`packages/types`)

### 2.1 `matchingContentSchema` — extensión aditiva

El schema actual sirve de base pero es demasiado pobre para ser una abstracción: no permite
figuras por elemento (los `rightItems` de Ciencias 8° **son imágenes**, verificado en el JSON de
extracción: `"isImage": true`), no preserva el rótulo impreso, y su `.min(2)` en ambas columnas
prohíbe casos legítimos.

```ts
const matchingElementSchema = z.object({
  id: z.string().min(1),
  /** Texto del elemento, o su descripción cuando el contenido real es una figura. */
  text: z.string().min(1),
  /** Rótulo impreso en el documento original ("A.3", "1", "a"). Sólo trazabilidad. */
  label: z.string().optional(),
  /** El contenido real es una imagen; `text` es su descripción textual. */
  isImage: z.boolean().optional(),
});

export const matchingContentSchema = z.object({
  prompt: z.string().min(1).optional(),
  /** Lado RESPONDIBLE: cada elemento recibe exactamente una respuesta del alumno. */
  leftItems: z.array(matchingElementSchema).min(1),
  /** Banco de opciones. Puede tener distractores (elementos sin par correcto). */
  rightItems: z.array(matchingElementSchema).min(2),
  /** Una entrada por elemento de `leftItems`. `leftId` es único; `rightId` puede repetirse. */
  correctPairs: z.array(z.object({ leftId: z.string(), rightId: z.string() })).min(1),
  ...baseContent,
});
```

Cambios y por qué:

- `leftItems` baja a `.min(1)`: un pareado de un solo elemento es degenerado pero válido, y
  prohibirlo no protege de nada.
- `label` e `isImage` por elemento: sin esto, la abstracción no puede representar el caso real que
  ya tenemos en mano ni renderizarlo.
- **`rightId` puede repetirse** (varios elementos respondibles apuntan a la misma opción): habilita
  pareados de clasificación (N ítems → 3 categorías) sin tocar nada más. `leftId` **debe** ser
  único — es lo que hace determinística la corrección.
- El `imageRef` de S3 **no va en `content`** (Zod strippea claves desconocidas y `imageUrl` exige
  URL absoluta). Se sigue la convención ya establecida en el repo: va en `scoringConfig`, como
  `altImageRefs`. Análogo nuevo: `matchImageRefs: { "B.1": "<storage key>", … }`.

**Validaciones que Zod no expresa y van en un refinamiento** (`.superRefine`), porque un dato
inconsistente acá corrige mal sin fallar nunca:

1. todo `leftId` de `correctPairs` existe en `leftItems`; todo `rightId` existe en `rightItems`;
2. `leftId` no se repite en `correctPairs`;
3. `correctPairs.length === leftItems.length` (todo elemento respondible tiene clave).

### 2.2 Configuración de puntaje — `scoringConfig.matching`

El puntaje **no se hardcodea**. Se declara un sub-objeto tipado en `packages/types` (hoy
`scoringConfig` se lee sin schema, con un cast a `{ points?: number }` en
`answer-sheets.service.ts:636`):

```ts
export const matchingScoringSchema = z.object({
  /** Puntos por par correcto. Si se omite, se deriva de `points / correctPairs.length`. */
  pointsPerPair: z.number().nonnegative().optional(),
  /** Descuento por par incorrecto. Default 0 (sin penalización). */
  penaltyPerIncorrectPair: z.number().nonnegative().default(0),
});
```

Combinado con los campos que `scoringConfig` **ya** tiene (`points`, `partialCredit`), esto cubre
el espacio de políticas sin una rama por instrumento:

| Política | Config | Resultado |
|---|---|---|
| DIA (1 punto por par, 4 pares) | `points: 4, partialCredit: true` | `rawScore = nº correctos` |
| Todo-o-nada (comportamiento actual) | `points: 1, partialCredit: false` | `rawScore ∈ {0, 1}` |
| Par ponderado (2 pts c/u) | `points: 8, partialCredit: true, matching: { pointsPerPair: 2 }` | `rawScore = 2 × correctos` |
| Con penalización | `… matching: { penaltyPerIncorrectPair: 0.5 }` | `rawScore = correctos − 0.5 × incorrectos`, con piso en 0 |

### 2.3 Estrategia de corrección — reescritura de `matching.strategy.ts`

Contrato nuevo, sin ninguna referencia a DIA:

```
correctos   = nº de leftId cuya respuesta del alumno coincide con correctPairs
incorrectos = nº de leftId respondidos con un valor distinto al correcto
              (los no respondidos NO penalizan)

si !partialCredit → rawScore = (correctos === correctPairs.length) ? points : 0
si  partialCredit → rawScore = clamp(pointsPerPair × correctos
                                     − penaltyPerIncorrectPair × incorrectos, 0, points)

isCorrect = (rawScore === maxScore)
```

Notas de diseño:

- `pointsPerPair` por defecto = `points / correctPairs.length`, así un ítem sin config explícita se
  comporta correctamente y el llamador no tiene que saber cuántos pares hay.
- **`isCorrect` se mantiene booleano** (no `null`): `matching` sigue siendo auto-scorable. Un
  parcial es `isCorrect: false` con `rawScore > 0`. Esto importa porque
  `aggregateSkillResults` (`packages/types/src/utils/grade-calculator.ts:469`) lleva **dos**
  métricas: `correctCount` (cuenta `isCorrect === true`) y el `%` ponderado por `maxScore`. El `%`
  —la métrica que se muestra— ya sale bien; `correctCount` cuenta el ítem parcial como no logrado.
  Es la semántica correcta ("¿logró el ítem completo?") y se documenta, no se cambia.
- `parseStudentPairs()` ya acepta record y array; se mantienen ambas formas y se agrega la
  **tolerancia a respuestas parciales**: hoy `if (studentPairs.size !== correctPairs.length) return
  incorrect;` descarta al alumno que dejó un par en blanco. Con crédito parcial eso es un bug.
- Se preserva **regresión cero** para el resto: sin `partialCredit`, el output es idéntico al de
  hoy. Los tests actuales de `scoring-strategy.spec.ts` (que asumen todo-o-nada) siguen pasando si
  se les fija `partialCredit: false`; se agregan casos nuevos para el resto de la matriz.

---

## 3. Camino de carga (importador)

### 3.1 Rama `matching` en `buildContent()` — genérica, con adaptador DIA

`packages/db/src/seed/import-instruments.ts` recibe un JSON de instrumento. Hoy `buildContent()`
tiene una rama MCQ y un `return { prompt: it.stem }` que se traga todo lo demás. Se agrega:

- **`buildContent` genérico**: si el JSON del ítem trae un bloque de pareado ya normalizado
  (`matchPairs` + las dos columnas), lo mapea 1:1 al `content` de §2.1. La función no sabe de
  "columna A" ni de DIA — trabaja con `answerableSide` / `optionsSide`.
- **Adaptador DIA** (función aparte, misma carpeta): traduce el shape del pipeline de extracción
  (`matchColumns: {A:[…], B:[…]}` + `matchPairs: [{left:"A.3", right:"B.1"}]`) a ese shape
  genérico, decidiendo el lado respondible como *"el lado que aparece exactamente una vez por par"*.
  Esa regla resuelve sola tanto Ciencias 8° (respondible = B) como Historia 6° (respondible = A)
  sin una tabla de excepciones por instrumento.
- **`points` desde el JSON**: hoy el importador fija `points: 1` para todos los ítems
  (`import-instruments.ts:255`). Pasa a leer el puntaje del JSON del ítem, con `1` de fallback. Para
  un `matching` sin puntaje declarado, el default es `correctPairs.length` (un punto por par), que
  es la convención de la Agencia y también el default razonable en general.
- **Rama `true_false`** (D3): `{ correctAnswer: boolean }` derivado de la alternativa correcta.

⚠️ **Verificado en los datos, hay que manejarlo:** los elementos de la columna de imágenes traen
`isImage: true` y su `text` es una descripción. El mapeo debe propagar `isImage` y, si el pipeline
entregó recortes, poblar `matchImageRefs` en `scoringConfig` (§2.1).

### 3.2 Migración de los 4 ítems ya cargados o en carga

`UPDATE` in-place, **nunca re-import** (`import-instruments` borra y recrea: regenera UUIDs y
arrastra `item_taxonomy_tags` por `ON DELETE CASCADE`).

Script idempotente en `packages/db/src/seed/`, que por cada ítem: matchea el instrumento por
`instruments.config->>'sourceJson'`, ubica el ítem, y escribe `type`, `content` y `scoringConfig`
en una sola transacción, validando el `content` con `validateItemContent()` **antes** del `UPDATE`.

⚠️ **Trampa verificada:** `position` ≠ número impreso. El ítem "28" de Ciencias 8° es
`position: 39` en el JSON de extracción. El match debe hacerse por el campo que efectivamente se
cargó en `items.position`, contrastado contra `printedNumber`, y el script debe **fallar ruidoso**
si no encuentra exactamente un ítem por cada target — no seguir de largo.

⚠️ **Bloqueante a verificar antes del paso 4:** el `.ficha.json` de **Historia 5°** en disco **no
contiene `matchPairs`** (sí lo tienen Ciencias 8° e Historia 6°). El insumo afirma que "el parser de
fichas ya lo produce bien", así que probablemente falta re-correr `parse_ficha.py` sobre esa ficha.
Hay que confirmarlo antes de migrar ese ítem; si no, su clave cruda `"(1,5)-(2,4)-(3,1)-(4,2)"`
guardada como texto es la única fuente y hay que parsearla en el script de migración.

---

## 4. Ingesta de respuestas — resolver la sub-numeración **de forma general**

Este es el trabajo con más riesgo y el que más se beneficia de no hardcodear DIA.

### 4.1 El bug que hay hoy

`questionColumnToPosition()` (`apps/api/src/answer-sheets/lib/parsers/parser.types.ts`) toma el
**primer grupo de dígitos** de la columna:

```
"7B1" → "7"    "7B2" → "7"    "9.1" → "9"    "19.5" → "19"
```

Las 4 sub-respuestas de un pareado colapsan en la misma clave del record `answers` y **gana la
última en silencio**. No es exclusivo de pareados: ya pasa con la sub-numeración de Historia 5°
(`9.1..9.4`) e Historia 7° (`19.1..19.5`). Se arregla una vez, para todos.

### 4.2 Diseño

1. **Ampliar el contrato del parser.** `ParsedAnswerSheetRow.answers` pasa de
   `Record<string, string | null>` a `Record<string, AnswerValue>`, donde
   `AnswerValue = string | null | Record<string, string | null>` (la forma de pares). Toca los 4
   parsers, el preview store y el service; los 3 parsers no-pareados no cambian de comportamiento.
2. **Parsear la columna a `{ position, subKey }`** en vez de sólo `position`: `"7B1"` →
   `{ position: 7, subKey: "B1" }`, `"9.1"` → `{ position: 9, subKey: "1" }`, `"12"` →
   `{ position: 12, subKey: null }`. Una sola función, agnóstica del proveedor y del instrumento.
3. **Agregación por tipo de ítem**, no por regex de etiqueta: el service ya conoce
   `item.type` de cada `position` (`loadInstrumentItems`). Si un `position` recibió sub-respuestas:
   - `type === 'matching'` → se ensamblan en un record de pares. El `subKey` se resuelve contra los
     **`label`/`id` de `leftItems`** (por eso §2.1 preserva `label`), con fallback a orden posicional.
     Gracias a D2 el valor escaneado (`"A.4"`) **ya es** el `rightId`: entra sin invertir.
   - cualquier otro tipo → se concatenan o se toma la primera no vacía, con un warning explícito en
     el preview. Hoy se pierden en silencio; que quede visible ya es una mejora.
4. **La validación de conteo cuenta `position`es distintas**, no columnas del archivo. Es lo que
   arregla el desajuste "Historia 5° tiene 25 ítems y el scan trae 27 preguntas".
5. El **preview** muestra el ítem pareado como una fila con sus n sub-respuestas, no como n filas.

Nada de este diseño menciona GradeCam ni DIA: es "un archivo de escaneo puede traer sub-columnas
para un ítem compuesto". GradeCam es el primer proveedor que lo ejercita.

---

## 5. Renderizado

- **`ItemDetailPanel.tsx`** (`banco-contenido/[instrumentId]/`): hoy sólo sabe leer
  `content.alternatives`, así que un `matching` se ve vacío. Se agrega un render por tipo de ítem
  (no un `if` para pareados): un componente `MatchingContentView` que dibuja las dos columnas con
  sus `label`, marca los pares correctos y **distingue visualmente los distractores**. Tamaños de
  columna arbitrarios y distintos entre sí. Si un elemento es `isImage`, se muestra su descripción
  (el serving de figuras por presigned URL ya existe y se puede enganchar después).
- **`PreviewTable.tsx`** (flujo de importación): misma vista, en modo compacto.
- **Reporte por alumno**: con crédito parcial, mostrar **`2/4`** en vez de "incorrecto". El dato ya
  está en `responses` (`rawScore`/`maxScore`); es presentación, no cálculo.
- **Fuera de alcance (F3+):** el componente interactivo de unir/arrastrar. No hay rendición en línea
  en F1.

---

## 6. Orden de ejecución

| # | Paso | Entregable | Depende de |
|---|---|---|---|
| 1 | Contrato: `matchingContentSchema` extendido + refinamientos + `matchingScoringSchema` | `packages/types` | — |
| 2 | Estrategia de scoring con crédito parcial configurable + tests de la matriz de §2.2 | `apps/api/.../matching.strategy.ts` | 1 |
| 3 | `buildContent()`: rama genérica `matching` + adaptador DIA + `points` desde el JSON + rama `true_false` | `packages/db` | 1 |
| 4 | Verificar la ficha de Historia 5° y migrar los **4** ítems con `UPDATE` in-place | script en `packages/db/src/seed/` | 3 |
| 5 | Sub-numeración general: `{position, subKey}` + agregación por tipo + conteo por `position` | `apps/api/.../parsers` + service | 1, 2 |
| 6 | Renderizado: `MatchingContentView` en `ItemDetailPanel` y `PreviewTable`; `n/m` en el reporte | `apps/web` | 1 |
| 7 | Verificación end-to-end contra los scans reales | — | 2-6 |

**Paso 7 en detalle** (es el que valida que el diseño no quedó a medias): ingestar los scans de
`dia-ingesta/data/respuestas_reales/` (Ciencias 8° 8A+8B, 89 alumnos; Historia 6° 6B, 19;
Historia 5° 5B, 23) y contrastar **alumno por alumno** el `rawScore` calculado contra el
`max_points`/puntaje que GradeCam ya trae corregido en el JSON. Cualquier diferencia es un bug del
mapeo de dirección (§2, D2) o de la agregación de sub-respuestas (§4), que son exactamente los dos
puntos donde un error corrige mal sin fallar nunca.

Los pasos 1-2-3 son independientes de 5 y 6, así que 5 y 6 pueden ir en paralelo una vez cerrado el
contrato.

---

## 7. Riesgos y cómo se controlan

| Riesgo | Control |
|---|---|
| Inversión silenciosa de la dirección de los pares: corrige mal y nunca falla | D2 fija la invariante en el schema (`leftItems` = lado respondible) + refinamiento Zod + paso 7 contrasta contra puntajes ya corregidos por un tercero |
| `points` variable rompe porcentajes de otros instrumentos | **Verificado: no rompe.** `aggregateStudentResults` y `aggregateSkillResults` ya ponderan por `maxScore`, no por conteo de ítems. El cambio de `points: 1` fijo a `points` del JSON es no-op mientras el JSON no declare otro valor |
| El cambio de contrato de `answers` toca los 4 parsers | El tipo se **amplía** (`string \| null` sigue siendo válido); los 3 parsers no-pareados no cambian de comportamiento y sus tests lo fijan |
| Re-importar un instrumento en vez de migrar in-place → se pierden los tags | El script del paso 4 sólo hace `UPDATE`; el `README` de `packages/db` ya documenta el gotcha |
| `position` ≠ número impreso al migrar | El script falla ruidoso si no ubica exactamente un ítem por target |
| Ficha de Historia 5° sin `matchPairs` | Verificación explícita al inicio del paso 4, antes de escribir nada |

---

## 7bis. Hallazgo abierto — ítems de multi-selección (fuera de este alcance)

La verificación contra el escaneo real de 8A (§6, paso 7) dejó **13 alumnos de 44** con 1 punto de
diferencia, todos por los mismos **3 ítems de Ciencias 8°** (posiciones 8, 27 y 40; impresos 8, 20 y
29). No son pareados: son de **selección múltiple con varias respuestas correctas**.

La extracción los tipa `multiple_choice` con `correctKey: "145"` y **tres** alternativas marcadas
`isCorrect`. La estrategia MCQ deriva la clave de la PRIMERA alternativa correcta, así que:

- el alumno que marca `"145"` (la respuesta completa) obtiene **0** — debería ser 1;
- el alumno que marca sólo `"1"` obtiene **1** — debería ser 0.

Es la misma clase de hueco que `matching` y `true_false` —el tipo real del ítem no es el que dice la
extracción— pero es un **tipo de ítem distinto**, con su propia decisión de diseño pendiente
(¿`multi_select` nuevo en el enum, o `multiple_choice` con `correctKeys`? ¿crédito parcial por opción
o todo-o-nada?). No se resuelve acá para no decidirlo de facto.

Una vez cerrado, el contraste alumno por alumno contra los `points` de GradeCam debería dar 44/44.

---

## 8. Fuera de alcance

- Componente interactivo de rendición en línea (F3+).
- Renombre de `scoredBy: "match"` → algo menos confundible con `matching` (recomendado, ticket aparte).
- `ordering` y `gap_fill`: están en el mismo estado (schema y estrategia construidos, sin datos que
  los ejerciten). El patrón de configuración de puntaje de §2.2 aplica igual cuando les toque.
- Serving de las figuras de los elementos `isImage`: se deja el `matchImageRefs` poblado y el punto
  de extensión listo; enganchar el presigned URL es un paso posterior.
