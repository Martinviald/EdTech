# Plan de Iteración — Feedback Plataforma v1

> Documento de planificación de la **primera iteración de mejora** sobre la v1, a partir del feedback de usuarios reales.
>
> **Cómo leer este doc:** el trabajo está ordenado en **olas** priorizadas. Primero lo cross-cutting y de bajo riesgo (labels, terminología) porque toca muchas vistas y conviene fijarlo antes de construir encima; luego mejoras de interacción; después features nuevas medianas; y al final los cambios estructurales grandes. Dentro de cada ola, los tickets están ordenados por dependencia.
>
> **Formato de ticket:** cada ticket describe **qué problema se identificó**, **qué alcance tiene** y **a grandes rasgos cómo se resuelve** — *no* el "cómo" técnico detallado (eso se define al desarrollar). Las referencias a archivos son **contexto** (dónde vive el problema), no instrucciones de implementación.
>
> **Leyenda de estado actual:** ✅ existe · 🟡 parcial · ⬜ no existe
> **Esfuerzo:** S (rápido) · M (medio) · L (grande/estructural)

---

## Roadmap general (todas las olas)

| Ola | Ticket | Feedback | Título | Esfuerzo | Estado |
|---|---|---|---|---|---|
| **1 — Terminología y quick wins** | TKT-01 | #16 | Unificar "% de logro" (no "aciertos") | S | 🟡 |
| | TKT-02 | #9 | "Cobertura" → "Asistencia" | S | ✅ |
| | TKT-03 | #2 | Mostrar "Lenguaje/Leng", no "LANG" | S | 🟡 |
| | TKT-04 | #10 | Escala de notas solo si está configurada | S | 🟡 |
| | TKT-05 | #15 | Ocultar descriptores en resultados | S | 🟡 |
| | TKT-06 | #3 | Aclarar/renombrar "secundario" | S | ✅ |
| | TKT-07 | #18 | Agrandar panel lateral de pregunta | S | ⬜ |
| **2 — Interacción y vistas** | TKT-08 | #1 | Lista en vez de "calugas" | M | ✅ |
| | TKT-09 | #17 | Ordenar tablero maestro por % de logro | M | ⬜ |
| | TKT-10 | #11 | Drill-down: habilidad → preguntas asociadas | M | 🟡 |
| | TKT-11 | #12 | Dropdown de dimensión (OA/tipo texto/habilidad) | M | ⬜ |
| | TKT-12 | #6 | Filtrar ítems de un instrumento por nodos/tags | M | ⬜ |
| | TKT-13 | #20 | Lista de textos colapsable (remedial) | S | ⬜ |
| **3 — Features nuevas medianas** | TKT-14 | #7 | Banco de ítems global con filtros avanzados | L | ⬜ |
| | TKT-15 | #4 | PDF del enunciado del instrumento | M | 🟡 |
| | TKT-16 | #5 | Vista de revisión de tabla de especificaciones + carga | M | 🟡 |
| | TKT-17 | #22 | Remedial: imprimir + versión estudiante + editar | M | 🟡 |
| **4 — Estructurales grandes** | TKT-18 | #8 | Renombrar "Resultados"→"Panorama pedagógico" (clarificar IA) | S | 🟡 |
| | TKT-20 | #23 | Benchmark: nivel/histórico/muestra/min-máx — **⚠️ DIFERIDO (sin pool multi-colegio)** | L | ⬜ |
| | TKT-21 | #25 | Comparabilidad universal (histórico ahora; benchmark diferido) | L | ⬜ |
| | TKT-22 | #19 | % logro colegio (ahora) y muestra (diferido) en tablero maestro | M/L | ⬜ |
| | TKT-24 | #13 | Generar informe DIA oficial | L | ⬜ |
| | TKT-25 | #26 | Informe macro colegio (base: DIA) | L | ⬜ |
| | TKT-26 | #21 | Informe por niño (generar; envío diferido) | M | ⬜ |
| **Apéndice A — Features grandes aparte** | TKT-19 | #24 | Asistente que ayuda a editar ítems (escritura asistida) | L | ⬜ |
| *(fuera del plan de corrección)* | TKT-23 | #14 | Comparación de instrumentos entre años con IA | L | ⬜ |

---

# OLA 1 — Terminología y quick wins

> Se hace primero porque son cambios de **texto/label de bajo riesgo** que aparecen repartidos por muchas vistas. Fijar la terminología antes evita re-tocar las mismas pantallas cuando se construyan las features de las olas siguientes.

---

### TKT-01 — Unificar "% de logro" (no "aciertos")
**Feedback original:** *"Se habla de '% de logro' por pregunta, no % de aciertos."*

**Problema / crítica:** La terminología por-pregunta es inconsistente. En varias vistas se muestra "acierto/aciertos" cuando el término de negocio acordado es **"% de logro"**. Genera ruido y desalineación con el lenguaje que usan los usuarios.

**Estado actual (🟡):** El dato por-pregunta existe (`correctRate`) pero se etiqueta como "acierto":
- Panel de detalle de pregunta: `MetricCard "% de acierto"` y texto "de acierto".
- Tablero maestro: tooltip "Acierto: …".
- Informe: "Dificultad (p): % de aciertos" y leyendas "<40% de aciertos" / "≥85% de aciertos".
- En cambio, los totales de alumno/curso ya dicen "% Logro" correctamente.

**Alcance:** Cambio de **labels de UI** en 3 archivos (panel de pregunta, tablero maestro, informe). No cambia el nombre del campo backend (`correctRate`) ni el cálculo. Sí implica revisar los textos del export Excel/PDF para que sean coherentes.

**Resolución (a grandes rasgos):** Reemplazar los textos "acierto/aciertos" por **"% de logro"** en todos los puntos por-pregunta, dejando la terminología uniforme en toda la app. **Decisión:** se usa "% de logro" en todos lados, incluso donde técnicamente es acierto binario (lenguaje único alineado al usuario). No se cambia el nombre del campo backend (`correctRate`).

**Dependencias:** Ninguna. Conviene que sea el primer ticket por ser cross-cutting.
**Esfuerzo:** S

---

### TKT-02 — "Cobertura" → "Asistencia"
**Feedback original:** *"Cambiar cobertura por 'Asistencia'."*

