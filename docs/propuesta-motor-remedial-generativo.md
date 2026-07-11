# Propuesta de Diseño — Motor de Material Remedial Generativo (evolución de E9)

> **Estado:** Propuesta de diseño (no aprobada). Nivel: flujo, módulos, servicios, obtención de referencia, generación, métricas. **No** especifica código.
> **Autor:** Análisis asistido por IA sobre el código real de `apps/api/src/remedial/`, `curriculum-retriever/`, `ai-analysis/`, `llm/`, la BDD y la planificación F2.
> **Fecha:** 2026-07-03.

---

## 0. Resumen ejecutivo

**Reencuadre clave:** el motor que "genera material él mismo" **ya existe y está construido** (Epic E9, F2‑Sprint 3, 6/6 ✅). El módulo `apps/api/src/remedial/` ya recupera contexto curricular + ítems de referencia, los inyecta en un prompt, genera material vía LLM, lo valida con Zod y lo persiste con workflow "IA propone / humano aprueba". Uno de sus tres generadores —`practice_set`— **ya crea ítems reales** de opción múltiple y los inserta en el banco (`items`, `source='ai_generated'`, `status='draft'`).

Entonces, ¿por qué se percibe como "solo sugerencias"? Por **dos razones concretas**:

1. **La capacidad generativa está latente.** El único gatillo de la UI (`analisis-ia/components/skill-gaps.tsx:74`) fuerza `type=guide` y bloquea el selector de tipo. Por la interfaz **solo se genera la guía en prosa** para el docente; los caminos `practice_set` (ítems reales) y `group_plan` existen, están testeados, pero **no tienen botón alcanzable**.
2. **Lo generado es un v1 aún no confiable.** Incluso activando `practice_set`, la calidad no es "la mejor posible" porque: se fundamenta solo en el *enunciado* de ≤5 ítems (no en el ítem completo), **ignora la evidencia del error ya calculada** aguas arriba (misconceptions, distractores elegidos), genera solo MCQ de 4 alternativas sin secuencia pedagógica, no tiene control de dificultad/nivel, **no tiene ninguna compuerta de calidad** (la validación pedagógica H18.2 quedó *diferida*), y no produce una ficha imprimible/asignable al alumno.

**La propuesta**, por tanto, no es "construir un generador" sino **convertir el generador v1 latente en un motor remedial confiable y de alta calidad**, sobre los mismos puertos y patrones ya existentes (aditivo, no reemplazo). Se organiza en **tres pilares**:

| Pilar | Qué resuelve | Palanca principal |
|---|---|---|
| **A. Activar** | La capacidad existe pero es invisible | Cablear `practice_set`/`group_plan` en la UI, mostrar el ítem completo, medir costo |
| **B. Fundamentar** | El material no está anclado a la evidencia real | Pasar el diagnóstico del error al generador + recuperación de referencia enriquecida + errores reales de alumnos |
| **C. Garantizar calidad** | Nada verifica que el material sirva | Secuencia pedagógica + compuertas automáticas (LLM‑juez) + métricas + cierre de ciclo |

El corazón de la evolución —y lo que va **más allá de la idea original**— es esto: **anclar la generación a la evidencia del error que el sistema YA computó pero descarta**, y **generar una secuencia pedagógica** (no "más ejercicios"), pasando cada pieza por **compuertas de calidad automáticas** antes de que el docente la vea.

---

## 1. Diagnóstico del sistema actual

### 1.1 Lo que ya existe y funciona (no reconstruir)

| Necesidad | Estado | Dónde |
|---|---|---|
| Detectar nodos/habilidades con menor rendimiento | **Ya existe** (3 vías) | `AssessmentReportService.getReport().skills` (ordena ascendente, brechas primero) + `highlights.gaps` (bottom‑3); `HeatmapService`; `SnapshotService.studentsBelowThreshold` (umbral `SKILL_REMEDIAL_THRESHOLD=60`) |
| Diagnóstico rico del error | **Ya existe** | `ai-analysis` produce `SkillDiagnosis { nodeId, achievement, rootCauseHypothesis, misconceptionSignal, reteachStrategy, exampleActivity, remedialGroupSize }`, persistido en `ai_analyses.output` |
| Recuperar ítems de referencia (RAG estructural) | **Ya existe** | `CurriculumRetriever.getContext(nodeId)` → nodo + ancestros + descriptores + hermanos + ítems etiquetados; `RemedialContextService.assemble()` |
| Generar material real | **Ya existe** (latente) | `remedial/generators/{guide,practice,group-plan}.generator.ts`; `practice_set` inserta ítems y los publica al aprobar |
| Fachada LLM multi‑proveedor + JSON + multimodal | **Ya existe** | `LlmService.complete/completeMultimodal`; Gemini 2.5 (default) + Claude registrados; JSON mode + Zod |
| Runner async con caché/idempotencia/estados | **Ya existe** | `RemedialRunner`, caché por `inputHash`, `JOB_DISPATCHER` in‑process |
| Workflow "IA propone / humano aprueba" | **Ya existe** | `remedial.service.ts` (`pending→processing→ready→approved/discarded`), `GuideEditor`, `ReviewPanel` |
| Gating de feature paga + roles | **Ya existe** | `FeatureGuard` + `@RequireFeature('remedial')`, `REMEDIAL_*_ROLES` |

