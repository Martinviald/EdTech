# Diseño — Eliminar la evaluación de calidad del instrumento

> **Qué es esto:** el levantamiento completo y el diseño de ejecución del ítem **#1** del
> [roadmap de producto](./roadmap-producto.md) (P0): sacar de la plataforma toda pieza que
> **cuestione o evalúe la calidad psicométrica del instrumento o de sus ítems**.
>
> **Estado:** 🔲 Pendiente · **Fecha:** 2026-08-04 · **Precede a:** #3 (análisis IA), #4 (comparación),
> #6 (asistente).

---

## 1. Por qué

Los instrumentos que procesa la plataforma son **estándar y validados** por un tercero (DIA de la
Agencia de Calidad, SIMCE, PAES, Cambridge). Emitir un juicio sobre su calidad psicométrica —KR-20,
discriminación, punto-biserial, banderas de ítem "defectuoso"— no aporta valor al colegio y, peor,
**contamina el diagnóstico pedagógico**: cuando el análisis IA puede atribuir un bajo logro a que
"el ítem está mal redactado", deja de buscar la causa de aprendizaje, que es lo único sobre lo que
el colegio puede actuar.

Hay además un problema de legitimidad: con ~30 alumnos por curso, un KR-20 o un punto-biserial no
tienen potencia estadística para juzgar un instrumento nacional calibrado sobre decenas de miles de
casos. Hoy la plataforma le dice a un colegio que la pregunta 12 del DIA "probablemente está
defectuosa" con base en 23 respuestas.

> **La distinción que ordena todo este documento:**
> **el dato de comportamiento del ítem se queda; el juicio sobre el ítem se va.**
> Que el 68% haya elegido la alternativa C siendo la clave la B es un hallazgo pedagógico de primera
> línea (una misconcepción compartida). Que eso signifique "el distractor está mal diseñado" es un
> juicio sobre el instrumento y se elimina.

---

## 2. Levantamiento

**53 archivos** (fuera de `docs/`) contienen huella psicométrica. Se agrupan en seis capas; el orden
en que se listan es el orden en que conviene tocarlas (§6). Comando de verificación en §6.

### 2.1 Módulo dedicado — se elimina completo

`apps/api/src/instrument-quality/` (H20.9, determinista, sin IA). Expone **`GET /api/instrument-quality`**
y devuelve confiabilidad + una ficha por ítem con banderas y sugerencias de corrección.

| Archivo | Qué hace |
|---|---|
| `instrument-quality.service.ts` | Arma la matriz alumno×ítem desde `responses`, calcula KR-20 y punto-biserial, deriva 5 banderas por umbrales y emite sugerencias por plantilla |
| `instrument-quality.controller.ts` | `@Roles(...INSTRUMENT_QUALITY_VIEWER_ROLES)` + `@RequireCapability('psychometrics')` |
| `instrument-quality.module.ts` | Importa `AssessmentReportModule` (de ahí saca p/D/distractor) |
| `instrument-quality.service.spec.ts` | 34 referencias |

Las 5 banderas y sus umbrales: `low_discrimination` (D < 0,20), `ambiguous_key` (r_pb < 0,10),
`strong_distractor` (distractor ≥ clave o > 35%), `too_easy` (p > 90%), `misaligned` (ítem sin tags
de taxonomía). Cada una produce una sugerencia del tipo *"revisa la redacción y la clave, o considera
reformularla o reemplazarla"*.

> El controller documenta explícitamente por qué el módulo **no** puede degradar sin `responses`:
> *"Afirmaría mala calidad donde solo faltan datos"*. Es el argumento del propio código a favor de
> esta limpieza, aplicado a un caso particular.

### 2.2 Psicometría embebida en el informe de evaluación

`apps/api/src/assessment-report/assessment-report.service.ts` es la fuente de p, D y distractor que
consumen todos los demás. Aquí la limpieza es **quirúrgica**, no un borrado:

