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
