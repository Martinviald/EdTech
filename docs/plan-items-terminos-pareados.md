# Ítems de términos pareados (`matching`) — contexto para implementarlos en la app

> **Para quién es este documento:** una sesión que va a implementar el soporte end-to-end de los
> ítems de términos pareados. Todo lo de acá está **verificado contra el código y contra datos
> reales** (ficha oficial DIA + scans GradeCam de dos cursos). Donde hay una decisión abierta, se
> dice explícitamente que está abierta.
>
> **Fecha del levantamiento:** 2026-08-02.

---

## 1. Qué es un ítem de términos pareados

Dos columnas. El alumno traza líneas uniendo cada elemento de una columna con uno de la otra.
No hay alternativas que ennegrecer: hay relaciones que establecer.

Hay **cuatro ítems** en **tres instrumentos** del Monitoreo Intermedio 2026:

| Instrumento | Ítem | Contenido | Pares | Estado en BDD |
|---|---|---|---|---|
| Ciencias Naturales 8° Básico | **7** | mecanismos de intercambio celular | 4 | por cargar |
| Ciencias Naturales 8° Básico | **28** | interacciones entre átomos | 4 | por cargar |
| Historia, Geografía y Cs. Sociales 6° Básico | **16** | paisajes ↔ regiones de Chile | 3 | por cargar |
| Historia, Geografía y Cs. Sociales 5° Básico | **9** | hechos de la Guerra de Arauco ↔ siglo | 4 | ⚠️ **ya cargado, mal clasificado** |

La ficha de Ciencias 8° los declara explícitamente:

> «2 preguntas de términos pareados requieren que cada estudiante conecte dos conceptos»

y el enunciado de Historia 6° no deja duda:

> «Observa las fotos de paisajes de la Columna A. Luego, une con una línea cada paisaje con la
> región de la Columna B a la que pertenece. Ten en cuenta que en el mapa te va a sobrar una
> región.»

**⚠️ Las dos fichas usan notaciones distintas para lo mismo.** Es la primera trampa del trabajo.

Ciencias 8° imprime los pares con etiquetas:

```
        A.3 – B.1                              A.1 – B.1
        A.1 – B.2                              A.3 – B.2
  7     A.2 – B.3                       28     A.5 – B.3
        A.6 – B.4                              A.6 – B.4
```

Lee así: la columna **B** tiene 4 elementos (los que se responden) y la columna **A** tiene **6**
(hay distractores: A.4 y A.5 no se usan en el ítem 7). Cada elemento de B se une con exactamente
un elemento de A. La relación es **funcional de B hacia A**, no una biyección.

Historia 6° imprime lo mismo como una tupla de índices sin etiquetas:

```
  16      (1,4)-(2,1)-(3,3)
```

que se lee `(A1,B4)-(A2,B1)-(A3,B3)`: 3 fotos contra un mapa de 4 regiones, con un distractor.
La lectura está **triple-verificada** — enunciado del cuadernillo, notación de la ficha, y los
scans reales de GradeCam del curso 6B, que dan `16A1→B.4`, `16A2→B.1`, `16A3→B.3`.

Acá el distractor está en la columna B (sobra una región) y en Ciencias está en la A. **No asumas
de qué lado están los distractores ni que las columnas tienen el mismo tamaño.**

### ⚠️ Hay un ítem pareado ya cargado en la BDD, clasificado como `fill_in`

**DIA Historia 5° Básico, posición 9.** Se cargó como `open_ended` / `fill_in` con la clave cruda
`"(1,5)-(2,4)-(3,1)-(4,2)"` guardada como texto, porque el parser de fichas no reconocía la
notación de tuplas. Es un ítem pareado, y las tres fuentes coinciden:

- **Cuadernillo:** «Une con una línea los recuadros de algunos hechos de la Guerra de Arauco… en la
  columna A, con el siglo en el que ocurren que se encuentra en la columna B. Ten en cuenta que en
  la columna B hay una opción de más», con las columnas rotuladas `A.1…A.4` / `B.1…B.5`.
- **Ficha técnica:** declara «1 pregunta de términos pareados».
- **Scans de GradeCam del curso 5B:** `9.1→B.5`, `9.2→B.4`, `9.3→B.1`, `9.4→B.2`, que es
  exactamente la lectura de `(1,5)-(2,4)-(3,1)-(4,2)`.

Consecuencia práctica: hoy ese ítem **no es corregible** (`open_ended` cae en la estrategia de
corrección manual y queda pendiente, sin puntaje). Al implementar el soporte hay que migrarlo
también, con `UPDATE` in-place. El parser de fichas ya lo produce bien.

Esto también explica un desajuste que se veía desde afuera: Historia 5° tiene 25 ítems en la BDD
pero los scans traen 27 preguntas (28 respuestas). La diferencia son las 4 sub-respuestas del
ítem 9 en lugar de 1.

