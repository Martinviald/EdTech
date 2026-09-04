# E22 — Contratos del Lector de Marcas (MVP)

> **CONGELADO en Fase 0.** Todo agente de F1–F3 lee este documento COMPLETO antes de
> escribir código. Cambiar un contrato de acá no es un ajuste silencioso: es una excepción
> que reabre la Fase 0. El diseño de fondo vive en `docs/diseno-lector-de-marcas/`
> (decisiones D1–D18, gaps G1–G8, componentes C1–C21) y el plan de ejecución en
> `docs/plan-desarrollo-lector-de-marcas.md`. Nada de eso se re-litiga.

---

## 0. Setup obligatorio de cada agente (PRIMERA instrucción, siempre)

```
SETUP (ejecutar PRIMERO, desde la raíz del repo de tu worktree):
1. git fetch origin && git merge e22-lector-mvp --no-edit
   (o `git reset --hard e22-lector-mvp` si tu árbol está limpio)
   Verifica con `git log --oneline -3` que ves el commit de contratos E22.
2. pnpm install
   pnpm --filter @soe/types build
   pnpm --filter @soe/db build
3. Sólo entonces: lee docs/e22-lector-contracts.md COMPLETO y los docs de diseño
   que tu workstream indica. Después codea.
```

**Recursos de la máquina (8 GB de RAM):** un solo proceso pesado a la vez. Corre tu
`npx tsc --noEmit` / `pytest` UNA vez, al FINAL de tu trabajo; antes de lanzarlo ejecuta
`pgrep -fl "tsc|vitest|jest|pytest"` y si hay otro corriendo, espera a que termine.

**Commit obligatorio:** antes de terminar, `git add -A && git commit`. Un worktree sin
commit se borra automáticamente y TODO el trabajo se pierde.

---

## 1. Dónde viven los contratos (ya implementados, no redefinir)

| Pieza | Archivo | Qué exporta |
|---|---|---|
| `LayoutSpec`, `CaptureProfile`, `DEFAULT_CAPTURE_PROFILES` | `packages/types/src/schemas/omr-layout.schema.ts` | `layoutSpecSchema`, `captureProfileSchema`, tipos |
| `ScanResult`, `MarkReading`, `PageQuality`, `OmrReadRequest` | `packages/types/src/schemas/omr-scan.schema.ts` | `scanResultSchema`, `omrReadRequestSchema`, `MARK_STATES`, `PAGE_REJECT_REASONS` |
| DTOs + Models REST del módulo | `packages/types/src/schemas/sheet-scanning.schema.ts` | ver §3 |
| Hash canónico (D6) | `packages/types/src/utils/layout-hash.ts` | `layoutHash(spec)` → 16 hex |
| Payload del QR (§3.2 del diseño) | `packages/types/src/utils/omr-qr.ts` | `buildOmrQrPayload` / `parseOmrQrPayload` |
| Roles | `packages/types/src/access-policies/sheet-scanning.ts` | `SHEET_MANAGEMENT_ROLES`, `SHEET_REVIEW_ROLES` |
| Tablas Drizzle (6) + relations | `packages/db/src/schema/sheet-scanning.ts` | `sheetLayouts`, `sheetPrintRuns`, `printedSheets`, `sheetScanBatches`, `sheetScans`, `sheetScanMarks` |
| RLS | `packages/db/sql/rls-policies.sql` | política por tabla, org_id directo |
| Migración | `packages/db/drizzle/migrations/0021_fine_onslaught.sql` | ya generada |
| JSON Schema para Python (GENERADOS) | `services/omr/contracts/*.schema.json` | regenerar con `pnpm --filter @soe/types gen:omr-contracts` — NUNCA editar a mano |
| Ejemplos compartidos TS⇄Python | `services/omr/contracts/examples/*.json` | validados por jest Y pytest |
| Puerto OmrClient | `apps/api/src/sheet-scanning/omr-client.types.ts` | `OMR_CLIENT`, `OmrClient`, errores tipados |
| Fake para tests | `apps/api/src/sheet-scanning/testing/fake-omr-client.ts` | `FakeOmrClient` (cola de respuestas) |

Prohibido: duplicar cualquiera de estas piezas, escribir schemas Python a mano, tener una
segunda implementación del hash o un `split(':')` artesanal del QR.

## 2. Enmiendas al diseño (cerradas en F0)

