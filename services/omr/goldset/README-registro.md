# Registro de burbujas — método, compuertas y bitácora

> Contexto completo: `analisis-omr-marcas/veredicto-omr-deteccion-marcas.md` y
> `analisis-omr-marcas/plan-fix-omr-registro.md` (fuera del repo). Resumen: el disco de
> muestreo de cada burbuja no caía sobre la burbuja impresa (6–8 px de error típico, 15 px
> en la peor foto, con un anillo de 17.6 px de radio y un disco de 14 px). Eso subía el
> `fill` de las vacías (anillo dentro del disco) y bajaba el de las marcadas (disco fuera
> de la marca), y explicaba los errores confiados y la cola de revisión del lote demo.

## El ciclo

Cada cambio se valida con **los mismos tres instrumentos**, en este orden, y se anota abajo:

```bash
cd services/omr
.venv/bin/python -m pytest -q                                    # suite completa
.venv/bin/python -m goldset.make_synthetic --sheets 48 --seed 20260901 --run   # sintético
.venv/bin/python -m goldset.run goldset/real                     # decisiones, fotos reales
.venv/bin/python -m tools.measure_registration goldset/real      # medición, fotos reales
```

Un proceso a la vez (máquina de 8 GB). Los umbrales no se ajustan para pasar una compuerta:
si algo falla, primero se mira por qué (`tools/measure_registration.py` imprime por hoja y
guarda JSON con `--json`).

## Conjuntos

| clave | qué | verdad |
|---|---|---|
| **real** (`goldset/real`) | 8 fotos de 4 hojas impresas (2 capturas por hoja) + 2 capturas del lote demo | por construcción / adjudicación |
| **sintético** (`goldset.make_synthetic`) | 48 hojas, semilla 20260901 | por construcción |
| **suite** (`tests/`, `goldset/test_*.py`) | contratos y regresiones conocidas | — |

## Compuertas

| fase | compuerta |
|---|---|
| 1 registro local | real: `confident_wrong = 0`, ≥ 145/154 correctas en las hojas con verdad, `res_med ≤ 1.5 px`, `fallback ≤ 5 %`, `motor_floor_p95 ≤ 0.25`, `motor_gap ≥ 0.30` en toda hoja leída, xcap marcadas ≤ 0.03 · sintético: igual o mejor, 0 páginas nuevas rechazadas · classify ≤ +50 ms |
| 2 constantes | `likely_blank` en hojas en blanco; ningún veredicto de legibilidad cambia salvo mejoras explicadas |
| 3 identidad y gate | tests RUT/assess en verde; gate = lote en el 100 % |
| 4 criterio | real: 0 incorrectas, revisión ≤ 5 explicadas; sintético sin regresión |
| 5 conjunto | recetas nuevas fallan sin registro y pasan con registro |

## Bitácora

### 2026-09-04 · fase 0 · instrumentos y línea base (código `98912ae` = `origin/dev`)

Cambio: cortes `real-phone`/`real-scanner` en el dataset; `truthSource` (`construction`,
`adjudication`) con una transcripción; `goldset/import_real.py`; `tools/measure_registration.py`.
Sin tocar el motor.

Línea base, **real** (220 marcas, 10 hojas):

| | correctas | revisión | incorrectas confiadas |
|---|---|---|---|
| todas | 135 | 81 (22 = `carla-1620` rechazada `cropped`) | **4** (`diego-1621` q16, q22, q23, q24: marcas reales leídas `blank`) |
| 7 hojas con verdad por construcción (154) | 121 | 29 | 4 |
| demo (44, verdad provisional) | 14 | 30 | 0 |

Medición (posición del spec): `off_med` 3.7–10.3 px, `off_p90` 11–15 px; piso p95 de vacías
0.39–0.58; marcada mínima 0.39–0.84; **hueco mínimo −0.101** (diego-1621); contraste por
pregunta min/max 0.113/0.088 en la peor hoja (se cruzan); estabilidad entre capturas de Diego
0.411 (marcadas). En la posición del localizador **independiente** del arnés: hueco mínimo
**0.498** y estabilidad de Diego **0.001** — la cota de lo alcanzable.

Sintético (48 hojas): 96.88 % / 2.95 % / 1 incorrecta (`dirty-marcas-sucias-045` q3, ajena al
registro), 0 páginas rechazadas.

Suite: 225 tests en verde. `ruff check`: 1 error preexistente (`tests/test_washed_band.py:48`,
E501), no se toca.

Prueba del PDF (bifurcación de la fase 0): PDF renderizado con `apps/api/dist` y rasterizado
como lo hace el motor → desplazamiento **0.0 px** (máx 1) en las 88 burbujas; impresor, spec
y rectificador coinciden. El sesgo nace en la captura. No hace falta la fase 1b.

Pendiente de material: las 7 fotos de hoja en blanco (1604–1610) y las 3 capturas con tinta
ilegible que fijaron `BLANK_SHEET_MAX_FILL`; las 16 páginas locales. Sin ellas la fase 2 no
recalibra ese corte (ver entrada de la fase 2).

