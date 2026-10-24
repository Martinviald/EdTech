# Calibración del motor de decisiones (Jev)

Goldsets y script de calibración de `@soe/decisions`. Ver `docs/plan-integracion-jev.md` (sección "Calibración").

`tsx` no está en la raíz: se usa el de `packages/db`. El `--tsconfig` resuelve `@soe/decisions` al código fuente (el paquete no necesita `dist`).

```bash
TSX=packages/db/node_modules/.bin/tsx

# 1. Goldsets (solo lectura de la BDD LOCAL; se niega a leer otra cosa que localhost)
$TSX scripts/decisions/extract-goldsets.ts

# 2. Probar el flujo sin API key (motor falso, números sin sentido)
$TSX --tsconfig scripts/decisions/tsconfig.json scripts/decisions/run-calibration.ts --engine fake --limit 5

# 3. Calibración real (necesita TYPESAFE_API_KEY en el entorno o en repositorio/.env)
$TSX --tsconfig scripts/decisions/tsconfig.json scripts/decisions/run-calibration.ts \
  --engine jev --set all --concurrency 4
```

Flags de `run-calibration.ts`: `--engine jev|fake` (default `jev`), `--set remedial|taxonomy|all` (default `all`), `--limit N` (por set), `--concurrency N` (default 4), `--out ruta.md`.

## Salidas

- `scripts/decisions/data/goldset-remedial.json`, `goldset-taxonomy.json`: goldsets (gitignoreados: traen contenido de pruebas DIA/PAES).
- `scripts/decisions/data/results-<fecha>.json`: respuestas crudas por ítem y por llamada.
- `docs/calibracion-jev.md`: reporte (solo con `--engine jev`; con `fake` el reporte queda en `data/`).

## Qué mide

- **Juez remedial:** usa `buildJudgeDecision` de `apps/api/src/remedial/judge-decision.ts` tal cual. Verdad de `clave` = alternativa `isCorrect` (el juez no la ve). Los Noul (`respuesta_unica`, `factual`, `habilidad`) solo se comparan con el veredicto guardado del juez LLM (`remedial_materials.quality_report`), que no es verdad. El set se completa con ítems del banco (sin figura, clave única) porque hay pocos ítems remediales.
- **Taxonomía:** `hierarchicalChoice` por dimensión (taxonomía × tipo de nodo etiquetado: OA, habilidad, eje, descriptor, tipo de texto) contra los tags `tagged_by = 'human'` de ítems sin tags IA. Desciende hasta la hoja con `minConfidence = 0` y simula los umbrales después.
- Tablas de calibración por tramos de confianza, cobertura vs exactitud, latencia p50/p95, tokens y costo (0.042 USD por millón de tokens de entrada). Matemática va aparte: la aritmética es un punto débil documentado de Jev.

Las instrucciones van en español (Jev rinde mejor en inglés; medimos el idioma del producto).

## Desambiguación de marcas (`run-mark-replay.ts`)

Replay de la PoC de marcas (`analisis-omr-marcas/poc-decisions-2026-10-21/`, 100 recortes con verdad conocida) con el builder de producción (`apps/api/src/sheet-scanning/mark-disambiguation-decision.ts`) y los adaptadores reales: Jev `jev-1.14.0` con imágenes experimentales y OpenAI `gpt-6-luna`. Simula `pairConsensus` con los umbrales provisorios de §7.2 del diseño y el veto de dominio. Es el gate de §4.4 antes de activar la sombra y de subir de versión un modelo.

```bash
$TSX --tsconfig scripts/decisions/tsconfig.json scripts/decisions/run-mark-replay.ts \
  [--poc ruta/a/poc-decisions-2026-10-21] [--limit N] [--concurrency 4] [--engine jev|openai|both]
```

Necesita `TYPESAFE_API_KEY` y `OPENAI_API_KEY`. Una corrida completa cuesta menos de US$0,02. Deja el JSON crudo en `scripts/decisions/data/mark-replay-<fecha>.json`.

## Calibración de marcas en sombra (`run-mark-calibration.ts`)

Mide, con las marcas que ya pasaron por sombra, si los umbrales de `pairConsensus` son seguros para pasar a `live` (§7.3 del diseño). Une `decision_calls` (features `mark_disambiguation_jev` y `mark_disambiguation_openai`, por `correlation_id = sheet_scan_marks.id`) con `sheet_scan_marks` y simula el combinador, más el veto de dominio (OMR `multiple` + IA `blank` va a revisión).

```bash
$TSX --tsconfig scripts/decisions/tsconfig.json scripts/decisions/run-mark-calibration.ts \
  [--org <uuid>] [--step 0.05] [--max-errors 1] [--out ruta.md]
```

- Solo lee una BDD LOCAL (en una transacción `read only`); se niega a conectar a cualquier otra. Usa `DATABASE_ADMIN_URL` o `DATABASE_URL`. Si el rol respeta RLS, pasa `--org`.
- Verdad humana: `reviewToMarkAnswer(review_decision, reviewed_value)` con `reviewed_by_id` no nulo. Las auto-anuladas por el OMR (sin IA aplicada) son verdad débil y se reportan aparte; nunca cuentan como errores.
- Reporta, para los umbrales provisorios (Jev 0,60/0,85/0,50; OpenAI 0,50/0,80/0,50) y para la mejor combinación de la grilla por cobertura con a lo más `--max-errors` errores: cobertura, errores, cota superior al 95 % (regla de tres, 3/n, con 0 errores; Wilson si hay errores), fallas y latencia p50/p95 por motor, y los cortes obligatorios (nulas, blancos, marcas débiles, `multiple`, escáner vs celular, campos con 5 o más opciones).
- La grilla respeta `0 <= unsure <= agree <= solo <= 1`. Con paso 0,05 son unos 3 millones de combinaciones; la búsqueda usa un evaluador equivalente y verifica el resultado final contra `pairConsensus`.
- Para decidir `live` necesitas al menos 300 automáticas simuladas con verdad humana, a lo más 1 error y ningún corte con n >= 30 y errores.
- Salida (gitignoreada): `scripts/decisions/data/mark-calibration-<fecha>.md` y `.json`.
