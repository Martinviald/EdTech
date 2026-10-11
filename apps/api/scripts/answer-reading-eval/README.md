# Arnés de evaluación offline de la lectura por visión

`answer-reading:eval` mide una **ruta de lectura** (lectores + prompts + política de consenso)
sobre un dataset etiquetado, con **el mismo código que producción**: registro de formatos,
prompts versionados (`renderTranscriptionPrompt`), esquema de salida (`transcriptionJsonSchema`),
normalización, `evaluateConsensus` (con desempate si la política lo usa) y la estrategia de
corrección `short_answer`. Es obligatorio antes de promover un prompt, un modelo o un proveedor
(diseño §6.5 y §12).

## Uso

```bash
# Simulación: transcriptor falso que "lee" la etiqueta. No llama a ninguna API.
pnpm --filter @soe/api answer-reading:eval \
  --dataset scripts/answer-reading-eval/fixtures --dry-run

# Corrida real (exige --budget-usd)
pnpm --filter @soe/api answer-reading:eval \
  --dataset "../../../pruebas-vlm-manuscrito/fotos" \
  --route scripts/answer-reading-eval/routes/default.json \
  --repetitions 1 --budget-usd 0.5 --concurrency 2 \
  --out "../../../pruebas-vlm-manuscrito/resultados/eval-2026-10-11" \
  --compare "../../../pruebas-vlm-manuscrito/resultados/eval-baseline/informe.json"
```

| Opción                     | Qué hace                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dataset <dir>`          | Carpeta con `manifest.json` y las imágenes (obligatoria).                                                                                                                                                                    |
| `--route <archivo.json>`   | Una `ReadingRoute` (contrato `readingRouteSchema` de `@soe/types`). Por defecto `routes/default.json`: Claude Haiku 5.5 + Gemini 3.5 Flash-Lite, `transcribe.short-answer@2`, `DEFAULT_CONSENSUS_POLICY`.                    |
| `--repetitions <n>`        | Lecturas por muestra; con más de una se mide la estabilidad.                                                                                                                                                                 |
| `--budget-usd <x>`         | Tope de gasto. Antes de cada muestra se reserva su costo estimado (peor caso con las tarifas del catálogo, o 1,25 × el máximo observado por lector) y la corrida se detiene antes de superarlo. Obligatorio sin `--dry-run`. |
| `--concurrency <n>`        | Muestras en paralelo (los lectores de una muestra siempre van en paralelo).                                                                                                                                                  |
| `--out <dir>`              | Carpeta de salida. Por defecto, una carpeta temporal. Los resultados de datos reales van **fuera del repo**.                                                                                                                 |
| `--dry-run`                | Usa `FakeTranscriber` de `@soe/answer-reading`.                                                                                                                                                                              |
| `--compare <informe.json>` | Compara contra un informe anterior: deltas por métrica y muestras que cambiaron.                                                                                                                                             |

Las llamadas reales pasan por `LlmService.completeStructured` con `target` dentro de un contexto
Nest standalone (sin HTTP). El catálogo de modelos se arma en memoria con los lectores de la ruta
y las tarifas de `llm.pricing.ts`: el arnés no lee ni escribe la base de datos. Las claves salen
del `.env` de la raíz (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`).

## Formato del dataset

```json
{
  "manifestVersion": 1,
  "name": "recortes-vlm-manuscrito",
  "datasetVersion": "1",
  "description": "opcional",
  "samples": [
    {
      "id": "recorte-14",
      "image": "recorte-14.jpg",
      "format": { "kind": "decimal", "maxChars": 6, "allowNegative": false },
      "label": { "state": "answered", "literal": "02,5" },
      "acceptedAnswers": ["2,5"],
      "scoringConfig": { "points": 1 },
      "gradeName": "6° básico",
      "tags": { "handwriting": "child" }
    }
  ]
}
```

- `image`: ruta **relativa** dentro del dataset (`.jpg`, `.jpeg` o `.png`).
- `format`: un `ResponseFormat` (`responseFormatSchema`). Los formatos que el registro todavía no
  atiende (por ejemplo `short_text` antes de F10a) se omiten con `unsupported_format`.
- `label.state`: `answered`, `blank`, `illegible`, `crossed_out_only` o `multiple_answers`. Una
  respondida lleva `literal`; una en blanco, literal vacío.
- `label.canonical` (opcional): clave canónica esperada. Si falta, se calcula normalizando el
  literal con el registro de formatos.
- `acceptedAnswers` y `scoringConfig` (opcionales): activan la medición de la corrección con la
  estrategia de producción. Sin clave, el consenso usa la etiqueta como clave implícita (una
  alternativa plausible que cambia la lectura cuenta como "cambia el resultado").
- `gradeName` (opcional): se pasa al prompt como contexto, igual que en producción.
- `tags`: texto libre para estratificar (`handwriting: adult | child`, origen, etc.).

El validador es `evalManifestSchema` / `parseEvalManifest` de `@soe/answer-reading`.

## Métricas (diseño §12.2)

- **Precisión de lo autoaceptado**: lecturas autoaceptadas (`auto_accepted` y `auto_blank`) cuyo
  valor coincide con la etiqueta. Es el criterio de promoción (meta 99,5 %).
- Tasa de autoaceptación, de revisión (y por motivo) y de casillas sin leer. La auditoría muestral
  de la política se ignora: se mide todo lo que se autoaceptaría.
- Exactitud de transcripción por lector y por formato: la clave canónica de la lectura es igual a
  la de la etiqueta (`2,5` = `2.50`; `2/4` ≠ `1/2`).
- **Sobrecorrección**: el lector "arregló" lo escrito. `equivalent_rewrite` = mismo valor con otra
  escritura (coma ↔ punto, ceros a la izquierda o a la derecha, fracción simplificada, fracción ↔
  decimal); `fixed_to_key` = la etiqueta es incorrecta según la clave y la lectura es correcta.
- Acuerdo entre lectores y exactitud cuando coinciden; estabilidad entre repeticiones.
- Exactitud de la corrección y error de resultado entre autoaceptadas (si hay `acceptedAnswers`).
- Costo total, por recorte y por 1.000 recortes; latencia p50/p95 por lectura.

## Salida

- `informe.json`: metadatos de la corrida, métricas y, por muestra, cada lectura (lector,
  repetición, estado, literal, canónica, confianza, alternativas, costo, latencia, acierto y
  sobrecorrección) y cada decisión del consenso.
- `resumen.md`: resumen legible con tablas por decisión, motivo, formato, lector y muestra.
- `comparacion.json` (con `--compare`): deltas por métrica y muestras que cambiaron.

## Fixtures sintéticos

`fixtures/` tiene casillas dibujadas por código (sin datos personales). Para regenerarlas:

```bash
pnpm --filter @soe/api exec tsx scripts/answer-reading-eval/generar-fixtures.ts
```

Un test (`run-eval.spec.ts`) verifica que los PNG y el `manifest.json` en disco coinciden con el
generador y corre `--dry-run` sobre ellos.
