# 01 · Decisiones cerradas

> Estas decisiones no se re-litigan durante la implementación. Cada una indica **qué cierra**
> y **qué deja abierto**. Las marcadas `MVP` se implementan ahora; el resto son puntos de
> extensión que el diseño deja preparados pero no construye.

---

<a id="d1"></a>

## D1 · El OMR vive en un servicio Python aparte

FastAPI + OpenCV, **sin estado**, hablado por HTTP.

**Razón.** Node no tiene un OpenCV utilizable; el ecosistema de visión por computadora vive
en Python. Un servicio sin estado escala horizontalmente sin coordinación y se prueba solo,
con un archivo de entrada y uno de salida.

**Deja abierto.** Otro contenedor ECR en el `sst.config.ts`, junto al backend. Reemplazable
por una librería nativa sin tocar la API, porque el acceso pasa por el puerto `OmrClient`.

---

<a id="d2"></a>

## D2 · Un solo pipeline de imagen, siempre

Escáner y celular **no son dos estrategias**: son el mismo código con distinta calidad de entrada.

**Razón.** Dos caminos de código divergen y sólo uno se prueba de verdad. En una hoja plana
la homografía desde fiduciales sale casi-identidad: corre igual y no cuesta nada.

**Deja abierto.** Las diferencias viven en un `CaptureProfile`: **datos** (tolerancias, DPI
esperado, normalización de iluminación activada o no), no subclases. Un perfil nuevo es una
fila de configuración.

> Corrección explícita a la intuición inicial: un `ScannerStrategy` / `PhoneStrategy` habría
> sido el punto de corte equivocado.

---

<a id="d3"></a>

## D3 · `PageSource` sí es strategy

Resuelve de dónde salen los bitmaps: PDF multipágina, N fotos sueltas.

**Razón.** Ahí sí hay algoritmos genuinamente distintos que devuelven el mismo contrato.

**Deja abierto.** Agregar una fuente (cámara del navegador, carpeta de red) es una
implementación nueva, cero cambios aguas abajo.

---

<a id="d4"></a>

## D4 · `SheetIdentityResolver` es strategy

Quién es el alumno de esta hoja.

**Razón.** QR, burbujas de RUT y asignación manual son algoritmos genuinamente distintos que
devuelven lo mismo: **candidato + confianza**.

**Deja abierto.** Migrar a hoja genérica es escribir `RutBubbleResolver` y cablearlo. Cero
cambios en el pipeline.

---

<a id="d5"></a>

## D5 · `MVP` Hoja pre-impresa por alumno, con QR de identidad

**Razón.** Elimina el matching por nombre/RUT, que es la fuente histórica de errores
documentada en el proyecto (roster DIA, dígitos verificadores inválidos, matching por nombre).

**Deja abierto.** La hoja genérica queda cubierta por D4, no por un rediseño.

---

<a id="d6"></a>

## D6 · El `LayoutSpec` es inmutable y versionado

Se congela al imprimir y **su hash viaja dentro del QR**.

