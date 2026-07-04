# Contratos — Motor Remedial con Estímulo · Ola 2.1 (Opción A + core del juez)

> Diseño de referencia: `docs/remedial-estimulo-ola2-diseno.md`. Este doc es el contrato para construir.
> **Objetivo:** el docente genera **preguntas NUEVAS sobre un texto OFICIAL** de la evaluación (Opción A), ancladas al error, y validadas por un **juez automático con loop (máx 3)**. Remediación de lectura fiable — resuelve el bug de "texto inventado/colgado".
> **Fuera de alcance:** generación de texto nuevo (Opción B → 2.2), estímulos no-lectura (figure/table), ítems open-ended, juez cross-familia.

## Decisiones incorporadas
- Pasaje A: **política enchufable** `highest-gap` (default) + **override del docente** desde lista. Contenido guarda **lista** de estímulos (1 en 2.1) → multi-pasaje trivial después.
- Fallback sin pasaje: **avisar → docente elige del banco → (2.2) generar**. Terminal 2.1 = `self_contained` + aviso, con el punto de swap listo.
- Modelos: generar = **Gemini 2.5 Pro** (feature `remedial_reading`); juez = **Flash** (feature `remedial_judge`); el `self_contained` actual sigue en `remedial` (Flash). Todo swappable por `llm_settings`.

---

## Fase de build: 2.1a (estímulo + A, sin juez) → 2.1b (juez + loop)

Cada sub-ola se integra y verifica antes de la siguiente.

---

## 1. Datos (`packages/db` + `packages/types`)

### 1.1 `instrument_sections` → store de "estímulo" (migración)
- `+ kind` enum `stimulus_kind` (`passage | figure | table | dataset`; default `passage`).
- `+ source` enum `stimulus_source` (`official | ai_generated`; default `official`).
- `+ orgId uuid` **nullable** (`null`=oficial/compartido; set=privado del tenant). Filtro `orgId = :org OR orgId IS NULL` (patrón `items`; tabla sin RLS).
- `instrumentId` → **nullable** (⚠️ revisar el NOT NULL/FK actual; migración aditiva).
- Índice `(orgId, kind)`.
- *(2.1a solo lee `official`; `ai_generated` se escribe en 2.2.)*

### 1.2 `remedial_materials` (migración)
- `+ method` enum `remedial_method` (`self_contained | reuse_stimulus | generate_stimulus`; default `self_contained` para no romper filas viejas).
- `+ qualityReport jsonb` nullable (lo llena 2.1b).
- Los estímulos del set viven en `content.stimuli` (lista), no en columna (extensible a multi).

### 1.3 `packages/types`
- `stimulusKindSchema`, `stimulusSourceSchema`, `remedialMethodSchema`.
- `remedialStimulusRefSchema` = `{ sectionId, kind, source, title: string|null, textPreview: string|null }`.
- **Extender `remedialPracticeContentSchema`**: `+ stimuli: remedialStimulusRefSchema[]` (opcional; `[]` para self_contained). Los `items` siguen siendo refs.
- **Extender el model de respuesta** con `stimuli` **hidratados** (texto completo del pasaje, on-read) y `qualityReport` (2.1b).
- `judgeVerdictSchema` (2.1b): `{ position, answerable: boolean, derivedAnswer: string|null, uniqueCorrect: boolean, factual: boolean, skillMatch: boolean, objections: string[] }`.
- `qualityReportSchema` (2.1b): `{ iterations: number, finalStatus: 'converged'|'exhausted', verdicts: judgeVerdict[] }`.
- `generateRemedialSchema`: `+ method?`, `+ stimulusId?` (override del docente). `type='practice_set'` se mantiene.

---

## 2. Backend (`apps/api/src/remedial/`)

### 2.1a — Estímulo + Opción A