| ID | Enmienda | Razón |
|---|---|---|
| **CD-1** | La evidencia visual viaja **inline en base64** en el `ScanResult` (`cropJpegBase64` sólo para marcas `multiple`/`ambiguous`; `pageThumbJpegBase64` sólo para páginas rechazadas o sin identidad), en vez de presigned PUT URLs por recorte | Elimina el problema huevo-gallina de emitir URLs por (página × campo) sin conocer el conteo de páginas del PDF; el servicio queda sin credenciales de escritura. El fill/threshold/margin de TODAS las marcas igual se persiste (D11); la API persiste los recortes vía `FilesService` |
| **CD-2** | `OmrReadRequest.source = { kind: 'pdf'\|'images', pdfUrl, imageUrls }` — una llamada por archivo fuente. `ScanResult.pages[].pageIndex` = posición dentro del ARCHIVO; el pageIndex lógico de la hoja viaja en el QR | El diseño §3.4 era ambiguo con PDF multipágina |
| **CD-3** | `ScanResult.pages[]` incluye `imageSha256` (hash del bitmap rasterizado) | Es la pieza que falta para la idempotencia D13 `(printedSheetId, pageIndex, imageHash)` |
| **CD-4** | `sheet_scans` agrega `sourceFileId`, `sourcePageIndex`, `thumbFileId` | Poder decir "re-escanea la página 3 del archivo X" y servir el thumb en la cola |
| **CD-5** | **Convención del marco fiducial (cerrada en el gate F1).** (1) Cada fiducial es un cuadrado sólido de lado `sizeRatio × anchoDePágina`; (2) su borde EXTERIOR está a `marginRatio × anchoDePágina` de cada borde de página (mismas fracciones en ambos ejes); (3) el marco fiducial = rectángulo cuyas esquinas son los **CENTROS** de los 4 cuadrados; toda coordenada 0–1 del spec es fracción de ese marco (`x` del ancho, `y` del alto); (4) `bubble.radius` = fracción del **ancho del marco**; (5) el rectificador mapea los **centroides detectados** al espacio de trabajo. Implementaciones: `sheet-print.helpers.ts` (`computeDrawPlan`), `services/omr/app/geometry.py`, `SheetPreview.tsx` — el round-trip de F3 las valida entre sí | F1 la detectó divergente entre impresor (centros) y lector (esquinas exteriores): un corrimiento de ~2.5 mm que arruinaba la lectura. El centroide además es lo más robusto de detectar |
| **CD-6** | Una página que excede `OMR_PAGE_TIMEOUT_S` se **omite** del `ScanResult` (con log); si TODAS lo exceden → `504`. El orquestador (C2) trata las páginas esperadas-y-ausentes como no escaneadas (G3), jamás como blancos | El enum `rejectReason` no tiene un motivo honesto para timeout; agregarlo es candidato v1 |
| **CD-7** | El servicio hace un *peek estructural* del QR (token 5 = pageIndex lógico) SÓLO para elegir qué campos muestrear en cada bitmap; fallback `posiciónEnArchivo % pageCount`. La interpretación semántica (hoja/hash/alumno) sigue 100% en el backend | Sin la página lógica no se sabe qué campos buscar en un archivo multipágina |

## 3. Superficie REST (congelada)

Todos los endpoints: JWT + `@UseGuards(RolesGuard)`; validación Zod en el controller;
listas con `{ data, total, page, limit }`. Los Models están en
`packages/types/src/schemas/sheet-scanning.schema.ts` — tiparlos EXACTO, no crear tipos
locales.

### Layouts — controller `sheet-layouts` (workstream A1)

| Verbo + ruta | Roles | Request | Response |
|---|---|---|---|
| `POST /sheet-layouts/derive` | `SHEET_MANAGEMENT_ROLES` | `DeriveLayoutDto` | `LayoutDraftModel` |
| `POST /sheet-layouts` | `SHEET_MANAGEMENT_ROLES` | `FreezeLayoutDto` | `FreezeLayoutResponse` |
| `GET /sheet-layouts` | `SHEET_MANAGEMENT_ROLES` | `SheetLayoutQueryDto` | `PaginatedResponse<SheetLayoutSummaryModel>` |
| `GET /sheet-layouts/:id` | `SHEET_MANAGEMENT_ROLES` | — | `SheetLayoutModel` |

`freeze` valida los 7 invariantes del diseño §3.1 y lanza `BadRequestException` con el
invariante violado. Un layout congelado NUNCA se actualiza: editar = fila nueva `version+1`.

### Tiradas — controller `sheet-print-runs` (workstream A1)

| Verbo + ruta | Roles | Request | Response |
|---|---|---|---|
| `POST /sheet-print-runs` | `SHEET_MANAGEMENT_ROLES` | `CreatePrintRunDto` | `PrintRunModel` |
| `GET /sheet-print-runs` | `SHEET_MANAGEMENT_ROLES` | `PrintRunQueryDto` | `PaginatedResponse<PrintRunModel>` |
| `GET /sheet-print-runs/:id` | `SHEET_MANAGEMENT_ROLES` | — | `PrintRunModel` |
| `PATCH /sheet-print-runs/:id` | `SHEET_MANAGEMENT_ROLES` | `UpdatePrintRunDto` | `PrintRunModel` |
| `GET /sheet-print-runs/assessment-options` | `SHEET_MANAGEMENT_ROLES` | `PrintRunAssessmentOptionsQueryDto` | `PrintRunAssessmentOption[]` |
| `GET /sheet-print-runs/:id/pdf` | `SHEET_MANAGEMENT_ROLES` | — | `application/pdf` (stream) |

`createRun` crea la tirada + una `printed_sheets` por alumno activo del curso (orden
alfabético = `sequence`) + `spareCount` reservas con `studentId: null` (G8), transaccional.
El QR de cada página: `buildOmrQrPayload({ printedSheetId, layoutHash, pageIndex, pageCount })`,
corrección de errores nivel M. Reservas usan el MISMO formato (su hoja existe en
`printed_sheets`, sólo que sin alumno).

