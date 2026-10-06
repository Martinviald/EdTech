# Plan — Motor de decisiones (`@soe/decisions`) con Jev

> Rama `feat/decisions-jev` (desde `dev`). Una sola PR a `dev`.
> Jev (TypeSafe AI) es un modelo "System One": evalúa un estado contra preguntas
> tipadas (Noul / Choice / Score) y devuelve respuestas con probabilidades y
> confianza calibrada. No genera texto. Docs: https://docs.typesafe.ai

## Estado

| Fase | Contenido                                                                     | Estado |
| ---- | ----------------------------------------------------------------------------- | ------ |
| 0    | Worktree, contratos, esqueleto del paquete                                    | ✅     |
| 1    | Paquete (A) · capa de datos + CI (B) · goldset + calibración (C)              | ✅     |
| 2    | Integración NestJS + juez remedial en sombra + migración `0036_decisions`     | ✅     |
| 3    | Calibración real contra Jev → [`docs/calibracion-jev.md`](calibracion-jev.md) | ✅     |
| 4    | Documentación + code review                                                   | ✅     |
| 5    | PR + CI verde                                                                 | ⏳     |

## Resultados de la calibración (2026-09-27, `jev-1.13.0`, instrucciones en español)

- **Juez remedial, `clave` (solve-then-check):** 97,7 % fuera de matemática (42/43, y el
  único error vino con confianza 0,48); **58,3 % en matemática**, con un error a
  confianza 0,97 (eligió el paso intermedio de una traslación + reflexión). Coincide
  con la advertencia de TypeSafe sobre aritmética: **matemática nunca en automático**.
- **Noul del juez:** `respuesta_unica` y `habilidad` separan bien (P(sí) media ≈ 0,9 en
  ítems válidos). `factual` no: sobre ítems oficiales válidos da P(sí) media ≈ 0,7 y
  12–17 % queda bajo 0,5. Hay que reformularla antes de usarla como gate.
- **Taxonomía (`hierarchicalChoice`):** la hoja coincide con el tag humano en 66,7 %
  (37,5 % en descriptores DIA y OA Mineduc; 71–73 % en PAES). Ningún umbral llega a
  95 % de exactitud por nivel: sirve como **sugerencia** para que una persona confirme,
  no para etiquetar solo.
- **Costo y latencia:** 258 llamadas, p50 ≈ 300 ms, p95 ≈ 450 ms, US$0,009 en total.

Recomendación: pasar `remedial_judge` a `shadow` en demo para juntar datos reales, y
evaluar `live` solo para `clave` fuera de matemática con umbral `auto >= 0,85`.

## Decisiones de diseño

1. **Módulo aparte de `LlmService`.** El contrato es "estado + preguntas tipadas →
   respuestas tipadas", no "prompt → texto". Meterlo como un `LlmProvider` más
   forzaría la interfaz.
2. **Nombre neutral: "decisions".** Jev es el adaptador (`JevDecisionEngine`). Si
   cambia el proveedor o la versión, los consumidores no se tocan (DIP, §4.1).
3. **Paquete sin NestJS ni BDD** (`packages/decisions`): lo usan la API, los
   scripts y los cargadores. La API agrega configuración, modos y registro.
4. **Tres modos por funcionalidad:** `off` (lanza `DecisionError('disabled')`),
   `shadow` (corre, registra, no decide), `live` (devuelve la respuesta). Default
   `off`: esta PR no cambia el comportamiento del producto.
5. **Modelo fijado por versión** (`jev-1.13.0`), no el alias `jev-latest`: los
   umbrales se calibran contra una versión.
6. **Nunca el estado en claro en la BDD:** se registra `sha256(state)`.
7. **Sin datos de alumnos hacia Jev** hasta firmar el DPA (Ley 19.628). El primer
   consumidor (juez remedial) solo ve ítems generados.

## Contratos compartidos

