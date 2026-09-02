# 07 — Identificación robusta de la hoja

> **Estado:** propuesta, sin implementar. Reemplaza el QR como canal crítico de identificación.
> **Origen:** siete sesiones de prueba con papel real entre el 30-ago y el 02-sep de 2026.

## 1. El problema

El QR identifica la hoja escaneada: la empareja con su `printed_sheet`, su tirada y su alumno, y
sostiene el gate G1 (rechazar un lote impreso con un diseño viejo). Cuando no decodifica, la hoja
cae en "identidades sin resolver" y hay que asignarla a mano.

En las pruebas con papel **falla de forma errática**: el mismo diseño, la misma impresora y la
misma app de escaneo dieron resultados opuestos en días distintos. En la última tanda, ninguna de
las tres hojas se identificó — mientras sus 19 marcas se leían con separación 0,70, holgada.

Ese es el síntoma que importa: **la hoja es perfectamente legible y la identidad falla igual**.
Son dos canales independientes con tolerancias distintas, y el frágil es el que no se puede
degradar con elegancia.

## 2. Seis hipótesis descartadas

Cada una parecía razonable hasta compararla contra el lote que sí funciona. Se documentan para que
nadie las vuelva a recorrer.

| # | Hipótesis | Cómo se descartó |
|---|---|---|
| 1 | El QR es muy chico | 36,6 mm el que falla vs 36,7 mm el que funciona |
| 2 | La impresión empasta la tinta | 31,9% de negro en ambos; corridas de módulo equivalentes |
| 3 | El escaneo lo borronea | El que falla es **más nítido**: laplaciano 1644 vs 1166 |
| 4 | Deformación geométrica | Lados dentro del 1,1%; diagonal 1.408 vs 1.414 ideal |
| 5 | Falta zona de silencio (`margin: 0`) | El recorte aporta 38–66 px; se necesitan 27 |
| 6 | Regresión de código | `QRCode.toBuffer`, `decode_region_qr`, `_identity_region_crop` y el payload son **idénticos** entre #156 y hoy, verificado con `diff` |

También se verificó el cruce: el QR viejo decodifica con el código de hoy, y el QR nuevo no lo lee
ni zxing crudo sobre la página completa, sin pasar por una línea del repo.

## 3. La medición que sí explica

El **ancho de transición** de la cadena impresora→escáner: cuánto se difumina un borde
blanco↔negro.

| Captura | Transición | Módulo del QR | Relación |
|---|---|---|---|
| 30-ago (QR OK) | 0,91 mm | 1,0 mm | **1,1 : 1** |
| 02-sep 16-02 (falla) | 0,91 mm | 1,0 mm | **1,1 : 1** |
| 02-sep 17-02 (falla) | 1,04 mm | 1,0 mm | **1,0 : 1** |
| GradeCam (referencia) | 0,65 mm | 2,3 mm (celda) | **3,5 : 1** |
| Nuestras burbujas | ~1,0 mm | ~4 mm | **4 : 1** |

**El módulo del QR mide lo mismo que el borrón del escáner.** Cada módulo se difumina sobre sí
mismo: estamos operando en el límite de resolución de la cadena, donde el resultado es una moneda
al aire. Eso explica la erraticidad, y explica por qué ninguna métrica global lo capturaba — la
página está nítida, el problema es que el elemento es demasiado fino para esa página.

### Regla de diseño

> **Todo elemento impreso que deba decodificarse mide al menos 3× el ancho de transición de la
> cadena de captura.**

Con la peor captura medida (1,04 mm), el piso es **~3 mm por celda**. El QR está en 1:1.

## 4. Referencia: cómo lo resuelve GradeCam

Dos hojas suyas, dos codificaciones, **la misma primitiva**:

- Una trae `GradeCam ID` (grilla de dígitos en burbujas) y `Form Identifier — DO NOT MARK`: dos
  filas de burbujas preimpresas, un código binario.
- La otra trae barras arriba y abajo. **No son un código de barras**: los anchos son múltiplos
  exactos de una unidad de ~50 px (1, 2 y 3 unidades), es decir una grilla binaria de celdas fijas
  de ~2,3 mm.

Ninguna de las dos usa una simbología estándar. Las dos se decodifican con su propio código de
visión, con celdas grandes y redundancia (arriba **y** abajo). La barra completa además sirve de
referencia de inclinación y escala.

## 5. Propuesta

### 5.1 Identidad de la hoja: fila de celdas binarias

Reemplaza al QR como canal crítico.

**Contenido (56 bits + trama):**

| Campo | Bits | Para qué |
|---|---|---|
| Código corto de hoja | 24 | Identifica la `printed_sheet` (16,7 M por org) |
| Prefijo del hash del diseño | 16 | Gate G1: detectar hojas de un diseño viejo |
| Índice de página | 4 | Hojas multipágina |
| CRC-12 | 12 | Descarta lecturas corruptas |

No se codifica el total de páginas: el spec congelado ya lo declara, así que era redundancia
débil. Esos 4 bits van al CRC — un CRC-8 deja pasar una lectura corrupta 1 de cada 256 veces, y
una identidad equivocada aceptada con confianza es exactamente el error que el MVP prohíbe.

**Regla de aceptación** (las tres condiciones, no alcanza el CRC solo):

1. El CRC-12 valida.
2. El código corto existe en `printed_sheets` **de la tirada del lote** — el lote se crea sobre
   una tirada, así que la base es un validador externo con probabilidad de colisión ínfima.
3. El prefijo de hash coincide con el diseño de la tirada (si no: gate G1, lote rechazado).