- **`FailedStimulusService.list(orgId, assessmentId, nodeId): FailedStimulus[]`** (nuevo, común A/B): los pasajes de los ítems con mayor brecha del nodo en esa evaluación. Reusa el retrieval de pasaje de `item-insight` (`items.sectionId → instrument_sections`). Devuelve `{ sectionId, kind, title, text, textType, itemPositions[], gap }` ordenado por brecha desc. Bajo `withOrgContext` para leer `responses`/`skill_results`; los `instrument_sections` con filtro `orgId` explícito.
- **`BankPassageService.listCandidates(orgId, nodeId): StimulusRef[]`** (nuevo): pasajes publicados del banco para ese nodo/asignatura/nivel — alimenta el picker de override y el fallback.
- **`PassageSelectionPolicy`** (puerto): `select(candidates, overrideSectionId?): StimulusRef[]`. Impl **`HighestGapPolicy`** (2.1): devuelve `[candidates[0]]` (mayor brecha) o el override. Diseñado para que un futuro `MultiPassagePolicy` devuelva varios sin cambiar callers.
- **`StimulusResolver`** (nuevo, la cadena de fallback):
  1. `FailedStimulusService.list(...)` → si hay ≥1 → `PassageSelectionPolicy.select(...)` → `reuse_stimulus`.
  2. si 0 → señal `NEEDS_TEACHER_CHOICE` (el front avisa y muestra `BankPassageService` para elegir; el docente reenvía con `stimulusId`).
  3. si el docente no elige / no hay banco → **`TerminalFallbackPolicy`** (puerto). Impl 2.1 **`SelfContainedFallback`** (genera MCQ sin texto + `method=self_contained` + aviso). **Punto de swap para 2.2**: `GenerateStimulusFallback`.
- **`StimulusQuestionGenerator`** (nuevo; generaliza al `PracticeGenerator`): genera N preguntas MC **ancladas al estímulo + brief** (LlmService, feature `remedial_reading` → Pro). El prompt recibe el **texto completo del pasaje** + el brief + ítems de referencia. Valida `validateItemContent`, inserta ítems `draft`/`ai_generated` con **`sectionId` = el estímulo**, tag al nodo. `content.stimuli = [ref]`. **Nota:** el `PracticeGenerator` actual pasa a ser el caso `stimuli=[]` (sin romperlo).
- **`RemedialRunner`** (extiende): resuelve `method` → `StimulusResolver` → `StimulusQuestionGenerator` → markReady con `content.stimuli` + `method` + audit + cost (ya mergeado).
- **Hidratación (extiende `RemedialService.get`)**: para sets con estímulo, hidrata `stimuli` con el texto del pasaje desde `instrument_sections` (filtro `orgId`), además de los `practiceItems` existentes.

### 2.1b — Juez + loop
- **`RemedialJudgeService.judge(stimulus, items): JudgeVerdict[]`** (feature `remedial_judge` → Flash): por ítem, el prompt recibe **el pasaje + la pregunta SIN la clave**; pide (1) responder solo desde el texto → `derivedAnswer`; (2) evaluar cada alternativa → `uniqueCorrect`; (3) chequeo factual; (4) qué habilidad mide → `skillMatch`. El service compara `derivedAnswer` con la clave real (solve-then-check). Limpia boilerplate y exige citar del texto (anti-sesgo de juez). Devuelve verdicts + objeciones.
- **`RemedialQualityLoop.run(generateFn, judgeFn, {maxIter:3})`**: generar→juzgar→ recolectar fallas de **hard-gate** (answerable, uniqueCorrect, factual)→ **regenerar solo los ítems fallidos** inyectando las objeciones→ re-juzgar. `skillMatch=false` = aviso blando (no regenera). Converge (sin fallas hard) o `exhausted` a las 3. Arma `qualityReport`. `markReady` **siempre deja draft** (converged o exhausted).
- El `StimulusQuestionGenerator` gana un modo **`regenerate(positions, objections, stimulus, brief)`**.

**Reglas (CLAUDE.md):** sin `any`; `withOrgContext` en `remedial_materials`/`responses`/`skill_results`; filtro `orgId` explícito en `instrument_sections`/`items`; cero PII al LLM (pasaje = contenido); `validateItemContent`; nada hardcodeado a asignatura (todo por `node`/estímulo).