**Conclusión:** la columna vertebral está construida. La evolución **entra por los puertos existentes** (`CurriculumRetriever`, `JobDispatcher`, `LlmProvider`), no los reemplaza.

### 1.2 Brechas reales — por qué el material aún no es "de la mejor calidad"

| # | Brecha | Detalle | Pilar |
|---|---|---|---|
| G1 | **Generación no alcanzable en UI** | `skill-gaps.tsx:74` hardcodea `type=guide`; selector bloqueado con `presetType` | A |
| G2 | **Ítem generado no visible** | `PracticeView` muestra solo el `stem`; alternativas/clave/explicación quedan ocultas | A |
| G3 | **Costo/tokens sin medir** | `RemedialRunner` persiste `model/tokens/costUsd = null`; el panel suma 0 para remedial | A |
| G4 | **Evidencia del error descartada** | Al generador solo le llega `nodeId`. `sourceAnalysisId` se guarda pero **nunca se lee**; `rootCauseHypothesis`, `misconceptionSignal`, distractores elegidos **no se pasan** | B |
| G5 | **Fundamentación pobre** | La referencia = solo el `stem` de ≤5 ítems, **match exacto de nodo**, sin alternativas/clave/dificultad, sin filtro de asignatura/nivel, **sin fallback** si el nodo no tiene ítems | B |
| G6 | **Sin errores reales de alumnos** | Los distractores los "imagina" el LLM; los `responses` con la alternativa efectivamente elegida (misconceptions reales) no se usan | B |
| G7 | **Sin secuencia pedagógica** | `practice_set` = N MCQ sueltos. No hay ejemplo resuelto → andamiaje → práctica guiada → recuperación → repaso → chequeo de dominio | C |
| G8 | **Sin control de dificultad/nivel** | No hay banda objetivo (ej. Insatisfactorio→Intermedio) ni calibración al nivel lector del grado | C |
| G9 | **Sin compuertas de calidad** | La validación pedagógica **H18.2 quedó diferida** (faltó API key). Hoy el único control es Zod (estructura) + juicio humano. No hay verificación de clave única, alineación al OA, distractores plausibles, legibilidad | C |
| G10 | **Un solo tipo de ítem** | `practice_set` genera solo `multiple_choice` de 4 alternativas (hardcode) | C |
| G11 | **Sin entregable al alumno** | Aprobar publica ítems al banco, pero no hay ficha imprimible/asignable ni pauta para entregar | A/C |
| G12 | **Sin métricas de calidad ni cierre de ciclo** | No hay medida de alineación, aprobación docente, ni mejora de logro post‑remedial; las ediciones del docente no se capturan | C |
| G13 | **Sin retry y deuda de índices** | El runner remedial no reintenta; faltan índices en `item_taxonomy_tags(nodeId)`, `items(orgId/status)`, `taxonomy_nodes(parentId)` | A |

---

## 2. Principios de diseño del motor v2

1. **Aditivo, no reemplazo.** Todo entra por los puertos existentes: `CurriculumRetriever` (retrieval), `JobDispatcher` (async), `LlmProvider` (modelo). El grounding estructurado queda como backbone permanente; pgvector se enchufa después sin tocar callers.
2. **Dirigido por `node_id` (taxonomía universal).** Nunca hardcodear "DIA"/"Lenguaje". El motor recibe la brecha como nodo de `taxonomy_nodes`; extender a SIMCE/PAES/Cambridge es cargar `taxonomies` + `taxonomy_nodes`, sin cambio de schema.
3. **La IA propone un borrador, nunca un entregable.** ~50 % del output crudo de un LLM trae *item‑writing flaws*; la compuerta automática + la aprobación humana son innegociables.
4. **Grounding estricto = anti‑alucinación.** Fundamentar en el **texto del OA + ítems de referencia completos + errores reales**; prohibir que el modelo derive a su conocimiento paramétrico.
5. **Secuencia pedagógica, no set de ejercicios.** Remediar la *misconception específica* con una secuencia con evidencia (ejemplo resuelto → andamiaje desvanecido → práctica guiada → recuperación → repaso espaciado → chequeo de dominio), no "más práctica del tema".
6. **Calidad verificable.** Compuertas automáticas antes del docente + métricas cuantitativas (hoy inexistentes) + gold set calibrado.
7. **Cero PII, RLS, gating.** Agregación determinista en backend; la IA solo ve agregados anónimos. Todo bajo `withOrgContext`; feature paga.

