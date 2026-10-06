# Diagnóstico: seis hallazgos del primer uso real del lector de marcas

**Fecha:** 2026-09-24
**Corrida:** PAES M2 — Ensayo 5 (Tanda 5) · IV° Medio 2026 (instrumento `5f112483-1e00-4453-87e2-8a17235f61ab`), hojas personalizadas en modo QR, 17 hojas escaneadas (16 alumnos + 1 de reserva), tres tiradas de impresión (IV°A, IV°B, IV°C).
**Rama de referencia:** `origin/main` en `b5a069f`.
**Alcance:** sólo diagnóstico. Este documento no arregla nada; propone el arreglo de cada punto.

---

## 0. Lo primero que descarté: no hay desfase entre el código y lo desplegado

Antes de buscar causas conviene saber qué código corrió. Los tres despliegues salieron del
mismo commit, `b5a069f` (HEAD de `origin/main`), el 2026-09-15, y los tres terminaron en verde:

| workflow                                               | run         | resultado |
| ------------------------------------------------------ | ----------- | --------- |
| Deploy OMR (`services/omr` → ECR → App Runner)         | 35001752776 | success   |
| Deploy Backend (migrate + backfill → ECR → App Runner) | 35001752688 | success   |
| Deploy Frontend (SST)                                  | 35001752708 | success   |

`origin/main` no se movió desde entonces. Además, los dos commits que el usuario recordaba
**sí están en `main`**:

- `714c521` — `feat(omr): contrato v2 — suggestedValue, doubtReason y nullConfidence por marca`
- `948531d` — `feat(hojas): revision si/no con la alternativa sugerida por el motor`

**Conclusión:** ninguno de los seis hallazgos se explica por "eso todavía no está desplegado".
El código que corrió es exactamente el que se lee en este repo. Eso descarta de entrada la
hipótesis "el contrato v2 no está activo en el servicio desplegado" del hallazgo 2.

---

## 1. La hoja de reserva pide identificar al alumno sin mostrar la hoja

**Síntoma:** al resolver una hoja en estado `identity_unresolved`, la pantalla pide elegir al
alumno de una lista pero no muestra ninguna imagen de la hoja. Sin ver la hoja no se puede leer
el nombre escrito a mano.

### Causa raíz (tres capas, todas reales; la determinante es la primera)

**1a — El motor no genera la miniatura para este caso.** `services/omr/app/pipeline.py:272`

```python
needs_thumb = not quality["ok"] or identity["raw"] is None
```

y en `pipeline.py:280` esa bandera decide si se adjunta `pageThumbJpegBase64`.

Una hoja de reserva tiene el **QR perfectamente legible** y la calidad OK, así que
`identity["raw"]` no es `None` y `quality["ok"]` es `true` → `needs_thumb = False` → no se
adjunta miniatura. El backend, en cambio, resuelve ese QR contra `printed_sheets` y encuentra
una fila con `student_id = NULL` (una hoja de reserva nace así por diseño), en
`apps/api/src/sheet-scanning/identity/qr-identity.resolver.ts:75`:

```ts
if (sheet.studentId === null) {
  return {
    printedSheetId: sheet.printedSheetId,
    studentId: null,
    confidence: 0,
    evidence: { motivo: 'hoja_de_reserva', qr: raw },
    needsHumanConfirmation: true,
```

y con eso la página queda en `identity_unresolved`. Después,
`apps/api/src/sheet-scanning/sheet-scan.service.ts:696`:

```ts
const thumbFileId =
  page.pageThumbJpegBase64 === null
    ? null
    : await this.uploadEvidenceFile(...)
```

→ `thumb_file_id = NULL` en la fila de `sheet_scans`.

**El problema de fondo es que "sin identidad" significa dos cosas distintas en las dos capas.**
Para el motor es _QR ilegible_; para la base de datos es _sin alumno resuelto_. La hoja de
reserva es el único caso de `identity_unresolved` que cae en el hueco entre ambas definiciones:
identidad legible, alumno inexistente. Eso explica por qué esto nunca apareció en las pruebas
con hojas normales.

**1b — La API no ofrece ninguna alternativa a la miniatura.** `sheet_scans.source_file_id`
existe (`packages/db/src/schema/sheet-scanning.ts:190`) y **siempre** se puebla, pero el DTO de
revisión no lo expone: `ReviewScanModel`
(`packages/types/src/schemas/sheet-scanning.schema.ts:358-375`) sólo tiene `thumbUrl`, y
`scan-review.service.ts:932` lo deriva únicamente de `thumbFileId`. La maquinaria de URL
prefirmada ya existe (`scan-review.service.ts:894`, `GET /api/files/:id`); nadie la apunta a
`source_file_id`.