---

## 2. Lo que YA está construido (no lo rehagas)

Esto es lo más importante del documento: **el backend ya soporta `matching` casi entero.** Fue
construido en el refactor de flexibilidad (Fase 0 / Oleada A-B) como punto de extensión, y nunca
se ejercitó con datos reales porque no había ítems de este tipo.

| Pieza | Dónde | Estado |
|---|---|---|
| Valor `matching` en el enum de BD | `packages/db/src/schema/enums.ts` (`itemTypeEnum`) | ✅ existe |
| Schema Zod del `content` | `packages/types/src/schemas/item-content.schema.ts` → `matchingContentSchema` | ✅ existe |
| Registro tipo→schema | mismo archivo → `ITEM_CONTENT_SCHEMAS.matching` | ✅ existe |
| Marcado como auto-corregible | mismo archivo → `AUTO_SCORABLE_ITEM_TYPES` | ✅ existe |
| Estrategia de corrección | `apps/api/src/answer-sheets/scoring/strategies/matching.strategy.ts` | ⚠️ existe pero con la **semántica equivocada** (§4) |
| Registro tipo→estrategia | `apps/api/src/answer-sheets/scoring/scoring-strategy.ts` → `SCORING_STRATEGIES.matching` | ✅ existe |
| Etiqueta en la UI | `apps/web/.../banco-contenido/[instrumentId]/ItemDetailPanel.tsx` → `ITEM_TYPE_LABELS.matching = 'Términos pareados'` | ✅ existe |

El shape del `content` ya definido:

```ts
export const matchingContentSchema = z.object({
  prompt: z.string().min(1).optional(),
  leftItems:    z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(2),
  rightItems:   z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(2),
  correctPairs: z.array(z.object({ leftId: z.string(), rightId: z.string() })).min(1),
  ...baseContent,   // imageUrl?, audioUrl?, explanation?
});
```

Encaja bien con el formato DIA: `leftItems` = columna A (con distractores), `rightItems` =
columna B, `correctPairs` = los pares de la ficha. Sugerencia de `id`: usar la etiqueta impresa
(`"A.3"`, `"B.1"`) para que el dato sea legible y trazable al documento original.

**Lo que NO está construido:** el camino de carga (§3), la corrección con la semántica real (§4),
la ingesta de la respuesta del alumno (§5) y el renderizado (§6).

---

## 3. Camino de carga (importador) — falta

`packages/db/src/seed/import-instruments.ts`, función `buildContent()`:

```ts
function buildContent(it: Item): Record<string, unknown> {
  if (it.type === 'multiple_choice' || it.type === 'true_false') { … }
  // open_ended (incluye responseFormat fill_in / develop), writing, etc.
  return { prompt: it.stem };            // ← todo lo demás cae acá
}
```

Hoy un ítem `matching` caería en el `return { prompt: it.stem }` y **fallaría la validación Zod**
(`leftItems` es requerido). Hay que agregarle una rama que construya `leftItems` / `rightItems` /
`correctPairs` desde el JSON del instrumento.

### El pipeline de extracción ya entrega el dato normalizado

Buena noticia: **no hay que volver a leer los PDF.** El pipeline (fuera de este repo, en
`Histórico Pruebas DIA/Pruebas/2026/extraccion/`) ya produce los pares en un shape único, y
`parse_ficha.py` normaliza **las dos notaciones** al mismo formato:

- la capa A (cuadernillo) entrega las dos columnas en `matchColumns: {"A": [...], "B": [...]}`;
- la capa B (ficha) entrega `scoredBy: "pairs"`, `correctKey: null`, `rawAnswer` con la notación
  original para trazabilidad, y
  `matchPairs: [{"left": "A.3", "right": "B.1"}, …]` en orden impreso;
- el ítem se modela como `type: "open_ended"`, `responseFormat: "match_pairs"`.

**Ese `open_ended` es deuda deliberada**, tomada para que la carga de la tanda no dependiera de
este trabajo. Al implementar el soporte real, los cuatro ítems deben migrar a `type: "matching"`.
Ojo con el gotcha de siempre: **no se re-importa el instrumento** para cambiarlos
(`import-instruments` borra y recrea, regenera los UUID y arrastra los `item_taxonomy_tags` por
`ON DELETE CASCADE`) — se hace `UPDATE` in-place matcheando por
`instruments.config->>'sourceJson'` + `position`.

El mapeo de `matchPairs` al `content` de Zod es directo: `left`/`right` → `leftId`/`rightId`, y los
textos de cada columna salen de `matchColumns`.

---

## 4. ⚠️ La corrección actual es todo-o-nada y los datos reales dicen que NO

Esto es el hallazgo central del levantamiento y lo que hay que decidir antes de escribir código.

