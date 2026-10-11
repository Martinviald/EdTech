# Plan de desarrollo — Corrección por visión de preguntas abiertas

> Estado: plan listo para ejecución autónoma (2026-10-11).
> Diseño de referencia (fuente de verdad técnica): `docs/diseno-correccion-vision-preguntas-abiertas.md`.
> Antecedentes: `docs/propuesta-correccion-respuestas-abiertas.md`, `apps/api/scripts/probar-vlm-manuscrito.ts`.

Este plan está escrito para que **agentes lo ejecuten de punta a punta sin supervisión humana y
sin aprobación entre fases**. Un agente orquestador dirige el trabajo, toma las decisiones y
despacha subagentes. Cuando el diseño no alcanza para decidir, el orquestador decide con las
reglas de §3.4, deja registro y sigue.

---

## 1. Objetivo y alcance

**Objetivo:** dejar construido y verificado en una PR contra `dev` el sistema del diseño: las
respuestas abiertas de la hoja se recortan, uno o más modelos de visión las transcriben, nuestro
código las normaliza y corrige, lo dudoso va a una cola de revisión en dos modos, y todo queda
versionado, medido y trazable.

**Dentro del alcance:** fases 0 a 11 de este plan (equivalen a las fases 0 a 5 del diseño, más
el catálogo de modelos en BDD y el proveedor OpenAI).

**Fuera del alcance:**

- Merge a `dev` o `main`, despliegue, y cualquier operación sobre AWS, S3 real, la BDD demo o
  túneles. La PR queda lista para que una persona la revise y la mergee.
- Desarrollo matemático por pasos (`math_work`) y texto largo (fase 6 del diseño).
- Vertex AI y Bedrock (decisión D4 del diseño).
- Abrir la cola de revisión a docentes (decisión D1).

---

## 2. Roles

### 2.1 Orquestador (director de desarrollo)

Es la sesión principal. Responsabilidades:

1. Preparar el entorno (worktree, rama, PR en borrador) y mantener la bitácora.
2. **Fijar los contratos y las semánticas compartidas antes de despachar** a cualquier
   subagente (tipos Zod, nombres, enums, reglas). Los peores bugs aparecen entre tareas de
   agentes distintos; por eso los contratos los escribe el orquestador, no un subagente.
3. Despachar a los subagentes con un prompt completo: objetivo, archivos, contratos, reglas del
   proyecto, gates y criterio de término.
4. Verificar el trabajo de cada subagente contra la fuente: leer el diff, correr los gates y
   revisar los valores extremos. No se da por bueno un "listo" sin evidencia.
5. Integrar, hacer push, esperar el CI y decidir el avance de fase.
6. Decidir cuando haya ambigüedad (§3.4) y registrar la decisión.

### 2.2 Subagentes

| Tipo                      | Cuándo se usa                                                                                                                            | Herramienta                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Implementador**         | Una unidad de trabajo con archivos claros (un paquete, un módulo, una UI)                                                                | `Agent` general-purpose, en el worktree de integración o con `isolation: "worktree"` si corre en paralelo  |
| **Revisor independiente** | Al cierre de las fases de riesgo alto: BDD/RLS, consenso, consolidación en `responses`, normalización que cambia la corrección existente | `Agent` general-purpose con instrucción de solo revisar, o el skill `code-review` sobre el diff de la fase |
| **Especialista**          | Tareas acotadas que requieren conocimiento puntual: proveedor OpenAI (§5, fase 4), motor OMR en Python (fase 5)                          | `Agent` general-purpose con contexto específico                                                            |
| **Explorador**            | Ubicar código antes de despachar, cuando el orquestador no sabe dónde está algo                                                          | `Agent` Explore                                                                                            |

### 2.3 Cuándo usar subagentes (y cuándo no)

- **Sí:** cuando la tarea es grande y separable, cuando dos tareas son independientes y pueden
  correr en paralelo, y cuando una segunda mirada independiente reduce un riesgo real (fases de
  riesgo alto).
- **No:** para cambios de pocos archivos que el orquestador hace en minutos, para revisar fases
  de riesgo bajo, ni para repetir una búsqueda ya hecha. Nunca dos subagentes sobre los mismos
  archivos al mismo tiempo.
