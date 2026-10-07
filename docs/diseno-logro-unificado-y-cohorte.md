# Diseño — % de logro unificado y contraste con la cohorte

> **Qué es esto:** el diseño de dos entregas encadenadas.
>
> - **Parte A — % de logro unificado.** Una sola definición del % de logro de cualquier grupo
>   (curso, nivel, colegio, muestra; prueba, sección, nodo, pregunta), calculada en un solo lugar y
>   guardada en las tablas precalculadas como puntajes sumables.
> - **Parte B — Contraste con la cohorte.** El tablero maestro, el detalle por pregunta y el logro por
>   OA / habilidad / eje muestran el resultado del curso o nivel contra la muestra de colegios.
>
> La parte B se apoya en la A: sin una definición única, el número de la muestra y el del colegio no se
> pueden comparar.
>
> **Fecha:** 2026-10-06 · **Estado:** ✅ diseño cerrado. Plan en
> [`plan-logro-unificado-y-cohorte.md`](./plan-logro-unificado-y-cohorte.md).
>
> **Antecedente:** [`diseno-benchmarking-en-contexto.md`](./diseno-benchmarking-en-contexto.md)
> (PR #273, en main).

---

## 1. Problema

### 1.1 Tres fórmulas para el mismo número

Hoy la app calcula el "% de logro" de un grupo de tres maneras (inventario completo en §9):

|       | Fórmula                                         | Dónde                                                                                                                                                                                               |
| ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Promedio de los % de cada alumno                | Resumen de `/resultados` de una evaluación, comparación entre cursos, panorama y trayectoria, informes de curso y de alumno, logro por nodo calculado, mapa de calor, % general de la muestra       |
| **B** | Σ puntaje obtenido ÷ Σ puntaje máximo del grupo | Tablero maestro, % por pregunta y referencia del nivel en `/detalle`, logro por nodo importado de informes DIA                                                                                      |
| **C** | Σ aciertos ÷ Σ respuestas (ignora el puntaje)   | Tabla de especificaciones del informe de curso, alertas por nodo y por pregunta, panorama del alumno por habilidad, muestra por nodo y por pregunta, total de la fila "% Logro nivel" en `/detalle` |

Consecuencias:

- El mismo curso muestra números distintos según la vista.
- Varias alertas comparan un número C contra uno A (`skill_gap`, por ejemplo).
- `assessment_skill_stats.percentage` significa A o B según el origen del dato, y todos sus lectores
  mezclan ambos.
- La fórmula C trata una pregunta de desarrollo de 2 puntos igual que una de 1 punto e ignora el
  crédito parcial. En los nodos con preguntas de desarrollo la diferencia puede ser grande.

### 1.2 Sin contraste con la cohorte donde más se mira

- **Tablero maestro:** ninguna referencia externa.
- **`/detalle`:** el tooltip de cada pregunta muestra el % de _la evaluación filtrada_ (en la práctica,
  el curso) sin decirlo. El nivel aparece en la fila "% Logro nivel". La muestra no aparece: el
  contrato reservó `references.sample`, pero nunca se llenó.
- **`/resultados` de una evaluación:** los directivos ya ven "Muestra X%" por nodo, pero sólo como
  `title` del navegador, sin la referencia del nivel y con una fórmula distinta a la del colegio.

---

## 2. Decisiones

Tomadas el 2026-10-06.

| #   | Decisión                                                                 | Resolución                                                                                                                                    |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | ¿Unificar la fórmula aunque cambien números publicados?                  | **Sí.** Se quiere analítica definitiva, sin deuda técnica.                                                                                    |
| D2  | Percentil en celdas de curso                                             | **No.** Sólo la diferencia en pp. Un curso no se compara contra promedios de colegios completos (igual que en el panorama).                   |
| D3  | Métrica "diferencia vs muestra" en el tablero                            | **Se incluye** en la parte B.                                                                                                                 |
| D4  | Pregunta en blanco                                                       | **Es una incorrecta:** 0 puntos y su máximo cuenta.                                                                                           |
| D5  | Preguntas de una sección que el alumno no rindió                         | **No cuentan**, ni en numerador ni en denominador.                                                                                            |
| D6  | Pendientes de corrección                                                 | Se excluyen, como hoy. Es tolerable que afecten el número en esta fase. El aviso se hace **sólo donde es barato** (vistas de una evaluación). |
| D7  | Respuesta que falta en la base                                           | **No cuenta** en el % de logro.                                                                                                               |
| D8  | Tablas de benchmark                                                      | Se mantienen como tablas precalculadas (razones en §6.1).                                                                                     |
| D9  | ¿Qué hace la muestra con evaluaciones que tienen preguntas sin corregir? | **Ninguna se excluye.** La muestra se calcula sobre las preguntas que el grupo comparado tiene corregidas (§5.1).                             |

---

## 3. Definición del % de logro

### 3.1 La regla

> **Logro de un grupo = Σ puntaje obtenido ÷ Σ puntaje máximo, sobre las respuestas registradas y ya
> corregidas de las preguntas que cada alumno rindió.**

| Caso                                         | Numerador  | Denominador | Hoy                                                  |
| -------------------------------------------- | ---------- | ----------- | ---------------------------------------------------- |
| Correcta, incorrecta o parcial               | su puntaje | su máximo   | ✅                                                   |
| En blanco (respuesta guardada vacía)         | 0          | su máximo   | ✅ las 6 vías de carga guardan el blanco como fila   |
| Respuesta anulada de un alumno (doble marca) | 0          | su máximo   | ✅ se puntúa como blanco                             |
| Pendiente de corrección (`isCorrect = null`) | —          | —           | ✅ excluida                                          |
| Faltante en la base                          | —          | —           | ✅ no hay fila                                       |
| Pregunta de otra sección electiva            | —          | —           | ✅ la carga sólo crea filas de la sección del alumno |

- **Es la definición del DIA:** el logro por nodo importado de los informes DIA, que ya usa esta
  fórmula, reproduce el informe oficial con error < 0,01 pp.
- **Se suma por partes:** curso + curso = nivel; ítems = sección o nodo; colegios = muestra. Las tablas
  precalculadas guardan sólo `score_sum` y `max_sum`, y nunca se promedian porcentajes.
- **No cambia el % de cada alumno:** `aggregateStudentResults` y `aggregateSkillResults` ya usan esta
  regla. El nivel de desempeño de cada alumno y la distribución por niveles no se mueven.
- **El grupo no tiene % sin puntaje corregido:** si `Σ max = 0` el % es `null`, nunca 0.

### 3.2 Lo que no es un "% de logro de grupo"

- **El promedio de notas** sigue siendo el promedio de las notas de los alumnos: la nota no se suma por
  partes.
- **La distribución por niveles** cuenta alumnos por banda según el % de cada uno.
- **Las pruebas estadísticas** (comparación por sexo del informe del establecimiento) usan como
  observaciones el % de cada alumno. El % del grupo que se _muestra_ al lado sí sigue la regla.
- **La distribución de alternativas** de una pregunta es una proporción de respuestas, no un logro.
- **Entre instrumentos no comparables no hay % de grupo.** Se mantiene la regla D8 del panorama
  comparable.

### 3.3 Límites conocidos (fuera de alcance)

- **Desarrollo en blanco queda pendiente.** En todas las vías de carga, una pregunta de desarrollo o
  rúbrica sin código queda `isCorrect = null`. En la hoja no se distingue "el alumno la dejó en blanco"
  de "el profesor aún no la corrige", así que no se puede puntuar 0 automáticamente. El profesor la
  corrige con 0. Se tolera (D6).
- **La corrección IA no cierra la pendiente.** Sólo escribe `aiScore`. Promoverla a `finalScore`
  requiere aprobación humana (CLAUDE.md §8.3). No cambia.
- **No existe la anulación de una pregunta completa.** "Nula automática" es la anulación de _la
  respuesta de un alumno_ (doble marca) y se puntúa como blanco. Anular una pregunta para todos
  requeriría un flag nuevo en el ítem o la evaluación. Queda como punto de extensión, no se implementa.

---

## 4. Parte A — % de logro unificado

### 4.1 Una sola implementación

En `@soe/types` (`utils/achievement.ts`):

```ts
type AchievementTally = { scoreSum: number; maxSum: number };
emptyTally(); addTally(target, source); tallyOf(rows);
achievementPct(tally): number | null; // 0..100, null si maxSum = 0
```

Todo lector que muestre un % de grupo suma tallies y llama a `achievementPct`. Se eliminan:

- `COHORT_PCT_SUM` / `COHORT_PCT_WEIGHT` y el acumulador `pctSum / pctWeight`.
- Los `avg(…percentage)` sobre grupos.
- Los `pctSum / pctCount` del cálculo de cohorte y del refresh de la muestra.

En su lugar entran `COHORT_SCORE_SUM` / `COHORT_MAX_SUM` (SQL) y `addTally` (TS).

### 4.2 Fuente de cada grano

| Grano                                                       | Fuente del tally                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Curso, nivel o colegio × prueba, sección o pregunta         | `assessment_item_stats.score_sum / max_sum`, que existe para respuestas por alumno **y** para informes oficiales importados                      |
| Curso, nivel o colegio × nodo                               | `assessment_skill_stats.score_sum / max_sum` (**nuevas**)                                                                                        |
| Filtro por atributos del alumno (sexo, PIE, alumno puntual) | `assessment_results.total_score / max_score` y `skill_results.score_sum / max_sum` (**nuevas**)                                                  |
| Muestra × instrumento, nodo o pregunta                      | `benchmark_aggregates.score_sum / max_sum` y `per_skill[].scoreSum / maxSum`; `benchmark_item_aggregates.score_sum / max_sum` (**todas nuevas**) |

Las dos rutas, cohorte y por alumno, dan el mismo número porque las dos excluyen las pendientes en la
misma función (`aggregateStudentResults`, `aggregateItemStats`).

### 4.3 Esquema (migración aditiva)

| Tabla                       | Columnas nuevas                                                         | Qué pasa con las existentes                                                              |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `skill_results`             | `score_sum`, `max_sum`                                                  | `percentage` queda como derivado del alumno (ya es B)                                    |
| `assessment_skill_stats`    | `score_sum`, `max_sum`                                                  | `percentage` pasa a ser **siempre** `score_sum/max_sum`, para ambos orígenes             |
| `benchmark_aggregates`      | `score_sum`, `max_sum`; `per_skill[]` gana `scoreSum`, `maxSum` (jsonb) | `avg_achievement` pasa a derivado; `band_distribution` ya está obsoleta                  |
| `benchmark_item_aggregates` | `score_sum`, `max_sum`                                                  | `correct_count / response_count` siguen sirviendo para la distribución, no para el logro |

- Todas son `numeric NOT NULL DEFAULT 0`. El código desplegado las ignora, así que el orden de deploy
  (migración antes que la imagen) es seguro.
- Mientras una fila tenga `max_sum = 0` porque aún no se recalcula, el lector la trata como "sin
  dato". Nunca vuelve en silencio a la fórmula vieja.
- Un `percentage` que quede sin lectores al terminar la parte A se borra en una entrega posterior
  (expand / contract), junto con `band_distribution`.

### 4.4 Recalcular lo existente

| Qué                                   | Cómo                                                                                                                                                                                            | Cuándo                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `skill_results.score_sum / max_sum`   | Script nuevo `db:backfill:student-scores`: recalcula desde `responses` con `aggregateSkillResults` y sólo escribe las sumas. Verifica que el `percentage` recalculado coincida con el guardado. | Paso del deploy de backend con su propio sello (patrón `db:cohort-stamp`) |
| `assessment_skill_stats` (calculadas) | `db:backfill:cohort-stats`. Su huella cubre `item-stats-calculator.ts`, así que el cambio dispara el rebuild solo.                                                                              | Deploy (ya existe)                                                        |
| `assessment_skill_stats` (importadas) | Pasada nueva en el mismo backfill: re-deriva desde sus `assessment_item_stats` importadas, sin respuestas                                                                                       | Deploy                                                                    |
| `benchmark_*`                         | `db:refresh:benchmark`                                                                                                                                                                          | Deploy (ya existe) y diario                                               |

No se tocan respuestas ni puntajes de alumnos. Sólo se rellenan sumas y se reconstruyen tablas
derivadas.

### 4.5 Correcciones que caen dentro de la definición

| #   | Hallazgo                                                                                                                 | Arreglo                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| A-1 | Un alumno con todas sus preguntas pendientes queda con `percentage = 0` (`grade-calculator.ts:388`)                      | `null` y sin banda                                                                                 |
| A-2 | `loadResponsesForPersist` y los 3 importadores seed no filtran `items.deleted_at`: un ítem borrado sigue contando        | Filtrar `deleted_at IS NULL`                                                                       |
| A-3 | El importador seed de DIA 2026 no tiene la guarda de secciones electivas                                                 | Agregarla, igual que en PAES                                                                       |
| A-4 | `aggregateReference` (`/detalle`, nivel) da 0 a una pregunta sin respuestas corregidas, y `attachCorrectRates` da `null` | `null` en ambos                                                                                    |
| A-5 | La fila "% Logro nivel" recalcula su total con aciertos ÷ respuestas e ignora el `rate` del API                          | Usar los tallies del API                                                                           |
| A-6 | `isComplete` existe pero ninguna pantalla lo muestra                                                                     | Aviso en `/resultados` y `/detalle` de una evaluación: "N alumnos con preguntas por corregir" (D6) |
| A-7 | 2 evaluaciones importadas guardan el logro por nodo en escala 0..1 (§8)                                                  | Re-derivar desde sus estadísticas por ítem (A2-5); `achievementPct` fija una sola escala           |

### 4.6 Cambios de número esperados

Para CSCJ y San Agustín cambian:

- **Logro por nodo:** cambia en evaluaciones con preguntas de desarrollo, crédito parcial o puntajes
  distintos de 1. Es el cambio más grande.
- **Logro general del curso o colegio:** cambia sólo donde algún alumno tiene preguntas pendientes o
  faltantes.
- **Alertas:** los conteos se mueven, porque las comparaciones C contra A desaparecen.

Antes de promover a main se genera un **informe de diferencias** con los números de antes y después
por evaluación, curso y nodo, para revisarlo y avisar a los colegios (plan §A5).

---

## 5. Parte B — Contraste con la cohorte

### 5.1 Reglas comunes

- **Quién lo ve:** roles de `BENCHMARKING_VIEWER_ROLES`. No se muestra en la vista de profesor (rol
  activo `teacher`), igual que en el panorama.
- **Contra qué se compara:** la **muestra global** del instrumento (incluye al propio colegio, excluye
  a los que se retiraron). Exige k ≥ `BENCHMARK_K_MIN_SCHOOLS` colegios por instrumento y, para
  preguntas y secciones, por ítem. La red aparece en el tooltip si existe.
- **Misma fórmula en los dos lados.** El valor de la muestra para cualquier conjunto de ítems (prueba,
  sección, nodo o pregunta) es la suma de los tallies por ítem de los colegios elegibles
  (`benchmark_item_aggregates`). Los nodos se arman con los tags del ítem, que son datos de referencia
  globales. El percentil se calcula sobre el % de cada colegio.
- **Sobre las mismas preguntas (D9).** La muestra se calcula **sólo sobre las preguntas que el grupo
  comparado tiene corregidas** (`max_sum > 0`). Si a CSCJ le faltan las preguntas de desarrollo de una
  evaluación, la muestra con la que se compara también las deja fuera. Así no se excluye ninguna
  evaluación de la muestra y la comparación es pareja.
  - Cada colegio de la muestra aporta lo que tiene corregido dentro de ese conjunto.
  - El k se exige por pregunta. Una pregunta que queda bajo k sale del conjunto de los dos lados.
  - El tooltip dice sobre cuántas preguntas se comparó cuando no son todas: "Comparado sobre 28 de 30
    preguntas: 2 sin corrección".
- **Un grupo, tres niveles de lectura:** curso · nivel · muestra, con la diferencia en pp contra la
  muestra. El percentil y la zona típica sólo se muestran cuando el grupo es el nivel completo del
  colegio (D2).
- **Sin contraste:** celdas que mezclan instrumentos, instrumentos o ítems bajo el umbral k, y
  evaluaciones sin respuestas corregidas.

### 5.2 Tablero maestro

- **API.** `MasterBoardCell` y `MasterBoardCourseCell` ganan `sample: CellSample | null`. Se calcula
  en el servidor, dentro de la misma transacción, porque sólo ahí se conocen los instrumentos y las
  secciones de cada celda.
  - Una sola consulta a `benchmark_item_aggregates` por toma, agrupada por colegio × instrumento ×
    sección.
  - Las columnas de **sección** (Común, Bio, Fís, Quí) también se comparan, sumando los ítems de la
    sección.
  - `CellSample = { value, deltaPp, schoolCount, studentCount, percentile?, typicalZone?, networkLabel? }`.
    `percentile` y `typicalZone` sólo van en celdas de nivel de un usuario con alcance completo.
- **Tooltip** de cada celda:
  - Nivel: "Muestra 61,0% · +3,2 pp · sobre la zona típica (2 colegios · 230 alumnos)".
  - Curso: "Curso 58,1% · Nivel 64,2% · Muestra 61,0%", con la diferencia del curso contra la muestra.
- **Métrica "diferencia vs muestra"** (D3): una segunda métrica del selector existente
  (`availableMetrics`).
  - Cada celda muestra "+3,2" o "−4,8" y se pinta en una escala divergente (bajo / similar / sobre la
    muestra). El umbral de "similar" es `ALERT_THRESHOLDS.cohort.similarPp`.
  - Las celdas sin contraste quedan en gris "sin muestra".
  - La leyenda cambia con la métrica.
  - Sólo aparece en el selector para quien puede ver la muestra.

### 5.3 `/detalle` (tabla cruzada)

- **API.** `QuestionReferences.sample` pasa de `number | null` a
  `ReferenceRate & { schoolCount, studentCount }`. `MatrixReferenceScopes` gana `sample` con el
  resumen sobre las preguntas visibles. Sólo se llena para quien puede ver la muestra.
- **Tooltip de la pregunta:** tres líneas, "Curso X% · Nivel Y% · Muestra Z%", con diferencias.
  Cuando no hay filtro de curso y la evaluación tiene varios cursos, la primera línea dice "Esta
  evaluación".
- **Fila nueva "% Logro muestra"** bajo "% Logro nivel", con el mismo formato y el total sobre las
  columnas visibles.
- **Panel de la pregunta:** las mismas tres referencias.

### 5.4 `/resultados` de una evaluación (logro por OA, habilidad, contenido y eje)

- **Referencia del nivel por nodo.** `GET /dashboards/skills?assessmentId=…&reference=level` devuelve
  el logro por nodo de todo el nivel. Se calcula con la misma población que la fila del nivel de
  `/detalle` (mismo instrumento, nivel y año), en un helper común extraído de `item-analysis`.
- **`SkillsBreakdown`:**
  - La barra muestra dos marcas, nivel y muestra.
  - El `title` se reemplaza por el tooltip de los chips (`SampleTooltipBody`): "Curso · Nivel ·
    Muestra", diferencias y tamaño de la muestra.
  - Sin filtro de curso, el grupo es el colegio y la referencia del nivel se omite, porque sería el
    mismo número.
- Funciona en todas las dimensiones del selector, porque `per_skill` cubre todos los nodos evaluados.

### 5.5 Telemetría

`benchmark.sample_viewed` con `surface = master_board | item_matrix | skills_breakdown` y
`benchmark.sample_detail_opened` al abrir un tooltip. Son los eventos que ya existen, con una
superficie nueva.

---

## 6. Por qué así

### 6.1 Tablas precalculadas y no consultas en vivo (D8)

- Las tablas de resultados tienen RLS forzado y la API corre como `soe_app`, siempre con _un_ colegio
  en contexto. Una consulta en vivo sobre todos los colegios exigiría saltarse RLS (rol con bypass o
  funciones `SECURITY DEFINER` que leen datos personales de todos).
- El refresh lee cada colegio con su propio contexto y escribe sólo agregados sin PII. La única
  excepción a RLS del proyecto es una tabla que no tiene nada sensible.
- Con muchos colegios, el costo depende del número de colegios y no del de respuestas.
- **Costo asumido:** pueden quedar desactualizadas (se refrescan en el deploy, a diario y después de
  cada carga) y hay un segundo lugar con cálculo. La parte A reduce ese segundo costo a sumar tallies
  con la misma función.

### 6.2 Tallies y no porcentajes en las tablas

Un porcentaje guardado no se puede combinar sin conocer su peso, y cada peso distinto es una fórmula
distinta. Guardar `score_sum / max_sum` deja una sola forma de combinar: sumar.

---

## 7. Riesgos

| Riesgo                                                  | Mitigación                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Los colegios ven números distintos de un día para otro  | Informe de diferencias antes de promover; aviso a los colegios (lo coordina el equipo)                                            |
| Deploy con tablas sin recalcular                        | Backfills como pasos del deploy, con sello y un chequeo que falla si quedan filas con `max_sum = 0` y respuestas corregidas       |
| Umbrales de alertas calibrados con la fórmula vieja     | Se mantienen los valores; el informe de diferencias incluye el conteo de alertas antes y después; el reajuste se decide con datos |
| Una vista olvidada sigue con la fórmula vieja           | Inventario §9 como checklist del PR, más un test que recorre los servicios buscando `avg(` sobre `percentage`                     |
| Pendientes de corrección inflan a CSCJ en 2025 (ver §8) | Aviso de pendientes (A-6) y decisión sobre la muestra (§8)                                                                        |

---

## 8. Verificación en demo (A0, 2026-10-06)

Medido en la base de demo, en solo lectura.

**Evaluaciones sin datos de puntaje: ninguna.**

| Colegio                                     | Evaluaciones | Respuestas por alumno | Estadísticas por ítem con máximo |
| ------------------------------------------- | ------------ | --------------------- | -------------------------------- |
| CSCJ, `item_level`                          | 238          | sí                    | sí                               |
| CSCJ, `aggregate_only` (informes oficiales) | 6            | no                    | sí                               |
| San Agustín                                 | 14           | sí                    | sí                               |
| Andes Centro (sintético)                    | 10           | sí                    | sí                               |

- Las 4 evaluaciones del Diagnóstico 2025 cargadas desde el gráfico del informe tienen `percentage`
  por alumno sin puntaje. Igual tienen estadísticas por ítem importadas, así que el % del grupo se
  calcula con la regla. El % de cada alumno sigue siendo el del informe y sólo se usa para su banda.

**Secciones electivas en DIA: ninguna.**

- Sólo 3 instrumentos PAES CIE tienen secciones electivas. Ningún alumno tiene respuestas en más de una
  rama. La guarda del seed DIA 2026 (A-3) queda como prevención.

**Cuánto cambian los números con la regla única.**

| Nivel                                 | Comparación                    | CSCJ                                                   | San Agustín                                |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------ | ------------------------------------------ |
| % general por evaluación              | A (promedio de %) vs B         | máx 0,22 pp (`item_level`), 0,68 pp (`aggregate_only`) | 0                                          |
| % por nodo, origen calculado          | A vs B                         | media 0,04 pp; 12 de 8.120 celdas ≥ 5 pp               | 0                                          |
| % por nodo usado en alertas y muestra | C (aciertos ÷ respuestas) vs B | media 1,35 pp, máx 57 pp; 678 celdas ≥ 5 pp            | media 1,58 pp, máx 39 pp; 43 celdas ≥ 5 pp |

- El cambio visible en las vistas principales es mínimo.
- El cambio grande está en lo que hoy usa la fórmula C: las alertas por nodo y por pregunta, la tabla
  de especificaciones, el panorama del alumno por habilidad y **el "Muestra X%" por nodo**, que hoy
  está desviado hasta 39 pp para San Agustín.

**Pendientes de corrección: el efecto no es menor en CSCJ.**

| Año · período      | Evaluaciones con pendientes | Preguntas pendientes | En blanco | Inflación media | Máx     |
| ------------------ | --------------------------- | -------------------- | --------- | --------------- | ------- |
| 2025 · Diagnóstico | 29                          | 2.910                | 1.829     | 6,5 pp          | 22,3 pp |
| 2025 · Intermedio  | 20                          | 2.357                | 1.814     | 8,7 pp          | 38,0 pp |
| 2025 · Cierre      | 46                          | 2.708                | 2.708     | 4,6 pp          | 20,1 pp |
| 2026 · Diagnóstico | 34                          | 2.140                | 2.140     | 4,2 pp          | 9,2 pp  |
| 2026 · Intermedio  | 12                          | 34                   | 12        | 0,3 pp          | 1,9 pp  |

- "Inflación" = % excluyendo pendientes menos % contándolas como 0.
- 141 de 238 evaluaciones de CSCJ tienen preguntas de desarrollo pendientes: 10.115 respuestas, 8.491
  de ellas en blanco. San Agustín y Andes Centro no tienen.
- **El Monitoreo Intermedio 2026, que es lo que comparten CSCJ y San Agustín en la muestra, casi no se
  ve afectado (0,3 pp).** Las comparaciones contra la muestra de hoy son justas. Una muestra con
  evaluaciones de 2025 no lo sería, porque CSCJ quedaría inflado frente a colegios que corrigieron
  todo.
- **Resuelto con D9:** ninguna evaluación sale de la muestra. La comparación se hace sobre las
  preguntas que el grupo tiene corregidas, y el tooltip lo dice. El % propio de CSCJ en esas
  evaluaciones sigue midiendo sólo lo corregido, y se tolera (D6).
- **Por qué faltan:** el export SAI de la Agencia trae `-` en todo el curso para cada pregunta de
  desarrollo, en 2025 y 2026. Se verificó en los dos archivos y calza 1 a 1 con las posiciones de
  desarrollo de la BDD. Son datos faltantes, no blancos: puntuarlos 0 sería falso.
- **Recuperación posible, fuera de este diseño:**
  - Unas 1.600 respuestas pendientes **sí** tienen respuesta. Son preguntas cerradas (numéricas, de
    selección múltiple, pares ordenados) tipadas como desarrollo en instrumentos 2025 de Matemática 1°,
    5°, 6° y 7° y Ciencias 5°.
  - El puntaje de desarrollo se podría despejar desde el % por dimensión del XLS
    `Resultados_de_estudiantes`.

**Error vivo encontrado: escala del logro por nodo importado (A-7).**

- `MATH intermedio 2025 — 6 A` y `— 6 B` (47 filas cada una, escritas el 2026-07-21) guardan
  `assessment_skill_stats.percentage` en escala 0..1 (p. ej. `0.98`) en vez de 0..100. Hoy esos nodos
  se muestran como "1%".
- El importador actual ya multiplica por 100, así que lo escribió una versión anterior. Se corrige
  con la pasada de re-derivación de A2-5, que reescribe esas filas desde sus estadísticas por ítem.

---

## 9. Inventario de cálculos de % de grupo (checklist de la parte A)

`A` = promedio de % por alumno, `B` = tally, `C` = conteo. Las líneas son de `dev` al 2026-10-06.

| Archivo                                                                 | Función                                                                                                                                      | Hoy             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `assessment-report/assessment-report.service.ts`                        | `buildSummary`, `buildCourseComparison`, `buildSkills`                                                                                       | A               |
| `official-reports/course-report.service.ts`                             | `buildGeneralResult`, `buildSkillAxes`, `buildSkillAxesFromCohort`                                                                           | A               |
| `official-reports/course-report.service.ts` + `lib/item-report-data.ts` | `buildSpecTable`                                                                                                                             | C               |
| `official-reports/student-report.service.ts`                            | `loadClassAverage`                                                                                                                           | A               |
| `official-reports/establishment-report.service.ts`                      | `aggregate` (% mostrado; la prueba usa observaciones por alumno)                                                                             | A               |
| `dashboards/dashboards.service.ts`                                      | `loadRecentAssessments`, `loadSkillsFromCohortStats`, `loadSkillsFromSkillResults`, `loadBreakdownFrom*`, `getTeacherKpis`, `getPerformance` | A               |
| `dashboards/comparable/comparable-unit.assembler.ts`                    | `loadAchievementByAssessment`, `foldAchievement`, `loadClassGroupBreakdown`, `foldByClassGroup`, `baselineAchievement`                       | A / B           |
| `dashboards/comparable-alerts.service.ts`                               | `loadNodeAchievements`, `loadItemRates`                                                                                                      | C               |
| `heatmap/heatmap.service.ts`                                            | `loadCellRows`, `cohortAverage`                                                                                                              | A               |
| `analytics/comparable-trajectory.service.ts`                            | vía el assembler                                                                                                                             | A / B           |
| `item-analysis/item-analysis.service.ts`                                | `aggregateReference` (0 vs null)                                                                                                             | B               |
| `students/student-panorama.service.ts`                                  | `loadBySkill`                                                                                                                                | C               |
| `students/student-comparisons.service.ts`                               | `foldCourses`                                                                                                                                | A               |
| `remedial/generators/group-plan.generator.ts`                           | `computeAggregates`                                                                                                                          | A               |
| `ai-analysis/instrument-comparison.snapshot.ts`                         | `loadAverageAchievement`                                                                                                                     | A               |
| `packages/db/src/queries/benchmark-aggregates.ts`                       | `buildOrgRows`, `perSkill`, `refreshOrgItemAggregates`                                                                                       | A / C / conteos |
| `packages/types/src/utils/benchmark-sample.ts`                          | `aggregateSample`, `aggregateSampleSkills`, `aggregateItemSample`                                                                            | A / C           |
| `packages/types/src/utils/item-stats-calculator.ts`                     | `aggregateCohortSkillStats`                                                                                                                  | A               |
| `apps/api/src/benchmarking/benchmarking.service.ts`                     | comparación, `buildCohortSkills`                                                                                                             | A / C           |
| `apps/web/.../resultados/detalle/cross-table.tsx`                       | `LevelReferenceRow` (total)                                                                                                                  | C               |

Ya cumplen la regla (B): el tablero maestro, `attachCorrectRates`, `loadAnswerDistribution`, el
fallback agregado de `cohort-item-stats.helper.ts` y `aggregateStudentResults` /
`aggregateSkillResults` (por alumno).

**Hallazgo aparte, fuera de este diseño:** `instrument-comparison.snapshot.ts` promedia resultados sin
filtro de alcance. Se registra como ticket separado.
