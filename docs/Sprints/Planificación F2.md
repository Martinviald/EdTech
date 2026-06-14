# Planificación F2 — Sprints detallados

> **Fase 2 — "Monetización Inicial": Análisis IA, IA Remedial (RAG) y Benchmarking Institucional**
> Período objetivo: S2 2026 · 6 sprints × 2 semanas = 12 semanas
> Equipo: 2 desarrolladores full-stack · Metodología sprint-parallel (worktrees + agentes)
>
> **Principio rector:** la IA **propone**, el humano **aprueba** (CLAUDE.md §8.3). La IA
> nunca calcula métricas — razona sobre ellas. Toda extensión respeta la taxonomía
> universal (nada hardcodeado a "DIA"/"Lenguaje"), el multi-tenant con RLS y el modelo
> polimórfico de ítems. Lo que F2 construye habilita SIMCE/PAES/Cambridge en F3-F5 sin
> migración de schema.

---

## 0. Mapa de épicas de F2

F2 monetiza la base instalada de F1 (ingesta DIA + dashboards) activando el upsell del PLG.
Tres épicas de producto + una de infraestructura:

| Épica | Nombre | Historias | Origen |
|---|---|---|---|
| **E20** | Análisis IA de Resultados (informe de evaluación + análisis por-pregunta) | H20.x | Absorbe y expande el borrador `Planificación — Módulo Análisis IA.md` |
| **E9** | IA Remedial / Generación de Contenido (RAG) | H9.x | Roadmap `lineamientos proyecto.md` §5 (F2) |
| **E7** | Benchmarking Institucional | H7.x | Roadmap `lineamientos proyecto.md` §5 (F2) |
| **E19** | Infraestructura F2 (jobs async in-process, recuperación curricular estructurada, motor IA, participación) | H19.20+ | Continuación de la épica de infra de F1 |

> **Nota de renumeración:** el borrador "Módulo Análisis IA" se autodenominó *provisionalmente*
> `H7.1–H7.10`. Eso colisiona con **E7 = Benchmarking** del roadmap. En esta planificación, el
> análisis IA pasa a **E20** y benchmarking conserva **E7**. Mapeo del borrador → nuevo:
> `H7.1→H19.23`, `H7.2→H20.1`, `H7.3→H20.2`, `H7.4→H20.3`, `H7.5→H20.4`, `H7.6→H20.9`,
> `H7.7→H20.5`, `H7.8→H20.6`, `H7.9→H20.10`, `H7.10→H20.7`.

---

## 1. Tabla resumen de sprints

| Sprint | Semanas | Objetivo | Historias | Progreso |
| --- | --- | --- | --- | --- |
| **S0** | 1-2 | Cimientos F2: jobs async in-process (abstracción), recuperación curricular estructurada, motor IA base, modelo de participación en benchmarking | H19.20, H19.21, H19.23, H19.24 | 4/4 ✅ |
| **S1** | 3-4 | Informe IA de evaluación (narrativa adaptativa + Top/Bottom 5 + brechas + recomendaciones) | H20.1, H20.2, H20.3, H20.4, H20.5, H20.6, H20.7 | 7/7 ✅ |
| **S2** | 5-6 | Análisis IA por-pregunta (multimodal, con pasaje) + calidad de ítem/instrumento + export del informe | H20.8, H20.9, H20.10, H20.11 | 4/4 ✅ |
| **S3** | 7-8 | IA Remedial (RAG): guía de reenseñanza + ítems de práctica + plan remedial por grupo + flujo de aprobación | H9.1, H9.2, H9.3, H9.4, H9.5, H9.6 | 6/6 ✅ |
| **S4** | 9-10 | Benchmarking Institucional: motor mismo-instrumento, cohortes, doble modo (global anónimo / red identificada), dashboard | H7.1, H7.2, H7.3, H7.4, H7.5, H7.6 | 6/6 ✅ |
| **S5** | 11-12 | Integración, gating de tier pago, validación pedagógica, costo/latencia, QA E2E, hardening | H18.1, H18.2, H19.25, H20.12 | 0/4 |

**Flujo demo de F2 (end-to-end):** un profesor abre una evaluación DIA → genera el **Análisis IA**
→ lee el informe adaptado a su rol (Top 5 a replicar, Bottom 5 a remediar, brechas con causa raíz)
→ hace drill-down en una pregunta y la IA explica el porqué leyendo enunciado, alternativas, distractores
y el **pasaje asociado** → desde una brecha dispara **IA Remedial** que genera guía de reenseñanza +
ítems de práctica (en borrador, los aprueba) + plan por grupo → el director abre **Benchmarking** y ve
cómo está su colegio vs la cohorte de perfil similar (anónimo) y vs los colegios de su red (identificado).

---

## 2. Decisiones de alcance (cerradas)