| Línea | Qué es | Acción |
|---|---|---|
| ~649 | `difficulty = correctas/total × 100` | **Se queda** — es el % de logro del ítem |
| ~653-655 | `discrimination = p(27% sup) − p(27% inf)` (Kelley) | **Se va** |
| ~658-663 | `topDistractorKey` / `topDistractorRate` | **Se queda** — lectura pedagógica |
| ~725-745 | `deriveItemFlags()`: `critical`, `easy`, `low_discrimination`, `strong_distractor` | Se van 1 y se reencuadran 2 (§4) |
| ~928-940 | Recomendación determinista `review_item`: *"Revisar la redacción/clave de N pregunta(s) con baja discriminación"* | **Se va** (con el valor `review_item` del enum `RECOMMENDATION_TYPES`) |

### 2.3 Capa IA — el eslabón que el roadmap subestima

El roadmap dice "reescribir prompts". No alcanza: la psicometría entra al modelo por el **snapshot**,
que es una capa anterior. Si solo se tocan los prompts, los números siguen viajando en el payload.

| Archivo | Rol | Acción |
|---|---|---|
| `ai-analysis.metrics.ts` | `kr20()` y `pointBiserial()` puras | **Eliminar** (queda sin consumidores) |
| `ai-analysis.snapshot.ts` | `reliability: { kr20: kr20(matrix) }`, `discrimination`, `pointBiserial` por ítem, `loadScoreMatrix()` | Quitar campos + la matriz |
| `item-insight.snapshot.ts` | `discrimination`, `pointBiserial` (arma su propia `ScoreMatrix`) | Ídem |
| `instrument-comparison.snapshot.ts` | `reliabilityKr20`, `discrimination` por ítem | Ídem |
| `prompts/assessment-insights.prompt.ts` | Regla de `likelyCause: item_quality` ("el ÍTEM es defectuoso"), contrato de salida con `reliability`, instrucción *"prioriza por p y D"* | Reescribir + **bump** de `PROMPT_VERSION` |
| `prompts/item-insight.prompt.ts` | Ídem + `itemQuality.verdict` `solid\|review\|flawed` | Reescribir + bump |
| `prompts/instrument-comparison.prompt.ts` | *"Contrasta el CONTENIDO: dificultad (p), discriminación (D)…"* | Reescribir + bump |

**Contratos de salida a recortar** (`packages/types/src/schemas/ai-analysis.schema.ts`):

- `itemLikelyCauseSchema` — sacar `'item_quality'`; quedan `not_taught`, `misconception`,
  `insufficient_practice`.
- `assessmentInsightsOutputSchema.reliability` `{ kr20, interpretation }` — sacar el bloque.
- `itemInsightQualityVerdictSchema` (`solid|review|flawed`) y el bloque `itemQuality { verdict, notes }`
  de `itemInsightOutputSchema` — eliminar.
- Campos `discrimination` / `pointBiserial` de los tipos de snapshot y de `itemPracticeCardSchema`.

### 2.4 Contratos compartidos y capacidades

| Archivo | Acción |
|---|---|
| `packages/types/src/schemas/instrument-quality.schema.ts` | Eliminar (query, 5 flags, `ItemQualityModel`, `InstrumentReliabilityModel`, `InstrumentQualityResponse`) |
| `packages/types/src/access-policies/instrument-quality.ts` | Eliminar `INSTRUMENT_QUALITY_VIEWER_ROLES` |
| `packages/types/src/analytics-capabilities.ts` | **Retirar** `'psychometrics'` + su entrada en `capabilityUnavailableMessage` |
| `packages/types/src/schemas/assessment-report.schema.ts` | `ITEM_REPORT_FLAGS`, `discrimination`, `review_item`, y el bloque doc de `hasItemLevelData` que enumera D |
| `packages/types/src/schemas/instrument-comparison.schema.ts` | Campos psicométricos del snapshot |
| `packages/types/src/schemas/item.schema.ts` | `irtParamsSchema` (ver decisión D6) |

### 2.5 Frontend