La evaluación (`assessmentId`) es el destino de las respuestas leídas: sin ella
`confirmBatch` rechaza el lote. `createRun` la valida (misma org + mismo instrumento que
el layout) cuando viene en el DTO y la CREA (`mode: 'paper'`, `status: 'scheduled'`, más
su `assessment_course_assignments` al curso) cuando no viene, de modo que ninguna tirada
nazca sin destino. `PATCH /:id` asocia o cambia la evaluación de una tirada existente con
las mismas validaciones, y responde 409 si la tirada ya tiene un lote `confirmed` (mover
la evaluación después de confirmar dejaría huérfanas las `responses` ya escritas).

### Lotes — controller `sheet-scan-batches` (workstream C2, F2)

| Verbo + ruta | Roles | Request | Response |
|---|---|---|---|
| `POST /sheet-scan-batches` | `SHEET_MANAGEMENT_ROLES` | `CreateScanBatchDto` | `CreateScanBatchResponse` |
| `POST /sheet-scan-batches/:id/start` | `SHEET_MANAGEMENT_ROLES` | — | `BatchStatusModel` |
| `POST /sheet-scan-batches/:id/retry` | `SHEET_MANAGEMENT_ROLES` | — | `BatchStatusModel` (sólo desde `failed`, sin re-subir) |
| `GET /sheet-scan-batches` | `SHEET_MANAGEMENT_ROLES` | `ScanBatchQueryDto` | `PaginatedResponse<BatchStatusModel>` |
| `GET /sheet-scan-batches/:id` | `SHEET_MANAGEMENT_ROLES` | — | `BatchStatusModel` (polling) |

### Revisión — controller `scan-review` (workstream C3, F2)

| Verbo + ruta | Roles | Request | Response |
|---|---|---|---|
| `GET /sheet-scan-batches/:id/review` | `SHEET_REVIEW_ROLES` + `SensitiveDataGuard` | — | `ReviewQueueModel` |
| `PATCH /sheet-scan-marks/:id` | `SHEET_REVIEW_ROLES` + `SensitiveDataGuard` | `ReviewMarkDto` | `ReviewMarkModel` |
| `PATCH /sheet-scans/:id/identity` | `SHEET_REVIEW_ROLES` + `SensitiveDataGuard` | `AssignScanIdentityDto` | `ReviewScanModel` |
| `PATCH /sheet-scans/:id/discard` | `SHEET_REVIEW_ROLES` + `SensitiveDataGuard` | `DiscardScanDto` | `ReviewScanModel` |
| `POST /sheet-scan-batches/:id/confirm` | `SHEET_REVIEW_ROLES` | — | `ConfirmBatchResponse` |

Rutas de página frontend: `/hojas/[instrumentId]/disenar`, `/hojas/[layoutId]/imprimir`,
`/hojas/escanear`, `/hojas/lotes/[batchId]/revisar` (más un índice `/hojas`). El nav item
se agrega SÓLO en integración (F3).

## 4. Contrato HTTP del servicio de visión

`POST /v1/read` — request = `OmrReadRequest` (JSON Schema `read-request.schema.json`),
respuesta 200 = `ScanResult` (`scan-result.schema.json`). El `QualityGate` corre DENTRO del
servicio; `200` con `quality.ok=false` es respuesta correcta. Errores: `422` request
inválido (bug del backend — no reintentar), `502` imagen no descargable (reintentar 1 vez),
`504` tiempo límite por página. El servicio NO conoce `orgId`, no toca DB, no recibe
credenciales: sólo URLs firmadas de lectura de vida corta (15 min).

Var de entorno del backend: `OMR_SERVICE_URL` (default local `http://127.0.0.1:8090`).

## 5. Semánticas que NADIE reinterpreta

- **`blank` ≠ "no escaneado" (G3).** `blank` = el alumno no marcó, con separación clara.
  Una página ausente no produce marcas y el escaneo queda incompleto — JAMÁS se persiste
  como respuestas en blanco.
- **Hash distinto = lote entero `rejected` (G1).** Sin corrección parcial, sin degradación.
  `failureReason` lleva el motivo exacto. `rejected` ≠ `failed`: `failed` es infra y se
  reintenta; `rejected` es datos y ningún reintento lo arregla.
- **Identidad = candidato + confianza (G2).** Ningún resolver devuelve identidad cerrada;
  el QR garantiza la HOJA, no el alumno.
- **`value` de máquina nunca se sobrescribe (§8.3).** El humano escribe `reviewedValue`;
  efectivo = `reviewedValue ?? value`.
- **Idempotencia D13.** `(printedSheetId, pageIndex, imageHash)` único; el re-escaneo marca
  el anterior `superseded`, nunca borra.
- **Página sin marcas separables** → `no_separable_marks`, página rechazada — nunca leída
  como "todo en blanco".
- **`margin = |fill − threshold| / threshold`**; banda de ambigüedad MVP: `margin < 0.25`
  (hipótesis a calibrar en O4; vive como constante `AMBIGUITY_MARGIN` en el clasificador).