- **Máximo 3 subagentes activos a la vez**, aunque una ola permita más (RAM y capacidad de
  integración del orquestador).
- Presupuesto orientativo: **~25 despachos** en todo el plan (implementadores ~15, revisores ~6,
  especialistas ~2, exploradores según necesidad). Si una fase pide más de 4, el orquestador
  revisa si la está partiendo de más.

---

## 3. Reglas de operación autónoma

### 3.1 Límites duros (nunca se cruzan)

- **Sin AWS, SST, S3 real, BDD demo ni túneles.** Los gates de BDD usan una base local nueva y
  desechable (PostgreSQL local, no `soe_dev`).
- **Sin merge** a `dev` ni `main` y sin despliegue.
- **Sin push forzado**, sin reescribir historia publicada y sin borrar ramas ajenas.
- **No debilitar controles para pasar un gate:** no se desactiva RLS, no se borran ni se saltan
  tests, no se agrega `any`, no se baja un umbral de calidad del diseño.
- **Datos personales:** los fixtures y los datasets del repo no llevan nombres ni RUT reales. Los
  recortes de prueba son los 23 de `pruebas-vlm-manuscrito/` (fuera del repo) o sintéticos.

### 3.2 Recursos de la máquina (8 GB de RAM)

- **Un proceso pesado a la vez** (typecheck, jest, vitest, pytest, build, instalación). Antes de
  lanzar uno: `pgrep -fl "vue-tsc|tsc --build|vitest|jest|pytest|webpack|vite build|esbuild"`.
  Si hay uno, se espera.
- **Nunca** `--force` en typecheck o build. Nunca `pnpm format` global: Prettier solo sobre los
  archivos propios (`npx prettier --write <archivos>`).
- **Tests locales acotados** a los archivos tocados (`pnpm test <archivo>`). Las suites completas
  (api ~27 min) corren **en el CI**, no en local.
- **Semáforo de procesos pesados.** Como en una ola trabajan varios subagentes en paralelo, todo
  comando pesado (typecheck, jest, vitest, pytest, build, instalación, `db:generate`,
  `db:migrate`) se ejecuta a través de un candado compartido, de modo que **se programa en
  paralelo pero se prueba de a uno**. El script se crea en F0, fuera del repo
  (`~/bin/edtech-pesado`):

  ```bash
  #!/usr/bin/env bash
  LOCK=/tmp/edtech-pesado.lock
  until mkdir "$LOCK" 2>/dev/null; do
    if [ -f "$LOCK/pid" ] && ! kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
      rm -rf "$LOCK"
    else
      sleep 5
    fi
  done
  echo $$ > "$LOCK/pid"
  trap 'rm -rf "$LOCK"' EXIT
  "$@"
  ```

  Uso: `~/bin/edtech-pesado pnpm --filter @soe/api test answer-reading`. Ningún agente corre un
  comando pesado sin el semáforo. Un candado huérfano (proceso muerto) se libera solo.

### 3.3 Git y PR

- **Rama de integración:** `feat/correccion-vision`, creada desde `origin/dev`, en el worktree
  `EdTech/wt-correccion-vision`. **Una sola PR** contra `dev` (borrador) para todo el trabajo;
  cada fase son commits en esa misma PR.
- Subagentes en paralelo trabajan en worktrees aislados (`isolation: "worktree"`) creados desde
  la rama de integración, y **deben commitear** su trabajo antes de terminar: un worktree sin
  commit se pierde. El orquestador trae los commits con `cherry-pick` o `merge` local.
- **Antes de cada push:** consultar el estado real de la PR
  (`gh pr list --head feat/correccion-vision --state all --json number,state,mergedAt,baseRefName`)
  en un paso **separado** del push. Si la PR aparece `MERGED` o `CLOSED`, no se pushea: se abre
  rama y PR nuevas desde `origin/dev`.
- **CI verde significa:** número de checks > 0, todos en `SUCCESS` y `mergeStateStatus` limpio.
  "No checks reported" significa conflicto, no "esperando". `UNKNOWN` es transitorio (~60 s).
- Commits atómicos en español, formato conventional commit (skill `commit`), con el pie de
  coautoría. Nunca `(cmd) > log; echo EXIT=$?` para afirmar éxito: se lee el log.
