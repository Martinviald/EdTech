# 08 — Plan de desarrollo: identificación robusta

> Planifica la implementación de [07-identificacion-robusta.md](07-identificacion-robusta.md).
> Mismo formato que el plan del MVP: fases con **gate de salida medible** — no se avanza sin
> pasarlo. El orden está elegido para que lo barato y reversible valide lo caro e irreversible:
> el papel se imprime una sola vez, al final.

## Mapa

| Fase | Qué | Toca | Papel | Riesgo si se salta |
|---|---|---|---|---|
| F0 | Validación empírica del tamaño de celda | nada (maqueta) | **sí** | Fijar geometría sobre un cálculo, no una medición |
| F1 | Contratos congelados | `packages/types`, `services/omr/contracts` | no | Backend y lector divergen (ya pasó con CD-5) |
| F2 | Lector de celdas | `services/omr` | no | — |
| F3 | Impresor + resolver + BDD | `packages/db`, `apps/api` | no | — |
| F4 | Integración E2E y regresión | todo | **sí** | Shippear sin ejercer el camino completo |
| F5 | Adopción y limpieza | docs, layouts | no | Deuda ambigua sobre el futuro del QR |

Las fases F2 y F3 pueden correr **en paralelo** una vez congelada F1 — es exactamente el patrón
de contratos-primero que este módulo ya usó para el MVP.

## F0 — Validación empírica (sin código)

La maqueta ya existe (generada el 02-sep, celdas de 3,2 mm con payload y CRC reales).

**Tareas**
1. Imprimir la maqueta al 100 % y escanearla con las mismas apps/escáneres de las pruebas
   (Genius Scan, el escáner plano, y una foto de celular).
2. Repetir con «ajustar a página» activado (celda efectiva ~2,88 mm) — el caso D7 que el
   sistema promete tolerar.
3. Medir sobre las capturas: ¿cada celda se distingue de sus vecinas con el mismo umbral
   relativo al papel que usan las marcas? Instrumental existente: `tools/read_sheet.py` para
   rasterizar + un muestreo ad hoc de los centros de celda.
4. Decidir el **tamaño final de celda**. Si 2,88 mm falla, opciones en orden: subir a 3,4 mm
   quitando 4 bits al código corto (1M hojas/org sigue sobrando), o declarar «ajustar a página»
   fuera de tolerancia para la identificación (degrada a RUT/manual, no rechaza el lote).

**Gate de salida:** las dos filas decodifican con CRC válido en las tres cadenas de captura,
al 100 % y con ajuste a página — o hay decisión escrita de qué se sacrifica.

## F1 — Contratos congelados

**Tareas**
1. `packages/types`: campo `sheetCode` en el layout-spec (geometría de las dos filas: posición,
   tamaño de celda, cantidad, trama) + `identity.source: 'cells' | 'qr' | 'rut_bubbles'` en el
   `ScanResult`. Zod primero, como manda el contrato del proyecto.
2. `services/omr/contracts/*.schema.json`: espejo exacto + un ejemplo commiteado
   (`layout-sheet-code.example.json`).
3. Especificar en el contrato la **regla de aceptación de 3 condiciones** (§5.1 del diseño) y el
   traspaso de los dos roles del QR (§5.3): orientación y validación de reconstrucción.
4. Definir el CRC-12 (polinomio, orden de bits) y la trama asimétrica **en el documento de
   contrato**, no en el código — impresor (TS) y lector (Python) lo implementan por separado y
   tienen que coincidir bit a bit.

**Gate de salida:** un test de contrato en cada lado genera/parsea el mismo vector de 59 celdas
desde el mismo payload de ejemplo. Si TS y Python no producen bits idénticos, no se avanza.

## F2 — Lector de celdas (`services/omr`)

**Tareas**
1. Lector nuevo en `readers.py`: muestrea los centros de celda sobre la página rectificada con
   umbral relativo al papel (el mismo criterio que `MAX_DARKNESS_RATIO`), decodifica trama + CRC,
   aplica la regla de las dos filas.
2. Integrar en el pipeline los dos roles heredados del QR: `_orientation_confirmed` acepta
   celdas válidas como confirmación; la reconstrucción de 4ª esquina se valida con celdas.
   El camino QR queda intacto para specs sin `sheetCode`.