Tampoco hay recorte del bloque del nombre: los `crop_file_id` de `sheet_scan_marks` se generan
sólo para marcas `multiple`/`ambiguous` (`services/omr/app/readers.py`), y los layouts
autogenerados no definen ninguna región sobre el nombre manuscrito.

**1c — Aun con miniatura, la fila de identidad no permite leerla.**
`apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/ReviewQueue.tsx:454` usa
`<ScanThumb scan={scan} />` pelado, mientras la fila de calidad
(`ReviewQueue.tsx:150`) usa `<ScanPreviewDialog>` con zoom. `ScanThumb` pinta 80×96 px con
`object-cover` sobre una imagen de 400 px de ancho: inservible para leer un nombre a mano.
El diálogo de zoom se le dio a las hojas en blanco y a las ilegibles, y se omitió justamente
en identidades. Hoy, con `thumbUrl` en `null`, se ve el placeholder `ImageOff`
(`ReviewQueue.tsx:105`), que es lo que reportó el usuario.

### Confianza

**Alta** en la lógica: las tres capas están verificadas por lectura directa. **Media** en que
esa fila concreta tenga `thumb_file_id` NULL; eso se confirma con una consulta (ver §7).

### Arreglo propuesto

Extender la condición del motor a "tampoco hay identidad utilizable" no alcanza, porque el
motor no sabe si el QR corresponde a una hoja de reserva. Lo correcto es **no depender de la
miniatura**: exponer `source_file_id` como URL prefirmada en `ReviewScanModel` y darle a
`IdentityRow` el mismo `ScanPreviewDialog` que ya tiene `ScanRow`. Como complemento barato,
cambiar `needs_thumb` para que también incluya las páginas cuya identidad quedó sin confirmar.

---

## 2. Al corregir marcas a mano no apareció la sugerencia Sí/No

**Síntoma:** en las marcas dudosas la UI pidió elegir la alternativa desde cero, en vez de
ofrecer "¿Es la B? Sí / No" con la letra que sugiere el motor.

### Causa raíz: dos causas compatibles, y las dos pueden estar actuando

**2a — El Sí/No está detrás de un interruptor por organización, apagado por defecto, y nada
del repositorio lo enciende.**

La condición que decide el modo rápido está en
`apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/MarkReviewPanel.tsx:119`:

```tsx
const quickMode =
  quickConfirm &&
  current !== undefined &&
  current.suggestedValue !== null &&
  !isMarkResolved(current) &&
  !declinedMarkIds.has(current.markId);
```

`quickConfirm` baja desde `ReviewWizard.tsx:143` (`queue?.settings.quickConfirm ?? false`), que
el backend calcula con `isQuickConfirmEnabled(batch.orgConfig)` en
`packages/types/src/schemas/feature.schema.ts:88`:

```ts
export function isQuickConfirmEnabled(config): boolean {
  const parsed = orgConfigSchema.safeParse(config ?? {});
  return parsed.success && parsed.data.review?.quickConfirm === true;
}
```

El campo es `z.boolean().optional()` **sin `.default()`** (`feature.schema.ts:42`), y el
comentario de arriba lo dice textualmente: _"Apagado por defecto en el primer ciclo; se enciende
por org."_ La bitácora de la fase 5
(`docs/diseno-lector-de-marcas/11-pendientes-registro-bitacora.md:147-153`) registra encenderlo
como un paso manual **pendiente de demo**, con el `update organizations ... jsonb` a mano.

Con `quickMode = false` se pinta el panel de ingreso libre (rejilla de alternativas + En blanco +
Anulada), que es exactamente lo que describió el usuario. El `QuickConfirmChoice` existe y
funciona (`MarkReviewPanel.tsx:387-435`); nunca se activó.

**Hay un argumento de coherencia que refuerza esto:** la nula automática también está detrás de
un flag de la misma familia (`config.review.autoAnnulMinConfidence`, ausente = apagado) y esa
**sí** funcionó en la corrida (88/88). O sea, la configuración de la org se editó para un flag
del bloque `review` y no para el otro — que están uno al lado del otro en la misma pantalla.

**2b — Aunque el interruptor estuviera encendido, las dobles marcas nunca llevan sugerencia.**
`services/omr/app/readers.py:216`:

```python
if state == "ambiguous":
    return {"suggestedValue": suggested_value(field, samples, threshold), ...}
if state == "multiple":
    return {"suggestedValue": None, "doubtReason": DOUBT_MULTIPLE, "nullConfidence": ...}
return empty_doubt_fields()
```

Una `multiple` (doble marca) nunca trae `suggestedValue`: es una decisión de diseño. Y
`suggested_value()` (`readers.py:231-241`) devuelve `None` incluso en una `ambiguous` cuando
ninguna burbuja supera el umbral (marca muy tenue) o cuando la superan dos o más. Es decir: una
parte de las marcas dudosas **no tiene sugerencia posible** y va al panel libre por diseño, con
el flag encendido o apagado.