---

## 3. Arquitectura del motor (módulos y servicios)

Se **extiende** el módulo `remedial` y se **componen** servicios existentes. En **negrita**, lo nuevo.

```
                          ┌─────────────────────────────────────────────────────────┐
   Gatillo                │  RemedialController  ·  RemedialService (caché/estado)   │
 (brecha, lote,           │  RemedialRunner (async, JobDispatcher, +retry)           │
  benchmarking)           └───────────────┬─────────────────────────────────────────┘
                                          │ orquesta el pipeline
        ┌─────────────────────────────────┼──────────────────────────────────────────────┐
        ▼                                  ▼                                               ▼
┌──────────────────┐   ┌──────────────────────────────┐   ┌───────────────────────────────┐
│ **RemedialBrief**│   │ **ReferenceRetrieval**        │   │ **RemedialSequencePlanner**   │
│ **Service**      │   │ (extiende CurriculumRetriever)│   │  (nuevo)                      │
│ arma el brief    │   │  ítems completos + fallback   │   │  planifica la secuencia       │
│ del error (G4)   │   │  + errores reales (G5,G6)     │   │  pedagógica (G7)              │
└──────────────────┘   └──────────────────────────────┘   └───────────────┬───────────────┘
   reusa: ai_analyses,      reusa: item_taxonomy_tags,                     │ por slot
   AssessmentReport,        items, responses, instruments,                 ▼
   SnapshotService          taxonomy_nodes                    ┌───────────────────────────────┐
                                                              │ **ItemGeneratorSet** (multi-  │
                                                              │  tipo, multimodal) (G10)      │
                                                              │  reusa: LlmService,           │
                                                              │  validateItemContent          │
                                                              └───────────────┬───────────────┘
                                                                              ▼
                                                              ┌───────────────────────────────┐
                                                              │ **QualityGateService** (G9)   │
                                                              │  validadores determinísticos  │
                                                              │  + LLM-juez (otra familia)    │
                                                              │  → semáforo con evidencia     │
                                                              └───────────────┬───────────────┘
                                                                              ▼
                                          ┌───────────────────────────────────────────────────┐
                                          │  ReviewPanel + **ItemEditor/SequenceEditor** (G2)  │
                                          │  **RemedialFeedbackService** (captura ediciones)   │
                                          │  → **WorksheetAssembler** (ficha + pauta) (G11)    │
                                          │  → publica ítems · **mide impacto** (G12)          │
                                          └───────────────────────────────────────────────────┘
```

**Servicios reutilizados tal cual:** `RemedialService` (caché por `inputHash`, tenancy, review), `RemedialRunner` (async), `CurriculumRetriever`, `LlmService`/`LlmProvider`, `JOB_DISPATCHER`, `FeatureGuard`, `AssessmentReportService`, `SnapshotService`, `validateItemContent`, `performance_bands`.

**Servicios nuevos:**
- **`RemedialBriefService`** — arma el *brief diagnóstico* PII‑free (§4.2).
- **`ReferenceRetrievalService`** — implementación enriquecida del puerto `CurriculumRetriever` (§5).
- **`RemedialSequencePlanner`** — planifica la secuencia pedagógica (§4.4).
- **`ItemGeneratorSet`** — generadores por tipo de ítem, multimodal (§6).
- **`QualityGateService`** — compuertas determinísticas + LLM‑juez (§7).
- **`WorksheetAssembler`** — ensambla el entregable (ficha alumno + pauta + guía docente).
- **`RemedialFeedbackService`** — captura ediciones docentes y mide impacto (§7.3).

---

## 4. Flujo end‑to‑end (el pipeline)

### 4.1 Etapa 0 — Gatillo (qué remediar)

Tres orígenes, todos resolviéndose a un `node_id`:
- **Desde una brecha del Análisis IA** (hoy): `/material-remedial?nodeId&assessmentId&sourceAnalysisId&type&generate=1`. **Cambio (G1):** desbloquear el selector de tipo y **pasar `sourceAnalysisId` siempre**.
- **Por lote (nuevo):** "generar remedial para las N brechas críticas del curso" → encola N jobs. Reusa `highlights.gaps` / heatmap.
- **Desde Benchmarking (extensión, §9):** habilidades donde el colegio está bajo su cohorte.