Si las dos filas pasan el CRC pero decodifican distinto → **sin resolver**, jamás elegir una.
Con las tres condiciones, la probabilidad de aceptar una identidad falsa por corrupción aleatoria
es ~1/4096 × (hojas de la tirada / 2²⁴): despreciable.

**Geometría:** celdas de **3,2 mm** sobre ~190 mm de ancho útil = 59 celdas por fila. 56 de datos
más 3 de trama asimétrica (patrón de arranque ≠ patrón de cierre, para que una lectura invertida
falle la trama antes que el CRC).

**Redundancia:** la misma fila arriba y abajo. No es adorno: en las capturas reales el lavado del
escáner se concentró en la banda inferior de la hoja (fiduciales inferiores con interior 126–183
sobre papel 255) — la fila de arriba sobrevive exactamente cuando la de abajo se lava, y viceversa.

**Ubicación:** fuera del área de respuestas, rotulada **NO MARCAR**, como hace GradeCam.

**Asignación del código corto:** aleatorio con reintento sobre índice único por org. Con 24 bits,
la paradoja del cumpleaños da ~50 % de probabilidad de colisión al llegar a ~4.800 hojas — el
reintento es parte del diseño, no un caso raro. No usar secuencial: filtra volumen de impresión
entre tiradas.

### 5.2 Identidad del alumno: burbujas

El modo `rut_bubbles` del V1 ya lo resuelve y su resolver es conservador: RUT ilegible, DV
inválido, sin match o duplicado en el curso → confirmación humana, nunca decide. No hay que
construir nada.

### 5.3 El QR queda como atajo oportunista — pero hoy cumple dos roles más

Si decodifica, ahorra trabajo. Si no, no importa: deja de estar en el camino crítico. No se quita
para no invalidar las hojas ya impresas.

⚠️ **El QR no es solo identidad.** En el pipeline actual valida dos cosas más, y la fila de celdas
tiene que heredarlas o la robustez ganada se pierde por otro lado:

1. **Orientación.** Una rotación 90/180/270 solo se acepta si el QR decodifica desde la región del
   spec (`_orientation_confirmed`). Con el QR degradado a atajo, la confirmación pasa a ser: la
   fila de celdas en su posición esperada, con trama y CRC válidos. Una hoja invertida lee la
   trama al revés y falla antes del CRC.
2. **Reconstrucción de la 4ª esquina.** Rectificar con 3 fiduciales solo se acepta si algo
   independiente confirma la homografía; hoy ese algo es el QR. Pasa a serlo la fila de celdas:
   si la esquina estimada está corrida, las celdas no caen en su grilla y el CRC falla. Es un
   validador **mejor** que el QR — 59 puntos de muestreo a lo ancho de la página contra un
   símbolo en una esquina.

Sin este traspaso explícito, demora el QR habría dejado al pipeline sin confirmación de
orientación ni de reconstrucción: dos regresiones silenciosas.

### 5.4 Código corto también en texto legible

Impreso junto a la fila, para que una persona pueda tipearlo si todo lo demás falla.

## 6. Qué cambia en el código

**`packages/db`** — columna `printed_sheets.short_code` (24 bits, único por org, con índice).

**`packages/types`** — el layout-spec gana un campo `kind: 'sheet_code'` con su geometría; el
esquema de `ScanResult` gana el código leído y su origen (`cells` | `qr`).

**`apps/api`** — `sheet-print.helpers.ts` dibuja las dos filas en `computeDrawPlan`/`renderSheetsPdf`;
el resolver de identidad prueba en orden: celdas → QR → sin resolver.

**`services/omr`** — un lector nuevo en `readers.py` que muestrea los centros de celda con el mismo
umbral relativo al papel que usan las marcas, valida CRC y cruza las dos filas. No toca el
rectificador ni el clasificador.

## 7. Compatibilidad y migración

- Es un **cambio de layout**: hay que congelar versión nueva y reimprimir. Los layouts congelados
  siguen siendo válidos y se leen con el camino QR de siempre.
- El lector soporta ambos: si el spec no declara `sheet_code`, cae al QR.
- El gate G1 se conserva por el prefijo de hash, con la misma semántica.

## 8. Riesgos y decisiones abiertas

| Riesgo | Mitigación |
|---|---|
| Un alumno marca sobre la fila | CRC + redundancia arriba/abajo + rótulo NO MARCAR |
| "Ajustar a página" achica las celdas | 3,2 mm tiene margen sobre el piso de 3,1 mm, pero conviene medirlo |
| El tamaño de celda es de una sola cadena de captura | Confirmar contra el conjunto de oro antes de fijarlo |
| «Ajustar a página» al 90 % deja la celda en 2,88 mm, bajo el piso de 3,1 | Medirlo en F0 con la maqueta impresa; si falla, la geometría admite crecer quitando bits al código corto |
| Una fila pasa el CRC con datos corruptos | Regla de aceptación de 3 condiciones (§5.1); dos filas válidas que difieren → sin resolver |

**Decisiones abiertas:** tamaño final de celda (se fija en F0 con papel real); si se mantiene el
QR a largo plazo. La asignación del código quedó decidida: aleatoria con reintento (§5.1).

## 9. Qué NO resuelve

Nada de esto toca `no_separable_marks` (marcas demasiado claras), ni las esquinas que el escáner
recorta, ni la calidad general de captura. Ataca **un** modo de falla: que la identificación muera
en una hoja por lo demás legible.

Y no reemplaza al conjunto de oro (O4): el piso de 3 mm sale de una impresora y tres escáneres.
