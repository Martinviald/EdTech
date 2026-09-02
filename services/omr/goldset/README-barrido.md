# Barrido sintético — detección de regresiones sin gastar papel

> **Esto NO reemplaza al conjunto de oro.** La validación del MVP sigue siendo el conjunto de
> **300 hojas físicas** transcritas por dos personas (O4, ver `README.md`). Un `APRUEBA` acá
> significa **"no hay regresiones conocidas"**, nunca "el MVP está validado".

Probar un cambio del lector costaba un ciclo de papel completo: imprimir, rendir a mano, escanear,
subir por la UI, crear el lote, esperar. Este barrido genera hojas con marcas conocidas bajo muchas
combinaciones de degradación, las corre contra el motor y emite el mismo veredicto que el harness
de papel — en ~20 segundos, sin salir del repo.

## Cómo se corre

```bash
cd services/omr

# generar + medir + veredicto, todo de una
.venv/bin/python -m goldset.make_synthetic --run

# sólo generar (después se mide con el runner de siempre)
.venv/bin/python -m goldset.make_synthetic --sheets 96 --seed 7
.venv/bin/python -m goldset.run goldset/data
```

| Flag | Default | Qué hace |
|---|---|---|
| `--sheets` | 48 | Cuántas hojas generar. Con menos de 48 quedan recetas sin ejercitar y el comando avisa. |
| `--seed` | 20260901 | Semilla. **Determinista hasta el byte**: misma semilla → mismos PNG. |
| `--data-dir` | `goldset/data` | Dónde escribir (gitignoreado; el dataset se regenera, no se comitea). |
| `--run` | — | Tras generar, corre `goldset.run` e imprime el veredicto. Código de salida 0 = APRUEBA. |

Códigos de salida de `--run`: `0` APRUEBA, `1` NO APRUEBA, `2` error del harness.

**Costo medido** (48 hojas, MacBook 8 GB): ~3,6 s generar + ~12 s medir ≈ **16 s total**, un solo
proceso. 96 hojas ≈ 32 s. Es un proceso pesado: no lo corras en paralelo con un build.

## Qué genera

48 hojas por defecto, repartidas entre los 4 cortes **con la misma proporción que O4**
(100/100/50/50 → scanner-adf 16, phone-good 16, phone-bad 8, dirty 8). Esto importa: si se repartiera
por receta, los cortes con más recetas quedarían sobre-representados y las tres cifras del veredicto
dejarían de ser comparables con el criterio que se va a medir en papel.

**22 recetas de degradación**, rotando dentro de cada corte:

| Corte | Recetas |
|---|---|
| `scanner-adf` | plano · papel-realzado · papel-gris · fotocopia · **esquina-lavada** · **alta-resolución** |
| `phone-good` | rotación-leve · perspectiva-leve · con-fondo · alta-resolución-foto · sombra-diagonal |
| `phone-bad` | perspectiva-fuerte · arruga · sombra-lateral · desenfoque · reflejo · **reflow-a4** · **qr-movido** |
| `dirty` | marcas-sucias · marcas-sucias-con-sombra · **fiducial-cortado** · **fiducial-ausente** |

En negrita, los seis modos de falla **reales** que el generador no simulaba y que se agregaron acá
(`tests/synthetic.py`: `clip_corner`, `motion_blur_region`, `reflow`, y los parámetros
`fiducial_roughness` / `fiducial_inks` / `drop_fiducials` de `render_page`).

El corte `dirty` sortea además los estilos de mano humana que el clasificador tiene que mandar a
revisión en vez de adivinar: cruz, tilde, relleno a medias, borrón y doble marca.

## La verdad de terreno sale gratis — y es exacta

En papel, `truth.json` es una transcripción a mano de dos personas, y la doble verificación existe
porque las personas se equivocan. Acá las marcas **las decide el generador**, así que la verdad no
se transcribe: se conoce. `truth.json` escribe dos copias idénticas del mismo diccionario y deja en
`notes` que la hoja es sintética.

Esa es la ventaja central sobre el papel, y la única.

## La parte crítica: calibrado contra capturas reales