`matching.strategy.ts` hoy:

```ts
// Corrección "todo o nada": la respuesta del alumno debe reproducir EXACTAMENTE
// `content.correctPairs`.
if (studentPairs.size !== correctPairs.length) return incorrect;
const allMatch = correctPairs.every((p) => studentPairs.get(p.leftId) === p.rightId);
```

Un ítem, un punto, y basta un par mal para perderlo entero.

**Los scans reales de GradeCam corrigen distinto.** Del archivo
`dia-ingesta/data/respuestas_reales/8vo/8A/respuestas_ciencias.json`, alumno real, ítem 7:

```
label    type   max_points  cors                              ans
 7B1     fitb        1      ['A.3', 'Difusion simple']        'A.4'   ✗
 7B2     fitb        1      ['A.1', 'Osmosis']                'A.5'   ✗
 7B3     fitb        1      ['A.2', 'Difusion facilitada']    'A.2'   ✓
 7B4     fitb        1      ['A.6', 'Crenacion']              'A.6'   ✓
```

Es decir: **GradeCam descompone el ítem en una sub-pregunta por cada elemento de la columna B**,
cada una con su propio punto, y las corrige de forma independiente. Este alumno saca **2 de 4**,
no 0 de 1.

Y no es un detalle de un proveedor: cuadra exactamente con el conteo de la prueba.
La ficha declara **43 posiciones puntuables**; el escaneo trae **49 respuestas**:

```
43 − 2 (ítems 7 y 28) + 8 (7B1..7B4, 28B1..28B4) = 49   ✓
```

El puntaje máximo del instrumento (`max_points: 49`) confirma que la Agencia cuenta **4 puntos por
ítem pareado**, no 1.

### La decisión que hay que tomar

Dos caminos, con consecuencias distintas:

**(a) Un ítem `matching` con crédito parcial.** `scoringConfig.points = 4`, `partialCredit = true`,
y la estrategia devuelve `rawScore = nº de pares correctos`. Mantiene un ítem = un ítem, respeta la
estructura del cuadernillo, y `responses` guarda un registro por ítem.
- Requiere reescribir `matching.strategy.ts` (hoy `rawScore` solo puede ser `0` o `maxScore`).
- Requiere que la ingesta sepa colapsar `7B1..7B4` en un solo `rawAnswer` con forma de pares.
- Es coherente con `AUTO_SCORABLE_ITEM_TYPES` y con el resto del modelo.

**(b) Cuatro ítems `multiple_choice` independientes**, uno por elemento de B, con `printedNumber`
`"7B1"`… Réplica exacta de lo que hace GradeCam, cero código nuevo de scoring.
- Rompe la correspondencia con el cuadernillo impreso (un ítem visual = 4 filas en la BDD).
- Ensucia el banco de ítems y los dashboards por habilidad (4 tags donde el documento define 1).
- Es el mismo parche que ya se evitó en otros casos de sub-numeración.

**Recomendación: (a).** El modelo polimórfico existe justamente para esto, y `matching` ya está en
el enum, en el registro de schemas y en el de estrategias. El costo real es una estrategia con
crédito parcial y un colapso en la ingesta — mucho menor que la deuda estructural de (b).

Ojo con un efecto colateral de (a): hoy el importador fija `scoringConfig.points = 1` para todos
los ítems. Con puntaje variable hay que leerlo del JSON del instrumento, y revisar que el cálculo
de porcentajes agregados use `maxScore` y no un conteo de ítems.

### No confundir con `scoredBy: "match"`

Ya existe en el pipeline una semántica llamada **`match`** que es **otra cosa**: ítems de
clasificación donde la ficha imprime la ETIQUETA de la alternativa correcta ("Barrera secundaria")
en vez de su letra, y hay que resolverla contra el texto de la alternativa. Eso es un
`multiple_choice` normal con una clave mal tipografiada, no un ítem pareado. Aparece en Historia 7°
y Ciencias 7°. **`match` ≠ `matching`.** Vale la pena renombrar el primero al tocar esto.

---

## 5. Ingesta de respuestas — falta

`ScoringInput.rawAnswer` es `unknown` y `parseStudentPairs()` ya acepta dos formas:

```ts
// Forma 1: record { leftId: rightId }
// Forma 2: array [{ leftId, rightId }]
```

Nota que el sentido está invertido respecto de cómo llega el dato: GradeCam entrega
**B → A** (`7B1` respondió `A.4`), mientras la estrategia indexa por `leftId` (columna A). Hay que
fijar una convención y documentarla en el schema, porque una inversión silenciosa acá corrige mal
sin fallar nunca. **Sugerencia:** dejar `leftItems` = columna que se responde (B) y `rightItems` =
banco de opciones con distractores (A), de modo que `correctPairs` tenga una entrada por
sub-pregunta y `leftId` sea único. Si se prefiere respetar la nomenclatura del documento (A
izquierda, B derecha), entonces la estrategia debe indexar por `rightId`. Cualquiera sirve; lo que
no sirve es no decidirlo.