El DTO ya soporta `{ type, nodeId, assessmentId?, classGroupId?, sourceAnalysisId?, itemCount?, force? }`. Se añade `targetBand?` (banda de logro objetivo, ej. `intermedio`) y `sequenceMode?`.

### 4.2 Etapa 1 — Brief diagnóstico (anclar a la evidencia del error) · **la mejora de mayor impacto**

`RemedialBriefService.build(nodeId, assessmentId, classGroupId, sourceAnalysisId)` ensambla un **brief determinista y sin PII** que reemplaza al actual "solo un nodeId":

| Campo del brief | Fuente (ya existe) |
|---|---|
| OA objetivo (código, nombre, descripción, eje, nivel) | `taxonomy_nodes` vía `CurriculumRetriever` |
| **Hipótesis de causa raíz + señal de misconception** | `ai_analyses.output` (`SkillDiagnosis`) leyendo `sourceAnalysisId` (hoy ignorado) |
| **Distractores realmente elegidos por los alumnos** | `responses.value` + `AssessmentReportService.buildItemAnalysis` (ya calcula "distractor dominante") |
| Logro actual + banda actual→objetivo | `skill_results.percentage`, `performance_bands` |
| Tamaño del grupo bajo umbral | `SnapshotService.studentsBelowThreshold` |
| **Nodos prerrequisito** (para activar conocimiento previo) | ancestros/`taxonomy_mappings` |

Esto convierte la generación de *"genera ejercicios de este tema"* a *"remedia este error específico, evidenciado por estos distractores reales, para llevar al grupo de la banda X a la Y"*. Es la diferencia entre re‑enseñar el tema y remediar la misconception (la práctica con más respaldo empírico).

### 4.3 Etapa 2 — Recuperación de referencia (RAG++) — ver §5.

### 4.4 Etapa 3 — Planificación de la secuencia remedial

`RemedialSequencePlanner` produce el **esqueleto** de una secuencia con evidencia pedagógica (no una lista plana de ítems). Estructura objetivo:

```
1. Activación de prerrequisitos   → 2–3 ítems de recuerdo del conocimiento previo
2. Ejemplo totalmente resuelto     → paso a paso etiquetado + prompts de auto-explicación
3. Problema de completación        → mismos pasos con andamiaje desvanecido
4. Práctica guiada (calibrada ~80%) → ítems paralelos + feedback elaborado (meta/brecha/próximo paso)
5. Práctica de recuperación         → ítems independientes, con feedback correctivo
6. Chequeo de dominio (≥80%)        → ítems paralelos de mismo OA
   └─ si falla → actividad correctiva en OTRA representación → re-chequeo
7. Repaso espaciado (agenda)        → recordatorio a +2–3 días y +1–2 semanas
```

El planner decide, a partir del brief + tipo de error (factual / procedimental / conceptual), qué *slots* incluir y con qué dificultad progresiva. Cada slot es un "encargo" tipado que consume el generador. Esta estructura se guarda en el `content` del `remedial_material` (schema `practice_set` extendido a `remedial_sequence`).

### 4.5 Etapa 4 — Generación del material — ver §6.

### 4.6 Etapa 5 — Compuertas de calidad automáticas — ver §7.

### 4.7 Etapa 6 — Revisión y aprobación docente

- **Editores por tipo (G2):** hoy solo existe `GuideEditor`. Añadir **`ItemEditor`** (editar stem, alternativas, marcar la correcta, explicación) y **`SequenceEditor`** (reordenar/quitar slots). Regenerar un ítem individual sin rehacer todo.
- **Mostrar el trío mínimo por ítem:** confianza + rationale de la IA + **la fuente con la que trabajó** (el OA, los distractores reales, el ítem de referencia citado). Convierte "¿le creo a la IA?" en "¿coincide con la fuente?".
- **Fricción calibrada (anti rubber‑stamping):** en ítems consecuentes, *forcing function* — el docente juzga **antes** de ver la sugerencia de la IA. "Rechazar" tan visible como "aprobar".
- **Capturar la edición** (par original→corregido), no solo aprobar/rechazar → alimenta el ciclo de mejora (§7.3).

### 4.8 Etapa 7 — Entrega

- **`WorksheetAssembler`** produce el entregable real: **ficha del alumno** (imprimible/PDF/asignable) + **pauta de corrección** + **guía docente** (estrategia, criterios de logro, agenda de repaso espaciado). Esto es "el material listo para entregar a los alumnos" que hoy no existe (G11).
- Al **aprobar**, los ítems pasan de `draft` a `published` (ya implementado) y quedan disponibles para reasignar.
- **F3:** entrega directa al alumno vía portal (fuera de F2 por decisión de producto).

### 4.9 Etapa 8 — Cierre de ciclo

