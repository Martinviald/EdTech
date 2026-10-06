# @soe/decisions — motor de decisiones

Evalúa un **estado** (texto o JSON) contra **preguntas tipadas** y devuelve una
respuesta tipada por pregunta, con probabilidades y confianza. No genera texto:
para eso está `LlmService`.

Hoy el único motor real es **Jev** (TypeSafe AI, `jev-1.13.0`). El adaptador vive en
`src/jev/` y es el **único** lugar del monorepo que importa `@typesafe-ai/sdk`.
Diseño y decisiones: [`docs/plan-integracion-jev.md`](../../docs/plan-integracion-jev.md).
Calibración con datos propios: [`docs/calibracion-jev.md`](../../docs/calibracion-jev.md).

## Tipos de pregunta

| Builder                                       | Responde                          | Trae `confidence` | Úsalo para                                   |
| --------------------------------------------- | --------------------------------- | ----------------- | -------------------------------------------- |
| `noul(instrucción, criterios?)`               | `probability` = P(sí)             | No                | Un sí/no literal                             |
| `choice(instrucción, { clave: descripción })` | `choice` + `probabilities`        | Sí                | Elegir 1 de un conjunto cerrado (≤ 255)      |
| `score(instrucción, [nivel0, nivel1, …])`     | `score`, `level`, `probabilities` | Sí                | Ubicar en una escala ordenada (2–10 niveles) |

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
`rate_limited`, `timeout`, …): el consumidor necesita un camino alternativo.
`shadow()` nunca lanza; llámalo con `void` para no bloquear el flujo principal.

Cada llamada queda en `decision_calls` con el **hash** del estado (nunca el estado en
claro), las respuestas, el modelo versionado, latencia, tokens y costo.

### Agregar una funcionalidad

1. Agrega su id a `DECISION_FEATURES` y su default a `DECISION_FEATURE_DEFAULTS`
   (`packages/types/src/schemas/decisions.schema.ts`), con `mode: 'off'`.
2. Arma las preguntas en un archivo propio del dominio (ejemplo:
   `apps/api/src/remedial/judge-decision.ts`), para que la calibración use las mismas.
3. Llama a `shadow()` junto al sistema actual, activa `shadow` con una fila en
   `decision_settings` y mide con `scripts/decisions/`.
4. Pasa a `live` solo con umbrales calibrados, y guárdalos en `thresholds`.

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

En tests usa `FakeDecisionEngine` (respuestas programables, registra las llamadas).

## Qué NO pedirle a Jev

Según su documentación ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13))
y nuestra calibración:

- **Aritmética, conteo y fechas.** Calcula en código. En matemática PAES acertó 58 %
  y falló con confianza 0,97: matemática nunca va en automático.
- **Varias decisiones en una pregunta.** Una decisión por pregunta; combina en código.
- **Estados grandes con ruido.** Filtra antes y manda solo lo que la pregunta necesita
  (límite: 32k tokens estado + pregunta, 64k en total).
- **Generar texto.** Para eso está `LlmService`.
- **Imágenes.** Solo acepta texto: transcribe antes.
- **Datos de alumnos**, hasta tener el DPA firmado (Ley 19.628). `redactState()` ayuda,
  pero no reemplaza esa decisión.

Además: los umbrales de un Noul no sirven para un Choice ni viceversa, y el modelo se
fija por versión (`jev-1.13.0`) porque `jev-latest` cambia sin aviso.