3. Generador sintético: `synthetic.py` dibuja las filas; el barrido (`make_synthetic`) gana
   recetas de celdas lavadas, fila marcada por un alumno, fila cortada por el borde.
4. Tests con la disciplina de la casa: cada umbral con su distribución medida en el docstring,
   cada test de regresión verificado contra el código sin el arreglo. Casos obligatorios:
   fila invertida (orientación), las dos filas difieren (→ sin resolver), CRC corrupto,
   celda lavada al nivel real medido (0,49 de oscuridad relativa).

**Gate de salida:** barrido sintético en verde con las recetas nuevas, 0 incorrectas-confiadas;
los ~160 tests existentes intactos; sobre las 10 capturas reales archivadas, el lector de celdas
no introduce ningún cambio (specs viejos, camino QR).

## F3 — Impresor, resolver y BDD (`apps/api`, `packages/db`)

**Tareas**
1. Migración: `printed_sheets.short_code` (entero de 24 bits, único por org, con índice).
   Asignación aleatoria con reintento — el retry es parte del diseño (cumpleaños a ~4.800 hojas).
2. `sheet-print.helpers.ts`: dibujar las dos filas y el código en texto legible; el QR se achica
   y pierde protagonismo visual. Derivación del spec con `sheetCode` al congelar layout nuevo.
3. Resolver de identidad: orden celdas → QR → sin resolver. El gate G1 se evalúa sobre el
   prefijo de hash de las celdas con la misma semántica (lote entero rechazado, ambos hashes en
   el motivo).
4. Round-trip impresión↔lectura extendido: el spec E2E imprime con celdas y verifica que el
   lector las devuelve, en las 4 variantes existentes (normal, 97 %, 90 %, rotada).

**Gate de salida:** suite completa de `sheet-scanning` en verde incluido el round-trip con
celdas; una tirada vieja (spec sin `sheetCode`) sigue leyéndose por QR sin ningún cambio.

## F4 — Integración E2E con papel

**Tareas**
1. Congelar layout v2 con celdas sobre el instrumento de prueba, imprimir la tirada del curso
   `6° Básico TEST`, rendir con los casos de la guía (doble marca, borrada, blanco, reserva).
2. Escanear con las tres cadenas de captura y pasar por la UI completa hasta confirmar y ver
   dashboards. La métrica que importa: **identidades resueltas sin intervención humana**, que es
   exactamente donde el QR fallaba con marcas legibles.
3. Provocar los casos de falla: hoja v1 en lote v2 (G1 por celdas), fila rayada por el alumno,
   hoja invertida, hoja de reserva con RUT rellenado.

**Gate de salida:** en las capturas donde hoy el QR falla y las marcas leen, la identidad
resuelve por celdas. Cero identidades incorrectas confiadas — una sola invalida el diseño y
devuelve a F0/F1.

## F5 — Adopción y limpieza

**Tareas**
1. Actualizar `05-sistema.md`, `06-plan-mvp-v1.md` y la guía de testing manual.
2. Decidir con evidencia de F4 el futuro del QR (mantener como atajo / retirar en v3) y
   documentarlo en `01-decisiones.md`.
3. Sumar las recetas de celdas al conjunto de oro (O4) para que la validación de 300 hojas
   mida también este canal.

**Gate de salida:** ninguna referencia en docs al QR como canal crítico; decisión del QR
registrada con su porqué.

## Qué NO entra en este plan

- Cambiar `no_separable_marks`, el gate de nitidez, ni nada del clasificador de marcas.
- El modo `rut_bubbles`: ya existe; este plan solo lo referencia como canal del alumno.
- El conjunto de oro completo (O4): F4 usa hojas de prueba, no las 300.

## Estimación honesta

F0 es una tarde con papel. F1 es un día de precisión (el gate bit-a-bit no perdona). F2 y F3 en
paralelo son el grueso. F4 depende de acceso a impresora/escáner. Lo único que no se puede
comprimir es F0: **ninguna fase posterior tiene sentido si 3,2 mm no sobrevive a la cadena real**,
y averiguarlo cuesta una hoja impresa.