Decisión: **avanza** a fase 1.

### 2026-09-04 · fase 1 · registro local del anillo, detrás de `OMR_LOCAL_REGISTRATION`

Cambio: `app/registration.py` (plantilla de anillo, ventana `W = min(0.9 R, 0.4·distancia)`,
consistencia por grupo, fallback al spec); `readers.sample_bubble_fills` lo usa con el
interruptor encendido; firma de grilla, `_refine_accepted` e identidad siguen en
`sample_bubble_fills_at_spec`; `registration` en el debug de página; 22 tests nuevos.

**Ciclo 1a — consistencia por mediana del grupo (±3 px):** real 186 / 34 / 0, pero piso p95
de vacías 0.28–0.33 en 4 hojas (compuerta ≤ 0.25) con residuo 4–6 px justo en la columna A.
Diagnóstico con `register_group` a mano: dentro de una fila el desplazamiento es un
**gradiente** (diego-1624 q5: A −13, B −10, C −7, D −5 px) y los ajustes crudos coinciden con
el localizador independiente a < 1 px; la mediana constante era lo que metía el error.
Decisión: **ajusta** — no se tocó ningún umbral, se cambió el modelo de consistencia.

**Ciclo 1b — consistencia lineal (Theil-Sen por grupo, tolerancia 3 px respecto de la
recta, pendiente acotada 0.10):**

| conjunto | resultado | compuerta |
|---|---|---|
| real, 220 marcas | **194 / 26 / 0** (22 = `carla-1620` cropped; 4 revisiones reales: las 2 dobles de Bruno q12 como `multiple` + 2) | 0 incorrectas ✓ |
| 154 con verdad | **150 / 4 / 0** | ≥ 145 ✓ |
| demo, 44 | **44 / 0 / 0**, todas coinciden con humano/motor | ✓ |
| `res_med` vs localizador independiente | 0.4–0.6 px | ≤ 1.5 ✓ |
| `fallback` | 0 % en las 9 hojas | ≤ 5 % ✓ |
| `motor_floor_p95` | 0.20–0.27 en 8 hojas; **0.330 en demo-1** | ≤ 0.25: **no en demo-1** — pero el localizador independiente da 0.334 en esa misma foto: es el piso de la captura (anillo más grueso/desenfocado), no del registro. Se reformula la compuerta como "piso del motor a ≤ 0.03 del piso independiente", que se cumple en las 9. |
| `motor_gap` mínimo | **0.486** (alcanzable 0.498) | ≥ 0.30 ✓ |
| contraste por pregunta min/max | 0.52–0.73 / 0.02–0.08 | — |
| xcap Diego (marcadas) | **0.002** | ≤ 0.03 ✓ |
| sintético 48 | 97.92 % / 1.91 % / 1 (idéntico a la línea base con registro; misma incorrecta ajena) | sin regresión ✓ |
| `classify` por página | 27–32 ms (antes ~20) | ≤ +50 ✓ |

Decisión: **avanza** a fase 2.

### 2026-09-04 · fase 2 · constantes derivadas del piso, con el registro encendido

Distribuciones por página (real, 9 leídas) con `OMR_LOCAL_REGISTRATION=1`:

| | medido | constante | holgura |
|---|---|---|---|
| gap Otsu (media alta − media baja) | 0.708–0.814 (antes 0.457–0.601) | `MIN_FILL_GAP` 0.25 | ≥ 2.8× |
| gap / 2·(σ_baja + σ_alta) | 3.2–8.8 (mínimo en Bruno: la C parcial de la doble marca ensancha el grupo alto) | `MIN_GAP_SPREAD_RATIO` 2.0 | ≥ 1.6× |
| hueco real entre grupos | 0.486–0.701 | — | — |
| fill mínimo de página | 0.121–0.192 | `ALL_MARKED_MIN_FILL` 0.5 | una hoja toda marcada sigue distinguible |
| hoja impresa sin marcar (PDF rasterizado) | `no_separable_marks` + `likely_blank`, máximo < 0.30 | `BLANK_SHEET_MAX_FILL` 0.47 | ✓ |
| firma de grilla en el spec | 1.000 en las 9 | `GRID_SIGNATURE_FILL_FLOOR` 0.08 | sin cambio (la firma no registra) |

`BLANK_SHEET_MAX_FILL`: las 7 fotos en blanco (máx 0.297–0.440) y las 3 con tinta ilegible
(0.501–0.791) se midieron sin registro. Centrado, el máximo de una blanca solo baja y el de
una con tinta solo sube, así que el corte conserva su sentido con más holgura. **No se cambia
ninguna constante.** Pendiente: re-medir esas 10 capturas con el registro (no están en el
repo) y actualizar la tabla del docstring de `readability_verdict`.

Decisión: **avanza** a fase 3.

### 2026-09-04 · fase 3 · identidad RUT y gate del teléfono