### Paquete `@soe/decisions` — `packages/decisions/src/contracts.ts`

Fuente de verdad de tipos, errores, límites y umbrales. **No se modifica sin
actualizar este documento.**

Archivos del paquete (dueño: subagente A):

| Archivo               | Exporta                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts.ts`        | (ya escrito) tipos, `DecisionError`, `DECISION_LIMITS`, umbrales                                                                         |
| `questions.ts`        | `noul()`, `choice()`, `score()` + `validateQuestions(questions)` + `estimateTokens(value)` + `assertWithinLimits(state, questions)`      |
| `jev/jev-engine.ts`   | `JevDecisionEngine` + `JevEngineConfig` (`apiKey?`, `baseURL?`, `defaultModel?` = `'jev-1.13.0'`, `timeoutMs?`, `maxRetries?`, `fetch?`) |
| `jev/jev-mapping.ts`  | Traducción request/response SDK ↔ contratos; errores SDK → `DecisionError`                                                               |
| `fake/fake-engine.ts` | `FakeDecisionEngine` (respuestas programables por id de pregunta o función; registra las llamadas)                                       |
| `routing.ts`          | `routeByConfidence(confidence, t)`, `routeNoul(probability, t)`, `assertValidThresholds`                                                 |
| `hierarchical.ts`     | `hierarchicalChoice(engine, opts)` — descenso codicioso por un árbol                                                                     |
| `redact.ts`           | `redactState(state) → { state, redactions }`                                                                                             |
| `index.ts`            | Re-exporta todo lo público. **No** re-exporta nada del SDK.                                                                              |

Semántica fijada:

- **Mapeo de respuestas Jev:** `noul` → `NoulAnswer.probability`; `choice` → igual;
  `score.probabilities` viene como mapa `{"0":p,"1":p}` → arreglo por índice;
  `level` = argmax (empate → el índice menor).
- **Errores del SDK:** `AuthenticationError`/`PermissionDeniedError` → `auth`;
  `RateLimitError` y status 529 → `rate_limited`; `APITimeoutError` → `timeout`;
  `BadRequestError`/`UnprocessableEntityError` → `invalid_request`; el resto → `upstream`.
- **Validación previa** (en `evaluate`, antes de la red): ≥1 pregunta; Choice con
  1..255 opciones; Score con 2..10 niveles; tokens estimados =
  `ceil(JSON.stringify(x).length / charsPerToken)`; `state` + pregunta más larga ≤
  32k y total ≤ 64k → si no, `context_exceeded`.
- **`isAvailable()`** = hay API key (config o `TYPESAFE_API_KEY`). Sin key, `evaluate`
  lanza `unavailable` **sin** construir el cliente del SDK (el constructor del SDK
  lanza si falta la key).
- **`routeByConfidence`**: `>= auto` → `auto`; `>= review` → `review`; si no, `reject`.
  **`routeNoul`**: `>= yes` → `yes`; `<= no` → `no`; si no, `uncertain`.
- **`redactState`**: recorre strings y objetos. Reemplaza por `'[redactado]'`: RUT
  (`\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b`), emails y el VALOR de las claves cuyo nombre
  (sin tildes, minúsculas) sea uno de `nombre, nombres, apellido, apellidos, name,
first_name, last_name, full_name, rut, email, correo, telefono, phone`.
  `redactions` = cantidad de reemplazos.
- **`hierarchicalChoice(engine, { state, instructions, tree, minConfidence, model? })`**:
  `tree: DecisionTreeNode[]` con `{ id, label, description?, children? }`. En cada
  nivel pregunta un Choice sobre los hijos; baja mientras `confidence >= minConfidence`
  y haya hijos. Devuelve `{ path: { id, confidence }[], stoppedBecause: 'leaf' |
'low_confidence' }` (el nodo de baja confianza NO entra al path). Más de 255
  hermanos → `invalid_request`.

### Tipos compartidos — `packages/types/src/schemas/decisions.schema.ts` (dueño: B)

```ts
export const DECISION_FEATURES = ['remedial_judge'] as const;   // se amplía agregando valores
export type DecisionFeature = (typeof DECISION_FEATURES)[number];
export const decisionFeatureSchema = z.enum(DECISION_FEATURES);