- **Migraciones Drizzle:** si al integrar `dev` aparece un número de migración repetido, se
  conserva la cadena de `dev`, se borra el `.sql` propio y se **regenera**. Toda tabla nueva con
  datos sensibles lleva su política en `packages/db/sql/rls-policies.sql`.
- **Integración periódica de `dev`:** al inicio de cada ola, `git fetch` y merge de
  `origin/dev` en la rama de integración, para no acumular conflictos.
- **Migraciones en paralelo:** F1, F3 y F6 cambian el schema. Los subagentes **solo editan los
  archivos de schema** (`packages/db/src/schema/*.ts`) y las políticas que les correspondan;
  **no corren `db:generate`**. El orquestador genera las migraciones una sola vez al integrar
  cada ola, así no chocan los números.
- **Archivos compartidos:** los `index.ts` que reexportan (`packages/types`, `packages/db`),
  `LlmModule`, `app.module.ts`, `packages/db/sql/rls-policies.sql` y `package.json` los edita
  **solo el orquestador** al integrar. El subagente entrega en su informe las líneas que hay
  que agregar.

### 3.4 Cómo decide el orquestador

Orden de prioridad cuando hay ambigüedad:

1. El diseño (`docs/diseno-correccion-vision-preguntas-abiertas.md`) y sus decisiones D1–D9.
2. `CLAUDE.md` y `.claude/rules/**` (contrato del proyecto).
3. El patrón existente más cercano en el código (`@soe/decisions`, `sheet-scanning`, `llm/`).
4. La opción **más reversible y más estricta**: ante la duda, mandar a revisión antes que
   autoaceptar; dejar configurable antes que fijar; agregar antes que modificar.

Cada decisión no trivial se registra en `docs/bitacora-correccion-vision.md` con fecha, fase,
contexto, opciones, decisión y motivo. La bitácora es parte del entregable.

### 3.5 Cuándo se detiene el orquestador

No pide permiso, pero **se detiene y deja un informe** (en la bitácora y en la descripción de la
PR) si ocurre algo de esta lista. No hay que inventar una salida:

- El CI falla por la **misma causa** después de 3 ciclos de corrección.
- Un paso exige cruzar un límite duro (§3.1).
- El gasto en APIs de IA alcanza el tope (§3.6).
- La PR aparece mergeada o cerrada por alguien más.
- Un cambio del diseño resulta imposible o contradictorio con el código real y no hay una
  alternativa reversible.

Ante un fallo de un subagente (trabajo incompleto, tests rojos), el orquestador primero
reintenta **una vez** con un prompt corregido; si vuelve a fallar, lo termina él mismo o divide
la tarea.

### 3.6 Uso de APIs de IA reales

- Los tests unitarios y el CI **nunca** llaman APIs reales: usan el transcriptor falso.
- Las llamadas reales solo se permiten en: la verificación manual de cada proveedor (pocas
  llamadas) y el arnés de evaluación (fase 9).
- **Tope de gasto total del plan: US$5.** El orquestador lleva la cuenta en la bitácora con el
  costo que reporta cada corrida.
- OpenAI no tiene clave en el `.env`: su proveedor se verifica solo con tests con el SDK mockeado.

---

## 4. Gates de calidad

### 4.1 Gate de tarea (cada despacho de subagente)

1. El subagente entrega: lista de archivos tocados, comandos corridos con su salida y riesgos.
2. El orquestador lee el diff completo y verifica contra el diseño y los contratos.
3. Typecheck incremental **del paquete tocado** (`pnpm --filter <paquete> typecheck`).
4. Tests de los archivos tocados.
5. Lint de los archivos tocados y Prettier sobre ellos.

### 4.2 Gate de fase (antes de avanzar)

1. Todos los gates de tarea en verde.
2. Si hubo cambios de schema: `pnpm db:generate` produce exactamente la migración esperada y
   `db:migrate` corre limpio sobre la BDD local desechable, incluidas las políticas RLS.
3. Revisor independiente en verde, **solo en fases de riesgo alto** (marcadas ⚠ abajo). Sus
   hallazgos confirmados se corrigen antes de avanzar.
4. Push y **CI verde** (§3.3).
5. Entrada en la bitácora: qué se hizo, decisiones, costo de IA y estado de la PR.

Un gate rojo nunca se "resuelve" relajando el gate (§3.1).

---

## 5. Fases