**Problema / crítica:** La tarjeta "Cobertura" (% de alumnos evaluados sobre matriculados) se entiende mejor como **"Asistencia"** para el usuario pedagógico. El dato ya es el correcto; solo el rótulo confunde.

**Estado actual (✅ dato correcto, label a cambiar):** El valor es evaluados/matriculados (`coverageRate`). El rótulo "Cobertura" aparece en 2 tarjetas de resumen (hub de evaluación e informe) y en el export Excel/PDF.

**Alcance:** Renombrar el rótulo visible en las 2 tarjetas + export. **No tocar** el "Cobertura de ítems" del preview de importación (es otro concepto: cobertura del blueprint, no asistencia).

**Resolución (a grandes rasgos):** Cambiar el texto de la tarjeta a "Asistencia" en las vistas de resultados y en la exportación. Evaluar si conviene renombrar también el campo interno `coverageRate` o dejarlo (decisión de consistencia, no bloqueante).

**Dependencias:** Ninguna.
**Esfuerzo:** S

---

### TKT-03 — Mostrar "Lenguaje/Leng", no "LANG"
**Feedback original:** *"Leng en vez de lang."*

**Problema / crítica:** En pantalla aparece "LANG" (o prefijos "LANG-") donde debería leerse el nombre humano de la asignatura Lenguaje. Es un tecnicismo del modelo de datos filtrándose a la UI.

**Estado actual (🟡):** El código de asignatura es literalmente `code='LANG'` (con `shortName='Lenguaje'` disponible pero no usado en el render). Además los códigos de nodo de taxonomía llevan prefijo `LANG-` (ej. `LANG-SK-LOCALIZAR`), que se muestran en los badges de nodo del panel de pregunta y del banco.

**Alcance:** Puntos de render donde hoy se muestra `code` en vez de `shortName`/`name`. Afecta panel de detalle de pregunta y detalle de ítem, y cualquier badge que exponga el código de nodo (prefijos `LANG-`).

**Resolución (a grandes rasgos):** Mapeo `code → label` **en el punto de presentación**, sin alterar los datos/códigos de la taxonomía. **Decisión:**
- Asignatura: mostrar **"Lenguaje"** (nombre humano) en vez de `LANG`.
- Nodos OA: mostrar **"OA-{n}"** (forma amigable) en vez del código crudo prefijado (`LANG-OA-…`).
- El resto de badges de nodo debe leer el nombre/label humano, no el código técnico.

**Dependencias:** Ninguna, pero conceptualmente relacionado con TKT-05/TKT-06 (todos tocan cómo se presentan los nodos/tags en el panel de pregunta).
**Esfuerzo:** S

---

### TKT-04 — Escala de notas solo si está configurada
**Feedback original:** *"Hacer que la escala de notas se muestre solo si el instrumento lo tiene configurado."*

**Problema / crítica:** Se muestra información de nota (ej. "Nota de corte") aunque el instrumento **no tenga** una escala de notas configurada, porque el sistema cae a un valor por defecto (4.0). Esto muestra un dato inventado como si fuera real.

**Estado actual (🟡):** `instruments.gradingScaleId` es opcional (un instrumento puede no tener escala). La "Nota promedio" ya se muestra condicional (`null → "—"`), pero la "Nota de corte" usa el fallback 4.0 y siempre aparece. El backend enmascara la ausencia de escala con el default.

**Alcance:** Backend (indicar explícitamente si el instrumento/evaluación tiene escala) + 2 vistas de resultados (hub de evaluación e informe) que hoy muestran "Nota de corte" incondicionalmente.

**Resolución (a grandes rasgos):** Que el backend distinga "sin escala configurada" de "escala con corte 4.0", y que la UI oculte por completo los elementos de nota/escala (nota de corte, % aprobación, conversión a nota) cuando no hay escala, en vez de mostrar el default.

**Dependencias:** Ninguna. Relacionado con la configuración de escalas ya existente.
**Esfuerzo:** S

---

### TKT-05 — Ocultar descriptores en resultados
**Feedback original:** *"Los descriptores son valiosos para almacenarlos asociados a cada item, pero no para mostrarlos en los resultados de la evaluación y poder filtrar y no reportar resultados en base a descriptores."*

**Problema / crítica:** Los descriptores son útiles como metadato del ítem (en el banco), pero **contaminan** la vista de resultados: aparecen entre los nodos de la pregunta y no aportan a la lectura pedagógica de resultados. No se debe filtrar ni reportar resultados por descriptor.

**Estado actual (🟡):** El almacenamiento es correcto (descriptor = nodo tipo `descriptor` asociado por ítem). Pero en resultados, el panel de detalle de pregunta incluye "Descriptores" en su lista de nodos y los renderiza junto a OA/habilidad/contenido. En el banco de ítems sí es válido mostrarlos.

**Alcance (decisión — toda vista de resultados):** Excluir descriptores del **panel de detalle de pregunta** Y de **cualquier filtro, agrupación o reporte** de resultados. **Mantener** los descriptores visibles en el banco de ítems y como contexto para IA remedial.

**Resolución (a grandes rasgos):** Excluir el tipo de nodo `descriptor` del render y de cualquier filtro/reporte en todo el contexto de resultados, sin borrar el dato ni afectar su uso en el banco de ítems ni en el pipeline de IA.

**Dependencias:** Ninguna. Toca el mismo componente que TKT-03 y TKT-06 (panel de pregunta) — conviene agruparlos al desarrollar.
**Esfuerzo:** S

---

### TKT-06 — Aclarar/renombrar "secundario"
**Feedback original:** *"Revisar qué significa 'secundario' en los nodos de cada pregunta."*

**Problema / crítica:** El término "secundario" en los nodos/tags de una pregunta no es claro para el usuario. (Aclaración de negocio: cada ítem se etiqueta con nodos y cada tag es `primary` = nodo principal del ítem, o `secondary` = nodo adicional que también evalúa; la "habilidad principal" se deriva del tag primary.)

**Estado actual (✅ funciona, label poco claro):** El badge "secundario" se muestra tanto en resultados como en el banco cuando el tag es `secondary`. El comportamiento es correcto; el problema es de comprensión del rótulo.

