# 09 · Robustez de encuadre: el tope de distancia de los fiduciales

> Pendiente identificado el 2026-09-03 probando el lector con fotos de teléfono reales.
> **Actualizado tras mergear #185, #186 y #187**: el rescate por radio ampliado (#187) resolvió
> la mitad del problema. Lo que queda, y la evidencia nueva, está en
> [Qué queda después de #187](#que-queda).

---

<a id="el-problema"></a>

## El problema

El detector de fiduciales (`services/omr/app/rectify.py`) acepta un cuadrado como fiducial
solo si está **a menos de `MAX_CORNER_DISTANCE_FRACTION` (0.22) del lado corto de la imagen**,
medido desde la esquina de la imagen.

Ese invariante asume que la hoja llena el encuadre. No es una propiedad de la hoja: es una
propiedad de **cómo la fotografiaron**. Cuando alguien dispara desde un poco más lejos, o con
la hoja apaisada dentro de un encuadre vertical, las esquinas del papel se alejan de las
esquinas de la imagen y el tope descarta fiduciales perfectamente visibles.

---

## La evidencia

Siete fotos de una misma hoja en blanco, tomadas con distintos ángulos e iluminación (el tipo
de foto que saca alguien sin pensar en el encuadre):

| Tope de distancia | Fotos con 4/4 fiduciales |
| ----------------- | ------------------------ |
| **0.22 (actual)** | **2 de 7**               |
| 0.30              | 6 de 7                   |
| 0.40              | **7 de 7**               |

Las distancias reales de los fiduciales a su esquina van de **97 a 538 px**, contra un tope de
363 px. El QR se decodifica bien en las siete (confianza 1.0): la hoja se ve perfectamente, lo
que falla es el filtro.

**No son falsos positivos.** En `blanco_1607` las cuatro posiciones detectadas son idénticas
con tope 0.22 y con 0.50 (delta 0 px en las cuatro). El tope no está eligiendo objetos
distintos: descarta los verdaderos.

### El área no explica la falla

|                         | Área de la hoja sobre el encuadre |
| ----------------------- | --------------------------------- |
| Fotos que hoy funcionan | 57,4% – 62,2%                     |
| Fotos que hoy fallan    | 50,5% – 60,1%                     |

Los rangos **se solapan**. Una hoja al 57% funciona si está derecha y falla si está inclinada,
así que una regla de producto del tipo "acércate más" no separa los casos. La falla es la
combinación de distancia y rotación, no la distancia sola.

---

## Por qué existe el tope

Lo agregó una corrección de un falso positivo: sin él, una mancha con forma de cuadrado lejos
de la esquina podía ganarle al fiducial verdadero y deformar la homografía. El tope era, en
ese momento, **la única defensa** contra un cuadrado falso.

Ya no lo es. La firma de grilla (`_grid_signature_confirmed`, `services/omr/app/pipeline.py`)
valida la homografía **completa** — comprueba que las burbujas del spec caigan sobre sus
anillos impresos — y es una defensa mucho más fuerte que una heurística de posición.

La diferencia se midió sobre una foto inclinada real:

| Homografía                                    | QR decodifica | Firma de grilla |
| --------------------------------------------- | ------------- | --------------- |
| Reconstruida por paralelogramo (3 fiduciales) | sí            | **no**          |
| 4 fiduciales reales (tope ampliado)           | sí            | **sí**          |

El QR tolera una homografía torcida; la grilla no. Por eso una página podía identificarse con
confianza 1.0 y aun así morir en `no_separable_marks`: las burbujas no calzaban.

---

## Resolución propuesta

**Reemplazar el tope de distancia por un invariante de consistencia entre los cuatro
fiduciales**: que formen un cuadrilátero convexo con la razón de aspecto del layout. Eso sí es
una propiedad de la hoja y no depende del encuadre.

Con cada aceptación validada por la firma de grilla, el tope por esquina puede aflojarse mucho
o desaparecer. El orden importa: **primero la validación, después el aflojamiento.** Subir la
constante sin validar reabre exactamente el falso positivo que la introdujo.

### Riesgo residual

Un cuadrado falso que produzca una homografía que _igual_ pase la firma de grilla. Es
improbable —tendría que caer casi donde está el fiducial verdadero— pero no imposible, y el
conjunto de oro es el lugar para medirlo: sus recetas de hojas sucias son las que más se
acercan a ese escenario.

---

## Lo que NO se debe hacer

**Subir `MAX_CORNER_DISTANCE_FRACTION` a secas.** Rescata estas fotos y reabre el falso
positivo, sin ninguna validación de por medio.

**Agrandar los fiduciales impresos.** Rompe la compatibilidad con las hojas ya impresas, que
para un colegio es un costo real: hojas ya repartidas dejarían de leerse.

---

## Consecuencia para la captura móvil

Estas siete fotos también corrigen una evaluación previa. Al comparar con aplicaciones tipo
Genius Scan se concluyó que la guía en vivo era prescindible, porque los fiduciales ya
resuelven la rectificación mejor que la detección de bordes. **Eso sigue siendo cierto para
rectificar, y de todos modos se quedó corto:** 5 de 7 fotos tomadas sin pensar en el encuadre
fallaron.

La versión barata no cambia — detectar los cuatro cuadrados en el preview y avisar _"no veo el
marcador inferior derecho"_, sin OpenCV.js ni segmentación de documento — pero sube de
prioridad: pasa de "reevaluar si el uso lo pide" a **el uso ya lo pidió**.

Conviene hacerla **después** de este arreglo: guiar al usuario hacia un encuadre que el lector
todavía no aprovecha es pedirle que compense una limitación nuestra.

---

## Datos de prueba

Las fotos que produjeron este hallazgo **no están versionadas** (son capturas reales de
prueba). Para reproducir la medición hace falta un juego equivalente: una hoja impresa
fotografiada desde varias distancias y ángulos, con los cuatro fiduciales visibles a simple
vista en todas.

El conjunto de oro sintético **no cubre este caso**: sus hojas siempre llenan el encuadre. Si
este arreglo se implementa, vale agregarle recetas con la hoja pequeña y rotada dentro del
marco — hoy ese modo de falla no lo detecta ninguna prueba automática.

---

<a id="que-queda"></a>

## Qué queda después de #187

`WIDE_CORNER_DISTANCE_FRACTION = 0.35` (PR #187) reintenta las esquinas faltantes con radio
ampliado y acepta solo lo que la firma de grilla valida. Medido sobre las mismas 19 fotos, ya
en `dev` con #185 y #187 juntas:

| Conjunto                      | Antes             | Después                                |
| ----------------------------- | ----------------- | -------------------------------------- |
| 12 fotos de hojas respondidas | 7 leídas          | **8 leídas** (entra la foto inclinada) |
| 7 fotos de hoja en blanco     | 2 se rectificaban | **3 se rectifican**                    |

Las dos PRs componen bien: las hojas en blanco que se rectifican salen con
`marksReadability: likely_blank` y una hoja con tinta ilegible sale `unreadable`.

**Quedan 4 de las 7 fotos en blanco sin rectificar.** No es el tope de distancia: en las cuatro
el radio ampliado SÍ encuentra cuatro cuadrados, y la firma de grilla los rechaza.

### Por qué las rechaza

El rescate **conserva las detecciones estrictas y solo re-busca las faltantes**. Si una
detección estricta es incorrecta, el rescate no puede corregirla: la arrastra a la homografía,
la firma la rechaza —correctamente— y la página vuelve a fallar.

Geometría del cuadrilátero que arma el radio ampliado en las cuatro:

| foto        | dif. lado superior vs inferior | dif. lado izquierdo vs derecho |
| ----------- | ------------------------------ | ------------------------------ |
| blanco_1604 | **21%**                        | 6%                             |
| blanco_1605 | **17%**                        | 10%                            |
| blanco_1608 | 9%                             | 2%                             |
| blanco_1610 | 2%                             | **26%**                        |

Tres tienen una asimetría demasiado grande para la perspectiva de la foto: una esquina está en
el lugar equivocado. `blanco_1608` es la excepción —geometría consistente, firma 0.895 contra
un corte de 0.90— y es un caso aparte, de calibración del corte, que no se tocó a propósito.

### Modo de falla nuevo: otras hojas en el encuadre

En `blanco_1604` hay **otras hojas de respuesta visibles al borde del encuadre, con sus propios
fiduciales negros**. La detección estricta ubica una esquina en x=86, a la izquierda del borde
de la hoja principal.

Es coherente con la asimetría del 21% y con que la firma rechace la homografía, pero **falta
confirmarlo midiendo** si esa esquina cae dentro o fuera del papel objetivo. Si se confirma, es
un modo de falla propio: en una sala de clases las hojas se apilan, y fotografiar una con otras
al lado es lo normal, no lo excepcional.

Refuerza la resolución propuesta: un invariante de consistencia entre los cuatro descarta un
cuadrado que pertenece a OTRA hoja, porque no encaja en el cuadrilátero. El tope por distancia
no puede distinguirlos.

### El motivo de rechazo miente

Las cuatro se rechazan con `cropped`. La hoja está entera en las cuatro fotos.

El paso estricto reporta **2 esquinas "que parecen recortadas"** en cada una:
`_corner_looks_clipped` encuentra tinta oscura tocando el borde de la imagen —el canto de la
mesa, otra hoja, una sombra— y concluye que la captura cortó la hoja.

Al usuario le dice exactamente lo contrario de lo que necesita: `cropped` invita a encuadrar
**más cerca**, cuando el problema es que la hoja ya está demasiado lejos y pequeña. Corregir el
motivo es barato y va junto con este arreglo.

### Composición pendiente

`leave_one_out_rectifications` ya existe para el falso fiducial: prueba las cuatro
rectificaciones que descartan una esquina y la reconstruyen de las otras. Es justo lo que haría
falta aquí — pero **hoy no se compone con el rescate por radio ampliado**. Las dos políticas
corren por caminos separados y ninguna cubre el caso "una detección estricta es falsa Y falta
otra esquina".