- **Adaptador (§3.6 del diseño):** `toParserResult` produce el mismo `ParserResult` de
  `apps/api/src/answer-sheets/lib/parsers/parser.types.ts`; key de `answers` =
  `printedNumber`; `multiple`/`ambiguous` sin revisar → `null` + error de fila
  `ambiguous_mark`; con `reviewedValue` → el `reviewedValue`.

## 6. Propiedad de archivos por workstream

Los archivos compartidos (`app.module.ts`, `nav-items.ts`, `schemas/index.ts` de types/db,
`rls-policies.sql`, `lib/api.ts`, layouts del dashboard) NO se tocan en F1/F2 — sólo en
F0 (ya hecho) y F3 (integración). `sheet-scanning.module.ts` lo cablea F3.

### F1

| WS | Archivos propios (crear/editar SÓLO estos) |
|---|---|
| **A1** | `apps/api/src/sheet-scanning/sheet-layout.service.ts`, `sheet-layout.helpers.ts`, `sheet-print.service.ts`, `sheet-print.helpers.ts`, `sheet-layouts.controller.ts`, `sheet-print-runs.controller.ts`, `dto/**`, specs de esos archivos. Deps nuevas en `apps/api/package.json`: `pdf-lib`, `qrcode` (+`@types/qrcode`) |
| **A2** | `apps/web/src/app/(dashboard)/hojas/page.tsx`, `hojas/[instrumentId]/disenar/**`, `hojas/[layoutId]/imprimir/**`, `hojas/components/**` (componentes compartidos del dominio hojas), `hojas/lib/**` |
| **B1** | `services/omr/**` (todo salvo `contracts/*.schema.json`, que es generado) |
| **C1** | `apps/api/src/sheet-scanning/scan-result.adapter.ts` + spec, `apps/api/src/sheet-scanning/identity/**` |

### F2

| WS | Archivos propios |
|---|---|
| **C2** | `apps/api/src/sheet-scanning/sheet-scan.service.ts`, `omr-http.client.ts`, `sheet-scan-batches.controller.ts`, `sheet-scan-job.ts`, dto/specs propios |
| **C3** | `apps/api/src/sheet-scanning/scan-review.service.ts`, `scan-review.controller.ts`, dto/specs propios |
| **D1** | `apps/web/src/app/(dashboard)/hojas/escanear/**`, `hojas/lotes/[batchId]/revisar/**`, `hojas/hooks/**` |
| **B2** | `services/omr/**` (continúa B1) |

A1 y C1 comparten el directorio `sheet-scanning/` pero CERO archivos. Si necesitas un
helper del otro workstream, NO lo escribas: decláralo en tu reporte final y F3 lo resuelve.

## 7. Convenciones no negociables (resumen operativo)

- Toda query a las 6 tablas dentro de `withOrgContext(db, orgId, tx => …)` usando `tx`
  (CLAUDE.md §5.2). `orgId` viene del JWT, jamás del body.
- Roles con constantes de `@soe/types` (`SHEET_MANAGEMENT_ROLES` / `SHEET_REVIEW_ROLES`)
  — nunca inline. `SensitiveDataGuard` donde la respuesta incluye nombre de alumno.
- Excepciones NestJS estándar con mensaje curado en español. Fallos esperados (calidad,
  hash, identidad) = estado de dominio, NO excepciones, NO `reportServerError` (diseño §5.6).
- `apps/api`: sin comentarios en el código (rule 02); tests `*.spec.ts` junto al archivo;
  fake `Database` por constructor (patrón `heatmap.service.spec.ts`); ≥8 tests por service.
- Sin O(N²): agrupaciones con `Map` en una pasada (rule 04). Inserts en batch
  (`.values([...])`), nunca en loop.
- Frontend: Server Components por defecto; shell + `<Suspense>` (rule 07); mutaciones via
  server actions con `Result` + `toast` (rule 01); tipos SIEMPRE los Models del contrato;
  polling con TanStack Query vía `apiClientGet` + proxy (rule 06); UI en español;
  `canAccess(session.user.roles, ROLE_SET)` en toda página.
- Python: ruff + pytest verdes; el servicio jamás importa nada con estado (DB, S3 SDK).

## 8. Verificación final de cada agente

1. `pgrep -fl "tsc|vitest|jest|pytest"` → espera si hay algo corriendo.
2. Backend/frontend: `cd apps/api|apps/web && npx tsc --noEmit` limpio. Python:
   `.venv/bin/pytest` + `.venv/bin/ruff check app tests` verdes.
3. Tests propios verdes (`pnpm test -- <patrón>` en apps/api; jest de types si tocaste types — no deberías).
4. `git add -A && git commit -m "feat(e22): <workstream> — <resumen>"`.

---

## 9. Contratos v1 (CD-8..CD-14) — enmiendas sobre el MVP

> Congelados en Fase V0 (`docs/plan-desarrollo-lector-v1.md`). Extienden los contratos
> del MVP SIN romperlos: todo campo nuevo es nullable/optional, los ejemplos congelados
> del MVP validan sin cambios y el `layoutHash` de un spec del MVP no cambia (test de
> referencia en `layout-hash.spec.ts` con hash fijado `a9718c3cc1e24e82`).

