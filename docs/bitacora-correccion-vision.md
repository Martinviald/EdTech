# Bitácora — Corrección por visión de preguntas abiertas

Registro de la ejecución autónoma del plan `docs/plan-desarrollo-correccion-vision.md`.
Cada entrada: fecha, fase, qué se hizo, decisiones (contexto, opciones, decisión, motivo),
costo de IA y estado de la PR.

## Gasto en APIs de IA

| Fecha      | Fase | Uso                                           | Costo (USD) | Acumulado |
| ---------- | ---- | --------------------------------------------- | ----------- | --------- |
| 2026-10-11 | —    | Experimentos previos al plan (fuera del tope) | 0,35        | 0,00      |
| 2026-10-11 | F3   | Prueba de humo de salida estructurada (2 llamadas) | 0,0005 | 0,0005 |
| 2026-10-11 | F9   | Línea base del arnés y 2 corridas de investigación | 0,1180 | 0,1185 |

Tope del plan: US$5,00.

---

## 2026-10-11 · Ola A · F0 — Preparación

- Worktree `wt-correccion-vision`, rama `feat/correccion-vision` desde `origin/dev` @ `db1b7e62`.
- Documentos traídos: propuesta, diseño, plan y el script de experimentos `apps/api/scripts/probar-vlm-manuscrito.ts`.
- `CLAUDE.md` §8.1: la lectura por visión de respuestas abiertas y la calificación asistida de
  desarrollo pasan a estar dentro de la fase actual (decisión D9).
- Semáforo de procesos pesados en `~/bin/edtech-pesado` (fuera del repo).
- BDD local para gates: PostgreSQL 14 de Homebrew en `/tmp:5432`; cada gate de migración crea una
  base desechable y la borra al terminar.
- `pnpm install` y build de `@soe/types`, `@soe/db` y `@soe/decisions` en el worktree.

**Decisión F0-1 — CI del paquete nuevo.** El CI (`.github/workflows/checks.yml`) tiene un job por
paquete. `@soe/answer-reading` no tendría cobertura en CI si no se agrega. Decisión: agregar un
job `answer-reading` en F2, con el mismo formato que el de `decisions`. Motivo: sin job, sus
tests no corren nunca en CI.

**Aprendizaje F0-2.** Prettier sobre `CLAUDE.md` reformatea todo el archivo (no estaba
formateado). Regla para los subagentes: Prettier solo sobre archivos **nuevos** o sobre archivos
que ya estaban formateados (comprobar con `npx prettier --check` antes); en los demás, editar a
mano sin reformatear.

## 2026-10-11 · Ola A · F1 — Prerrequisitos

- Commits: `7bd2702c` (recortes pendientes, nunca 0), `6982ff69` (`ai_grading_jobs.org_id` + RLS),
  `8553c1f6` (temperatura opcional, uso de tokens en Anthropic, tarifas), `51e3d36d` (observabilidad
  suma `ai_grading_jobs`), migración `0042_ai_grading_jobs_org` con backfill.
- Gate de migración: BDD desechable `cv_gate_f1`, 43 migraciones + 38 tablas con RLS, `org_id` NOT
  NULL y política creada. Base borrada.

**Decisión F1-1 — `feat/items-autocorregibles` no se integra completa.** La rama tiene 8 commits
(scripts contra demo, re-puntuador, cambio de UI) y su único commit relevante (`76538c37`,
comparadores `ordered_tuple`/`sequence`) choca con `6b430f68` de `dev`, que ya implementó
`sequence` (y cubre pares ordenados como secuencia). Opciones: fusionar las dos implementaciones o
dejarlo. Decisión: no integrar; `ordered_tuple` con crédito por componente se implementa en F2 sobre
la comparación por estructura canónica, usando `76538c37` como referencia. Motivo: F2 reescribe el
comparador y fusionar ahora sería trabajo perdido; el resto de la rama está fuera del alcance.

**Decisión F1-2 — Pendiente por recorte.** Un ítem leído por recorte queda pendiente con la misma
forma que `open_ended` (`isCorrect`/`rawScore`/`finalScore` null, `scoredBy: 'human'`) y
`value = { answer: null, pendingReading: true }`. Si un ítem compuesto tiene una sub-etiqueta por
recorte, el ítem entero queda pendiente. F7 reemplaza esto por la decisión de lectura real.

**Contratos de F2 (orquestador).** Commit `05deb3e6`: `packages/types/src/schemas/answer-reading/`.
Semánticas fijadas para todos los subagentes:
- Indecidible ≠ incorrecto: lo que no se decide va a revisión con `final_score` null, nunca 0.
- La comparación es por estructura canónica (`canonical` + `value` racional exacto); `canonical`
  null = no se pudo interpretar → `unparsed_format` (modo corrección).
- Dos lectores "coinciden" si su `canonical` es igual (política inicial `agreeOn: 'canonical'`).
- Modo de revisión por motivo en `REVIEW_MODE_BY_REASON`; si hay motivos de ambos modos, primero
  lectura.
- Política por defecto `DEFAULT_CONSENSUS_POLICY` (D5) y ajustes por org
  `DEFAULT_ORG_ANSWER_READING_SETTINGS` (D3, D7).
- El campo `response` del `LayoutSpec` (`omrFieldResponseSchema`) se conecta a `omrFieldSchema` en
  F5b.

## 2026-10-11 · Cierre de la ola A

- CI de la PR #296 verde: 6/6 checks, `mergeStateStatus: CLEAN`.

## 2026-10-11 · Ola B · tanda 1 (F2 núcleo, F3 capa LLM y catálogo, F6 modelo de datos)

- Worktrees `wt-cv-f2`, `wt-cv-f3`, `wt-cv-f6` desde `feat/correccion-vision` @ `68913424`.
- El `.env` (ignorado por git) se copia a mano a los worktrees que hacen llamadas reales (F3).

**Decisión F2-1 — Dónde viven los parsers canónicos.** El diseño (§5.5) decía que
`matchesAcceptedAnswer` reutiliza "los parsers de `@soe/answer-reading`". Pero `@soe/answer-reading`
depende de `@soe/types`, así que `@soe/types` no puede importarlos sin crear un ciclo. Decisión:
los parsers a estructura canónica viven en `packages/types/src/utils/answer-canonical.ts` (puros) y
el paquete nuevo los importa. Motivo: es la única ubicación sin ciclo y la corrección por CSV y la
lectura por visión comparten exactamente el mismo código.

**Decisión F3-1 — Catálogo de modelos.** Tabla global `llm_models` sin `org_id` ni RLS (no tiene
datos de colegios); escribe solo `platform_admin` vía API. Los precios en código quedan solo como
fallback para modelos que no estén en la tabla (costos históricos).

### F6 integrada (`1f217ce0`, `7bd7e14f`, migración `0043_answer_reading`)

- 6 tablas con RLS forzado (44 tablas con aislamiento en total). `answer_readings` es inmutable a
  nivel de BDD (solo políticas SELECT e INSERT). `reading_routes` usa dos políticas (patrón
  `test_tracks`): la API no puede escribir rutas globales; se siembran con el rol admin.
- **Para F7:** `answer_reading_decisions.superseded_by_id` no tiene FK. Reemplazar una decisión =
  generar el id nuevo en la app y, en una transacción, actualizar la vieja e insertar la nueva.
- **Hallazgo fuera de alcance:** la política de `decision_settings` permite a cualquier org borrar
  filas globales (mismo defecto que se evitó en `reading_routes`). No se cambia en esta PR; se
  reporta en la descripción final.

### F3 integrada (`d81eab99`…`440fab7d`, migración `0044_llm_models` con seed de 11 modelos)

- `completeStructured` multimodal en Anthropic y Gemini; `@google/genai` 2.28.0.
- **Semántica de `usage` (compartida):** `inputTokens` = toda la entrada (incluye caché);
  `outputTokens` = toda la salida facturable (incluye razonamiento); `reasoningTokens` y
  `cachedInputTokens` son subconjuntos. Anthropic reporta `reasoningTokens: 0`.
- Si la salida no es JSON válido, `data` es `null` (no lanza): F7 valida con Zod y registra
  `invalid_output`.
- **Decisión F3-2 — versión del SDK de Gemini.** 2.28.0 se publicó 4 días antes; alternativa:
  fijar 2.24.0 (más de dos semanas). Decisión: mantener 2.28.0 porque la prueba de humo real pasó
  y es la que soporta `thinkingLevel`/`responseJsonSchema` sin trabas; se anota como riesgo.