Las fases dependen sobre todo de los **contratos de F2**, no unas de otras. Por eso se
ejecutan en **olas**: dentro de una ola los subagentes trabajan en paralelo, en worktrees
aislados, y al cerrar la ola el orquestador integra, genera migraciones, corre los gates en
secuencia, hace push y espera el CI.

| Ola   | Fases (en paralelo dentro de la ola)                                                                                   | Requiere |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| **A** | F0 → F1 → contratos de F2 (secuencial, orquestador + 1 implementador en F1)                                            | —        |
| **B** | F2 núcleo puro · F3 capa LLM y catálogo · F5a motor OMR (Python) · F5b layout e impresión (TS) · F6 modelo de datos    | Ola A    |
| **C** | F4 proveedor OpenAI · F7 pipeline y consolidación · F9 arnés de evaluación · F10a normalizadores de formatos nuevos    | Ola B    |
| **D** | F8 API y UI de revisión · F11a transcripción de desarrollo y servicio de rúbrica · F10b integración de formatos nuevos | Ola C    |
| **E** | F11b UI de rúbrica · F12 cierre                                                                                        | Ola D    |

Dependencias finas que justifican el agrupamiento:

```text
contratos F2 ─┬─ F2 núcleo ──┬────────────── F9 arnés
              │              └─ F10a formatos (puro)
              ├─ F3 LLM ─────┬─ F4 OpenAI
              │              └──────────────┐
              ├─ F5a OMR ───────────────────┤
              ├─ F5b layout ────────────────┼─ F7 pipeline ─┬─ F8 API/UI ── F11b UI rúbrica ── F12
              └─ F6 tablas ─────────────────┘               ├─ F11a rúbrica (servicio)
                                                            └─ F10b formatos (integración)
```

- La ola B tiene cinco frentes y el máximo es 3 subagentes a la vez: se lanza en dos tandas,
  primero los de **riesgo alto o largos** (F2 núcleo, F6, F3) y después F5a y F5b.
- **F8:** la UI puede empezar dentro de la ola D apenas el orquestador fije el contrato de la
  API de revisión, sin esperar a que la API esté terminada.
- **F9** no necesita BDD ni pipeline: usa el núcleo y los proveedores directamente. Por eso va
  en la ola C y la línea base queda medida antes de construir la UI.
- Integración de cada ola: el orquestador trae los commits de cada worktree (`cherry-pick` o
  `merge`), aplica las líneas de archivos compartidos, genera migraciones, corre los gates con
  el semáforo, y solo entonces hace push.

### F0 — Preparación (orquestador, sin subagentes)

- Crear el worktree `wt-correccion-vision` y la rama `feat/correccion-vision` desde `origin/dev`.
- Traer los documentos del diseño, la propuesta y el script de experimentos (hoy sin commitear
  en otra rama) como primer commit.
- Crear `docs/bitacora-correccion-vision.md`.
- Abrir la PR en borrador contra `dev` con el plan como descripción.
- **PR 0.0 del diseño:** actualizar `CLAUDE.md` §8.1 (la lectura por visión y la calificación
  asistida de desarrollo entran en la fase actual, D9).
- Verificar que exista una BDD local para gates y preparar el comando para crear una desechable.
- Crear el semáforo de procesos pesados (`~/bin/edtech-pesado`, §3.2).

**Salida:** PR en borrador con CI corriendo sobre los documentos.

### F1 — Prerrequisitos (1 implementador + orquestador)

Corresponde a la fase 0 del diseño (§2.2 del diseño).

| Tarea                                                                                                                                                                                         | Quién                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Integrar `feat/items-autocorregibles` (comparadores `ordered_tuple` y `sequence`, ítems convertidos). Resolver conflictos con `dev`                                                           | Orquestador                    |
| Bug: los ítems de recorte quedan "pendientes de lectura" al confirmar, nunca 0 (`scan-review.service.ts`, `AnswerSheetsService.confirm`)                                                      | Implementador                  |
| `ai_grading_jobs.org_id NOT NULL` + backfill vía `responses → assessments` + política RLS                                                                                                     | Implementador (mismo despacho) |
| Módulo LLM: `temperature` opcional (no se envía si el modelo no lo acepta), `usage` en Anthropic, eliminar `gemini-2.5-flash-lite` del catálogo, sumar `ai_grading_jobs` a `ai-observability` | Implementador (mismo despacho) |

