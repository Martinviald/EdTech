# Diseño — Resultados generales de un proceso de medición

> **Qué es esto:** diseño de la vista que falta en `/procesos/[processId]`: la que responde
> "¿cómo nos fue?". Hoy el hub del proceso responde "¿cuánto se rindió?" (pestaña Resumen) y
> "¿qué celda falta cargar?" (pestaña Rendición), y en ninguna parte aparece un resultado.
>
> **Estado:** 🔲 diseño propuesto, sin implementar. **Fecha:** 2026-09-27.
> **Rama/worktree:** `fix/alertas-key` en `wt-procesos-medicion`.
> **Relacionado:** `docs/diseno-procesos-de-medicion.md`, `docs/diseno-entrada-por-proceso.md`,
> `docs/diseno-panorama-comparable.md` (el que fija la restricción #1C que gobierna todo esto).

---

## 1. Resumen

El pedido, en palabras del usuario:

> "en la sección de detalles de una medición en ninguna parte aparece los resultados por nivel,
> por asignatura y cosas por el estilo, sería bueno mostrar eso como vista general de la medición"

La respuesta corta de este diseño:

1. **Sí se puede mostrar un resultado general del proceso, y la regla que lo permite es una sola:
   se suman clasificaciones, no se promedian puntajes.** Un % de logro promedio entre instrumentos
   no tiene escala; un conteo de alumnos por nivel sí, porque a cada alumno lo clasificó el corte
   de su propia prueba. El producto ya afirma exactamente eso para ordenar el panorama
   (`packages/types/src/comparability.ts:233-242`).
2. **"Por asignatura" no es una medición: es navegación.** Medido en la org sintética, las cuatro
   asignaturas del proceso Diagnóstico caen en 26,6 / 26,3 / 26,2 / 16,5 % de alumnos en el nivel
   más bajo — planas —, mientras las celdas individuales van de 0 % a 78 %. Agregar por asignatura
   borra la señal; el grano donde vive es la celda **asignatura × nivel**, que es exactamente una
   unidad comparable.
3. **La vista es una sección del Resumen, no una pestaña nueva ni un reemplazo del panorama.** El
   resultado va pegado a su denominador de cobertura, porque un titular calculado sobre un tercio
   de las celdas cargadas es una mentira por omisión — y el proceso es el único objeto del sistema
   que conoce ese denominador.
4. **Cuesta cero consultas nuevas.** Todo sale de `GET /dashboards/comparable-overview?processId=…`
   —que ya acepta ese filtro— más el `/coverage` que la página ya pide, plegados por una función
   pura en `packages/types`. No hay endpoint nuevo, ni migración, ni query nueva.

---

## 2. El problema

`/procesos/[processId]` tiene hoy dos pestañas
(`apps/web/src/app/(dashboard)/procesos/[processId]/layout.tsx:40-43`):

| Pestaña       | Qué muestra                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resumen**   | 3 KPIs (cobertura, evaluaciones, alumnos), barra de avance de rendición y una lista plana de accesos directos (`page.tsx:85-104`, `:106-126`, `:145-205`) |
| **Rendición** | matriz curso × asignatura con el estado de carga de cada celda (`rendicion/page.tsx:25-54`)                                                               |

Las dos responden la misma familia de preguntas: **cuánto se rindió y cuánto falta cargar**.
Ninguna dice qué dieron los resultados. El usuario que acaba de cerrar un proceso entra al objeto
que representa ese proceso y tiene que salir de él para saber cómo le fue.

El diseño original lo decidió a propósito y lo dejó escrito:

> **No existe `/measurement-processes/:id/results`.** Un endpoint propio de resultados habría
> duplicado la lógica del panorama.
> — `docs/diseno-procesos-de-medicion.md:254`

> Dos tabs, no tres: los resultados son el panorama existente acotado por `processId`.
> — `docs/diseno-procesos-de-medicion.md:297`

**Esa decisión sigue siendo correcta y este diseño no la revierte.** No se construye un endpoint de
resultados del proceso ni se reimplementa el panorama. Lo que sí cambia es el diagnóstico de qué
falta: no falta _el panorama dentro del proceso_, falta **una síntesis que el panorama, por
contrato, no puede producir**.

### 2.1 Por qué el enlace a `/resultados?processId=X` no alcanza

Es la pregunta que hay que contestar antes de escribir una línea, porque si la respuesta honesta
es "nada justifica una vista propia", eso es una conclusión válida. No lo es, y la razón es
precisa.

`/resultados?processId=X` ya funciona y ya muestra bastante
(`apps/web/src/app/(dashboard)/resultados/page.tsx:143-192`): tres conteos, la banda de alertas en
vivo, el banner generacional, el cartel de comparabilidad y **una fila por unidad comparable
ordenada por severidad** (`comparable-units-table.tsx`). Más la banda de previsualización del
proceso arriba de todo (`process-preview-banner.tsx`), que ya trae nombre, ventana, cobertura,
alertas por severidad y las 3 unidades más graves.

Lo que ese panorama **no hace, y no debe hacer**, es agregar. Su contrato es explícito: "Una fila
por instrumento. El % de logro sólo se puede leer dentro de una misma evaluación, así que no hay
un promedio que las resuma" (`comparable-units-table.tsx:96-99`). Con un proceso de 32
instrumentos, el director recibe **32 filas** y la síntesis la tiene que hacer en su cabeza.

Y hay una cosa que el panorama **no puede** hacer aunque quisiera: cruzar resultados con las
celdas que faltan. El panorama sólo conoce evaluaciones que existen; las celdas vacías son
invisibles ahí (es el mismo agujero que `docs/diseno-entrada-por-proceso.md` §D6 documenta para
`/evaluaciones`). El denominador —qué _debía_ rendirse— vive únicamente en
`measurement_processes.expected_scope`, y ese es el aporte central del objeto proceso.

**Conclusión:** la vista nueva se justifica por dos cosas que el panorama no entrega y no debería:
la **síntesis por conteo** y el **cruce con el denominador**. Todo lo demás —alertas, tabla de
unidades, filtros ricos— se deja donde está y se enlaza.

---

## 3. La tensión de fondo: ¿se puede contar por nivel sumando instrumentos distintos?

### 3.1 Lo que #1C prohíbe

`docs/diseno-panorama-comparable.md` eliminó el "% de logro global" con un argumento que no admite
excepción de conveniencia: promediar instrumentos de distinta dificultad y distinta escala no
produce un número interpretable. Un DIA cuyo Nivel 1 corta en 40 % y un curso en 55 % está bien; con
un umbral absoluto salía alertado igual.

Un proceso agrupa muchos instrumentos —en la org sintética, 4 asignaturas × 8 grados = **32
instrumentos**—, así que "resultados por nivel del proceso completo" roza esa prohibición de
frente. No se resuelve invocando que "un conteo no es un promedio": `studentsEvaluated` y
`assessmentsCount` se emiten siempre porque **son conteos sin etiqueta**
(`packages/types/src/schemas/dashboard.schema.ts:173-176`), y acá la etiqueta es justamente el
problema. "Nivel 1" no es un número, es un juicio, y hay que probar que el juicio significa lo
mismo en los 32 instrumentos antes de sumarlo.

### 3.2 Lo que el producto ya afirma

No hay que inventar el argumento: ya está escrito en el módulo que define la comparabilidad.

```
Se expresan como % de alumnos, NO como % de logro: un corte absoluto de logro
(el viejo "curso bajo 60%") no significa lo mismo en instrumentos con cortes
distintos, que es justo lo que #1C corrige. "Cuántos alumnos quedaron en el nivel
más bajo de SU instrumento" sí es comparable entre instrumentos.
```

— `packages/types/src/comparability.ts:233-240`, encabezando `SEVERITY_LOWEST_BAND_THRESHOLDS`
(`:242`).

Y no es una declaración decorativa: el producto **ya compara instrumentos entre sí con ese
criterio**. El mismo umbral (40 % / 25 % de alumnos en la banda inferior) se aplica a un DIA de
Matemática 2° y a uno de Lenguaje 7° para decidir cuál se pinta rojo y cuál verde, en la misma
tabla, una fila al lado de la otra (`severityFromLowestBandShare`, `comparability.ts:256-262`;
render en `comparable-units-table.tsx:139-147`).

### 3.3 La regla

> **Se suman clasificaciones; no se promedian puntajes.**

El argumento, en tres pasos:

1. **El puntaje vive en la escala del instrumento.** Un 55 % en una prueba difícil y un 55 % en una
   fácil no son el mismo hecho. Promediarlos produce un número cuya unidad no existe. Eso es #1C y
   no se toca.
2. **La banda no vive en esa escala: es el dispositivo que la normaliza.** El corte de un
   instrumento se fija _para que_ la etiqueta signifique lo mismo que en otro instrumento. Que los
   cortes difieran entre pruebas no es evidencia de que las etiquetas no sean comparables: es
   evidencia de que alguien trabajó para que lo fueran. La clasificación de un alumno es un
   veredicto emitido por el criterio de su propia prueba.
3. **Sumar veredictos es contar personas.** "539 clasificaciones en el nivel más bajo de su propia
   prueba, sobre 2.253" no promedia nada, no inventa una escala y no compara un 55 % con otro 55 %.
   Y no agrega ninguna afirmación nueva: es la misma afirmación que el panorama ya hace 32 veces
   por separado, sumada.

La frontera es nítida y hay que sostenerla en el código: **de una unidad comparable se puede leer
un % de logro; del proceso entero, sólo conteos de clasificaciones.**

### 3.4 Los cuatro bordes de la regla

Sin estos cuatro límites la regla se convierte en la excusa que #1C existe para prevenir.

| #      | Borde                                     | Regla operativa                                                                                                                                                                                                                                                                                        |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **L1** | **Misma escalera**                        | Sólo se suman en una misma barra las unidades cuyo conjunto de bandas es idéntico en estructura ordinal (misma cantidad, mismas `key`, mismo `order`). Un instrumento de 3 niveles y uno de 6 CEFR no comparten barra. Clave de escalera: la concatenación de `order` y `key` de cada banda, en orden. |
| **L2** | **La unidad contada es la clasificación** | Un alumno que rindió 4 asignaturas aporta 4 clasificaciones. El eje se llama "clasificaciones" o "resultados", **nunca "alumnos"**. El conteo de alumnos distintos es otro número y ya existe (`process-coverage.service.ts:60`).                                                                      |
| **L3** | **Nada de titular contra titular**        | El conteo de un proceso no se resta del de otro: la composición de unidades cambia y el delta mide la mezcla, no el aprendizaje (Simpson). La comparación legítima entre procesos es **por celda**, y ya está construida (`baseline` / `previous_period` de cada unidad).                              |
| **L4** | **Procedencia del corte**                 | La regla presupone que el corte está calibrado _para ese instrumento_. Cuando el instrumento arrastra el corte genérico, "Nivel 1" vuelve a ser un umbral absoluto y la comparabilidad es supuesta, no medida. Hay que poder decirlo (ver §3.5 y P3).                                                  |

### 3.5 Lo que dicen los datos locales

Medido en `postgresql://macbook@localhost:5432/soe_dev`, org sintética
`5eed0000-0000-4000-8000-000000000001`, sólo lectura.

**Los tres procesos** (24 cursos × 4 asignaturas = **96 celdas esperadas** cada uno):

| Proceso                  | Estado        | Evaluaciones (con resultados) | Instrumentos           | Alumnos distintos | Clasificaciones | de 2.496 esperadas |
| ------------------------ | ------------- | ----------------------------- | ---------------------- | ----------------- | --------------- | ------------------ |
| DIA Diagnóstico 2026     | `closed`      | 93 (93)                       | 32                     | 624               | 2.253           | 90,3 %             |
| DIA Monitoreo Intermedio | `closed`      | 78 (75)                       | 32                     | 624               | 1.755           | 70,3 %             |
| DIA Cierre 2026          | `in_progress` | 44 (35)                       | 26 (24 con resultados) | 490               | 850             | 34,1 %             |

(2.496 = 624 matrículas activas × 4 asignaturas; una evaluación cubre exactamente un curso en esta
org, verificado.)

**El conteo por nivel que la vista mostraría** (reclasificando cada resultado con las bandas de su
instrumento, igual que hace `foldBandDistribution`):

| Proceso     | Nivel 1 | Nivel 2 | Nivel 3 | % en el nivel más bajo |
| ----------- | ------- | ------- | ------- | ---------------------- |
| Diagnóstico | 539     | 1.383   | 331     | 23,9 %                 |
| Monitoreo   | 403     | 1.068   | 284     | 23,0 %                 |
| Cierre      | 156     | 561     | 133     | 18,4 %                 |

**Severidad por unidad** (regla vigente: ≥40 % alta, ≥25 % media): Diagnóstico 10 altas / 2 medias
/ 20 bajas, con el share de nivel inferior repartido entre **0 % y 78,2 %**; Monitoreo 9/3/20;
Cierre 7/3/14.

**Por asignatura, el número se aplana** (Diagnóstico, % en el nivel más bajo): Historia 26,6 ·
Ciencias 26,3 · Matemáticas 26,2 · Lenguaje 16,5. **Por celda, no**: Historia 2° 64 %, Matemáticas
2° 60 %, Matemáticas 1° 55 % … contra Matemáticas 3° 0 %, Lenguaje 3° 1 %, Ciencias 1° 1 %. Cuatro
números casi iguales tapan un rango de 64 puntos. Este dato manda sobre la decisión D5.

**El efecto composición es real y medible** (L3): el 23,9 % del Diagnóstico, restringido a las
celdas que el Cierre alcanzó a cubrir, es **24,6 %** (1.737 clasificaciones); el resto de las
celdas da 21,5 %. El delta ingenuo contra el Cierre sería −5,5 pp; el delta pareado es −6,2 pp. En
estos datos la diferencia es chica, pero **nada garantiza que lo sea**, y con 52 de 96 celdas sin
cargar es exactamente donde muerde.

**⚠️ Lo que estos datos NO pueden validar (L4).** Los 96 instrumentos de la org sintética usan los
**mismos tres cortes genéricos**: Nivel 1 `[0 – 0,40)`, Nivel 2 `[0,40 – 0,80)`, Nivel 3
`[0,80 – 1]`, con las mismas `key` (`dia_nivel_1/2/3`) y las mismas etiquetas. Dispersión del
umbral: **cero**. En toda la base hay 122 instrumentos con bandas: **97 con el corte genérico
0,40/0,80** y ~25 con cortes propios medidos (0,3400 · 0,4390 · 0,4440 · 0,4480 · 0,4780 …). Es
decir: en esta org, "Nivel 1" _es_ un umbral absoluto del 40 % aplicado a instrumentos de distinta
dificultad — el antipatrón de #1C, disfrazado de banda. La regla de §3.3 **no se apoya en estos
datos**: se apoya en que los cortes sean del instrumento, que es como están cargados los ~25
instrumentos reales. La verificación visual honesta hay que hacerla contra esos, no contra la org
sintética (ver R1 y P3).

**Un hallazgo que conviene registrar:** `assessment_results.performance_band_id` está en **NULL en
el 100 %** de las 4.858 filas de los tres procesos, y `assessment_level_stats` tiene **0 filas en
toda la base**. La distribución por banda no se rompe por eso: `foldBandDistribution`
(`apps/api/src/dashboards/comparable/comparable-unit.assembler.ts:213-236`) cae al tercer camino y
clasifica el `percentage` de cada fila con las bandas del instrumento, usando la única regla que
existe (`classifyByBands`, `:222`). El conteo del proceso hereda ese camino, con lo bueno y lo malo
(ver R3).

---

## 4. Decisiones

### D1 — Se suman clasificaciones, no se promedian puntajes

La regla de §3.3, con sus cuatro bordes (§3.4), es el contrato del diseño. El proceso **nunca**
emite un % de logro; emite conteos de clasificaciones por banda. El % de logro sigue existiendo
donde siempre: dentro de una unidad comparable (`ComparableUnitSummary.averageAchievement`,
`packages/types/src/schemas/comparable-overview.schema.ts:61`).

**Alternativa descartada — el % de logro promedio del proceso, ponderado por alumnos.** Es
literalmente `globalAchievement`, que #1C borró del contrato sin período deprecated
(decisión F del panorama) justamente porque dejar el campo es cómo vuelve a aparecer. No se
reintroduce con otro nombre.

**Alternativa descartada — normalizar cada puntaje contra el corte de su instrumento** (por
ejemplo, "% de logro relativo al umbral de Nivel 2") para poder promediar. Produce un número
comparable en teoría y **ilegible en la práctica**: nadie en un colegio sabe qué es un 1,08 de
logro relativo, y el primer uso sería compararlo con un 55 % de otra vista. Se descarta por
inentendible, no por incorrecto.

### D2 — Una barra por escalera de bandas, nunca una barra mezclada

Implementa L1. Si todas las unidades comparten escalera —el caso DIA, y el 100 % de los datos
locales— hay exactamente una barra. Si conviven dos escaleras, hay dos barras rotuladas, y jamás
una sola con los ordinales alineados a la fuerza.

**Alternativa descartada — mapear escaleras distintas a una escala canónica de 3 niveles.** Es
inventar una equivalencia que nadie midió (¿B1 de Cambridge es "Nivel 2"?). Exactamente el defecto
**D9** del panorama, que tomaba los thresholds del primer instrumento que matcheara y los aplicaba
a toda la matriz.

### D3 — El eje se llama "clasificaciones", y el conteo de alumnos se muestra aparte

Implementa L2, y además corrige una ambigüedad que ya existe hoy: la pestaña Resumen muestra
"Alumnos evaluados: 624" (`process-coverage.service.ts:60`, `countDistinct(studentId)`), mientras
que el panorama del mismo proceso muestra "Alumnos evaluados: 2.253"
(`comparable-overview.service.ts:103`, suma de `studentsAssessed` sobre unidades). Dos números con
la misma etiqueta en dos pantallas contiguas, y ninguno está mal: miden cosas distintas.

La sección nueva muestra los dos, nombrados: **624 alumnos · 2.253 clasificaciones**. Corregir la
etiqueta del panorama queda fuera de alcance y se anota en P4 — pero la vista nueva no puede
heredar la confusión.

### D4 — Ningún resultado sin su denominador, y el denominador va primero

El titular se renderiza **siempre** acompañado, en la misma tarjeta, de la línea de cobertura:
"850 clasificaciones sobre 2.496 esperadas · 44 de 96 celdas". No es un pie de página: es la
primera línea que se lee.

La razón no es estética. El Cierre local tiene 34 % de sus clasificaciones cargadas, y su titular
(18,4 % en el nivel más bajo) es el **más optimista de los tres procesos** justamente porque las
celdas que faltan son las que faltan. Un titular sin denominador invita a leer un problema de
carga como una mejora de aprendizaje.

**Consecuencia de diseño:** esto es lo que decide que la sección viva pegada a la cobertura (D7) y
no en una pestaña aparte donde se la pueda leer sola.

### D5 — "Por asignatura" es navegación, no medición

Bajo el título "por asignatura" **no** va un número de logro ni un share agregado como titular. Va,
por asignatura: cuántas unidades tiene, cuántas clasificaciones, **cuántas de sus unidades están en
cada severidad**, y **cuál es su peor celda** (con enlace).

Lo respalda el dato de §3.5: las cuatro asignaturas del Diagnóstico caen entre 16,5 % y 26,6 %
mientras sus celdas van de 0 % a 78 %. Un promedio por asignatura no es ilegítimo por incomparable
—el conteo de clasificaciones sí se puede sumar por L1— sino **inútil**: dice que las cuatro
asignaturas están igual, cuando lo que pasa es que cada una tiene dos niveles en rojo y seis bien.
Mostrar un número que borra la señal es peor que no mostrarlo.

La misma lógica aplica a "por nivel/grado", que cruza asignaturas.

### D6 — La vista principal es una matriz nivel × asignatura pintada por presencia y severidad

Filas = grados, columnas = asignaturas, una celda por unidad comparable. En la org sintética eso es
una grilla de 8 × 4 = 32 celdas, que es exactamente el conjunto de unidades: la grilla no agrega
nada, **sólo cambia el orden de la lista por una posición que codifica identidad**.

Cada celda pinta:

- color por **severidad** de la unidad (`high`/`medium`/`low`), la escala ordinal de 3 valores que
  el producto ya usa en el punto de la tabla del panorama;
- el **% de alumnos en el nivel más bajo de esa prueba** y su N;
- si no hay unidad: el **estado de cobertura** de esa celda (`missing` / `scheduled`), tomado de
  `/coverage`;
- si la unidad no tiene bandas: neutra, con "sin niveles configurados". Nunca verde.

**Esto contradice en apariencia la §8.1 del panorama, y hay que mirarlo de frente.** Esa sección
decidió que la matriz de unidades fuera una lista ordenada y no un cruce, porque "la celda
(3° Básico, Lenguaje) y la celda (8° Básico, Matemática) vienen de instrumentos distintos… pintarlas
en la misma escala invita exactamente a la comparación que #1C elimina"
(`docs/diseno-panorama-comparable.md:489-506`). Dos cosas:

1. Lo que §8.1 prohíbe es pintar **un % de logro** en escala compartida. Acá la celda pinta
   severidad, que es la concentración en la banda inferior _de su propio instrumento_ — la
   magnitud que `comparability.ts:233-240` declara comparable entre instrumentos y con la que el
   producto ya ordena el panorama.
2. La propia §8.1 deja la puerta abierta y describe esta vista:

   > **Lo único que el cruce hacía mejor** es mostrar los HUECOS de cobertura (qué nivel ×
   > asignatura no tiene evaluación). … Si algún día se quiere la grilla completa de cobertura,
   > debe pintar **presencia y severidad**, nunca un % en escala compartida.
   > — `docs/diseno-panorama-comparable.md:507-511`

   Presencia y severidad es literalmente lo que esta matriz pinta. Y el lugar donde los huecos
   importan es el proceso, que es el único objeto con denominador.

**Alternativa descartada — repetir la lista ordenada por severidad dentro del proceso.** Ya existe
en `/resultados?processId=…` y ordenar por urgencia es su trabajo. Duplicarla acá sería la vista
nueva que la §5 de `diseno-procesos-de-medicion.md` decidió no construir. Desde la matriz se enlaza
a esa lista.

### D7 — Sección dentro de la pestaña Resumen; no una pestaña nueva, no un reemplazo

`/procesos/[processId]` sigue teniendo dos pestañas. El Resumen queda así, de arriba abajo:

| #   | Bloque                                         | Pregunta que contesta          | Origen del dato                                         |
| --- | ---------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| 1   | Cabecera de conteos + avance de rendición      | ¿puedo creerle a esto?         | `/measurement-processes/:id` (ya se pide)               |
| 2   | **Barra de niveles + titular con denominador** | ¿de qué tamaño es el problema? | `comparable-overview` + D1/D4                           |
| 3   | **Matriz nivel × asignatura**                  | ¿dónde está?                   | `comparable-overview` + `/coverage` (ambos ya se piden) |
| 4   | **Movimiento: las celdas que más cayeron**     | ¿qué cambió?                   | `units[].baseline` y `generational`, ya calculados      |
| 5   | Lo más urgente (máx. 3) + "Ver panorama"       | ¿qué hago mañana?              | `alerts` del mismo payload                              |

El orden es el de la confianza: **primero si el dato está completo, después el tamaño, después la
ubicación, después el movimiento, al final la acción.** Un director que entra el lunes siguiente al
cierre lee 1 y 2 en tres segundos y decide si sigue leyendo.

Por qué sección y no pestaña: por D4. Si los resultados viven en su propia pestaña, se pueden leer
sin ver la cobertura, y el proceso a medio cargar —que es el estado normal mientras el proceso está
vivo— se lee como si estuviera completo. Pegados, el denominador es inevitable.

**Alternativa descartada — reemplazar la pestaña Resumen.** Los KPIs y los diálogos de gestión son
de quien administra el proceso y se usan durante la carga; sacarlos rompe el flujo de trabajo que
la Rendición sostiene.

**Alternativa descartada — poner esto en la banda de previsualización de `/resultados`.** Es
tentador (la banda ya compone datos del proceso) pero la banda es un _aviso de filtro activo_, no
la vista del proceso; y crecería hasta tapar el panorama que encabeza. Queda como P2.

### D8 — Cero endpoints nuevos: una función pura sobre el payload que ya existe

El plegado vive en `packages/types/src/utils/process-rollup.ts` como función pura
`deriveProcessRollup(units, coverage)`, siguiendo exactamente el precedente de
`deriveGenerationalHighlights` (`packages/types/src/utils/generational-highlights.ts:20`): toda la
información ya viaja en `units`, la regla se prueba sola y se puede llamar desde el servidor o
desde la web.

Se llama **desde la web** (RSC del hub del proceso), no desde el servicio. Razón: el panorama no
necesita el plegado, y meterlo en `ComparableOverviewResponse` haría que cada request de
`/resultados` cargue una estructura que sólo lee una página. Si algún día lo necesita el asistente,
la función ya está en `@soe/types` y se emite sin mover código.

**Alternativa descartada — `GET /measurement-processes/:id/results`.** Es el endpoint que
`diseno-procesos-de-medicion.md:254` decidió no construir, y la razón sigue vigente: duplicaría el
armado de unidades, el resolver de bandas y el de baselines, con el riesgo de que los dos caminos
devuelvan números distintos para el mismo proceso.

### D9 — El movimiento es por celda; no hay delta de titular contra titular

Implementa L3. El bloque 4 muestra las 3-5 **celdas** con mayor caída contra su propio comparable,
que es lo que `attachBaselines` ya resuelve por unidad
(`comparable-overview.service.ts:307-363`) y lo que `deriveGenerationalHighlights` ya pliega por
(asignatura × nivel). El proceso no resta su conteo contra el del proceso anterior, ni siquiera
cuando los dos están cerrados.

### D10 — Lo que no se puede clasificar se cuenta aparte y se dice

Una unidad sin bandas tiene `bands`, `bandDistribution`, `lowestBandShare` y `severity` en `null`
(`comparable-overview.service.ts:255-305`; `severityFromLowestBandShare` retorna `null` si el share
es `null`, `comparability.ts:257`). Sus clasificaciones **no entran** en la barra y **no
desaparecen**: se muestran como "N clasificaciones en M instrumentos sin niveles configurados", con
enlace a configurarlos. Es la lección de `loadRecentAssessments`: nunca truncar en silencio.

### D11 — `aggregatable === false` es la condición normal de un proceso, no un error

Un proceso de 32 instrumentos resuelve siempre `kind: 'mixed'`, `aggregatable: false`, con el
`reason` "Estás viendo 32 instrumentos distintos…" (`comparability.ts:165-166`). Mostrar ahí el
`ComparabilityNotice` del panorama —"Resultados de varios instrumentos", tono de advertencia—
sería gritar en cada visita que la vista no puede hacer lo que efectivamente no está haciendo.

Regla: la sección **no** renderiza ese cartel. En su lugar lleva una nota de una línea bajo la
barra: _"Cada alumno está clasificado con el corte de su propia prueba; por eso se cuentan alumnos
y no se promedian porcentajes."_ El cartel completo sí aparece, y con su `reason`, cuando **hay más
de una escalera de bandas** (D2), que es el caso en que el usuario sí tiene que entender por qué ve
dos barras.

---

## 5. Contrato

### 5.1 `packages/types` — tipos nuevos (ningún tipo existente cambia de forma, salvo §5.2)

`packages/types/src/utils/process-rollup.ts` _(nuevo)_. Los comentarios del bloque son de este
documento: la implementación sigue `.claude/rules/backend/02-no-comments.md` y lleva los nombres,
no las explicaciones.

```ts
/** Una escalera de bandas: unidades que comparten estructura ordinal (L1). */
export type ProcessLadderRollup = {
  ladderKey: string; // `${order}:${key}` de cada banda, en orden
  bands: PerformanceBandView[]; // la escalera, para rotular y colorear
  buckets: Array<{
    key: string;
    label: string;
    order: number;
    color: string | null;
    classifications: number; // CONTEO, no promedio (D1/L2)
    percentage: number; // 0..100 dentro de esta escalera
  }>;
  classifications: number; // total plegado en esta escalera
  units: number;
  lowestBandShare: number | null; // % en la banda inferior, 0..100
};

/** Una celda de la matriz nivel × asignatura (D6). */
export type ProcessMatrixCell = {
  gradeId: string | null;
  gradeName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  unitKeys: string[]; // >1 cuando la celda tiene varios instrumentos
  severity: UnitSeverity | null; // la peor de sus unidades
  lowestBandShare: number | null;
  classifications: number;
  /** Estado de carga cuando la celda no tiene resultados. `null` si los tiene. */
  coverage: ProcessCoverageCellStatus | null;
  /** El drill: informe de la evaluación si es una sola, panorama acotado si son varias. */
  href: string;
};

export type ProcessResultsRollup = {
  ladders: ProcessLadderRollup[]; // 1 en el caso normal; >1 dispara D2/D11
  matrix: { grades: GradeAxis[]; subjects: SubjectAxis[]; cells: ProcessMatrixCell[] };
  bySubject: ProcessSubjectRollup[]; // navegación, no medición (D5)
  unclassified: { units: number; classifications: number }; // D10
  totals: {
    classifications: number; // Σ studentsAssessed de las unidades (L2)
    students: number | null; // alumnos DISTINTOS; viene de /coverage, no de units
    expectedClassifications: number | null; // Σ studentsExpected de las celdas esperadas
    unitsWithMeasuredCut: number | null; // L4 — `null` mientras no exista procedencia (P3)
  };
};

export function deriveProcessRollup(
  units: readonly ComparableUnitSummary[],
  coverage: ProcessCoverageResponse | null,
): ProcessResultsRollup;
```

### 5.2 `packages/types` — el único cambio a un tipo existente

`ProcessCoverageCell` (`packages/types/src/schemas/measurement-process.schema.ts:164-177`) gana
**un campo**:

```ts
gradeId: string; // hoy sólo viaja gradeShortName + gradeOrder
```

Sin él, la matriz tiene que unir las celdas de cobertura (indexadas por curso) con las unidades
(indexadas por `instruments.gradeId`) a través del nombre corto del grado, que es una unión por
string. El dato ya está en la query: `process-coverage.service.ts:105` hace
`innerJoin(grades, eq(grades.id, classGroups.gradeId))` y sólo selecciona `shortName` y `order`
(`:93-94`, `:199-200`).

### 5.3 API — sin cambios de ruta

- `GET /dashboards/comparable-overview?processId=…` ya existe y ya filtra: `processId` declarado en
  `packages/types/src/schemas/dashboard.schema.ts:42` y aplicado en
  `apps/api/src/dashboards/dashboards.service.ts:1679`, consumido por
  `resolveScopeForComparableOverview` (`:1458-1482`). **Verificado en código**, no supuesto.
  (`heatmapQuerySchema` lo declara en `packages/types/src/schemas/heatmap.schema.ts:32` y lo aplica
  en `apps/api/src/heatmap/heatmap.service.ts:270`; la matriz de habilidades queda igualmente fuera
  de alcance, §7.)
- `GET /measurement-processes/:id` y `/:id/coverage` ya existen
  (`measurement-processes.controller.ts:51`, `:79`) y la página ya los pide
  (`apps/web/src/app/(dashboard)/procesos/data.ts:14-20`).
- Sin migraciones. Sin RLS nuevo.

---

## 6. Cambios por paquete, archivo por archivo

### `packages/types`

| Archivo                                             | Cambio                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/utils/process-rollup.ts` _(nuevo)_             | `deriveProcessRollup` + los tipos de §5.1. Una sola pasada con `Map`, sin `.find()` por celda. |
| `src/utils/process-rollup.spec.ts` _(nuevo)_        | Los casos de §9.                                                                               |
| `src/utils/index.ts`                                | `export * from './process-rollup';` (línea nueva junto a las 21 existentes).                   |
| `src/schemas/measurement-process.schema.ts:164-177` | `gradeId: string` en `ProcessCoverageCell`.                                                    |

### `apps/api`

| Archivo                                                      | Cambio                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/measurement-processes/process-coverage.service.ts`      | Agregar `gradeId: grades.id` a los dos `select` (`:93-94` y `:199-200`) y propagarlo.                            |
| `src/measurement-processes/measurement-processes.helpers.ts` | `gradeId` en el tipo de celda (`:22`), en el mapa de cursos (`:31`) y en las dos construcciones (`:89`, `:109`). |

Nada más. Ni servicio nuevo, ni controller nuevo, ni query nueva.

### `apps/web`

| Archivo                                                          | Cambio                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/(dashboard)/procesos/data.ts`                           | `getProcessComparableOverview(processId)` → `apiGet('/dashboards/comparable-overview?processId=…')`, envuelto en `cache` como los de `resultados/data.ts:19-21`.                                                                                             |
| `src/app/(dashboard)/procesos/[processId]/page.tsx`              | Una `<Suspense>` nueva con `ResultadosSection` entre el Resumen y los accesos directos. El resto intacto.                                                                                                                                                    |
| `…/[processId]/components/process-results-section.tsx` _(nuevo)_ | Server Component **asíncrono bajo `<Suspense>`**, como exige `.claude/rules/frontend/07-navigation-reactivity.md`: la página no espera estos datos antes de devolver JSX. Pide overview + coverage, llama `deriveProcessRollup`, arma los bloques 2-5 de D7. |
| `…/[processId]/components/level-tally-bar.tsx` _(nuevo)_         | La barra apilada por escalera. Se modela sobre `resultados/components/distribution-bar.tsx`, que ya pinta `bands` + `bandDistribution` con los colores de la banda. Si se puede reutilizar tal cual, mejor: se evalúa en la Ola 1.                           |
| `…/[processId]/components/results-matrix.tsx` _(nuevo)_          | La matriz de D6. Reusa la estructura de tabla y el `overflow-x-auto` de `coverage-matrix.tsx:58-76`, que ya resuelve el responsive sin romper el ancho de la página.                                                                                         |
| `…/[processId]/components/subject-rollup-list.tsx` _(nuevo)_     | El bloque de D5.                                                                                                                                                                                                                                             |

**Lo que se retira:** la tarjeta "Accesos directos" (`page.tsx:145-205`), una lista plana de hasta
93 enlaces sin orden. La matriz cubre la navegación a grano unidad y la Rendición ya cubre la de
grano curso × asignatura, con enlaces por celda. Ver P1: si el usuario prefiere conservarla, se
mantiene colapsada y el costo es nulo.

---

## 7. Qué NO va a mostrar

Escrito explícitamente, porque la mitad del valor de este diseño es lo que se niega a emitir.

| No se muestra                                      | Por qué                                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| % de logro del proceso, por asignatura o por nivel | #1C. No hay escala en la que ese promedio signifique algo.                                                                                                     |
| Un ranking de cursos del proceso                   | "El peor curso" sólo existe dentro de una unidad; entre asignaturas distintas es la misma mezcla.                                                              |
| Habilidades / ejes / OA agregados del proceso      | **D8** del panorama: un mismo nodo se evalúa con ítems de dificultad muy distinta en 32 instrumentos. El corte por habilidad vive por unidad, donde ya existe. |
| Mapa de calor del proceso                          | **D9** del panorama. Misma razón, agravada.                                                                                                                    |
| Clasificación de alumnos del proceso               | **D3/D4** del panorama: el promedio por alumno entre instrumentos no tiene interpretación pedagógica.                                                          |
| Delta del titular contra otro proceso              | L3, con el efecto composición medido en §3.5.                                                                                                                  |
| Una estimación de lo que falta cargar              | Lo que falta se reporta como falta. Nunca se imputa.                                                                                                           |
| La lista completa de alertas                       | Ya está en el panorama, con refresco en vivo. Acá van 3 y un enlace.                                                                                           |

---

## 8. Costo

| Concepto                          | Costo                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoints nuevos                  | **0**                                                                                                                                                                                                                                                                                                                      |
| Consultas SQL nuevas              | **0**                                                                                                                                                                                                                                                                                                                      |
| Migraciones                       | **0**                                                                                                                                                                                                                                                                                                                      |
| Llamadas HTTP nuevas desde la web | **1** por visita al hub: `comparable-overview?processId=…`. El `/measurement-processes/:id` y el `/coverage` ya se piden hoy en esa página.                                                                                                                                                                                |
| Costo servidor de esa llamada     | ~13-15 consultas **fijas** por request, ninguna escala con el número de unidades: `loadUnits` (1), `loadScopeData` en `Promise.all` (`comparable-overview.service.ts:200-253`), `attachBaselines` (`:307`) y las 5 de `comparable-alerts.service.ts`. El N+1 histórico ("593 idas y vueltas", `:190-198`) ya está saldado. |
| Código nuevo                      | 1 función pura + su spec en `packages/types`; 4 componentes de presentación; 1 campo en un tipo; 2 líneas de `select` en la API.                                                                                                                                                                                           |

**⚠️ No medido.** La latencia de punta a punta no se pudo medir: los servidores de desarrollo se
cayeron durante el diseño y no se relanzaron (máquina de 8 GB, un proceso pesado a la vez). El
único número disponible es el de `docs/diseno-entrada-por-proceso.md:388`: **182 ms** para
`comparable-overview` completo, del cual ~24 ms son SQL — medido a 1/20 del volumen real y sin RLS
(rol local con `BYPASSRLS`). **Para cerrar el costo hace falta**: levantar `:4000`, pedir
`comparable-overview?processId=<Diagnóstico>` tres veces con `curl -w '%{time_total}'`, y repetir
contra el RDS de demo, que es donde el volumen es real.

---

## 9. Plan por olas

Una PR, commits por ola, tests en el CI (nunca la suite completa en local).

### Ola 0 — Contrato

`deriveProcessRollup` + tipos + `gradeId` en `ProcessCoverageCell` y su propagación en la API.

**Se verifica:** los tests puros de §10 en verde; `pnpm --filter @soe/types build` y
`--filter @soe/api typecheck` en el CI. Ninguna respuesta cambia de forma salvo el campo nuevo.

### Ola 1 — El titular con su denominador (bloques 1-2 de D7)

Barra por escalera + línea de cobertura + nota de D11 + el bloque de no clasificables (D10).

**Se verifica contra los números de §3.5, que están medidos:** Diagnóstico 539 / 1.383 / 331 y
23,9 % sobre 2.253 clasificaciones y 624 alumnos; Cierre 156 / 561 / 133, 18,4 %, y el sello "34,1 %
de lo esperado". Si la UI muestra otra cosa, el plegado está mal — no los datos.

### Ola 2 — La matriz (bloque 3)

8 × 4 celdas, color por severidad, huecos por cobertura, drill por celda.

**Se verifica:** las 32 celdas del Diagnóstico con 10 rojas / 2 ámbar / 20 verdes; los extremos
(Historia 2° 64 %, Matemáticas 2° 60 % en rojo; Matemáticas 3° 0 %, Lenguaje 3° 1 % en verde); el
Cierre muestra sus celdas faltantes como huecos, no como ausencias silenciosas. Scroll horizontal
dentro del contenedor, nunca del body.

### Ola 3 — Movimiento y urgencia (bloques 4-5)

Celdas con mayor caída contra su baseline + top 3 alertas + retiro de "Accesos directos".

**Se verifica:** ninguna caída mostrada compara unidades de familias distintas; con un proceso sin
baseline disponible el bloque desaparece en vez de mostrar guiones.

### Ola 4 — Bordes y verificación honesta

Estados de §11, responsive, y **la verificación que la org sintética no puede dar**: abrir el hub de
un proceso cuyos instrumentos tengan cortes propios medidos (los ~25 de la base, o la demo) y
confirmar que la barra y la matriz siguen leyéndose. Sin esto, L4 queda sin ejercitar.

---

## 10. Tests propuestos

**Puros (`packages/types/src/utils/process-rollup.spec.ts`)** — es donde vive toda la regla:

1. Unidades con la misma escalera → **una** `ladder`, con los conteos sumados.
2. Unidades con escaleras distintas (3 bandas vs 6) → **dos** `ladders`, ninguna mezclada. Es L1, y
   es el caso que los datos locales no pueden producir.
3. Misma cantidad de bandas pero `key` distintas → dos escaleras. La cardinalidad no basta.
4. `totals.classifications` suma `studentsAssessed`; `totals.students` **no** sale de las unidades
   (L2): con 4 unidades de 10 alumnos el resultado es 40 clasificaciones, y `students` es `null`
   cuando no se pasó `coverage`.
5. Unidad sin bandas → no entra en ninguna barra y aparece en `unclassified`, con sus
   clasificaciones contadas.
6. Celda con dos unidades → `unitKeys` de largo 2 y `severity` = la peor de las dos.
7. Celda esperada sin unidad → `coverage: 'missing'`, `classifications: 0`, y **no** cuenta como
   severidad baja.
8. `units: []` → rollup vacío y estable (sin `NaN`, sin divisiones por cero).
9. `href`: una sola evaluación → informe de la evaluación; varias → panorama acotado por
   `instrumentId`, igual que `unitHref` (`comparable-units-table.tsx:53-58`).

**Servicio (`apps/api`)**

10. `/coverage` devuelve `gradeId` en cada celda, esperada e inesperada.
11. El `gradeId` de la celda corresponde al grado del curso, y no se confunde con el grado del
    instrumento (ver §11, borde 6).

**Manual / visual**

12. Proceso `in_progress` con 52 de 96 celdas faltantes: el titular nunca aparece sin su
    denominador.
13. Proceso con `scopeDerived: true`: la matriz dice que sólo muestra lo cargado.
14. Proceso sin ninguna evaluación con resultados: estado vacío que no parece error.
15. Usuario `teacher`: ve sólo sus celdas y ningún hueco ajeno (§11, borde 5).

---

## 11. Riesgos y casos borde

| #       | Riesgo / borde                                        | Qué pasa y qué se hace                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | **Los datos locales no ejercitan la regla**           | Los 96 instrumentos de la org sintética comparten escalera **y** corte (0,40/0,80): ni L1 ni L4 se prueban ahí. Mitigación: los casos 2 y 3 de §10 con escaleras fabricadas, y la Ola 4 contra instrumentos con cortes medidos.                                                                                                                                                 |
| **R2**  | **Cortes genéricos (L4)**                             | 97 de 122 instrumentos con bandas usan 0,40/0,80. Donde el corte es genérico, "Nivel 1" vuelve a ser un umbral absoluto y el conteo hereda el defecto que #1C corrige. **No se arregla acá**: no hay columna de procedencia en `performance_bands` para distinguirlo. Se registra en P3 y `unitsWithMeasuredCut` queda `null` hasta entonces.                                   |
| **R3**  | **Dos caminos de clasificación dentro de una unidad** | `performance_band_id` está NULL en el 100 % de las filas, así que hoy todo se reclasifica desde `percentage` (`comparable-unit.assembler.ts:222`). Si mañana se pueblan **algunas** filas, una misma unidad mezclará banda guardada y banda recalculada. No es un defecto nuevo, pero el conteo del proceso lo hace visible.                                                    |
| **R4**  | **"Alumnos" con dos significados**                    | 624 (`process-coverage.service.ts:60`) vs 2.253 (`comparable-overview.service.ts:103`), misma etiqueta, pantallas contiguas. D3 lo evita en la vista nueva; corregir el panorama es P4.                                                                                                                                                                                         |
| **R5**  | **Alcance docente: dos fuentes con distinto recorte** | `comparable-overview` viene recortado a los cursos del profesor; `/coverage` **no** tiene recorte docente (`measurement-processes.service.ts:113` no resuelve `ClassGroupScope`). Un profesor vería huecos que no son suyos. Regla: la capa de cobertura se pinta **sólo** si `comparable.scope === 'org'`; con `scope: 'teacher'` la matriz muestra sólo sus celdas y lo dice. |
| **R6**  | **El grado del curso ≠ el grado del instrumento**     | Las filas de la matriz salen de `instruments.gradeId`; las celdas de cobertura, del grado del curso. Si un instrumento de 6° se aplica a un 5°, no calzan. Se trata como el `unexpectedCells` que ya existe: fila aparte rotulada "fuera del alcance declarado", nunca una celda inventada.                                                                                     |
| **R7**  | **Celda con más de una unidad**                       | Dos instrumentos para la misma asignatura y grado (dos momentos, dos versiones). La celda muestra la peor severidad, el conteo sumado **sólo si comparten escalera**, y el badge "2 instrumentos". Si no la comparten, la celda no agrega: muestra "2 instrumentos" y lleva a la lista.                                                                                         |
| **R8**  | **Proceso sin resultados**                            | `units: []`. Se muestran los bloques 1 y 3 (la matriz, toda en huecos) y el resto no se renderiza. El texto es "todavía no hay resultados cargados", no "no hay resultados".                                                                                                                                                                                                    |
| **R9**  | **Alcance derivado (`scopeDerived`)**                 | La cobertura da 100 % por construcción: el `expected_scope` se dedujo de lo cargado. La matriz no pinta huecos y rotula que sólo muestra lo cargado, reutilizando la advertencia que ya existe (`procesos/[processId]/page.tsx:128-134`). El conteo por nivel **no** se ve afectado: los resultados están medidos igual.                                                        |
| **R10** | **Sin alcance declarado (`scopeDefined: false`)**     | No hay denominador. El titular se muestra **sin** el "de N esperadas" y con el aviso que ya existe (`page.tsx:136-140`). Nunca se inventa un denominador.                                                                                                                                                                                                                       |
| **R11** | **Tamaño de la matriz**                               | 8 × 4 se ve bien; un colegio con 14 grados × 8 asignaturas son 112 celdas. Scroll horizontal contenido + celdas compactas; si se recorta algo, se dice (lección de `loadRecentAssessments`).                                                                                                                                                                                    |

---

## 12. Preguntas abiertas — resueltas el 2026-09-28

**P1 — "Accesos directos" ⟨RESUELTA: se retira⟩** La matriz lo reemplaza y pasa a ser también el
navegador: cada celda enlaza a su evaluación. La lista plana de hasta 93 enlaces sin orden decía
menos y ocupaba más. Pendiente al implementar: verificar que toda evaluación alcanzable hoy por la
lista siga siéndolo por la matriz; si alguna queda fuera (una evaluación sin celda, por ejemplo por
falta de `gradeId`), hay que darle salida antes de retirar la tarjeta.

**P2 — La síntesis en la banda de `/resultados` ⟨aplazada⟩** Se mantiene la recomendación del
diseño: sólo en el hub por ahora. La banda crecería hasta empujar el panorama fuera de la primera
pantalla.

**P3 — Distinguir corte medido de genérico ⟨RESUELTA: columna `source`⟩** Se descarta la
heurística. Un instrumento cuyo corte medido dé exactamente 0,40/0,80 quedaría mal clasificado, y
la heurística tampoco distingue "genérico por defecto" de "aún sin medir", que son estados
distintos. Va columna `source` en `performance_bands`, con migración Drizzle.

Es la decisión con más costo de las cuatro —toca schema— y es la que sostiene el borde L4: sin
poder declarar la calibración, la regla de sumar clasificaciones no se puede defender ante quien
pregunte qué significa "Nivel 1". Con la columna, `unitsWithMeasuredCut` deja de ser `null` y la
vista puede decir sobre cuántas unidades afirma.

**P4 — "Alumnos evaluados" del panorama ⟨RESUELTA: se corrige el número⟩** El StatCard pasa a
contar personas, que es lo que promete la etiqueta. ⚠️ Antes de mutar
`comparable.totals.studentsEvaluated` hay que revisar **todos** sus consumidores: puede convenir
agregar un campo nuevo en vez de cambiar el existente, porque otros lugares pueden depender de que
sume por unidad. Éste es exactamente el error que ya se cometió una vez en esta feature —se arregló
la banda y se dejó el StatCard, dejando dos números con la misma etiqueta en la misma pantalla.

**P5 — Piso de cobertura ⟨RESUELTA: sí, con reemplazo del titular⟩** Bajo el piso, el porcentaje
cede su lugar al estado de carga: "medición en curso · 44 de 96 celdas cargadas". La sección no
desaparece —que era la objeción del diseño, y es válida: el proceso vivo es cuando más se mira—,
pero deja de encabezarse con un número que se apoya en media medición.

⚠️ **El umbral no está decidido.** Propuesta: **60 %** de las clasificaciones esperadas. Con los
datos locales deja pasar al Diagnóstico y al Monitoreo y gatea al Cierre (34 %), que es el
comportamiento buscado. Es un número elegido para que separe bien estos tres casos, no medido
contra uso real: conviene revisarlo cuando haya procesos vivos de verdad.

---

## 13. Bitácora

| Fecha      | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 | Documento creado. Regla de §3.3 ("se suman clasificaciones, no se promedian puntajes") con sus cuatro bordes; decisiones D1-D11; contrato sin endpoints nuevos; plan en 5 olas. Medido contra `soe_dev`: conteos por nivel de los 3 procesos, dispersión de cortes (cero en la org sintética, 25 instrumentos con cortes propios en el resto de la base), aplanamiento del corte por asignatura y efecto composición (23,9 % → 24,6 % al parear celdas). Latencia **no medida**: los servidores de desarrollo se cayeron durante el diseño. |
