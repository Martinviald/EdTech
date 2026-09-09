# Pendientes del registro de burbujas — bitácora (backend, tipos, web)

> Plan y compuertas: `analisis-omr-marcas/plan-pendientes-omr.md` (fuera del repo). Las fases que
> tocan el motor se anotan en `services/omr/goldset/README-registro.md`; acá van las de backend,
> tipos y web, con la evidencia de no regresión de cada ciclo.

## Instrumentos (todos deben quedar como estaban o mejor, cada ciclo)

| capa | comando | línea base 2026-09-08 (`origin/dev` `6cbe52c`) |
|---|---|---|
| tipos | `pnpm --filter @soe/types test` | 394 tests, 28 suites |
| backend | `cd apps/api && pnpm exec jest src/sheet-scanning` | 377 tests, 25 suites (+ e2e skipped sin `RUN_OMR_ROUNDTRIP`) |
| backend | `cd apps/api && pnpm exec jest` | 1509 tests, 134 suites; `privacy.service.spec.ts` es integración contra la BD local y falla de forma intermitente en la corrida completa (pasa solo) — preexistente |
| backend | `pnpm exec tsc --noEmit -p tsconfig.typecheck.json` · `eslint src/sheet-scanning` | sin errores |
| motor | `pytest -q` · `goldset.make_synthetic --run` · `goldset.run goldset/real` | 253 · 97.57 % / 2.26 % / 1 · 194 / 26 / 0 |

---

### 2026-09-08 · fase 1 · A4 — persistir el diagnóstico del motor

**Cambio (sin tocar decisiones ni el motor):**
- `packages/types` (`omr-scan.schema.ts`): `pageDiagnosticsSchema`, `scanDebugSchema`,
  `ScanReadResult` / `ScannedPageWithDiagnostics`, `REGISTRATION_ALERT_OFF_MEDIAN_PX = 10`,
  `REGISTRATION_ALERT_FALLBACK_RATIO = 0.1`. `sheet-scanning.schema.ts`: `BatchDiagnosticsModel`
  (opcional en `BatchStatusModel`, solo en el detalle) y `RegistrationMetricsModel` en
  `SheetScanMetricsResponse`.
- `packages/db`: `sheet_scans.diagnostics jsonb` (nullable) — migración
  `0031_gifted_frightful_four.sql` (`ALTER TABLE ... ADD COLUMN`), aplicada en la BD local con
  `db:migrate` (RLS re-aplicado).
- `apps/api`: `HttpOmrClient.read` pide `/v1/read?debug=1`, acepta `{ result, debug }` o el
  `ScanResult` a secas, empareja el debug por `pageIndex` y **descarta con warning** un debug
  inválido sin bloquear la lectura. `OmrClient.read` devuelve `ScanReadResult` (el fake de los
  specs sigue devolviendo `ScanResult`, que es asignable). `persistPage` guarda `diagnostics`.
  `getBatch` agrega `diagnostics` **al final** del flujo (una query más, nunca en medio de
  `loadCounters`: los fakes de BD entregan los `select` por posición). `SheetScanMetricsService`
  agrega `registration` (avg/max de desplazamiento, páginas con fallback, páginas sobre alerta),
  también con la query al final.

**Pruebas nuevas:** cliente HTTP (3: empareja, descarta inválido, página sin debug); persistencia
(`diagnostics: null` en el insert cuando el fake no lo trae); métricas (2: vacío y agregado).

**No regresión:**

| instrumento | resultado |
|---|---|
| `@soe/types` | 394 / 394 |
| `jest src/sheet-scanning` | 380 / 380 (25 suites) |
| `jest` completo | 1508 / 1510; los 2 fallos son `privacy.service.spec.ts` (integración contra BD local, pasa solo) |
| typecheck API · eslint `sheet-scanning` | sin errores |
| e2e `round-trip` contra el OMR real (`RUN_OMR_ROUNDTRIP=1`) | 12 / 12 — el servicio real responde `{ result, debug }` y el cliente lo empareja; venv recreado desde `requirements.lock.txt` (el anterior desapareció de todas las copias durante el ciclo) |

**Compuerta 1:** los endpoints existentes no cambian de forma (campos nuevos opcionales); migración
aditiva y reversible; `diagnostics` poblado se verifica en demo con el humo real después del
despliegue.

**Retroceso:** dejar de pedir `?debug=1` (una línea en `omr-http.client.ts`); la columna queda vacía.

Decisión: **avanza** a fase 2 (A1, motor).
