# Carga de las respuestas SAI 2025 a la BDD demo

Análisis de `Histórico Pruebas DIA/respuestas/sai-identificado/2025/` y plan para llevar esas
respuestas a la BDD demo (org CSCJ `c5c10000-…-000000000001`) de modo que se vean en la plataforma.

Todo lo que sigue está medido contra los archivos y contra la BDD demo (túnel SST, rol `soe_admin`),
no inferido.

---

## 1. Qué hay en la carpeta

92 archivos `.xlsx`, uno por curso × asignatura × momento. Son la **salida de
`scripts/cscj/sai-match/04-emitir.ts`**: el export SAI anónimo de la Agencia ya cruzado con el
informe nominado, con nombre y RUT puestos.

|                                            |                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Archivos                                   | 92 (2025) — hay además 32 de 2026, fuera de este plan               |
| Filas (alumno × prueba)                    | 3.614                                                               |
| Combinaciones momento × nivel × asignatura | 44                                                                  |
| Momentos                                   | Diagnóstico (24 archivos) · Monitoreo Intermedio (24) · Cierre (44) |
| Asignaturas                                | Lectura (44) · Matemática (40) · Ciencias 5° (4) · Historia 6° (4)  |

Todas las planillas tienen exactamente el mismo encabezado:

```
N Lista | Nombre | RUT | metodo | distancia | alu_id | P1 … Pn
```

`metodo` es la calidad del cruce SAI↔nombre: **4.812 filas `vector`** (distancia ≈ 0, reproduce el
informe), 63 `vector-aprox`, 70 `ambiguo` (cifras sobre 2025+2026). En 2025 los `ambiguo` se
concentran en II° Medio Matemática Diagnóstico, Ciencias 5° y Historia 6° — ninguna de las cuales
tiene instrumento en la BDD hoy, así que no afectan a lo cargable.

El curso sale del nombre del archivo (`…_5_a.xlsx`, `…_ii_c_hc_310.xlsx`) y el nivel/asignatura/
momento de la ruta.

---

## 2. Qué se puede cargar hoy: 21 de las 44 combinaciones

El instrumento se resuelve por `(gradeId, subjectId, year, applicationPeriod)` sobre el catálogo
(`instruments.org_id is null`). En 2025 el catálogo tiene **24 instrumentos: 3° a 6° básico,
Lectura y Matemática, en los tres momentos**. Nada más.

**21 combinaciones (42 cursos, 1.704 filas) tienen su instrumento y el Nº de preguntas de la
planilla calza EXACTO con el Nº de ítems del instrumento** — en las 21, sin una sola excepción. Eso
es justo lo que el importador exige (aborta si las posiciones no calzan), así que el riesgo de
"corregir contra el ítem equivocado" está descartado por construcción.

| Momento     | Combinaciones cargables                        |
| ----------- | ---------------------------------------------- |
| Diagnóstico | 3° L, 3° M, 4° L, 4° M, 5° L, 6° L             |
| Intermedio  | 3° L, 3° M, 4° L, 4° M, 5° L, 5° M, 6° L       |
| Cierre      | 3° L, 3° M, 4° L, 4° M, 5° L, 5° M, 6° L, 6° M |

---

## 3. Instrumentos que faltan — 23 combinaciones, 50 cursos, 1.910 filas

Esta es la respuesta a "¿de qué respuestas no tenemos el instrumento?". La columna **ficha** dice si
la pauta ya está parseada en `scripts/cscj/sai-match/out/banco-fichas.json` (o sea, cuánto trabajo
queda para crear el instrumento).

