# @soe/decisions — motor de decisiones

Evalúa un **estado** (texto o JSON) contra **preguntas tipadas** y devuelve una
respuesta tipada por pregunta, con probabilidades y confianza. No genera texto:
para eso está `LlmService`.

## Motores

| Motor (`name`) | Proveedor y modelo                                  | Imágenes          | Choice                       | Score | Contexto (estimado)              | Precio (USD / M tokens de entrada) | Adaptador     |
| -------------- | --------------------------------------------------- | ----------------- | ---------------------------- | ----- | -------------------------------- | ---------------------------------- | ------------- |
| `jev`          | TypeSafe AI, `jev-1.13.0` (versión fijada)          | Experimental (\*) | 1–255                        | 2–10  | 32k estado + pregunta, 64k total | 0,042                              | `src/jev/`    |
| `openai`       | OpenAI Decisions (beta), `gpt-6-luna` (sin versión) | Sí                | 2–255                        | 2–10  | ~900k en total                   | 0,10                               | `src/openai/` |
| `fake`         | `FakeDecisionEngine` para tests                     | Sí (configurable) | según `limits` (default Jev) |       |                                  | 0                                  | `src/fake/`   |

Cada adaptador es el **único** lugar del monorepo que importa el SDK de su proveedor
(`@typesafe-ai/sdk` en `src/jev/`, `openai` en `src/openai/`; la API usa además `openai`
en `OpenAiProvider` para generar texto). Cada motor expone `capabilities` y `limits`, y
`assertWithinLimits` valida contra los del motor antes de llamar. Se elige motor por
funcionalidad y por org con la columna `engine` de `decision_settings`, sin tocar código.

Diseño y decisiones: [`docs/plan-integracion-jev.md`](../../docs/plan-integracion-jev.md) y
[`docs/plan-integracion-openai-decisions.md`](../../docs/plan-integracion-openai-decisions.md)
(límites medidos de OpenAI en la Fase 0). Calibración con datos propios:
[`docs/calibracion-jev.md`](../../docs/calibracion-jev.md); la de OpenAI se genera con
`scripts/decisions/run-calibration.ts --engine openai`. Los umbrales **no** se transfieren
entre motores.

## Tipos de pregunta

| Builder                                       | Responde                          | Trae `confidence` | Úsalo para                                                |
| --------------------------------------------- | --------------------------------- | ----------------- | --------------------------------------------------------- |
| `noul(instrucción, criterios?)`               | `probability` = P(sí)             | No                | Un sí/no literal                                          |
| `choice(instrucción, { clave: descripción })` | `choice` + `probabilities`        | Sí                | Elegir 1 de un conjunto cerrado (≤ 255; OpenAI exige ≥ 2) |
| `score(instrucción, [nivel0, nivel1, …])`     | `score`, `level`, `probabilities` | Sí                | Ubicar en una escala ordenada (2–10 niveles)              |

## Desde la API (NestJS)

`DecisionsModule` es global: inyecta `DecisionsService` en cualquier servicio. Cada
funcionalidad (`DECISION_FEATURES` en `@soe/types`) tiene un modo en
`decision_settings`:

| Modo            | `evaluate()`                      | `shadow()`                                    |
| --------------- | --------------------------------- | --------------------------------------------- |
| `off` (default) | lanza `DecisionError('disabled')` | no hace nada                                  |
| `shadow`        | lanza `DecisionError('disabled')` | corre el motor y registra junto al `baseline` |
| `live`          | devuelve la respuesta y registra  | no hace nada                                  |

```ts
import { routeByConfidence } from '@soe/decisions';

const outcome = await this.decisions.evaluate(orgId, 'mi_funcionalidad', { state, questions });
const route = routeByConfidence(outcome.answers.clave.confidence, { auto: 0.9, review: 0.6 });
```

`evaluate()` **siempre** puede lanzar `DecisionError` (`disabled`, `unavailable`,
`rate_limited`, `timeout`, `refused`, …): el consumidor necesita un camino alternativo.
`refused` significa que el modelo se negó a responder al menos una pregunta (OpenAI lo
hace con contenido peligroso y también con preguntas sin sentido); no hay respuestas
parciales.
`shadow()` nunca lanza; llámalo con `void` para no bloquear el flujo principal.

Cada llamada queda en `decision_calls` con el **hash** del estado (nunca el estado en
claro; si hay imágenes, el hash incluye el de cada una), las respuestas, el modelo que
respondió, latencia, tokens y costo.