**Gate extra:** test que reproduce el bug del 0 antes del arreglo y pasa después.

### F2 — Contratos y núcleo puro ⚠ (orquestador + 1 implementador + 1 revisor)

1. **El orquestador escribe los contratos** en `packages/types/src/schemas/answer-reading/`
   (formato de respuesta, salida del lector con `reviewRequested`, respuesta normalizada,
   lector, ruta, política de consenso con `auditSampleRate`, revisión, equivalencias) y el
   campo opcional `content.responseFormat`. También fija las semánticas compartidas: nombres de
   motivos de revisión, estados, la regla "indecidible ≠ incorrecto" y la estructura canónica
   por formato (§5.5 del diseño).
2. **Implementador:** paquete `@soe/answer-reading` siguiendo el patrón de `@soe/decisions`:
   registro de formatos numéricos (`integer`, `decimal`, `fraction`, `ordered_tuple`,
   `sequence`), parsers a estructura canónica, normalizadores, `evaluateConsensus` puro,
   resolución de rutas con precedencia, transcriptor falso, prompts `transcribe.short-answer@1`
   y `@2` (el v2 del experimento) con lock de hashes.
3. **Implementador (mismo despacho):** `matchesAcceptedAnswer` compara estructuras canónicas con
   las equivalencias por defecto (§5.5 del diseño). Es el cambio más delicado: también afecta la
   ingesta por CSV.
4. **Revisor independiente:** revisa que el cambio de comparación no altere ningún resultado
   existente salvo los casos de §5.5, y que el consenso implemente exactamente el algoritmo del
   diseño (§8.2), incluido el paso de alternativas que cambian el resultado.

**Gate extra:** tabla de regresión con todos los casos de los tests actuales de `short-answer`,
los formatos raros de GradeCam (`"3 45"`, `"2-3-4-5"`, `"1,3,4,5"`, `"23.5"`) y los 23 recortes
del experimento (como literales). Ningún resultado previo correcto puede cambiar a incorrecto.

### F3 — Capa LLM: salida estructurada y catálogo de modelos en BDD ⚠ (1 implementador + 1 revisor)

Objetivo: que los modelos y sus precios **se administren desde la BDD**, no desde código, para
todos los proveedores.

- **Tabla `llm_models`** (catálogo global, sin datos de colegios): `provider`, `model_id`,
  `label`, `max_output_tokens`, `supports_images`, `supports_structured_output`,
  `supports_batch`, precios por millón (entrada, salida, entrada en caché, multiplicador de
  batch), `enabled`, `deprecated_at`, timestamps. Seed con el catálogo actual de
  `LLM_MODEL_CATALOG` y las tarifas vigentes (Haiku 5.5 0,10/0,50; Gemini 3.1 Flash-Lite
  0,25/1,50; Gemini 3.5 Flash-Lite 0,30/2,50; etc.).
- `LLM_MODEL_CATALOG` y `llm.pricing.ts` pasan a leer de la tabla (con caché en memoria e
  invalidación al editar). Lo que hoy valida contra el catálogo en código
  (`updateLlmSettingSchema`, `findModelOption`, `resolveModelMaxTokens`, `estimateLlmCostUsd`)
  pasa a validar contra la BDD en el service.
- Endpoints de administración del catálogo para `platform_admin` (listar, crear, habilitar o
  deshabilitar, editar precios). El panel `/configuracion/modelos-ia` muestra solo modelos
  habilitados.
- `completeStructured` en la interfaz de proveedor: salida estructurada nativa en Anthropic
  (`output_config.format` con JSON schema) y Gemini (`responseSchema`, `mediaResolution`),
  `usage` completo (incluye tokens de razonamiento) y control de razonamiento por modelo.
- Subir `@google/genai` a una versión que soporte `thinkingLevel` y `responseJsonSchema`.
  Es una instalación: corre **sola**, sin otro proceso pesado.
- Feature nueva `answer_transcription` en `LLM_FEATURES`, con default Haiku 5.5.

**Revisor:** RLS y permisos del catálogo (tabla global, solo `platform_admin` escribe),
compatibilidad con las features existentes (ninguna debe cambiar de modelo por la migración) y
el cálculo de costos.