| Archivo | Acción |
|---|---|
| `(dashboard)/evaluaciones/[assessmentId]/calidad/` (`page.tsx`, `loading.tsx`) | Eliminar la ruta |
| `(dashboard)/evaluaciones/[assessmentId]/page.tsx` | Quitar la tarjeta/pestaña *"Calidad del instrumento — Confiabilidad (KR-20) y banderas psicométricas"* |
| `lib/routes.ts` | Quitar `evaluacionCalidad` |
| `components/shared/PageTabs.tsx` | Quitar la mención a `psychometrics` del comentario del modo deshabilitado |
| `(dashboard)/analisis-ia/components/quality-panel.tsx` | Eliminar |
| `(dashboard)/analisis-ia/components/reliability-panel.tsx` | Eliminar |
| `(dashboard)/analisis-ia/components/quality-format.ts` | Eliminar (`FLAG_LABELS`) |
| `(dashboard)/analisis-ia/components/analysis-report.tsx` | Quitar `<QualityPanel>`, `<ReliabilityPanel>` y la prop `quality` |
| `(dashboard)/analisis-ia/components/ai-export-button.tsx` | Quitar la **Hoja 6 "Calidad instrumento"** del Excel y la sección homónima del PDF |
| `(dashboard)/analisis-ia/components/item-cards.tsx`, `format.ts` | Quitar el veredicto y el label `item_quality: 'Calidad del ítem'` |
| `(dashboard)/evaluaciones/[assessmentId]/analisis-ia/page.tsx` | Quitar el fetch paralelo a `/instrument-quality` (línea ~232) |
| `(dashboard)/resultados/informe/items-analysis-table.tsx` | Quitar la columna **Discriminación (D)**, `fmtDiscrimination`, `discriminationClass` y los flags removidos |
| `(dashboard)/resultados/informe/report-export-button.tsx` | Quitar la columna D del Excel y del PDF, `discriminationColor`, y el pie *"D < 0,2 sugiere revisar la pregunta"* |
| `(dashboard)/resultados/informe/report-body.tsx` | Revisar la referencia restante |

### 2.6 Asistente IA

`apps/api/src/assistant/tools/get-assessment-report.tool.ts` — la **descripción** de la tool le
promete al modelo *"flags como critical/low_discrimination/strong_distractor/easy"*. No hay tool
dedicada de calidad, pero si la descripción no se reescribe el modelo sigue razonando en ese marco
aunque el dato ya no llegue. Bump de `ASSISTANT_PROMPT_VERSION` si se toca el system prompt.

### 2.7 Tests (10 specs)

| Spec | Por qué se toca |
|---|---|
| `instrument-quality.service.spec.ts` | Se elimina con el módulo |
| `ai-analysis.snapshot.spec.ts` · `ai-analysis.runner.spec.ts` | Aserciones sobre `reliability` / `discrimination` del snapshot y del output |
| `item-insight.snapshot.spec.ts` · `item-insight.runner.spec.ts` | Ídem + veredicto `itemQuality` |
| `assessment-report.service.spec.ts` | D, flags y la recomendación `review_item` |
| `capability.guard.spec.ts` | Usa `psychometrics` como capacidad de ejemplo |
| `remedial-brief.service.spec.ts` | Solo fixtures: su snapshot de entrada trae `reliability: { kr20: 0.81 }` y `pointBiserial` |
| `items.service.spec.ts` · `item-edit-proposals.service.spec.ts` | Fixtures con `irtParams: {}` — solo se tocan si se decide D6 en contra |

---

## 3. Hallazgos que cambian el plan

### 3.1 🔴 La caché seguirá sirviendo psicometría después del cambio

`AiAnalysisService.computeInputHash()` hashea **`{assessmentId, analysisType, audience, classGroupId}`**
— y **no** el `promptVersion`. La validación Zod estricta corre en la **escritura** (`parseOutput`),
no en la lectura. Consecuencia: toda fila `completed` existente en `ai_analyses` se seguirá
devolviendo tal cual, con su `reliability` y su `itemQuality.verdict`, aunque el prompt ya no los
produzca. **La limpieza sería invisible para todo análisis ya generado.**

Es el hallazgo más importante del levantamiento y no está en el roadmap. Ver decisión **D4**.

### 3.2 `psychometrics` no es una constante suelta