Como el usuario reportó que la nula automática resolvió las dobles, es plausible que las marcas
que corrigió a mano fueran justamente las que no llevan sugerencia.

### Lo que NO está roto

La cadena del contrato v2 está íntegra y verificada de punta a punta: el motor calcula los tres
campos con `OMR_CONTRACT_V2` en default **encendido** (`readers.py:68-79`, y `sst.config.ts` no
lo sobrescribe); Zod los declara (`packages/types/src/schemas/omr-scan.schema.ts`); hay columnas
dedicadas (`sheet_scan_marks.suggested_value`, `doubt_reason`, `null_confidence`); la API los
persiste y los devuelve en `ReviewMarkModel`; y el componente los lee. No falta ningún eslabón.

### Confianza

**Alta** en que el default está apagado y en que nada del repositorio lo enciende.
**Media** en cuál de 2a y 2b explica esa corrida concreta — se separan con dos consultas (§7).

### Arreglo propuesto

Ningún cambio de código hace falta para 2a: la pantalla
`/configuracion/revision-hojas` ya tiene el toggle "Confirmar con Sí/No"
(`apps/web/src/app/(dashboard)/configuracion/revision-hojas/review-settings-form.tsx:72-79`).
Enciéndelo para la org y vuelve a revisar un lote. Si se decide que el Sí/No es el
comportamiento deseado, el cambio de fondo es invertir el default del flag.

---

## 3. Las tiradas ya corregidas siguen ofreciéndose para escanear

**Síntoma:** las tres tiradas ya escaneadas y corregidas siguen apareciendo en la lista de
tiradas disponibles, sin distinción.

### Causa raíz: no existe ningún estado de cierre de tirada

`sheet_print_runs` (`packages/db/src/schema/sheet-scanning.ts:93-115`) no tiene `status`, ni
`closed_at`, ni `completed_at`, ni `deleted_at`. Sólo `created_at`. No hay nada por lo que
filtrar.

Y la lista, consecuentemente, no filtra: `apps/api/src/sheet-scanning/sheet-print.service.ts:452`

```ts
const where = and(
  eq(sheetPrintRuns.orgId, orgId),
  query.layoutId ? eq(sheetPrintRuns.layoutId, query.layoutId) : undefined,
  query.instrumentId ? eq(sheetLayouts.instrumentId, query.instrumentId) : undefined,
);
```

Nada más: **todas** las tiradas de la org, ordenadas por `desc(sheetPrintRuns.createdAt)`
(`:662`), sin ninguna noción de escaneo. Y el DTO tampoco permite pedir el filtro:
`printRunQuerySchema` (`packages/types/src/schemas/sheet-scanning.schema.ts:190-195`) sólo acepta
`layoutId`, `instrumentId`, `page` y `limit`. Una tirada creada hace seis meses y corregida hace
cinco pesa lo mismo que la de ayer. La web pide las 100 primeras sin criterio adicional
(`apps/web/src/app/(dashboard)/hojas/escanear/page.tsx:76`) y `ScanUploadForm.tsx:372-375` las
pinta todas: sin badge, sin orden por estado y sin deshabilitar ninguna.

### Lo que ya existe y hace barato el arreglo

**El criterio derivado ya está implementado y ya se usa como guarda en otro lugar.** En
`updateRun` (`sheet-print.service.ts:279-291`) el servicio pregunta exactamente eso antes de
permitir cambiar la evaluación de una tirada:

```ts
const [confirmed] = await tx
  .select({ id: sheetScanBatches.id })
  .from(sheetScanBatches)
  .where(
    and(
      eq(sheetScanBatches.orgId, orgId),
      eq(sheetScanBatches.printRunId, runId),
      eq(sheetScanBatches.status, 'confirmed'),
    ),
  )
  .limit(1);
if (confirmed) {
  throw new ConflictException('Esta tirada ya tiene un lote confirmado: ...');
}
```

Es decir: "esta tirada ya fue corregida" = _existe un `sheet_scan_batches` con
`print_run_id = run.id` y `status = 'confirmed'`_. El backend ya confía en ese predicado para
bloquear una operación destructiva; falta nada más que surtirlo a la lista.

Y hay más piezas ya construidas:

- **El endpoint de lotes ya responde la pregunta sin tocar la API.** `scanBatchQuerySchema`
  (`packages/types/src/schemas/sheet-scanning.schema.ts:197-202`) y el controller
  (`sheet-scan-batches.controller.ts:67-76`) admiten filtrar por tirada y por estado, así que
  `GET /sheet-scan-batches?printRunId=X&status=confirmed&limit=1` ya contesta "¿está corregida?".
