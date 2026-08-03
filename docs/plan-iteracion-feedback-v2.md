# Plan de Iteración — Feedback Plataforma v2

> Segunda iteración de mejora sobre la plataforma, a partir de una nueva sesión de feedback con usuarios de testing. Continúa el trabajo de `docs/plan-iteracion-feedback-v1.md`; varios puntos **iteran sobre features que v1 ya construyó** (banco de ítems global, comparar instrumentos, hub de evaluación, tablero maestro) y en algunos casos **reabren decisiones de v1** (ver §3).
>
> **Cómo leer este doc:** el trabajo está ordenado en **olas** priorizadas. Primero los cambios de bajo riesgo y cross-cutting (labels, renames, desactivaciones); luego navegación y arquitectura de información; después filtros/dashboards; y al final las features nuevas de peso. Dentro de cada ola, los tickets están ordenados por dependencia.
>
> **Formato de ticket:** cada ticket describe **qué problema se identificó**, **qué alcance tiene** y **a grandes rasgos cómo se resuelve** — *no* el "cómo" técnico detallado (eso se define al desarrollar). Las referencias a archivos (`path:línea`) son **contexto** (dónde vive el problema), no instrucciones de implementación.
>
> **Leyenda de estado actual:** ✅ existe · 🟡 parcial · ⬜ no existe
> **Esfuerzo:** S (rápido) · M (medio) · L (grande/estructural)
> **Capa del gap:** UI · Backend · BDD · Prompts (IA)
>
> **Nota:** incluye una ronda posterior de **ajustes de UI** (tickets **T2-24 a T2-27**, feedback `UI-1…UI-5`), integrados en las olas 2 y 3 donde mejor calzan.

---

## 1. Decisiones tomadas en esta sesión

Cuatro puntos del feedback bifurcaban la implementación; se resolvieron así (condicionan los tickets señalados):

