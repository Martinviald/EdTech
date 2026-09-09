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

---

### 2026-09-09 · fase 6a · A3 — tierra de nadie: medida, no se cambia

Sólo motor: `tools/measure_band.py` y la tabla en `app/classify.py`. Con `max(3σ, 0.12)` las 4
marcas claras de Bruno dejarían de ir a revisión, pero un dígito RUT relleno a medias infla
`σ_high` y se lee como marcado (identidad con un dígito inventado). Se mantiene `max(2σ, 0.12)`;
detalle en `services/omr/goldset/README-registro.md`. Suite 283; sintético y real idénticos.

---

### 2026-09-09 · fase 6b · B2 — nula automática con confianza alta

**Costo medido antes de implementar** (`README-registro.md`, ciclo 6b-1): con umbral 0.9, las 4
dobles plenas de Diego se anulan solas y **ninguna** marca con respuesta verdadera única lo
haría, ni en real ni en sintético; Bruno q12 (0.10–0.14) y el borrón sintético (0.0) siguen en
la cola.

**Cambio (detrás de `organizations.config.review.autoAnnulMinConfidence`, ausente = apagado):**
- `packages/types`: `autoAnnulMinConfidence(config)`, `AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE = 0.9`;
  `ReviewMarkModel.autoResolved`; `ReviewQueueModel.autoAnnulled` y
  `settings.autoAnnulMinConfidence`.
- `packages/db`: `sheet_scan_marks.auto_resolved boolean not null default false` — migración
  `0033_lowly_eternity.sql`, aplicada en local.
- `apps/api`: el contexto del job toma `organizations.config` en la misma query del lote (un
  `innerJoin`); al persistir, una `multiple` con `nullConfidence ≥` umbral se guarda con
  `reviewDecision = annulled`, `reviewedAt`, `reviewedById = null` y `autoResolved = true`. El
  motor no cambia de decisión (`state` sigue `multiple`). No entra a la cola (`reviewedAt` ya
  filtra en `finalizeBatch`, `recountReviewPending` y la cola) y `POST :id/confirm` la cuenta como
  anulada (`reviewedAt !== null` → `annulledLabels`), igual que si la hubiera anulado una persona.
  `GET :id/review` la expone en `autoAnnulled` (query nueva **al final**, con su recorte firmado);
  cualquier `PATCH :id` la vuelve decisión humana (`autoResolved = false`).
- `apps/web`: `isMarkResolved` pasa a "tiene decisión" (humana o automática); el panel lista las
  automáticas al final con la etiqueta "Nula automática · confianza 0.98", la opción Anulada
  seleccionada y una nota; un callout en el paso de marcas dice cuántas se anularon solas. Las
  optimistas y el rollback del hook cubren ambas listas.

**Pruebas nuevas:** backend 4 (persistencia con umbral: evidente se anula, dudosa no; sin ajuste
nada se anula; cola con `autoAnnulled` y recorte; corregir una automática). Web: CI de PR.

**No regresión:**

| instrumento | resultado |
|---|---|
| `@soe/types` | 396 / 396 |
| `jest src/sheet-scanning` | 391 / 391 (25 suites) |
| typecheck API · eslint · prettier | sin errores |
| web `typecheck` · `lint` · `lint:ds` · `next build` | sin errores (misma advertencia preexistente) |

**Compuerta 6b (pendiente de demo):** con el ajuste en 0.9, el humo real deja a Diego q11/q14/q16/q20
como nulas automáticas y a Bruno q12 en la cola; las notas del lote no cambian respecto de
anularlas a mano. Encender:

```sql
update organizations
set config = coalesce(config, '{}'::jsonb) || '{"review": {"autoAnnulMinConfidence": 0.9}}'::jsonb
where id = '<orgId>';
```

**Retroceso:** quitar el ajuste (o ponerlo en `1`); las marcas ya anuladas quedan como están y se
pueden corregir desde el panel.

Decisión: **avanza** a fase 7 (A5), que depende del material del equipo.

---

### 2026-09-09 · fase 7 · A5 — material y limpieza: qué queda abierto

| punto del plan | estado |
|---|---|
| Sumar las 4 fotos del 2026-09-05 a `goldset/real` con la verdad de Diego actualizada | **hecho** en la fase 3 (`*-20260905`, 14 hojas en el corte real) |
| Re-medir `BLANK_SHEET_MAX_FILL` con 7 fotos en blanco + 3 con tinta | **pendiente de material**: no hay fotos de hojas sin marcar en el repo ni fuera; el umbral sigue marcado como "pendiente de calibración" en `pageQualitySchema.marksReadability` |
| Corte `real-phone` con `identity.mode = rut_bubbles` y validación de la grilla registrada por columna | **pendiente de material**: no hay capturas reales con grilla RUT |
| Retirar `OMR_LOCAL_REGISTRATION` y `sample_bubble_fills_at_spec` del lector de marcas | **pendiente de observación**: requiere dos semanas sin alertas en `sheet_scans.diagnostics` (métricas `registration.offsetAlertPages` / `fallbackAlertPages`, fase 1) en demo |

Cuando llegue el material, el ciclo es el de siempre: fotos con verdad en `goldset/real`, medir
con `tools/measure_registration.py` (y `tools/measure_band.py` si toca la banda), tabla en el
docstring de la constante, suite + barrido + real, entrada aquí.