- **El progreso impresas vs. escaneadas ya se calcula**, aunque por lote y no por tirada:
  `counters.sheetsExpected` / `sheetsScanned` en `BatchStatusModel`
  (`sheet-scanning.schema.ts:311-316`), computados en `sheet-scan.service.ts:982-1050` con
  `count(distinct sheet_scans.printed_sheet_id)` sobre `state = 'read'`; `sheetsExpected` es el
  `sheet_count` de la tirada.
- **La pantalla de escaneo ya trae los lotes en el mismo request**
  (`escanear/page.tsx:131-134`), con el caveat de que ese `limit=20` es una ventana.

Lo que falta es un agregado por tirada en `PrintRunModel` (algo como `hasConfirmedBatch` o
`sheetsScanned`), un parámetro de estado en `printRunQuerySchema`, y la distinción en la UI.
**Ninguna migración** — la señal es derivable.

### Confianza

**Alta.** Es ausencia de código, no un bug de comportamiento: no hay columna de estado y no hay
filtro. No necesita base de datos para confirmarse.

### Opinión técnica (la pregunta del usuario: ¿marcarlas y no mostrarlas?)

**No agregues una columna de estado, y no las escondas.**

1. **No hace falta un `status` nuevo.** El estado de la tirada es derivable de sus lotes, y
   derivarlo evita el clásico problema de dos fuentes de verdad que se desincronizan (una tirada
   marcada "cerrada" con un lote que después se rechaza). Un `exists` sobre `sheet_scan_batches`
   es una subconsulta y no una migración.

2. **Ocultar es peor que ordenar y etiquetar.** Escanear de nuevo una tirada ya corregida es un
   caso legítimo y frecuente: una hoja que se atascó, un alumno que rindió atrasado, una hoja
   que se escaneó al revés. El sistema ya está construido para soportarlo: `sheet_scans` es
   idempotente por `(printed_sheet_id, page_index, image_hash)` y las repeticiones se marcan
   `superseded` (`packages/db/src/schema/sheet-scanning.ts:178-224`), o sea que re-escanear no
   corrompe nada. Si la tirada desaparece de la lista, un flujo que el modelo de datos soporta
   se vuelve inalcanzable y el usuario no tiene forma de entender por qué. El daño real que
   reportó no es "está en la lista", es "no puedo distinguirla de la que me falta".

3. **Lo que yo haría:** que `PrintRunModel` traiga el estado derivado (por ejemplo
   `scannedSheets` / `sheetCount` y una bandera `hasConfirmedBatch`), ordenar la lista dejando
   arriba las tiradas sin corregir, marcar las corregidas con un `StatusBadge` ("Corregida",
   "3 de 17 hojas") y ponerlas detrás de un "Mostrar tiradas corregidas" plegado por defecto.
   Reversible, sin migración, y el flujo de re-escanear sigue existiendo.

4. **Un punto aparte:** con el hallazgo 4 arreglado, buena parte de la molestia se va sola. Hoy
   la lista muestra tres filas que dicen "Instrumento sin nombre" y se distinguen sólo por el
   curso; con el nombre y la fecha visibles, elegir la correcta ya deja de ser adivinanza.

---

## 4. La tirada aparece como "Instrumento sin nombre"

**Síntoma:** en la pantalla de escanear, la tirada se rotula "Instrumento sin nombre".

### Causa raíz: dos capas, una estructural y una que explica el caso concreto

**4a — La API de tiradas nunca devuelve el nombre, así que la web lo resuelve sola.**
El componente que realmente pinta el label es `PrintRunOptionLabel`, en
`apps/web/src/app/(dashboard)/hojas/escanear/ScanUploadForm.tsx:606-625`, cuya primera línea
(`:610`) es `{run.courseLabel} · {run.instrumentName}`. Ese `instrumentName` se produce en
`apps/web/src/app/(dashboard)/hojas/escanear/page.tsx:92`:

```tsx
instrumentName: instrumentNames.get(run.instrumentId) ?? 'Instrumento sin nombre',
```

El fallback existe porque el backend no manda el nombre: `selectRuns`
(`apps/api/src/sheet-scanning/sheet-print.service.ts:632-665`) hace `innerJoin(sheetLayouts)`,
`leftJoin(classGroups)`, `leftJoin(classGroupGrades)` y `leftJoin(assessments)`, pero **no
joinea `instruments`**, y selecciona apenas `instrumentId: sheetLayouts.instrumentId` (`:643`).
`PrintRunModel` (`packages/types/src/schemas/sheet-scanning.schema.ts:268-283`) trae
`classGroupName` resuelto por join pero no `instrumentName`. El nombre del curso viaja resuelto;
el del instrumento no.

**4b — El mapa con el que la web suple ese hueco está truncado a 100 instrumentos, ordenados del
más viejo al más nuevo.** `instrumentNames` se construye en `escanear/page.tsx:78-79` a partir de
`listInstrumentsForSheets()`, que en
`apps/web/src/app/(dashboard)/hojas/lib/instruments.ts:13-15` es:

```ts
export const listInstrumentsForSheets = cache(async () => {
  return apiGet<PaginatedResponse<InstrumentModel>>('/instruments?page=1&pageSize=100');
});
```

Una sola página. Y el backend ordena por antigüedad **ascendente** —
`apps/api/src/instruments/instruments.service.ts:96`:

```ts
.orderBy(instruments.createdAt)
```

`orderBy(columna)` sin `desc()` es ASC, así que la página 1 son **los 100 instrumentos más
viejos** visibles para la org. Un instrumento cargado hace poco —como PAES M2 Ensayo 5— queda
fuera, el `Map.get()` devuelve `undefined` y cae el fallback, sin error ni log.

Dos detalles que hacen esto más probable de lo que parece:

- El `pageSize` **no se puede subir**: `paginationSchema`
  (`packages/types/src/schemas/common.schema.ts:15`) lo topa en `.max(100)`.
- La ventana de 100 no es sólo del colegio: el filtro de visibilidad
  (`instruments.service.ts:545-557`) admite `org_id IS NULL OR org_id = :orgId`, o sea que los
  100 se reparten entre **todo el catálogo oficial** (los DIA y PAES compartidos) y los propios.

La misma falla afecta tres pantallas más, con el mismo string:
`apps/web/src/app/(dashboard)/hojas/page.tsx:120` (tabla de layouts) y `:182` (tabla de tiradas),
y `apps/web/src/app/(dashboard)/hojas/[id]/imprimir/page.tsx:84-85`.

### Sobre la sospecha del usuario: no es un campo inexistente ni un dato vacío

La sospecha era que el nombre se busca en un campo que no existe para instrumentos de tipo
`paes`. **No es eso, por tres razones verificadas:**

1. El campo es `instruments.name` (`packages/db/src/schema/instruments.ts:45-49`,
   `text('name').notNull()`) y es universal. No hay `title` ni un nombre alternativo por tipo.
2. El dato está y es correcto: consultado por el servidor analítico de sólo lectura, el
   instrumento `5f112483-…` devuelve `name: "PAES M2 — Ensayo 5 (Tanda 5) · IV° Medio 2026"`,
   `type: paes`, `status: published`. **No es un bug de datos.**
3. El mismo servicio lee ese campo sin problema en `renderPdf`
   (`sheet-print.service.ts:488`, `instrumentName: instruments.name`) para imprimir la cabecera
   de la hoja. El nombre sale bien en el PDF y mal en la lista: la diferencia es el join, no el
   esquema.

Tampoco es un snapshot que no se guardó: `sheet_print_runs` no tiene ninguna columna JSONB donde
se hubiera podido guardar el nombre (`packages/db/src/schema/sheet-scanning.ts:93-115`). La única
vía es el join.

Que se haya notado con un PAES es coincidencia: los PAES son de lo último que se cargó.

### Confianza

**Alta** en 4a: es estructural y se lee en `selectRuns` y `PrintRunModel`. El fallback sólo puede
dispararse si el id falta en el mapa; no hay otra rama.

**Media-alta** en 4b como explicación del caso concreto. Falta un dato para cerrarlo: que el
catálogo visible supere las 100 filas (§7).

**Predicción falsable, más rápida que la consulta:** si la causa es el desborde de la ventana,
el desplegable "Diseñar hoja" (`hojas/page.tsx:76-79` → `DesignSheetDialog.tsx:71-77`) se
alimenta de _la misma_ lista de 100 y por lo tanto **tampoco** puede listar este instrumento. Si
al abrirlo el instrumento **sí** aparece, 4b queda descartado y hay que buscar algo propio del
request (borrado lógico posterior, otro contexto de org, caché) — avísame y lo reviso.

### Arreglo propuesto

Subir el `pageSize` no es opción (está topado en 100) y sólo movería el techo. Lo correcto es que
el backend devuelva el nombre junto con la tirada, igual que ya hace con el curso: sumar
`leftJoin(instruments, eq(instruments.id, sheetLayouts.instrumentId))` y
`instrumentName: instruments.name` a `selectRuns` (`sheet-print.service.ts:632-665`), y el campo
a `PrintRunModel`. Es exactamente el join que `renderPdf` escribe unas líneas más abajo en el
mismo archivo. Con eso el label deja de depender de cuántos instrumentos tenga la org, y las
cuatro pantallas se arreglan juntas.

---

## 5. "El lector está procesando el lote" se ve congelado

**Síntoma:** el aviso de procesamiento se muestra sin animación y da la sensación de que algo
se rompió.

### Causa raíz: el ícono es un spinner al que nadie le puso `animate-spin`

`apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/ReviewWizard.tsx:396`:

```tsx
<AlertCallout tone="info" icon={Loader2} title="El lector está procesando el lote">
```