**Alcance:** Solo presentación (el badge "secundario" en el panel de pregunta y en el detalle de ítem del banco). No cambia el modelo de datos ni la derivación de habilidad principal.

**Resolución (a grandes rasgos):** **Decisión:** se **sigue mostrando el nodo** (OA/habilidad/contenido asociado), pero se **elimina el badge "secundario"**. El usuario ve todos los nodos por igual, sin el rótulo técnico que confundía. La distinción `primary`/`secondary` se mantiene solo a nivel de datos (para derivar la habilidad principal).

**Dependencias:** Comparte componente con TKT-03 y TKT-05.
**Esfuerzo:** S

---

### TKT-07 — Agrandar panel lateral de detalle de pregunta
**Feedback original:** *"Poder agrandar panel lateral de detalle de pregunta."*

**Problema / crítica:** El panel lateral que muestra el detalle de una pregunta (enunciado, alternativas, distribución de respuestas) tiene un ancho fijo que resulta estrecho para leer enunciados largos y ver la distribución cómodamente.

**Estado actual (⬜):** El panel es un drawer lateral con ancho fijo hardcodeado en breakpoints (`sm:max-w-lg lg:max-w-xl`). No hay forma de expandirlo.

**Alcance:** Solo el componente del panel lateral de pregunta (se abre desde el tablero maestro). Cambio de UI puro.

**Resolución (a grandes rasgos):** Permitir que el usuario agrande el panel (ej. botón expandir a un ancho amplio o a pantalla completa), manteniendo el comportamiento de drawer para el modo normal.

**Dependencias:** Ninguna.
**Esfuerzo:** S

---

# OLA 2 — Interacción y vistas

> Mejoras de interacción sobre vistas que ya existen: cambiar el formato de listado, hacer interactivos los dashboards, y agregar filtros/ordenamientos. Riesgo medio, todas acotadas a su vista. TKT-12 (filtro por tags dentro del instrumento) sienta la base del componente de filtrado que se reusa en la Ola 3 (banco global).

---

### TKT-08 — Lista en vez de "calugas"
**Feedback original:** *"Lista de instrumentos y resultados como lista y no como 'calugas'."*

**Problema / crítica:** Los listados se muestran como grid de tarjetas ("calugas"), formato poco denso que dificulta escanear muchos elementos y comparar de un vistazo. Se pide un formato de **lista/tabla**.

**Estado actual (✅ como cards):** Tanto la lista de instrumentos ("Banco de Instrumentos") como la lista de evaluaciones usan un grid de tarjetas de 3 columnas.

**Alcance (decisión — ambas listas):** Convertir el grid de tarjetas a una vista de lista/tabla densa en **la lista de instrumentos Y la lista de evaluaciones/resultados** (el feedback menciona "instrumentos y resultados"). Mantener los mismos filtros y datos ya presentes.

**Resolución (a grandes rasgos):** Reemplazar el render de cards por una tabla con columnas escaneables (nombre, tipo, estado, año, etc.), reutilizando el patrón de tabla ya usado en el proyecto. Idealmente con columnas ordenables (sinergia con TKT-09).

**Dependencias:** Ninguna.
**Esfuerzo:** M

---

### TKT-09 — Ordenar tablero maestro por % de logro
**Feedback original:** *"En el tablero maestro de detalles por pregunta poder ordenar alumnos y preguntas por % de logro. Además, que los alumnos se puedan ordenar por el % de logro de cada pregunta."*

**Problema / crítica:** El tablero maestro (matriz alumno × pregunta) no permite ordenar. Para identificar patrones (alumnos con menor logro, preguntas más difíciles) el usuario necesita **ordenar por % de logro**: alumnos por su logro global, preguntas por su logro, y alumnos por el logro de una pregunta específica (columna).

**Aclaración:** El "tablero maestro" es la sección **"Detalle por pregunta"** (matriz alumno × pregunta) del hub de la evaluación.

**Estado actual (⬜):** La tabla trae los alumnos ordenados server-side por apellido/nombre y paginados de a 50. No hay UI de ordenamiento por ninguna métrica.

**Alcance:** La sección "Detalle por pregunta". Ordenamientos: (a) alumnos por % de logro global, (b) preguntas por % de logro, (c) alumnos por el % de logro de una columna/pregunta específica.

**Resolución (a grandes rasgos) — decisión:** El **backend entrega todos los datos del curso** de la evaluación actual (no un subconjunto paginado para este propósito), y el **ordenamiento se resuelve en el frontend** (los datos no cambian, solo cómo se muestran). Agregar controles de orden en las cabeceras: fila total del alumno, cabecera de cada pregunta, y clic en una columna para ordenar alumnos por el logro de esa pregunta. *(Implica revisar el esquema de paginación actual de 50 para poder ordenar el curso completo en cliente.)*

**Dependencias:** Sinergia con TKT-08 (patrón de tabla ordenable).
**Esfuerzo:** M

---

### TKT-10 — Drill-down: habilidad → preguntas asociadas
**Feedback original:** *"Al hacer click en un 'Logro por habilidad' en resultado de una evaluación que se muestren todas las preguntas que están asociadas a ese logro."*

**Problema / crítica:** La sección "Logro por habilidad" es un listado estático: muestra el % por habilidad pero no permite profundizar. El usuario quiere, al hacer clic en una habilidad, **ver las preguntas asociadas** a ese logro para entender qué explica el resultado.

**Estado actual (🟡):** El listado "Logro por habilidad" existe (página dedicada y dentro del informe) pero no es interactivo (sin clic/drill-down). El backend ya soporta filtrar la matriz por `nodeId`, así que la infraestructura de datos existe.

**Alcance:** La sección "Logro por habilidad" en resultados de una evaluación. Al interactuar con una habilidad, mostrar las preguntas asociadas a ese nodo.

**Resolución (a grandes rasgos) — decisión:** Cada fila de habilidad es interactiva y, al hacer clic, abre un **modal/panel** que lista las preguntas asociadas a ese logro (sin salir de la vista). Acoplado con TKT-11 (el modal debe respetar la dimensión activa del dropdown).

**Dependencias:** Comparte vista con TKT-11 — desarrollar juntos.
**Esfuerzo:** M

---