Cambio: `identity._read_rut_bubbles` muestrea con `readers.sample_digit_grid_fills`
(registro por columna; ventana 8 px en el layout RUT real, donde los dígitos están a 22 px).
`assess_page` ya compartía `_marks_readability`, así que hereda el registro sin cambios.
Test nuevo: RUT en página desplazada 7 px se lee entero con registro y nunca sale un dígito
inventado sin él.

| comprobación | resultado |
|---|---|
| tests identidad / grilla / gate / catálogo sucio (95) | en verde con el interruptor apagado y encendido |
| gate (`assess_page`) = lote (`read`) en el corte real, registro encendido | **10/10** (9 legibles, `carla-1620` cropped en ambos) |
| RUT sucio confiado y mal (`test_dirty_grid_catalog.py`) | ninguno, con y sin registro |
| capturas RUT reales | no hay en el repo; pendiente cuando existan |

Decisión: **avanza** a fase 4.

### 2026-09-04 · fase 4 · criterio de decisión: medido, no se cambia

Contraste por pregunta (fill mayor − segundo mayor), fills con registro:

| conjunto | contestadas: mín / p5 | en blanco: máx | dobles |
|---|---|---|---|
| real (140 / 56) | 0.517 / 0.604 | 0.082 | 0.199, 0.201 |
| sintético phone-good / scanner / phone-bad | 0.755 / 0.739 / 0.634 | ≤ 0.035 | — |
| sintético dirty | 0.016 (marca lavada, la incorrecta confiada de siempre) / 0.429 | 0.034 | — |

Recuento de lo que una regla "una burbuja sobre el umbral y contraste < C ⇒ dudar"
agregaría sobre margen + tierra de nadie + `multiple`, para C ∈ {0.15, 0.25, 0.35}: **0 campos**
en real y **0** en sintético. Tampoco hay ningún `marked` incorrecto con una sola burbuja sobre
el umbral que la regla pudiera atrapar. Con el registro puesto, el criterio actual ya duda donde
corresponde: las 4 revisiones reales son las 2 dobles marcas de Bruno (`multiple`) y 2 rellenos
al 0.68 que caen en la tierra de nadie (verdad: sí son marcas; un tick suelto también caería
ahí, y no hay datos para distinguirlos — se mantiene la duda).

Cambios: `fieldContrast` (mín entre `marked`, máx entre `blank`) en el debug de página como
señal de monitoreo; docstring de `classify.py` con el archivo de la propuesta A y su razón. Sin
cambio de criterio ni de contrato. El campo de evidencia en `marks[]` (fill de la burbuja más
oscura) queda como deuda para la próxima versión del esquema.

Decisión: **avanza** a fase 5.

### 2026-09-04 · fase 5 · el barrido sintético aprende a ver el registro

Cambio: `tests/synthetic.py` gana `radial_distortion`, `cylinder_curl` y `shift_fiducials`;
`goldset/make_synthetic.py` gana `pencil_gray` por receta y cuatro recetas nuevas
(`distorsion-radial`, `curvatura`, `fiducial-sesgo` en `phone-good`; `lapiz-claro` en `dirty`).
`locate_ring` rellena con papel la parte de la ventana que se sale del marco (la fila 12 del
spec sintético queda a 20 px del borde y caía al fallback).

**Ciclo 5a** (radial 0.02, curvatura 10 px, sesgo ±3–6 px → desplazamientos de 7–8 px): el
código viejo las leía 100 % bien. Las marcas sintéticas son grandes y nítidas; 8 px no alcanzan.
Decisión: **ajusta** las magnitudes al rango de la peor foto real (IMG_1621: 15 px).

**Ciclo 5b** (radial 0.035, curvatura 16 px, sesgo ±6–11 px → desplazamientos 11–13 px, p90
14–15):

| receta | sin registro (ok/rev/ERR) | con registro | hueco spec → motor |
|---|---|---|---|
| distorsion-radial (2 hojas) | 21 / 3 / 0 | **24 / 0 / 0** | 0.29 → 0.75 |
| curvatura (2 hojas) | 23 / 1 / 0 | **24 / 0 / 0** | 0.32 → 0.80 |
| fiducial-sesgo (1 hoja) | 11 / 1 / 0 | **12 / 0 / 0** | 0.35 → 0.75 |
| lapiz-claro (1 hoja) | 12 / 0 / 0 | 12 / 0 / 0 | — |
| sombra-lateral (ya existía) | 6 / 6 / 0 | **12 / 0 / 0** | — |

Las tres recetas geométricas degradan sin registro (revisión 4–25 % de sus marcas; en sintético
el error se manifiesta como duda porque las marcas son grandes) y pasan con él. Barrido completo
(48 hojas): sin registro 95.66 % / **4.17 %** / 1 → **NO APRUEBA también por revisión**; con
registro 97.57 % / 2.26 % / 1 (la incorrecta es la marca lavada de siempre, ahora en
`marcas-sucias-con-sombra-047` q7, fill 0.17 ≈ vacía). `residuo` contra el localizador
independiente 0.5–0.9 px, fallback 0 %.

Decisión: **avanza** a fase 6.