| Decisión | Valor elegido | Implicancia de diseño |
|---|---|---|
| **Análisis por-pregunta** | Ingesta completa **multimodal** | La IA recibe enunciado, alternativas, clave, distribución de respuestas/distractor dominante, **el pasaje/material asociado completo** (`instrument_sections`) e **imágenes del ítem** (Gemini multimodal). Razona el porqué del resultado en su contexto real. |
| **Benchmarking — participación** | **Opt-out global anónimo + red identificada** | Todos los colegios entran al pool global por defecto (con opción de exclusión). En el pool global la comparación es **anonimizada con k-anonimato** (celdas con < k colegios/alumnos se ocultan). Dentro de una **red/sostenedor**, la comparación es **identificada**: el colegio sabe exactamente con quién se compara. |
| **Benchmarking — comparabilidad** | **Mismo instrumento estándar primero** | F2 compara solo evaluaciones del mismo instrumento oficial (misma forma/nivel). Apples-to-apples, defendible, sin ruido. La comparación por-habilidad cross-instrumento (vía `taxonomy_mappings`) queda como punto de extensión documentado para F3. |
| **IA Remedial — artefactos** | Guía de reenseñanza (profesor) + ítems de práctica + plan remedial por grupo | **No** se genera material dirigido al alumno en F2. Los ítems generados entran al banco con `source='ai_generated'` + `status='draft'`; un humano aprueba antes de publicar. |
| **Motor IA** | Gemini 2.0 Flash (multimodal + structured output) | Generación **asíncrona** vía **jobs en DB + worker in-process** (patrón `import_jobs` de F1), NO BullMQ todavía (ver decisión abajo). Costo trazado en `cost_usd`, caché por `input_hash`. Opción híbrida con Claude para diagnóstico profundo queda documentada. |
| **Monetización** | Tier pago | Análisis IA, IA Remedial y Benchmarking se gobiernan por `org.config.allowedFeatures`. F1 (ingesta + dashboards) sigue siendo el gancho gratuito. |
| **Procesamiento async — piloto** | **Diferir BullMQ+Redis; in-process detrás de una abstracción** | Para iterar rápido con pocos colegios piloto, F2 usa el patrón ya probado de F1: job persistido en `ai_analyses`/`import_jobs` con `status` + procesamiento in-process + polling del frontend. Se encapsula el disparo en un `JobDispatcher` (puerto) para que migrar a BullMQ luego sea cambiar la implementación, no los callers. El modelo de datos (status + `input_hash` + polling) es **idéntico** en ambos mundos → migración barata. Mitigaciones para in-process: **límite de concurrencia** (semáforo, p.ej. `p-limit`) + **reaper de jobs colgados** (timeout en `processing`). **Gatillos de migración a BullMQ:** múltiples instancias de API, carga en ráfaga real, o jobs programados/recurrentes a escala. |
| **Recuperación RAG — piloto** | **Recuperación curricular estructurada; diferir `pgvector`/embeddings** | La brecha ya viene como un `node_id` de `taxonomy_nodes` → el contexto curricular se recupera por **traversal determinista del árbol** (nodo + ancestros + descriptores + hermanos + ítems etiquetados vía `item_taxonomy_tags`), no por similitud vectorial. Más preciso y auditable, sin infra ni costo de embeddings ni decisión de modelo. Se encapsula en un puerto **`CurriculumRetriever`** → agregar `pgvector` luego es **aditivo** (lo estructurado queda como backbone). Cumple la **intención** de la §4.3 del lineamientos (anti-alucinación inyectando el OA real), no su letra. **Gatillos para `pgvector`:** corpus pedagógico no estructurado (recursos/textos fuera de la taxonomía), matching semántico cross-currículo más allá de `taxonomy_mappings`, o evidencia de la validación pedagógica (H18.2) de que el contexto estructurado no alcanza. |
| **Infra adelantada** | Ninguna pieza pesada nueva en F2 | Tanto la cola distribuida (BullMQ+Redis) como `pgvector`/embeddings se **difieren** a cuando un gatillo de escala/necesidad lo justifique. F2 corre sobre PostgreSQL + procesamiento in-process. El schema `import_jobs`/`ai_grading_jobs` ya está preparado para la transición a cola. |

> **Privacidad (guardrail crítico — Ley 19.628).** Al LLM se envían **métricas agregadas y
> contenido de ítems, NUNCA PII de alumnos** (sin nombres ni RUT). La agrupación de alumnos
> para remediales es **determinista** en backend; la IA solo etiqueta el grupo en abstracto.
> El `org_id` del token acota todo. El snapshot enviado se persiste en `ai_analyses.input` para
> auditoría. El benchmarking opt-out global exige **decisión legal explícita** (ver §9) y aplica
> k-anonimato como salvaguarda de reidentificación.

---

## 3. Metodología de análisis de resultados (E20 — el "cómo razona")