| Tema | Decisión | Impacto |
|---|---|---|
| **Tablero maestro** (feedback #1, #29) | **Densificar el actual.** No es una vista nueva: se re-rotula "Detalle por pregunta" → "Tablero maestro" y se densifica la fila (solo nombre) para ver más alumnos. La comparativa **% colegio ya existe**; **benchmark queda diferido**. | T2-06 |
| **Material con IA** (feedback #16, #30) | **Estudio de material global + acceso desde la evaluación.** Se construye un canvas cross-evaluación con su propia entrada en el sidebar (renombrado), que además se puede abrir precargado desde una evaluación. Reemplaza al ítem "Material Remedial". | T2-09, T2-19 |
| **Panorama pedagógico** (feedback #6-8) | **Selector que entra al hub.** `/resultados` se vuelve un panel que obliga a acotar (asignatura→instrumento/evaluación→nivel) y enlaza a la vista profunda del hub por-evaluación (que ya tiene ejes/habilidades/drill-down). Reutiliza, no duplica. **Reabre la decisión de v1 (TKT-18).** | T2-15 |
| **Calidad de ítem con pocas respuestas** (feedback #32) | **Desactivar por ahora.** Se oculta el veredicto de calidad de ítem (IA + banderas psicométricas) en esta fase; se conserva el análisis de resultados y distractores. Reactivable cuando haya volumen. | T2-04 |

---

## 2. Ahorros detectados (ya está hecho o casi)

El mapeo del código encontró que **varios puntos ya están resueltos parcial o totalmente**; conviene no reconstruirlos:

- **% de logro del colegio por pregunta** (parte del #29): **ya existe** como fila `SchoolReferenceRow` / `references.org` en el tablero maestro.
- **`/resultados/habilidades` → "dimensiones"** (#22): el **contenido ya se llama "Logro por dimensión"**; falta solo la ruta y el rótulo del tab.
- **Instrumento de origen por ítem** (#14): **ya se muestra en la lista** del banco de ítems (falta solo en el panel lateral).
- **Filtros del banco de ítems** (#13): los filtros por **OA / habilidad / tipo de texto ya son multi-select**; el gap son 3 dropdowns (asignatura/nivel/eje).
- **Panel de pregunta banco ↔ detalle de instrumento** (#15): **ya usan el mismo componente**; el delta real es el panel de *resultados*.
- **Filtros en query params** (#17): **ya es el patrón dominante** (sin Zustand); el hueco es `comparar-instrumentos` y el "Volver" dentro del hub.
- **Instrumento como filtro de dashboard** (#10): el backend **ya expone la lista de instrumentos y acepta `instrumentId`**; la UI lo colapsa a "tipo de instrumento".

---

## 3. Relación con el plan v1

| Ticket v2 | Se apoya en / reabre |
|---|---|
| T2-06 Tablero maestro | Extiende TKT-09 (ordenar) y TKT-22 (% colegio/muestra). % colegio ✅; benchmark diferido (TKT-20). |
| T2-07 Mis cursos a filas | Reabre TKT-08 (se aplicó a la lista de evaluaciones, **no** a Mis cursos). |
| T2-09 Sacar del sidebar | Toca TKT-23 (Comparar instrumentos, que v1 dejó en Apéndice A y se construyó). |
| T2-13 Banco multi-filtro | Sobre TKT-14 (banco de ítems global). |
| T2-15 Panorama select-first | **Reabre TKT-18** (v1 decidió *no* reestructurar; v2 sí reestructura). |
| T2-17 Informes clickeable | Sobre TKT-10 (drill-down habilidad→preguntas) y TKT-11 (dimensión). |
| T2-18 Unificar panel | Sobre TKT-07 (agrandar panel lateral). |

**Diferido heredado de v1:** toda comparación contra **muestra de colegios (benchmark)** sigue **bloqueada** hasta tener un pool real multi-colegio (TKT-20). Afecta la parte "benchmark" de T2-06.

---

## 4. Roadmap general

| Ola | Ticket | Feedback | Título | Capa | Esfuerzo | Estado |
|---|---|---|---|---|---|---|
| **1 — Quick wins** | T2-01 | #23 | "Ver enunciado" → "Ver instrumento" | UI | S | ⬜ |
| | T2-02 | #22 | `/resultados/habilidades` → `/dimensiones` | UI | S | 🟡 |
| | T2-03 | #31 | Español latinoamericano, sin inglés | Prompts+UI | S | 🟡 |
| | T2-04 | #32 | Desactivar calidad de ítem con pocas respuestas | Prompts+UI+Backend | S/M | ⬜ |
| | T2-05 | #14 | Instrumento de origen en el panel de ítem | UI | S | 🟡 |
| **2 — Tablero, Mis cursos y navegación** | T2-06 | #1, #29 | Tablero maestro: rótulo + densidad + comparativas | UI | M | 🟡 |
| | T2-07 | #2 | "Mis cursos" en filas, no calugas | UI | S/M | ⬜ |
| | T2-08 | #3 | Degradar "Mis cursos" + secciones colapsables | UI | M | 🟡 |
| | T2-09 | #16 | Sacar Análisis IA / Comparar / Material del sidebar | UI | M | 🟡 |
| | T2-10 | #17 | Query params (comparar) + "Volver" consistente | UI | M | 🟡 |
| | T2-11 | #24-26 | Tabla de especificaciones: navegación + filtros + resumen | UI (+Backend) | M | ⬜ |
| | T2-24 | UI-1 | Ocultar "Importar" del sidebar | UI | S | ⬜ |
| | T2-25 | UI-2, UI-3 | Banco → `/banco-contenido`: tabs en una fila + `?tab=` + quitar "Nuevo instrumento" | UI | M | 🟡 |
| **3 — Filtros y dashboards** | T2-12 | #11 | Multi-selección transversal en filtros | Backend+BDD+UI | L | ⬜ |
| | T2-13 | #13 | Banco de ítems: multi-select asignatura/nivel/eje | UI+Backend | S/M | 🟡 |
| | T2-26 | UI-5 | Banco de ítems: paginación 20/pág + quitar filtro de alcance | UI+Backend | S/M | 🟡 |
| | T2-14 | #10 | Jerarquía Asignatura›instrumento›habilidad/eje›nivel | UI+Backend | M | 🟡 |
| | T2-27 | UI-4 | Filtro de momento DIA en /evaluaciones (condicional) | UI+Backend | M | ⬜ |
| | T2-15 | #6-8 | Panorama pedagógico select-first (entra al hub) | UI | M/L | 🟡 |
| | T2-16 | #9 | Árboles de taxonomía agrupados por asignatura | UI (o seed) | M | 🟡 |
| | T2-17 | #12 | Informes: tabla de ítems clickeable + comparativa % del nivel | UI+Backend | M | 🟡 |
| | T2-18 | #15 | Unificar el cuerpo del panel de pregunta (resultados↔instrumento) | UI | M | 🟡 |
| **4 — Features nuevas de peso** | T2-19 | #30 | ~~Crear material IA: canvas + lenguaje natural~~ · **⏸️ DIFERIDO a fase futura (F2)** | UI+Backend+Prompts+BDD | L | ⏸️ |
| | T2-20 | #21 | Vista 360 del estudiante | Backend+UI | L | ⬜ |
| | T2-21 | #18 | Etiqueta de dificultad por ítem (+ IA a futuro) | BDD+Backend+UI | M/L | ⬜ |
| | T2-22 | #19 | Listas/colecciones de ítems para armar evaluaciones | BDD+Backend+UI | L | ⬜ |
| **5 — Limpieza** | T2-23 | #20 | Eliminar los estados de evaluaciones | BDD+Backend | S/M | 🟡 |

---

# OLA 1 — Quick wins (labels, renames, desactivaciones)

> Cambios de bajo riesgo, muchos de un solo archivo. Se hacen primero porque tocan terminología/afordancias que aparecen repartidas y conviene fijarlas antes de construir encima.

---

### T2-01 — "Ver enunciado" → "Ver instrumento"
**Feedback original:** *"Cambiar botón de 'ver enunciado' a 'ver instrumento' en evaluaciones e instrumentos."*

**Problema / crítica:** El botón que abre el PDF del instrumento se rotula "Ver enunciado", término ambiguo (el "enunciado" también es el *stem* de una pregunta). El usuario espera "Ver instrumento".

**Estado actual (⬜):** Un **único componente compartido** `EnunciadoViewButton.tsx:27` (con su texto sr-only en `:29`) renderiza ese botón en exactamente 2 lugares: detalle de instrumento (`InstrumentDetailView.tsx:111`) y hub de evaluación (`evaluaciones/[assessmentId]/layout.tsx:166`). Enlaza a `/instrumentos/:id/enunciado` (redirect al PDF prefirmado).

**Alcance:** Cambio de **un string** (label + sr-only) en un componente compartido; cubre "evaluaciones e instrumentos" de una vez. **No tocar** la palabra "Enunciado" como *título de sección* dentro de los paneles de pregunta (`ItemDetailPanel` / `QuestionDetailPanel`): ahí es el stem de la pregunta, no el botón.

**Resolución (a grandes rasgos):** Renombrar el botón a "Ver instrumento". Evaluar si conviene renombrar también el endpoint `/enunciado` por consistencia (opcional, no bloqueante).

**Dependencias:** Ninguna.
**Esfuerzo:** S

---

### T2-02 — `/resultados/habilidades` → `/resultados/dimensiones`
**Feedback original:** *"Cambiar `/resultados/habilidades` a `/resultados/dimensiones`."*

**Problema / crítica:** La vista ya no muestra solo "habilidades": agrupa por **dimensión** (habilidad / contenido / OA / eje / tipo de texto). La ruta y el tab siguen diciendo "Habilidades", desalineados con el contenido.

**Estado actual (🟡):** El **contenido ya migró**: el título de la página dice **"Logro por dimensión"** (`habilidades/page.tsx:62-63`) y agrupa por dimensión vía `SkillsBreakdown`. Falta solo la **ruta** (carpeta `resultados/habilidades/`, `BASE_PATH` en `habilidades/page.tsx:21`) y el **rótulo del tab** (`resultados-nav.tsx:20`).

**Alcance:** Renombrar carpeta `habilidades/` → `dimensiones/`, actualizar `BASE_PATH` y el `href`/`label` del nav, y agregar un **redirect de compatibilidad** desde la ruta vieja (links/marcadores/el asistente E21). El endpoint backend (`/dashboards/skills`) no cambia de nombre.

**Resolución (a grandes rasgos):** Rename de ruta + tab, con redirect. Cambio de bajo riesgo.

**Dependencias:** Ninguna.
**Esfuerzo:** S

---

### T2-03 — Español latinoamericano, sin inglés
**Feedback original:** *"Hacer que la IA y la plataforma usen solo términos en español latinoamericano, nada de inglés."*

**Problema / crítica:** La IA debe responder en español latinoamericano y la UI no debe filtrar inglés.

**Estado actual (🟡):** La IA **ya responde en español, pero calibrada a "español de Chile"** (no LatAm genérico), en 8 archivos de prompt: `ai-analysis/prompts/{item-insight.prompt.ts:55, assessment-insights.prompt.ts:53, instrument-comparison.prompt.ts:55}`, `remedial/prompts/{practice.prompt.ts:91, guide.prompt.ts:33, group-plan.prompt.ts:46}`, `assistant/assistant.constants.ts:71`, `item-edit-proposals/item-edit-proposals.constants.ts:28`. La UI está **casi 100% en español**; las únicas fugas reales de inglés son 2 textos sr-only "Close" de los primitivos shadcn (`components/ui/sheet.tsx:70`, `components/ui/dialog.tsx:49`) y el badge que muestra el enum crudo en mayúsculas de `instrumentType` para valores como `custom`/`pal` (`evaluaciones/components/assessment-list.tsx:44-46`).

**Alcance:** Prompts (decidir "de Chile" → "latinoamericano" en los 8 archivos — es un ajuste de *wording*, el inglés ya está prohibido en el output por instrucción) + traducir los 2 "Close" + mapear a label en español el badge de `instrumentType`.

**Resolución (a grandes rasgos):** Ajustar el wording de idioma en los prompts y cerrar las 2-3 fugas de inglés de la UI. **Decisión menor pendiente:** confirmar si el registro debe ser "latinoamericano" neutro o mantener "de Chile" (afecta modismos y ejemplos que genera la IA).

**Dependencias:** Ninguna.
**Esfuerzo:** S

---

### T2-04 — Desactivar la calidad de ítem con pocas respuestas
**Feedback original:** *"Que en el análisis con IA, cuando se tienen pocas respuestas, no se clasifiquen o evalúen los ítems… Con pocas respuestas no evaluar la calidad del ítem. No evaluar la calidad del ítem en esta fase."*

**Problema / crítica:** La plataforma emite juicios sobre la **calidad del ítem** (¿está bien construido?) sin importar cuántas respuestas haya. Con muestras chicas eso es estadísticamente inválido y **muestra una conclusión inventada como si fuera real** (el mismo antipatrón que v1 corrigió con la nota de corte).

**Estado actual (⬜ — no hay ningún umbral de N):** Hay **tres** lugares que evalúan calidad de ítem, **ninguno gateado por tamaño de muestra**:
1. **Calidad IA por-pregunta** (badge "Ítem sólido / Revisar / Ítem defectuoso"): prompt `ai-analysis/prompts/item-insight.prompt.ts:61-65,92-95`; UI `analisis-ia/components/item-insight-dialog.tsx:67-71,369-381`. El snapshot trae `totalResponses` (`item-insight.snapshot.ts:129`) pero **nada lo usa como compuerta**.
2. **Insights IA a nivel evaluación** (`bottomItems[].likelyCause = "item_quality"`): `assessment-insights.prompt.ts:59-60,93`.
3. **Calidad determinista del instrumento** (H20.9, sin IA): `instrument-quality/instrument-quality.service.ts` (`deriveFlags:175-212` — `low_discrimination`, `ambiguous_key`, etc. + KR-20 + punto-biserial) para **todos** los ítems; UI `analisis-ia/components/quality-panel.tsx`, ruta `evaluaciones/[assessmentId]/calidad/page.tsx`.

El único gating existente es por **capacidad** (evaluaciones `aggregate_only` no tienen psicometría), no por N. Los prompts piden `caveats` ("muestra chica") pero es advisory, no bloquea.

**Alcance:** Prompts (suprimir el veredicto de calidad de ítem) + UI (ocultar el bloque "Calidad del ítem" y el panel de calidad) + Backend (dejar de emitir banderas de calidad). **Decisión tomada: desactivar por ahora** (no umbral).

**Resolución (a grandes rasgos):** Desactivar en esta fase la **evaluación de calidad del ítem** en los 3 caminos (ocultar el veredicto IA sólido/revisar/defectuoso, las banderas psicométricas y la pestaña/panel de "Calidad del instrumento"). **Conservar** el análisis de resultados, distribución de respuestas y distractores (eso sí es útil con cualquier N). Dejarlo **reactivable** en el futuro detrás de un umbral de N y/o una llave de configuración, cuando haya volumen de respuestas.

**Dependencias:** Ninguna. Conceptualmente alineado con la filosofía de v1 (no mostrar datos no confiables).
**Esfuerzo:** S/M

---

### T2-05 — Instrumento de origen en el panel de ítem
**Feedback original:** *"Agregar el instrumento de donde se sacó cada ítem."*

**Problema / crítica:** En el banco de ítems global, cada ítem viene de un instrumento; saber su origen es clave para interpretarlo y confiar en él.

**Estado actual (🟡):** **Ya se muestra en la lista** del banco de ítems: cada ítem lleva un badge con el nombre del instrumento (`ItemBankExplorer.tsx:81-83`; "Ítem sin instrumento" en `:65-67`). El nombre se resuelve con un **join client-side** (la página fetchea `/instruments?limit=200` y arma un mapa id→nombre, `explorar/page.tsx:138-146`). **Falta** en el **panel lateral** de detalle del ítem (`ItemDetailPanel.tsx` no lo incluye). En BDD `items.instrumentId` existe (`items.ts:31`) y se expone en `ItemModel` (`item.schema.ts:368`), pero el payload no trae `instrumentName`.

**Alcance:** UI (agregar el origen al `ItemDetailPanel`). Opcional Backend: denormalizar `instrumentName` en el payload de `/items` (join en el service) para no traer 200 instrumentos aparte.

**Resolución (a grandes rasgos):** Mostrar el instrumento de origen también en el panel lateral. Si se quiere robustez, mover el join al backend.

**Dependencias:** Toca el mismo `ItemDetailPanel` que T2-18 (unificación del panel).
**Esfuerzo:** S

---

# OLA 2 — Tablero maestro, "Mis cursos" y navegación

> Reorganización de la arquitectura de información y densificación de las vistas de trabajo diario. Riesgo medio: se mueven puntos de entrada del menú, así que hay que cuidar accesos por rol y redirects.

---

### T2-06 — Tablero maestro: rótulo + densidad + comparativas
**Feedback original:** *"Poner tablero maestro en vez de detalle por pregunta."* + *"En el tablero maestro que solo aparezca el nombre del estudiante y que aparezcan más alumnos por alto de pantalla. Agregar comparativa con el % de logro del colegio y de benchmark."*

**Problema / crítica:** El grid alumno×pregunta es la vista más potente para leer patrones, pero (a) su rótulo "Detalle por pregunta" no comunica que es el **tablero maestro** del análisis, y (b) cada fila es alta (3 líneas) y caben pocos alumnos por pantalla.

**Reconciliación de terminología:** En v1 "tablero maestro" y "Detalle por pregunta" eran **lo mismo** (el código ya lo llama "tablero maestro"). En v2 se **adopta "Tablero maestro" como rótulo visible**. **Decisión: densificar el actual, no crear una vista nueva.**

**Estado actual (🟡):** El componente es `resultados/detalle/cross-table.tsx` (grid alumno×pregunta, "tablero maestro" en `:483,489`), montado en `evaluaciones/[assessmentId]/detalle/page.tsx`, tab "Detalle por pregunta" (`layout.tsx:108-110`). Ya trae click→panel (`:396`), orden por logro/columna (TKT-09), filtro multi-tag (TKT-12), pantalla completa y la **fila "% Logro colegio"** (`SchoolReferenceRow:489-523`, `references.org`). La fila del alumno muestra nombre + **RUT + curso + "X/Y correctas"** (`:551-560`), lo que la engorda. Backend: `GET /item-analysis/matrix`; `MatrixStudentRow` ya trae esos campos extra (`item-analysis.schema.ts:124-134`).

**Alcance:** UI. (a) Renombrar el tab "Detalle por pregunta" → "Tablero maestro" (`layout.tsx:109`). (b) Densificar la fila del alumno (dejar solo el nombre; mover RUT/curso/correctas a tooltip u ocultar). (c) **% colegio ya existe** — nada que hacer. (d) **Benchmark: diferido** (`references.sample` está deliberadamente sin poblar hasta tener pool multi-colegio, TKT-20 de v1; el módulo `/benchmarking` existe aparte con `benchmark_aggregates` pero no está integrado al tablero).

**Resolución (a grandes rasgos):** Re-rotular y densificar el tablero maestro para ver más alumnos de un vistazo, conservando la fila de referencia del colegio. La comparativa contra **benchmark** se **posterga** hasta que exista el pool multi-colegio; cuando exista, se integra poblando `references.sample` desde el read-model de benchmarking.

**Dependencias:** Benchmark bloqueado por TKT-20 (v1). El rename del tab interactúa con T2-09/T2-10 (navegación del hub).
**Esfuerzo:** M (densidad + rótulo; el benchmark integrado queda fuera).

---

### T2-07 — "Mis cursos" en filas, no calugas
**Feedback original:** *"Agregar filas a mis cursos y no a calugas."*

**Problema / crítica:** La lista de cursos usa tarjetas ("calugas"), poco densas para escanear muchos cursos; el usuario quiere una lista/tabla.

**Estado actual (⬜ para esta vista):** `dashboard/my-classes/page.tsx:85-123` es un **grid de cards** (cada curso es un `Link>Card` con las asignaturas y badges de rol). La página de **detalle** de un curso (`[classGroupId]/page.tsx:126-152`) **ya usa tabla**. Existe **precedente exacto**: la lista de evaluaciones fue migrada de calugas a filas densas en v1 (TKT-08, `evaluaciones/components/assessment-list.tsx`).

**Alcance:** UI (presentación pura; datos de `listClassGroupsForUser`). **Consideración de diseño:** cada curso tiene N asignaturas con rol (Titular/Asistente); la tabla debe resolver la relación curso×asignatura (fila por asignatura agrupada, o fila-curso expandible).

**Resolución (a grandes rasgos):** Reescribir el grid como lista/tabla densa siguiendo el patrón ya usado en la lista de evaluaciones, resolviendo cómo mostrar las asignaturas por curso.

**Dependencias:** Ninguna. Interactúa con T2-08 (ambas tocan "Mis cursos").
**Esfuerzo:** S/M

---

### T2-08 — Degradar "Mis cursos" + secciones colapsables
**Feedback original:** *"Página de mis cursos ponerla con menor acceso. Agregar una sección administrativa y ahí poner los accesos menos frecuentes."*

**Problema / crítica:** "Mis cursos" ocupa un lugar muy prominente para un acceso que no todos los roles usan a diario; y los accesos menos frecuentes deberían quedar recogidos/colapsados para despejar el menú.

**Estado actual (🟡):** El sidebar **ya está agrupado** en 3 secciones (`nav-items.ts:85-247`: Análisis / Contenido y datos / **Administración** — esta última ya existe con Alumnos, Mi Colegio, Equipo, Configuración, `:205-246`). "Mis cursos" es el **2º ítem del primer grupo** (`:98-103`). **Los grupos NO son colapsables** hoy: `SidebarNav.tsx:63-83` los renderiza siempre abiertos; lo único colapsable es el sidebar entero a un riel de iconos (`Sidebar.tsx:16-44`).

**Alcance:** UI (`nav-items.ts` + `SidebarNav.tsx`). (a) Mover "Mis cursos" a una posición menos prominente. (b) Para "recoger los accesos menos frecuentes" hace falta **colapsabilidad por grupo** (nueva).

**Resolución (a grandes rasgos):** Bajar "Mis cursos" en la jerarquía del menú y hacer colapsables las secciones de menor uso (recordando el estado por sección). **Nota de producto a validar:** "Mis cursos" es la **puerta de entrada del profesor**; degradarla afecta el UX docente. Además, la "sección administrativa" que pide el feedback **ya existe** — conviene confirmar con el usuario si (i) no la notó, (ii) quiere mover más ítems ahí, o (iii) quiere que "Mis cursos" viva ahí. **Duda abierta (ver §7).**

**Dependencias:** Interactúa con T2-07 y T2-09 (todas tocan el sidebar / "Mis cursos").
**Esfuerzo:** M

---

### T2-09 — Sacar Análisis IA / Comparar / Material del sidebar
**Feedback original:** *"Mover comparar instrumentos, material remedial y análisis IA a evaluaciones. Sacarlos del sidebar."*

**Problema / crítica:** Estas tres vistas son **análisis de una evaluación**, no destinos de primer nivel. Tenerlas en el sidebar obliga a re-elegir la evaluación en cada una. Deben alcanzarse **desde** la evaluación.

**Estado actual (🟡 — tres situaciones distintas):**
1. **Análisis IA — ya migrado, falta limpiar el sidebar.** El top-level `analisis-ia/page.tsx:22-43` es **solo un redirect** al hub (`/evaluaciones/[id]/analisis-ia`); la UI ya vive como **pestaña del hub** (`layout.tsx:111-113`). Queda **quitar el ítem del sidebar** (`nav-items.ts:118-124`).
2. **Material remedial — se transforma (ver T2-19).** El top-level (`material-remedial/page.tsx`) es un **banco global cross-evaluación** (no redirect) y también es pestaña del hub (`layout.tsx:114-116`). **Decisión:** se reemplaza el ítem "Material Remedial" del sidebar por la nueva entrada "Estudio de material" (T2-19), que es legítimamente cross-evaluación.
3. **Comparar instrumentos — no tiene hogar en el hub.** `comparar-instrumentos/page.tsx` compara **DOS evaluaciones** del mismo `comparableKey` (`components/comparison-workbench.tsx:49-73`); **no mapea a una pestaña de una sola evaluación**. Sacarlo del sidebar **sin nuevo hogar lo deja huérfano**.

**Alcance:** UI (nav) + **diseño de ubicación de "Comparar"**. Revisar cross-links a `/analisis-ia?...` (siguen funcionando por el redirect).

**Resolución (a grandes rasgos):** Quitar "Análisis IA" del sidebar (trivial, ya redirige). Reemplazar "Material Remedial" por "Estudio de material" (T2-19). **Reubicar "Comparar instrumentos"** con un hogar contextual — **recomendado:** una acción dentro del hub de una evaluación ("Comparar con otra evaluación") que la fija como base y pide la comparación; o un acceso cross-evaluación dentro de "Evaluaciones". **Duda abierta (ver §7).**

**Dependencias:** El caso "material" depende de T2-19 (Estudio). El caso "comparar" necesita una decisión de diseño.
**Esfuerzo:** M

---

### T2-10 — Filtros en query params (comparar) + "Volver" consistente
**Feedback original:** *"Agregar filtros a query params para persistencia en navegación. Agregar volver hacia atrás en todas las vistas."*

**Problema / crítica:** (a) Algunas selecciones no persisten al refrescar/compartir/volver. (b) No hay una afordancia de "volver" consistente; en varias vistas de detalle el usuario queda sin salida natural.

**Estado actual (🟡):**
- **Query params — ya es el patrón** (sin Zustand): `resultados/components/dashboard-filters.ts:34-50` + `dashboard-filter-bar.tsx:45-92` empujan filtros a la URL; el nav de resultados y las tabs del hub **preservan la querystring** (`resultados-nav.tsx:28-30`, `assessment-tabs-nav.tsx:44-45`). **Hueco:** `comparar-instrumentos/components/comparison-workbench.tsx:50-57` guarda la selección en `useState` local → **se pierde al refrescar/volver/compartir**.
- **"Volver" — inconsistente y ad-hoc:** un solo `router.back()` en toda la app (`configuracion/escalas/.../escala-form.tsx:260`); el resto son `Link` "Volver" hardcodeados presentes en *algunas* páginas de detalle (`my-classes/[id]:74-79`, `material-remedial/[id]:72-76`, `informe-alumno/[studentId]:48-52`, etc.) y **ausentes por completo en las pestañas del hub** (`evaluaciones/[assessmentId]/{resultados,analisis-ia,material-remedial,calidad,detalle}`). El `PageHeader.tsx:9` tiene un slot `breadcrumb` marcado "implementación futura", usado solo por banco/admin; el hub no lo pasa.

**Alcance:** UI. (a) Persistir la selección de `comparison-workbench` a query params (mismo patrón que `dashboard-filter-bar`). (b) Afordancia de retorno consistente: un componente `BackLink` reutilizable o activar el slot `breadcrumb` de `PageHeader`, **especialmente dentro del hub** ("Volver a Evaluaciones").

**Resolución (a grandes rasgos):** Llevar la selección de comparar a la URL, y estandarizar el "Volver" (un patrón único de retorno/breadcrumb) desplegado en las vistas de detalle y en el hub.

**Dependencias:** El fix de `comparison-workbench` se coordina con T2-09 (reubicación de Comparar).
**Esfuerzo:** M

---

### T2-11 — Tabla de especificaciones: navegación + filtros + resumen
**Feedback original (3 sub-puntos):** *"Al abrir la tabla de especificaciones, te envía a la pestaña banco de instrumentos y no hay cómo volver."* · *"Agregar filtros en el encabezado (por OA / habilidad / tipo de texto)."* · *"Agregar un tab que muestre un resumen: cantidad de preguntas por cada eje temático; un panorama general del instrumento."*

**Problema / crítica:** La tabla de especificaciones se abre perdiendo el contexto (te expulsa a "Banco de Instrumentos" sin retorno), no se puede filtrar, y no ofrece una lectura resumida del instrumento.

**Estado actual (⬜):** Es una vista compartida `SpecTableView` montada en 2 rutas (`banco-items/[instrumentId]/spec-table/page.tsx` y `admin/instrumentos/[instrumentId]/spec-table/page.tsx`); ambas fetchean `/items?instrumentId=…` (no el endpoint `spec-tables`, que está huérfano). La tabla es una matriz 1 fila/pregunta × 1 columna/tipo-de-nodo (`SpecTableReview.tsx:60-68`).
- **(a) Navegación:** el disparador desde el hub (`evaluaciones/[assessmentId]/layout.tsx:158-162`) es un `Link` **en la misma pestaña, sin retorno**; la ruta vive fuera del grupo de rutas de la evaluación, así que el sidebar salta a "Banco de Instrumentos" y el breadcrumb queda fijo (`SpecTableView.tsx:44-54`), **sin vuelta a la evaluación**.
- **(b) Filtros:** la tabla **no tiene ninguno** (encabezados de texto plano, `SpecTableReview.tsx:76-85`). El dato para filtrar **ya está 100% en el cliente** (cada ítem trae sus tags con `node.type`/`node.name`) y **el componente ya existe**: `banco-items/TagMultiFilter.tsx` + `tag-facets.ts`, usado en la tabla de ítems del mismo instrumento pero no aquí. (La spec-table además no oculta el tipo `descriptor`, a diferencia del banco.)
- **(c) Resumen por eje:** no hay estructura de tabs. **Matiz importante:** "eje temático" = tipo de nodo `axis`, pero **los ítems DIA no llevan tag directo de `axis`** (el eje es el **padre** del OA, vía `parentId`), y el payload actual no trae `parentId`.

**Alcance:**
- (a) UI/navegación: abrir la spec-table conservando el retorno.
- (b) UI: cablear `TagMultiFilter`/`deriveTagFacets` existentes (cero backend).
- (c) UI si "eje temático" se interpreta como **cualquier dimensión ya etiquetada** (habilidad/OA/tipo de texto = derivable en cliente ya); **UI + Backend** si se exige el **eje estricto** (axis, padre del OA) → hay que exponer el ancestro (fetch del árbol de taxonomía, que sí trae `parentId`, o agregación en backend).

**Resolución (a grandes rasgos):** (a) Abrir la tabla sin perder el origen — recomendado: abrir en pestaña nueva, o renderizarla como panel/pestaña dentro del hub, o pasar `?from=` y pintar "Volver". (b) Reutilizar el filtro multi-tag existente en el encabezado. (c) Agregar un tab de resumen con conteos por dimensión; para el "eje temático" estricto, resolver OA→eje exponiendo el ancestro. **Duda abierta:** confirmar si "por cada eje temático" admite contar por habilidad/OA (rápido) o exige el eje-axis real (ver §7).

**Dependencias:** (a) se relaciona con T2-10 ("Volver" consistente). (c) con T2-16 (los árboles de taxonomía exponen los ancestros).
**Esfuerzo:** M

---

### T2-24 — Ocultar "Importar" del sidebar
**Feedback original:** *"Ocultar del sidebar la sección de 'Importar'."*

**Problema / crítica:** El ítem "Importar" ocupa un lugar en la navegación principal que el usuario prefiere despejar; la importación no necesita estar siempre a la vista.

**Estado actual (⬜):** "Importar" es un ítem del grupo "Contenido y datos" del sidebar (`nav-items.ts:160-166`, href `/importar`, roles `ANSWER_SHEET_IMPORT_ROLES`). El hub `/importar` y sus subflujos (nómina / instrumento / resultados) siguen existiendo. Hoy también se alcanza desde el estado vacío de `/evaluaciones` (`evaluaciones/page.tsx:99`, `ROUTES.importar`) y desde la Home.

**Alcance:** UI (`nav-items.ts`). Quitar el ítem del array del grupo "Contenido y datos". La ruta `/importar` **no se elimina**.

**Resolución (a grandes rasgos):** Ocultar "Importar" del sidebar. **Nota de acceso:** al quitarlo, la importación queda alcanzable solo desde la Home/onboarding y el estado vacío de Evaluaciones; conviene asegurar que esos accesos existan (o dejar el ítem gateado a un rol muy acotado) para no dejar huérfano el flujo de quien importa a diario.

**Dependencias:** Coherente con T2-09 (limpieza del sidebar).
**Esfuerzo:** S

---

### T2-25 — Banco → `/banco-contenido`: tabs en una fila + `?tab=` + quitar "Nuevo instrumento"
**Feedback original:** *"Cambiemos /banco-items por /banco-contenido y movamos el selector de tabs (Instrumentos o ítems) a la misma fila, con el título 'Banco de contenido / Instrumentos de evaluación y el banco de ítems del colegio.' más a la derecha para aprovechar el alto de la ventana. Agregar `?tab=items|instrumentos` para persistir el tab."* + *"Eliminar opción de 'Nuevo instrumento'."*

**Problema / crítica:** El nombre de la ruta (`/banco-items`) no coincide con el título ya visible ("Banco de contenido"); el encabezado apila el título sobre las tabs, gastando alto vertical; el tab activo no queda reflejado como parámetro compartible; y sobra el CTA "Nuevo instrumento".

**Estado actual (🟡):** El hub **ya existe** como route group `banco-items/(hub)/` con `layout.tsx` (persiste header+tabs) y `BancoHubHeader.tsx:13-17`, que **ya** muestra `PageHeader title="Banco de contenido"` + descripción "Instrumentos de evaluación y el banco de ítems del colegio." **apilado ARRIBA** de `PageTabs` (tabs Instrumentos/Ítems, definidas en `components/layout/view-tabs` → `BANCO_TABS`). Los dos tabs son **subrutas** (`/banco-items` y `/banco-items/explorar`), **no** un `?tab=`. El CTA "Nuevo instrumento" vive en el cuerpo del tab Instrumentos (`(hub)/page.tsx:63`), enlazando a `banco-items/nuevo/`.

**Alcance:** UI + rename de ruta. (a) Renombrar `/banco-items` → `/banco-contenido`: carpeta de rutas, `ROUTES.bancoItems` (`lib/routes.ts`), `BANCO_TABS` (`view-tabs`), los 2 ítems del sidebar (`nav-items.ts:168-195`) y los enlaces internos; + redirects de compatibilidad (⚠️ `07-navigation-reactivity.md` avisa que mover páginas deja tipos `.next/types` obsoletos). (b) Reencuadrar `BancoHubHeader` para poner tabs y título en **una sola fila** (título/descripción a la derecha) y ganar alto. (c) Reflejar el tab activo como `?tab=items|instrumentos`. (d) Quitar el CTA "Nuevo instrumento".

**Resolución (a grandes rasgos):** Renombrar la sección a "Banco de contenido" también en la ruta, compactar el encabezado a una fila, hacer el tab activo direccionable por URL, y remover "Nuevo instrumento". **Consideración de diseño (`?tab=` vs subrutas):** hoy los tabs son subrutas bajo `(hub)` — patrón que `07-navigation-reactivity.md` recomienda (cada tab con su `loading.tsx` y code-split). Pasar a `?tab=` en una sola ruta cumple el pedido literal pero sacrifica ese streaming por-tab; la alternativa es conservar subrutas (`/banco-contenido` y `/banco-contenido/explorar`) que ya persisten en la URL y son compartibles. Definir cuál al implementar. **Sobre "Nuevo instrumento":** la creación manual de instrumentos es marginal en F1 (el banco es de instrumentos DIA oficiales); quitar el CTA no elimina la ruta `/nuevo` — decidir si se deja huérfana o se remueve.

**Dependencias:** Toca el mismo sidebar que T2-08 / T2-09 / T2-24. El tab Ítems es el de T2-26.
**Esfuerzo:** M

---

# OLA 3 — Filtros, jerarquía y dashboards

> El corazón analítico. Aquí está el gap más profundo (multi-selección transversal) y la reestructuración del Panorama. Se aborda después de la navegación porque varias piezas se apoyan en los filtros.

---

### T2-12 — Multi-selección transversal en filtros
**Feedback original:** *"Importante que se puedan escoger varios."*

**Problema / crítica:** Los filtros de los dashboards son de **un valor por dimensión**; el usuario necesita comparar varias asignaturas/niveles/cursos a la vez.

**Estado actual (⬜):** Todo **single-select** en la barra de filtros de dashboards (`dashboard-filter-bar.tsx:154-185`, Radix `Select`). Los únicos filtros multi que existen son puntuales: el `TagFilterMenu` del tablero maestro y el `NodeTypeFilter` del banco de ítems. En backend, los schemas aceptan **un UUID por clave** (`dashboard.schema.ts:21-30`, `heatmap.schema.ts:20`, `analytics.schema.ts:20`, `item-analysis.schema.ts:26-33`); el único array existente es `tagIds` (`item-analysis.schema.ts:64`).

**Alcance:** Transversal — **Backend + BDD-queries + UI**. Cambiar los schemas de filtros a arrays (`z.array`), adaptar los `WHERE` de los services de `eq` a `inArray`, y cambiar los `Select` por multi-select en todas las vistas que montan la barra.

**Resolución (a grandes rasgos):** Introducir soporte multi-valor en todo el stack de filtros. **Recomendación:** hacerlo **por dimensión priorizada** (empezar por Asignatura/Nivel/Curso), no en un big-bang, para acotar el riesgo. Es el ticket más profundo de esta ola.

**Dependencias:** Habilita a T2-13 (banco) y T2-14 (jerarquía). El tablero maestro (T2-06) ya tiene su propio multi-tag.
**Esfuerzo:** L

---

### T2-13 — Banco de ítems: multi-select en asignatura / nivel / eje
**Feedback original:** *"En el banco de ítems poder seleccionar más de un filtro por dropdown."*

**Problema / crítica:** En el banco de ítems, algunos filtros ya son multi pero otros no, de forma inconsistente.

**Estado actual (🟡 — parcial):** Los filtros por **dimensión de taxonomía (OA / habilidad / tipo de texto)** **ya son multi-select** (`explorar/NodeTypeFilter.tsx:29-84`, checkbox con OR; se serializan en la URL y el server aplica grupos AND). Siguen **single-select**: **Asignatura** (`ItemBankFilters.tsx:200`), **Nivel** (`:219`) y **Eje padre** (`:241`). El banco de **instrumentos** tiene todos sus filtros single (`InstrumentFilters.tsx:88-175`). Backend: `/items` ya acepta `taxonomyNodeIds`/`taxonomyNodeGroups` (multi), pero `subjectId`/`gradeId` son escalares (`item.dto.ts:119-121`, `eq` en `items.service.ts:78-79`).

**Alcance:** UI (convertir Asignatura/Nivel/Eje a multi-select, reutilizando el patrón `NodeTypeFilter`) + Backend menor (aceptar arrays en `subjectId`/`gradeId` y usar `inArray`). Sin cambio de schema de BDD.

**Resolución (a grandes rasgos):** Homogeneizar a multi-select los 3 dropdowns que faltan, reutilizando el componente ya existente. Es un caso acotado de T2-12.

**Dependencias:** Comparte enfoque con T2-12 (arrays en el backend).
**Esfuerzo:** S/M

---

### T2-26 — Banco de ítems: paginación de 20/página + quitar el filtro de alcance
**Feedback original:** *"En /banco-items/explorar (ahora `/banco-contenido?tab=items`) agregar paginación al endpoint (con persistencia en la URL), 20 ítems por página. Eliminar el filtro por 'Ítems globales, mis ítems o Todos los ítems'."*

**Problema / crítica:** El tab Ítems no pagina — muestra los primeros N y avisa "afina los filtros"; y expone un selector de alcance (propio/global/todos) que se quiere quitar.

**Estado actual (🟡):** `(hub)/explorar/page.tsx` pide `getItems` con `pageSize=100` (`:164`) y, si `total > items.length`, muestra un aviso "Mostrando X de Y ítems. Afina el alcance…" (`:179-190`) — **no hay pager ni `?page=`**. El endpoint de ítems **ya soporta paginación**: `itemListQuerySchema` tiene `page` (default 1) y `limit` (default 50, máx 200) y la respuesta trae `total` (`item.schema.ts:192-193`). ⚠️ Hay un desajuste: la página envía `pageSize`, que el schema no define (usa `limit`), así que probablemente cae al default. El filtro de alcance es `ItemBankScopeSelect` (`?scope=`, `ITEM_BANK_SCOPES = ['own','global','all']`, labels "Mis ítems"/"Ítems globales"/"Todos los ítems"; default `all`).

**Alcance:** UI + Backend menor. (a) Paginación real: pager con `?page=` persistido en URL, `limit=20`, que reemplaza el aviso de truncado; alinear el nombre del parámetro (`pageSize`→`limit`) para que el endpoint lo honre. (b) Eliminar `ItemBankScopeSelect` del tab; el alcance queda fijo en `all` (el backend sigue aceptando `scope`, solo se quita el control de la UI).

**Resolución (a grandes rasgos):** Cablear la paginación (20/pág, URL-persistida, con el patrón `useTransition` + `TopProgressBar` de `07-navigation-reactivity.md`) sobre el `total`/`limit` que el endpoint ya expone, y quitar el selector de alcance. En backend, verificar/ajustar que el listado honre `page` + `limit` (hoy la UI manda `pageSize`).

**Dependencias:** Mismo tab que T2-25 (renombra la ruta) y T2-13 (multi-filtros del banco).
**Esfuerzo:** S/M

---

### T2-14 — Jerarquía Asignatura › instrumento › habilidad/eje › nivel
**Feedback original:** *"En los árboles de taxonomía… asignatura, y por asignatura tener ejes o habilidades."* + *"Asignatura › instrumento › habilidad o eje › nivel."*

**Problema / crítica:** El usuario piensa el análisis como una **escalera**: elige asignatura, luego el instrumento, luego una habilidad/eje, luego el nivel. Los filtros actuales no ofrecen ese encadenamiento (falta el paso "instrumento" y el paso "habilidad/eje").

**Estado actual (🟡):** La barra ofrece Período · Asignatura · Nivel · Curso · **Tipo** de instrumento (`dashboard-filter-bar.tsx:107-143`), con cascada solo **Nivel→Curso**. **No hay** selector de **instrumento concreto** ni de **habilidad/eje**. El backend **ya soporta `instrumentId`** (`dashboard.schema.ts:23`, consumido en `dashboards.service.ts:1376,1404`) y `/dashboards/filters` **ya devuelve la lista de instrumentos** — pero la UI los **colapsa a su `type`** (`dashboard-filter-bar.tsx:97-99`). El filtro por habilidad/eje (`nodeId`) **no** está en el schema de filtros del dashboard (sí existe la escalera Asignatura→…→Pregunta, pero solo dentro del drill-down modal, `skill-drilldown-dialog.tsx:59`).

**Alcance:** UI (añadir selector de **instrumento** — dato ya disponible — y de **habilidad/eje**, encadenados en cascada) + Backend (extender `dashboardFiltersQuerySchema` y los services para filtrar los dashboards agregados por `nodeId`/eje).

**Resolución (a grandes rasgos):** Reconstruir la barra de filtros como una cascada Asignatura → Instrumento → Habilidad/Eje → Nivel, exponiendo el instrumento concreto (ya disponible) y agregando el filtro por nodo. Es el habilitador de T2-15 (Panorama select-first).

**Dependencias:** Alimenta a T2-15. Se beneficia de T2-12 (multi). El paso "habilidad/eje" toca el mismo `nodeType` que T2-16.
**Esfuerzo:** M

---

### T2-27 — Filtro de momento DIA en `/evaluaciones` (condicional)
**Feedback original:** *"En /evaluaciones agregar filtro de tipo de prueba DIA, que se renderice solo cuando se selecciona DIA (diagnóstico, monitoreo o cierre)."*

**Problema / crítica:** Al filtrar por instrumento tipo DIA, no se puede acotar por el **momento** de la prueba (Diagnóstico / Monitoreo / Cierre), que es una distinción central del DIA. El filtro debe aparecer **solo** cuando el tipo seleccionado es DIA (cascada tipo → momento).

**Estado actual (⬜):** `/evaluaciones` (`evaluaciones/page.tsx:33-63`) monta el `DashboardFilterBar` compartido, que ya tiene "Tipo de instrumento" (single-select) pero **no** un filtro de momento. El dato existe: `instruments` lleva la columna de momento (`instrument_application_period` enum = `['diagnostico','intermedio','cierre']`, `enums.ts:81-85`). ⚠️ **Nota de nomenclatura:** el valor del enum es `intermedio`, pero el DIA oficial (y el feedback) lo llama **"Monitoreo"** — el filtro debe mostrar Diagnóstico / Monitoreo / Cierre mapeando a `diagnostico` / `intermedio` / `cierre` (no hardcodear "DIA", §8.2 CLAUDE.md; usar el tipo/enum).

**Alcance:** UI + Backend. (a) UI: agregar al `DashboardFilterBar` / `dashboard-filters` un filtro de momento que **solo se renderice cuando el tipo es DIA**, con labels DIA. (b) Backend: extender `dashboardFiltersQuerySchema` con el momento y filtrar las evaluaciones por `instrument.applicationPeriod`; exponer los momentos disponibles en el endpoint de opciones de filtro.

**Resolución (a grandes rasgos):** Filtro condicional de momento DIA en la barra de Evaluaciones, gateado a `instrumentType = dia`. **Consideración:** el `DashboardFilterBar` es compartido (también en `/resultados`); al renderizarse solo con DIA queda naturalmente acotado, pero conviene decidir si se muestra en todas las vistas que usan la barra o solo en `/evaluaciones`.

**Dependencias:** Extiende la barra de filtros (T2-14 jerarquía; se beneficia de T2-12 multi).
**Esfuerzo:** M

---

### T2-15 — Panorama pedagógico select-first (entra al hub)
**Feedback original:** *"Hacer que el panorama pedagógico sea un dashboard donde se pueda ver el detalle de cada nivel por asignatura, por OAs, por habilidades — pero mezclar distintos logros y asignaturas no tiene sentido. Que sea un tablero maestro que dé una visión rápida por instrumento. Poder seleccionar primero una asignatura, una evaluación o un nivel. Agregar métricas por ejes, por habilidades."*

**Problema / crítica:** El "Panorama pedagógico" (vista por defecto de `/resultados`) **agrega todo lo visible mezclando asignaturas y grados** en las mismas grillas (p. ej. el mapa de calor cruza habilidad×asignatura), lo que **no tiene sentido pedagógico**: habilidades de asignaturas distintas no son comparables. El usuario quiere **acotar primero** (asignatura / evaluación / nivel) y ver el logro **por eje y por habilidad del instrumento elegido**.

**Estado actual (🟡):** `/resultados` (`resultados/page.tsx:66`) es un overview con KPIs globales + distribución + alertas + evaluaciones recientes, **sin selección obligatoria**. El **mapa de calor** (`mapa-calor/page.tsx:63-64`) es exactamente lo que el usuario objeta (habilidad×asignatura). **La vista select-first por instrumento con métricas de eje/habilidad YA existe**, pero **vive en el hub por-evaluación**: `evaluaciones/[id]/resultados` → `ReportBody` con `SkillsBreakdown` (dropdown de dimensión habilidad/contenido/OA/eje, `skills-breakdown.tsx:40-48`) + drill-down. El backend `/dashboards/skills` ya devuelve los nodos evaluados con su `nodeType` (`dashboard.schema.ts:199-215`).

**Reabre TKT-18 (v1)**, que había decidido **no** reestructurar Panorama (solo renombrarlo). **Decisión v2: sí reestructurar, como selector que entra al hub.**

**Alcance:** UI / reorganización (los datos y componentes de la vista profunda ya existen). Convertir `/resultados` en un panel que (a) **obliga a acotar** (asignatura → instrumento/evaluación → nivel), (b) **no mezcla** asignaturas en una sola grilla, y (c) al elegir un instrumento concreto **enlaza a la vista profunda del hub** (que ya tiene ejes/habilidades/drill-down). Revisar el mapa de calor cross-asignatura.

**Resolución (a grandes rasgos):** `/resultados` deja de ser un agregado que mezcla todo y pasa a ser un **selector guiado** que desemboca en el hub por-evaluación. No se reimplementa la vista profunda: se reutiliza. Las "métricas por ejes/habilidades" ya viven en `SkillsBreakdown`.

**Dependencias:** Se apoya en T2-14 (cascada de filtros con instrumento) y en el hub existente. Interactúa con T2-06 (el "tablero maestro" es una pestaña del hub).
**Esfuerzo:** M/L

---

### T2-16 — Árboles de taxonomía agrupados por asignatura
**Feedback original:** *"En los árboles de taxonomía, la categorización asignatura y por asignatura tener ejes o habilidades."*

**Problema / crítica:** El usuario quiere leer la taxonomía **por asignatura primero**, y dentro de cada asignatura sus ejes/habilidades. Hoy el árbol no arranca por asignatura.

**Estado actual (🟡):** `marcos-academicos/[taxonomyId]/TreeView.tsx` renderiza el árbol **puramente por `parentId`** (`buildTree:54-69`), con un badge de tipo por nodo; los labels ya incluyen **Eje** y **Habilidad** (`:26-38`). **No agrupa por asignatura** (la asignatura es un atributo del nodo, `subjectId`, no un nivel del árbol). En los datos reales (`seed/taxonomy-real.ts`, `data/taxonomia-catalogo-v2.json`, 1281 nodos): el **Currículum Nacional** arranca por **DIMENSIÓN** (Contenido / Habilidades / Tipos de texto) y la asignatura aparece en el 2º nivel — **inverso** a lo que pide el feedback; el **DIA** sí arranca por asignatura. El schema `taxonomy_nodes` ya es polimórfico (`type`/`subjectId`/`gradeId`/`parentId`); `axis` y `skill` ya son tipos de nodo.

**Alcance:** Sin cambio de schema. **Opción A (UI):** en `TreeView`, pivotar/agrupar por `subjectId` para que el primer nivel sea Asignatura y debajo cuelguen ejes/habilidades. **Opción B (datos/seed):** re-rootear el catálogo para que la asignatura sea el dominio raíz.

**Resolución (a grandes rasgos):** Presentar el árbol asignatura-first. **Recomendado:** la opción A (agrupar por `subjectId` en el render) porque no toca datos ni migraciones y funciona para currículum y DIA por igual.

**Dependencias:** Comparte el modelo de nodos con T2-14 (habilidad/eje como filtro) y T2-11c (eje temático).
**Esfuerzo:** M

---

### T2-17 — Informes: tabla de ítems clickeable + comparativa % del nivel
**Feedback original:** *"En los informes hacer que se pueda clickear y desplegar el panel de pregunta. Agregar comparativa contra el % de logro del nivel en el informe del curso y por alumno."*

**Problema / crítica:** En el informe de curso, la tabla de análisis de preguntas no permite abrir el detalle de cada pregunta; y no hay una **línea de comparación contra el nivel/grado** que le diga al usuario si un resultado es bueno o malo en contexto.

**Estado actual (🟡):**
- **Clic → panel:** ya existe en el tablero maestro (`cross-table.tsx:396`) y vía `SkillsBreakdown` → drill-down (`skill-drilldown-dialog.tsx:365`). **Pero** en `ReportBody` la tabla "Análisis de preguntas" (`report-body.tsx:479-518`, `ItemsSection`) **no es clickeable** — es una tabla estática de psicometría.
- **Comparativa vs % del nivel:** **no existe.** El `QuestionDetailPanel` muestra % de la pregunta/respuestas/blanco (`question-detail-panel.tsx:129-141`) sin comparación. La única referencia por pregunta es `references.org` (**% del COLEGIO**, en el tablero maestro, no del nivel). El informe de curso trae `courseComparison.gapVsAverage` (brecha vs promedio del propio informe) y el informe por alumno trae `classAverageAchievement` (promedio del **curso**), **ninguno es el % del nivel/grado**.

**Alcance:** UI (hacer clickeable la tabla de ítems del `ReportBody`, reutilizando `QuestionDetailPanel`) + Backend (agregar al `QuestionAnalysisResponse` y al informe por alumno una **referencia "% de logro del nivel/grado"** — hoy solo se calcula la referencia org, `item-analysis.service.ts:673,701`; hay que calcular el agregado por grade y exponerlo).

**Resolución (a grandes rasgos):** Habilitar el clic-a-panel desde la tabla de preguntas del informe, y añadir la línea de comparación contra el nivel (nueva referencia por grade) tanto en el panel de pregunta como en el informe por alumno.

**Dependencias:** Se apoya en el `QuestionDetailPanel` (que T2-18 unifica). Extiende TKT-10/TKT-11 (v1).
**Esfuerzo:** M

---

### T2-18 — Unificar el cuerpo del panel de pregunta (resultados ↔ instrumento)
**Feedback original:** *"Que el panel lateral de pregunta sea el mismo que de la sección de detalles de un instrumento."*

**Problema / crítica:** Hay dos "paneles de pregunta" con contenidos distintos: el de **detalle de instrumento/banco** (muestra el enunciado, las alternativas con la correcta marcada, y los nodos) y el de **resultados** (muestra distribución de respuestas, distractores y métricas, pero **no** el contenido del ítem ni la alternativa correcta). El usuario quiere ver **el mismo panel**.

**Estado actual (🟡):** Ya existe un **shell común** (`components/question-detail/question-detail-sheet.tsx` + `question-nodes.tsx`), y el banco y el detalle de instrumento **ya usan el mismo `ItemDetailPanel`** (`ItemsTable.tsx:153`, `ItemBankExplorer.tsx:101`, `SpecTableReview.tsx:139`). El panel de **resultados** (`question-detail-panel.tsx`) **comparte el shell pero tiene cuerpo distinto**: enunciado + distribución + distractores + métricas, **sin** marcar la alternativa correcta ni mostrar el contenido del ítem como el de instrumento. Los datos existen en ambos payloads (`ItemModel` vs `QuestionAnalysisResponse`).

**Alcance:** UI (composición). Convergir los cuerpos: que el panel de resultados muestre también el **contenido del ítem** (enunciado + alternativas con la correcta + nodos) **además** de su distribución/métricas — o extraer un cuerpo común reutilizable.

**Resolución (a grandes rasgos):** Componer un cuerpo de panel común de modo que, estés donde estés (banco, instrumento o resultados), el panel de pregunta muestre lo mismo (contenido del ítem) y sume lo específico de cada contexto (distribución/métricas en resultados). **Interpretación:** el feedback apunta al panel de *resultados* (el de banco↔instrumento ya está unificado); confirmar con el usuario si se refería a ese (ver §7).

**Dependencias:** Habilita a T2-17 y comparte componente con T2-05. Relacionado con TKT-07 (v1, agrandar el panel).
**Esfuerzo:** M

---

# OLA 4 — Features nuevas de peso

> Construcciones nuevas (schema, backend y UI). Varias son de tier de monetización (F2). Se abordan al final por tamaño y porque algunas se apoyan en decisiones de producto todavía abiertas.

---

### T2-19 — Crear material IA: canvas + lenguaje natural + rename

> ⏸️ **DIFERIDO a fase futura (2026-07-26).** Por decisión del usuario, la generación de contenido con IA para crear material se retoma más adelante (capacidad F2). **No se construye en esta iteración**; "Material Remedial" queda tal cual (sigue en el sidebar, sin rename ni canvas). El detalle de abajo se conserva para cuando se retome; el nombre elegido al retomar es **"Crear material"**.

**Feedback original:** *"Poder generar material con IA seleccionando preguntas, ejes, asignaturas, etc. Tener una especie de canvas para crear material con IA. Agregar lenguaje natural para definir el objetivo, y que ese prompt se arme dinámicamente en base a opciones seleccionables por el usuario. Cambiar el nombre a algo más amplio que 'material remedial' (crear cualquier material)."*

**Problema / crítica:** La generación de material hoy es **estrecha**: siempre parte de **una brecha** diagnosticada (un `nodeId`), sin composición libre ni objetivo en lenguaje natural, y bajo el nombre "Material Remedial" (que limita conceptualmente a lo remedial). El usuario quiere un **canvas** para crear **cualquier** material, combinando insumos y expresando el objetivo en sus palabras.

**Estado actual (⬜):** La generación es 100% **dirigida por brecha**: se dispara desde `analisis-ia/components/skill-gaps.tsx:16-32` (botones por brecha); la propia página `/material-remedial` **no genera** (es un banco, `material-remedial/page.tsx:150-157`). El DTO `generateRemedialSchema` (`remedial.schema.ts:393-403`) **exige `nodeId`** y no acepta objetivo NL ni una lista de ítems/ejes seleccionados. Los prompts son **plantillas fijas** ancladas al OA (`remedial/prompts/*`). El enum `remedial_material_type` = `guide | practice_set | group_plan` (`enums.ts:231-235`). El nombre "Material Remedial" está en `nav-items.ts:144`, `routes.ts:89`, `page.tsx:72`, `generate-panel.tsx:224`. La propuesta previa `docs/propuesta-motor-remedial-generativo.md` **sigue siendo `nodeId`-driven** y **no** contempla canvas ni NL — el feedback va más allá.

**Decisión (§1):** **Estudio de material global + acceso desde la evaluación.** Reemplaza el ítem "Material Remedial" del sidebar (ver T2-09).

**Alcance:** **UI** (el canvas/composer: selección combinable de preguntas/ítems, ejes, asignaturas, habilidades, evaluación; input de objetivo en lenguaje natural; rename en nav/routes/títulos/labels) + **Backend** (nuevo DTO que acepte objetivo NL + referencias seleccionadas — no solo `nodeId` — y arme el prompt dinámicamente) + **Prompts** (ensamblado dinámico desde las opciones + el NL, en vez de plantilla fija) + **BDD** (extender el enum/unión de tipo para "material genérico").

**Resolución (a grandes rasgos):** Construir un "Estudio de material" (nombre tentativo) como canvas cross-evaluación: el usuario compone insumos y describe el objetivo en lenguaje natural, y el sistema **ensambla el prompt dinámicamente** para generar el material (respetando "la IA propone, el humano aprueba", §8.3 CLAUDE.md). Con su propia entrada en el sidebar y también accesible precargado desde una evaluación. **Nota de fase:** la generación de contenido IA es F2 (§8.1 CLAUDE.md); este ticket **adelanta** esa capacidad por prioridad del usuario.

**Dependencias:** Reemplaza el ítem de sidebar de T2-09. Reutiliza el motor y prompts remediales existentes como base.
**Esfuerzo:** L

---

### T2-20 — Vista 360 del estudiante
**Feedback original:** *"Agregar panorama pedagógico de un estudiante. Tener una vista 360 de un estudiante con sus logros por evaluación, por habilidad, eje, etc."*

**Problema / crítica:** No existe una vista consolidada de **un alumno a través del tiempo y de las evaluaciones**. Hoy solo se puede ver a un alumno **dentro de una evaluación**.

**Estado actual (⬜):** El único informe individual es **por-evaluación** (`evaluaciones/[assessmentId]/informe-alumno/[studentId]`, `OfficialStudentReportResponse`). La `Progresión` (`resultados/progresion`) tiene scope `student` pero **exige pegar el `studentId` a mano** (`progresion/page.tsx:69,84`) y solo grafica el logro global en el tiempo. **No hay endpoint** que agregue a un alumno **a través de varias evaluaciones**; los datos crudos sí existen (`assessment_results` por alumno×evaluación, `skill_results` por alumno×nodo, `responses`).

**Alcance:** **Backend** (endpoint nuevo tipo `/students/:id/panorama` que consolide al alumno por evaluación + por habilidad/eje/nivel a lo largo del período, respetando RLS y `teacher_assignments`) + **UI** (ruta/página de perfil 360 + **picker de alumno**).

**Resolución (a grandes rasgos):** Construir el perfil 360 del estudiante sobre los datos ya calculados: un endpoint agregador + una página que muestre su trayectoria por evaluación, habilidad, eje y nivel, con un selector de alumno usable (no pegar UUID). Es construcción nueva pero sin datos nuevos.

**Dependencias:** Reutiliza los agregados existentes. Se beneficia del selector de alumno que también sería útil en Progresión.
**Esfuerzo:** L

---

### T2-21 — Etiqueta de dificultad por ítem (+ etiquetado IA a futuro)
**Feedback original:** *"Agregar etiqueta de dificultad por ítem. A futuro etiquetar con IA la dificultad de preguntas en base al currículum. Sacar ítems de curriculumnacional.cl/evaluacion/arma-tu-evaluacion que ya están clasificados y usarlos como base para darle a la IA para que compare y etiquete."*

**Problema / crítica:** No hay una **etiqueta de dificultad** almacenada por ítem (solo el índice `p` calculado post-hoc desde respuestas). Se quiere una etiqueta estable, y a futuro que la IA la infiera con base en ítems ya clasificados del currículum nacional.

**Estado actual (⬜):** La tabla `items` **no tiene columna de dificultad** (`items.ts:28-60`); `irtParams` JSONB `{a,b,c}` (donde `b` sería la dificultad IRT) está vacío por defecto y no se usa como etiqueta. **No hay enum de dificultad** ni tipo de nodo "difficulty". El etiquetado IA (`ai-tagging.service.ts`, `banco-items/[id]/etiquetar/AiTaggingWizard.tsx`) **solo sugiere nodos de taxonomía** existentes. No hay pipeline de ingesta desde curriculumnacional.cl.

**Alcance:** **BDD** (agregar dificultad al ítem: columna con enum `item_difficulty`, o vía `irtParams.b`/`scoringConfig`, o como tipo de nodo + tag — requiere migración) + **Backend** (exponer/editar `difficulty` en el DTO/service; extender AI tagging con un prompt de dificultad, patrón "IA propone / humano aprueba") + **UI** (mostrar/editar/filtrar por dificultad) + **Ingesta externa** (pipeline nuevo curriculumnacional.cl como base de ítems ya clasificados para la IA).

**Resolución (a grandes rasgos):** **Sentar ahora la capa de datos** (columna/etiqueta de dificultad editable a mano) — es lo que desbloquea mostrar y filtrar por dificultad. El **etiquetado IA de dificultad y la ingesta curriculumnacional** son **F2+** (la IA de análisis/generación está fuera de F1, §8.1 CLAUDE.md); se dejan documentados como extensión, no se construyen ahora.

**Dependencias:** El filtro por dificultad se apoya en T2-13 (multi-filtros del banco). El etiquetado IA se apoya en el motor de `ai-tagging` existente.
**Esfuerzo:** M/L (columna ahora; IA + ingesta diferidas a F2)

---

### T2-22 — Listas/colecciones de ítems para armar evaluaciones
**Feedback original:** *"Crear listas de preguntas y poder guardar ítems en listas para poder crear evaluaciones."*

**Problema / crítica:** No hay forma de **seleccionar ítems del banco y guardarlos en una lista** para después armar una evaluación. El banco solo permite explorar y ver detalle.

**Estado actual (⬜):** **No existe** concepto de lista/colección/carrito de ítems, ni tabla en BDD (sin `collection`/`list`/`item_set`/`basket`). Lo más cercano: un `instrument` **es** una lista de `items` (+ `instrument_sections`), y `banco-items/nuevo` crea instrument + sections (sin ítems); pero no hay "crear evaluación a partir de ítems seleccionados" (`assessments` = aplicar un instrumento a un curso, no un builder de ítems).

**Alcance:** **BDD** (tablas nuevas, p. ej. `item_collections` + `item_collection_items`, con `org_id`, `deleted_at`, timestamps, y RLS) + **Backend** (módulo CRUD de colecciones + agregar/quitar ítems + opcional materializar colección → instrumento/assessment) + **UI** (selección múltiple en el banco, "guardar en lista", vista de listas, flujo "crear evaluación desde lista").

**Resolución (a grandes rasgos):** Crear el dominio de **colecciones de ítems** (guardables por org, con soft-delete y multi-tenancy), la selección múltiple en el banco, y el puente "lista → evaluación" apoyándose en el modelo polimórfico de instrumentos existente (una colección se puede materializar como instrumento). Feature nueva de punta a punta.

**Dependencias:** Se apoya en el banco de ítems (T2-13) y en el modelo `instruments`/`assessments` existente.
**Esfuerzo:** L

---

# OLA 5 — Limpieza

---

### T2-23 — Eliminar los estados de evaluaciones
**Feedback original:** *"Eliminar los estados de evaluaciones, no se usarán en esta etapa."*

**Problema / crítica:** El `status` de las evaluaciones no aporta en esta etapa y ensucia el modelo.

**Estado actual (🟡 — vestigial):** Existe el enum `assessment_status` (`enums.ts:142-148`: `scheduled|in_progress|processing|completed|cancelled`) y la columna `assessments.status` (`assessments.ts:26`), con espejo en tipos (`packages/types/enums.ts:102-109`). Pero: **solo se escribe a `'completed'`** en los pipelines de importación (no hay módulo `assessments` ni workflow de transiciones — `official-report-import.service.ts:587`, `answer-sheets.service.ts:411`, seeds); se lee/expone en `dashboards.service.ts:1528,1595` → `DashboardAssessmentSummary.status`; y **no se muestra en NINGUNA parte de la UI** (ningún badge ni filtro por estado). Es efectivamente **código muerto en la vista**.

**Alcance:** **BDD** (quitar el enum + la columna vía migración) + **Backend** (quitar `status` del select/map en `dashboards.service`, de los 2 inserts de importación y de los seeds) + **Tipos** (quitar `ASSESSMENT_STATUS`/`AssessmentStatus` y el campo `status` de `DashboardAssessmentSummary`). **UI:** no hay nada visible que eliminar. Impacto bajo.

**Resolución (a grandes rasgos):** Eliminar el estado de evaluaciones de la capa de datos y de los tipos, dado que no se usa en la UI. **Duda abierta:** el feedback dice "eliminar los estados", pero hoy el estado **no se pinta** — conviene confirmar dónde lo vio el usuario; podría referirse a otro "estado" que sí se muestra (p. ej. el **estado de un job de importación** en `importar/resultados/jobs`, que es otro concepto y **no** se debe eliminar). Ver §7.

**Dependencias:** Ninguna. Es una migración destructiva — revisar antes de aplicar (§5.5 CLAUDE.md).
**Esfuerzo:** S/M

---

## 5. Diferidos y fuera de alcance

- **Benchmark integrado al tablero maestro y como comparativa transversal** (parte de #29): **bloqueado** hasta tener un pool real multi-colegio (hereda TKT-20 de v1). Solo la comparativa **contra el colegio/nivel** es viable ahora.
- **Etiquetado IA de dificultad + ingesta curriculumnacional.cl** (#18): **F2+**. Ahora solo se sienta la columna de datos.
- **Generación de contenido IA / "Crear material" (T2-19, #30): DIFERIDO a una fase futura** por decisión del usuario (2026-07-26). Capacidad **F2** (tier de monetización). Se retoma más adelante; por ahora "Material Remedial" queda como está (sigue en el sidebar, sin rename ni canvas). El resto del plan avanza sin depender de esto.

---

## 6. Orden de ejecución sugerido

1. **Ola 1** (quick wins) — desbloquea terminología y quita datos no confiables (T2-04) antes de construir encima.
2. **Ola 2** (navegación) — reubica accesos y cierra el "callejón sin salida" de la spec-table.
3. **Ola 3** — primero **T2-12** (multi-select) porque habilita T2-13/T2-14; luego **T2-14** (jerarquía) que habilita **T2-15** (Panorama).
4. **Ola 4** — features nuevas: **T2-21** (dificultad, migración `0015`) → **T2-22** (colecciones, migración `0016`) → **T2-20** (vista 360, sin migración). *(T2-19 "Crear material" DIFERIDO a fase futura — ver §5.)*
5. **Ola 5** — limpieza del `status` (tras confirmar la duda de §7).

Cada ticket: `pnpm typecheck` + `pnpm lint` verdes y, donde aplique, tests (§10.2 CLAUDE.md).

---

## 7. Dudas abiertas para el usuario

1. **"Sección administrativa" (T2-08):** ya existe un grupo "Administración" en el sidebar. ¿No lo notaste, quieres mover más ítems ahí, o que "Mis cursos" viva ahí? ¿Confirmas degradar "Mis cursos" pese a ser la puerta de entrada del profesor?
2. **Hogar de "Comparar instrumentos" (T2-09):** al comparar 2 evaluaciones, no cabe como pestaña de una sola. ¿Prefieres una acción "Comparar con otra evaluación" desde el hub (que fija la actual como base), o un acceso cross-evaluación dentro de "Evaluaciones"?
3. **"Eje temático" en el resumen de la spec-table (T2-11c):** ¿basta contar preguntas por **habilidad/OA/tipo de texto** (rápido, ya derivable), o necesitas el **eje curricular estricto** (el padre del OA, que requiere exponer el ancestro)?
4. **Panel de pregunta a unificar (T2-18):** confirmo que te refieres al panel de **resultados** (que hoy no muestra el contenido del ítem), ¿cierto? El de banco↔instrumento ya está unificado.
5. **Registro de idioma (T2-03):** ¿"español latinoamericano" neutro, o mantener "español de Chile" (afecta los modismos/ejemplos que genera la IA)?
6. **Estados de evaluación (T2-23):** ¿dónde viste el "estado"? Hoy no se pinta en la UI; quiero descartar que sea el estado de un *job de importación* (que es otra cosa).