### TKT-11 — Dropdown de dimensión (OA / tipo de texto / habilidad)
**Feedback original:** *"En la sección 'Logro por habilidad' poder filtrar por cada columna de la tabla de especificación (por OA, tipo de texto o habilidad). Cambiar el título a que se muestre la columna de la tabla de especificación con un dropdown."*

**Problema / crítica:** "Logro por habilidad" está fijo a una sola dimensión (habilidad). El usuario quiere poder ver el logro agrupado por **cualquier columna de la tabla de especificaciones** (OA, tipo de texto, habilidad…) y cambiar esa dimensión desde un dropdown en el título de la sección.

**Estado actual (⬜):** No existe el dropdown ni el cambio de dimensión de agrupación. La sección está cableada a "habilidad".

**Alcance:** La sección "Logro por habilidad" en resultados. Convertir el título fijo en un selector de dimensión y recalcular el desglose de % de logro por la columna elegida.

**Resolución (a grandes rasgos):** Reemplazar el título fijo por un dropdown de dimensiones disponibles (derivadas de las columnas de la tabla de especificaciones del instrumento), y recomputar el agrupamiento del logro según la dimensión seleccionada. Confirmar comportamiento (ver pregunta abierta Q-G).

**Dependencias:** Acoplado con TKT-10 (misma sección). El drill-down de TKT-10 debe respetar la dimensión activa.
**Esfuerzo:** M

---

### TKT-12 — Filtrar ítems de un instrumento por nodos/tags
**Feedback original:** *"Poder filtrar los items de un instrumento por nodos o Tags (OAs, habilidades, etc…)."*

**Problema / crítica:** Dentro de un instrumento, la tabla de ítems muestra los tags pero **no permite filtrar** por ellos. Con instrumentos de muchos ítems, encontrar los de un OA/habilidad específico es tedioso.

**Estado actual (⬜):** La tabla de ítems del instrumento muestra tags como badges pero sin control de filtrado. El backend acepta filtrar por **un** nodo (`taxonomyNodeId`), no multi-tag.

**Alcance:** La tabla de ítems dentro del detalle de un instrumento. Agregar filtro por nodos/tags (OA, habilidad, contenido, tipo de texto…). Este componente de filtro debe diseñarse para **reusarse** en el banco global (TKT-14).

**Resolución (a grandes rasgos) — decisión:** Agregar un control de filtrado **multi-tag con lógica OR** (el ítem se muestra si tiene cualquiera de los tags seleccionados) sobre la tabla de ítems, operando sobre los tags ya presentes en los datos. Diseñar el componente como **reutilizable** para el banco global (TKT-14).

**Dependencias:** **Base de TKT-14** (banco global). Hacer este primero.
**Esfuerzo:** M

---

### TKT-13 — Lista de textos colapsable (material remedial)
**Feedback original:** *"Hacer colapsable la lista de textos disponibles para el material remedial."*

**Problema / crítica:** En el flujo de material remedial se muestra la lista de **pasajes/textos de lectura del instrumento** (los que sirven de base para generar material remedial). Esa lista ocupa mucho espacio vertical; se pide poder **colapsarla** para no estorbar el resto de la vista.

**Estado actual (🟡 — decisión):** La lista se refiere a los **pasajes/textos de lectura del instrumento**. Hay que ubicar dónde se renderiza esa lista en el flujo remedial y hacerla colapsable (hoy no es colapsable).

**Alcance:** El componente que lista los pasajes/textos del instrumento dentro del flujo de material remedial. Cambio de UI.

**Resolución (a grandes rasgos):** Envolver la lista de textos en un contenedor colapsable (expandir/contraer), colapsada por defecto para dar aire a la vista.

**Dependencias:** Ninguna.
**Esfuerzo:** S

---

# OLA 3 — Features nuevas medianas

> Funcionalidad nueva pero acotada, que se apoya en piezas ya construidas o en el componente de filtro de la Ola 2. Riesgo medio; algunas requieren cambios menores de schema (PDF, versiones remediales).

---

### TKT-14 — Banco de ítems global con filtros avanzados
**Feedback original:** *"Tener un 'banco de items' con filtros avanzados por Tags."*

**Problema / crítica:** Hoy no existe un banco de ítems **global**: lo que se llama "banco" es en realidad un banco de *instrumentos*, y los ítems solo se ven entrando a cada instrumento. El usuario quiere una vista transversal de **todos los ítems** filtrable por tags avanzados, para explorar y reutilizar ítems independientemente del instrumento.

**Estado actual (⬜):** No hay vista de ítems cross-instrumento. El backend tiene `GET /items` pero ninguna página lo consume como banco global, y solo filtra por un nodo.

**Alcance:** Nueva vista de banco de ítems global (todos los ítems de la org) con el filtro multi-tag (OR) construido en TKT-12. Requiere extender el backend para filtrar por múltiples tags. Definir qué acciones se permiten desde el banco global (solo explorar/ver, o también editar/reutilizar).

**Resolución (a grandes rasgos):** Crear la vista de banco global que lista ítems de toda la org y reutiliza el componente de filtro por tags de TKT-12, con el backend extendido para multi-tag. Presentación en lista (coherente con TKT-08).

**Dependencias:** **Depende de TKT-12** (componente de filtro). Sinergia con TKT-19 (asistente editando ítems) si se decide permitir edición desde el banco.
**Esfuerzo:** L

---

### TKT-15 — PDF del enunciado del instrumento
**Feedback original:** *"Agregar el pdf del enunciado del instrumento."*

**Problema / crítica:** No se puede adjuntar/ver el PDF del enunciado (el cuadernillo de la prueba). El usuario quiere tener a mano el documento original del instrumento.

**Estado actual (🟡):** El schema soporta adjuntos con `kind='pdf'`, pero a nivel de **sección** (`section_attachments`), no de instrumento, y no hay UI de upload ni visor. Los únicos PDF actuales son *exports* generados, sin relación con el enunciado.

**Alcance (decisión — uno por instrumento):** Subida y visualización de **un PDF de enunciado por instrumento** (el cuadernillo completo). Requiere agregar soporte de adjunto PDF a **nivel de instrumento** (hoy el schema solo lo tiene a nivel de sección). Incluye almacenamiento del archivo (S3 vía presigned URL, patrón ya previsto) y un visor/enlace desde el detalle del instrumento.