**Verificación real:** una llamada de humo con salida estructurada a Haiku 5.5 y otra a Gemini
3.5 Flash-Lite con uno de los 23 recortes (costo < US$0,01).

### F4 — Proveedor OpenAI (especialista, ola C)

Despacho a un **subagente especialista** con este encargo:

- Integrar OpenAI como proveedor **seleccionable igual que Gemini y Anthropic**: `openai` en
  `LLM_PROVIDERS` de `packages/types`, `providers/openai.provider.ts` con el SDK oficial `openai`,
  registrado en `LlmModule`, clave en `OPENAI_API_KEY` (agregar a `.env.example`).
- Implementar toda la interfaz de proveedor: `complete`, `completeWithUsage`,
  `completeMultimodal(WithUsage)` con imágenes, `completeStructured` (Responses API con JSON
  schema estricto) y `streamWithTools` (para el asistente). Usage con tokens de razonamiento;
  `reasoning.effort` configurable (por defecto el mínimo para transcribir).
- **Modelos por BDD, no por código:** seed de modelos OpenAI en `llm_models` (por ejemplo
  `gpt-6-luna`, `gpt-5.6-luna`, `gpt-5.4-mini` con sus precios), **habilitados pero sin ser el
  default de ninguna funcionalidad**. Agregar un modelo OpenAI nuevo debe ser solo un registro
  en la tabla.
- Si falta `OPENAI_API_KEY`, el proveedor queda no disponible (`isAvailable() === false`) y el
  panel lo muestra como no configurado, sin romper el arranque (mismo patrón tolerante que los
  otros proveedores).
- Tests con el SDK mockeado por export (patrón de `.claude/rules/backend/01-testing.md`). Sin
  llamadas reales (no hay clave).
- Nota de privacidad en el código de configuración: Batch de OpenAI no es compatible con cero
  retención.

**Salida:** OpenAI aparece en el panel de modelos y se puede asignar a cualquier funcionalidad
desde la BDD; ninguna funcionalidad lo usa todavía.

### F5 — Motor OMR y layout por formato (F5a especialista Python + F5b implementador TS, ola B)

- **Especialista Python** (`services/omr/`): perfil de recorte versionado con margen, ancho y
  calidad configurables; métrica `inkRatio` por campo; contrato v2 de la respuesta del motor.
  Tests `pytest` acotados a los archivos tocados y el gold set del OMR sin regresiones.
- **Implementador TS:** el layout automático deriva campos de `responseFormat`
  (`sheet-layout.helpers.ts`), la impresión dibuja las casillas por formato (fracción con raya,
  `( □ ; □ )`, casillas por carácter con coma impresa) en `sheet-print.helpers.ts`, y un
  invariante nuevo rechaza campos de respuesta que se superpongan a la región de identidad.

**Gate extra:** PDF de una hoja de prueba con cada formato, revisado visualmente por el
orquestador (se lee la imagen generada).

### F6 — Modelo de datos answer-reading ⚠ (1 implementador + 1 revisor)

- Tablas del diseño (§9): `answer_reading_runs`, `answer_readings` (evidencia inmutable),
  `answer_reading_decisions`, `answer_reviews` (solo se agregan filas), `reading_routes`,
  `answer_reading_samples`. Todas con `org_id`, PK uuid y timestamps; JSONB tipados.
- Políticas en `packages/db/sql/rls-policies.sql`, migración generada y aplicada en la BDD
  local desechable.
- Ajustes por organización `answerReading` en `orgConfigSchema` con los defaults decididos:
  `allowExternalVision: true` (D3), `datasetConsent: 'org_internal'` (D7).
- Actualizar `docs/Diseño bdd.md`.

**Revisor:** RLS (cada tabla con política y `FORCE`), inmutabilidad de la evidencia, índices de
la cola y que ninguna consulta prevista quede fuera de `withOrgContext`.

### F7 — Pipeline de lectura y consolidación ⚠ (2 implementadores secuenciales + 1 revisor)

1. **Implementador A — pipeline:** módulo `apps/api/src/answer-reading/`. Lectura en segundo
   plano al procesar cada hoja (D2), en `JOB_DISPATCHER`; selección de ruta, lectores en
   paralelo, normalización, consenso, presupuesto previo al run, reintentos e idempotencia por
   `readingKey`, auditoría muestral (D5), interruptor por organización (D3).