El usuario pidió evaluar metodologías de análisis y validar (o mejorar) la estrategia de
**Top/Bottom 5 preguntas**. Conclusión: la estrategia Top/Bottom 5 es **buena y se conserva**,
pero como *entrada concreta* dentro de un marco de 3 capas que maximiza la identificación de
brechas y la propuesta de acción:

| Capa | Método | Qué decide | Para quién |
|---|---|---|---|
| **1. Entrada concreta** | **Top/Bottom 5 ítems** (alto vs bajo desempeño) | "¿Qué replico de lo que funcionó y qué remedio de lo que falló?" | Profesor |
| **2. Priorización estratégica** | Brecha por habilidad ponderada por **impacto × persistencia × masa** (nº alumnos afectados × cuán crítico es el OA × si la brecha viene de antes) | "¿Dónde pongo los recursos primero?" | Director / UTP |
| **3. Causa raíz (transversal)** | Clasificación `no_enseñado` / `misconcepción` / `ítem_malo` / `práctica_insuficiente` usando discriminación _D_ + distractor dominante + cobertura | "¿Es problema de enseñanza o de instrumento? ¿Qué acción corresponde?" | Ambos |

**Por qué este marco y no solo Top/Bottom 5:** un ítem no es una habilidad (5 ítems pueden tocar
el mismo OA), y "pregunta mal respondida" puede ser ítem defectuoso, no brecha de aprendizaje. La
capa 2 evita optimizar lo anecdótico; la capa 3 evita reenseñar lo que en realidad era un ítem malo.
El Top/Bottom 5 (capa 1) sigue siendo la **feature insignia** porque es lo que el profesor ya hace
a mano — lo automatizamos y lo conectamos a la psicometría determinista.

**Métricas deterministas que alimentan a la IA** (ninguna la calcula el LLM):

| Métrica | Aporta | Fuente |
|---|---|---|
| Dificultad _p_, discriminación _D_ (27% Kelley) | Calidad y nivel del ítem | Informe de Evaluación (H6.13, F1) |
| Distribución por alternativa / distractor dominante | Misconcepción común | `responses` agregadas |
| **KR-20 / α de Cronbach** | Confiabilidad del instrumento | Matriz correcto/incorrecto del instrumento |
| **Correlación punto-biserial** | Discriminación fina por ítem | Corr. ítem-correcto vs puntaje total |
| **Cobertura del blueprint** | ¿Mide bien cada habilidad? (ítems por nodo vs esperado) | `item_taxonomy_tags` por nodo |
| **Persistencia de brecha** | Señal de urgencia (¿viene de antes?) | Histórico `analytics/progression` |

---

## 4. Pipeline RAG de IA Remedial (E9 — el "cómo se genera")

Diseño eficiente, anti-alucinación y reaprovechable. **El "retrieval" del RAG es recuperación
curricular estructurada** sobre `taxonomy_nodes` (no búsqueda vectorial — ver decisión §2):

```
  EN GENERACIÓN (async, gatillado desde una brecha del Análisis IA)
  1. Brecha (node_id) ──▶ CurriculumRetriever.getContext(nodeId):
                          • el nodo (OA): code, name, description
                          • ancestros (eje/dominio) vía parent_id
                          • descriptores/hijos + hermanos (OAs del mismo eje)
                          • ítems ya etiquetados al nodo (item_taxonomy_tags) → few-shot
  2. Ensamblar contexto: OA objetivo + nivel + descriptores + ítems donde falló
  3. Prompt a Gemini (structured output / JSON Schema) con el contexto curricular
     inyectado  ──▶  artefacto tipado (validado con Zod)
  4. Persistir en BORRADOR  ──▶  humano revisa / edita / aprueba  ──▶  publica
```

> El puerto `CurriculumRetriever` aísla la recuperación: el día que un gatillo justifique
> `pgvector`, se agrega una implementación vectorial **aditiva** (la traversal estructurada queda
> como backbone) sin tocar el ensamblado del prompt ni la generación.

**Eficiencia y costo:**
- **Caché por `(node_id, tipo_material, nivel)`** con `input_hash`: el material remedial de un OA
  es en gran parte reutilizable entre evaluaciones y colegios.
- **Material genérico por OA = plataforma-global** (no per-tenant) cuando no depende de datos del
  colegio → se genera una vez y se reusa, abaratando el costo marginal.
- Async vía el `JobDispatcher` in-process (no BullMQ en F2); trazado de `cost_usd` y `prompt_version` en cada job.
- Los **ítems de práctica generados** se validan con el mismo Zod del banco polimórfico y entran
  como `source='ai_generated'` + `status='draft'` — nunca se publican sin aprobación humana.

---

## 5. Cómo se muestra la información (UI)