**Resolución (a grandes rasgos):** Agregar carga y visualización de un PDF único de enunciado asociado al instrumento, apoyándose en el soporte de adjuntos PDF ya presente en el schema (extendiéndolo al nivel instrumento). Visible desde el detalle del instrumento.

**Dependencias:** Ninguna dura. Relacionado con TKT-16 (ambos son sobre la vista de instrumento).
**Esfuerzo:** M

---

### TKT-16 — Carga de tabla de especificaciones en su propia vista
**Feedback original:** *"Agregar la tabla de especificaciones y que el botón para cargar esté en esa vista, no en la del instrumento directamente."*

**Problema / crítica (aclarado):** El botón "Tabla de especificaciones" del detalle del instrumento es **confuso para los docentes**: una vez cargadas las especificaciones, su CTA parece "abrir la tabla para revisarla", pero en realidad lleva directo al **wizard de carga**. El docente espera ver la tabla ya cargada (con sus tags por ítem), no un dropzone.

**Estado actual (🟡):** La carga (dropzone Excel/CSV + wizard) vive en la vista `spec-table/`, pero esa vista es el flujo de **carga**, no una vista de **revisión** de la tabla ya cargada. No existe una vista que muestre la tabla de especificaciones consolidada (todos los tags por ítem).

**Alcance:** Rediseñar el destino del botón: debe abrir una **vista de revisión de la tabla de especificaciones** que muestre todos los ítems con sus tags (OA, habilidad, tipo de texto, etc.), y dentro de esa vista ofrecer un botón secundario **"Cargar tabla de especificaciones"** para (re)cargar. Es decir, revisar primero, cargar como acción secundaria.

**Resolución (a grandes rasgos):** Convertir la vista de tabla de especificaciones en una vista de **lectura/revisión** (tabla ítem × tags) como contenido principal, con la carga como acción dentro de ella. El botón del detalle del instrumento pasa a abrir esta vista de revisión.

**Dependencias:** Sinergia con TKT-12 (mostrar tags por ítem) y TKT-15 (misma zona de detalle de instrumento).
**Esfuerzo:** M

---

### TKT-17 — Remedial: imprimir + versión estudiante + editar
**Feedback original:** *"Poder imprimir el material remedial generado como una guía. Versión estudiante y versión profesor. Poder editar el material remedial."*

**Problema / crítica:** El material remedial generado no se puede imprimir como guía, no distingue **versión estudiante** vs **versión profesor**, y solo la guía es editable (no los sets de práctica ni los planes de grupo). El usuario quiere llevar el material al aula (impreso) en dos versiones y poder ajustarlo.

**Estado actual (🟡):** El motor remedial genera 3 tipos (guía de reenseñanza para profesor, set de práctica, plan de grupo). Solo existe la versión **profesor** de la guía. La edición está disponible **solo** para la guía (antes de aprobar). No hay impresión ni versión estudiante.

**Alcance (decisiones):** Tres capacidades sobre el material remedial:
- **(a) Imprimir como guía:** salida imprimible/PDF del material generado.
- **(b) Versión estudiante vs profesor:** **misma generación, dos renders** — la versión estudiante muestra el mismo contenido pero ocultando respuestas, pautas y notas pedagógicas (solo lo que el alumno debe ver); la versión profesor incluye todo.
- **(c) Edición extendida:** poder editar **todos los tipos** (guía, set de práctica y plan de grupo) antes de aprobar, no solo la guía.

**Resolución (a grandes rasgos):** Agregar salida imprimible del material; derivar una vista/render "estudiante" que filtre la información solo-profesor sobre el mismo contenido generado; y extender la edición previa a la aprobación a los tres tipos de material.

**Dependencias:** Ninguna dura (motor remedial ya existe).
**Esfuerzo:** M

---

# OLA 4 — Estructurales grandes

> Cambios de mayor calado: reorganización de navegación, escritura de la IA, y las capas de comparación (histórico/benchmark) e informes oficiales. Varios dependen de insumos externos (muestra de informe DIA oficial, decisión sobre infra de email, pool real de benchmark). Se abordan al final por su tamaño y por apoyarse en decisiones de producto aún abiertas.

---

### TKT-18 — Clarificar arquitectura de información: "Panorama pedagógico" vs Evaluación
**Feedback original:** *"Fusionar vista de evaluación con resultados."*

**Problema / crítica (reencuadrado):** El feedback no pide un merge estructural, sino que resuelve una **confusión de UX/UI**: existen dos superficies que "se sienten resultados" y el usuario no distingue cuál es cuál. `/resultados` es un dashboard **agregado y transversal** (cruza todas las evaluaciones, filtrable por asignatura/nivel/curso/alumno/año), mientras que `/evaluaciones/[id]` es el hub de **una prueba específica**. Ambas comparten la palabra "resultados" y no señalizan claramente el alcance de lo que se está viendo.

**Estado actual:** La arquitectura de fondo es correcta y ya está razonablemente limpia: las vistas de una evaluación específica (detalle por pregunta, informe) **ya viven bajo `/evaluaciones/[id]`** (las rutas `/resultados/detalle` e `/resultados/informe` son solo *redirects* hacia allá). `/resultados` conserva solo lo agregado (overview, habilidades, mapa-calor, progresión, comparación, clasificación). El problema es de **nomenclatura y señalización**, no estructural.

**Decisión (alcance):** **No se fusionan ni se reestructuran las vistas** — se dejan como están. Se resuelve la confusión con nomenclatura:
- **Renombrar `/resultados` a "Panorama pedagógico"** (la vista transversal/analítica del colegio).
- **Cambiar la nomenclatura y las palabras en la UI** para diferenciar claramente ambas superficies: el "Panorama pedagógico" es el análisis cruzando todas las pruebas; los "resultados" de una prueba concreta viven bajo Evaluaciones y se nombran como tales.
- (Complementario, opcional) Reforzar con señalización de scope (banner del filtro activo en el panorama; título inequívoco de la prueba en la evaluación) y cross-links de drill-down entre ambas.

**Resolución (a grandes rasgos):** Ajuste de nomenclatura y textos en la UI (nav, títulos, descripciones) para diferenciar "Panorama pedagógico" (transversal) de los resultados de una evaluación específica, sin tocar la estructura de las vistas ni las rutas de datos.

