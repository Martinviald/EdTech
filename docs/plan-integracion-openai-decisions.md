# Plan — OpenAI Decisions (`gpt-6-luna`) como segundo motor de `@soe/decisions`

> Estado: diseño CERRADO (2026-10-21), en implementación.
>
> Decisiones del usuario:
> 1. **SDK:** subir `openai` a la última versión (7.41.0 al 2026-10-21) en todo el
>    monorepo. El adaptador usa el SDK, no `fetch` directo (el plan B queda descartado
>    salvo que la subida sea imposible, y eso se reporta antes de cambiar de camino).
> 2. **Llave en demo:** el usuario carga el secreto SST `OpenAiApiKey`; el código lo
>    declara en `sst.config.ts` y lo mapea a `OPENAI_API_KEY`.
> 3. **Consumo:** solo desde otros servicios del backend vía `DecisionsService`. Sin
>    endpoint HTTP genérico.
> 4. **Datos de alumnos en imágenes:** fuera de alcance; no se implementa nada
>    para eso ahora.
>
> Alcance de esta implementación: Fases 0–3 en una PR a `dev`. La calibración (4)
> y los consumidores (5) quedan para PRs posteriores.
>
> Base original: propuesta. Base: `origin/dev` @ `3df8829b` (2026-10-21).
> Fuente: <https://developers.openai.com/api/docs/guides/decisions> (beta pública).
> Antecedente: `docs/plan-integracion-jev.md` y `docs/calibracion-jev.md`.

## 1. Conclusión