- Humo real: Haiku 5.5 leyó "2,5" (616 tokens de entrada, US$0,00007); Gemini 3.5 Flash-Lite leyó
  "2,5" (1124 tokens, 1080 de imagen, US$0,00038).

### Ola B · tanda 2 e integración (F2, F5a, F5b)

- F5a integrada (`492591b8`, `d76188c6`): perfiles de recorte, `inkRatio` descontando casillas,
  evidencia `crop` en el contrato v2. Sin perfil, el recorte es idéntico byte a byte al histórico.
- F2 integrada (`6c44409f`…`18c8111e`): `answer-canonical.ts`, `matchesAcceptedAnswer` canónico,
  paquete `@soe/answer-reading`, job de CI `answer-reading` (`9fd5a691`). Lockfile resuelto
  tomando el de la rama y regenerando con `pnpm install`.
- F5b integrada (`c042ecdf`…`7e673a41`): `resolveResponseFormat` en `packages/types`, campo
  `response` en el `LayoutSpec` (hash de layouts existentes verificado sin cambios), casillas de
  9 mm (mínimo 8 mm), invariante 8. Hoja de prueba revisada visualmente por el orquestador.
- Gates de integración: pytest 303 ok; `@soe/types` 868 ok; `@soe/answer-reading` 99 ok; api
  typecheck ok; jest api acotado 571 ok.

**Revisión de F6 (independiente).** Sin fugas entre colegios; backfill de 0042 confirmado con
datos y fallo seguro con huérfanos. Bloqueantes corregidos en `31bff2e4` + migración
`0045_answer_reading_evidence`: (1) decisiones y revisiones ya no se pueden borrar desde la API;
(2) borrar una marca ya no arrastra la evidencia en cascada; (3) `answerReading` corrupto ya no
invalida el resto de `orgConfig` (habilitaba features pagas y quitaba el tope de IA). Mejora
agregada: índice de cola por evaluación. Quedan como mejoras no bloqueantes: FK compuesta
`(org_id, mark_id)`, CHECK en columnas de texto tipadas, scripts de recarga DIA que borran
`responses`/`assessments` fallarán por FK cuando existan decisiones (protege la evidencia).

**Revisión de F2 (independiente).** Sin regresión de correcta→incorrecta en números, fracciones y
pares por CSV. Hallazgos bloqueantes en la lectura (blank autoaceptado pese a `reviewRequested`,
`issues` del normalizador ignoradas, desempate que salta restricciones de proveedor) y una
regresión real en secuencias con letras. Se despachó un agente de corrección (`wip/cv-f2fix`).

**Decisión B-1 — casilla de signo.** La hoja imprime la casilla de signo sin rótulo. Se deja así
en esta PR (la hoja oficial DIA tampoco la rotula) y se anota para la UX de la hoja.

**Revisión de F3 (independiente).** Sin bloqueantes; permisos correctos y costo sin doble conteo.
Recomendaciones que se encargaron a `wip/cv-f3fix`: columna `supports_sampling_params` en
`llm_models` (Claude 4.x vuelve a recibir `temperature: 0`), `thoughtSignature` de Gemini 3 en el
asistente, exigir salida estructurada al guardar las features que la usan, catálogo resiliente ante
caída de la BDD, presupuesto de razonamiento de Gemini 2.5 acotado, `maxRetries: 1` en Anthropic
estructurado, uso de tokens del asistente con Gemini (bug previo: sumaba acumulados) y modelos
deshabilitados que dejan de usarse en ejecución.

### F4 integrada (`afe64ab8`…`181cc497` → rama, migración `0046_llm_models_openai`)

- `openai@6.49.0` fijo: la línea 7.x exige Node ≥ 22 y el Dockerfile y el CI usan Node 20.
- Responses API con `store: false`; salida estructurada `json_schema` estricta (el provider adapta
  opcionales a `anyOf [T, null]` y los limpia al parsear); escalera de razonamiento
  `none → minimal → low → sin reasoning` ante 400, recordada por modelo.
- Modelos `gpt-6-luna`, `gpt-5.6-luna`, `gpt-5.4-mini` sembrados y habilitados; ninguna feature los
  usa por defecto. El panel muestra "OpenAI (no configurado)" sin clave.
- **Privacidad:** el Batch API de OpenAI no es compatible con cero retención de datos (ZDR); no usar
  batch de OpenAI con datos de estudiantes si el contrato exige cero retención.

### Cierre de la ola B

- Corrección de F2 integrada (`b864ee45`…`f0a3cdf2` → rama): los 14 hallazgos con test previo.
  Diferencial contra la versión previa a F2: 0 casos de correcta→incorrecta; 10 correcta→revisión
  (miles/decimal ambiguo sin formato que lo resuelva). Regla final de ambigüedad en el JSDoc de
  `compareCanonical` (formato → otra clave → misma escritura). `readingKey` obligatorio en el
  consenso; blancos pasan por petición de revisión, confianza y auditoría.
- Corrección de F3 integrada (8 commits) + migración `0047_llm_models_sampling`: Claude 4.x vuelve a
  recibir `temperature: 0`; los modelos sin muestreo (Claude 5.5 y OpenAI) no la reciben; firma de
  pensamiento de Gemini 3 en el asistente; costo del asistente con Gemini corregido (antes sumaba
  acumulados: US$2,10 → US$1,55 en el caso de prueba); `LlmModelUnavailableError` para el pipeline.
- Gates: `@soe/types` 892, `@soe/answer-reading` 112, jest de llm y asistente 211, typecheck api ok.

## Ola C (F4 ya integrada; F7, F9, F10a)

- F7-A (pipeline) y F10a (normalizadores) despachados sobre la rama con F2 corregida; F9 (arnés)
  despachado tras la corrección de F3, con tope de US$0,50 para la línea base real.

### F10a integrada (`c4343e8e`…`fd576292` → rama, + `c787da6e`)

- `word_list`, `short_text`, `multi_box` (crédito por casilla en `gap_fill` solo con
  `componentCredit`/`partialCredit`), formatos de rúbrica `free_text`/`math_work` que el consenso
  nunca autoacepta (`rubric_item`), prompts `transcribe.short-text@1` y `transcribe.free-text@1`.
- Pares DIA reales: II° P12 `[2#4]` vs `(2,-4)` con `componentCredit` → 1 de 2; 7° P18 `[3#7]`
  vs `(7;3)` → 0.
- **Para F7-B y F10b:** al corregir, el ítem debe llevar el formato derivado
  (`resolveResponseFormat`), o `word_list`/`short_text` se comparan como texto plano y una
  diferencia queda incorrecta en vez de ir a revisión.

### F7-A integrada (7 commits + migración `0048`: `crop_evidence` y ruta global por defecto)

- Módulo `apps/api/src/answer-reading/`: puerto `VisionTranscriber` + `LlmVisionTranscriber`,
  `ReadingRoutesService`, `AnswerReadingPipelineService` (un job por lote; 4 recortes en paralelo
  por hoja; idempotencia por `reading_key`; interruptores `enabled`/`allowExternalVision`;
  presupuesto contra `aiBudgetUsd` y `monthlyBudgetUsd`; tope `ANSWER_READING_MAX_CROPS_PER_RUN`).
- Motivos nuevos: `reading_disabled`, `budget_exceeded`, `run_limit_exceeded`, `crop_unavailable`.
- `ConcurrencyLimiter` movido a `apps/api/src/common/concurrency/`.
- CI: el job de API construye `@soe/answer-reading`; el Dockerfile ya lo incluía.
- Riesgos anotados: dos lotes con la misma imagen en paralelo pueden chocar en el único de
  `answer_readings` (queda en revisión); un reproceso suma de nuevo `crops_total`.

### F9 integrada (`e33ea625`, `49036547` → rama, + `e06618f2`, `245f227c`, `585fa68f`)

- Comando `answer-reading:eval` con el mismo código que producción (`packages/answer-reading/src/eval/`
  + `apps/api/scripts/answer-reading-eval.ts`); `--dry-run` con fixtures sintéticos en el repo; el
  dataset de los 23 recortes queda fuera del repo con su `manifest.json`.