- Agendar el **re‑chequeo** (coherente con las 3 instancias DIA: Diagnóstico → Monitoreo → Cierre).
- Medir **mejora de logro post‑remedial** y movimiento de banda (§7.2).
- Promover ediciones docentes de alta severidad a **casos de test/eval** del motor (§7.3).

---

## 5. Cómo se obtiene el material de referencia (grounding)

El objetivo: que la IA razone sobre material **real y alineado**, no que invente. Se extiende `CurriculumRetriever` (puerto ya diseñado para esto) de forma aditiva.

**5.1 Ítems de referencia completos (no solo el stem) — G5.** Recuperar `stem + alternativas + cuál es la correcta + explicación + dificultad` de los ítems etiquetados al nodo. Hoy solo se pasa el `stem`; pasar el ítem completo permite al modelo aprender el *formato, nivel y estilo de distractores* reales.

**5.2 Estrategia de recuperación con fallback y filtro.** Orden de recuperación:
1. Ítems del **mismo `node_id`** (match exacto), `status='published'`, del pool visible (`org_id = :orgId OR org_id IS NULL` → banco oficial DIA compartido + banco propio).
2. Si insuficientes → **subir al nodo padre / bajar a hermanos** (`parentId`) para OA afines del mismo eje.
3. **Filtrar por asignatura + nivel/grado** (`COALESCE(instruments.subject_id, taxonomy_nodes.subject_id)` y `grade_id`) para respetar "misma asignatura y nivel".
4. **Rankear** por cercanía (mismo eje/dificultad); tope configurable de few‑shot.

**5.3 Errores reales de alumnos — G6.** Minar de `responses` la alternativa **efectivamente elegida** por los alumnos que fallaron ese OA (el "distractor dominante" ya se computa en `buildItemAnalysis`). Estos son las *misconceptions reales chilenas*, muy superiores a las que imagina el LLM (los distractores simulados alinean solo ~34–52 % con errores auténticos). Se pasan al generador como "errores a atacar".

**5.4 Verificación de fundamentación.** Reinyectar cada ítem generado como *query* contra el contexto del OA: si no puede justificarse desde el estándar/OA recuperado, se marca. Más estricto que la similitud de embeddings.

**5.5 pgvector como futuro aditivo (no ahora).** El puerto `CurriculumRetriever` está diseñado para una implementación vectorial. Se justifica solo si aparece corpus pedagógico no estructurado o matching semántico cross‑currículo. **Gatillo recomendado:** cuando el retrieval estructural deje de encontrar suficientes ítems de referencia de calidad (medible). Requiere: extensión `pgvector`, columna `embedding` en `items` (+ política RLS), un proveedor de embeddings (hoy no configurado en `llm/`), e implementar el puerto con búsqueda coseno. **No bloquea nada de A/B/C.**

> **Nota de rendimiento (G13):** a escala, agregar índices en `item_taxonomy_tags(node_id)`, `items(org_id, status)` y `taxonomy_nodes(parent_id)`; hoy solo hay PKs/uniques.

---

## 6. Cómo se genera el material (generación de calidad)

**6.1 Modelos de ítem ("item models"), no ítems sueltos.** En lugar de pedir "genera 5 MCQ", generar a partir de un **modelo** anclado a un ítem de referencia + la misconception objetivo: enunciado con elementos manipulables + *constraints* que aten la clave y los distractores a la lógica del escenario. Un modelo produce variantes paralelas (útiles para práctica guiada, chequeo de dominio y re‑test).

**6.2 Distractores con método experto.** Flujo: *resolver → articular la misconception → simular el procedimiento erróneo hasta su respuesta → juzgar plausibilidad → curar*. **Pasar siempre la respuesta correcta** dentro del prompt de distractores (mejora el match con errores reales). Priorizar los **distractores reales minados** (§5.3).

**6.3 Múltiples tipos de ítem — G10.** Salir del MCQ‑only reusando el banco polimórfico (`validateItemContent` cubre `true_false`, `matching`, `ordering`, `gap_fill`, `open_ended`, etc.). El planner elige el tipo según el slot (ej. recuperación → `gap_fill`; conceptual → `open_ended` con pauta).

**6.4 Multimodal donde el OA lo pide.** Para habilidades de lectura/interpretación de gráficos, usar `completeMultimodal` (ya soportado por ambos providers). La generación de ítems con imagen se ancla a pasajes/imágenes de referencia. (Hoy la multimodalidad solo se explota en el análisis por‑pregunta, no en la generación.)

**6.5 Control de dificultad honesto — G8.** **No confiar en la auto‑estimación de dificultad del LLM** (correlación con dificultad real ρ≈0.28). En su lugar: (a) calibrar longitud/complejidad al **nivel lector del grado** (fórmula nativa de español tipo Fernández‑Huerta/INFLESZ + check de carga inferencial); (b) etiquetar el material por la **banda objetivo** (ej. Insatisfactorio→Intermedio para DIA); (c) a futuro, calibración IRT con datos de campo (los `irtParams` ya existen en `items`).