### CD-8 — Campos numéricos `digit_grid`

- `omrBubbleSchema` gana `group: z.number().int().min(0).nullable().optional()` = índice
  del dígito dentro del campo (0 = más significativo). Sin default: un spec del MVP no lo
  materializa al parsear y su hash queda intacto.
- Un campo `kind: 'digit_grid'` tiene `digitCount` implícito en `max(group) + 1`; sus
  burbujas llevan `value` `'0'`–`'9'` por grupo. Cada grupo se lee como un mini
  bubble_group `single`.
- **Valor del campo = concatenación de los dígitos leídos.** Si CUALQUIER grupo es dudoso
  (blank/multiple/ambiguous), el campo ENTERO es `ambiguous` — jamás un número con un
  dígito inventado (45≠46 es invisible). La implementación (`DigitGridReader`) es de V1·P1.
- Canonicidad del hash: el campo `group` participa del hash cuando está presente. Un spec
  que lo omite y uno que lo trae explícito en `null` hashean distinto — la convención es
  **omitir** `group` en burbujas que no pertenecen a una grilla (el diseñador nunca emite
  `group: null`).

### CD-9 — Campos `crop_region` (respuestas de desarrollo)

- Nuevo `kind: 'crop_region'`: `bubbles: []`, `region` NO nulo (el recorte ES la respuesta).
- Semántica en `MarkReading` (sin cambio de shape — el schema del MVP ya lo permite):
  `state: 'marked'`, `value: null`, `cropJpegBase64` SIEMPRE presente; `fill: 0`,
  `threshold: 0.5`, `margin: 1` fijos (no aplican).
- El adaptador NO lo mapea a `answers`: el confirm crea la respuesta de desarrollo por el
  camino `ai_grading_jobs` (V2·B2). `ai_score` jamás pisa `final_score` (§8.3).
- Métricas del módulo (V3): las marcas `marked` fijas de `crop_region` se detectan por
  sus valores fijos CD-9 (`fill = 0 AND threshold = 0.5 AND margin = 1`) y se excluyen
  del denominador de `reviewRatePercent` — los crops no son revisables por diseño y
  cargar los specs de cada lote sólo para clasificarlas no se justifica.

### CD-10 — Identidad `rut_bubbles` (hoja genérica)

- `layoutSpec.identity` gana `bubbles: z.array(omrBubbleSchema).nullable().optional()`:
  la grilla RUT vive en la región identity como una digit_grid (mismo `group`/`value`),
  con el DV como grupo final que además admite `'K'`. Optional sin default → hash de
  specs MVP intacto. Invariante (se valida en freeze, V1·B1): `mode: 'rut_bubbles'`
  requiere `bubbles` presente y no vacío; `mode: 'qr'` lo omite.
- `identity.raw` = dígitos concatenados leídos (`"12345678K"`); `confidence` = mínimo
  margin normalizado de los grupos. El servicio NO interpreta: el backend
  (`RutBubbleResolver`, V1·B1) valida DV con `normalizeRut` y hace match EXACTO contra el
  roster — sin match o DV inválido → cola manual, JAMÁS matching difuso silencioso.

### CD-11 — Gate de calidad para captura con cámara

- Servicio: **`POST /v1/assess`** — request = `OmrAssessRequest`
  (`assess-request.schema.json`: `{ layoutSpec, captureProfile, imageBase64 }`), respuesta
  200 = `OmrAssessResult` (`assess-result.schema.json`: `{ imageSha256, quality, identity }`).
  Subset de read: rectificación + QualityGate + QR, SIN clasificar marcas; presupuesto <1s.
  Mismos códigos de error que `/v1/read` (422 request inválido).
- Backend: **`POST /sheet-scan-batches/assess-capture`** — `SHEET_MANAGEMENT_ROLES`;
  request `AssessCaptureDto` (`printRunId` + `imageBase64`, imagen JPEG ≤4 MB ⇒ base64
  ≤5.592.408 chars, validado en el DTO); respuesta `AssessCaptureResponse`
  (`{ accepted, quality, identity }` — la identidad resuelta contra la tirada: hoja,
  página, alumno candidato + confianza). El navegador NUNCA habla directo con el servicio.
  El veredicto se muestra ANTES de aceptar la foto (D3): retake inmediato con el motivo.

### CD-12 — Calibración por organización

- Sin migración: `organizations.config.omrCalibration` validado por `omrCalibrationSchema`
  (`{ ambiguityMargin?: 0.05–0.5, minSeparability?: 0–1 }`) en `orgConfigSchema`
  (`feature.schema.ts`).
- `captureProfileSchema` gana `ambiguityMargin: z.number().min(0.05).max(0.5).nullable().default(null)`.
  El default `null` NO afecta el `layoutHash` (el hash cubre sólo el LayoutSpec, nunca el
  CaptureProfile). `null` = el clasificador usa su default (0.25, la constante del MVP).
  Se inyecta al servicio POR REQUEST — datos, no código (D2).