| Superficie | Ruta | Contenido |
|---|---|---|
| **Análisis IA** | `/analisis-ia` (+ enlace desde el Informe de Evaluación) | Narrativa adaptativa por rol · Top/Bottom 5 (tarjetas) · brechas con causa raíz · recomendaciones priorizadas · drill-down por pregunta (modal con análisis multimodal y el pasaje) · confianza/caveats/disclaimer · export PDF/Excel |
| **Material Remedial** | `/material-remedial` (+ acción desde una brecha) | Disparar generación · estado async · revisar/editar/aprobar/descartar · banco de material aprobado · ítems en borrador hacia el banco |
| **Benchmarking** | `/benchmarking` | Selector instrumento/nivel/asignatura · "tu colegio vs cohorte" (percentil + distribución) · heatmap por habilidad (sobre/bajo cohorte) · distribución por banda de desempeño comparada · conmutador **modo global (anónimo)** ↔ **modo red (identificado)** · filtros de cohorte (dependencia/región/comuna) · disclaimers de anonimato y de tamaño muestral |

**Convenciones de diseño:** Server Components por defecto, `'use client'` solo donde haya
interactividad; gráficos con tokens de `tailwind.config.ts` (sin colores hardcodeados); mobile-first;
componentes de dominio en `apps/web/src/components/`, genéricos en `packages/ui/`.

---

## Sprint 0 — Cimientos F2 _(Semanas 1-2)_

**Objetivo:** dejar lista la infraestructura que sostiene las tres épicas: procesamiento async
in-process detrás de una abstracción, recuperación curricular estructurada, motor IA base y el modelo
de participación en benchmarking.

**Por qué va primero:** las tres épicas de producto dependen de estos cimientos. Sin el despachador de
jobs, la generación IA bloquea el request; sin el `CurriculumRetriever`, el RAG no tiene contexto; sin
el motor IA base, no hay análisis ni generación; sin el modelo de participación, el benchmarking no
puede arrancar legalmente. (Las lecturas single-tenant se sirven con query directa indexada tras el
Service —patrón de F1—; el read-model materializado se difiere, ver §2.)

| ID | Historia | Complejidad | Estado | Notas |
| --- | --- | --- | --- | --- |
| **H19.20** | `JobDispatcher` (abstracción) + procesamiento async **in-process** sobre jobs persistidos en DB (`status` + polling), reusando el patrón `import_jobs` de F1. Incluye límite de concurrencia (semáforo) + reaper de jobs colgados | ★★ | — | **Decisión: diferir BullMQ+Redis** hasta tener gatillo de escala (multi-instancia / ráfaga / recurrentes). El puerto `JobDispatcher` aísla a los callers → migrar a BullMQ luego = cambiar la implementación, no el módulo. El schema `import_jobs`/`ai_grading_jobs` ya está preparado (CLAUDE.md §12). |
| **H19.21** | `CurriculumRetriever` (puerto): recuperación curricular **estructurada** sobre `taxonomy_nodes` — nodo + ancestros (`parent_id`) + descriptores/hijos + hermanos + ítems etiquetados (`item_taxonomy_tags`). Base del RAG (E9) | ★★ | — | **Decisión: diferir `pgvector`/embeddings** (ver §2). Más preciso/auditable, sin infra ni costo de embeddings. El puerto permite agregar una impl vectorial aditiva luego. No hardcodear "DIA": opera por taxonomía. |
| **H19.23** | Motor IA base: tabla `ai_analyses` (job async + caché por `input_hash`), provider Gemini Flash endurecido (`prompt_version`, parseo Zod estricto, `cost_usd`, retry/backoff), guardrails de privacidad | ★★★★ | — | Reusa el diseño del borrador (ex-H7.1). Sirve a E20 y E9. Salida siempre en `output` (nunca sobrescribe datos deterministas). |
| **H19.24** | Participación en benchmarking: tabla `org_benchmark_settings` (**solo** `opt_out` del pool global anónimo + consentimiento); constantes en `access-policies.ts` | ★★ | — | La **red/sostenedor se deriva de `organizations.parent_id`** (foundation → schools), NO se re-almacena (evita duplicar la fuente de verdad). Dentro de la red la comparación es siempre identificada (toggle de visibilidad por-colegio → diferido). Círculos de benchmarking voluntarios cross-sostenedor (relación M:N) → diferido a F3 si se requiere. |

**División de trabajo sugerida:**
- Dev 1: H19.21 + H19.23 (recuperación curricular y motor IA base)
- Dev 2: H19.20 + H19.24 (despachador de jobs y participación)

**Criterio de salida:** el `JobDispatcher` procesa un job in-process end-to-end (con cap de
concurrencia y reaper de colgados); el `CurriculumRetriever` devuelve el contexto curricular completo
de un `node_id` (OA + ancestros + descriptores + ítems etiquetados); la tabla `ai_analyses` acepta un
job `pending→completed` con salida tipada; y un colegio puede marcar opt-out o pertenecer a una red.