No hay que construir un servicio nuevo. `@soe/decisions` (PR #261) ya es la
abstracción neutral que pide el requerimiento: contrato `DecisionEngine`,
registro de motores en la API, modos `off|shadow|live` por funcionalidad y por
org, umbrales calibrados, routing por confianza, redacción de PII, log
inmutable `decision_calls` y clasificación jerárquica. Jev se diseñó como **un**
adaptador y el plan original ya lo anticipaba ("si cambia el proveedor, los
consumidores no se tocan").

La API de OpenAI tiene el mismo modelo conceptual que Jev:

| `@soe/decisions` | Jev (`/v1/systemone`)  | OpenAI (`/v1/decisions`)                                      |
| ---------------- | ---------------------- | ------------------------------------------------------------- |
| `noul`           | `noul` → `noul`        | `predicate` → `probability`                                   |
| `choice`         | `criteria{k: desc}`    | `choices[{value, description}]` → `choice`, `probabilities[]`, `confidence` |
| `score`          | `criteria[]`           | `levels[{label, description}]` → `score`, `probabilities[{value,label,probability}]`, `confidence` |
| `state`          | texto / JSON           | `input`: string **o mensajes con `input_text` + `input_image`** |
| errores          | 401/429/529/…          | 401/429/5xx + respuesta `type: "refusal"` por pregunta         |

Por eso la integración es **un adaptador nuevo (`OpenAiDecisionEngine`) + una
extensión multimodal del contrato**. Todo lo demás se reutiliza tal cual. Lo que
OpenAI agrega y Jev no tiene es **imágenes**: es la razón de fondo para sumarlo
("categorizar imágenes").

## 2. Qué se reutiliza sin cambios

- `DecisionsService.evaluate()` / `shadow()` / `isLive()` — punto único de consumo
  desde cualquier módulo (es `@Global`).
- `DecisionsConfigService` — `decision_settings.engine` es `text`: elegir
  `openai` por funcionalidad y por org **no requiere migración**.
- `DecisionCallsRecorder` + `estimateLlmCostUsd` — costo por llamada.
- `routeByConfidence`, `routeNoul`, `hierarchicalChoice`, `redactState`,
  builders `noul/choice/score`, `FakeDecisionEngine`, `ConcurrencyLimiter`.
- Consumidor existente (`remedial_judge`): funciona con OpenAI cambiando una fila
  de `decision_settings`, sin tocar código.
- `OPENAI_API_KEY` (`LLM_PROVIDER_DEFAULTS.openai.apiKeyEnv`), la misma que usa
  `OpenAiProvider`.

## 3. Cambios

### Fase 0 — Spike y decisión de SDK (½ día)

1. Llamada real con la key de dev a `/v1/decisions` con las 3 preguntas del juez
   remedial + una imagen de prueba (ítem DIA con figura, sin datos de alumnos).
   Registrar: límites reales (máx. opciones de `choice`, máx. niveles de `score`,
   contexto, tamaño de imagen), forma de `usage`, `model` versionado devuelto,
   códigos de error y cuándo aparece `refusal`. **La guía no publica los límites
   ni la forma de `usage`**: sin este paso, `limits` y el parser se escriben a
   ciegas.
2. **SDK.** La guía exige `openai` JS ≥ 7.30.0; la API usa `openai@6.49.0`
   (`OpenAiProvider`). Recomendación: **subir a 7.x en todo el monorepo** (una
   sola versión, un solo cliente, errores tipados y reintentos del SDK).
   `OpenAiProvider` ya se aísla del SDK con su interfaz `OpenAiClient`, así que el
   impacto debería acotarse a tipos de `openai/resources/responses`; lo valida su
   spec en el CI. Si el salto rompe más de lo razonable, plan B: el adaptador
   usa `fetch` directo (patrón `JevFetch`, inyectable) y se migra al SDK después.

### Fase 1 — Contrato multimodal en `packages/decisions` (sin red)

`src/contracts.ts`:

```ts
/** Imagen adjunta al estado. Misma forma que `LlmImagePart` de la API. */
export type DecisionImage =
  | { readonly mimeType: string; readonly data: string } // base64 sin prefijo
  | { readonly url: string };                             // http(s) público o presigned

export interface DecisionRequest<Q> {
  readonly state: DecisionState;
  readonly images?: readonly DecisionImage[]; // ← nuevo, opcional
  // … resto igual
}

export interface DecisionEngineCapabilities {
  readonly images: boolean;
}

export interface DecisionEngineLimits {
  readonly maxChoiceOptions: number;
  readonly minScoreLevels: number;
  readonly maxScoreLevels: number;
  readonly maxStatePlusQuestionTokens: number;
  readonly maxRequestTokens: number;
  readonly charsPerToken: number;
  readonly tokensPerImage: number; // estimación conservadora
}

export interface DecisionEngine {
  readonly name: string;
  readonly capabilities: DecisionEngineCapabilities; // ← nuevo
  readonly limits: DecisionEngineLimits;             // ← nuevo
  isAvailable(): boolean;
  evaluate<Q>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>>;
}

// Nuevo código: el modelo se negó a responder una pregunta.
export const DECISION_ERROR_CODES = [..., 'refused'] as const;
```

- `images` se modela como campo aparte (igual que `LlmCompletionRequest.images`)
  y no dentro de `state`, para que `redactState`, el hash del estado y los
  consumidores de solo texto no cambien.
- `DECISION_LIMITS` pasa a ser `JEV_LIMITS`; `assertWithinLimits(state,
  questions, limits, images?)` recibe los límites del motor. `hierarchicalChoice`
  usa `engine.limits.maxChoiceOptions`.
- Un motor sin `capabilities.images` que recibe imágenes lanza
  `invalid_request` (Jev). `FakeDecisionEngine` las acepta y las registra.
- **`refusal`:** si alguna pregunta viene rechazada, el adaptador lanza
  `DecisionError('refused')` con el id de la pregunta. Así se mantiene la
  garantía "toda pregunta tiene respuesta tipada" y el consumidor usa el mismo
  camino alternativo que para cualquier otro error. Si un consumidor necesita
  respuestas parciales, se agrega después (no hay ninguno hoy).

### Fase 2 — Adaptador `packages/decisions/src/openai/`

Mismo layout que `src/jev/`:

- `openai-engine.ts` — `OpenAiDecisionEngine` (`name = 'openai'`,
  `capabilities.images = true`, `OPENAI_DECISIONS_DEFAULT_MODEL = 'gpt-6-luna'`,
  `OPENAI_LIMITS` de la Fase 0). Config: `apiKey?`, `baseURL?`, `defaultModel?`,
  `timeoutMs?`, `maxRetries?`, `fetch?`. Construcción perezosa del cliente,
  `unavailable` sin key — igual que Jev. Es el **único** archivo que importa el
  SDK de OpenAI dentro del paquete.
- `openai-mapping.ts`:
  - **Request:** `noul` → `predicate`; `choice.criteria{k: d}` →
    `choices[{value: k, description?}]` (`null` omite la descripción);
    `score.criteria[i]` → `levels[{label, description}]` (`label` corto derivado
    o `Nivel i`, el texto va en `description`). Las `Description` en JSON se
    serializan a string (OpenAI solo acepta texto). `name` = id de la pregunta.
    `input`: string si no hay imágenes; si las hay, un mensaje `user` con
    `input_text` (estado serializado) + `input_image` (data URL o URL).
  - **Response:** `answers[]` indexado por `name` → mapa por id;
    `probabilities[]` de choice → `Record<k, number>`; de score → arreglo por
    `value`, `level = argmax`. Valida campo a campo como `parseSystemOneResponse`
    (todo lo inesperado → `upstream`).
  - **Errores:** `mapSdkError` equivalente (401/403 `auth`, 429 `rate_limited`,
    timeout, 400/422 `invalid_request`, abort, resto `upstream`).
- `argmax`, `isFiniteNumber`, `malformed` y la conversión de probabilidades se
  mueven de `jev-mapping.ts` a un `src/mapping-helpers.ts` compartido (DRY).
- Specs con `fetch` inyectado y respuestas grabadas del spike, como
  `jev-engine.spec.ts` / `jev-mapping.spec.ts`.

### Fase 3 — Integración en la API

- `packages/types/src/schemas/decisions.schema.ts`:
  `decisionEngineIdSchema = z.enum(['jev', 'openai'])`.
- `decisions.module.ts`:
  ```ts
  useFactory: () => [
    new JevDecisionEngine(),
    new OpenAiDecisionEngine({ apiKey: process.env[LLM_PROVIDER_DEFAULTS.openai.apiKeyEnv] }),
  ],
  ```
- `decision-calls.recorder.ts`: `stateHash` incluye el sha256 de cada imagen
  (bytes o URL sin query de firma) para que dos llamadas con el mismo texto e
  imágenes distintas no colisionen. Opcional: columna `image_count`
  (migración chica) para calibrar por modalidad.
- `decisions.service.ts`: ningún cambio de lógica; `images` viaja dentro del
  `request` y `redactState` sigue aplicando al texto.
- `llm.pricing.ts`: `{ prefix: 'gpt-6-luna', inputUsd: 0.1, outputUsd: 0 }`
  (solo se cobra input; sin cargos de caché ni de salida). Si existe el
  catálogo `llm_models`, agregar ahí la tarifa también.
- `sst.config.ts`: **no hay secreto de OpenAI en demo** (solo Gemini, Anthropic
  y Typesafe). Agregar `OpenAiApiKey` → `OPENAI_API_KEY`. Esto se hace con el
  usuario, no en ejecución autónoma.
- `scripts/decisions/run-calibration.ts`: hoy instancia `JevDecisionEngine`
  fijo; aceptar `--engine jev|openai` para correr los mismos goldsets contra
  ambos y comparar.

### Fase 4 — Calibración comparativa (antes de cualquier `live`)

1. Correr los goldsets existentes (`remedial_judge`, clave, taxonomía) con
   `--engine openai` y comparar contra `docs/calibracion-jev.md`: exactitud,
   ECE por tipo de pregunta, p50/p95, costo. Ojo: el `score` de OpenAI es el
   valor esperado, igual que Jev, pero los umbrales **no se transfieren** entre
   motores ni entre tipos de pregunta.
2. Goldset nuevo de imágenes sin datos de alumnos: figuras de ítems DIA ya en
   S3 (¿la figura corresponde al enunciado?, tipo de figura, ¿legible?).
3. Documentar en `docs/calibracion-openai-decisions.md` y decidir motor por
   funcionalidad en `decision_settings`.

### Fase 5 — Primeros consumidores (cada uno en su PR, partiendo en `shadow`)

Candidatos donde la imagen es el valor diferencial:

| Funcionalidad (`DECISION_FEATURES`) | Preguntas                                              | Datos de alumnos |
| ----------------------------------- | ------------------------------------------------------ | ---------------- |
| `item_figure_check`                 | `noul` figura legible / coherente con el enunciado; `choice` tipo de figura | No |
| `ai_tagging_suggest`                | `hierarchicalChoice` sobre `taxonomy_nodes` con texto + figura del ítem (sugerencia, el admin confirma, §8.3) | No |
| `answer_sheet_quality`              | `noul` hoja legible / mal escaneada antes del OMR       | **Sí → bloqueado por DPA** |

Cada uno sigue el ciclo del README: preguntas en un archivo del dominio →
`shadow()` → calibrar → `live` con umbrales en `thresholds`.

## 4. Lo que NO se hace

- **No** un endpoint HTTP genérico `POST /decisions` que reciba preguntas
  arbitrarias desde el front: abriría costo sin control, inyección de
  instrucciones y saltaría el modo por funcionalidad. Cada dominio expone su
  propio endpoint y llama a `DecisionsService`.
- **No** un `LlmProvider` nuevo: Decisions no genera texto (misma razón que Jev,
  `plan-integracion-jev.md` §1).
- **No** reemplazar a Jev: conviven y se elige por funcionalidad con datos.
- **No** renombrar `noul` → `predicate` en el contrato: es churn sin beneficio;
  el nombre del proveedor vive solo en el mapping.
- **No** enviar imágenes o textos con datos de alumnos hasta el DPA
  (Ley 19.628). `redactState` no puede redactar imágenes: una foto de hoja de
  respuestas lleva nombre y RUT. Revisar además si conviene ZDR y residencia
  de datos (la guía las ofrece para clientes elegibles).

## 5. Riesgos

| Riesgo | Mitigación |
| ------ | ---------- |
| Beta pública: el contrato puede cambiar antes de GA | Mapping aislado y validado campo a campo; specs con respuestas grabadas; modelo fijado por versión |
| Límites no documentados | Spike de la Fase 0; `limits` por motor; rechazar de más (estimación conservadora) |
| Salto `openai` 6 → 7 rompe `OpenAiProvider` | Spec del provider en CI; plan B con `fetch` |
| Costo de imágenes no estimable antes | Medir tokens por imagen en el spike; `tokensPerImage` conservador |
| Umbrales de Jev reutilizados por error | `thresholds` vive por fila de `decision_settings` (motor + modelo); calibrar de nuevo |

## 6. Archivos

| Archivo | Cambio |
| ------- | ------ |
| `packages/decisions/src/contracts.ts` | `images`, `capabilities`, `limits`, código `refused` |
| `packages/decisions/src/questions.ts` | `assertWithinLimits` con límites del motor e imágenes |
| `packages/decisions/src/mapping-helpers.ts` | nuevo: helpers comunes extraídos de `jev-mapping.ts` |
| `packages/decisions/src/jev/*` | `JEV_LIMITS`, `capabilities.images = false` |
| `packages/decisions/src/openai/openai-engine.ts`, `openai-mapping.ts` + specs | nuevos |
| `packages/decisions/src/fake/fake-engine.ts`, `hierarchical.ts`, `index.ts` | límites por motor, exports |
| `packages/decisions/README.md`, `package.json` | tabla de motores; dependencia `openai` |
| `packages/types/src/schemas/decisions.schema.ts` | `'openai'` en el enum de motores |
| `apps/api/src/decisions/decisions.module.ts` | registrar `OpenAiDecisionEngine` |
| `apps/api/src/decisions/decision-calls.recorder.ts` | hash con imágenes |
| `apps/api/src/llm/llm.pricing.ts` | tarifa `gpt-6-luna` |
| `scripts/decisions/run-calibration.ts` | `--engine` |
| `sst.config.ts` | secreto `OpenAiApiKey` (con el usuario) |

Fases 1–3 van en una sola PR a `dev`; la calibración (4) y cada consumidor (5),
en PRs aparte. Lo que se toque en `apps/api` sigue `.claude/rules/backend`: cero
comentarios, `reportServerError` en los `catch` y helpers de un solo uso como
métodos privados (el paquete `packages/decisions` sí conserva su estilo
documentado actual).