**Dependencias:** Ninguna dura. Toca la navegación (nav-items) y textos de la sección de resultados.
**Esfuerzo:** S

---

### TKT-19 — Asistente que ayuda a editar ítems → **movido al Apéndice A**
**Feedback original:** *"Hacer que el asistente pueda ayudar a editar items."*

> **Decisión:** esto **no** se aborda como un fix del feedback en esta iteración. Es una **feature grande aparte** (escritura asistida sobre el contenido de los ítems, rompiendo el read-only del asistente, con aprobación humana). Ver detalle en el **Apéndice A**.

---

### TKT-20 — Benchmark: nivel, histórico, muestra, menor/mayor logro
**Feedback original:** *"En el benchmark mostrar comparación con nivel, histórico, muestra de colegios, menor logro y mayor logro."*

**Problema / crítica:** El benchmark actual compara contra la muestra de colegios (mediana/percentiles) pero le faltan dimensiones que el usuario quiere ver: comparación explícita contra el **nivel** esperado, el **histórico** (evolución temporal), y el **menor/mayor logro** de la muestra (mín/máx), no solo la mediana.

**Estado actual (🟡):** Benchmark construido (F2) con muestra, mediana, p25/p75, distribución por banda y por habilidad. **Faltan**: línea de referencia de nivel esperado, dimensión histórica/temporal (hoy es un snapshot del último refresh), y mín/máx de la cohorte.

**⚠️ DIFERIDO — sin datos multi-colegio.** Confirmado: **aún no hay resultados de múltiples colegios**. Todo lo que es "muestra de colegios" (mín/máx de la cohorte, mediana, comparación inter-colegio, histórico inter-colegio) **no tiene dato real** y no puede entregar valor hoy. Este ticket se **difiere** hasta que exista un pool real multi-colegio (idealmente multi-año). Alinea con CLAUDE.md §8.1 (benchmarking = F2).

**Alcance (cuando se retome):** Extender el benchmark con (a) mín/máx de la muestra ("menor/mayor logro"), (b) referencia de nivel esperado, (c) dimensión histórica/temporal. Requiere el pool real como precondición.

**Resolución (a grandes rasgos):** Al retomar, agregar mín/máx y referencia de nivel al cálculo de cohorte y modelar la dimensión histórica del benchmark. **Precondición: pool multi-colegio con datos suficientes.**

**Dependencias:** **Bloqueado por ausencia de pool multi-colegio.** Base para la parte "muestra" de TKT-22.
**Esfuerzo:** L (diferido)

---

### TKT-21 — Comparabilidad universal (histórico + benchmark)
**Feedback original:** *"Intentar que todos los números se puedan comparar con histórico y benchmarking."*

**Problema / crítica:** Los números clave de la plataforma se muestran "sueltos", sin su comparación al lado. El usuario quiere que **todo número relevante** venga acompañado de su comparación contra histórico y contra benchmark, para dar contexto inmediato ("¿esto es bueno o malo?").

**Estado actual (⬜):** Cada vista tiene sus métricas sin comparación embebida de forma sistemática. Existen piezas (comparación generacional, benchmark) pero no una capa transversal de "comparabilidad".

**Alcance (parte histórico viable ahora; parte benchmark diferida):** Definir un patrón de presentación de métrica-con-comparación y aplicarlo a los números clave.
- **Histórico (viable ahora):** delta vs el propio histórico de la org (usa la comparación generacional/progresión ya existente). **Sí se puede** sin pool multi-colegio.
- **Benchmark (diferido):** posición vs muestra de colegios. **Bloqueado** hasta tener pool multi-colegio (ver TKT-20).

**Resolución (a grandes rasgos):** Definir un componente/patrón de "métrica comparada" (valor + delta vs histórico [ahora] + posición vs benchmark [cuando haya pool]) y desplegarlo progresivamente en las métricas prioritarias. Descomponer por vista. Arrancar por la dimensión histórica.

**Dependencias:** La dimensión histórica no tiene bloqueo. La dimensión benchmark depende de TKT-20 (pool multi-colegio). Interactúa con TKT-22.
**Esfuerzo:** L

---

### TKT-22 — % de logro colegio y muestra en el tablero maestro
**Feedback original:** *"Agregar % de logro en colegio y % de logro en muestra de colegios en el tablero maestro."*

**Problema / crítica:** En el tablero maestro (Detalle por pregunta) no hay líneas de referencia: el usuario ve el logro por alumno/pregunta pero no cómo se compara con el **promedio del colegio** ni con la **muestra de colegios** (benchmark). Falta el contexto comparativo por pregunta.

**Estado actual (⬜):** La matriz alumno × pregunta no incluye agregados de colegio ni de muestra. El benchmark existe como feature separada pero no está integrado en esta vista.

**Alcance (dividido — colegio viable ahora; muestra diferida):**
- **% de logro del colegio (viable ahora):** promedio de la org para cada pregunta. **Sí se puede** sin pool multi-colegio; solo requiere extender la respuesta de la matriz con el agregado de la org y el render.
- **% de logro de la muestra de colegios (diferido):** línea de benchmark inter-colegio. **Bloqueado** hasta tener pool multi-colegio (TKT-20).

**Resolución (a grandes rasgos):** Enriquecer los datos de la matriz por pregunta con el agregado del colegio (ahora) y agregar la línea de muestra cuando exista el pool. Mostrarlos como fila(s) de referencia bajo cada pregunta.

**Dependencias:** La parte "% colegio" no tiene bloqueo. La parte "muestra" depende de TKT-20. Instancia concreta de TKT-21.
**Esfuerzo:** M (solo "% colegio"); L con la parte de muestra.

---

### TKT-23 — Comparación de instrumentos entre años con IA → **movido al Apéndice A**
**Feedback original:** *"Agregar comparación de instrumentos con años anteriores o instrumentos anteriores con IA."*

> **Decisión:** **feature grande aparte**, no un fix del feedback en esta iteración. Ver visión detallada en el **Apéndice A**.

---

### TKT-24 — Generar informe DIA oficial
**Feedback original:** *"Agregar poder generar el informe DIA oficial."*

**Problema / crítica:** La plataforma genera un informe interno propio, pero no el **informe con el formato oficial DIA** que los colegios reconocen y usan. El usuario quiere poder generar ese informe oficial.