`Loader2` de lucide es un arco circular: **sin la clase `animate-spin` es un glifo estático**,
y se lee como un ícono roto más que como trabajo en curso. `AlertCallout` no sólo no la agrega,
sino que **no tiene forma de recibirla** —
`apps/web/src/components/shared/AlertCallout.tsx:55`:

```tsx
<Icon className={cn('mt-0.5 size-5 shrink-0', styles.icon)} aria-hidden />
```

El `className` del ícono está fijado dentro del componente y la interfaz `AlertCalloutProps`
(`AlertCallout.tsx:26-33`) sólo acepta `icon`, `tone`, `title`, `children` y `className` (este
último va al contenedor, no al ícono).

Que el vecino inmediato lo haga bien confirma el descuido: en el mismo archivo,
`ReviewWizard.tsx:383`, el botón de "Iniciar procesamiento" usa
`<Loader2 className="mr-2 size-4 animate-spin" />` con la clase puesta a mano. La convención del
repositorio es aplicar `animate-spin` en el sitio de uso, y en el único lugar donde el ícono lo
pinta un componente compartido, se perdió.

### Lo que descarté

El polling **no** está roto: `apps/web/src/app/(dashboard)/hojas/hooks/use-batch-status.ts:34`
refresca cada 3 s mientras el lote esté en `pending`/`processing`, hasta 200 intentos (~10 min).
El contador de "Llevamos N de M páginas" (`ReviewWizard.tsx:404`) sí avanza. Y el componente que
se ve es el correcto: `describeBatchStage` (`ReviewWizard.tsx:318`) devuelve `'procesando'`
cuando `batch.status === 'processing'` y `BatchStageStep` renderiza `ProcessingStep`
(`ReviewWizard.tsx:394`), que es el único lugar del repositorio con ese texto. Es un problema
puramente de presentación.

### Confianza

**Alta.** No requiere ni base de datos ni correr la app: es estático y verificable por lectura.

### Arreglo propuesto

Agregar un `iconClassName` (o un `spin?: boolean`) a `AlertCalloutProps` y pasarle
`animate-spin` desde `ProcessingStep`. Si se quiere que además _comunique_ avance, convertir
"Llevamos N de M páginas" en una barra de progreso con los valores que ya están en el modelo.

---

## 6. El filtro de instrumento no filtra en `/evaluaciones`

**Síntoma:** con
`?subjectId=…&gradeId=…&instrumentType=paes&instrumentId=5f112483-1e00-4453-87e2-8a17235f61ab`
la pantalla muestra ensayos anteriores. Los otros tres filtros sí se aplican.

### Causa raíz: dos huecos independientes, ambos en el backend

Rastreé la cadena completa. Los eslabones de la web están bien: la página
(`apps/web/src/app/(dashboard)/evaluaciones/page.tsx`) lee `searchParams`,
`dashboard-filters.ts` tiene `instrumentId` en `FILTER_KEYS` y lo serializa en el
`URLSearchParams`, y `apps/web/src/lib/api.ts` no toca la querystring. **El API recibe
`instrumentId=5f11…`.** Ahí se pierde, dos veces:

**6a — El DTO no lo declara, y Zod lo descarta en silencio.**
`packages/types/src/schemas/item-analysis.schema.ts:38-45`:

```ts
export const assessmentListQuerySchema = z.object({
  subjectId: uuidCsvSchema,
  gradeId: uuidCsvSchema,
  classGroupId: uuidCsvSchema,
  academicYearId: z.string().uuid().optional(),
  instrumentType: stringCsvSchema,
  applicationPeriod: csvArraySchema(z.enum(INSTRUMENT_APPLICATION_PERIODS)),
});
```

No hay `instrumentId` (`grep -c instrumentId` en ese archivo: **0**). Es un `z.object` plano, sin
`.passthrough()` ni `.strict()`: el `parse()` del controller
(`apps/api/src/item-analysis/item-analysis.controller.ts:26-29`) **borra la clave sin error y sin
log**. El schema hermano sí lo declara —
`packages/types/src/schemas/dashboard.schema.ts:29`, `instrumentId: z.string().uuid().optional()`
— así que el nombre que manda la web es el correcto.

**6b — El SQL tampoco lo filtra.** `apps/api/src/item-analysis/item-analysis.service.ts:122-148`
arma `conditions` con `subjectId`, `instrumentType`, `applicationPeriod`, `gradeId`,
`classGroupId` y `academicYearId`. **No existe ninguna rama para el instrumento.** El
`and(...conditions)` de `:182` es la query que realmente corre, e `instruments` ya está joineado
(`:174`, `innerJoin(instruments, eq(instruments.id, assessments.instrumentId))`), así que la
condición cabría en una línea. No es "se agrega al array y nunca se usa": no está escrita.

Contraste con el lugar donde sí está bien hecho —
`apps/api/src/dashboards/dashboards.service.ts:1603`:

```ts
if (query.instrumentId) conditions.push(eq(assessments.instrumentId, query.instrumentId));
```

**Los dos hay que arreglarlos.** Corregir sólo el schema deja el bug intacto por 6b, y sólo el
SQL lo deja intacto por 6a.

### Por qué el dropdown reacciona y la lista no

La pantalla se alimenta de dos endpoints: `/dashboards/filters` (las opciones de la barra, donde
el schema **sí** declara `instrumentId`) y `GET /api/item-analysis/assessments` (los datos). El
que ignora el filtro es el segundo. Por eso el selector queda correctamente seleccionado y la
lista de abajo no se mueve. Descarté filtrado en cliente:
`apps/web/src/app/(dashboard)/evaluaciones/components/assessment-list.tsx:25-28` sólo mapea y
enlaza.

También descarté la sospecha del read-model agregado: `assessment_item_stats` y
`assessment_results` aparecen sólo en el `EXISTS` de visibilidad (`:125-126`) y en el conteo de
alumnos (`:207-233`); no participan del filtrado. El problema no es "la fila agregada no tiene
`instrument_id`".

### Esto ya pasó, con otro parámetro

El mismo DTO tiene un test de regresión que documenta el bug idéntico —
`apps/api/src/item-analysis/item-analysis.service.spec.ts:1179-1183`:

> Regresión: el DTO no declaraba `applicationPeriod`, y como z.object descarta las claves
> desconocidas, el "Momento" del DIA se perdía en el parse y la lista devolvía los tres momentos.
> /dashboards sí lo filtraba, así que el dropdown reaccionaba y la lista no.

Es literalmente el síntoma actual con `instrumentId`. Se arregló para un parámetro y no se
auditó el resto del DTO. El spec cubre `subjectId`, `gradeId`, `instrumentType` y
`applicationPeriod`, y **ningún caso con `instrumentId`**.

### Confianza

**Alta.** No necesita base de datos ni correr la app: la querystring llega completa, el `parse`
la recorta y el SQL nunca menciona el instrumento. "Ensayos anteriores de la misma asignatura,
nivel y tipo" es la predicción exacta de estas dos fallas, porque los otros tres filtros sí están
en `conditions`.

### Arreglo propuesto

Declarar `instrumentId` en `assessmentListQuerySchema` (multi-valor, para ser coherente con sus
hermanos) y agregar `conditions.push(...)` sobre `assessments.instrumentId` en `listAssessments`,
con un test por cada mitad. Vale la pena, además, una auditoría de una sola pasada comparando
`FILTER_KEYS` de la web contra las claves de los dos schemas: este es el segundo parámetro que se
pierde por la misma razón y no hay nada que impida un tercero.

---

## 7. Lo que no puedo determinar sin la base de datos

Nada de lo anterior depende de estas consultas para sostenerse, pero cierran las tres premisas
que quedaron en confianza media.

**Para el hallazgo 1** — confirmar que la hoja de reserva quedó sin miniatura y con el motivo
esperado:

```sql
select id, state, thumb_file_id, source_file_id, identity_evidence
from sheet_scans
where state = 'identity_unresolved' and batch_id = '<batchId>';
```

Esperado: `thumb_file_id` NULL, `source_file_id` no nulo,
`identity_evidence->>'motivo' = 'hoja_de_reserva'`.

**Para el hallazgo 2** — separar 2a de 2b:

```sql
-- ¿el interruptor está encendido para la org?
select config->'review' from organizations where id = '<orgId>';

-- ¿el motor llenó la columna, y en qué estados?
select m.state, m.doubt_reason, count(*) as marcas, count(m.suggested_value) as con_sugerencia
from sheet_scan_marks m join sheet_scans s on s.id = m.scan_id
where s.batch_id = '<batchId>' and m.state in ('multiple','ambiguous')
group by 1, 2;
```

- Si `config->'review'` trae `autoAnnulMinConfidence` pero **no** `quickConfirm`, y hay filas
  `ambiguous` con `suggested_value` no nulo → causa única: el interruptor (2a).
- Si `con_sugerencia = 0` en todas las filas → el motor no emitió sugerencias para ese lote: o
  eran todas `multiple` (2b), o `OMR_CONTRACT_V2` está en `0` en el App Runner desplegado (el
  env efectivo no se puede leer desde el repo; `sst.config.ts` no lo fija, así que debería estar
  en su default encendido).

**Para el hallazgo 3** — confirmar que las tres tiradas tienen lote confirmado (si alguna quedó
en `needs_review`, el criterio propuesto la seguiría mostrando como pendiente, y eso sería
correcto):

```sql
select b.print_run_id, b.status, count(*)
from sheet_scan_batches b
where b.org_id = '<orgId>' and b.print_run_id in ('<run A>', '<run B>', '<run C>')
group by 1, 2;
```