- Endpoints backend: **`GET /organizations/me/omr-calibration`** y
  **`PATCH /organizations/me/omr-calibration`** (`UpdateOmrCalibrationDto` →
  `OmrCalibrationResponse`), guard con **`OMR_CALIBRATION_ROLES`**
  (`access-policies/sheet-scanning.ts`) — alias EXPLÍCITO de `SHEET_MANAGEMENT_ROLES`:
  quien gestiona hojas calibra su lectura; es el mismo conjunto a propósito, no una
  copia — si divergen algún día, se separa la constante, no se edita la lista en línea.
- El PATCH hace merge no destructivo sobre `config.omrCalibration` (mandar sólo
  `ambiguityMargin` no borra `minSeparability`). `minSeparability` se persiste como
  knob reservado: NO viaja al servicio en v1.

### CD-15 — QR de esquina en modo `rut_bubbles` (enmienda V3, post-auditoría)

- `scannedPageIdentitySchema` gana `qrRaw: z.string().nullable().optional()` (sin
  default: los payloads del MVP validan sin cambios; el schema JSON regenerado lo
  deja fuera de `required`). En modo `qr`, `qrRaw` duplica `raw`. En modo
  `rut_bubbles`, `identity.raw` = dígitos RUT leídos e `identity.qrRaw` = payload
  del QR de esquina (o null si es ilegible) — la hoja genérica SIEMPRE imprime ese
  QR (`SHEET_QR_IDENTITY_REGION`, esquina superior derecha) con
  `printedSheetId + layoutHash + pageIndex + pageCount`.
- El servicio lo localiza escaneando el cuadrante superior derecho de la página
  rectificada (no conoce la constante del impresor). El QR identifica la COPIA
  física: con él, el hash-check G1 corre siempre, la idempotencia D13
  `(printedSheetId, pageIndex, imageHash)` y el supersede funcionan sin cambios, y
  el `pageIndex` lógico sale del QR — el RUT sólo resuelve el alumno
  (`resolvedStudentId`, vía `RutBubbleResolver`).
- **Orientación (política cerrada):** en specs `rut_bubbles` la pasada de
  rectificación sólo se confirma si el QR de esquina decodifica desde ese
  cuadrante; si ninguna de las 4 orientaciones lo logra, la página se rechaza por
  calidad (`no_separable_marks`, sin clasificar marcas). Un QR tapado o dañado ⇒
  retake/re-escaneo: sin QR no hay copia física a la que anclar la idempotencia ni
  orientación probada, aunque la grilla RUT sea legible.

### CD-13 — Formas A/B

- Un layout POR FORMA (el versionado D6 ya lo permite; el hash distinto viaja en el QR y
  el hash-check G1 del MVP ya rechaza hojas de la forma equivocada sin código nuevo).
- `CreatePrintRunDto` gana `assessmentFormId: z.string().uuid().nullable().optional()`;
  `PrintRunModel` gana `assessmentFormId?: string | null` (opcional durante la
  transición; V2·B3 lo puebla siempre). Una tirada = una forma; el lote hereda la forma
  de su tirada.
- Migración `0022_cynical_famine`: `sheet_print_runs.assessment_form_id` uuid nullable
  FK → `assessment_forms.id` + índice `sheet_print_runs_form_idx`. Nada más de schema.

### CD-14 — Retención de imágenes (D18)

- Sólo contrato en V0; script y cron son de V2·B4: `files` con
  `owner_type IN ('sheet_scan', 'sheet_scan_mark')` y `created_at` más viejo que la
  retención → borrado S3 + soft-delete, vía `pnpm --filter @soe/api retention:sheet-scans`
  (tsx, documentado para cron externo). El resultado corregido nunca se toca.
- `organizations.config.omrRetentionDays?: number` (entero positivo, ya en
  `orgConfigSchema`); undefined = default **180 días**.

### Superficie REST nueva (v1)

| Verbo + ruta | Roles | Request | Response |
|---|---|---|---|
| `POST /sheet-scan-batches/assess-capture` | `SHEET_MANAGEMENT_ROLES` | `AssessCaptureDto` | `AssessCaptureResponse` |
| `GET /organizations/me/omr-calibration` | `OMR_CALIBRATION_ROLES` | — | `OmrCalibrationResponse` |
| `PATCH /organizations/me/omr-calibration` | `OMR_CALIBRATION_ROLES` | `UpdateOmrCalibrationDto` | `OmrCalibrationResponse` |

Servicio de visión: `POST /v1/assess` (ver CD-11); `/v1/read` intacto.

Enmienda de integración V1: `DeriveLayoutDto` gana `identityMode: 'qr' | 'rut_bubbles'`
(optional, default `'qr'`) — el diseñador elige el modo de identidad de la hoja al derivar.

JSON Schemas generados nuevos: `assess-request.schema.json`, `assess-result.schema.json`.
Ejemplos compartidos nuevos (jest + pytest): `layout-digit-grid-rut.example.json`,
`layout-crop-region.example.json`.

## 10. Propiedad de archivos por workstream (v1)