- **Línea base real** (ruta por defecto, 17 de 23 recortes; las 6 expresiones algebraicas quedaron
  fuera porque se corrió antes de F10a): precisión de lo autoaceptado 100 % (3/3), autoaceptación
  17,6 %, acuerdo entre lectores 53 % y 100 % de exactitud cuando coinciden, sobrecorrección 0 %,
  US$0,0013 por recorte. Haiku 64,7 % y Gemini 73,3 % (2 timeouts por un corte de red).
- **Decisión C-1 — la ruta del arnés y la de producción deben ser idénticas.** El arnés usaba
  `hints: format` y la ruta sembrada `hints: none`. Se alinea a `none`: además, sin la pista Haiku
  subió de 70,6 % a 79,4 % en la corrida de investigación (señal con 17 muestras, no prueba).
- **Decisión C-2 — `minConfidence` se mantiene en 0,85.** Explica la autoaceptación baja (el prompt
  v2 pide confianza ≤ 0,7 cuando hay una alternativa plausible). Opciones: bajarla a ~0,6 para
  acercar la autoaceptación al acuerdo entre lectores (53 %), o mantenerla. Decisión: mantenerla
  hasta calibrar con hojas reales y la auditoría muestral, porque la meta es la precisión de lo
  autoaceptado (≥ 99,5 %) y 17 fotos de un adulto no alcanzan para relajar un umbral.
- **Aprendizaje C-3.** Hice un commit antes de ver los tests en verde (`245f227c`) y quedó un test
  rojo que corregí en `585fa68f`. Regla para el orquestador: leer la salida antes de commitear.

### F7-B y F8-UI integradas; contrato de revisión fijado

- F7-B (`72c9c3d8`…`cc7fc9b3` → rama): consolidación §10.2 al confirmar y tardía;
  `recalculateAnswerSheetResults` (recálculo sin usuario JWT).
- Contrato de la API de revisión (`3f21447c`, ajustado en `172d7572` tras la UI): `responseFormat` en
  grupo y detalle, `reviewed`/`total` en el resumen, deshacer por lote, semántica de `accept` con y
  sin `editedLiteral`. **`total`** = decisiones del alcance que fueron o van a revisión humana
  (revisadas + pendientes), sin autoaceptadas ni en lectura.
- F8-UI (`ccb5a0ed`…`2a7f1e43`, `d3088ef4` → rama): paso "Respuestas escritas" en el asistente del
  lote y pestaña en el hub de la evaluación, cola por grupos en dos modos, teclado, `Kbd` compartido.

