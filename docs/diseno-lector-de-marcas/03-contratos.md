# 03 · Contratos

> **Estos contratos se congelan en la ola O0, antes de escribir cualquier otro código.**
> Son la semántica compartida entre componentes que se escriben por separado — el lugar donde
> este proyecto ya aprendió que se esconden los peores bugs.

---

## 3.1 · `LayoutSpec` — el contrato central

Una sola pieza de datos es compartida por tres consumidores que se escriben por separado: el
**diseñador** que la produce, el **impresor** que dibuja el PDF y el **lector** que busca las
burbujas. Si alguno duplica las coordenadas, el sistema falla de un modo imposible de atribuir.

`packages/types/src/schemas/omr-layout.ts`

```ts
import { z } from 'zod';

export const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const regionSchema = z.object({
  topLeft: pointSchema,
  bottomRight: pointSchema,
});

export const bubbleSchema = z.object({
  value: z.string().min(1),
  center: pointSchema,
  radius: z.number().positive(),
});

export const FIELD_KINDS = ['bubble_group', 'digit_grid', 'crop_region'] as const;
export const fieldKindSchema = z.enum(FIELD_KINDS);

export const fieldSchema = z.object({
  fieldId: z.string().min(1),
  kind: fieldKindSchema,
  printedNumber: z.string().min(1),
  pageIndex: z.number().int().min(0),
  selectMode: z.enum(['single', 'multiple']),
  bubbles: z.array(bubbleSchema),
  region: regionSchema.nullable(),
});

export const captureProfileSchema = z.object({
  source: z.enum(['scanner', 'phone']),
  normalizeIllumination: z.boolean(),
  minSharpness: z.number().min(0).max(1),
  maxGlare: z.number().min(0).max(1),
  expectedDpi: z.number().int().positive().nullable(),
});

export const layoutSpecSchema = z.object({
  specVersion: z.literal(1),
  instrumentId: z.string().uuid(),
  pageCount: z.number().int().positive(),
  paper: z.enum(['letter', 'a4', 'legal']),
  fiducials: z.object({
    kind: z.literal('corner_squares'),
    sizeRatio: z.number().positive(),
    marginRatio: z.number().positive(),
  }),
  identity: z.object({
    mode: z.enum(['qr', 'rut_bubbles', 'none']),
    region: regionSchema,
  }),
  fields: z.array(fieldSchema).min(1),
});

export type Point = z.infer<typeof pointSchema>;
export type LayoutField = z.infer<typeof fieldSchema>;
export type CaptureProfile = z.infer<typeof captureProfileSchema>;
export type LayoutSpec = z.infer<typeof layoutSpecSchema>;
```

### Sistema de coordenadas

