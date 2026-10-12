# Plan — Etapa 1: lectura por visión más exacta y con menos ceros injustos

> Rama `feat/vision-lectura-etapa1`, creada desde `fix/vision-fotos-reales` (PR #302). Una PR a
> `dev`, que se re-apunta a `dev` cuando se mergee la #302. Sin deploy.
>
> Origen de cada decisión: `docs/bitacora-correccion-vision.md` (pruebas con fotos reales del
> 2026-10-12), y los informes fuera del repo en `pruebas-vlm-manuscrito/`
> (`experimento-lectores`, `experimento-pipeline`, `experimento-preproceso`,
> `ideas-mejorar-transcripcion.md`, `revision-literatura.md`).

## 1. Objetivo

Subir la autoaceptación de las respuestas escritas sin aceptar notas equivocadas, y atacar el
error más dañino que muestran nuestros datos y la literatura: **el 0 injusto** (una respuesta
correcta leída mal y corregida como incorrecta sin revisión).

Línea base en el dataset de 24 casillas cortas reales × 3 repeticiones (letra adulta):

| Configuración                                           | Autoaceptadas | Autoaceptadas equivocadas | US$/recorte |
| ------------------------------------------------------- | ------------- | ------------------------- | ----------- |
| Actual: Gemini 3.5 Flash-Lite + Haiku 5.5 (umbral 0,85) | 21 %          | 0                         | 0,0013      |
| Objetivo mínimo: pipeline B                             | ≥ 40 %        | 0                         | ≤ 0,005     |

## 2. Regla de oro: nada queda fijo sin medirse

Cada cambio que afecte la lectura pasa por la **compuerta de medición** antes de quedar como
commit en la rama de la etapa:

1. **Tests unitarios** que reproduzcan el comportamiento (test previo que falla con el código
   anterior cuando es un arreglo).
2. **Arnés de evaluación** (tarea T0) sobre el dataset real, contra la configuración vigente en la
   rama, con las mismas lecturas cacheadas cuando el cambio no toca al lector.
3. **Criterios de aceptación** del cambio:
   - Autoaceptadas equivocadas **que perjudican al alumno**: no pueden subir (tolerancia 0).
   - Autoaceptadas equivocadas que lo favorecen: no pueden subir.
   - Autoaceptación: no puede bajar más que el ruido medido entre repeticiones, salvo que el
     objetivo del cambio sea mandar más a revisión (verificador).
   - Costo por recorte dentro del presupuesto de la sección 6.
4. Si el cambio no cumple, **no se integra**: queda registrado en la bitácora como medido y
   descartado.

Los subagentes trabajan en worktrees propios y entregan commits; el orquestador corre la compuerta
y recién entonces integra con cherry-pick. Las migraciones las genera solo el orquestador.

**Límite honesto:** el dataset son 24 casillas de 3 hojas de letra adulta. Sirve para descartar y
para detectar regresiones; no demuestra el 99,5 % de precisión del diseño (eso exige ~600
autoaceptadas sin error y letra de niños: etapa 2).

## 3. Tareas

### T0 — Arnés de evaluación v2 (primero; nada se integra sin él)

- Extender `apps/api/scripts/answer-reading-eval/` para evaluar **recortes reales** fuera del repo
  (dataset con manifiesto: imagen, formato, ítem, verdad por casilla) además de los fixtures
  sintéticos.
- **Caché de lecturas** por (modelo, parámetros, hash del prompt renderizado, sha256 de la imagen,
  repetición): un cambio de política o de normalización se mide sin volver a pagar llamadas.
- Simulación con el código real: rutas leídas de un JSON o de la BD, `evaluateConsensus`,
  normalización, corrección con el formato derivado, y (cuando exista) umbral por lector y
  verificador.
- Métricas: lectura exacta por lector, autoaceptadas, **equivocadas separadas en "perjudica al
  alumno" y "lo favorece"** con su efecto en puntaje, revisión por motivo, costo y latencia;
  intervalos de confianza (Wilson) y comparación pareada entre dos configuraciones sobre los
  mismos recortes.
- Dataset inicial: los 30 recortes de `pruebas-vlm-manuscrito/hojas-sinteticas/resultado-fotos-v2/`
  con su verdad, importando las lecturas ya pagadas de `experimento-lectores` y
  `experimento-pipeline` al caché.
- **Compuerta de T0:** reproducir con el arnés las cifras ya medidas de la línea base y del
  pipeline B (21 % / 0 y 44 % / 0) dentro del ruido.

### T1 — Umbral por lector y arreglos de proveedores

- `minConfidence` por lector en la política de consenso (opcional en `readerSpecSchema` o un mapa
  por familia en `consensusPolicySchema`; compatible hacia atrás).
- `OpenAiProvider`: la escalera de `reasoning.effort` debe bajar de nivel cuando el modelo rechaza
  uno (hoy el patrón de error no calza con el mensaje real de la API).
- `AnthropicProvider`: `thinking: disabled` rechazado por Sonnet 5.5 (arreglo menor; Anthropic
  queda fuera como lector, pero el proveedor no debe fallar con modelos nuevos).
- **Compuerta:** tests; el arnés con la ruta actual debe dar exactamente lo mismo (sin umbrales por
  lector configurados, el comportamiento no cambia).

### T2 — Ruta del pipeline B (migración, generada por el orquestador)

- Agregar `gemini-3.5-flash` a `llm_models` con su precio (fuente primaria anotada).
- Rutas globales nuevas (versión siguiente, retirando las vigentes, como en 0050): lector principal
  `gemini-3.5-flash` con umbral 0,97 + `gpt-6-luna` con `reasoning: low` y umbral 0,85, para los
  formatos de respuesta corta; la ruta de desarrollo (`free_text`, `math_work`) pasa de Haiku a
  `gemini-3.5-flash`.
- **Compuerta:** arnés con la ruta nueva contra la actual: ≥ 40 % autoaceptado y 0 equivocadas;
  migración probada desde cero en PG14 desechable.

### T3 — Lectura por casilla en una sola llamada

- Prompts nuevos (versión siguiente, con lock) para los formatos con casillas por dígito o por parte
  (`integer`, `decimal`, secuencias): describen las casillas impresas y piden el contenido de **cada
  casilla** por separado; el valor se arma **en código** con la geometría (casilla vacía = nada,
  coma impresa = separador decimal), reutilizando la normalización desde `parts` de la #302.
- Regla explícita en el prompt para lo impreso y para manchas o puntos sueltos.
- **Compuerta:** arnés contra T2, por formato; en particular decimales (hoy 4/9 exactos con
  Flash-Lite) y secuencias. Se integra por formato: si un formato no mejora, conserva su prompt.

### T4 — Verificador de incorrectas (solo puede mandar a revisión)

- Cuando el consenso va a **autoaceptar una respuesta como incorrecta**, un verificador recibe el
  recorte, la lectura acordada y la clave, y responde si la escritura podría ser la respuesta
  correcta mal leída (`{ couldBeKey, confidence, notes }`).
- Si duda, la casilla pasa a revisión con un motivo nuevo (`verifier_flagged`, modo corrección).
  **Nunca acepta ni cambia una nota.**
- Prompt nuevo con propósito `verification` (la clave sí se permite en este propósito, y solo aquí).
  Verificador de una familia distinta del lector principal (`gpt-6-luna@low`); se mide también con
  `gemini-3.5-flash`.
- **Compuerta:** arnés contra T2/T3: cuántos 0 injustos atrapa (casos reales y perturbaciones
  controladas de los recortes, p. ej. el `10`/`15` de Bruno P5) y cuántas incorrectas verdaderas
  manda a revisión sin necesidad (costo en revisión docente). Se integra si atrapa más de lo que
  cuesta en falsos avisos, a criterio documentado.

### T5 — Cierre

- Corrida end-to-end con las 6 fotos (OMR → recortes → pipeline completo) con la configuración
  final, revisión independiente del diff, CI verde, bitácora y PR con la tabla antes/después.

## 4. Orden y paralelismo

```
T0 ──► T1 ──► T2 ──► (T3 ∥ T4) ──► combinación T2+T3+T4 en el arnés ──► T5
```

T3 y T4 tocan piezas distintas (prompts y formatos frente a un paso posterior al consenso) y se
miden por separado contra T2 y luego combinadas.

## 5. Despachos

| Tarea | Subagente                                | Worktree      | Compuerta la corre |
| ----- | ---------------------------------------- | ------------- | ------------------ |
| T0    | implementador del arnés                  | `wt-cv-e1-t0` | orquestador        |
| T1    | implementador backend                    | `wt-cv-e1-t1` | orquestador        |
| T2    | (orquestador: migración) + implementador | `wt-cv-e1-t2` | orquestador        |
| T3    | implementador de prompts y formatos      | `wt-cv-e1-t3` | orquestador        |
| T4    | implementador del verificador            | `wt-cv-e1-t4` | orquestador        |
| T5    | revisor independiente                    | solo lectura  | orquestador        |

Reglas para los subagentes: las de `scratchpad/reglas-subagente.md` (semáforo para procesos
pesados, un worktree propio, commits sin push, sin migraciones, sin `pnpm format` global, cero
comentarios en `apps/api`), español neutro con tuteo.

## 6. Presupuesto de IA

Tope de la etapa: **US$5**. Estimado: T0 ≈ 0 (reutiliza lecturas pagadas), T2 ≈ US$0,30,
T3 ≈ US$0,60, T4 ≈ US$0,40, T5 ≈ US$0,30. Cada experimento declara su tope antes de correr y se
anota en la bitácora.

## 7. Fuera de la etapa 1

Hojas de niños y calibración (etapa 2), tinta fuera del recorte y regla de tachados (etapa 3),
validación de la rúbrica contra el acuerdo entre docentes (etapa 4). Medido y descartado: tapar el
número de pregunta, preprocesar la imagen, esquema por capas con Flash-Lite primero, dos pasadas del
mismo Gemini, control de tinta por casilla, rediseño estético de la hoja.