---

## 3. Frontend (`apps/web`)

### 3.1a
- **`generate-panel.tsx`**: selector de **método** — "Mismas lecturas (Opción A)" (2.1) y placeholder deshabilitado "Texto nuevo IA (Opción B)" (llega en 2.2). Para A: **picker de pasaje** precargado con el de mayor brecha (default), editable desde una lista (`GET /remedial/candidate-stimuli`). `itemCount`.
- **Aviso de fallback**: si el back devuelve `NEEDS_TEACHER_CHOICE`, mostrar aviso "esta evaluación no tiene texto para esta habilidad" + el picker del banco; si el docente no elige → continuar self_contained con nota.
- **Detalle** (`practice-view`): renderizar el **estímulo (pasaje) arriba, solo-lectura**, y debajo las preguntas (con el `ItemEditor` de Ola 1-resto). Degradación: `stimuli` vacío → vista actual.

### 3.1b
- Mostrar **flags del juez** por ítem (verde / aviso con la objeción) y, si `finalStatus='exhausted'`, un **banner** "no convergió — revisa estas objeciones".

### 3 API
- Reusa `POST /remedial/generate` (+`method`,+`stimulusId`), `GET /remedial/:id` (con `stimuli`+`qualityReport`).
- Nuevo `GET /api/remedial/candidate-stimuli?assessmentId&nodeId` → `{ fromAssessment: StimulusRef[], fromBank: StimulusRef[] }`.

---

## 4. Modelos / config
- `llm_settings`: `remedial_reading` → `gemini-2.5-pro`; `remedial_judge` → `gemini-2.5-flash`. `remedial` (self_contained) queda en Flash. Swap de proveedor = editar `llm_settings`. `LLM_FEATURE_DEFAULTS` + `LlmFeature` extendidos.
- **Recordatorio (§5 diseño):** Flash-juzga-Pro es misma familia (juez débil) → cambiar `remedial_judge` a Claude apenas haya key.

---

## 5. Criterios de aceptación + verificación E2E

**2.1a:** 1) generar A sobre una evaluación con pasaje → los ítems quedan con `sectionId` = el pasaje oficial (no `null`); 2) el detalle muestra el texto real arriba + preguntas respondibles desde él; 3) override: el docente cambia el pasaje de la lista y se respeta; 4) fallback: evaluación sin pasaje → aviso + picker del banco → si no elige, self_contained con nota; 5) aprobar publica los ítems ligados al pasaje.

**2.1b:** 6) un ítem no respondible/no-única/factualmente errado → se regenera (≤3) y converge, o queda `exhausted` con objeciones visibles; 7) un desalineado de habilidad → aviso, sin regenerar; 8) `qualityReport` persistido; costo/iteraciones registrados.

**Ambas:** `pnpm typecheck` (api/web/types) + tests remediales verdes; sin regresión en `guide`/`group_plan`/self_contained. Verificar con `/verify` usando la evaluación DIA sembrada.

---

## 6. Reparto por agente (secuencial en worktree)

**2.1a:** TYPES (stimulus/method schemas + content) → DB (migración `instrument_sections` + `remedial_materials`) → BE (`FailedStimulusService`, `BankPassageService`, `PassageSelectionPolicy`, `StimulusResolver`, `StimulusQuestionGenerator`, runner, hidratación, endpoint) → FE (método + picker + display pasaje). 
**2.1b:** BE (`RemedialJudgeService`, `RemedialQualityLoop`, regenerate, feature judge) → FE (flags + banner).

Rama: `sprint-remedial-ola2.1` (stacked sobre `sprint-remedial-v2` ya mergeado a `dev`, o desde `dev` si #24 ya entró).

---

## 7. Riesgos
- Migración `instrument_sections` (instrumentId→nullable): revisar constraint/FK y datos existentes.
- Juez misma familia (débil) → swap a Claude.
- Pasaje oficial reproducido en material (A): material propio del colegio, sin exfiltración.
- Costo del loop: acotado por 3 + regen por ítem; visible por cost tracking.
