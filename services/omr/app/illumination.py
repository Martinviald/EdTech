"""Aplana el gradiente de iluminacion de una captura, para REINTENTAR una pagina.

No es un paso del camino feliz: corre SOLO cuando la pagina ya se rechazo por
`no_separable_marks` y el CaptureProfile trae `normalizeIllumination`. Una hoja
que hoy se lee bien no pasa por aca y no cambia de ruta en absoluto — esa es la
razon de que el aplanado sea un reintento y no un preproceso.

El sintoma que lo motiva: una foto de telefono con luz despareja se rechazaba
aunque fuera NITIDA (la peor observada tenia nitidez 0.93, la mejor del lote).
La misma hoja fisica, fotografiada dos veces, daba:

                                 leida     rechazada
    burbujas vacias (fill medio)  0.328     0.168
    burbujas marcadas             0.996     0.493
    desviacion de las marcadas    0.011     0.145
    brecha                        0.668     0.325
    2*dispersion exigida          0.189     0.395

y el gate `no_separable_marks` hacia lo correcto rechazandola: forzado a pasar,
solo 6 de 19 respuestas salian bien (8 marcas perdidas, 5 alternativas
inventadas). El arreglo NO es bajar el umbral.

La causa medida NO esta en el clasificador de marcas sino ANTES, en la
deteccion de fiduciales. El rectificador busca cuadrados oscuros por cuadrante;
sobre la esquina en sombra `adaptiveThreshold` pierde el fiducial verdadero y
`_best_square` corona una mancha. En la hoja de arriba el fiducial inferior
derecho se detectaba en (1587, 2162) cuando el verdadero esta en (1471, 1916):
250 px de corrimiento. La homografia sale deformada, cada burbuja se muestrea
fuera de su circulo y los fills no forman dos grupos — de ahi el rechazo.
Verificado aislando las dos hipotesis (misma homografia con pixeles aplanados:
brecha 0.325, sin cambio; homografia detectada sobre la imagen aplanada con
pixeles originales: brecha 0.702, separable). Por eso el reintento re-rectifica
desde cero sobre la imagen aplanada: aplanar DESPUES de rectificar no sirve de
nada, porque `bubble_fill` ya mide contra el fondo local de cada burbuja.

Que la homografia del reintento sea la correcta no se asume: el reintento
vuelve a pasar por la misma escalera de confirmacion (QR de la region, QR de
esquina, firma de la grilla) que cualquier otra rectificacion, y el resultado
solo se conserva si la pagina termina legible. Si no, se devuelve el rechazo
original tal cual.

    flat = clip(gris / desenfoque_gaussiano(gris, sigma) * escala, 0, 255)

Dividir por el propio desenfoque estima el fondo y lo divide fuera: lo que
queda es la tinta relativa a SU papel, con el gradiente ya quitado.

Calibracion de SIGMA (sobre las 10 fotos reales del lote, escala 200), medida
por lo unico que importa — si la hoja rechazada se rescata y con que lectura:

    sigma  brecha  2*disp  separable  lectura
       15   0.717   0.204     si      18/19 (una marca cae a ambigua)
       25   0.702   0.180     si      19/19
       41   0.703   0.177     si      19/19
       61   0.701   0.178     si      19/19
       81   0.310   0.314     no      no rescata

41 queda al centro de la meseta [25, 61], con 1,6x de margen a cada lado. Los
extremos no son inocuos: con sigma 81 otra hoja del lote (Escobar 7) pasaba a
`separable` con un umbral de 0.197 y una mezcla de blank/ambiguous/multiple —
justo el modo de falla que el gate existe para evitar. Sigma chico borra el
fondo pero tambien se come el trazo; sigma grande deja de estimar el fondo y
empieza a estimar la hoja entera.

Calibracion de ESCALA: entre 150 y 255 la hoja se rescata igual (brecha 0.702
a 0.722, misma lectura 19/19). 200 esta al centro y es el unico valor del
barrido que no le hizo perder un fiducial a ninguna otra hoja (con 180 y 220,
Escobar 7 bajaba de 4 a 3 fiduciales detectados). Es el blanco de papel al que
se lleva el fondo: por debajo de 255 deja aire para que un papel mas claro que
el promedio no sature.
"""

from __future__ import annotations

import cv2
import numpy as np

BACKGROUND_SIGMA_PX = 41.0
PAPER_LEVEL = 200.0


def flatten_illumination(bgr: np.ndarray) -> np.ndarray:
    """Devuelve la captura con el fondo aplanado, en el mismo formato BGR.

    Se devuelve BGR y no gris porque el reintento vuelve a entrar por
    `_rectify_oriented`, que espera una captura como la que llego.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.cvtColor(flatten_gray(gray), cv2.COLOR_GRAY2BGR)


def flatten_gray(gray: np.ndarray) -> np.ndarray:
    background = cv2.GaussianBlur(gray, (0, 0), BACKGROUND_SIGMA_PX)
    flat = gray.astype(np.float32) / np.maximum(background, 1) * PAPER_LEVEL
    return np.clip(flat, 0, 255).astype(np.uint8)