El adaptador de GradeCam tiene que:
1. reconocer las etiquetas `<pos>B<n>` como sub-respuestas de un ítem pareado;
2. agruparlas en un único `rawAnswer`;
3. no contarlas como ítems separados al validar que el nº de respuestas calce con el instrumento.

Ese punto 3 es el mismo problema que ya tenemos abierto con la sub-numeración de otros
instrumentos (Historia 5° escanea `9.1..9.4` para un ítem que en la BDD es uno solo; Historia 7°
escanea `19.1..19.5`). **Conviene resolverlo una vez, de forma general**, en vez de un caso
especial para pareados: un mapa `printedNumber` del escaneo → `position` del ítem, con una regla
de agregación por tipo.

---

## 6. Renderizado — falta

`ItemDetailPanel.tsx` ya tiene la etiqueta "Términos pareados", pero el cuerpo del panel lee
`content.alternatives` y un `matching` no las tiene: hoy mostraría el ítem vacío. Hace falta:

- una vista de dos columnas con los pares correctos marcados (vista docente / banco de ítems);
- lo mismo en `PreviewTable.tsx` del flujo de importación;
- decidir si el reporte por alumno muestra los 4 sub-resultados o solo el agregado. Con crédito
  parcial, mostrar "2/4" es más útil que "incorrecto".

No hay vista de alumno que rinde en F1, así que **no se necesita un componente interactivo de
arrastrar/unir**. Eso es F3+ cuando exista rendición en línea; no construirlo ahora.

---

## 7. Estado de los datos hoy

- Los **4 ítems** del §1 son todos los del corpus. Se barrieron las 39 fichas técnicas buscando la
  firma de ambas notaciones: no hay más. Historia 6° y Ciencias 8° están en carga y entran como
  `open_ended` / `match_pairs` (deuda del §3); Historia 5° ya está cargado y mal clasificado.
- **Hay respuestas reales ya escaneadas** para los tres instrumentos, en
  `dia-ingesta/data/respuestas_reales/`: Ciencias 8° (cursos 8A y 8B, 89 alumnos), Historia 6°
  (6B, 19) e Historia 5° (5B, 23). Sirven de caso de prueba end-to-end sin fabricar datos, y los
  tres traen las sub-respuestas ya corregidas por GradeCam con las que contrastar el puntaje.
- Ninguno de los otros 40 instrumentos 2026 usa este tipo, así que el cambio es **aditivo y de
  bajo riesgo de regresión** — salvo por el punto de `scoringConfig.points` variable (§4), que sí
  toca a todos.
- **Relacionado, mismo origen:** los 9 ítems de verdadero/falso de Ciencias 8° (`15.1–15.4`,
  `23.1–23.5`) se cargan como `multiple_choice` con alternativas `A. Verdadero` / `B. Falso`, y no
  como `true_false`, porque `buildContent()` no tiene rama para ese tipo y su schema Zod exige
  `correctAnswer: boolean` (verificado: lanza `ZodError`). Es la misma clase de hueco que el de
  `matching` y conviene cerrarlos juntos.

---

## 8. Orden sugerido de implementación

1. **Decidir (a) vs (b) del §4** y la convención de dirección del §5. Todo lo demás depende de eso.
2. Estrategia de scoring con crédito parcial + tests (hay `scoring-strategy.spec.ts` con casos de
   `matching` que habrá que actualizar: hoy asumen todo-o-nada).
3. Rama `matching` en `buildContent()` del importador + `points` desde el JSON. Considerar cerrar
   de paso la rama `true_false` (§7).
4. Migrar los **4** ítems con `UPDATE` in-place (nunca re-import) — incluido el de Historia 5°,
   que hoy queda sin corregir.
5. Adaptador de GradeCam: agrupación de sub-respuestas, idealmente con la solución general del §5.
6. Renderizado en `ItemDetailPanel` y `PreviewTable`.
7. Verificar contra los scans reales de 8A/8B que los puntajes calcen con los `points` de GradeCam.

---

## 9. Fuera de alcance de este documento

- El componente interactivo de rendición en línea (F3+).
- El renombre de `scoredBy: "match"` → algo menos confundible (recomendado, pero es otro cambio).
- La sub-numeración general del escaneo (`9.1`, `19.x`): se menciona en §5 porque el diseño de
  pareados debería resolverla de paso, pero es un problema propio y más grande.
- Los ítems de `ordering` y `gap_fill`, que están en el mismo estado (schema y estrategia
  construidos, sin datos reales que los ejerciten).