---

## Sprint 1 — Informe IA de evaluación _(Semanas 3-4)_

**Objetivo:** entregar el informe IA de una evaluación (tu épica #2): narrativa adaptativa por rol,
estrategia Top/Bottom 5, diagnóstico de brechas con causa raíz y recomendaciones priorizadas.

**Por qué va aquí:** es el corazón del upsell IA y la base sobre la que se gatilla la IA Remedial
(S3). Reusa el Informe de Evaluación determinista (H6.13, F1) y el motor IA de S0.

| ID | Historia | Complejidad | Estado | Notas |
| --- | --- | --- | --- | --- |
| **H20.1** | Snapshot determinista de métricas: ensamblar el input reusando el Informe (H6.13) + KR-20 + punto-biserial + cobertura del blueprint | ★★★ | — | `ai-analysis.snapshot.ts`. Gran reuso de `AssessmentReportService`. Sin PII. |
| **H20.2** | Síntesis narrativa adaptativa (director: gestión/priorización · profesor: accionable de aula) | ★★★ | — | Una generación, dos vistas según `activeRole`. |
| **H20.3** | **Top/Bottom 5 ítems**: tarjetas de práctica (mejores: alto _p_ + alta _D_) + diagnóstico con causa raíz (peores) | ★★★★ | — | Feature insignia (capa 1 de la metodología §3). Distingue "ítem malo" de "no enseñado" con _D_ + distractor. |
| **H20.4** | Diagnóstico de brechas por habilidad con causa raíz (distractor → misconcepción → estrategia) + tamaño de grupo remedial determinista | ★★★★ | — | Capa 3 de §3. El nº de alumnos es determinista; **no** se exponen nombres al LLM. |
| **H20.5** | Recomendaciones priorizadas por audiencia (impacto × factibilidad × persistencia) | ★★★ | — | Capa 2 de §3. Enlaza a `linkedSkillIds` / `linkedItemPositions`. |
| **H20.6** | Sección "Análisis IA" (`/analisis-ia`): generar, estado/polling, render de tarjetas, vista adaptativa por rol, enlace desde el Informe | ★★★★ | — | Si no hay análisis, ofrece "Generar"; durante el proceso muestra feedback. |
| **H20.7** | Confianza + caveats + disclaimer ("sugerencia IA, validar") + regenerar/descartar | ★★ | — | Disclaimer visible siempre. |

**División de trabajo sugerida:**
- Dev 1: H20.1 + H20.3 + H20.4 (backend: snapshot, prompts y parseo de Top/Bottom 5 y brechas)
- Dev 2: H20.2 + H20.5 + H20.6 + H20.7 (narrativa, recomendaciones y la sección/UI adaptativa)

**Criterio de salida:** un usuario genera el Análisis IA de una evaluación DIA real; ve el titular,
la narrativa según su rol, los 5 mejores ítems con prácticas reutilizables, los 5 peores con causa
raíz y plan, las brechas con estrategia de reenseñanza, y las recomendaciones priorizadas; el costo
queda trazado y no se envía PII al LLM.

---

## Sprint 2 — Análisis IA por-pregunta + calidad de instrumento _(Semanas 5-6)_

**Objetivo:** profundizar en tu épica #1: que el profesor/directivo pueda pedir a la IA el análisis
preciso de **una** pregunta —evaluando su contenido, el pasaje/material asociado, las alternativas y
las respuestas— para entender por qué se obtuvo ese resultado. Más calidad de instrumento y export.

**Por qué va aquí:** complementa el informe de S1 con el drill-down más fino que pediste (la pregunta
en su contexto real, multimodal). Cierra la capa de interpretación antes de pasar a la generación (S3).

| ID | Historia | Complejidad | Estado | Notas |
| --- | --- | --- | --- | --- |
| **H20.8** | **Análisis IA por-pregunta (drill-down multimodal)**: la IA ingiere enunciado + alternativas + clave + distribución de respuestas/distractor dominante + **pasaje/material asociado** (`instrument_sections`) + **imágenes del ítem** (Gemini multimodal) → explicación precisa del porqué del resultado | ★★★★★ | ✅ | Tu épica #1. Salida tipada (por qué falló/acertó, misconcepción inferida, calidad del ítem, acción). El pasaje y las imágenes se adjuntan desde `instrument_sections`/attachments. Caché por ítem+cohorte. **Implementado:** `apps/api/src/ai-analysis/item-insight.*` + extensión multimodal `completeMultimodal` en `llm/` (best-effort, fallback a texto). `POST /api/ai-analysis/items/:itemId/generate`. |
| **H20.9** | Calidad de instrumento e ítems: KR-20 + flags (`low_discrimination`, `ambiguous_key`, `strong_distractor`, `too_easy`, `misaligned`) + sugerencia de corrección | ★★★ | ✅ | Distingue brecha de aprendizaje de defecto de instrumento (capa 3, §3). **Implementado (determinista, sin IA):** `apps/api/src/instrument-quality/`. `GET /api/instrument-quality`. Sugerencias por plantilla según flag. |
| **H20.10** | Export del análisis a Excel/PDF | ★★ | ✅ | Reusa el patrón de export de H6.13. **Implementado:** `analisis-ia/components/ai-export-button.tsx` (client-side `xlsx` + `jspdf`). |
| **H20.11** | Informe IA consolidado de la evaluación (documento exportable que reúne narrativa + Top/Bottom 5 + brechas + recomendaciones + por-pregunta destacadas) | ★★★ | ✅ | El "informe" de tu épica #2 como entregable único compartible con el equipo directivo. **Implementado:** `analisis-ia/components/analysis-report.tsx` (consolidado + drill-down + panel de calidad). |

**División de trabajo sugerida:**
- Dev 1: H20.8 + H20.9 (backend multimodal y métricas de calidad)
- Dev 2: H20.10 + H20.11 (export y documento consolidado) + render del drill-down por-pregunta

**Criterio de salida:** desde una pregunta de una evaluación, el usuario abre el análisis IA y obtiene
una explicación que cita el enunciado, el pasaje asociado, el distractor dominante y la imagen si la
hay, con causa probable y acción; el instrumento muestra su KR-20 y los ítems marcados a revisar; y se
puede exportar el informe consolidado.

---

## Sprint 3 — IA Remedial (RAG) _(Semanas 7-8)_

**Objetivo:** cerrar el ciclo de "resultado → acción": desde una brecha diagnosticada, generar
material remedial pedagógicamente válido con RAG (anti-alucinación), con aprobación humana.

**Por qué va aquí:** depende del diagnóstico de brechas (S1/S2) y del `CurriculumRetriever` (S0). Es el
upsell de "Material Remedial generado con IA" del PLG.

| ID | Historia | Complejidad | Estado | Notas |
| --- | --- | --- | --- | --- |
| **H9.1** | Pipeline RAG base: `CurriculumRetriever.getContext(nodeId)` (recuperación estructurada) → ensamblar contexto curricular para el prompt | ★★★ | ✅ | Anti-alucinación (intención de lineamientos §4.3, sin embeddings). Nodo + ancestros + descriptores + hermanos + ítems etiquetados. **Implementado:** `remedial/remedial-context.service.ts`. |
| **H9.2** | Generación de **guía de reenseñanza** para el profesor (estrategia + actividad de aula alineada al OA de la brecha) | ★★★ | ✅ | Material genérico por OA → cacheable (caché por `inputHash`, per-tenant en S3; plataforma-global cross-tenant = optimización futura). **Implementado:** `remedial/generators/guide.generator.ts`. |
| **H9.3** | Generación de **ítems de práctica nuevos** sobre la habilidad débil, validados con Zod, persistidos con `source='ai_generated'` + `status='draft'` | ★★★★ | ✅ | Reusa el banco polimórfico (`validateItemContent`, batch insert + tags `ai`). Humano aprueba antes de publicar (`status='published'`). **Implementado:** `remedial/generators/practice.generator.ts`. |
| **H9.4** | **Plan remedial por grupo de alumnos**: agrupación determinista por brecha compartida (sin PII al LLM) + secuencia remedial sugerida | ★★★★ | ✅ | Agrupación backend-determinista (skill_results bajo umbral); el `studentCount` se sobrescribe desde backend; la IA solo etiqueta el grupo en abstracto. **Implementado:** `remedial/generators/group-plan.generator.ts`. |
| **H9.5** | Workflow "IA propone, humano aprueba": revisar/editar/aprobar/descartar material; trazabilidad (`prompt_version`, modelo, `cost_usd`) | ★★★ | ✅ | Aplica a guía, ítems y plan. **Implementado:** `remedial.service.review()` (`ready`→`approved`/`discarded`; aprobar practice_set publica los ítems). |
| **H9.6** | Sección "Material Remedial" (`/material-remedial`): disparar generación desde una brecha, estado async, revisar y aprobar, banco de material | ★★★ | ✅ | Acción enlazada desde la brecha del Análisis IA. **Implementado:** `apps/web/src/app/(dashboard)/material-remedial/` + enlace en `analisis-ia/skill-gaps.tsx`. |

**División de trabajo sugerida:**
- Dev 1: H9.1 + H9.3 + H9.4 (RAG, generación de ítems y agrupación remedial)
- Dev 2: H9.2 + H9.5 + H9.6 (guía de reenseñanza, workflow de aprobación y UI)

**Criterio de salida:** desde una brecha de habilidad insuficiente, el profesor genera una guía de
reenseñanza, un set de ítems de práctica (en borrador, que aprueba e incorpora al banco) y un plan
remedial para el grupo de alumnos afectados; todo el contexto curricular proviene del
`CurriculumRetriever` estructurado (sin alucinación) y el costo queda trazado.

---

## Sprint 4 — Benchmarking Institucional _(Semanas 9-10)_

**Objetivo:** permitir que un colegio compare su desempeño contra una cohorte de perfil similar
(anónima, opt-out global) y contra los colegios de su red/sostenedor (identificada).

**Por qué va aquí:** requiere su propio read-model cross-tenant (H7.1) y masa de resultados procesados. Es el upsell de
"Benchmarking Institucional" y refuerza el network effect (lineamientos §1.3).

| ID | Historia | Complejidad | Estado | Notas |
| --- | --- | --- | --- | --- |
| **H7.1** | Read-model de benchmarking: agregado **cross-tenant sin RLS** de resultados, con dimensiones (instrumento, nivel, asignatura, dependencia, región, comuna) + refresh | ★★★★★ | ✅ | Cruza el aislamiento por org **por diseño**. **Implementado:** tabla `benchmark_aggregates` (sin RLS, cero PII) + `benchmarking-refresh.service.ts` (itera org-por-org bajo `withOrgContext` → upsert). `POST /benchmarking/refresh`. |
| **H7.2** | Motor de comparación **mismo-instrumento**: percentil/mediana/distribución del colegio vs el pool comparable (misma forma/nivel) | ★★★★ | ✅ | Apples-to-apples. **Implementado:** `benchmarking.service.ts` (percentil/median/p25/p75, % global, por banda y por habilidad con delta). `GET /benchmarking/comparison`. |
| **H7.3** | Cohortes y filtros: "colegios de perfil similar" por `dependence`, `region`, `commune`, tamaño | ★★★ | ✅ | Filtros sobre el read-model (dimensiones desnormalizadas). No hardcodeado. |
| **H7.4** | Doble modo de privacidad: (a) pool global **anónimo opt-out con k-anonimato** (supresión de celdas < k); (b) comparación **intra-red identificada** | ★★★★★ | ✅ | **Implementado:** k-anonimato `k≥3` colegios y `n≥20` alumnos (constantes en `@soe/types`, fuente única); modo red por `organizations.parent_id` (sostenedor `foundation`), identificado, sin supresión. Global excluye opt-out. |
| **H7.5** | Dashboard de benchmarking (`/benchmarking`): tu colegio vs cohorte (percentil + distribución), heatmap por habilidad (sobre/bajo), distribución por banda comparada, conmutador global↔red, disclaimers | ★★★★ | ✅ | Sin rankings 1-N (orden alfabético/cuartiles). **Implementado:** `apps/web/src/app/(dashboard)/benchmarking/`. |
| **H7.6** | Auditoría y consentimiento: log de accesos a datos de benchmarking, gestión de `opt_out` y consentimiento | ★★★ | ✅ | Compliance Ley 19.628. **Implementado:** `benchmark_access_logs` (RLS) — cada consulta auditada dentro de `withOrgContext`; `GET /benchmarking/audit`. Consentimiento/opt-out vía módulo `benchmark-settings` (S0). |

**División de trabajo sugerida:**
- Dev 1: H7.1 + H7.2 + H7.4 (read-model, motor de comparación y modos de privacidad)
- Dev 2: H7.3 + H7.5 + H7.6 (cohortes, dashboard y auditoría)

**Criterio de salida:** un director filtra "DIA Lenguaje 3° básico", ve el percentil de su colegio
dentro de la cohorte de su dependencia/región (anónimo, con celdas suprimidas si la muestra es chica),
identifica en qué habilidades está bajo sus pares, y —si pertenece a una red— ve la comparación
identificada con los otros colegios de su sostenedor; cada acceso queda auditado.

---

## Sprint 5 — Integración, monetización y hardening _(Semanas 11-12)_

**Objetivo:** unir las tres épicas, activar el gating de tier pago, validar la calidad pedagógica con
humanos, medir costo/latencia reales y endurecer para producción.

| ID | Historia | Complejidad | Estado | Notas |
| --- | --- | --- | --- | --- |
| **H18.1** | Gating de tier pago: `org.config.allowedFeatures` gobierna Análisis IA, IA Remedial y Benchmarking; guards en API + UI | ★★★ | — | F1 (ingesta + dashboards) permanece gratuito (gancho PLG). |
| **H18.2** | Validación pedagógica humana: revisión cualitativa de muestras de análisis y material generado; ajuste de prompts (`prompt_version`) y few-shot | ★★★ | — | Mitiga calidad variable de Flash. Define umbral de aceptación. |
| **H19.25** | Observabilidad de costo/latencia IA: panel de `cost_usd`/tokens por org y por tipo, alertas de presupuesto, tuning de caché | ★★ | — | Controla el costo marginal del upsell. |
| **H20.12** | QA E2E + hardening: pruebas del flujo dato→insight→remedial→benchmark con datos seedeados; `typecheck` + `lint` + tests de service en verde | ★★★ | — | Cierre de F2. |

**División de trabajo sugerida:**
- Dev 1: H18.1 + H19.25 (gating y observabilidad)
- Dev 2: H18.2 + H20.12 (validación pedagógica y QA E2E)

**Criterio de salida:** las tres capacidades de F2 están detrás del tier pago, validadas
pedagógicamente, con costo/latencia bajo control y el flujo end-to-end probado en verde.

---

## Dependencias críticas entre sprints

```
S0 (cimientos F2)
 ├── H19.20 jobs in-process ──────────┐
 ├── H19.23 motor IA base ────────────┼──▶ S1 (Informe IA) ──▶ S2 (por-pregunta)
 ├── H19.21 CurriculumRetriever ──────┼──▶ S3 (IA Remedial RAG)
 └── H19.24 participación ────────────┴──▶ S4 (Benchmarking · read-model propio en H7.1)
                                                                 │
                                                                 ▼
S1/S2 (diagnóstico de brechas) ──────────────────────▶ S3 (genera remedial desde la brecha)
S0..S4 ──────────────────────────────────────────────▶ S5 (integración + gating)

Prerrequisito externo: H6.13 Informe de Evaluación (F1, ya entregado) alimenta el snapshot de S1.
```

---

## Decisiones técnicas a resolver antes de arrancar F2

| Decisión | Contexto | Cuándo |
|---|---|---|
| **Legal: opt-out global bajo Ley 19.628** | El benchmarking opt-out global comparte resultados agregados anonimizados entre colegios. Requiere validación legal del consentimiento (¿basta con T&C + opt-out, o se necesita opt-in expreso para el pool global?). El modo red identificado necesita acuerdo del sostenedor. | Antes de S4 |
| **Valor de k (k-anonimato)** | Umbral mínimo de colegios/alumnos por celda comparativa antes de mostrarla. Recomendación inicial: k ≥ 5 colegios y n ≥ 20 alumnos. | Antes de S4 |
| **Profundidad del contexto curricular** | Cuántos niveles de ancestros/hermanos y cuántos ítems etiquetados incluye `CurriculumRetriever` en el prompt (calidad vs tamaño/costo del prompt). No bloquea; se ajusta con la validación pedagógica. | Durante S3 |
| **Claude para diagnóstico profundo** | ¿Híbrido Gemini Flash (volumen) + Claude (diagnóstico por-pregunta de alto valor, H20.8)? Trade-off costo/calidad. | Antes de S2 |
| **Refresh del read-model** | ¿Materializadas con refresh al cerrar evaluación, programado, o incremental? Afecta frescura del benchmarking. | Antes de S4 |
| **Presupuesto de costo IA por org** | Tope de gasto mensual por colegio para acotar el costo del upsell. | Antes de S5 |

---

## Qué NO entra en F2 (y por qué)

- **Benchmarking por-habilidad cross-instrumento (vía `taxonomy_mappings`):** introduce ruido de
  equivalencia; F2 se queda en mismo-instrumento. Punto de extensión documentado → **F3**.
- **Material remedial dirigido al alumno (fichas/portal):** fuera del alcance elegido; el portal
  apoderados/alumno es **F3**.
- **Entidad de seguimiento de acciones (`action_plans`) y cierre de ciclo:** F2 entrega insights y
  material (solo lectura/borrador); el tracking de la acción ejecutada queda como evolución → **F3**.
- **Predicción ML (SIMCE/PAES):** requiere datos históricos suficientes → **F3**.
- **Read-model materializado general (CQRS) para lecturas single-tenant:** F2 sirve dashboards y
  Análisis IA con **query directa indexada tras el Service** (patrón de F1); solo el benchmarking
  cross-tenant pre-computa (tabla resumen liviana, H7.1). Vistas materializadas single-tenant y el
  escalamiento a ClickHouse/DuckDB se evalúan cuando el volumen lo exija → **F3+**.
- **Cola distribuida BullMQ+Redis:** F2 procesa async in-process (patrón `import_jobs`) detrás del
  `JobDispatcher`; se migra cuando haya gatillo de escala (multi-instancia / ráfaga / recurrentes) → **F3+**.
- **`pgvector` + embeddings del currículo:** el RAG de F2 recupera contexto curricular de forma
  estructurada (`CurriculumRetriever` sobre `taxonomy_nodes`); la búsqueda vectorial se agrega de forma
  aditiva cuando aparezca un corpus no estructurado o la evidencia pedagógica lo pida → **F3+**.
- **AI Grading total (corrección de desarrollo) y LMS:** → **F4**.

---

_Documento generado: 2026-06-12 · Actualizar al final de cada sprint con lo completado, lo diferido y las decisiones tomadas._