Es una capacidad del sistema de analítica agregada: la aplica un guard (`@RequireCapability`), viaja
en `meta.capabilities` del informe y tiene un mensaje de usuario en `capabilityUnavailableMessage()`.
La buena noticia es que `analytics-capabilities.ts` ya trae una sección **"Capacidades RETIRADAS"**
con la regla y un precedente (`remedial_stimulus`, 2026-07-15): hay que retirarla siguiendo ese
patrón, documentando el porqué, no borrar la línea.

### 3.3 `difficulty` (p) es el mismo número que "% de logro"

En `AssessmentReportService`, `difficulty` = `correctas / total × 100`. Es exactamente el % de logro
del ítem: **dato pedagógico legítimo**. Lo psicométrico no es el número sino el nombre y la lectura
("dificultad del ítem" → propiedad del instrumento). Se queda el número; cambia el encuadre.

### 3.4 Dos flags están a caballo entre las dos lecturas

- **`strong_distractor`** — el hecho ("una alternativa incorrecta atrae más que la clave") es la señal
  pedagógica más potente que produce el informe. El copy actual la vuelve juicio de instrumento
  (*"revisa si el distractor es defendible como correcto"*).
- **`easy`** (p ≥ 85) — el umbral describe logro alto; el copy dice *"ítem muy fácil (poco aporte
  diagnóstico)"*, que es juicio de instrumento.

Ver decisiones **D2** y **D3**.

### 3.5 `misaligned` no es psicometría

Marca ítems sin tags de taxonomía: es **calidad de nuestros datos**, no del instrumento. Muere con el
módulo. Vale la pena anotarlo como candidato a rescatar más adelante en la gestión del banco de ítems
—no en esta limpieza.

---

## 4. La línea de corte

| Se elimina (juicio sobre el instrumento) | Se conserva (comportamiento y aprendizaje) |
|---|---|
| KR-20 y su interpretación por rangos | % de logro del ítem (hoy `difficulty`) |
| Discriminación D (Kelley 27%) | Distribución de respuestas por alternativa |
| Correlación punto-biserial | Distractor dominante y su tasa |
| Banderas `low_discrimination`, `ambiguous_key`, `too_easy`, `misaligned` | Flag `critical` (logro bajo) |
| Sugerencias "reformula o reemplaza la pregunta" | Recomendaciones de reenseñanza y apoyo a alumnos |
| Causa `item_quality` del análisis IA | Causas `not_taught`, `misconception`, `insufficient_practice` |
| Veredicto IA `solid \| review \| flawed` | Análisis de distractores como misconcepción |
| Recomendación `review_item` | `reteach_skill`, `support_students` |
| Endpoint `GET /api/instrument-quality` y su pestaña | Informe, matriz alumno×pregunta, `item-analysis` |
| Capacidad `psychometrics` | Resto de capacidades de granularidad |

**Invariante de aceptación:** después de esta limpieza, ninguna salida del producto —UI, export, prompt
o respuesta de API— puede atribuir un resultado a un defecto del instrumento. Toda explicación de un
bajo logro es una explicación de aprendizaje.

---

## 5. Decisiones

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | ¿Renombrar el campo `difficulty` → `achievement`/`correctRate`? | **No en esta pasada.** Cambiar solo el copy de UI y exports ("Dificultad (p)" → "% de logro"). Renombrar el campo toca informe, snapshots, 3 prompts y 2 exports; es un refactor de contrato que merece su propio PR. |
| **D2** | `strong_distractor`: ¿eliminar o reencuadrar? | **Reencuadrar** a `dominant_error`, con copy pedagógico ("la mayoría eligió la misma alternativa incorrecta: revisar la misconcepción"). Perder la señal sería perder el hallazgo más útil del informe. |
| **D3** | Flag `easy` | **Mantener el umbral, cambiar el copy** a "logro alto". Quitar "poco aporte diagnóstico". |
| **D4** | Caché de `ai_analyses` con psicometría vieja (§3.1) | **Incluir `promptVersion` en el `inputHash`** y bumpear las 3 versiones de prompt. Invalida lo viejo de forma natural, deja el historial intacto y previene la misma clase de bug en todo cambio futuro de prompt. Alternativa más barata: script de soft-delete de las filas con `promptVersion` antiguo. |
| **D5** | Capacidad `psychometrics` | **Retirar** siguiendo la sección "Capacidades RETIRADAS" del propio archivo, con la fecha y el motivo. |
| **D6** | `items.irtParams` (columna JSONB) | **Dejar inerte.** No tiene lectores fuera del CRUD de ítems; sacarla mete una migración de DB en un PR que ya toca 51 archivos. Anotarla como deuda. |
| **D7** | Ruta `/evaluaciones/:id/calidad` | **Eliminar** (sin redirect: es una vista interna, no un permalink compartido). |