### Agregar una funcionalidad

1. Agrega su id a `DECISION_FEATURES` y su default a `DECISION_FEATURE_DEFAULTS`
   (`packages/types/src/schemas/decisions.schema.ts`), con `mode: 'off'`.
2. Arma las preguntas en un archivo propio del dominio (ejemplo:
   `apps/api/src/remedial/judge-decision.ts`), para que la calibración use las mismas.
3. Llama a `shadow()` junto al sistema actual, activa `shadow` con una fila en
   `decision_settings` y mide con `scripts/decisions/`.
4. Pasa a `live` solo con umbrales calibrados. Cuando la funcionalidad es para todos los
   colegios, el `live` va en el **default de código** (`DECISION_FEATURE_DEFAULTS`), no en
   filas por org: el colegio no configura nada (CLAUDE.md §8.4). Las filas quedan como
   override interno, y conviene sumar un interruptor de emergencia por env. Ejemplo:
   desambiguación de marcas, §14 de `docs/diseno-desambiguacion-marcas-ia.md`.

## Fuera de la API

Scripts y cargadores usan el paquete directo, sin NestJS:

```ts
import { JevDecisionEngine, choice } from '@soe/decisions';

const engine = new JevDecisionEngine(); // lee TYPESAFE_API_KEY
const result = await engine.evaluate({
  state,
  questions: { tipo: choice('…', { a: null, b: null }) },
});
```

(\*) Jev 1.13/1.14 acepta imágenes PNG o JPEG en fase experimental. El adaptador solo las
envía con `new JevDecisionEngine({ experimentalImages: true })` (en la API, prendido salvo
`JEV_EXPERIMENTAL_IMAGES=false`): manda el header `TypeSafe-Danger-Zone-Images`, inserta la
referencia en la clave reservada `imagen` del estado (o `imagenes`), descarga las `{ url }` y
ajusta cada imagen a las restricciones de Jev (lados de 280 a 1568 px; ver
`src/images/fit-image.ts`: el lado menor queda en 300 px, Lanczos, JPEG 92). El reescalado vive
en el adaptador porque depende del motor: ampliar un recorte chico ayuda a Jev y perjudica a
OpenAI. `sharp` (binario nativo) se carga recién en el primer ajuste, no al importar el paquete:
si no carga, la llamada falla con `DecisionError('unavailable')` y el proceso sigue vivo.

Con imágenes (solo motores con `capabilities.images`: `openai`, y `jev` con `experimentalImages`):

```ts
import { OpenAiDecisionEngine, noul } from '@soe/decisions';

const engine = new OpenAiDecisionEngine(); // lee OPENAI_API_KEY
const result = await engine.evaluate({
  state: { enunciado },
  images: [{ mimeType: 'image/png', data: base64 }, { url: presignedUrl }],
  questions: { legible: noul('¿La figura se lee bien?') },
});
```

Las imágenes van fuera de `state`: `redactState()` **no** las redacta. No mandes fotos
con datos de alumnos (una hoja de respuestas lleva nombre y RUT).

En tests usa `FakeDecisionEngine` (respuestas programables, registra las llamadas).

## Qué NO pedirle a un motor de decisiones

Según su documentación ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13))
y nuestra calibración:

- **Aritmética, conteo y fechas.** Calcula en código. En matemática PAES acertó 58 %
  y falló con confianza 0,97: matemática nunca va en automático.
- **Varias decisiones en una pregunta.** Una decisión por pregunta; combina en código.
- **Estados grandes con ruido.** Filtra antes y manda solo lo que la pregunta necesita
  (límite: 32k tokens estado + pregunta, 64k en total).
- **Generar texto.** Para eso está `LlmService`.
- **Imágenes a Jev sin interruptor.** Son experimentales: sin `experimentalImages` el
  adaptador lanza `invalid_request`. Recalibra al cambiar de versión de Jev.
- **Datos de alumnos**, hasta tener el DPA firmado (Ley 19.628). `redactState()` ayuda,
  pero no reemplaza esa decisión.

Además: los umbrales de un Noul no sirven para un Choice ni viceversa, y el modelo de
Jev se fija por versión (`jev-1.13.0`) porque `jev-latest` cambia sin aviso. OpenAI no
publica versiones de `gpt-6-luna`: una recalibración puede ser necesaria sin aviso.