Igual que en el MVP: los archivos compartidos sólo se tocan en V0 (hecho) y V3
(integración). Detalle completo de tickets en `docs/plan-desarrollo-lector-v1.md`.

### Fase V1

| WS | Archivos propios (crear/editar SÓLO estos) |
|---|---|
| **P1** | `services/omr/**` (contratos generados intocables): `DigitGridReader`, `CropRegionReader`, grilla RUT en identity, `POST /v1/assess`, `ambiguityMargin` del CaptureProfile, fixtures sintéticos nuevos |
| **B1** | `apps/api/src/sheet-scanning/identity/rut-bubble.resolver.ts` (+spec), `sheet-layout.helpers.ts`/`sheet-layout.service.ts`, `sheet-print.service.ts`/`sheet-print.helpers.ts` (hoja genérica), `omr-calibration.*` (service+controller, guard `OMR_CALIBRATION_ROLES`), `sheet-scan.service.ts` (inyectar calibración al captureProfile) |
| **F1** | `apps/web/src/app/(dashboard)/hojas/escanear/**` (extender), `hojas/hooks/**` nuevos (modo cámara + assess-capture) |
| **F2** | `hojas/[id]/disenar/**`, `hojas/[id]/imprimir/**`, `hojas/components/SheetPreview.tsx` (digit_grid, modo identidad, selector de forma, preview grilla RUT) |

### Fase V2

| WS | Archivos propios |
|---|---|
| **P2** | `services/omr/**` (hardening de lectores nuevos, catálogo sucio de grillas) |
| **B2** | `apps/api/src/sheet-scanning/development-grading.service.ts` (+spec); consume `llm` y `responses`, NO los toca |
| **B3** | `sheet-print.service.ts` (extensión formas), `sheet-scan.service.ts` (validar forma de la tirada), spec updates |
| **B4** | `apps/api/scripts/` (retención CD-14), `sst.config.ts` (contenedor OMR), `.env.example`, `apps/web/src/lib/` (`apiGetBinary`), límites de lote, endpoint de métricas del módulo |

## 11. Contratos E22-R (CD-16..CD-23) — captura remota con teléfono

Diseño completo en `docs/diseno-captura-remota-movil.md`; plan de ejecución en
`docs/plan-desarrollo-captura-remota.md`. Todas las enmiendas son aditivas: nada
del MVP ni de la v1 cambia de shape, y `services/omr/**` NO se toca (el gate
CD-11 se consume tal cual). Shapes congelados en
`packages/types/src/schemas/sheet-capture.schema.ts`.

### CD-16 — Tabla `capture_sessions`

`packages/db/src/schema/sheet-scanning.ts` (migración `0023_rapid_cerebro`).
Sesión de emparejamiento QR: `org_id`, `print_run_id`, `batch_id` (el lote nace
CON la sesión), `status` (`pending|active|closed|revoked|expired`),
`secret_hash` (sha256; el secreto en claro JAMÁS se persiste), `redeem_count`,
`captures` (jsonb, evidencia para el live view), `expires_at`. RLS con dos
políticas en `packages/db/sql/rls-policies.sql`: aislamiento por org (estándar)
+ `capture_sessions_redeem_by_id` (SELECT de la propia fila vía
`app.capture_session_id`, para el canje público — ver CD-18).

### CD-17 — Ciclo de vida y límites

TTL **15 minutos** fijo (`CAPTURE_SESSION_TTL_MINUTES`), canjes ≤ **3**
(`CAPTURE_SESSION_MAX_REDEEMS`: segundo teléfono o recarga de página, no fuga
masiva), capturas ≤ **60** (tope de lote existente). `pending → active` en el
primer canje; `closed` al terminar; `revoked` desde el PC; `expired` por barrido
o al tocar una sesión vencida. Regenerar QR = revocar + crear sesión nueva (el
lote anterior sobrevive `pending` con sus capturas).

### CD-18 — Canje y capture token

`POST /sheet-capture/redeem { sessionId, secret }` (ruta `@Public()`; el secreto
ES la credencial). Comparación de tiempo constante contra `secret_hash`. La
lectura pre-org usa `withCaptureSessionContext(db, sessionId, tx => …)` de
`@soe/db` (política redeem_by_id); todo lo demás vuelve a `withOrgContext`.
Respuesta: **capture token** = JWT HS256 firmado con `jose`, clave derivada del
`AUTH_SECRET` vía HKDF-SHA256 con salt `'sheet-capture-token'`, claims
`{ sessionId, orgId, printRunId, batchId, scope: 'sheet-capture' }`,
`exp = expires_at` de la sesión. Un JWE de usuario no pasa el guard de captura y
un capture token no pasa el `AuthGuard`: superficies disjuntas.

### CD-19 — Lote incremental

El lote nace junto con la sesión (`pending`, `sourceFileIds: []`). Cada foto
aceptada por el gate ⇒ `upload-intent` (crea el intent presigned con
`ownerType: 'sheet_scan'`, `ownerId: batchId`, `purpose: 'scan_source'`) +
append transaccional del fileId a `sourceFileIds` y de la evidencia a
`captures`. `finish` ⇒ sesión `closed` + `startProcessing` existente. La
identidad que acompaña cada captura es INFORMATIVA (live view); la resolución
autoritativa sigue siendo la de `/v1/read` al procesar.