| Momento     | Nivel     | Asig       | Cursos | Filas |   Q | Ficha ya parseada        | Claves |
| ----------- | --------- | ---------- | -----: | ----: | --: | ------------------------ | ------ |
| Diagnóstico | 2° básico | Lectura    |      2 |    75 |  17 | ficha · 17 ítems         | 15/17  |
| Diagnóstico | 8° básico | Lectura    |      2 |    85 |  30 | ficha · 30 ítems         | 28/30  |
| Diagnóstico | 8° básico | Matemática |      2 |    86 |  32 | ficha · 32 ítems         | 31/32  |
| Diagnóstico | II° medio | Lectura    |      3 |   122 |  34 | ficha · 34 ítems         | 32/34  |
| Diagnóstico | II° medio | Matemática |      3 |   122 |  36 | ficha · 36 ítems         | 35/36  |
| Intermedio  | 1° básico | Matemática |      2 |    77 |  28 | **guía** · 28 ítems      | 0/28   |
| Intermedio  | 2° básico | Lectura    |      2 |    79 |  19 | ficha · 19 ítems         | 17/19  |
| Intermedio  | 2° básico | Matemática |      2 |    80 |  18 | **guía · 19 ítems ⚠ Q≠** | 0/19   |
| Intermedio  | 5° básico | Ciencias   |      2 |    77 |  25 | ficha · 25 ítems         | 23/25  |
| Intermedio  | 6° básico | Historia   |      2 |    76 |  26 | ficha · 26 ítems         | 25/26  |
| Cierre      | 1° básico | Matemática |      2 |    88 |  18 | **guía** · 18 ítems      | 0/18   |
| Cierre      | 2° básico | Lectura    |      2 |    85 |  19 | ficha · 19 ítems         | 17/19  |
| Cierre      | 2° básico | Matemática |      2 |    79 |  18 | **guía** · 18 ítems      | 0/18   |
| Cierre      | 5° básico | Ciencias   |      2 |    84 |  25 | ficha · 25 ítems         | 23/25  |
| Cierre      | 6° básico | Historia   |      2 |    81 |  26 | ficha · 26 ítems         | 25/26  |
| Cierre      | 7° básico | Lectura    |      2 |    67 |  30 | ficha · 30 ítems         | 29/30  |
| Cierre      | 7° básico | Matemática |      2 |    73 |  31 | ficha · 31 ítems         | 30/31  |
| Cierre      | 8° básico | Lectura    |      2 |    66 |  31 | ficha · 31 ítems         | 30/31  |
| Cierre      | 8° básico | Matemática |      2 |    69 |  32 | ficha · 32 ítems         | 31/32  |
| Cierre      | I° medio  | Lectura    |      2 |    73 |  35 | ficha · 35 ítems         | 34/35  |
| Cierre      | I° medio  | Matemática |      2 |    77 |  34 | ficha · 34 ítems         | 33/34  |
| Cierre      | II° medio | Lectura    |      3 |    88 |  39 | ficha · 39 ítems         | 38/39  |
| Cierre      | II° medio | Matemática |      3 |   101 |  35 | ficha · 35 ítems         | 34/35  |

Tres grupos, por esfuerzo:

1. **18 combinaciones con ficha técnica parseada y clave casi completa** (los "1 ítem sin clave"
   son las preguntas de desarrollo, que no tienen clave por definición). El Nº de ítems de la ficha
   calza con el de la planilla en las 18. Son las más baratas: sólo falta extraer el cuadernillo
   para tener enunciados, o cargar un instrumento "esqueleto" (posición + tipo + clave + tags).
2. **4 combinaciones de 1° y 2° básico Matemática** cuya pauta viene en **guía didáctica**, no en
   ficha: trae especificaciones pero **no la tabla de claves** (están dentro de imágenes). Hay que
   deducirlas — el motor de `lib/claves-faltantes.ts` ya lo hizo para estos casos con calce 1.0.
3. **⚠ Intermedio 2° básico Matemática**: la guía dice 19 ítems y la planilla trae 18. Hay que
   resolver esa discrepancia antes de cargar, o las posiciones no calzarán.

Nada de Inglés ni Escritura aparece acá: el SAI no exporta las preguntas de desarrollo, y esas dos
asignaturas son 100% de ese tipo, así que no hay respuestas que cargar.

---

## 4. Los 42 cursos cargables YA tienen un assessment. Hay que decidir qué pasa con él

Esto es lo que hay que resolver antes de escribir nada. En 2025 la BDD demo tiene **48 assessments**
de CSCJ, y cubren exactamente los mismos cursos que queremos cargar:

| Origen                                            | Assessments | `data_granularity` | Contenido                                                                                                                                      |
| ------------------------------------------------- | ----------: | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dia_official_report` (`config.source`)           |          40 | `aggregate_only`   | `assessment_item_stats` + `assessment_skill_stats` del informe PDF; `assessment_results` con **todos los puntajes en NULL**; **0 `responses`** |
| `dia-lenguaje-intermedio-2025` (`config.loadKey`) |           8 | `item_level`       | Respuestas reales de la digitación: Lectura Intermedio 3°–6° A/B, sólo selección múltiple                                                      |

Cruce con los 42 cursos que el SAI podría cargar:

- **34 cursos** chocan con un assessment `aggregate_only` (el informe oficial).
- **8 cursos** chocan con el `item_level` ya cargado (Lectura Intermedio 3°–6° A/B).

O sea: **no hay ni un solo curso "libre"**. Si se corre el importador tal cual, la BDD queda con dos
assessments por curso y toda agregación org-wide los cuenta dos veces.

El proyecto ya tiene una regla para esto —
`docs/plan-analitica-agregada-informes-oficiales.md` §9.3: _"granularidad por assessment; en
conflicto gana el granular"_. Aplicada acá significa **reemplazar** el assessment agregado por el
`item_level` del SAI, no convivir con él.

Pero esa regla tiene una deuda abierta (§9.6) que este dato **resuelve parcialmente** — ver §5.

---

## 5. Qué trae y qué NO trae el SAI (medido posición por posición)

Se cruzaron las 1.162 columnas de pregunta de los 92 archivos contra el `type` /
`scoring_config.responseFormat` del ítem correspondiente en la BDD. Sobre los 524 ítems de los 21
combos cargables:

| Tipo de ítem                             | Ítems | Cobertura en el SAI                                                         |
| ---------------------------------------- | ----: | --------------------------------------------------------------------------- |
| `multiple_choice`                        |   456 | **100% con dato** — ni una sola columna vacía para el curso completo        |
| `open_ended` / `fill_in`, `completacion` |    32 | **con dato** (0–14% de celdas vacías, valores reales: `406`, `6/12`, `8,9`) |
| `open_ended` / `develop`                 |    36 | **100% vacías** — el SAI nunca exporta las de desarrollo                    |

Dos consecuencias:

- **En Lectura el SAI es exactamente MC-only**: sus únicos ítems no-MC son de desarrollo. Para los 8
  cursos de Lectura Intermedio ya cargados, el SAI **no aporta nada nuevo** — misma cobertura.
  Recomendación: **no tocarlos**.
- **En Matemática el SAI sí aporta**: los 32 ítems `fill_in`/`completación` traen la respuesta del
  alumno, y hoy en la BDD ese dato no existe en ninguna forma granular.

Esto también acota la deuda §9.6 (el eje _Reflexionar_ compuesto sólo por preguntas de desarrollo):
al reemplazar un informe agregado por el SAI, **se sigue perdiendo la dimensión de desarrollo**,
porque el SAI tampoco la trae. La decisión no cambia; el costo sí queda medido: son 36 ítems de
desarrollo repartidos en 2–3 por instrumento de Lectura y 1 por instrumento de Matemática.

### 5.1 Bloqueo real: los ítems `fill_in` de 2025 no tienen clave en la BDD

Los 86 ítems no-MC de los 24 instrumentos 2025 están cargados **sin `scoringConfig.fillAnswer` ni
`content.correctKey`** (verificado: 0 de 86). Corriendo `getScoringStrategy` sobre una respuesta
real:

```
DIA Matemática 3° Básico 2025 — Diagnóstico P2  fmt=fill_in  fillAnswer=undefined  resp="406"
   → {"isCorrect":null,"rawScore":null,"requiresManualGrading":true}