**Estado actual (⬜):** No existe. El informe interno actual no replica el formato oficial.

**Insumo disponible:** Informes DIA oficiales reales (por curso × asignatura × momento) en `Histórico Pruebas DIA/Resultados/*` (Lenguaje y Matemática 2025, RBD 25520). Momentos: **Diagnóstico / Monitoreo / Cierre** (la estructura varía levemente según el momento).

**Estructura del informe oficial DIA (a replicar):**
1. **Portada:** logo Agencia de Calidad + metadatos (Establecimiento, RBD, director/a, docente de la asignatura, Curso, N° de estudiantes considerados, fecha/hora de generación), texto introductorio del momento, índice de secciones, y recuadro *"esta información NO DEBE usarse para"* (calificar, comparar cursos, comparar con años anteriores).
2. **Resultado general del curso:**
   - *Diagnóstico* → recuadro "% de estudiantes que requieren mayor apoyo para enfrentar el año".
   - *Monitoreo / Cierre* → **"Resultados según niveles de logro"** con **gráfico de torta** (Insuficiente / Elemental / Adecuado).
3. **Resultados según ejes de habilidad:** **gráfico de barras** con % promedio de respuestas correctas del curso por eje (en Lectura: Localizar / Interpretar y relacionar / Reflexionar), + recuadro de "Preguntas guía".
4. **Resultados por pregunta (Tabla 1 = tabla de especificaciones con logro):** columnas **N° pregunta · N° OA (nivel) · Tipo de texto · Eje de habilidad · Indicador de evaluación · % respuestas** (por alternativa A/B/C/N con la correcta en negrita; para preguntas de desarrollo: RC/RPC/RI/N).
5. **Resultados por estudiante (Figura 1):** *dot plot* de cada estudiante sobre un **eje x de % de logro**, con línea divisoria que marca el **nivel donde cae** (requiere mayor apoyo / logro suficiente), + "Cantidad de estudiantes que requieren mayor apoyo".
6. **Conclusiones preliminares:** tabla de preguntas reflexivas para completar.

**Alcance:** Nuevo generador de informe que replica esta estructura (con la variante por momento) sobre los datos de resultados que la plataforma **ya calcula** (logro por pregunta, por eje/habilidad, por estudiante, niveles de desempeño). Reutiliza el patrón de export (PDF client-side) existente. La mayor parte del dato ya existe; el trabajo es de **layout/plantilla** fiel al oficial.

**Resolución (a grandes rasgos):** Construir el generador del informe oficial DIA replicando las 6 secciones y sus gráficos (torta de niveles, barras por eje, tabla de especificaciones, dot plot por estudiante) a partir de las muestras reales, respetando la variante Diagnóstico/Monitoreo/Cierre. Base también para TKT-25.

**Dependencias:** Insumo disponible (muestras reales). Base de TKT-25.
**Esfuerzo:** L

---

### TKT-25 — Informe macro colegio (base: DIA)
**Feedback original:** *"Informe macro colegio del establecimiento. De base copiar el de la DIA."*

**Problema / crítica:** Falta un informe agregado a nivel de **establecimiento** (macro colegio) que consolide el desempeño de toda la org, tomando como base el formato del informe DIA de establecimiento.

**Estado actual (⬜):** Existen dashboards de org, pero no un informe macro exportable con el formato DIA de establecimiento.

**Insumo — RESUELTO:** se dispone de la **muestra real del informe DIA de establecimiento** (`Informe_de_resultados_establecimiento_rbd-25520_monitoreo_2025`, RBD 25520, Monitoreo Intermedio 2025). Es un documento **distinto** al informe por curso de TKT-24: no baja a pregunta ni a estudiante, sino que **agrega por grado × asignatura** a nivel de todo el establecimiento. Estructura de 2 áreas:

- **Portada + metadatos:** logo DIA + Agencia de Calidad; "Informe de Resultados 2025 — Establecimiento"; Establecimiento, RBD, nombre del director/a, fecha y hora de generación; bloque descriptivo del momento (Diagnóstico/Monitoreo/Cierre); índice de las 2 áreas; recuadro de advertencias de uso ("NO DEBE usarse para: evaluar docentes, comparar cursos/asignaturas/áreas, comparar con DIA Diagnóstico/2024"); nota interpretativa de contexto curricular.

- **Sección 1 — Área Académica** *(la que la plataforma puede reproducir con datos que ya calcula)*:
  - Definición de niveles de logro (nivel I = no logra / II = logro parcial / III = logro satisfactorio de los OA basales).
  - **Resultados según niveles de logro (Tablas 1.1–1.4, una por asignatura: Lectura, Matemática, Historia-Geografía-Cs. Sociales, Ciencias Naturales):** filas = nivel I/II/III, columnas = grados (2° básico … II medio), valores = **% de estudiantes de cada grado en cada nivel**. Grados sin datos quedan en blanco.
  - **Comparación mujeres vs hombres (Tablas 1.5–1.8, una por asignatura):** filas = grados; valor = `+M` (mujeres significativamente mayor), `+H` (hombres mayor), vacío (sin diferencia significativa) o `*` (sin mínimo de estudiantes para el cálculo).
  - **Cantidad de estudiantes evaluados (Tabla 1.9):** filas = grados; columnas agrupadas por asignatura con sub-columnas M / H / Total. Guion = prueba no aplicada en ese grado.
  - Recuadros de "Preguntas guía" al cierre de cada bloque.

- **Sección 2 — Área Socioemocional** *(cuestionario socioemocional, gráficos de % de respuestas favorables por grado para cada condición: aprendizaje colaborativo, vínculo, autorregulación, ansiedad, ciudadanía digital, valoración del establecimiento + Tablas 2.1–2.9 de comparación por sexo).* **FUERA DE ALCANCE:** la plataforma no ingesta el cuestionario socioemocional del DIA → esta sección **no se reproduce** en F1. Se documenta como punto de extensión futuro, no se construye.

**Alcance (decisión):** Reproducir **solo la Sección 1 (Área Académica)** del informe de establecimiento — Tablas 1.1 a 1.9 — para las asignaturas de las que la plataforma tiene datos, con portada/metadatos/advertencias oficiales. La Sección 2 (Socioemocional) queda fuera por falta de insumo de datos. NO es el informe de curso de TKT-24 a escala colegio: es un **formato agregado propio** (niveles de logro por grado×asignatura, sin spec-table ni dot plot).