2. **Implementador B — consolidación:** `confirmBatch` usa la decisión de lectura de cada ítem;
   escritura por lotes en `responses` dentro de `withOrgContext` según la tabla del diseño
   (§10.2); recálculo de resultados; nunca se pisa un `human_score`. Observabilidad y costos
   por organización, lote y versión de prompt.
3. **Revisor:** consolidación (`ai_score`/`human_score`/`final_score`), pendientes que nunca
   quedan en 0, aislamiento por organización, costo y concurrencia del job.

**Gate extra:** test de punta a punta del flujo con el transcriptor falso (hoja procesada →
lecturas → decisiones → confirmación → `responses`), siguiendo el patrón de
`round-trip.e2e.spec.ts`.

### F8 — API y UI de revisión (1 implementador, ola D)

Antes de despachar, el orquestador fija el contrato de la API de revisión (rutas, DTOs Zod y
modos), para que la UI pueda avanzar en paralelo con los endpoints.

- Endpoints de la cola por evaluación y por lote, agrupados por `(item, canonical)`, con los dos
  modos (D8): **lectura sin clave** y **corrección con clave**. Roles: `SHEET_REVIEW_ROLES` por
  ahora (D1).
- Paso "Respuestas escritas" en el asistente de revisión del lote y tab por evaluación, con
  atajos de teclado, aceptación por grupo, deshacer y edición con la forma del formato.
- Siguiendo `.claude/rules/frontend/**`: TanStack Query vía el proxy, componentes compartidos,
  tokens de diseño y responsive.
- Las revisiones alimentan `answer_reading_samples`; las `unparsed_format` marcadas correctas
  generan un caso de prueba pendiente para el normalizador.

Sin revisor independiente (riesgo medio); el orquestador revisa el diff y prueba la UI con el
skill `run` si el entorno local lo permite (sin demo).

### F9 — Arnés de evaluación (1 implementador)

- Evolucionar `apps/api/scripts/probar-vlm-manuscrito.ts` a un comando `answer-reading:eval`
  que use **los mismos** contratos, rutas, normalizadores y consenso que producción.
- Dataset dorado en formato del gold set del OMR: los 23 recortes etiquetados (sin datos
  personales) más casos sintéticos por formato.
- Métricas del diseño (§12): exactitud por formato, tasa de autoaceptación, precisión de lo
  autoaceptado, sobrecorrección, costo y latencia; comparación entre rutas o prompts.
- **Corrida real** de la ruta inicial (Haiku 5.5 + Gemini 3.5 Flash-Lite, prompt v2) para dejar
  la línea base registrada en la bitácora (costo < US$0,50).

### F10 — Más formatos (1 implementador en cada parte)

- **F10a (ola C, puro):** en `@soe/answer-reading`, `word_list`, `short_text` y `multi_box`, con
  su registro, normalizador, estructura canónica, tests de regresión y variante de prompt si
  hace falta; crédito parcial por componente en pares solo si la pauta lo indica (D6) y crédito
  por casilla en `gap_fill`.
- **F10b (ola D, integración):** layout e impresión de esos formatos, burbujas para pareados y
  secuencias, `score_bubbles` (vía sin IA para desarrollo) y su consolidación en el pipeline.

### F11 — Desarrollo con rúbrica ⚠ (F11a ola D, F11b ola E; 1 implementador por parte + 1 revisor)

- **F11a:** transcripción de `free_text` y `RubricGradingService`.
- **F11b:** UI de rúbrica, cuando la cola de F8 ya existe.

- Transcripción de `free_text` con su prompt (el de "solo transcribir" ya probado) y su cola.
- `RubricGradingService` reemplaza a `DevelopmentGradingService` **detrás de una ruta**: se
  apaga la ruta vieja, no se borra el código hasta que la nueva funcione. Usa la transcripción
  confirmada, la rúbrica con ejemplos y salida estructurada; escribe `ai_grading_jobs` (con
  `org_id`) y `ai_score`; el docente siempre aprueba.
- UI de rúbrica con atajos 0/1/2 y agrupación por nivel propuesto.
- Motor de calificación: LLM con salida estructurada (la alternativa con `@soe/decisions` queda
  registrada como decisión abierta del diseño).

