# 04 · Componentes

> Veintiún componentes en cuatro capas. La columna "responsabilidad única" es literal: si un
> componente necesita una segunda frase con "y también", está mal cortado (CLAUDE.md §4.1).
>
> Cada componente se especifica por su contrato, sus invariantes, sus modos de falla y **cómo
> se prueba sin el resto del sistema**. Un componente que no se puede probar aislado está mal cortado.

---

## 4.1 · Inventario

### Contratos compartidos — `packages/types`

| # | Componente | Responsabilidad única | Fase |
|---|---|---|---|
| C1 | `schemas/omr-layout.ts` | Definir y validar el `LayoutSpec` | MVP |
| C2 | `schemas/omr-scan.ts` | Definir `ScanResult`, `MarkState`, confianzas | MVP |
| C3 | `utils/layout-hash.ts` | Hash canónico y estable de un `LayoutSpec` | MVP |
| C4 | `access-policies/sheet-scanning.ts` | Constantes de rol del módulo (G6) | MVP |

### Persistencia — `packages/db/src/schema/sheet-scanning.ts`

| # | Tabla | Qué guarda | Fase |
|---|---|---|---|
| C5 | `sheet_layouts` | El `LayoutSpec` congelado + su hash. Inmutable | MVP |
| C6 | `sheet_print_runs` | Una tirada: layout, curso, evaluación, quién y cuándo | MVP |
| C7 | `printed_sheets` | Una hoja física. Su UUID va en el QR | MVP |
| C8 | `sheet_scan_batches` | Estado del lote subido | MVP |
| C9 | `sheet_scans` | Un escaneo de una página: identidad, confianza, calidad | MVP |
| C10 | `sheet_scan_marks` | Una marca con su evidencia (D11) | MVP |

### Backend — `apps/api/src/sheet-scanning/`

| # | Componente | Responsabilidad única | Fase |
|---|---|---|---|
| C11 | `SheetLayoutService` | Derivar un `LayoutSpec` desde un instrumento y congelarlo | MVP |
| C12 | `SheetPrintService` | Producir el PDF de una tirada y crear sus `printed_sheets` | MVP |
| C13 | `OmrClient` | Puerto hacia el servicio de visión | MVP |
| C14 | `SheetScanService` | Orquestar el lote de punta a punta | MVP |
| C15 | `identity/*.resolver.ts` | Resolver la identidad de una hoja | MVP |
| C16 | `ScanReviewService` | Servir la cola de revisión y aplicar correcciones humanas | MVP |
| C17 | `scan-result.adapter.ts` | `ScanResult` → `ParserResult` (D9) | MVP |

### Servicio de visión — `services/omr/` (Python)

| # | Componente | Responsabilidad única | Fase |
|---|---|---|---|
| C18 | `PageSource` | Entregar bitmaps normalizados desde PDF o imágenes (D3) | MVP |
| C19 | `Rectifier` | Detectar fiduciales y rectificar por homografía | MVP |
| C20 | `QualityGate` | Rechazar una captura **antes** de leerla | MVP |
| C21 | `FieldReader` + `MarkClassifier` | Muestrear y clasificar cada burbuja (D8, D10) | MVP |

### Frontend — `apps/web`

Cuatro vistas. La cola de revisión es la que decide si el producto se usa o se abandona.

| Vista | Ruta | Qué hace |
|---|---|---|
| Diseñador de hoja | `/hojas/[instrumentId]/disenar` | Revisar y ajustar el layout derivado antes de congelar |
| Tirada de impresión | `/hojas/[layoutId]/imprimir` | Elegir curso y reservas, descargar el PDF |
| Subida de lote | `/hojas/escanear` | Subir a S3 y seguir el progreso |
| **Cola de revisión** | `/hojas/lotes/[batchId]/revisar` | Resolver calidad, identidades y marcas ambiguas |

---

## 4.2 · Diseño individual

<a id="c11"></a>
### C11 · `SheetLayoutService`

`apps/api/src/sheet-scanning/sheet-layout.service.ts` — **MVP**

Deriva un `LayoutSpec` desde un instrumento existente y lo congela. Es el **único** componente
que puede crear una versión de layout.

```ts
deriveDraft(orgId: string, instrumentId: string): Promise<LayoutDraft>
freeze(orgId: string, spec: LayoutSpec): Promise<{ layoutId: string; layoutHash: string }>
getFrozen(orgId: string, layoutId: string): Promise<SheetLayout>
```

**Cómo deriva.** Lee los ítems del instrumento, filtra los tipos que el registro de lectores
soporta, ordena por `position` y distribuye en columnas de N burbujas según el conteo de
alternativas de cada ítem. La salida es una **propuesta**, no un hecho: el diseñador la ajusta
antes de congelar.

