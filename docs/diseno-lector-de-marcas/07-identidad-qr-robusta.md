# 07 — Identidad robusta: diagnóstico cerrado y estrategia

> **Estado:** diagnóstico **cerrado** con causa raíz verificada. F1–F4 del plan
> ([08-plan-identidad-qr-robusta.md](08-plan-identidad-qr-robusta.md)) **implementadas**; pendiente
> F5 (validación con papel, incluido el escáner que fallaba a 240 dpi).
> **Origen:** ocho sesiones de prueba con papel real, 30-ago a 02-sep de 2026.
> **Reemplaza** a la propuesta de celdas binarias (rama `docs/identificacion-hoja-robusta`, PR #177
> cerrada): su premisa era falsa y su solución, innecesariamente cara.

## 1. El síntoma

El QR identifica la hoja: la empareja con su `printed_sheet`, su tirada y su alumno, y sostiene el
gate G1. Cuando no decodifica, la hoja cae en "identidades sin resolver".

Falla de forma **errática**: el mismo diseño, la misma impresora y la misma app dieron resultados
opuestos en días distintos. Nueve explicaciones se propusieron y **las nueve primeras se cayeron
al medirlas**. La décima resistió.

## 2. Causa raíz: aliasing de remuestreo en el escáner

La cadena, con cada eslabón verificado por separado:

| Eslabón | Estado | Cómo se verificó |
|---|---|---|
| PDF fuente | ✅ íntegro | Decodifica; sobrevive blur σ=4, JPEG q=10, ruido 25 |
| Impresión en papel | ✅ íntegra | Foto cruda del papel decodifica: `academos:v1:2d7e6851-…` |
| **Escaneo** | ❌ **rompe el símbolo** | Todo lo anterior está bien y el resultado no decodifica |

El escáner captura a su resolución nativa y **reduce la imagen a ~240 dpi** para el JPEG. Ese
remuestreo, sin filtro pasa-bajos adecuado, **voltea módulos individuales**: cuando el factor de
escala bate contra la grilla, un módulo cae en el borde de un píxel y sale del color equivocado.
El daño queda grabado en el archivo antes de que el lector lo vea, y por eso ningún preprocesamiento
lo recupera — la información ya no está.

### La prueba que lo demuestra

Sobre la **foto del papel** (que decodifica), reduciendo a distintos tamaños:

| Lado del QR | px/módulo | Sin antialiasing | Con antialiasing |
|---|---|---|---|
| 400 px | 10,8 | ✅ | ✅ |
| 320 px | 8,6 | ❌ | ✅ |
| 300 px | 8,1 | ❌ | ✅ |
| 285 px | 7,7 | ❌ | ✅ |
| 240 px | 6,5 | ❌ | ✅ |
| 210 px | 5,7 | ❌ | ❌ (pérdida real) |

**No es monotónico** — decodifica a 210 y falla a 240 — que es la firma inequívoca del aliasing y
no de la pérdida de información. Y aplicando un pasa-bajos antes de reducir, **todos los tamaños
que fallaban decodifican**.

### Los números en las capturas reales

| Escaneo | dpi nativo | px/módulo | QR |
|---|---|---|---|
| 30-ago | **278** | **10,83** | ✅ |
| 02-sep · 16-02 | 241 | 9,37 | ❌ |
| 02-sep · 17-02 | 240 | 9,35 | ❌ |
| 02-sep · A/B (6 QR) | 243 | 9,45 | ✅ los 6 |

El único escaneo que funciona está en 10,83 px/módulo — **exactamente el umbral medido sobre la
foto**. Los que fallan, por debajo.

El A/B decodifica sus 6 QR a 9,45, bajo el umbral: **el aliasing depende de la fase**, no es un
corte determinista. Los 6 códigos comparten una sola imagen y por lo tanto una sola fase de
remuestreo — ganaron juntos la misma lotería. Cada hoja de respuestas, en cambio, es una imagen
distinta con su propia fase. **Por debajo del umbral se entra en una lotería; por encima, no.**

### Por qué esto explica todo lo que las otras nueve hipótesis no

- **La falla es binaria** (0 éxitos parciales en 6 preprocesamientos × 2 decodificadores): el
  aliasing golpea o no golpea según la fase.
- **Los escaneos más nítidos fallan más**: menos filtrado óptico significa *más* aliasing. La
  nitidez juega en contra.
- **CamScanner decodificaba**: su desenfoque agresivo actuaba de antialiasing por accidente.
- **El tamaño en milímetros no predice nada**: importa la relación módulo/paso de muestreo, no la
  medida física.
- **El QR fuente es indestructible con blur**: el blur *ayuda* — es lo contrario del problema.

### Las nueve hipótesis descartadas

Se documentan para que nadie las vuelva a recorrer. Todas parecían razonables.

| # | Hipótesis | Cómo se descartó |
|---|---|---|
| 1 | QR muy chico | 36,6 mm el que falla vs 36,7 mm el que funciona |
| 2 | Empaste de tinta al imprimir | 31,9 % de negro en ambos grupos |
| 3 | Borroneo del escaneo | El que falla es **más nítido** (laplaciano 1644 vs 1166) |
| 4 | Deformación geométrica | Lados dentro del 1,1 %; diagonal 1,408 vs 1,414 |
| 5 | Falta zona de silencio (`margin: 0`) | Simulación: margin 0 y margin 1 sobreviven igual |
| 6 | Regresión de código | Generación, lectura y payload idénticos, verificado con `diff` |
| 7 | Módulo ≈ ancho de transición ("regla 3:1") | **Métrica circular**: devuelve el módulo con blur cero |
| 8 | Resolución nativa del escaneo | El A/B decodifica a 243 dpi, igual que los que fallan |
| 9 | Irregularidad de la grilla | La grilla más regular (4,1 %) falla; la más irregular (63,5 %) funciona |