**6.6 Enrutamiento de modelos.** Reusa la fachada multi‑proveedor:
- **Generación (bulk):** Gemini 2.5 Flash / Flash‑Lite (barato, JSON mode nativo) — como hoy.
- **Juez de calidad (§7):** **modelo de OTRA familia** que el generador (Claude — ej. Haiku 4.5 barato / Sonnet 5 para casos difíciles), para evitar el sesgo de auto‑preferencia (un modelo tiende a aprobar su propio output).
- **Multimodal:** Gemini 2.5 (nativo) o Claude.
- **Deuda a corregir (G3):** hacer que `LlmService.complete` devuelva uso de tokens y poblar `model/tokens/costUsd`; **actualizar la tabla de precios** (hoy solo tiene gemini‑2.0/1.5; falta la familia 2.5). Nota: el catálogo Anthropic en `llm-settings` (`claude-sonnet-4-6`) luce desactualizado frente a Sonnet 5 / Haiku 4.5 / Opus 4.8 — conviene refrescarlo.

**6.7 Robustez.** Añadir **retry** en el runner remedial ante fallos transitorios (el patrón ya existe en `ai-analysis.runner`, con `isTransient` + backoff), sin reintentar errores de schema. Mantener el timeout y la caché por `inputHash`.

---

## 7. Garantía de calidad y métricas

Este es el pilar que hoy **no existe** (H18.2 diferida) y el que más mueve "la mejor calidad posible".

### 7.1 Compuertas de calidad automáticas (antes del docente)

`QualityGateService` corre en pipeline; **marca (flag), no auto‑rechaza** (salvo fallos duros), y adjunta evidencia:

```
1. Determinísticos (baratos, alto payoff psicométrico):
   · clave única (exactamente una alternativa isCorrect)         ← "más de una correcta" es el flaw más dañino
   · pistas de formato: opción-más-larga-es-la-clave, "todas/ninguna de las anteriores",
     concordancia gramatical stem↔clave, términos absolutos ("siempre/nunca"), enunciados en negativo
   · legibilidad ES (fórmula nativa) vs. nivel del grado objetivo
   · validación estructural (validateItemContent) — ya existe
2. LLM-juez (modelo de OTRA familia, rúbrica descompuesta estilo G-Eval):
   · alineación al OA: el juez predice qué skill evalúa el ítem y se contrasta con el node_id previsto
   · corrección de la clave: solve-then-check (el juez resuelve ANTES de ver la clave)
   · unicidad: self-consistency (muestrea N, mayoría) → detecta miskey y "múltiples correctas"
   · en matemática: tool-augmentado (ejecutar/verificar el cálculo, no confiar en la aritmética del juez)
   · plausibilidad de distractores, ausencia de sesgo, checklist de item-writing flaws (IWF)
3. Semáforo → verde (auto-certifica) / amarillo (revisión con evidencia) / rojo (rechaza y regenera)
```

**Controles anti‑sesgo del juez (críticos, y más aún en español):**
- Juez de **familia distinta** al generador (auto‑preferencia).
- **Position‑swap** en comparaciones A/B; aceptar solo veredictos consistentes.
- **Limpiar boilerplate** antes de juzgar (el token español **"Respuesta"** dispara falsos "correcto" hasta ~35 % FPR) y exigir que el juez **cite evidencia**.
- Normalizar longitud de opciones (sesgo de verbosidad).
- **Calibrar contra un gold set en español** (30–200 ítems del dominio real, DIA) y reportar **Cohen's κ** (meta ≈ 0.6–0.8), recalibrando por idioma/tarea.

### 7.2 Métricas a mejorar (la capa cuantitativa hoy ausente)

**Leading (calidad del material, por generación):**
- % de ítems que pasan la compuerta en verde (sin flags).
- Tasa de clave única / tasa de IWF detectados.
- Score de alineación al OA (juez).
- Coincidencia de nivel lector con el grado objetivo.
- **Tasa de aprobación docente** sin edición vs. con edición.
- **Distancia de edición** docente (cuánto corrige el humano) — proxy inverso de calidad.

**Lagging (impacto pedagógico):**
- **Mejora de logro post‑remedial** por OA (comparando instancias DIA: Diagnóstico→Monitoreo→Cierre) y **movimiento de banda** (Insatisfactorio→Intermedio→Satisfactorio).
- Tiempo de generación y **costo por material** (requiere G3).
- **Tasa de reuso** del material genérico por OA (flywheel, §9).

### 7.3 Ciclo de mejora (feedback flywheel)

