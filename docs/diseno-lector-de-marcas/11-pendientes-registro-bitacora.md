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

---

### 2026-09-09 · fase 4 · contrato v2 — `suggestedValue`, `doubtReason`, `nullConfidence`

**Cambio (aditivo en todas las capas, ninguna decisión cambia):**
- `packages/types` (`omr-scan.schema.ts`): `DOUBT_REASONS = ['margin', 'band', 'multiple']` y
  los tres campos **opcionales y nullables** en `markReadingSchema`; `ReviewMarkModel` los expone
  (`null` con un motor v1 o cuando no aplican). JSON Schema regenerados con
  `pnpm --filter @soe/types gen:omr-contracts` (el generador también incorporó `formId` en
  `layout-spec` / `read-request` / `assess-request`, que ya estaba en Zod y faltaba en los JSON).
  `scan-result.example.json` trae una `ambiguous` con sugerencia y una `multiple` con confianza;
  `omr-contract-examples.spec` valida el ejemplo con y sin los campos, y rechaza un
  `doubtReason` desconocido o una `nullConfidence` fuera de 0–1.
- `packages/db`: `sheet_scan_marks.suggested_value text`, `doubt_reason text`,
  `null_confidence numeric(4,3)` — migración `0032_flowery_rogue.sql` (tres `ADD COLUMN`
  nullables), aplicada en la BD local con `db:migrate`.
- `apps/api`: `persistPage` guarda los tres campos (`?? null`: un motor v1 no los trae);
  `GET :id/review` y `PATCH :id` los devuelven en cada `ReviewMarkModel`. Ninguna query nueva,
  solo columnas en los `select` existentes (los fakes por posición no cambian).
- Motor: `app/readers.py` los calcula (`OMR_CONTRACT_V2`, default encendido) — detalle y
  calibración en `services/omr/goldset/README-registro.md` (pendientes fase 4).
- Web: sin cambios (fase 5).

**Pruebas nuevas:** motor 17 (`tests/test_contract_v2.py`, más la forma v1 en `test_contract.py`);
tipos 2; backend 2 (persistencia con y sin campos; cola con campos y con un motor v1); e2e 1
(el motor real emite los campos y el cliente HTTP los conserva).

**No regresión:**

| instrumento | resultado |
|---|---|
| `@soe/types` | 396 / 396 |
| `jest src/sheet-scanning` | 382 / 382 (25 suites) |
| typecheck API · eslint `sheet-scanning` · prettier | sin errores |
| e2e `round-trip` contra el OMR real (`RUN_OMR_ROUNDTRIP=1`) | 13 / 13 |
| motor | 277 · sintético sin cambio de decisión · real 275 / 33 / 0; sugerencias 4 / 4 correctas |

**Compuerta 4:** la cola de revisión es idéntica (mismos estados, mismo orden por `margin`); los
campos nuevos viajan en `ReviewMarkModel` sin que la web los use todavía. El orden de despliegue
§1.4 se cumple por construcción: motor viejo + backend nuevo → `null`; motor nuevo + backend viejo
→ Zod descarta las claves desconocidas. Verificar en demo con el humo real que `suggested_value`
queda poblado en las revisiones por margen.

**Retroceso:** `OMR_CONTRACT_V2=0` en el motor; las columnas quedan en `null`.

Decisión: **avanza** a fase 5 (B1, backend y web).

---

### 2026-09-09 · fase 5 · B1 — revisión sí/no con la alternativa sugerida

**Cambio (detrás de un interruptor por org, apagado por defecto):**
- `packages/types`: `orgConfigSchema.review.quickConfirm` (`orgReviewSettingsSchema`) e
  `isQuickConfirmEnabled(config)`; `reviewMarkSchema` acepta `{ decision: 'confirm' }`;
  `ReviewQueueModel.settings.quickConfirm`; `SheetScanMetricsResponse.suggestions`
  (`marksWithSuggestion`, `reviewed`, `confirmed`, `rejected`).
- `apps/api`: `PATCH /sheet-scan-marks/:id` con `confirm` persiste **`option` con
  `reviewedValue = suggestedValue`** (misma fila, misma semántica; `POST :id/confirm` del lote no
  cambia); una marca sin sugerencia responde 400 sin escribir. `getQueue` toma
  `organizations.config` en la misma query del lote (un `innerJoin`, ninguna query nueva) y expone
  `settings`. Métricas: una query más **al final** que mide cuántas sugerencias ya revisadas
  coincidieron con la decisión humana (por Sí o eligiendo la misma letra) y cuántas no; la tasa de
  "no" sostenida cerca de 0 es la señal para la fase 6a.
- `apps/web`: `MarkReviewPanel` recibe `quickConfirm`; con el flag y una marca `ambiguous` con
  `suggestedValue`, muestra el recorte y "¿Es la **B**?" con **Sí** (`S`) / **No** (`N` o `Esc`);
  al No se abre el panel de siempre (alternativas, en blanco, anulada). Las letras de alternativa
  siguen resolviendo directo también en modo rápido; la tecla `N` de "anulada" queda para después
  del No (el pie de teclas lo dice). Dobles y blancos dudosos (sin sugerencia) → panel actual sin
  cambios. `useResolveMark` refleja `confirm` de forma optimista como `option` con la sugerencia.
  Etiquetas del motivo de duda en `review-labels.ts`.

**Pruebas nuevas:** backend 5 (`confirm` con y sin sugerencia; `settings` encendido/apagado;
métricas de sugerencias con datos y en cero) y el spec del controller de métricas con el campo
nuevo. Web: no hay corredor de tests de componentes en `apps/web` (sin `test` script ni RTL); la
verificación es la CI de PR (typecheck, lint, guard del Design System, `next build`).

**No regresión:**

| instrumento | resultado |
|---|---|
| `@soe/types` | 396 / 396 |
| `jest src/sheet-scanning` | 387 / 387 (25 suites) |
| typecheck API · eslint `sheet-scanning` · prettier | sin errores |
| web `typecheck` · `lint` (`ESLINT_USE_FLAT_CONFIG=false`: el ESLint 9 local no lee `.eslintrc.json`; única advertencia preexistente en `getCurrentOrg.ts`) · `lint:ds` · `next build` (`AUTH_MODE=sso`) | sin errores; `/hojas/lotes/[batchId]/revisar` compila |

**Compuerta 5 (pendiente de demo):** con el flag encendido y apagado, la cola del humo real trae
las mismas marcas y `sheet_scan_marks` termina con las mismas decisiones; sólo cambia cuántas
teclas costó. Encender para la org demo:

```sql
update organizations
set config = coalesce(config, '{}'::jsonb) || '{"review": {"quickConfirm": true}}'::jsonb
where id = '<orgId>';
```

**Retroceso:** flag de org apagado (o ausente); el backend sigue aceptando `confirm` sin efecto
sobre nada más.

Decisión: **avanza** a fase 6a (A3, medición sobre `dirty`).