Un generador que dibuja cuadrados perfectos ya nos costó caro. El umbral de solidez de los
fiduciales estuvo en 0.88 **porque en sintético salían perfectos (1.00)**; en papel la población
entera vive entre 0.85 y 0.92 y ese umbral rechazaba capturas limpias. Lo mismo con el filtro
anti-QR: nunca falló hasta que llegó una foto de 2339 px.

Por eso las degradaciones reproducen distribuciones **medidas**, no inventadas.
`goldset/fiducial_metrics.py` mide sobre cualquier imagen las mismas cuatro cifras que decide
`app/rectify.py`, para poder comparar sintético contra papel:

```bash
.venv/bin/python -m goldset.fiducial_metrics goldset/data --compare /tmp/q0.png /tmp/L0.png
```

Solape medido — 190 esquinas sintéticas (48 hojas, semilla por defecto) contra 39 esquinas reales
de 10 capturas de dos escáneres y una cámara:

| Métrica | sintético (min/p50/max) | real (min/p50/max) | solapan |
|---|---|---|---|
| solidez | 0.838 / 0.908 / 0.966 | 0.785 / 0.902 / 0.957 | sí |
| compacidad | 16.47 / 18.17 / 20.36 | 16.65 / 17.30 / 18.40 | sí |
| oscuridad relativa | 0.062 / 0.185 / 0.622 | 0.032 / 0.292 / 0.588 | sí |
| distancia a la esquina | 0.041 / 0.042 / 0.162 | 0.033 / 0.059 / 0.181 | sí |
| ancho en px | 1655 / 1655 / 2573 | 1653 / 1655 / 2339 | sí |

Las cinco solapan. Las medianas de solidez coinciden casi exactamente (**0.908 sintético vs 0.902
real**), que es lo que hace utilizable al barrido para calibrar el gate de forma — comparado con el
1.00 plano que daba el generador antes de esta PR. La cola de compacidad sintética llega más arriba
que la real (20.4 vs 18.4): el barrido es algo **más duro** que el papel en ese eje, que es el lado
seguro del error.

`test_make_synthetic.py` deja esto clavado: si la mediana de solidez se sale de 0.85–0.93 el test
falla. Es el guardarraíl contra que alguien vuelva a dibujar el cuadrado ideal.

## Veredicto de hoy sobre `dev`

Con la semilla por defecto y 48 hojas:

```
Veredicto: NO APRUEBA
  Marcas leídas correctamente      97.57%   (meta ≥ 99%)      NO
  Marcas enviadas a revisión        2.26%   (≤ 3%)            SÍ
  Incorrectas con confianza alta        1   (= 0, dominante)  NO
  Páginas sin leer                      0
```

`scanner-adf` y `phone-good` salen 100% limpios. Todo el costo está en `phone-bad` (93.75%, todo a
revisión) y `dirty` (91.67%).

La única incorrecta-confiada es una **marca a medio borrar** (cobertura ~0,45) que el clasificador
declara `blank` con margen 0,54 — hay grafito visible en la burbuja y el lector dice "vacía" sin
dudar. Es exactamente la clase de error que el criterio dominante existe para atrapar. **No se
arregló en esta PR** (no se tocó `app/`): queda reportado para que el equipo decida si se corrige
bajando el umbral de tinta o subiendo `AMBIGUITY_MARGIN` — el reporte trae la distribución de
márgenes justo para eso.

## Lo que este barrido NO puede decirte

Una simulación sólo cubre los modos de falla **que ya se nos ocurrieron**. Todos los bugs reales de
esta semana salieron de capturas reales, no de sintéticos:

- el umbral de solidez que partía la población al medio,
- el filtro anti-QR que se cayó con una foto de 2339 px,
- el límite absoluto de oscuridad que rechazaba esquinas lavadas,
- el tope de distancia a la esquina, que sin él coronaba un borrón a 800 px.

Ninguno lo habría encontrado este barrido antes de que apareciera la captura que lo destapó. Lo que
sí hace, una vez conocidos, es dejarlos clavados como regresión. Úsalo para iterar rápido; valida
con papel.