- **Capturar cada edición docente** (par original→corregido), etiquetada por tipo/severidad.
- Las correcciones de alta severidad se **promueven a casos de eval/regression** del motor ("el error de ayer es el guardrail de mañana").
- Refinar prompts/few‑shot y umbrales del juez con esa señal. Esto es la ejecución concreta de la **H18.2 diferida**, ahora con datos reales.

---

## 8. Modelo de datos (extensiones)

Todo aditivo, respetando ítems polimórficos y RLS.

- **`remedial_materials.content`**: extender la unión discriminada con un tipo **`remedial_sequence`** (slots tipados: activación / ejemplo resuelto / completación / práctica guiada / recuperación / chequeo / repaso), además de guiar/practice/plan actuales.
- **`remedial_materials`**: poblar `model/tokens/costUsd` (G3); añadir `targetBand`, `qualityReport` (JSONB con los flags del semáforo y evidencia), `sourceAnalysisId` **leído** (no solo guardado).
- **Captura de edición docente:** registrar el par original→corregido (puede vivir en `remedial_materials` como `humanEdit` JSONB + `reviewedById`, coherente con "IA propone / humano aprueba"; o tabla `remedial_reviews` si se quiere histórico).
- **Entregable/asignación:** entidad ligera para vincular un `remedial_sequence` aprobado a un curso/grupo (para reasignar y medir impacto). Alineado con `action_plans` previsto para F3.
- **Ítems:** opcional, columna derivada de **dificultad empírica** (hoy se calcula on‑the‑fly desde `responses`) para acelerar el ranking de referencia; a futuro `embedding vector(n)` (+ RLS) para pgvector.
- **Índices (G13):** `item_taxonomy_tags(node_id)`, `items(org_id, status)`, `taxonomy_nodes(parent_id)`.

> `docs/Diseño bdd.md` no fue actualizado con las tablas F2 (`ai_analyses`, `remedial_materials`); conviene sincronizarlo al implementar.

---

## 9. Extensiones más allá de la idea original (valor incremental)

Tu idea guía era: *detectar nodos/ítems bajos → extraer ítems similares (misma taxonomía/asignatura/nivel) → pasar las falencias a la IA → generar material*. Es correcta y ya es la base construida. Las mejoras que elevan la calidad **más allá** de eso:

1. **Anclar a la evidencia del error, no solo al nodo bajo** (G4). La palanca #1 — y ya está computada aguas arriba, solo hay que dejar de descartarla.
2. **Generar una secuencia pedagógica**, no un set de ejercicios (G7). Ejemplo resuelto → andamiaje → práctica guiada ~80 % → recuperación → repaso espaciado → chequeo de dominio.
3. **Distractores desde errores reales de alumnos** minados de `responses` (G6), no imaginados.
4. **Compuertas de calidad automáticas** (LLM‑juez de otra familia + validadores) que operacionalizan la H18.2 diferida (G9).
5. **Entregable real al alumno** (ficha + pauta + guía) y, en F3, portal del alumno (G11).
6. **Benchmarking → remedial**: gatillar remediación en las habilidades donde el colegio está bajo su cohorte (hoy la conexión es solo narrativa en el demo).
7. **Reuso plataforma‑global del material genérico por OA** (hoy `org_id NOT NULL`, per‑tenant): un OA remediado una vez sirve a muchos colegios → flywheel de costo y calidad. Requiere `org_id` nullable + política de lectura compartida (documentado como futuro).
8. **Ítems multimodales** para lectura/gráficos (G10, §6.4).

---

## 10. Plan de desarrollo por olas

Ordenado por **impacto/esfuerzo**: primero activar y anclar (barato, alto impacto), luego calidad, luego entrega/escala.

**Ola 1 — Activar + Anclar (rápida, alto impacto).**
- G1: desbloquear tipos en la UI (`practice_set`/`group_plan` alcanzables).
- G2: `ItemEditor` + preview del ítem completo.
- G4: `RemedialBriefService` — leer `sourceAnalysisId`, pasar causa raíz + distractores reales al generador.
- G5 (parcial): pasar ítems de referencia **completos** + fallback padre/hermano + filtro asignatura/nivel.
- G3: poblar costo/tokens; refrescar tabla de precios. G13: retry + índices.

**Ola 2 — Secuencia + Calidad (el salto de calidad).**
- G7: `RemedialSequencePlanner` + tipo `remedial_sequence`.
- G10: generadores multi‑tipo.
- G6: minado de errores reales para distractores.
- G9: `QualityGateService` (validadores + LLM‑juez de otra familia); gold set en español + κ.
- G12 (parcial): dashboard de métricas leading; captura de edición docente.
- Operacionaliza **H18.2** con datos reales.

