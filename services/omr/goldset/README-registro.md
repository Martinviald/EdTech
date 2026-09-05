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
