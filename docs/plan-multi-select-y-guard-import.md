# Plan — ítems de multi-selección (`multi_select`) + guard de `import-instruments`

> Dos trabajos independientes que viajan juntos porque ambos salieron del mismo levantamiento
> (soporte de términos pareados, PRs #89-#92). No comparten código; sí el riesgo que mitigan.
>
> **Fecha:** 2026-08-02. Rama: `feat/multi-select`.

---

## Parte A — `multi_select`

### A.1 El problema, con datos

11 ítems en 7 instrumentos son de **selección múltiple con varias respuestas correctas**. La
extracción los tipa `multiple_choice` con `correctKey: "145"` y **varias** alternativas marcadas
`isCorrect`. La estrategia MCQ deriva la clave de la **primera** alternativa correcta, así que hoy
puntúan **al revés**:

- el alumno que marca `"145"` (la respuesta completa) obtiene **0** — debería ser 1;
- el alumno que marca sólo `"1"` obtiene **1** — debería ser 0.

| Instrumento | Posiciones (impreso) |
|---|---|
| Ciencias 5° | 34 (26) |
| Ciencias 7° | 2 |
| Ciencias 8° | 8, 27 (20), 40 (29) |
| Historia 5° | 2, 8 |
| Historia 6° | 19 |
| Historia 7° | 9 |
| Lectura 3° Intermedio | 7 |
| Matemática 6° Intermedio | 29 *(4 correctas)* |

Es lo único que separa el **31/44** actual del **44/44** en el contraste contra GradeCam.

### A.2 Decisión ya tomada: tipo nuevo, no `correctKeys`

`correctKeys` sobre `multiple_choice` reintroduce por diseño el patrón que causó los tres bugs de
#89: **que el `type` diga una cosa y el dato signifique otra**. Además el proyecto ya define el
camino de extensión (CLAUDE.md §4.1 y el encabezado de `scoring-strategy.ts`: enum + schema +
registro + estrategia), y ya hay precedente exacto — `true_false` es conceptualmente un MCQ de dos
opciones y se modeló como tipo propio.

Beneficio operativo concreto: `Record<ItemType, …>` en `SCORING_STRATEGIES` e
`ITEM_CONTENT_SCHEMAS` **convierte el checklist de extensión en errores de compilación**.

### A.3 Contrato

```ts
export const multiSelectContentSchema = z.object({
  stem: z.string().min(1),
  alternatives: z.array(alternativeSchema).min(3),
  ...baseContent,
}).superRefine(/* al menos 2 correctas, y no todas */);
```

- Reutiliza el shape de alternativas ⇒ el render del banco y el análisis por ítem funcionan sin
  inventar nada nuevo.
- **≥2 correctas** es la invariante que lo distingue de `multiple_choice`. Si tuviera 1, es un MCQ;
  si fueran todas, no discrimina. El refinamiento lo exige y falla ruidoso.

Política de puntaje, simétrica a `matching`:

```ts
export const multiSelectScoringSchema = z.object({
  pointsPerCorrect: z.number().min(0).optional(),
  penaltyPerIncorrect: z.number().min(0).optional(),
  requireExact: z.boolean().optional(),   // default true
});
```

`scoringConfig.multiSelect`, junto a los `points`/`partialCredit` que ya existen.

### A.4 Corrección

```
seleccionadas = conjunto de keys que marcó el alumno
correctas     = keys con isCorrect
aciertos      = |seleccionadas ∩ correctas|
errores       = |seleccionadas − correctas|

requireExact (default) → rawScore = (seleccionadas === correctas) ? points : 0
si no                  → rawScore = clamp(pointsPerCorrect × aciertos
                                          − penaltyPerIncorrect × errores, 0, points)
isCorrect = (seleccionadas === correctas)
```

**El default es todo-o-nada con 1 punto**, y no es una suposición: está verificado contra el escaneo
real. GradeCam le dio **0** al alumno que marcó `"1"` de `["125"]` y **1** al que marcó `"125"`
exacto, con `max_points: 1`. El crédito parcial queda disponible por configuración.

**Parseo de la respuesta.** La hoja escribe el conjunto concatenado (`"145"`), pero no hay que
asumir un solo formato: se aceptan `"145"`, `"1,4,5"`, `"1 4 5"` y un array. Las keys de las
alternativas se usan para desambiguar — si alguna key tiene más de un carácter, concatenar sin
separador es ambiguo y hay que fallar en vez de adivinar.

### A.5 Alcance por capa

| Capa | Qué |
|---|---|
| `packages/db` | Valor `multi_select` en `itemTypeEnum` + migración generada |
| `packages/types` | `multiSelectContentSchema`, registro, `AUTO_SCORABLE_ITEM_TYPES`, `multiSelectScoringSchema`, helper de parseo de selección |
| `apps/api` scoring | `multi-select.strategy.ts` + registro + tests de la matriz |
| `apps/api` item-analysis | Distribución **por opción seleccionada** (un alumno que marca `145` cuenta en 1, 4 y 5). Los % **suman más de 100 a propósito**: es "% de alumnos que marcó esta opción". `correctKey` queda `null` — no existe una única |
| `packages/db` importador | `resolveItemType` detecta ≥2 `isCorrect` ⇒ `multi_select` |
| `packages/db` script | El re-tipado cubre los 11 ítems existentes |
| `apps/web` | Etiqueta del tipo; el panel ya renderiza alternativas y marca varias correctas |

### A.6 Riesgos

| Riesgo | Control |
|---|---|
| Agregar el valor al enum rompe compilación en los `Record<ItemType, …>` | **Es el objetivo**: obliga a cubrir cada punto de extensión |
| `ALTER TYPE … ADD VALUE` tiene restricciones transaccionales en Postgres | Revisar la migración generada antes de aplicarla; es aditiva y de bajo riesgo |
| Un MCQ normal se re-tipa por error | El detector exige **≥2** `isCorrect`; un MCQ tiene exactamente 1 |
| El parseo de `"145"` se rompe con keys multi-carácter | Se detecta y se falla explícito, no se adivina |

---

## Parte B — Guard de `import-instruments`

### B.1 El problema, con datos

`import-instruments` borra y recrea el árbol del instrumento para ser idempotente. Verificado en el
schema, el daño **no es uniforme**:

| Tabla | `onDelete` | Qué pasa |
|---|---|---|
| `item_taxonomy_tags` | `cascade` | **Se destruye en silencio** |
| `item_versions`, `item_edit_proposals` | `cascade` | **Se destruyen en silencio** |
| `responses`, `assessment_item_stats`, `item_collection_items` | *(ninguno)* | El DELETE **falla** y revierte |

O sea: un re-import sobre un instrumento con respuestas revienta con violación de FK (molesto pero
seguro), mientras que uno sobre un instrumento **tagueado** se lleva los tags sin decir nada. El
demo tiene **~5.000 tags** sobre la tanda 2026; un re-import de un instrumento cuesta entre 99 y 162.

### B.2 Diseño

Antes de borrar, contar las filas dependientes y **abortar con un mensaje que diga exactamente qué
se perdería**, salvo que se pase `--force`.

```
Instrumento "DIA Ciencias Naturales 8° … Intermedio" ya está cargado con datos dependientes:
  · 162 item_taxonomy_tags   (se PERDERÍAN — ON DELETE CASCADE)
  ·   0 responses            (bloquearían el DELETE)
Para cambios sobre ítems ya cargados usá UPDATE in-place (db:retype:items), no re-import.
Si de verdad querés recrear el instrumento, re-corré con --force.
```

No cambia el comportamiento del camino feliz (instrumento nuevo, o recarga de uno sin tags), así que
las cargas en curso siguen funcionando igual.

### B.3 Por qué guard y no upsert

El arreglo de fondo es upsertear por `(sourceJson, position)` y preservar los UUID. Es más grande y
toca el camino que el equipo está usando activamente para cargar tandas. El guard cuesta poco, ataja
el accidente **hoy** y no cierra la puerta al upsert después. Queda documentado como deuda.

---

## Orden de ejecución

1. Enum + migración (`multi_select`).
2. Contrato en `packages/types` (schema, registro, scoring config, parseo) + tests.
3. Estrategia de scoring + tests de la matriz.
4. `item-analysis`: distribución por opción + `correctKey` null + test.
5. Importador: detección en `resolveItemType`.
6. Script de re-tipado: cubrir los 11 ítems.
7. UI: etiquetas y verificación del panel.
8. Guard de `import-instruments` (Parte B).
9. Verificación end-to-end contra el escaneo real de 8A: debe pasar de **31/44** a **44/44**.