### CD-20 — Superficie REST

Token-scoped (controller `sheet-capture.controller.ts`, `@Public()` frente al
`AuthGuard`, protegido por `CaptureSessionGuard`):

| Ruta | Guard | Body/Respuesta |
|---|---|---|
| `POST /sheet-capture/redeem` | — | `redeemCaptureSessionSchema` → `RedeemCaptureSessionResponse` |
| `GET /sheet-capture/session` | CaptureSessionGuard | → `CaptureSessionStatusModel` |
| `POST /sheet-capture/assess` | CaptureSessionGuard | `captureAssessSchema` → `AssessCaptureResponse` (printRunId del token) |
| `POST /sheet-capture/upload-intent` | CaptureSessionGuard | `captureUploadIntentSchema` → `ScanUploadIntent` |
| `POST /sheet-capture/files/:id/confirm` | CaptureSessionGuard | `captureConfirmFileSchema` (valida que el file pertenece al lote de la sesión) |
| `POST /sheet-capture/finish` | CaptureSessionGuard | → `FinishCaptureSessionResponse` |

Autenticada (controller `sheet-capture-sessions.controller.ts`, roles
`SHEET_MANAGEMENT_ROLES`):

| Ruta | Body/Respuesta |
|---|---|
| `POST /sheet-capture-sessions` | `createCaptureSessionSchema` → `CreateCaptureSessionResponse` (única vez que viaja el secreto) |
| `GET /sheet-capture-sessions/:id` | → `CaptureSessionStatusModel` (polling del PC) |
| `POST /sheet-capture-sessions/:id/revoke` | → `CaptureSessionStatusModel` |
| `POST /sheet-capture-sessions/:id/finish` | → `FinishCaptureSessionResponse` (cierre desde el PC) |

### CD-21 — `CaptureTransport` y reuso de la cámara

Tipo congelado en `@soe/types`: `{ assess, createUploadIntent, confirmFile }`.
`CameraCaptureSection` gana una prop opcional `assessOverride` (o recibe el
transporte): con la sesión del dashboard usa el flujo actual (proxy + cookie)
SIN cambio de comportamiento; en el móvil usa la implementación por capture
token. La vista móvil sube cada foto aceptada INMEDIATAMENTE (upload-intent +
PUT S3 + confirm), a diferencia del PC que encola hasta el submit.

### CD-22 — Proxy dedicado y ruta móvil

El proxy genérico (`/api/proxy`) exige cookie de sesión y pisa `Authorization`
⇒ NO sirve para el móvil (verificado en R0). Ruta nueva
`apps/web/src/app/api/capture-proxy/[...path]/route.ts`: reenvía el
`Authorization: Bearer <capture token>` entrante hacia
`${API_URL}/api/sheet-capture/<path>` — SOLO hacia `sheet-capture/*`, nada más.
Vista móvil: `apps/web/src/app/movil/hojas/[sessionId]/page.tsx` (fuera de
`(dashboard)`), excepción `movil` en el matcher de `middleware.ts`. El secreto
viaja en el fragment (`#`), se lee client-side y el token vive en memoria
(jamás localStorage).

### CD-23 — Expiración, limpieza y PC

Polling del PC: TanStack Query `refetchInterval` 2500 ms sobre
`GET /sheet-capture-sessions/:id` (patrón `useRemedialStatus`). Sesión vencida
al tocarla (canje, guard, GET) ⇒ transición a `expired` en esa misma operación.
Sesión `expired`/`revoked` con capturas ⇒ el lote queda `pending` (visible en
"Lotes recientes", procesable a mano); sin capturas ⇒ el barrido de vencidas
puede eliminar el lote vacío. SSE/WebSockets: fuera de alcance declarado.

## 12. Propiedad de archivos por workstream (E22-R, fase R1)

| WS | Archivos propios (crear/editar SÓLO estos) |
|---|---|
| **B-R1** | `apps/api/src/sheet-scanning/capture-session.service.ts` (+spec), `capture-session.guard.ts` (+spec), `capture-token.helpers.ts` (+spec si aplica), `sheet-capture.controller.ts` (+spec), `sheet-capture-sessions.controller.ts` (+spec), `sheet-scanning.module.ts` (wiring) |
| **F-R1** | `apps/web/src/app/movil/hojas/[sessionId]/**`, `apps/web/src/app/api/capture-proxy/[...path]/route.ts`, `apps/web/src/middleware.ts`, `apps/web/src/lib/capture-transport.ts`, `hojas/hooks/use-assess-capture.ts` (parametrizar), `hojas/escanear/CameraCaptureSection.tsx` (SOLO inyección del transporte) |
| **F-R2** | `hojas/escanear/RemoteCaptureSection.tsx`, `hojas/escanear/ScanUploadForm.tsx` (tercera opción del toggle), `hojas/hooks/use-capture-session.ts`, `hojas/escanear/capture-session-actions.ts`, `apps/web/package.json` (dep `qrcode.react` — ya instalada en R0 si aplica) |