**Razón.** Si alguien edita el instrumento después de imprimir, las posiciones se corren y el
sistema corrige mal *en silencio*, para el curso completo. El hash lo detecta. Ver [G1](02-gaps.md#g1).

**Deja abierto.** Un instrumento puede tener varias versiones de hoja conviviendo
(reimpresión, formas A/B).

---

<a id="d7"></a>

## D7 · Coordenadas normalizadas 0–1 relativas a los fiduciales

Nunca coordenadas absolutas de página.

**Razón.** El "ajustar a página" de cualquier impresora rompe coordenadas absolutas. Es el
modo de falla más común y más difícil de diagnosticar, porque el PDF se ve perfecto.

**Deja abierto.** Cualquier tamaño de papel y cualquier DPI funcionan con el mismo spec.

---

<a id="d8"></a>

## D8 · Umbral relativo por hoja, con banda de incertidumbre explícita

Toda marca ambigua va a revisión humana.

**Razón.** Un umbral absoluto falla con lápiz claro, con fotocopia gris y con borrones. La
cola de revisión es lo que hace usable un sistema al 94% sin exigirle 99,9%.

**Deja abierto.** La banda es configurable por organización. Se puede angostar con datos
reales sin tocar código, usando la evidencia acumulada de D11.

---

<a id="d9"></a>

## D9 · El OMR nunca escribe en `responses`

Produce un `ScanResult`; el adaptador lo baja a `ParserResult` y el módulo existente persiste.

**Razón.** Una sola ruta de escritura a resultados, ya probada en producción. El escáner es
una fuente más, no un segundo camino de verdad.

**Deja abierto.** Cualquier lector futuro (otro proveedor, otro formato) entra por el mismo punto.

---

<a id="d10"></a>

## D10 · `MVP` Registro de `FieldReader` por tipo de campo

El MVP registra sólo `bubble_group`.

**Razón.** Abierto/cerrado (CLAUDE.md §4.1): sumar campos numéricos o regiones de desarrollo
es **registrar un lector**, no modificar el pipeline.

**Deja abierto.** `digit_grid` (numérico) y `crop_region` (desarrollo por LLM) entran sin
tocar lo existente.

---

<a id="d11"></a>

## D11 · Toda marca guarda su evidencia

Recorte de imagen, valor de llenado medido y umbral aplicado.

**Razón.** Sin evidencia no hay auditoría, no hay cola de revisión creíble y no se puede
calibrar el umbral con datos reales.

**Deja abierto.** Habilita medir precisión contra el conjunto de oro y ajustar el umbral por
organización (v1).

---

<a id="d12"></a>

## D12 · `MVP` Asíncrono con el `JobDispatcher` existente

Estado en `sheet_scan_batches`, polling desde el frontend.

**Razón.** Es el mecanismo que el proyecto ya usa (CLAUDE.md §12). BullMQ entra cuando haya
un gatillo de escala real.

**Deja abierto.** El puerto `JobDispatcher` ya está diseñado para migrar sin tocar los
llamadores.

---

<a id="d13"></a>

## D13 · Idempotencia por `(printedSheetId, pageIndex, imageHash)`

Re-escanear no duplica: reemplaza y conserva la versión anterior.

**Razón.** El re-escaneo es la operación **normal**, no la excepción: hoja arrugada, foto
movida, alumno que llegó tarde, corrección de una pregunta de desarrollo.

**Deja abierto.** El historial de escaneos por hoja queda disponible para auditoría.

---

<a id="d14"></a>

## D14 · `MVP` Sólo `multiple_choice` y `true_false`

**Razón.** Valida el núcleo óptico puro sin mezclarlo con el riesgo del LLM. Si el OMR no es
confiable, nada construido encima lo es.

**Deja abierto.** Los otros tipos entran por D10.

---

<a id="d15"></a>

## D15 · Las imágenes van a S3 por el módulo `files` existente

`owner_type='sheet_scan'`, subida por presigned URL.

**Razón.** CLAUDE.md §11: el backend nunca recibe el archivo en memoria. El módulo genérico
ya existe y está probado (E2E validado en demo).

**Deja abierto.** Cero infraestructura nueva de almacenamiento.

---

<a id="d16"></a>

## D16 · Las 6 tablas nuevas llevan `org_id` y política RLS

Política declarada en `packages/db/sql/rls-policies.sql`, no sólo en la migración.

**Razón.** CLAUDE.md §5.2. Las hojas escaneadas contienen el nombre del alumno: son datos
sensibles bajo Ley 19.628. El RLS ya se perdió una vez al aplanar migraciones (commit `53aa242`).

---

<a id="d17"></a>

## D17 · El layout habla en `printedNumber`, no en `position`

**Razón.** Es lo que el alumno ve impreso y lo que `composite-answers.ts` ya sabe traducir.
Los ítems compuestos (`19.1`…`19.5` sobre posiciones correlativas) sólo funcionan así.

**Deja abierto.** Reusa la resolución de sub-ítems ya escrita y probada.

---

<a id="d18"></a>

## D18 · Retención de imágenes: 180 días

Luego se borra el objeto en S3 conservando el resultado corregido.

**Razón.** La imagen contiene el nombre del alumno. El resultado no necesita la imagen para
existir.

**Deja abierto.** Configurable por organización si un colegio pide otra política.

---

## D19 · Todo elemento decodificable imprime ≥ 12 px/módulo a 240 dpi

Regla de diseño del canal de identidad ([07-identidad-qr-robusta.md](07-identidad-qr-robusta.md) §3),
vigilada por un test que mide el plan de impresión derivado real
(`apps/api/src/sheet-scanning/sheet-print.qr-version.spec.ts`): si un cambio de payload, región o
geometría baja el QR del piso, el test falla sin necesidad de papel.

**Razón.** La causa raíz del QR errático fue aliasing de remuestreo del escáner: el payload de 69
caracteres forzaba un QR versión 5 con 9,4 px/módulo a 240 dpi, bajo el umbral medido de ~10,8. El
experimento que sostiene el umbral discrimina (decodificación no monotónica con el tamaño; un
pasa-bajos previo la recupera). La geometría vigente (payload corto → versión 1, ECC Q, región a
0,18) imprime 17–20 px/módulo según el modo.

**Medido además.** `PdfPageSource` rasteriza a 200 dpi fijos con pdfium, que remuestrea imágenes
embebidas **con** suavizado — no reintroduce aliasing propio — y a 200 dpi el QR v1 conserva ~16
px/módulo: se mantiene el valor fijo. Y el kill del v5 **no es reproducible con sintéticos
limpios**: zxing decodifica un v5 sintético con dot-gain + blur σ3,5 + realce 2,5 + NN 0,40 + JPEG
82 en 4/4 fases (medido) — la muerte necesita la cadena física completa; por eso el guardarraíl es
el piso geométrico del impresor y no una simulación del escáner.

**Deja abierto.** Confirmar el umbral contra el conjunto de oro (O4).

---

## Tabla resumen

| ID | Decisión | Fase |
|---|---|---|
| D1 | Servicio de visión en Python, sin estado | MVP |
| D2 | Un solo pipeline + `CaptureProfile` como datos | MVP |
| D3 | `PageSource` como strategy | MVP |
| D4 | `SheetIdentityResolver` como strategy | MVP |
| D5 | Hoja pre-impresa por alumno con QR | MVP |
| D6 | `LayoutSpec` inmutable, versionado, hasheado en el QR | MVP |
| D7 | Coordenadas normalizadas relativas a fiduciales | MVP |
| D8 | Umbral relativo por hoja + banda de incertidumbre | MVP |
| D9 | El OMR nunca escribe en `responses` | MVP |
| D10 | Registro de `FieldReader` por tipo de campo | MVP |
| D11 | Evidencia por marca (recorte, llenado, umbral) | MVP |
| D12 | Asíncrono vía `JobDispatcher` existente | MVP |
| D13 | Idempotencia por hoja + página + hash de imagen | MVP |
| D14 | Sólo `multiple_choice` y `true_false` | MVP |
| D15 | Imágenes a S3 vía módulo `files` | MVP |
| D16 | `org_id` + RLS en las 6 tablas | MVP |
| D17 | El layout habla en `printedNumber` | MVP |
| D18 | Retención de imágenes 180 días | v1 |
| D19 | ≥ 12 px/módulo a 240 dpi, vigilado por test | identidad robusta |
