# 08 — Plan de desarrollo: identidad QR robusta

> Implementa [07-identidad-qr-robusta.md](07-identidad-qr-robusta.md). Fases con **gate de salida
> medible**. A diferencia del plan anterior (archivado), **el diagnóstico ya está cerrado**: no hay
> fase de investigación, hay fases de construcción.

## Mapa

| Fase | Qué | Toca | Papel | Estado |
|---|---|---|---|---|
| F1 | Desacoplar los tres roles del QR | `services/omr` | no | ✅ gate pasado |
| F2 | Código corto + payload nuevo | `packages/db`, `packages/types`, `apps/api` | no | ✅ gate pasado |
| F3 | Geometría: ECC Q + región al techo seguro | `apps/api` | no | ✅ gate pasado (0,18, no 0,20 — ver nota) |
| F4 | Guardarraíl de resolución | `services/omr`, docs | no | ✅ (D19) |
| F5 | Validación con papel | todo | **sí** | ⏳ pendiente |

**Notas de ejecución (sep 2026).** F1 sumó dos piezas que el plan no anticipó, ambas medidas sobre
el banco real: la **firma de la grilla** como criterio de confirmación (correctas 1.000 vs
equivocadas ≤ 0.632, corte 0.9/piso 0.08) que además arbitra un **falso fiducial** vía
leave-one-out (captura N2: una mancha ganó la esquina con 4/4 detectados), y el **afinado de la
esquina reconstruida** maximizando la brecha de separación (captura L0: 0.354 no separable → 0.717
con las 19 marcas). En F3 la región no pudo llegar a 0,20×0,20: la grilla parte en y=0,18 y la
columna 3 llega a x=0,985 — el techo seguro es 0,18, y el piso de 12 px/módulo se cumple igual
(17–20 según modo). La banda lavada de N0 quedó como limitación vigilada (xfail) — ver 07 §6.

**F1 va primero y es independiente:** arregla un defecto presente (hoy un QR ilegible rechaza la
página en modo `rut_bubbles`) y no depende de nada de lo demás. Si el resto se posterga, F1 igual
vale la pena.

F2 y F3 tocan el mismo archivo (`sheet-print.helpers.ts`) — **no paralelizar**, van seguidas.

## F1 — Desacoplar los tres roles del QR

Hoy el QR decide tres cosas que no son identidad (§4.3 del diseño). Mientras sea así, cualquier
fallo de QR arrastra consecuencias que no le corresponden.

**Tareas**
1. `_orientation_confirmed`: aceptar confirmación de orientación por una vía que no sea el QR.
   Candidato natural: la asimetría de la propia hoja ya rectificada (el bloque de identidad está
   arriba). Definir el criterio y medirlo antes de codificarlo.
2. `_discard_unconfirmed_reconstruction`: idem — hoy una página con 3 fiduciales y QR ilegible se
   descarta aunque la homografía sea buena.
3. `peek_logical_page_index`: para hojas de una sola página no hace falta el QR; para multipágina,
   derivar el índice del orden del archivo con validación posterior.
4. **`_apply_orientation_verdict` en modo `rut_bubbles`**: dejar de rechazar la página cuando el QR
   de esquina no decodifica. Es el bug más concreto de los cuatro.

**Gate de salida:** sobre las 14 capturas archivadas, una hoja con QR ilegible pero marcas legibles
**se lee y va a "identidad sin resolver"**, en vez de rechazarse. Hoy 3 de esas 14 no lo hacen.
Los ~160 tests de visión intactos.

## F2 — Código corto y payload nuevo

**Tareas**
1. Migración: `printed_sheets.short_code` — **entero de 32 bits**, único por org, con índice.
   Asignación aleatoria con reintento (con 32 bits el reintento es raro, no rutinario).
2. `buildOmrQrPayload`: nuevo formato corto. Mantener el parser del formato viejo — las hojas ya
   impresas tienen que seguir leyéndose.
3. Resolver de identidad: aceptar ambos formatos, resolver el corto por `short_code` dentro de la
   tirada del lote.
4. El código corto **también impreso en texto legible**, para que una persona pueda tipearlo.

**Gate de salida:** el payload nuevo genera **versión 1 (21×21)** verificado con la librería real;
una hoja impresa con el formato viejo sigue resolviendo; tests de `sheet-scanning` en verde.

## F3 — Geometría del QR

**Tareas**
1. `errorCorrectionLevel: 'Q'` en vez de `'M'` (cabe: sigue en versión 1).
2. Región de identidad de 0,20 × 0,14 → **0,20 × 0,20** en la derivación del layout.
3. Verificar que el QR más grande no pise el fiducial superior derecho ni el bloque de nombre.

**Gate de salida:** **≥ 12 px/módulo a 240 dpi**, medido sobre el PDF generado. Con 4.1 + 4.2 el
cálculo da ~2,5 mm/módulo ≈ 23 px a 240 dpi — el doble del piso.

## F4 — Guardarraíl de resolución

Que el error no pueda volver a colarse.

**Tareas**
1. Test que falle si un layout derivado produce un QR con menos de 12 px/módulo a 240 dpi.
2. Recetas nuevas en el barrido sintético: remuestreo con aliasing a distintas fases, para que la
   regresión se detecte sin papel.
3. Documentar la regla en `01-decisiones.md` con el experimento que la sostiene.
4. **Considerar mitigar aliasing en el lector**: `PdfPageSource` rasteriza a 200 dpi fijo; cuando
   la imagen embebida viene a mayor resolución, hay un remuestreo nuestro que puede sumar aliasing
   propio. Medir si conviene rasterizar a la resolución nativa.

**Gate de salida:** el test de resolución falla al bajar el QR bajo el umbral, y pasa con la
geometría de F3.

## F5 — Validación con papel

**Tareas**
1. Congelar layout nuevo, imprimir la tirada de `6° Básico TEST`, rendir con los casos de la guía.
2. Escanear con las tres cadenas (Genius Scan, escáner plano, foto) — **incluido el escáner que
   producía el fallo a 240 dpi**, que es el caso que hay que ver resuelto.
3. Confirmar por la UI hasta dashboards.

**Gate de salida:** el QR decodifica en las tres cadenas, **incluida la que fallaba**. Cero
identidades incorrectas confiadas — una sola invalida la estrategia.

## Qué NO entra

- El diseño de celdas binarias: archivado en la rama `docs/identificacion-hoja-robusta` (PR #177
  cerrada). Si F5 falla contra todo pronóstico, ese documento es el punto de partida del plan B.
- El conjunto de oro completo (O4).
- El clasificador de marcas y sus umbrales.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El umbral de 12 px/módulo sale de 1 impresora y 4 escaneos | F5 lo prueba contra 3 cadenas; O4 lo confirma después |
| Un escáner a menos de 200 dpi baja el margen | A 200 dpi la geometría de F3 da ~19 px/módulo: sigue sobrando |
| Hojas ya impresas con payload viejo | F2 mantiene el parser viejo; se leen igual |
| «Ajustar a página» al 90 % | ~21 px/módulo a 240 dpi: sigue sobre el piso |
| F1 sin criterio de orientación alternativo sólido | Medirlo antes de codificar; si no hay uno confiable, mantener el QR para ese rol y desacoplar los otros dos |