export const DECISION_MODES = ['off', 'shadow', 'live'] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];
export const decisionModeSchema = z.enum(DECISION_MODES);

export const decisionEngineIdSchema = z.enum(['jev']);
export type DecisionEngineId = z.infer<typeof decisionEngineIdSchema>;

// Umbrales por id de pregunta. Choice/Score usan { auto, review }; Noul usa { yes, no }.
export const confidenceThresholdsSchema = z.object({ auto: z.number().min(0).max(1), review: z.number().min(0).max(1) }).strict()
  .refine(t => t.review <= t.auto, ...);
export const noulThresholdsSchema = z.object({ yes: ..., no: ... }).strict().refine(t => t.no < t.yes, ...);
export const decisionThresholdsSchema = z.record(z.string(), z.union([confidenceThresholdsSchema, noulThresholdsSchema]));
export type DecisionThresholds = z.infer<typeof decisionThresholdsSchema>;

// Respuesta tal como se PERSISTE en decision_calls.answers (forma no genérica).
export const decisionAnswerRecordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), probability: z.number() }),
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number() }),
  z.object({ type: z.literal('score'), score: z.number(), level: z.number().int(), probabilities: z.array(z.number()), confidence: z.number() }),
]);
export type DecisionAnswerRecord = z.infer<typeof decisionAnswerRecordSchema>;