**Revisor:** que ninguna ruta escriba `final_score` sin aprobación docente y que el puntaje
pase por `rubricScoredStrategy`.

### F12 — Cierre (orquestador + 1 revisor final)

- Revisor final sobre el diff completo de la PR (skill `code-review` a nivel alto), enfocado en
  integración entre fases, RLS y consolidación.
- Corregir hallazgos confirmados, CI verde y PR marcada como lista para revisión (no
  mergeada).
- Descripción de la PR (skill `create-pr`): qué se construyó, decisiones de la bitácora, costo
  de IA gastado, línea base del arnés, riesgos conocidos y pasos manuales pendientes
  (activar claves, migrar demo, desplegar).
- Actualizar la memoria del proyecto con el estado final.

---

## 6. Despachos de subagentes (resumen)

| Ola | Fase      | Implementador | Especialista | Revisor |
| --- | --------- | ------------- | ------------ | ------- |
| A   | F0        | —             | —            | —       |
| A   | F1        | 1             | —            | —       |
| B   | F2        | 1             | —            | 1       |
| B   | F3        | 1             | —            | 1       |
| B   | F5a / F5b | 1 (TS)        | 1 (Python)   | —       |
| B   | F6        | 1             | —            | 1       |
| C   | F4        | —             | 1 (OpenAI)   | —       |
| C   | F7        | 2             | —            | 1       |
| C   | F9        | 1             | —            | —       |
| C   | F10a      | 1             | —            | —       |
| D   | F8        | 1             | —            | —       |
| D   | F10b      | 1             | —            | —       |
| D   | F11a      | 1             | —            | 1       |
| E   | F11b      | 1             | —            | —       |
| E   | F12       | —             | —            | 1       |
|     | **Total** | **14**        | **2**        | **6**   |

Los revisores de una ola se despachan al cerrar la ola, sobre el diff integrado de su fase.

## 7. Plantilla de despacho

Todo prompt a un subagente incluye, en este orden:

1. **Objetivo** de la tarea y criterio de término verificable.
2. **Contexto:** fase, rutas del diseño que aplican (por sección), contratos ya fijados por el
   orquestador (con su ruta) y decisiones de la bitácora relevantes.
3. **Archivos** que puede tocar y los que **no** debe tocar.
4. **Reglas del proyecto** resumidas: cero comentarios en `apps/api`, helpers de un solo uso
   como métodos privados, `reportServerError`, constantes de roles en
   `packages/types/src/access-policies/`, colecciones O(N), `withOrgContext` con `tx`, Zod en
   `packages/types`, tuteo neutro en textos (nunca voseo), no importar del barrel de
   `@/components/shared` en tests.
5. **Recursos:** un proceso pesado a la vez, sin `--force`, sin `pnpm format` global, tests
   acotados, sin AWS ni BDD demo, sin APIs de IA reales salvo que se indique.
6. **Git:** commitear en su rama o worktree antes de terminar; no hacer push.
7. **Entrega:** archivos tocados, comandos con su salida real, decisiones tomadas y riesgos.

## 8. Riesgos del plan

| Riesgo                                                                    | Mitigación                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Un subagente rompe la corrección existente al cambiar la comparación (F2) | Tabla de regresión obligatoria y revisor independiente                                             |
| Conflictos con `dev` que avanza en paralelo                               | Merge de `origin/dev` al inicio de cada ola; regenerar migraciones                                 |
| Conflictos entre subagentes de una misma ola                              | Contratos fijados antes de la ola; archivos compartidos y migraciones solo los toca el orquestador |
| Varios agentes corriendo tests a la vez (RAM)                             | Semáforo de procesos pesados y máximo 3 subagentes activos                                         |
| La máquina se queda sin RAM                                               | Semáforo, gates secuenciales al integrar, suites completas en CI                                   |
| El CI tarda o queda en conflicto                                          | Leer `mergeStateStatus` y número de checks; nunca dar por verde "sin checks"                       |
| Gasto de IA fuera de control                                              | Tope de US$5, transcriptor falso en tests, costo en la bitácora                                    |
| Decisiones inconsistentes entre fases                                     | Contratos fijados por el orquestador y bitácora de decisiones                                      |
| PR demasiado grande para revisar                                          | Commits atómicos por fase, bitácora y descripción por fase en la PR                                |