**Ola 3 — Entrega + Cierre de ciclo.**
- G11: `WorksheetAssembler` (ficha alumno + pauta + guía docente, PDF/asignable).
- G12: medición de mejora post‑remedial (instancias DIA) + flywheel de ediciones a eval.
- Reuso plataforma‑global por OA (§9.7).

**Ola 4 — Escala y avanzado.**
- pgvector (si el gatillo lo justifica), ítems multimodales, benchmarking→remedial, calibración IRT de dificultad, portal del alumno (F3).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Alucinación / material desalineado** | Grounding estricto en OA + ítems completos + errores reales; round‑trip de fundamentación; compuertas de calidad; prohibir conocimiento paramétrico |
| **El LLM estima mal la dificultad** | No confiar en su auto‑estimación; usar legibilidad ES + banda objetivo + field‑testing/IRT con datos de campo |
| **Rubber‑stamping docente** | *Forcing function* en ítems consecuentes; "rechazar" tan fácil como "aprobar"; instrumentar velocidad de aprobación como señal de fatiga |
| **Sesgo del juez (español)** | Juez de otra familia; position‑swap; limpiar boilerplate ("Respuesta"); citar evidencia; calibrar con gold set + κ |
| **Costo descontrolado** | Enrutamiento de modelos (Flash para bulk); caché por `inputHash`; reuso cross‑tenant; enforcement de presupuesto (hoy solo informa) |
| **Fuga de PII (Ley 19.628)** | Agregación determinista en backend; la IA solo ve agregados anónimos; todo bajo `withOrgContext` |
| **H18.2 bloqueada por falta de API key** | Asegurar `GEMINI_API_KEY` / config de proveedor antes de Ola 2; el gate y las métricas dependen de ejecución real |
| **Deriva de la Priorización Curricular** | Tratarla como configuración con vigencia (dato), no hardcodear; la Actualización 2023–2025 expira fin 2025 |

---

## 12. Decisiones abiertas para tu confirmación

1. **Formato del entregable:** ¿ficha PDF imprimible, asignación digital en la plataforma, o ambas? (define el alcance de `WorksheetAssembler`).
2. **Banda objetivo por defecto:** ¿remediar siempre hasta la banda inmediata superior (Insatisfactorio→Intermedio) o configurable por el docente?
3. **Prioridad de tipos de ítem** para Ola 2 (además de MCQ): ¿`gap_fill` + `open_ended` con pauta primero?
4. **Presupuesto del juez de calidad:** ¿corre en todos los ítems o solo en los consecuentes/muestreados? (costo vs. cobertura).
5. **Reuso cross‑tenant** del material genérico por OA: ¿opt‑in por colegio (como el benchmarking) o plataforma‑global desde el inicio?
6. **Timing del portal del alumno** (entrega directa): ¿se mantiene en F3 o se adelanta?

---

## Apéndice — Evidencia (fuentes clave)

- **AIG / psicometría:** Gierl & Lai (NCME Module 34, item models & strong‑theory); auto‑estimación de dificultad poco fiable (ρ≈0.28, arXiv 2512.18880); ~50 % de output crudo con item‑writing flaws (PubMed 40516963).
- **RAG / grounding:** RAG sobre el estándar sube validez curricular de ~12 % a ~90 %+ (arXiv 2508.04442); híbrido RAG+few‑shot (arXiv 2501.17397); distractores reales vs. simulados 34–52 % (arXiv 2603.15547).
- **Pedagogía:** IES Practice Guide (worked examples, spaced/retrieval practice); Rosenshine (pasos pequeños, práctica guiada ~80 %); mastery learning (d≈0.5–0.59); Hattie & Timperley (feedback: meta/brecha/próximo paso).
- **LLM‑juez:** solve‑then‑check baja el fallo del juez de 70 % a 15 % (arXiv 2306.05685); "más de una correcta" es el flaw más dañino (γ=−0.317 discriminación, arXiv 2503.10533); G‑Eval rúbrica descompuesta (arXiv 2303.16634); token "Respuesta" engaña al juez (~35 % FPR, arXiv 2507.08794); SAQUET IWF (arXiv 2405.20529).
- **Human‑in‑the‑loop:** explicaciones pueden *aumentar* el exceso de confianza; forcing functions (ACM 3449287, arXiv 2102.09692).
- **Chile:** DIA reporta `Insatisfactorio/Intermedio/Satisfactorio` (Agencia de Calidad), formativo/no calificable, 3 instancias/año; OA codificados (`LE05 OA 01`); SIMCE `Adecuado/Elemental/Insuficiente`; habilidades Lectura (Localizar/Interpretar/Reflexionar) y Matemática (Resolver/Modelar/Representar/Argumentar).