export interface DecisionFeatureDefault { engine: DecisionEngineId; model: string; mode: DecisionMode; thresholds: DecisionThresholds }
export const DECISION_FEATURE_DEFAULTS: Record<DecisionFeature, DecisionFeatureDefault> = {
  remedial_judge: { engine: 'jev', model: 'jev-1.13.0', mode: 'off', thresholds: {} },
};
```

Los schemas de objetos usan `.strict()` (z.object descarta claves desconocidas sin error).

### Tablas (dueño: B) — `packages/db/src/schema/decisions.ts`

**`decision_settings`** (patrón idéntico a `llm_settings`: `org_id` nullable = global):

| Columna                    | Tipo                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `id`                       | uuid PK defaultRandom                                                 |
| `org_id`                   | uuid NULL → organizations (cascade)                                   |
| `feature`                  | text NOT NULL `$type<DecisionFeature>`                                |
| `engine`                   | text NOT NULL default `'jev'` `$type<DecisionEngineId>`               |
| `model`                    | text NOT NULL                                                         |
| `mode`                     | enum `decision_mode` (`off`,`shadow`,`live`) NOT NULL default `'off'` |
| `thresholds`               | jsonb NOT NULL default `{}` `$type<DecisionThresholds>`               |
| `created_at`, `updated_at` | timestamp NOT NULL default now                                        |

Índices únicos parciales: `(feature) WHERE org_id IS NULL` y `(org_id, feature) WHERE org_id IS NOT NULL`.
RLS: lectura como `llm_settings` (`org_id IS NULL OR org_id = current_org_id`), pero el
`WITH CHECK` exige `org_id = current_org_id`: la API solo escribe overrides de su propia
org; las filas globales se escriben con el rol admin.

**`decision_calls`** (registro de cada llamada; bajo RLS por `org_id`):

| Columna                         | Tipo                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                            | uuid PK                                                                                 |
| `org_id`                        | uuid NOT NULL → organizations (cascade)                                                 |
| `feature`                       | text NOT NULL `$type<DecisionFeature>`                                                  |
| `engine`                        | text NOT NULL `$type<DecisionEngineId>`                                                 |
| `model`                         | text NULL (versionado; null si falló antes de responder)                                |
| `mode`                          | `decision_mode` NOT NULL (`shadow` o `live`)                                            |
| `status`                        | enum `decision_call_status` (`ok`,`error`) NOT NULL                                     |
| `error_code`                    | text NULL                                                                               |
| `answers`                       | jsonb NULL `$type<Record<string, DecisionAnswerRecord>>`                                |
| `baseline`                      | jsonb NULL `$type<Record<string, unknown>>` — lo que decidió el sistema actual (sombra) |
| `state_hash`                    | text NOT NULL (sha256 hex del JSON del estado)                                          |
| `correlation_id`                | text NULL (p. ej. id del material remedial)                                             |
| `input_tokens`, `output_tokens` | integer NOT NULL default 0                                                              |
| `latency_ms`                    | integer NULL                                                                            |
| `cost_usd`                      | numeric(14,9) NULL                                                                      |
| `created_at`                    | timestamp NOT NULL default now                                                          |

Índice: `(org_id, feature, created_at)`. Sin `updated_at` ni `deleted_at`: es un log inmutable.
RLS: solo políticas de `SELECT` e `INSERT` por `org_id = current_org_id`: para el rol de
la API, `UPDATE` y `DELETE` no afectan filas (log inmutable).

La migración NO la genera B: la genero yo al final, sobre `dev` actualizado.

### API — `apps/api/src/decisions/` (dueño: yo)

- `DecisionsModule` `@Global()`, exporta `DecisionsService`.
- `DecisionsService.evaluate(orgId, feature, request)` → modo `off` lanza
  `DecisionError('disabled')`; `shadow` lanza `DecisionError('disabled')` también
  (en sombra solo se usa `shadow()`); `live` devuelve el resultado y registra.
- `DecisionsService.shadow(orgId, feature, request, { baseline, correlationId })` →
  nunca lanza, nunca bloquea al llamador. Solo corre si el modo es `shadow` (en
  `live` el consumidor ya llama a `evaluate`; correr ambos duplicaría el costo) y el
  motor está disponible.
- Código de error extra `aborted`: la cancelación del llamador (`signal`) no cuenta
  como falla del proveedor.
- Limitador de concurrencia en proceso (máx. 8 llamadas simultáneas). La sombra se
  descarta si hay 16 o más en espera y usa un timeout de 5 s por defecto.
- `redactState()` se aplica al estado antes de llamar al motor (punto único de salida).
- La configuración se cachea 30 s por (org, funcionalidad): el juez consulta una vez por
  lote, no una vez por ítem.
- Registro en `decision_calls` dentro de `withOrgContext`.

### Otros archivos (dueño: B)

- `apps/api/src/llm/llm.pricing.ts`: entrada `{ prefix: 'jev-', inputUsd: 0.042, outputUsd: 0 }`
  y parámetro opcional `decimals = 6` en `estimateLlmCostUsd` (Jev necesita 9).
- `sst.config.ts`: `new sst.Secret("TypesafeApiKey", "")` → env `TYPESAFE_API_KEY` en la API.
- `.env.example`: `TYPESAFE_API_KEY=`.
- `.github/workflows/checks.yml`: job `decisions` (typecheck + tests) y build de
  `@soe/decisions` en "Build workspace deps" del job `api`.
- `apps/api/Dockerfile`: copiar y compilar `packages/decisions` antes de la API.

### Calibración (dueño: C) — `scripts/decisions/`

Goldsets sin datos de alumnos, en `scripts/decisions/data/` (gitignoreado):

- **Juez remedial:** ítems remediales generados. Verdad para `clave` = la
  alternativa `isCorrect`. Para `unico`/`factual`/`habilidad` solo hay acuerdo con el
  juez LLM (no es verdad).
- **Taxonomía:** ítems con tags confirmados por humanos → Choice jerárquico.

Script de corrida → `docs/calibracion-jev.md`: exactitud/acuerdo, tabla de
calibración por tramos de confianza, latencia p50/p95, costo.