Dos de esas correcciones vinieron del usuario mirando el papel físico, y la séptima —que llegó a
sostener un documento de diseño entero— la derribó una auditoría independiente.

## 3. La regla de diseño que sale de esto

> **Todo elemento impreso que deba decodificarse tiene al menos 12 px por módulo a la resolución
> de escaneo esperada.**

Con 240 dpi como piso realista de un escáner de colegio, eso son **~1,27 mm por módulo**. El umbral
medido es 10,8; 12 deja margen para la fase.

Esta regla reemplaza a la "regla del 3:1" del documento anterior, que era inválida. La diferencia
importante: **esta se mide con un experimento que discrimina** — reducir una imagen buena a
distintos tamaños y ver dónde deja de decodificar.

## 4. Estrategia

Tres cambios, ninguno inventa simbología nueva.

### 4.1 Acortar el payload — el arreglo principal

Hoy el payload son **69 caracteres** (`academos:v1:<uuid 36>:<hash 16>:0:1`), lo que fuerza un QR
**versión 5, 37×37 módulos**. Con un código corto de ~10 caracteres baja a **versión 1, 21×21**:

| Payload | Versión | Módulos | Módulo a 36,6 mm | px/módulo a 240 dpi |
|---|---|---|---|---|
| **hoy** (69 ch, ECC M) | 5 | 37×37 | 0,989 mm | **9,4** ← zona de aliasing |
| **corto** (10 ch, ECC Q) | 1 | 21×21 | **1,743 mm** | **16,5** ✅ |

**+76 % de módulo**, con **más** corrección de errores que hoy (Q en vez de M), en el mismo espacio
físico. Requiere una columna `printed_sheets.short_code` con índice único por org.

**32 bits, no 24.** Con 24 la paradoja del cumpleaños da 50 % de colisión a ~4.800 hojas por org —
un colegio mediano en un año, con la contención de escritura que implica reintentar. Con 32 bits
el problema desaparece y el payload sigue cabiendo en versión 1.

### 4.2 Región de identidad cuadrada — palanca gratis

En `sheet-print.helpers.ts:162`, `qrSize = min(regionWidth, regionHeight)` y la región es
**0,20 × 0,14** del marco: el QR está limitado por la **altura**, no por el ancho. Llevarla a
0,20 × 0,20 agranda el QR a ~52 mm sin tocar nada más. Combinado con 4.1 da **~2,5 mm por módulo**.

### 4.3 Desacoplar los tres roles del QR

El QR hoy no es sólo identidad. Verificado en `services/omr/app/pipeline.py`:

| Rol | Dónde | Qué pasa si el QR falla |
|---|---|---|
| Confirmar orientación | `_orientation_confirmed` (~271) | No se acepta una rotación 90/180/270 |
| Validar reconstrucción de la 4ª esquina | `_discard_unconfirmed_reconstruction` (~254) | Se descarta una página recuperable |
| Elegir qué campos leer (multipágina) | `peek_logical_page_index` (~331) | Se puede leer el conjunto equivocado → `no_separable_marks` |

Y un defecto presente que hay que arreglar **igual**: en modo `rut_bubbles`, un QR que no decodifica
**rechaza la página entera** (`_apply_orientation_verdict`, ~285). El modo pensado para no depender
del QR depende del QR.

Estos tres roles se desacoplan con o sin el resto de la estrategia.

## 5. Qué NO se hace

- **No se construye simbología propia.** La propuesta anterior (filas de celdas binarias con CRC-12
  y trama asimétrica) resolvía el problema por la misma vía —módulos grandes— pero exigía dos
  implementaciones en TS y Python que coincidieran bit a bit, sin librería ni ecosistema. El canal
  estándar está usado al 57 % de su capacidad de módulo: no está agotado.
- **No se cambia a código de barras.** Mismo argumento: es otro canal con su propio decodificador.
- **No se toca el clasificador de marcas** ni el gate de nitidez.

## 6. Qué no resuelve

Nada de esto arregla `no_separable_marks` (marcas demasiado claras), ni las esquinas que el escáner
recorta, ni la calidad general de captura. Ataca el canal de identidad, que es donde estaba el
problema.

⚠️ Medido durante F1: hacer robusta la identidad **expone más** la limitación de marcas lavadas,
porque hojas que antes se rechazaban por identidad ahora se leen. En la captura N0 del banco real,
la banda inferior lavada deja 4 marcas reales (filas 20–23, fills 0,26–0,40) al mismo nivel que los
anillos vacíos (0,33–0,43): salen como `blank` confiado. No es una regresión — el pipeline de `dev`
lee exactamente igual una hoja lavada cuyo QR sí decodifica — pero el rechazo accidental por
identidad ya no la tapa. La señal de fiduciales lavados no discrimina (los interiores detectados de
N0 miden 0,06–0,15, sanos; el fiducial lavado es justo el que falta). Queda como limitación
conocida del clasificador; resolverla pide una señal nueva (p. ej. oscuridad del anillo por
burbuja) con su propia medición, fuera de este plan.

Y el umbral de 12 px/módulo sale de **una impresora y cuatro escaneos**. Confirmarlo contra el
conjunto de oro (O4) sigue pendiente.