**Invariante duro.** `freeze` valida los 7 invariantes de [§3.1](03-contratos.md#invariantes) y
rechaza con `BadRequestException` si alguno falla. Un layout congelado nunca se actualiza; una
edición produce una fila nueva con `version + 1`.

**Falla que importa.** Un instrumento con ítems que ningún lector soporta produce un layout
parcial. `LayoutDraft` debe declararlo explícitamente —qué ítems quedaron fuera y por qué— en
vez de generar una hoja incompleta en silencio:

```ts
interface LayoutDraft {
  spec: LayoutSpec;
  excludedItems: { itemId: string; printedNumber: string; reason: string }[];
}
```

**Prueba aislada.** La derivación es una función pura sobre una lista de ítems. Sin base de
datos, siguiendo el patrón de `students-import.helpers.spec.ts`. La extracción de esa función
pura a `sheet-layout.helpers.ts` se justifica porque el impresor también la necesita para
previsualizar.

---

<a id="c12"></a>
### C12 · `SheetPrintService`

`apps/api/src/sheet-scanning/sheet-print.service.ts` — **MVP**

Convierte un layout congelado más un curso en un PDF listo para imprimir, y registra una
`printed_sheets` por hoja física.

```ts
createRun(orgId, { layoutId, classGroupId, assessmentId, spareCount }): Promise<PrintRun>
renderPdf(orgId, runId): Promise<Buffer>
```

**Qué dibuja cada página:**

1. Los cuatro fiduciales de esquina (cuadrados sólidos, `sizeRatio` del spec).
2. Marcas de sincronía laterales, para verificar la rectificación fila por fila.
3. Las burbujas en las coordenadas del spec, con su letra impresa al centro.
4. El QR con `academos:v1:<sheetId>:<hash>:<page>:<pages>`.
5. El nombre del alumno y el curso impresos arriba, para que la hoja sea usable por un humano.

Más `spareCount` hojas de reserva sin identidad ([G8](02-gaps.md#g8)): sin QR de alumno, con
un QR que sólo identifica la tirada.

**Librería.** `pdf-lib` en el backend. `jspdf` ya existe en `apps/web` pero la generación debe
ser server-side: es la única forma de garantizar que el PDF y las `printed_sheets` se crean en
la misma transacción.

> **La regla que no se negocia.** El impresor y el lector consumen **el mismo `LayoutSpec`**.
> Nunca hay dos fuentes de coordenadas. Si el PDF dibuja una burbuja donde el lector no busca,
> no es un bug de ninguno de los dos: es que alguien duplicó la verdad.

**Prueba aislada.** Test de ida y vuelta: renderizar, volver a leer el PDF y verificar que
cada centro de burbuja cae dentro de la tolerancia del spec. No necesita el servicio de visión.

---

<a id="c13"></a>
### C13 · `OmrClient`

`apps/api/src/sheet-scanning/omr.client.ts` — **MVP**

Puerto hacia el servicio Python, definido como interfaz para que los tests inyecten una
implementación falsa sin levantar nada. Contrato completo en [§3.4](03-contratos.md#34--contrato-http-del-servicio-de-visión).

**Responsabilidades del adaptador HTTP:** emitir las presigned URLs de lectura (imágenes) y de
escritura (recortes de evidencia), aplicar el tiempo límite por página, y reintentar una sola
vez ante `502`.

**No es responsabilidad del cliente** juzgar la calidad de la lectura. Eso lo dice
`quality.ok`, que viene del servicio.

**Modos de falla:** tiempo límite, servicio caído, y **respuesta bien formada pero mala** — el
más peligroso. Contra el tercero: el `QualityGate` corre dentro del servicio y su veredicto es
parte de la respuesta.

---

<a id="c14"></a>
### C14 · `SheetScanService`

`apps/api/src/sheet-scanning/sheet-scan.service.ts` — **MVP**

Orquesta el lote. Es el único componente que conoce el flujo completo.

```ts
createBatch(orgId, userId, dto): Promise<{ batchId; uploadIntents }>
startProcessing(orgId, batchId): void          // encola vía JobDispatcher
getBatch(orgId, batchId): Promise<BatchStatus> // polling del frontend
```

**El job, paso a paso:**

1. Marca el lote `processing`.
2. Carga el `LayoutSpec` congelado de la tirada.
3. Llama a `OmrClient.read` por archivo fuente.
4. Por cada página devuelta:
   a. Resuelve identidad con el `SheetIdentityResolver` del `identity.mode` del spec.
   b. **Verifica el `layoutHash`.** Si no calza → aborta el lote entero como `rejected` ([G1](02-gaps.md#g1)).
   c. Aplica idempotencia D13: si ya existe `(sheet, page, hash)`, marca el anterior `superseded`.
   d. Persiste `sheet_scans` + `sheet_scan_marks` dentro de `withOrgContext`.
5. Cuenta pendientes de revisión y deja el lote en `needs_review` o `confirmed`.

**Límite transaccional.** Las escrituras son **por página**, no por lote. Un lote de 40 hojas
no puede mantener una transacción viva mientras corre visión por computadora.

---

<a id="c15"></a>
### C15 · `SheetIdentityResolver`

`apps/api/src/sheet-scanning/identity/` — **MVP** (`QrIdentityResolver`)

```ts
export interface SheetIdentityResolver {
  readonly mode: 'qr' | 'rut_bubbles' | 'none';
  resolve(orgId: string, page: ScannedPage): Promise<IdentityCandidate>;
}

export interface IdentityCandidate {
  studentId: string | null;
  confidence: number;                    // 0..1
  evidence: Record<string, unknown>;
  needsHumanConfirmation: boolean;
}
```

**Nunca devuelve una identidad cerrada.** Aun el QR, que es determinístico, devuelve un
candidato: la hoja pudo ser rendida por otra persona ([G2](02-gaps.md#g2)). Lo que el QR
garantiza es la **hoja**, no el **alumno**.

**Las verificaciones de `QrIdentityResolver`:**

| Chequeo | Falla ⇒ |
|---|---|
| El QR se decodifica y tiene el prefijo `academos:v1` | Identidad sin resolver, va a la cola |
| El `printedSheetId` existe y pertenece a la org | Identidad sin resolver |
| El `layoutHash` calza con el layout de la tirada | **Lote rechazado completo** |
| `pageIndex < pageCount` del spec | Error de datos, página descartada |
| La hoja tiene `studentId` | Si no: hoja de reserva → cola manual |

**Migrar a hoja genérica** es escribir `RutBubbleResolver` —lee un `digit_grid`, valida el
dígito verificador con `normalizeRut` de `@soe/types`, busca en el roster— y registrarlo.
Ningún otro componente cambia.

**Prueba aislada.** El resolver recibe un `ScannedPage`, no una imagen. Se prueba con objetos
literales.

---

<a id="c16"></a>
### C16 · `ScanReviewService` y la cola

`apps/api/src/sheet-scanning/scan-review.service.ts` + `apps/web` — **MVP**

Es la pieza que hace usable el producto. **Un lector al 94% con una buena cola de revisión es
mejor producto que uno al 98% sin ella**, porque el segundo esconde su 2% y el primero lo pone
sobre la mesa.

```ts
getQueue(orgId, batchId): Promise<ReviewQueue>
resolveMark(orgId, userId, markId, value: string | null): Promise<void>
assignIdentity(orgId, userId, scanId, studentId: string): Promise<void>
discardScan(orgId, userId, scanId, reason: string): Promise<void>
confirmBatch(orgId, userId, batchId): Promise<ConfirmResult>
```

**Orden de la cola: por daño, no por página.**

1. Páginas rechazadas por calidad — hay que re-escanear y el profesor **todavía tiene las
   hojas a mano**. Si esto llega tarde, ya no se puede arreglar.
2. Identidades sin resolver.
3. Marcas ambiguas, ordenadas por `margin` ascendente: lo más dudoso primero.

**La interacción.** Recorte de la burbuja a la izquierda, alternativas a la derecha,
resolución con una tecla. Un profesor debe poder despachar cincuenta marcas dudosas en pocos
minutos, o va a abandonar el módulo y volver a GradeCam.

**Nada se persiste como resultado hasta que el lote está confirmado.** Confirmar con marcas
ambiguas sin resolver **está permitido**, pero cada una queda registrada como decisión humana
explícita con su autor — la misma disciplina de `ai_score` / `human_score` (CLAUDE.md §8.3).

**Autorización.** `SHEET_REVIEW_ROLES` ([G6](02-gaps.md#g6)) + `SensitiveDataGuard`, porque la
vista muestra el nombre del alumno junto a su hoja.

---

<a id="c17"></a>
### C17 · `scan-result.adapter`

`apps/api/src/sheet-scanning/scan-result.adapter.ts` — **MVP**

Treinta líneas. Función pura, sin `db`, sin servicios: es un helper, no un service. Contrato y
reglas de conversión en [§3.6](03-contratos.md#36--el-adaptador-al-módulo-existente).

**Prueba aislada.** Objetos literales de entrada y salida. Es el componente con mejor relación
entre riesgo cubierto y esfuerzo de prueba de todo el módulo.

---

<a id="c18"></a>
### C18 · `PageSource`

`services/omr/sources/` — **MVP**

```python
class PageSource(Protocol):
    def pages(self) -> Iterator[Page]: ...   # Page = (index, ndarray BGR)
```

Dos implementaciones: `PdfPageSource` (rasteriza a DPI fijo) e `ImagePageSource` (una imagen
por página, corrige la orientación EXIF).

**Termina donde entrega un bitmap.** No sabe nada de fiduciales, layouts ni burbujas.

---

<a id="c19"></a>
### C19 · `Rectifier`

`services/omr/rectify.py` — **MVP**

Detecta los cuatro fiduciales de esquina y calcula la homografía que lleva la página al
espacio normalizado del layout.

```python
def rectify(page: np.ndarray, spec: LayoutSpec) -> RectifiedPage | FiducialFailure
```

**Por qué corre siempre**, incluso en un escaneo plano donde la homografía sale casi-identidad:
[D2](01-decisiones.md#d2). Un solo camino de código, probado en todos los casos.

**Modo de falla.** Menos de 4 fiduciales ⇒ `FiducialFailure`, que el `QualityGate` traduce a
`rejectReason: 'fiducials_missing'`. Nunca se intenta leer una página sin rectificar.

---

<a id="c20"></a>
### C20 · `QualityGate`

`services/omr/quality.py` — **MVP**

Rechaza una captura **antes** de leerla. Es lo que impide que una foto mala produzca datos
malos que parecen buenos.

| Chequeo | Métrica | `rejectReason` |
|---|---|---|
| Desenfoque | Varianza del laplaciano normalizada | `blurry` |
| Reflejo | Fracción de píxeles saturados | `glare` |
| Fiduciales | Conteo detectado < 4 | `fiducials_missing` |
| Recorte | Fiduciales fuera del marco | `cropped` |
| Separabilidad | Menos de 2 grupos de llenado (ver C21) | `no_separable_marks` |

Los umbrales vienen del `CaptureProfile`: un perfil de celular es más tolerante al desenfoque
y más estricto con el reflejo que uno de escáner. **Son datos, no código** ([D2](01-decisiones.md#d2)).

---

<a id="c21"></a>
### C21 · `MarkClassifier` — el corazón del sistema

`services/omr/classify.py` — **MVP**

Decide si una burbuja está marcada. **Todo el valor del módulo depende de que esta decisión sea
correcta y de que sepa cuándo no lo sabe.**

**El umbral es relativo a la hoja, no absoluto.** Se muestrea el llenado de todas las burbujas
de la página y se busca la separación entre los dos grupos naturales —marcadas y vacías—. El
umbral cae en el medio. Esto absorbe automáticamente lápiz claro, lápiz oscuro, fotocopia gris
y foto subexpuesta, que es exactamente donde un umbral fijo falla.

```
fill      = fracción de píxeles oscuros dentro del círculo de la burbuja
threshold = punto medio entre los dos grupos separados (Otsu sobre los fills de la página)
margin    = |fill − threshold| / threshold

margin >= 0.25                    → marked / blank        (decisión firme)
margin <  0.25                    → ambiguous             → cola de revisión
dos burbujas sobre el umbral      → multiple              → cola de revisión
menos de 2 grupos separables      → toda la página rechazada por calidad
```

**El caso que rompe el método.** Una página donde el alumno no marcó nada no tiene dos grupos
que separar, y el algoritmo inventaría un umbral sobre puro ruido. Por eso existe la última
regla: si no hay separación clara, la página **no se lee, se rechaza**. Es preferible pedir un
re-escaneo antes que registrar a un alumno como entregado en blanco — el error exacto que el
proyecto ya documentó con los escaneos `review` de GradeCam
(`feedback-gradecam-status-review`).

**El valor 0.25 es una hipótesis, no un hecho.** Se calibra contra el conjunto de oro en la ola
O4 y queda configurable por organización en v1.

**Prueba aislada.** Fixtures de imagen versionadas con su etiqueta correcta, incluyendo los
casos sucios reales que GradeCam ya expuso en producción (`FORMATO-GRADECAM.md`):

- Doble burbuja: `ans` concatenado (`"VF"`).
- Marca a medio borrar.
- Hoja arrugada.
- Foto con sombra diagonal.
- Página completamente en blanco (debe rechazarse, no leerse).

---

### `FieldReader` — el punto de extensión

```python
class FieldReader(Protocol):
    kind: Literal['bubble_group', 'digit_grid', 'crop_region']
    def read(self, page: RectifiedPage, field: LayoutField) -> list[MarkReading]: ...

READERS: dict[str, FieldReader] = {
    'bubble_group': BubbleGroupReader(),
    # v1: 'digit_grid': DigitGridReader(),
    # v1: 'crop_region': CropRegionReader(),
}
```

Sumar un tipo de campo es **registrar un lector**, no modificar el pipeline ([D10](01-decisiones.md#d10)).