**Resolución (a grandes rasgos):** Construir el generador del informe de establecimiento (Área Académica) agregando por grado×asignatura los niveles de logro y conteos que la plataforma ya calcula, respetando la variante de momento (Diagnóstico/Monitoreo/Cierre) y las advertencias de uso oficiales. Comparte con TKT-24 la capa de plantilla/export y la lógica de niveles de logro, pero **no depende** del spec-table ni del detalle por estudiante de TKT-24.

**Dependencias:** Comparte plantilla/export y lógica de niveles con TKT-24 (conviene hacerlo después), pero es un formato independiente. La comparación por sexo (Tablas 1.5–1.8) requiere que la plataforma modele el sexo del estudiante y el cálculo de significancia — verificar disponibilidad; si no existe, esas tablas se dejan como punto de extensión.
**Esfuerzo:** L

---

### TKT-26 — Informe por niño + envío a apoderado
**Feedback original:** *"Generar informe por niño por evaluación y enviárselo por correo al apoderado."*

**Problema / crítica:** No hay un informe individual por alumno por evaluación, ni forma de enviarlo al apoderado. El usuario quiere ambas cosas. Nota: el portal de apoderados es F3 y no existe infraestructura de email.

**Estado actual (⬜):** No hay informe individual por niño (solo el detalle sin PII del asistente). No hay infraestructura de email (0 dependencias). "Apoderado" existe solo como rol, sin correos modelados.

**Alcance (decisión — separar generación de envío):**
- **(a) EN ESTA ITERACIÓN — Generar el informe individual por alumno por evaluación** (vista/PDF), reutilizando el patrón de export existente.
- **(b) FASE POSTERIOR — Enviar por correo al apoderado.** Requiere infra de email nueva + modelar los correos de apoderados + revisión legal de PII de menores (Ley 19.628) + toca terreno F3 (portal apoderados). No se construye ahora.

**Resolución (a grandes rasgos):** Construir el informe individual por niño (generación/PDF) sobre los datos ya calculados. El envío por correo queda explícitamente diferido a una fase posterior, con su propia infra y revisión legal.

**Dependencias:** (a) ninguna dura. (b) diferida — requiere infra de email inexistente y decisiones de producto/legal.
**Esfuerzo:** M (solo la parte (a); (b) queda fuera)

---

## Preguntas abiertas pendientes

Resueltas: Q-M (TKT-18, renombrar a "Panorama pedagógico"), Q-N (TKT-19, a Apéndice A), Q-P (TKT-23, a Apéndice A), Q-R (TKT-26, separar generación de envío).

**Q-Q (informe DIA oficial) — RESUELTA:** se dispone de las muestras reales en `Histórico Pruebas DIA/Resultados/*`; la estructura quedó documentada en TKT-24.

**Q-O (benchmark) — RESUELTA:** **no hay resultados multi-colegio aún** → TKT-20 y la parte "muestra" de TKT-21/22 quedan **diferidas**; se avanza solo con las dimensiones viables sin pool (histórico propio, promedio del colegio).

**Q-S (informe macro colegio) — RESUELTA:** existe el **informe DIA oficial de establecimiento** (muestra real: `Informe_de_resultados_establecimiento_rbd-25520_monitoreo_2025`). Es un formato **agregado por grado×asignatura** (Tablas 1.1–1.9), distinto del informe por curso de TKT-24. Se reproduce **solo la Sección 1 (Área Académica)**; la Sección 2 (Socioemocional) queda fuera por falta de insumo de datos. Estructura documentada en TKT-25.

**No quedan insumos pendientes para arrancar el sprint.**

---

## Apéndice A — Features grandes fuera del plan de corrección

> Dos ítems del feedback exceden el alcance de "corregir la v1": son **features nuevas de gran tamaño** que merecen su propio diseño y planificación aparte. Se documentan aquí para no perderlas, pero **no forman parte de esta iteración de corrección**.

### TKT-19 — Escritura asistida de ítems (el asistente ayuda a editar contenido)
**Origen:** feedback #24 — *"Hacer que el asistente pueda ayudar a editar items."*

**Visión:** Hoy el asistente IA es estrictamente de **solo lectura** (12 tools de consulta; su system prompt declara "solo lectura"). Esta feature le daría capacidad de **editar el contenido de los ítems** (enunciado, alternativas, clave), siempre bajo el principio §8.3 del proyecto: **la IA propone, el humano aprueba** — el asistente genera un borrador/diff y el cambio solo se persiste tras confirmación humana explícita, nunca escritura directa.

**Por qué es aparte:** rompe un guardrail de diseño central (read-only), requiere tools de escritura nuevas, una UI de revisión/confirmación de cambios, y cuidado con multi-tenancy (RLS). Es una inversión mayor, no un ajuste de la v1.

**Esfuerzo:** L (feature nueva, planificación propia).

### TKT-23 — Diagnóstico IA de variación entre instrumentos comparables
**Origen:** feedback #14 — *"Agregar comparación de instrumentos con años anteriores o instrumentos anteriores con IA."*

**Visión:** Cuando un mismo instrumento comparable (p. ej. el DIA de diagnóstico de dos años seguidos) arroja resultados distintos, **los números por sí solos no explican por qué** subió o bajó el % de logro. Para entenderlo hay que analizar las **preguntas, los textos y las alternativas** de ambos instrumentos. Esta feature apunta a eso: ante una **variación alarmante**, el usuario selecciona **dos instrumentos comparables**, se le pasa a un **modelo de IA potente** el **contenido de cada instrumento junto con sus resultados**, y la IA **propone un análisis y un diagnóstico** de qué elementos de los instrumentos explican la variación en los resultados.

**Por qué es aparte:** va más allá de la comparación generacional determinística que ya existe (tabular año-vs-año). Requiere: selección de instrumentos comparables, ensamblado de contenido+resultados de ambos como contexto, un prompt/modelo de análisis potente (multimodal si hay imágenes/textos), y presentación del diagnóstico. Es una feature de análisis IA nueva y de peso.

**Esfuerzo:** L (feature nueva, planificación propia).