```

Sin arreglar eso, esos 32 ítems entran como `score null` / pendientes de corrección humana, y el
único aporte real del SAI frente al informe agregado se pierde.

**La clave existe**: `scripts/cscj/sai-match/out/match.json` trae **20 de las 32 deducidas y
validadas** contra el informe oficial (el multiconjunto de porcentajes del curso reproduce el del
informe — con ~40 alumnos por curso una clave errónea lo rompe de inmediato). Las 12 restantes están
en 6 combos de Matemática Intermedio/Cierre y hay que deducirlas con la misma máquina o sacarlas de
la ficha.

Es el mismo backfill de `fillAnswer` que ya se hizo para 2026 en los PR #113/#117.

---

## 6. Alumnos: el cruce por RUT es sólido

Contra el roster real de CSCJ (1.346 alumnos, 1.308 matriculados en 2025):

|                              |   Filas |     % |
| ---------------------------- | ------: | ----: |
| Match por RUT exacto         |   3.468 | 95,9% |
| Match por cuerpo del RUT     |       0 |     — |
| **Sin RUT en la planilla**   | **142** |  3,9% |
| Sin match (RUT tipo `IPE:…`) |       4 |  0,1% |

- **Ningún alumno matcheado quedó en un grado distinto al de su matrícula 2025.** Cero
  inconsistencias.
- Las 142 filas sin RUT son **40 personas** que **no están en el roster** — ninguna calza por nombre.
  Es el hallazgo ya conocido de `project-reconciliacion-roster-dia` (alumnos que rindieron el DIA
  pero no aparecen en la plataforma). El importador **no los inventa**: sin RUT los deja fuera y los
  reporta como `unmatched` en el `import_job`. Si se los quiere incluir, hay que darlos de alta en
  el roster **antes**.
- Las 4 filas `IPE:100734450K` son **una alumna que SÍ está en el roster** con ese mismo string como
  `rut` (Carrascal Llontop, II° C). El importador la dejaría fuera porque `normalizeRut` no acepta
  ese formato. Sólo afecta a II° medio, que hoy no tiene instrumento — pero hay que arreglarlo antes
  de cargar II°.

---

## 7. Lo que se ejecutó (2026-08-10)

Decisión tomada: **reemplazar** el informe agregado por el dato granular (§9.3 del plan de
analítica agregada), y **no tocar** los 8 cursos de Lectura Intermedio ya cargados, porque el SAI
tiene exactamente la misma cobertura que ellos (sólo selección múltiple).

### 7.1 Resultado

**34 cursos cargados · 1.372 filas · 32.715 respuestas por alumno.**

| Lote (`config.loadKey`) | Cursos | Responses | assessment_results | skill_results |
| ----------------------- | -----: | --------: | -----------------: | ------------: |
| `sai-2025-diagnostico`  |     12 |    11.511 |                483 |        14.211 |
| `sai-2025-intermedio`   |      6 |     6.050 |                242 |        11.528 |
| `sai-2025-cierre`       |     16 |    15.154 |                592 |        20.670 |

Además: **31 ítems de respuesta corta pasaron de `open_ended` a `short_answer`** con su clave, así
que ahora se autocorrigen. Tras eso, cada alumno de Matemática quedó con **1 sola** pregunta
pendiente (la de desarrollo) en vez de 5 a 8.

| Asignatura              | Respuestas | Corregidas | Pendientes |
| ----------------------- | ---------: | ---------: | ---------: |
| Lenguaje y Comunicación |     15.171 |     13.836 |      1.335 |
| Matemáticas             |     17.544 |     16.775 |        769 |

Las pendientes son exclusivamente **preguntas de desarrollo**, que el SAI no exporta. No están
"sin corregir por un error": no existe la respuesta del alumno en esta fuente.

### 7.2 El pipeline, en `scripts/cscj/sai-2025/`

| Paso | Script                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------- |
| 1    | `01-convertir-respuestas.ts` — planillas SAI → un artefacto por momento                            |
| 2    | `02-validar-contra-informe.ts` — corrige el SAI y lo compara con el informe, **antes** de escribir |
| 3    | `03-respaldar-agregados.ts` — vuelca a JSON los 34 assessments que se van a reemplazar             |
| 4    | `packages/db/src/seed/import-dia-2026-responses.ts --year=2025 --administeredAt=…`                 |
| 5    | `05-deducir-claves-respuesta-corta.ts` — deduce las claves y las emite en formato de extracción    |
| 6    | `packages/db/src/scripts/load-fill-answers.ts --year=2025` — retipa a `short_answer`               |
| 7    | re-correr el paso 4 (idempotente por `loadKey`) para re-corregir                                   |
| 8    | `04-borrar-agregados.ts` — borra los agregados reemplazados                                        |

Un `loadKey` por momento y no uno global: el importador borra por `loadKey` antes de insertar, así
que el lote acota el borrado a lo que ese mismo lote reescribe. Acotar con `--only` sobre un
artefacto global no acota el borrado.

**Cambio al importador**: se le agregó `--administeredAt=YYYY-MM-DD` (por defecto, hoy — el
comportamiento anterior). Hacía falta porque `resolveAssessmentYear` deriva el año lectivo de esa
fecha para bucketizar el read-model: fechar una evaluación de 2025 con la fecha de hoy la habría
anclado a 2026. Se usó 2025-04-30 / 2025-08-31 / 2025-11-30, que son **fechas aproximadas** dentro
de la ventana de cada momento, no la fecha real de aplicación.

### 7.3 Cómo se verificó

Dos pasadas contra el informe oficial de la Agencia, que es una fuente **independiente** del SAI:

1. **Antes de escribir** — corregir las respuestas del SAI con la clave del instrumento y comparar
   el conteo de correctas por ítem contra `assessment_item_stats` del informe:
   **730 ítems reproducen el informe, 0 difieren.** Eso valida a la vez la alineación de posiciones,
   la clave de cada ítem y el cruce alumno↔RUT: un desalineamiento de una posición rompe el conteo
   de inmediato.
2. **Después de cargar** — el mismo cruce contra el read-model ya persistido:
   **259 ítems exactos, 533 que difieren sólo por alumnos ausentes del bucket, 0 fuera de lo
   explicable.** Los márgenes por curso van de 1 a 5 alumnos y coinciden con los que no tienen RUT.

### 7.4 Cómo se dedujeron las claves de respuesta corta

Los 86 ítems no-MC de 2025 estaban cargados **sin clave** (0 de 86), y `open_ended` va a
`manualGradingStrategy`: nunca autocorrige, tenga o no `fillAnswer`. El tipo que sí corrige un valor
escrito es `short_answer` con `content.acceptedAnswers`.

La clave no se adivinó. Se buscó contra el `correct_count` por ítem y por curso del informe oficial
—respaldado en el paso 3 antes de borrarlo—: una clave es válida sólo si, aplicada a las respuestas
del SAI, reproduce EXACTO el conteo de correctas de **los dos cursos** del nivel. Con ~40 alumnos
por curso y dos observaciones independientes, una clave equivocada no sobrevive. **31 deducidas, 0
ambiguas.**

Dos claves las rechazó el piso de acierto de `load-fill-answers.ts` (Matemática 4° Intermedio P6 y
P11: 11% y 5% de acierto, con la mayoría del curso convergiendo en otro valor). Se cargaron igual,
con `--min-agreement=0` y en una corrida aparte, porque ahí el guard no aplica: el informe oficial
dice que sólo 3 y 5 alumnos acertaron P6, y 1 y 3 acertaron P11. La mayoría está equivocada, no la
clave — son ítems con un distractor muy fuerte (`9/24` por `9/12`).

### 7.5 Lo que quedó fuera, y por qué

- **55 filas (4%) no se cargaron**: son alumnos **sin RUT** en la planilla, que no están en el
  roster. El importador no los inventa — quedan reportados en el `errorLog` de su `import_job`.
  Para incluirlos hay que darlos de alta primero.
- **Un alumno** (Alviarez Enamorado) rindió con 5°B pero está matriculado en 5°A: el read-model lo
  bucketea por su matrícula real, que es el comportamiento documentado.
- **1 ítem sin clave**: Matemática 3° Diagnóstico P22 (completación). El informe no marca ninguna
  alternativa como correcta, así que no hay referencia contra la cual deducir. Queda pendiente.
- **Los ítems de desarrollo** siguen sin respuesta por alumno. Al reemplazar el informe agregado se
  perdió su dimensión, que es el costo medido de la decisión §9.3 (deuda §9.6 del plan de analítica
  agregada): 2-3 ítems por instrumento de Lectura, 1 por instrumento de Matemática.
- **Los 6 informes agregados que quedan** son de Matemática 5° y 6° Diagnóstico y 6° Intermedio: el
  SAI no trae esas combinaciones, así que conservan su informe oficial intacto.

---

## 8. Lo que sigue

1. **Construir los 23 instrumentos que faltan** (§3) — desbloquearía 50 cursos y 1.910 filas más,
   incluidos todo 7°, 8° y media, que hoy no tienen ningún dato. 18 ya tienen la ficha parseada.
2. **Dar de alta a los 40 alumnos que no están en el roster**, si se quiere recuperar esas 142 filas
   (55 en los cursos ya cargados).
3. **Revisar `Intermedio 2° básico Matemática`**: la guía didáctica declara 19 ítems y la planilla
   trae 18. Hay que resolverlo antes de crear ese instrumento.
4. **Corregir el RUT tipo `IPE:…`**: `normalizeRut` lo rechaza, así que esa alumna quedaría fuera
   de cualquier carga de II° medio.
5. Fechas de aplicación reales, si se quieren en vez de las aproximadas de §7.2.