**Para el hallazgo 4** — confirmar la truncación. Ojo con el filtro de visibilidad: cuenta
también el catálogo oficial (`org_id is null`), porque es el que la API devuelve en la misma
página:

```sql
-- ¿el catálogo visible supera las 100 filas?
select count(*) from instruments
where deleted_at is null and (org_id is null or org_id = '<orgId>');

-- ¿en qué posición queda este instrumento, ordenado por antigüedad ASC?
select count(*) from instruments
where deleted_at is null and (org_id is null or org_id = '<orgId>')
  and created_at <= (select created_at from instruments
                     where id = '5f112483-1e00-4453-87e2-8a17235f61ab');
```

Si el segundo número es mayor que 100, el instrumento cae fuera de la página 1 y el diagnóstico
queda cerrado. Alternativa sin SQL, más rápida: abrir el desplegable "Diseñar hoja" en `/hojas` y
ver si el instrumento aparece (ver la predicción falsable del §4).

---

## 8. Resumen

| #   | Hallazgo                                     | Causa raíz                                                                                                                                                                  | Archivo:línea                                                                                             | Confianza                           |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | Sin imagen al identificar la hoja de reserva | El motor adjunta miniatura sólo si la calidad falla o el QR es ilegible; la hoja de reserva tiene QR legible y alumno NULL → `thumb_file_id` NULL                           | `services/omr/app/pipeline.py:272` (+ `qr-identity.resolver.ts:75`, `sheet-scan.service.ts:696`)          | Alta (lógica) / Media (la fila)     |
| 1b  | —                                            | El DTO de revisión no expone `source_file_id`, que sí está poblado                                                                                                          | `scan-review.service.ts:932`; `sheet-scanning.schema.ts:358-375`                                          | Alta                                |
| 1c  | —                                            | `IdentityRow` usa `ScanThumb` pelado, sin el `ScanPreviewDialog` de zoom que sí tienen las otras filas                                                                      | `ReviewQueue.tsx:454` vs `:150`                                                                           | Alta                                |
| 2   | Sin sugerencia Sí/No                         | `config.review.quickConfirm` es opcional sin default y nada lo enciende → `quickMode` false → panel libre                                                                   | `feature.schema.ts:42` y `:88`; `MarkReviewPanel.tsx:119`                                                 | Alta                                |
| 2b  | —                                            | Las dobles (`multiple`) y las tenues nunca llevan `suggestedValue`: no habría Sí/No ni con el flag encendido                                                                | `services/omr/app/readers.py:216-241`                                                                     | Alta (diseño) / Media (esa corrida) |
| 3   | Tiradas corregidas siguen disponibles        | No existe estado de cierre en `sheet_print_runs` y la lista sólo filtra por org/layout/instrumento                                                                          | `packages/db/src/schema/sheet-scanning.ts:93-115`; `sheet-print.service.ts:452`                           | Alta                                |
| 4   | "Instrumento sin nombre"                     | `selectRuns` no joinea `instruments`, así que el nombre no viaja en el DTO                                                                                                  | `sheet-print.service.ts:632-665` (`:643`); `sheet-scanning.schema.ts:268-283`                             | Alta                                |
| 4b  | —                                            | El mapa con el que la web lo suple sale de `/instruments?page=1&pageSize=100` ordenado por `created_at` **ASC** (tope 100 inamovible): los instrumentos nuevos quedan fuera | `hojas/lib/instruments.ts:14`; `instruments.service.ts:96`; `common.schema.ts:15`; `escanear/page.tsx:92` | Media-alta (falta el conteo)        |
| 5   | "Procesando el lote" congelado               | `Loader2` sin `animate-spin`, y `AlertCallout` no permite pasarle clase al ícono                                                                                            | `ReviewWizard.tsx:396`; `AlertCallout.tsx:55`                                                             | Alta                                |
| 6   | El filtro de instrumento no filtra           | `assessmentListQuerySchema` no declara `instrumentId` (Zod lo descarta) **y** `listAssessments` no tiene condición sobre `assessments.instrumentId`                         | `item-analysis.schema.ts:38-45`; `item-analysis.service.ts:122-148`                                       | Alta                                |

### Dos observaciones colaterales

- **Mismo bug latente, otro parámetro.** El hallazgo 6 es la segunda ocurrencia de "clave no
  declarada en un `z.object` → descarte silencioso" en el mismo DTO. Conviene la auditoría de
  `FILTER_KEYS` contra los dos schemas, no sólo el parche puntual.
- **Dos definiciones de "nivel" para la misma querystring.** `listAssessments` filtra el nivel por
  `classGroups.gradeId` (`item-analysis.service.ts:142`) mientras `dashboards` lo filtra por
  `instruments.gradeId` (`dashboards.service.ts:1608`). No es este bug, pero puede producir
  discrepancias entre `/evaluaciones` y `/resultados`.