**Revisión de F7 (independiente).** Sin fuga entre orgs ni datos del alumno al proveedor; SQL por
lote verificado en PG14 con RLS. **Tres bloqueantes de nota incorrecta**, a corregir apenas
terminen F8-API y F11a (tocan los mismos archivos):
- B1: `CropReadingService.scoreOf` corrige sin el formato derivado y la consolidación sí → la
  decisión dice "incorrecta" y la respuesta queda "correcta" (o se salta "alternativa que cambia el
  resultado"). Arreglo: una sola función compartida que inyecta el formato derivado.
- B2: el upsert de la ingesta deja que un `auto_blank` pise una respuesta con `human_score`.
- B3: una fila pendiente re-ingerida sobre una respuesta revisada deja `is_correct`/`value` en null y
  la saca del puntaje para siempre.
Alta prioridad: la lectura tardía puede escribir en la respuesta de otra hoja (búsqueda por alumno
+ evaluación + ítem sin verificar la hoja); `DevelopmentGradingService` sigue procesando todos los
recortes (pisa el `ai_score` de las respuestas cortas, paga doble e ignora `enabled` y
`allowExternalVision`). Robustez: el job en memoria pierde la cola si la API se reinicia (sin 0,
pero sin decisión); el costo de una llamada que choca en el único de `answer_readings` no se
registra.

### F8-API integrada (`998af6fe`, `ce7c0757` → rama)

- Controller con las 5 rutas del contrato (`SHEET_REVIEW_ROLES`), servicios de cola y revisiones.
- **Revisión antes de confirmar:** cada revisión guarda su `resulting_value`; al confirmar, después
  de vincular respuestas, `applyRecordedReviews` reaplica la última revisión vigente. Un solo camino
  para la aplicación inmediata y la diferida.
- **`human_score` ajeno:** si la respuesta tiene un `human_score` que no escribió esta decisión, no
  se pisa y se informa en `skippedHumanScored`.
- `undo` crea filas nuevas (`superseded_by_id`), marca `deleted_at` en sus muestras del dataset y
  devuelve la respuesta a pendiente o a la corrección automática; nunca a 0.
- Dataset: todas las revisiones de modo lectura; de modo corrección solo `mark_correct` con
  `unparsed_format` (`needs_normalizer_case`). Reparto 70/15/15 fijo por hash.
- Riesgos que pasan a `wip/cv-f7fix`: revisión huérfana al reprocesar una decisión revisada;
  `inProgress` eterno para recortes que el pipeline saltó.

### Ola D en curso

- `wip/cv-f7fix`: bloqueantes B1–B3 de la revisión de F7 + lectura tardía en otra hoja + revisión
  huérfana + `inProgress` eterno + costo perdido en choque + cola en memoria perdida al reiniciar.
- `wip/cv-f11a`: transcripción de desarrollo y `RubricGradingService`; se le agregó el arreglo de
  `DevelopmentGradingService` (solo ítems de rúbrica, respeta `enabled`/`allowExternalVision`, nunca
  pisa un `ai_score` con `decisionId`).
- `wip/cv-f10b`: layout de `word_list`/`short_text`/`multi_box`, burbujas de pareados, secuencias y
  puntaje docente, sin tocar `apps/api/src/answer-reading/`.

### F11a integrada (`58034e42`…`303acb19`) y migración 0049

- Transcripción de desarrollo en el pipeline (`free_text`/`math_work`), siempre `needs_review` con
  `rubric_item`. `RubricGradingService` propone el nivel con `grade.rubric@1` solo si la org tiene
  `rubricAssistEnabled`; escribe únicamente `ai_score` (nivel, confianza, justificación, citas) y el
  puntaje sale de `rubricScoredStrategy`, nunca del número del modelo. `approveRubricLevel` aplica
  una resolución humana nueva `kind: 'rubric'`.
- Ajuste `rubricEngine: 'legacy' | 'rubric_grading'` (default legacy). `DevelopmentGradingService`
  queda acotado a ítems de rúbrica, respeta `enabled`/`allowExternalVision` y nunca pisa un
  `ai_score` con `decisionId` (hallazgo de la revisión de F7).
- **Mezcla con F8-API:** `visionResponsesByField` recibe la lista de formatos y usa por defecto
  todos los de visión (respuesta corta + texto + desarrollo); la rama "sin respuesta" de la
  consolidación excluye explícitamente `rubric` (si no, la resolución nueva caía en la tabla de
  ilegible/blanco/tachado y fallaba).
- **0049:** rutas globales `format` para `word_list`, `short_text` y `multi_box`
  (`transcribe.short-text@1`, Haiku + Gemini, misma política que la por defecto) y para `free_text`
  y `math_work` (`transcribe.free-text@1`, un lector, `minReaders 1`, sin autoaceptación ni
  auditoría). `hints: none` por la decisión C-1. Verificada en PG14 desechable.
- El agente se detuvo antes de entregar su informe por el límite de uso: la prueba real autorizada
  de `grade.rubric@1` (tope US$0,05) no quedó registrada; se cuenta el tope en el gasto.
  Gasto acumulado: ≤ US$0,17.

### F10b (rama `wip/cv-f10b`, sin integrar)

- **Burbujas por fila (`bubble_choice`):** se derivan por TIPO (`matching`, `ordering`, como ya
  hacía `resolveResponseFormat`) o si el ítem lo declara (`short_answer` con clave de secuencia).
  Un grupo de burbujas por término (pareado) o por posición (orden/secuencia), en la grilla de
  burbujas, con número impreso `<n>.<subclave>` (`16.A1`, `17.3`). La subclave sale de la
  etiqueta del término (o su ordinal) y el layout verifica contra `resolveScanLabel` que la fila
  vuelva a su ítem: si choca con otro número impreso, el ítem se excluye con motivo. Valor de
  cada burbuja: etiqueta corta de la opción (≤ 2 caracteres), si no el id corto, si no letras
  A, B, C…; la ingesta (`toScoringAnswer`) traduce el valor al id (id exacto primero, así las
  ingestas CSV previas no cambian). Máximo 6 opciones por fila.
- **Puntaje docente (`score_bubbles`):** solo si el ítem `rubric_scored` lo declara; los de
  rúbrica sin declaración siguen en `free_text`. Fila de burbujas por nivel en el área de
  respuestas escritas, `fieldId` con sufijo `_puntaje` (así la hoja imprime "Puntaje (lo marca el
  docente)" sin datos fuera del spec); el valor es el código del nivel y va directo a
  `rubricScoredStrategy`. Los niveles deben existir en la rúbrica del ítem.
- **`multi_box` con signos:** campo opcional `operatorBefore` por casilla (`+ - × ÷ = < >`, contrato
  de `response-format.schema.ts`). Con algún signo, las casillas van en fila con rótulo a la
  izquierda y el signo entre casillas, siempre fuera; sin signos, la geometría es la de F5b
  (hash sin cambios). La hoja achica o recorta un rótulo que no cabe antes de su casilla.
- **Riesgo anotado:** los glifos impresos dentro de la región (rótulos, signos, paréntesis,
  unidad) cuentan como tinta en el `inkRatio` total del OMR (`ink.py` solo descuenta los
  bordes de las casillas); `inkRatioByPart` no se ve afectado.

### F10b integrada y `transcribe.short-text@2`

- F10b (`10a2b1fa`…`7b0c4b4f` → rama): signos de operación entre casillas de `multi_box`
  (`operatorBefore`, opcional en el contrato), burbujas por fila para pareados y ordenamiento
  (`16.A1`, `17.3`), fila de puntaje docente para `score_bubbles`. Hoja revisada en PNG por el
  orquestador. Riesgos que quedan: rótulos y signos cuentan como tinta en el `inkRatio` global del
  campo (no en el de cada casilla; ya pasaba en F5b), y los borradores nuevos de instrumentos con
  pareados u ordenamiento cambian porque esos ítems antes quedaban excluidos.
- **`transcribe.short-text@2`**: la v1 pedía ignorar los rótulos pero no los signos que ahora se
  imprimen entre casillas. La v2 los nombra. La 0049 (sin aplicar fuera de bases desechables) se
  editó para sembrar la v2; los hashes de la v1 en el lock no cambiaron.
- CI de `df015d82` 7/7 verde tras corregir el test de fixtures del arnés (comparaba PNG byte a
  byte; zlib comprime distinto en macOS y Linux, ahora compara píxeles).

### Corrección de la revisión de F7 integrada (`e6c901be`…`7f12c593` → rama)

Cada hallazgo con test previo que fallaba con el código viejo; B2/B3, la lectura tardía y el choque
de costo también probados en PG14 con `soe_app` (sin BYPASSRLS).
- **B1:** una sola función de corrección con el formato derivado (`answer-reading-scoring.helpers.ts`)
  para consenso, consolidación y cola. Una decisión `auto_accepted` que la consolidación no puede
  decidir se reemplaza por `needs_review` con motivo `undecidable`.
- **B2/B3:** si la respuesta tiene `human_score` o se conserva su `final_score`, el upsert de la
  ingesta no toca `value`, `is_correct`, `raw_score`, `final_score`, `scored_by` ni `scored_at`;
  solo actualiza `ai_score`.
- **Lectura tardía:** al confirmar, cada marca de recorte reserva su respuesta escribiendo
  `value.reading.markId`; una decisión sin vínculo solo consolida en la respuesta con su marca.
  Las decisiones de escaneos `superseded` se descartan en toda consolidación. Contrato interno:
  `ConfirmedReadingsInput.cropMarks: { markId, studentId, itemId }[]`.
- **Revisión huérfana:** al reemplazar una decisión, la nueva copia la revisión vigente.
- **"En lectura" eterno:** el pipeline deja `not_read`/`reader_failed` para todo recorte que no
  decide; la cola solo cuenta "en lectura" con una corrida `running`.
- **Costo en choque:** `ON CONFLICT DO NOTHING`; la lectura pagada se guarda como intento siguiente.
- **Reinicio:** `resumeStalledRuns()` en `onModuleInit` reencola sin duplicar y cierra las corridas
  sin pendientes.
- **Formatos de texto:** el pipeline lee `word_list`, `short_text` y `multi_box` con su ruta de 0049.

Riesgos que quedan: las respuestas confirmadas antes de este arreglo no tienen reserva `markId`, así
que una lectura tardía sobre ellas queda sin consolidar (más seguro que escribir en otra hoja); con
varias instancias de la API, cada una reanuda las mismas corridas al arrancar (lecturas repetidas,
costo registrado, decisiones idempotentes).

### F11b integrada (`3269ccc0`…`3df126fa` → rama)

- Contrato `rubric-review.schema.ts`; rutas `GET /answer-reading/rubric-queue`,
  `GET /answer-reading/rubric-queue/:decisionId`, `POST /answer-reading/rubric-approvals` y
  `POST /answer-reading/rubric-approvals/accept-proposals` (`SHEET_REVIEW_ROLES`, corrección ciega).
- La aprobación exige el lote confirmado (409 si la decisión no tiene respuesta), no pisa un
  `human_score` ajeno y queda en `answer_reviews` (modo `grading`, `mark_correct` si el nivel da
  puntaje completo, `mark_incorrect` si no, nivel en `edited_literal`): el historial y el deshacer
  de F8 la ven.
- Panel web de rúbrica: teclas 0–9 eligen nivel, Enter aprueba, A aprueba la propuesta, U deshace;
  las citas de la IA se resaltan en la transcripción. Nunca se aprueba sin acción explícita.
- **Decisión:** la aprobación por lote es "aceptar la propuesta de cada respuesta", nunca un nivel
  común. La UI no la ofrece todavía: el diseño §11.3 la condiciona a la medición de acuerdo por
  ítem (QWK ≥ 0,80), que no existe aún.
- **Arreglo del orquestador:** `resolutionOfReview` traducía `mark_*` a una corrección sin puntaje;
  reaplicar una aprobación de nivel parcial (al reconfirmar) daba puntaje completo o 0. Ahora, si el
  ítem es de rúbrica y la revisión trae el nivel, se recalcula con `rubricScoredStrategy`. Test que
  fallaba antes del arreglo.
- Riesgos que quedan: la aprobación y su fila en `answer_reviews` van en transacciones separadas
  (si falla el insert queda el `human_score` sin historial); lógica duplicada con la cola de F8
  (alcance por lote, URLs de recortes).

### F12 — revisión final (dos revisores independientes)

**Backend y BD: sin bloqueantes.** 0042–0049 aplican limpio sobre `dev` y `drizzle-kit check` pasa;
backfill de 0042 sin huérfanos; RLS probado como `soe_app` con dos orgs (0 filas sin contexto,
inserts cruzados fallan, `answer_readings` inmutable, decisiones y revisiones no se borran, rutas
globales de solo lectura); ningún dato del alumno al proveedor; `store: false` en OpenAI; la IA de
rúbrica solo escribe `ai_score`.

**Contratos, web y OMR: un bloqueante condicional.** Diferencial `dev` vs rama sobre 212.916
combinaciones de `short_answer`: ninguna regresión de correcta a incorrecta salvo el caso artificial
de `x=3` en modo secuencia contra `−3` (ahora correcto: es −3 ≠ 3); 84 pasan de correcta a revisión
por la ambigüedad miles/decimal ya conocida (nunca a 0); 388 pasan de incorrecta a correcta (por
ejemplo `(5,6)` acepta `5,6`, `2 1/2` acepta `2,5`, `−3` acepta `-3`). Modo lectura sin clave,
corrección ciega, aprobación explícita, sin voseo. OMR: 282 tests en verde.

**Corregido por el orquestador:**
- **Bloqueante `gap_fill`:** el importador guarda `partialCredit: true` en todo `gap_fill` y la
  estrategia nueva lo leía como pesos iguales; al recorregir, ítems todo-o-nada daban crédito
  parcial. Ahora el crédito por casilla exige `componentCredit` explícito (D6), con pesos del mismo
  largo que las casillas, e `isDichotomousItem` cuadra con la estrategia.
- **M1:** un blanco se autoaceptaba sin mirar `autoAcceptOutcomes` (con una política "solo
  correctas", dos blancos daban 0 automático). Ahora pasa por el mismo filtro; un blanco indecidible
  va a revisión.

**En `wip/cv-f12fix`:** lectura vieja escrita en una respuesta reasignada a otra hoja (M2), chequeo
de `human_score` ajeno dentro de la transacción de escritura (M3), presupuesto mensual que sume la
rúbrica y tope 0 con `orgConfig` inválido (M4), `allowedProviders` en el servicio viejo (M5),
política de muestras sin DELETE (M6), comentarios nuevos en `apps/api/src/llm` (M7) y test de
contrato del modo lectura.

**Para el deploy (no se corrige en código):** el backfill de 0042 necesita el rol de migración con
BYPASSRLS (`DATABASE_ADMIN_URL`); con un rol sin él aborta de forma segura. `llm_models` no tiene RLS
(decisión F3-1): su protección es solo la API (`LLM_MODELS_ADMIN_ROLES`).

### Corrección de la revisión final (F12) (`wip/cv-f12fix`)

Cada defecto de comportamiento con test previo que fallaba con el código anterior.
- **M2 — respuesta reclamada por otra hoja:** toda consolidación (automática, revisión
  registrada, resolución humana y deshacer) solo escribe en la respuesta si su dueña es la marca
  de la decisión (las decisiones de una cadena `superseded_by_id` comparten marca). Si no, se
  salta con el motivo nuevo `response_reclaimed` y la decisión queda sin consolidar. Toda
  escritura conserva `value.reading.markId` (antes la consolidación lo borraba).
- **Decisión F12-1 — respuestas sin reserva (confirmadas antes de F7):** la dueña es
  `value.reading.markId`; si falta, la marca de la decisión que la escribió
  (`value.reading.decisionId`); si tampoco hay, solo se escribe cuando ninguna decisión de otra
  marca está vinculada a la respuesta. Así una respuesta vieja vinculada a dos hojas no la escribe
  ninguna (queda para revisión manual), y una vinculada a una sola hoja sigue funcionando.
- **M3 — `human_score` ajeno:** la consolidación bloquea las respuestas con
  `SELECT ... FOR UPDATE` (en orden de id, para no generar interbloqueos) y
  `applyHumanResolutions` repite el chequeo dentro de esa transacción (`human_scored`).
- **M5:** `isProviderAllowedByOrg` en `@soe/answer-reading`, compartido por
  `applyOrgRestrictions`, `RubricGradingService` y `DevelopmentGradingService`. Si el proveedor de
  `ai_grading` no está permitido, la corrección de desarrollo deja los jobs `skipped`
  (`provider_not_allowed`) y las respuestas pendientes; un job omitido no bloquea un reintento.
- **M4:** `monthlyBudgetUsd` suma `answer_readings` y los `ai_grading_jobs` de tipo
  `rubric_level`; la calificación estima con su propio costo medio. `aiBudgetUsd` sigue saliendo de
  `AiObservabilityService` (que ya suma ambas tablas). Un `orgConfig` que no valida deja el tope de
  IA en 0.
- **M6:** `answer_reading_samples` con políticas SELECT/INSERT/UPDATE, sin DELETE. Verificado en
  PG14 desechable con un rol sin BYPASSRLS: con la política vieja el DELETE borraba la fila; tras
  re-aplicar `rls-policies.sql`, DELETE 0 y el resto sigue funcionando.
- **M7:** sin comentarios agregados por la PR en `apps/api/src`.
- Test de contrato del modo lectura en la cola y el detalle, con control positivo en corrección.

Riesgos que quedan: `response_reclaimed` no tiene campo propio en `SubmitReviewResult` (no cae en
`skippedHumanScored` ni en `pendingConsolidation`); el costo de la corrección de desarrollo
heredada (`development_crop`) no cuenta para `monthlyBudgetUsd`.

### Fotos reales: correcciones de la lectura (rama `fix/vision-fotos-reales`)

Evidencia: 30 casillas de 6 fotos de celular (`pruebas-vlm-manuscrito/hojas-sinteticas/resultado-fotos/`).

- **Contrato OMR desactualizado.** `services/omr/contracts/*.json` no traía `operatorBefore`
  (F10b) y el servicio respondía 422 al lote entero. Se regeneró y el test
  `packages/types/scripts/omr-contracts.spec.ts` compara los contratos generados en memoria con los
  versionados (corre con `pnpm --filter @soe/types test`, en local y en CI).
- **Decisión FR-1 — en los formatos con partes, las partes mandan.** Los lectores devolvían `parts`
  correctas con un `literal` incompleto (solo la 1.ª casilla, solo el total), sin separador
  (`triángulo cuadrilátero`), con los signos impresos (`40 + 7 = 47`) o contaminado con la pregunta
  vecina (`productos`), y el normalizador interpretaba el `literal`. Ahora, si el formato pide
  `parts` y vienen **completas y válidas** (ninguna vacía, todas interpretables con su tipo), el
  valor canónico sale de ellas y el `literal` queda como control:
  - mismo valor → sin issue;
  - el `literal` está vacío o sus palabras/números son una subsecuencia, en orden, de las de las
    partes (sin tildes ni mayúsculas, ignorando signos y separadores) → issue nuevo
    `literal_subset_of_parts`, que **no** fuerza revisión;
  - el `literal` trae algo que las partes no dicen o en otro orden (`productos`, `(7;3)` con partes
    `3, 7`, `triangulo isoseles cuadrado` con partes `triangulo, cuadrado`) →
    `parts_disagree_with_literal`, que sigue forzando revisión de lectura (`format_mismatch`).
  Con alguna parte vacía o no interpretable se interpreta el `literal` como antes y la parte vacía
  sigue siendo `empty_part` (nunca 0 automático). Motivo: el `literal` libre es lo que más se
  contamina con el recorte y con la forma de escribir; las partes vienen de un esquema por casilla.
  Una contradicción es justamente lo dudoso que el diseño §8 no deja autoaceptar. Cambio de
  contrato: `NORMALIZATION_ISSUES` suma `literal_subset_of_parts` (solo amplía el enum).
- **Decisión FR-3 — margen del recorte proporcional al lado menor, con tope por vecinos.**
  `short-answer@1` sumaba el 15 % del lado MAYOR de la región en los cuatro lados: en un renglón
  ancho (P8) o en casillas con signos (P9) el recorte traía completas P7 y P9, y los dos lectores
  transcribieron P7 como respuesta de P8. Perfiles nuevos `short-answer@2` (30 % del lado menor) y
  `free-text@2` (10 % del lado menor), ambos con `neighborGapFraction: 0.5`: en cada lado el margen
  no pasa de la mitad de la distancia al campo vecino más cercano de ese lado. El perfil suma dos
  claves explícitas (`bleedBasis`, `neighborGapFraction`; en los v1, `longer_side` y `null`, sin
  cambio de comportamiento). `cropBleedBox` en `crop.schema.ts` es la referencia que debe replicar
  `services/omr/app/crop.py`. Los layouts nuevos piden los v2 (el hash de los layouts derivados
  cambia solo por el id del perfil, verificado en el test); los congelados conservan su v1.
  **Bloqueante de despliegue:** mientras el OMR no conozca los v2, `resolve_crop_profile` cae al
  recorte heredado (sin margen, 600 px) en silencio, y `test_crop_profiles_contract.py` falla.
- **Decisión FR-2 — guía de formato (`hints: format`) en las rutas de varias partes y de texto.**
  Contexto: C-1 dejó `hints: none` midiendo solo números de una casilla; sin la guía, Haiku leyó
  solo la primera casilla de la secuencia en 3 de 3 hojas. Con `format`, `transcriptionVariables`
  agrega `formatLabel` y `formatGuide` (que nombra las partes `e1…`, `c1…`, `w1…` o los rótulos de
  las casillas), nunca la clave. Decisión: migración de datos (pendiente de numerar, SQL en el
  informe de la rama) que retira las rutas `word_list`, `short_text` y `multi_box` de la 0049 y
  crea sus v2 (`…09`, `…0a`, `…0b`, `supersedes_id` a la v1) con `hints: format`, y crea rutas
  `format` para `sequence` (`…07`) y `ordered_tuple` (`…08`) con los lectores y la política de la
  ruta por defecto. La ruta por defecto (números de una casilla) sigue en `none`. Cada ruta se
  validó con `readingRouteSchema` y renderizando su prompt; el SQL se aplicó dos veces sobre una
  base PG14 desechable con 0000–0049 (idempotente). `fraction` queda en la ruta por defecto: sus
  partes ya venían bien en las fotos.

### Primera prueba con fotos reales y su corrección (`fix/vision-fotos-reales`)

**Prueba** (base local `soe_vision`, instrumento sintético de 11 preguntas, 3 alumnos, 6 fotos de
celular de 2268×4032 sin encuadrar, Haiku 5.5 + Gemini 3.5 Flash-Lite, US$0,035 por corrida).
Antes del arreglo el OMR rechazaba las 6 fotos (5 por `cropped`, Celeste p1 por `likely_blank` con
la B marcada) y el contrato del OMR respondía 422 ante `operatorBefore`; para medir hubo que
encuadrar a mano y quitar los signos.

**Corregido** (cada falla con test previo que fallaba):
- Contrato OMR regenerado + test que falla si queda desactualizado.
- Normalización desde `parts` en formatos de varias partes (decisión FR-1); el `literal` es control.
- Rutas `hints: format` para formatos de varias partes y de texto (FR-2, migración 0050).
- Perfiles de recorte `short-answer@2`/`free-text@2`: margen por lado menor con tope por vecinos.
- OMR: encuadre de la hoja en fotos de celular con cuadrilátero validado por forma; un problema de
  burbujas ya no descarta los recortes de la página. Goldset real 88,2 % → 97,7 % correctas, 0
  confiadas incorrectas; goldset sintético idéntico.
- La propuesta de revisión es la mejor lectura (no pidió revisión, interpretable, mayor confianza),
  no la del primer lector de la ruta: antes el revisor veía "wedriétero" o "8" en vez de la lectura
  buena de Gemini, y aceptar rápido dejaba en 0 una respuesta correcta.

**Regresión con las 6 fotos originales:** las 6 aceptadas con su página y P1 correcta; ningún
recorte trae preguntas vecinas; Haiku 13 → 16 y Gemini 14 → 18 de 24 casillas cortas bien leídas;
2 autoaceptadas, ambas correctas; ninguna autoaceptación equivocada.

**Abierto** (no se corrige en esta rama):
- Haiku lee solo la primera casilla de la secuencia aun con la guía de formato (3 de 3 hojas).
- Decimales escritos en casillas: espacios por casillas vacías ("2  ,75") y puntos sueltos ("1.2,75");
  la ruta por defecto sigue en `hints: none` (C-1).
- La confianza de Haiku rara vez llega a 0,85: domina la revisión por `low_confidence`. Calibrar con
  hojas reales de alumnos antes de tocar `minConfidence` (C-2).

## Etapa 1 — Lectura por visión más exacta (`feat/vision-lectura-etapa1`)

Plan: `docs/plan-etapa1-lectura-vision.md`.

### T1 — Umbral por lector y arreglos de proveedores (`wip/e1-t1`)

- **Decisión E1-1 — el umbral de confianza vive en el lector.** `readerSpecSchema` suma
  `minConfidence` opcional (0 a 1). Si el lector lo trae, reemplaza al `minConfidence` de la
  política solo para las lecturas de ese lector (hacia arriba o hacia abajo); si no, rige el de la
  política, así que las rutas guardadas no cambian de comportamiento. Se eligió el lector y no un
  mapa en la política porque la calibración es del modelo (Gemini 3.5 Flash declara confianza alta
  aun cuando falla y necesita 0,97; `gpt-6-luna` está mejor calibrado con 0,85), el lector de
  desempate ya es un `ReaderSpec` y lo hereda sin otra clave, y un mapa por `key` dejaría umbrales
  huérfanos al renombrar un lector. Quien arma las lecturas del consenso
  (`CropReadingService`, también al reutilizar una lectura guardada, y el arnés `run-sample`) copia
  `reader.minConfidence` en `ConsensusReading.minConfidence`.
- `evaluateConsensus` aplica el umbral de cada lectura en todos los puntos donde se mira la
  confianza: blancos (`acceptBlank`, incluidos los de tinta sin lecturas), formatos de rúbrica,
  grupo acordado (incluida la lectura de desempate) y la propuesta de revisión, que ahora ordena
  por: no pidió revisión → interpretable → **supera el umbral de su lector** → confianza. Con un
  umbral único ese criterio es monótono con la confianza, por lo que la propuesta no cambia sin
  umbrales por lector. Los 37 casos previos de `evaluate-consensus.spec` y los del pipeline pasan sin tocarse.
- **`OpenAiProvider`: la escalera de `reasoning.effort` no bajaba de nivel.** Error real
  (una llamada de texto a `gpt-6.1-sol` con `reasoning: { effort: 'none' }`, rechazada sin costo):
  `BadRequestError`, `status: 400`, `code: 'unsupported_value'`, `param: 'reasoning.effort'`,
  `type: 'invalid_request_error'`, `message: "400 Unsupported value: 'none' is not supported with
  the 'gpt-6.1-sol' model. Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'."`.
  El mensaje no nombra `reasoning` ni `effort`, por eso el patrón nunca calzaba. Ahora, si el error
  trae `param`, decide el parámetro (`reasoning` o `reasoning.*`); solo sin `param` se mira el
  mensaje. Un 400 con otro `param` ya no se reintenta aunque el mensaje hable de razonamiento. Con
  `gpt-6.1-sol` la escalera queda `none` → `minimal` → `low` y recuerda `low` para el modelo.
- **`AnthropicProvider`: `thinking: { type: 'disabled' }` rechazado por modelos nuevos.** Sin
  llamadas reales. Fuente: la referencia de errores y la guía de migración de la API de Claude
  (Sonnet 5.5 responde 400 `invalid_request_error` con `"thinking.type.disabled" is not supported
  for this model. Use "thinking.type.between_tools" for the lowest thinking setting, …`; Opus 5.5
  rechaza `disabled` y `between_tools`; Haiku 5.5 acepta `disabled` con esfuerzo `high` o menor).
  El cuerpo llega en el SDK 0.98 como `BadRequestError` con `status: 400`,
  `type: 'invalid_request_error'` y `error: { type: 'error', error: { type, message } }`; el
  `message` del `Error` es `400 ` + el JSON del cuerpo. La API de Anthropic no trae `param`, así
  que se decide con `error.error.type` y el `message` del cuerpo (que nombre
  `thinking.type.disabled` o `thinking.type.between_tools`). Con `reasoning: 'off'` la escalera es
  `disabled` → `between_tools` (sin otro campo en `thinking`) → sin `thinking` y
  `output_config.effort: 'low'` (último recurso para modelos sin modo apagado), y recuerda el
  escalón por modelo. Haiku 5.5 sigue enviando `disabled` sin reintentos.

### Etapa 1 — T0 y T1 cerradas con su compuerta

- **T0, arnés v2** (`apps/api/scripts/answer-reading-eval/`): dataset `fotos-reales-v1` fuera del
  repo (30 recortes con verdad por casilla), rutas por formato con `resolveReadingRoute`, caché de
  lecturas (las 720 ya pagadas importadas), errores separados en "perjudica" y "favorece",
  intervalos de Wilson y McNemar pareado. **Compuerta:** reproduce exacto la línea base
  (15/72 = 20,8 % [13,1–31,6], 0 equivocadas) y el pipeline B con override (32/72 = 44,4 %
  [33,5–55,9], 0 equivocadas). Gasto US$0.
- **T1:** `ReaderSpec.minConfidence` opcional (E1-1), escalera de `reasoning.effort` de OpenAI por
  `param` del error (el mensaje real nunca dice "reasoning" ni "effort"), escalera de `thinking`
  de Anthropic por modelo.
- **Bug de integración T0×T1 atrapado por la compuerta:** el arnés armaba la lectura para el
  consenso sin `minConfidence` y el umbral de la ruta se perdía (40/72 con 1 equivocada). Arreglado
  con test que falla sin el arreglo; con el umbral en la ruta el pipeline B da 32/72 con 0
  equivocadas, **idéntico casilla por casilla** al override (0 discordantes).
- **Hallazgo:** el endpoint `gemini-3.5-flash` responde con `modelVersion: gemini-3.6-flash` (la
  página de deprecaciones de Google lo confirma: el alias se redirige). Todo lo medido como
  "Gemini 3.5 Flash" fue 3.6 Flash. Precio oficial de 3.6 y 3.8 Flash: US$0,75 / 3,75 por millón
  hasta el 31-12-2026 y US$1,50 / 7,50 desde 2027 (las cifras de agregadores eran otras).
  Consecuencias para T2: la ruta nombra el modelo real, se mide 3.8 Flash contra 3.6, y el
  proveedor de Gemini debe guardar el `modelVersion` que respondió (hoy guarda el pedido).

### Etapa 1 — T2 y T3 cerradas con su compuerta

- **T2 (pipeline B):** los proveedores devuelven el modelo que respondió (`providerModel`, que se
  guarda en `answer_readings.provider_model`; `model` sigue siendo el pedido y con él se costea).
  `gemini-3.8-flash` rechaza `thinkingLevel: MINIMAL`: el proveedor baja a `LOW` y lo recuerda por
  modelo. Medición (72 unidades): alias 3.5→3.6 44,4 % / 0 eq.; **3.6 Flash 43,1 % / 1 eq.
  (favorece)**; **3.8 Flash 41,7 % / 0 eq.** — elegido 3.8 (decisión E1-2): ninguna lectura
  equivocada pasa de 0,95 y las 37 con ≥ 0,97 son exactas; 3.6 dio 1,00 a una lectura errónea.
  Umbral 0,97 confirmado simulando 0,90–0,99 desde caché. Migración **0051**: retira las 8 rutas
  vigentes y siembra las del pipeline B; agrega `gemini-3.6-flash` al catálogo y sube 3.8 Flash al
  precio oficial de 2027 (US$1,50 / 7,50; afecta el costo estimado de otras funcionalidades que
  usen 3.8 Flash, a favor de no quedarse corto).
- **T3 (lectura por casilla, `transcribe.boxes@1`):** partes por casilla (`sign`, `i1…iK`, `f1…fM`,
  `e1…eN`) y armado del valor en código (la coma la pone la geometría). Medido con el alias 3.5:
  decimal Gemini 7/9 → 9/9 exactas. **Medido de nuevo con 3.8 Flash (la ruta final):** decimal sin
  mejora (8/9 en ambos) → **conserva su prompt**; secuencia 4/9 → 6/9 autoaceptadas → **adopta el
  prompt nuevo** (0051 ajustada; `pipeline-b-final.json` idéntico a lo sembrado, verificado en PG14).
  Entero descartado (sin mejora, 25 % más caro).
- **Resultado acumulado de la etapa:** 15/72 → **32/72 autoaceptadas** (20,8 % → 44,4 %), **0
  equivocadas** en todo el camino. Gasto acumulado de la etapa ≈ US$0,73 (a precio 2027).
- **Riesgo anotado (T3):** la posición de la coma se deriva de la clave del ítem (igual que la hoja
  impresa). Si la clave cambia después de imprimir, la lectura por casilla supondría otra geometría
  que la impresa. Hoy solo aplica a secuencias (no hay coma), así que no afecta a la ruta final.

### Etapa 1 — T4 cerrada: verificador de incorrectas

- **Contrato y piezas:** motivo `verifier_flagged` (modo corrección), `ConsensusPolicy.incorrectVerifier`
  opcional, propósito de prompt `verification` (el esquema impide que un prompt de transcripción o de
  rúbrica declare la clave o la lectura acordada), prompt `verify.incorrect@1` con lock por formato,
  funciones puras en `@soe/answer-reading` usadas por el pipeline y el arnés, lectura del verificador
  en `answer_readings` con modo `verifier` (fuera de `usedReadingIds`; la cola de revisión las
  excluye). Se activa con incorrectas **y parciales** autoaceptadas. **Nunca acepta ni cambia una
  nota.** Migración **0052** (`answer_reading_mode` + `verification_output`) y **0053** (verificador
  en las 6 rutas que autoaceptan; desarrollo sin cambio).
- **Elección (E1-3):** conjunto de estrés fuera del repo (`datasets/estres-verificador-v1`: 12 ceros
  injustos que llegan a autoaceptarse y 8 incorrectas verdaderas). `gpt-6-luna` 34/36 atrapados con
  14/24 falsos avisos → descartado. `gemini-3.6-flash` 33/36 con 5/24. **`gemini-3.8-flash` 34/36
  con 3/24**, y con umbral **0,95** (sus "no" erróneos venían con 0,90–0,95) atrapa **35/36 [85,8–99,5]
  con 3/24 falsos avisos**. Cada verificador falla en el error de su propia familia (luna no ve el
  `0109` que leyó luna; Gemini no ve el `8, 15, 12` de Flash-Lite): con el par Gemini + luna no hay una
  tercera familia, y se eligió el que menos falsos avisos da.
- **Bug de producción encontrado y corregido:** dos llamadas a `gpt-6-luna` quedaron colgadas ~81 min
  con `timeoutMs` 45 s. Causa (en el código de los SDK): OpenAI 6.49 y Anthropic 0.98 limpian el
  timeout al recibir las cabeceras y la lectura del cuerpo queda sin plazo; reintentos y escalera de
  razonamiento lo multiplicaban. `runWithinDeadline` da un plazo total único por llamada a los tres
  proveedores (`LlmTimeoutError` → estado `timeout`).
- **Compuerta en fotos reales con la ruta final:** 32/72 autoaceptadas, 0 equivocadas; el verificador
  revisó las 8 incorrectas autoaceptadas, mandó 0 a revisión, ninguna casilla cambió de decisión;
  costo extra US$0,0004 por recorte corto.

### Etapa 1 — resultado consolidado (arnés, fotos-reales-v1, 72 unidades, `e1-final` vs `t0-actual`)

| | Antes (Flash-Lite + Haiku) | Después (pipeline B final) |
|---|---|---|
| Autoaceptadas | 15/72 = 20,8 % [13,1–31,6] | **32/72 = 44,4 % [33,5–55,9]** (19 ganadas, 2 perdidas; McNemar p < 0,001, optimista) |
| Autoaceptadas equivocadas | 0 | **0** (0 perjudican, 0 favorecen) |
| Ceros injustos atrapados por el verificador (estrés) | — | 35/36 |
| Costo nominal por recorte corto (precio 2027) | US$0,0013 | US$0,0038 (la mitad hasta dic-2026) |

Gasto de IA de la etapa ≈ US$1,58 (nominal 2027; ~US$0,8 facturado en 2026), dentro del tope de US$5.

### Etapa 1 — T5b: el número de la pregunta fuera del recorte (`wip/e1-t5b`)

- **Riesgo:** la hoja imprime el número de la pregunta 6 pt a la izquierda de la región del campo, a
  la altura de la primera fila. El margen de `short-answer@2` (30 % del lado menor) lo incluía, y
  Gemini 3.8 Flash leyó "4 3/4" en Celeste P4 con 0,95 en las 3 repeticiones (lo salvó el
  desacuerdo con luna). Tapar el número pintándolo ya se había descartado (dejaba puntos de lápiz).
- **Decisión E1-4 — el layout publica el rótulo y el perfil lo trata como obstáculo.** Cada campo de
  respuesta escrita suma `response.printedLabelRegion` (opcional; derivado de las mismas constantes
  con que se imprime el número, y un test comprueba que el ancho real de Helvetica-Bold cabe en la
  caja). El perfil suma `printedLabelGapFraction`: en cada lado el margen no pasa de esa fracción de
  la distancia al rótulo (mismo criterio que `neighborGapFraction`). `short-answer@3` = v2 + 0,5.
  Lo impreso dentro de la región (coma, barra, paréntesis, `;`, signos, rótulos de casilla) no se
  toca. Los v1/v2 ignoran el rótulo y un layout sin rótulo recorta como v2, así que los layouts
  congelados no cambian. Los derivados nuevos cambian de hash (rótulo + id del perfil; la geometría
  es la misma, verificado en el test).
- **No hay `free-text@3`:** en las fotos, Ámbar empezó P10 en el margen izquierdo y el tope dejó
  "17 tiene" en vez de "47 tiene". El desarrollo sigue en `free-text@2` (publica el rótulo, no lo usa).
- **Medición** (dataset `fotos-reales-v1-sin-rotulo`: misma verdad, los 24 recortes cortos
  regenerados por el OMR con `short-answer@3` desde las 6 fotos; los 6 de desarrollo, idénticos
  byte a byte; la reproducción con `short-answer@2` dio 30/30 recortes idénticos al dataset
  original). Ruta `pipeline-b-final.json`, 3 repeticiones, pareado contra `e1-final`:

| | `e1-final` (`@2`) | Sin rótulo (`@3`) |
|---|---|---|
| Autoaceptadas | 32/72 = 44,4 % [33,5–55,9] | **32/72 = 44,4 % [33,5–55,9]** (5 ganadas, 5 perdidas; p = 1,0) |
| Equivocadas (perjudica / favorece) | 0 (0 / 0) | **0 (0 / 0)** |
| Lectura exacta Gemini 3.8 Flash | 56/72 = 77,8 % [66,9–85,8] | **62/72 = 86,1 % [76,3–92,3]** |
| Lectura exacta gpt-6-luna | 60/72 = 83,3 % [73,1–90,2] | 58/72 = 80,6 % [70,0–88,0] |
| Lecturas exactas del par | 116/144 | **120/144** |
| Decisión con el valor correcto | 59/72 = 81,9 % [71,5–89,1] | 55/72 = 76,4 % [65,4–84,7] (p = 0,42) |

  - Celeste P4: Gemini pasa de "4 3/4" (3/3) a "3/4" con 0,98–0,99 (3/3) y la casilla se autoacepta
    en las 3 repeticiones. También desaparecen dos lecturas de luna que sumaban un dígito a la
    izquierda ("12,73" por "2,73" en Bruno P3, "0109" por "0100" en Bruno P2).
  - Por formato (autoaceptadas): fracción 5 → 8, entero 6 → 7, par ordenado 3 → 2, texto corto
    6 → 3; el resto igual. La baja de texto corto es luna leyendo "productos" en Bruno P8 (3/3) con
    el renglón intacto; Gemini lo lee bien 9/9 y el desacuerdo manda a revisión.
  - Ruido entre repeticiones: autoaceptadas 11/11/10 antes y 12/10/10 ahora; decisión correcta
    19/21/19 y 19/18/18.
- **Integración:** cumple la regla (equivocadas 0 → 0, autoaceptación igual, el par suma 4
  lecturas exactas). La baja de "decisión con el valor correcto" (−4, no significativa) viene de
  desacuerdos nuevos de luna que van a revisión, no de autoaceptaciones. **Se integra.**
- **Riesgos:** (1) las hojas ya impresas siguen con el número dentro del recorte hasta que se
  vuelva a derivar el layout (si se quisiera cubrirlas, el OMR tendría que derivar el rótulo sin el
  campo, acoplándose a las constantes de impresión); (2) con el margen izquierdo de ~1 mm, una
  respuesta corta escrita fuera de la casilla hacia la izquierda más de ~4 mm se corta (no pasó en
  las 24 casillas); (3) el OMR debe desplegarse con `short-answer@3` antes que la API, o
  `resolve_crop_profile` cae al recorte heredado (igual que con FR-3).
- Gasto de IA: US$0,27 nominal (precio 2027).

### Etapa 1 — corrección de la revisión final (`wip/e1-t5a`)

- **Presupuesto previo con el peor caso.** La estimación antes de leer un escaneo cuenta, por
  recorte, los lectores y los de sombra **más** una llamada de desempate (si la política tiene
  `onDisagreement: tiebreak_reader` y lector de desempate) **más** una del verificador (si la
  política autoacepta y trae `incorrectVerifier`), cada una al costo promedio por lectura de la org.
  Se eligió el peor caso y no un costo esperado: es un tope, el verificador solo cuesta
  ~US$0,0004 por recorte corto, y un esperado necesitaría una tasa de incorrectas autoaceptadas que
  la org todavía no tiene medida. Puede bloquear un escaneo que en la práctica cabría cuando el
  presupuesto está casi agotado; los reintentos por error transitorio siguen sin contarse.
- **Reutilización de lecturas y veredictos.** La clave de reutilización (`reuseKey`) de
  `CropReadingService` suma al `readingKey|readerKey|mode` el proveedor, el modelo,
  `maxOutputTokens`, `reasoning`, `mediaResolution` y el hash del prompt renderizado, tanto para el
  verificador como para los lectores. Un cambio de modelo o de parámetros sin cambiar `key` vuelve a
  leer (con el intento siguiente: el conteo de intentos sigue por `readingKey|readerKey|mode`, que es
  el índice único). `timeoutMs` y `minConfidence` no entran porque no cambian lo que se le pide al
  modelo. Las lecturas ya guardadas se siguen reutilizando si nada cambió: guardan esos mismos
  valores (`provider`, `model`, `params`, `prompt_hash`), así que no hace falta migración.
- **Tarifa de respaldo.** `llm.pricing.ts` cobra `gemini-3.6-flash` y `gemini-3.8-flash` a
  US$1,50 / 7,50 por millón, igual que el catálogo de 0051 (antes 3.8 estaba a 0,75 / 3,75 y 3.6
  no tenía tarifa de respaldo).
- **Orden de despliegue de 0051–0053 (verificado en el código).** `readerSpecSchema` y
  `consensusPolicySchema` son `.strict()` desde antes de la etapa 1. Una API anterior a T1 que lea
  las rutas sembradas por 0051 (lectores con `minConfidence`) o 0053 (`incorrectVerifier`) las
  rechaza: `ReadingRoutesService.parseRoute` reporta «Ruta de lectura inválida: se ignora» y la
  descarta, y como 0051 retira las rutas anteriores, ningún recorte encuentra ruta y queda
  `not_read` con `insufficient_readers` (nunca una nota, pero la lectura se pierde y hay que
  reprocesar). En la otra dirección, la API nueva **necesita** 0052 (columna
  `verification_output` y modo `verifier`): sin ella falla la consulta de lecturas existentes.
  Por eso van **juntas**: el `deploy.yml` corre `db:migrate` y después publica la imagen; entre
  ambos pasos la API vieja ve rutas que no entiende. Despliega con el flag de backend en una ventana
  sin escaneos, y si entró alguno en esa ventana, reprocesa sus recortes `not_read` /
  `insufficient_readers` después del despliegue.
- **Motivos del verificador en modo lectura.** `verifier_flagged` pasa a modo `reading` (D8: la
  duda es de lectura; sin clave a la vista ni corrección preseleccionada) y un motivo nuevo,
  `verifier_failed` (también lectura), cubre la falla, el plazo vencido o la falta de veredicto:
  la web ya no dice «el verificador cree que podría ser…» cuando el verificador no respondió. La web
  tampoco preselecciona «Incorrecta» ante un motivo del verificador aunque la decisión haya quedado
  guardada en modo corrección (decisiones de T4 ya persistidas). `reasons` es JSONB: sin migración.
- **La consolidación no corrige sin verificar un resultado que cambió.** Si la corrección con la
  clave vigente no coincide con el `scoringOutcome` de la decisión autoaceptada (por ejemplo, una
  correcta cuya clave se editó después), la decisión se reemplaza (procedimiento de F7:
  `escalateToReview`, decisión nueva y la vieja con `superseded_by_id`) por una `needs_review` con
  el motivo nuevo `scoring_changed` (modo lectura). La respuesta queda pendiente, nunca en 0. Las
  decisiones con `scoringOutcome` nulo no se comparan.
- **`--reader-min-confidence` reemplaza el umbral del lector.** Antes solo ponía 0 en la política y
  el consenso seguía aplicando el `minConfidence` que el lector trae en la ruta, así que no se podía
  bajar de él. Barrido verificado desde el caché (`pipeline-b-38.json`, 72 unidades, `gpt-6-luna` en
  0,85, US$0):

  | Umbral `gemini-3.8-flash` | 0,85 | 0,90 | 0,93 | 0,95 | 0,96 | 0,97 | 0,98 | 0,99 |
  | ------------------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
  | Autoaceptadas / 72        | 37   | 37   | 37   | 37   | 30   | 30   | 30   | 16   |
  | Equivocadas               | 0    | 0    | 0    | 0    | 0    | 0    | 0    | 0    |

  Confirma las cifras de T2 (0,90–0,95 → 37/72 y 0,96–0,98 → 30/72, 0 equivocadas). El umbral 0,97
  no cambia: se eligió por margen sobre las lecturas equivocadas que 3.8 Flash dio con 0,90–0,95,
  no porque en este dataset aparezcan equivocadas entre 0,90 y 0,96.
- **`importar-lecturas` controla el prompt.** Compara el `promptHash` (o el texto) guardado con el
  prompt que se renderiza hoy y omite la lectura si cambió. Los experimentos ya importados no
  guardaron ninguno de los dos: sin ese dato solo se importan con `--force`.
- **Compuerta:** el arnés con `pipeline-b-final.json` desde el caché sigue en **32/72, 0
  equivocadas** (170 aciertos de caché, 0 llamadas, US$0); el verificador revisó las 8 incorrectas
  autoaceptadas y no mandó ninguna a revisión, igual que en T4.