---

## 6. Plan de ejecución

**Un solo PR.** El monorepo comparte tipos entre `api` y `web`: partirlo en dos deja la rama
intermedia sin compilar. El orden interno sí importa —de contrato hacia afuera— para que el
typecheck vaya señalando lo que falta:

1. **Tipos** — recortar `ai-analysis.schema.ts`, `assessment-report.schema.ts`,
   `instrument-comparison.schema.ts`; eliminar `instrument-quality.schema.ts` y su access-policy;
   retirar la capacidad `psychometrics`. *A partir de aquí el typecheck es la lista de tareas.*
2. **Caché** — `computeInputHash` incorpora `promptVersion` (D4).
3. **Backend** — eliminar `instrument-quality/`; limpiar `assessment-report.service.ts` (D, flags,
   `review_item`); eliminar `ai-analysis.metrics.ts`; limpiar los 3 snapshots.
4. **Prompts** — reescribir los 3 sin marco psicométrico y bumpear versión
   (`s1-insights-v1` → `v2`, `s2-item-insight-v1` → `v2`, `tkt23-instrument-comparison-v1` → `v2`).
5. **Asistente** — descripción de `get-assessment-report.tool.ts`.
6. **Frontend** — ruta y pestaña; los 3 componentes que se eliminan; los 6 que se limpian; las 2
   rutas de export.
7. **Tests** — actualizar los 9 specs; borrar los del módulo eliminado.

### Verificación

```bash
pnpm typecheck && pnpm lint && pnpm test

# Censo de la huella (hoy: 53 archivos; al terminar debe ser 0)
rg -l -i "kr20|point.?biserial|discriminac|discrimination|item_quality|psychometrics|\
psicom|ambiguous_key|strong_distractor|too_easy|reliability|irtParams" \
   --glob '!node_modules' --glob '!docs/**' --glob '!*.json' | wc -l
```

> El censo se corre **antes** de empezar y al cerrar. Si D6 se resuelve dejando `irtParams` inerte,
> los 8 archivos que solo la mencionan quedan como residuo esperado y hay que excluirla del patrón.

Smoke manual: informe de evaluación (sin columna D), análisis IA regenerado (sin panel de
confiabilidad ni veredicto), export Excel y PDF de ambos, hub de evaluación (sin pestaña Calidad),
y una evaluación cargada desde informe oficial (que antes veía la pestaña apagada por capacidad).

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Análisis IA ya generados siguen mostrando psicometría | D4 — `promptVersion` en el hash |
| El prompt reescrito pierde precisión al quedarse sin D como señal | El modelo conserva p, distribución de alternativas y distractor dominante: suficiente para distinguir `misconception` de `not_taught`. Revisar 2-3 salidas reales antes de mergear |
| Un consumidor no listado leía `discrimination` | El typecheck estricto lo caza: los campos salen del contrato compartido, no solo de la implementación |
| Se borra de más y se pierde el análisis de distractores | La invariante de §4 y la decisión D2 lo protegen explícitamente |

---

## 8. Efecto sobre el roadmap

Cerrar #1 desbloquea #3 (el análisis multi-paso nace sin la dimensión de calidad, en vez de tener que
extirparla después), #4 (`instrument-comparison.prompt.ts` queda listo para el contraste de contenido
que pide el ítem) y #6 (el asistente deja de prometer flags psicométricos). Y deja instalada la
decisión D4, que #3B necesitará cuando los análisis se disparen por evento en vez de por clic.