Todas las coordenadas son **fracciones 0–1 del rectángulo definido por los cuatro fiduciales**,
no de la página. Esto es lo que hace el sistema inmune al escalado de impresora ([D7](01-decisiones.md#d7)).

```
(0,0) ┌─■──────────────────■─┐
      │                      │   ■ = fiducial de esquina
      │   ○ ○ ○ ○            │   ○ = burbuja en coordenada normalizada
      │                      │
      └─■──────────────────■─┘ (1,1)
```

### Invariantes

Se validan en `SheetLayoutService.freeze()`, **no en la base de datos**:

1. Todo `printedNumber` existe en el instrumento referido por `instrumentId`.
2. Ningún par de burbujas se solapa (distancia entre centros > suma de radios).
3. Toda burbuja cae dentro del rango 0–1 de su página.
4. `fields` cubre exactamente los ítems corregibles del instrumento; ninguno de más, ninguno
   de menos.
5. Todo `pageIndex` está en `[0, pageCount)`.
6. `kind === 'bubble_group'` ⇒ `bubbles.length > 0`; `kind === 'crop_region'` ⇒ `region !== null`.
7. El hash es **estable ante reordenamiento de claves**.

### Hash canónico

`packages/types/src/utils/layout-hash.ts`

```ts
export function layoutHash(spec: LayoutSpec): string;
```

Serializa con claves ordenadas recursivamente y números a precisión fija (6 decimales), luego
SHA-256, truncado a 16 caracteres hex para caber cómodo en el QR. **Impresor y lector usan
exactamente esta función** — nunca dos implementaciones.

---

## 3.2 · Payload del QR

Dos formatos. El **corto** es el que se imprime desde la identidad robusta
([07-identidad-qr-robusta.md](07-identidad-qr-robusta.md) §4.1); el **completo** queda para
siempre como formato de lectura de las hojas ya impresas.

**Corto** (14 caracteres máx., solo charset alfanumérico de QR ⇒ versión 1, 21×21):

```
AC:<shortCode hex8 MAYÚSCULA>:<pageIndex>
```

Ejemplo: `AC:0A1B2C3D:0`. El `shortCode` es `printed_sheets.short_code` — entero de 32 bits
único por org, aleatorio con reintento; no contiene datos personales. El hash del diseño **no
viaja**: el gate G1 se evalúa al resolver, comparando el layout de la tirada de la hoja (por
`short_code`) contra el layout de la tirada del lote. El mismo código va impreso en texto
legible junto al QR (`formatShortCode`, `0A1B-2C3D`) para tipeo humano de último recurso.

**Completo** (legado, 69 caracteres ⇒ versión 5, 37×37 — módulo de ~1 mm, en la zona de
aliasing del escáner; ver diagnóstico en el doc 07 §2):

```
academos:v1:<printedSheetId>:<layoutHash>:<pageIndex>:<pageCount>
```

Ejemplo:

```
academos:v1:9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33:a3f9c1e70b4d2856:0:2
```

Ambos formatos se construyen y parsean **solo** con `packages/types/src/utils/omr-qr.ts`; el
lector Python espeja el parse mínimo que necesita (`peek_logical_page_index` en
`services/omr/app/identity.py`). El `printedSheetId` es la PK de `printed_sheets`; no contiene
datos personales.

---

## 3.3 · `ScanResult` — la salida del lector

`packages/types/src/schemas/omr-scan.ts`

```ts
export const MARK_STATES = ['marked', 'blank', 'multiple', 'ambiguous'] as const;
export type MarkState = (typeof MARK_STATES)[number];

export const markReadingSchema = z.object({
  fieldId: z.string(),
  printedNumber: z.string(),
  state: z.enum(MARK_STATES),
  value: z.string().nullable(),
  fill: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  margin: z.number(),
  cropUrl: z.string().nullable(),
});

export const pageQualitySchema = z.object({
  ok: z.boolean(),
  sharpness: z.number().min(0).max(1),
  glare: z.number().min(0).max(1),
  fiducialsFound: z.number().int().min(0).max(4),
  rejectReason: z
    .enum(['blurry', 'glare', 'fiducials_missing', 'cropped', 'no_separable_marks'])
    .nullable(),
});

export const scannedPageSchema = z.object({
  pageIndex: z.number().int().min(0),
  quality: pageQualitySchema,
  identity: z.object({
    mode: z.enum(['qr', 'rut_bubbles', 'none']),
    raw: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  }),
  marks: z.array(markReadingSchema),
});

export const scanResultSchema = z.object({
  pages: z.array(scannedPageSchema),
});

export type MarkReading = z.infer<typeof markReadingSchema>;
export type ScannedPage = z.infer<typeof scannedPageSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
```

### Semántica de `MarkState`

| Estado | Significado | Va a la cola |
|---|---|---|
| `marked` | Una burbuja claramente sobre el umbral | No |
| `blank` | Ninguna burbuja sobre el umbral, con separación clara | No |
| `multiple` | Dos o más sobre el umbral | Sí |
| `ambiguous` | El llenado cae dentro de la banda de incertidumbre | Sí |

`blank` significa **el alumno no marcó**. Una página que no llegó a escanearse no produce
`blank`: no produce nada, y el escaneo queda incompleto ([G3](02-gaps.md#g3)).

### `margin` — el orden de la cola

```
margin = |fill − threshold| / threshold
```

Es la distancia relativa al umbral. Ordena la cola de revisión de forma ascendente: lo más
dudoso primero.

---

## 3.4 · Contrato HTTP del servicio de visión

El servicio **no tiene estado, ni base de datos, ni conocimiento de tenants**. Es una función
pura sobre `(imagen, spec)`.

### `POST /v1/read`

```jsonc
{
  "layoutSpec": { /* LayoutSpec completo */ },
  "captureProfile": {
    "source": "phone",
    "normalizeIllumination": true,
    "minSharpness": 0.35,
    "maxGlare": 0.25,
    "expectedDpi": null
  },
  "pages": [
    { "pageIndex": 0, "imageUrl": "https://…presigned…" }
  ],
  "cropUploadUrls": [
    { "fieldId": "f_019_1", "url": "https://…presigned-put…" }
  ]
}
```

**200 OK** → un `ScanResult` (§3.3).

```jsonc
{
  "pages": [{
    "pageIndex": 0,
    "quality": { "ok": true, "sharpness": 0.71, "glare": 0.04,
                 "fiducialsFound": 4, "rejectReason": null },
    "identity": { "mode": "qr",
                  "raw": "academos:v1:9f2c…:a3f9c1e70b4d2856:0:2",
                  "confidence": 1.0 },
    "marks": [{
      "fieldId": "f_019_1",
      "printedNumber": "19.1",
      "state": "marked",
      "value": "V",
      "fill": 0.82,
      "threshold": 0.46,
      "margin": 0.78,
      "cropUrl": "https://…"
    }]
  }]
}
```

### Errores

| Código | Situación | Qué hace el llamador |
|---|---|---|
| `422` | `layoutSpec` inválido | Bug del backend: no reintentar, reportar |
| `502` | No se pudo descargar una imagen | Reintentar una vez, luego `failed` |
| `504` | Excedió el tiempo por página | Marcar la página, seguir con las demás |

**El `QualityGate` corre dentro del servicio** y su veredicto es parte de la respuesta, nunca
una inferencia del llamador. Un `200` con `quality.ok === false` es una respuesta correcta.

### Puerto en NestJS

```ts
export const OMR_CLIENT = 'OMR_CLIENT';

export interface OmrClient {
  read(request: OmrReadRequest): Promise<ScanResult>;
}
```

Token de inyección para que los tests provean una implementación falsa sin levantar nada,
igual que `JOB_DISPATCHER`.

---

## 3.5 · Esquema Drizzle

`packages/db/src/schema/sheet-scanning.ts` — las 6 tablas llevan `org_id NOT NULL` y política
RLS ([D16](01-decisiones.md#d16)).

```ts
export const sheetScanBatchStatusEnum = pgEnum('sheet_scan_batch_status', [
  'pending', 'processing', 'needs_review', 'confirmed', 'failed', 'rejected',
]);

export const sheetScanStateEnum = pgEnum('sheet_scan_state', [
  'read', 'quality_rejected', 'identity_unresolved', 'superseded',
]);

export const markStateEnum = pgEnum('mark_state', [
  'marked', 'blank', 'multiple', 'ambiguous',
]);

/** Un LayoutSpec CONGELADO. Inmutable: editar crea una fila nueva. */
export const sheetLayouts = pgTable('sheet_layouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  version: integer('version').notNull(),
  spec: jsonb('spec').$type<LayoutSpec>().notNull(),
  specHash: text('spec_hash').notNull(),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.orgId, t.instrumentId, t.version),
  index('sheet_layouts_hash_idx').on(t.specHash),
]);

/** Una tirada de impresión para un curso. */
export const sheetPrintRuns = pgTable('sheet_print_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  layoutId: uuid('layout_id').notNull().references(() => sheetLayouts.id),
  classGroupId: uuid('class_group_id').references(() => classGroups.id),
  assessmentId: uuid('assessment_id').references(() => assessments.id),
  spareCount: integer('spare_count').default(0).notNull(),
  sheetCount: integer('sheet_count').notNull(),
  pdfFileId: uuid('pdf_file_id').references(() => files.id),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Una HOJA FÍSICA. Su id es lo que va en el QR. studentId nullable = reserva (G8). */
export const printedSheets = pgTable('printed_sheets', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  printRunId: uuid('print_run_id').notNull().references(() => sheetPrintRuns.id),
  studentId: uuid('student_id').references(() => students.id),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('printed_sheets_run_idx').on(t.orgId, t.printRunId)]);

/** Un lote subido. Unidad de trabajo del JobDispatcher. */
export const sheetScanBatches = pgTable('sheet_scan_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  printRunId: uuid('print_run_id').notNull().references(() => sheetPrintRuns.id),
  status: sheetScanBatchStatusEnum('status').default('pending').notNull(),
  captureProfile: jsonb('capture_profile').$type<CaptureProfile>().notNull(),
  sourceFileIds: jsonb('source_file_ids').$type<string[]>().notNull(),
  pagesTotal: integer('pages_total'),
  pagesRead: integer('pages_read').default(0).notNull(),
  reviewPending: integer('review_pending').default(0).notNull(),
  failureReason: text('failure_reason'),
  importJobId: uuid('import_job_id').references(() => importJobs.id),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** El escaneo de UNA PÁGINA de una hoja. Idempotente por (sheet, page, hash) — D13. */
export const sheetScans = pgTable('sheet_scans', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  batchId: uuid('batch_id').notNull().references(() => sheetScanBatches.id),
  printedSheetId: uuid('printed_sheet_id').references(() => printedSheets.id),
  pageIndex: integer('page_index').notNull(),
  imageHash: text('image_hash').notNull(),
  imageFileId: uuid('image_file_id').references(() => files.id),
  state: sheetScanStateEnum('state').notNull(),
  quality: jsonb('quality').$type<PageQuality>().notNull(),
  resolvedStudentId: uuid('resolved_student_id').references(() => students.id),
  identityConfidence: decimal('identity_confidence', { precision: 4, scale: 3 }),
  identityEvidence: jsonb('identity_evidence').$type<Record<string, unknown>>(),
  supersedesId: uuid('supersedes_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.printedSheetId, t.pageIndex, t.imageHash),
  index('sheet_scans_batch_idx').on(t.orgId, t.batchId),
]);

/** Una marca leída, con su evidencia (D11). */
export const sheetScanMarks = pgTable('sheet_scan_marks', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  scanId: uuid('scan_id').notNull().references(() => sheetScans.id, { onDelete: 'cascade' }),
  fieldId: text('field_id').notNull(),
  printedNumber: text('printed_number').notNull(),
  state: markStateEnum('state').notNull(),
  value: text('value'),
  fill: decimal('fill', { precision: 4, scale: 3 }).notNull(),
  threshold: decimal('threshold', { precision: 4, scale: 3 }).notNull(),
  margin: decimal('margin', { precision: 5, scale: 3 }).notNull(),
  cropFileId: uuid('crop_file_id').references(() => files.id),
  reviewedValue: text('reviewed_value'),
  reviewedById: uuid('reviewed_by_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
}, (t) => [
  unique().on(t.scanId, t.fieldId),
  index('sheet_scan_marks_review_idx').on(t.orgId, t.scanId, t.state),
]);
```

### Nota sobre `reviewedValue`

Sigue la disciplina de `responses.ai_score` / `human_score` (CLAUDE.md §8.3): **la lectura
automática nunca se sobrescribe**. `value` es lo que leyó la máquina; `reviewedValue` es lo
que decidió el humano. El valor efectivo es `reviewedValue ?? value`.

### RLS

Añadir a `packages/db/sql/rls-policies.sql` — **no sólo a la migración**, o se pierde al
aplanar (commit `53aa242`):

```sql
ALTER TABLE sheet_layouts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheet_layouts      FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheet_layouts_org_isolation ON sheet_layouts;
CREATE POLICY sheet_layouts_org_isolation ON sheet_layouts
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
-- ídem para sheet_print_runs, printed_sheets, sheet_scan_batches,
--            sheet_scans, sheet_scan_marks
```

Toda query a estas tablas corre dentro de `withOrgContext(db, orgId, tx => …)`, usando `tx`.

---

## 3.6 · El adaptador al módulo existente

`apps/api/src/sheet-scanning/scan-result.adapter.ts`

```ts
export function toParserResult(scans: ConfirmedScan[]): ParserResult;
```

Treinta líneas, y es la razón por la que este proyecto es viable. Convierte los escaneos
confirmados al mismo `ParserResult` que producen los cuatro parsers de CSV:

```ts
export interface ParsedAnswerSheetRow {
  rowNumber: number;
  studentRut: string | null;
  studentFullName: string | null;
  answers: Record<string, string | null>;   // key = printedNumber (D17)
  errors: AnswerSheetRowError[];
}
```

La clave del mapa `answers` es el `printedNumber`, que es exactamente lo que
`composite-answers.ts` ya sabe traducir a posiciones de ítem, incluidos los sub-ítems
compuestos.

**Desde este punto el flujo es idéntico al de un CSV de GradeCam**: matcher → previsualización
→ confirmación → `persistAssessmentResults` → dashboards. Cero código nuevo aguas abajo.

### Reglas de conversión

| `MarkState` efectivo | `answers[printedNumber]` |
|---|---|
| `marked` | El `value` |
| `blank` | `null` |
| `multiple` sin revisar | `null` + error de fila `ambiguous_mark` |
| `ambiguous` sin revisar | `null` + error de fila `ambiguous_mark` |
| Cualquiera con `reviewedValue` | El `reviewedValue` |
