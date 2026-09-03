# 09 · Por qué el detector de fiduciales elige el cuadrado equivocado

> **Este documento reemplaza una versión anterior cuyo diagnóstico era incorrecto.** La versión
> mergeada en #186 atribuía la falla al tope de distancia (`MAX_CORNER_DISTANCE_FRACTION`).
> Una auditoría independiente lo refutó midiendo, y fotos nuevas lo confirmaron. La causa es
> otra y el arreglo también. Lo que sigue es la versión corregida.

---

## El diagnóstico correcto

`_best_square` (`services/omr/app/rectify.py`) busca cuadrados dentro de una región de esquina
y **se queda con el más cercano a la esquina de la imagen**.

Ese criterio de selección supone que lo más cercano a la esquina es el fiducial. En una foto con
fondo —una mesa, el canto de un vidrio, **otra hoja de respuestas del montón**— eso es
sencillamente falso. El detector encuentra el fiducial verdadero, lo tiene entre sus candidatos,
y lo descarta porque hay algo oscuro más cerca del borde.

**El tope de distancia no es la causa.** En `blanco_1604`, el fiducial verdadero inferior
izquierdo está a **0.209** del lado corto, o sea **dentro** del tope de 0.22. No fue excluido
por el filtro: fue desplazado por un borrón de la mesa que estaba más cerca del borde.

Subir, bajar o reemplazar `MAX_CORNER_DISTANCE_FRACTION` no toca este problema.

### La evidencia

Renderizando las detecciones sobre la imagen, en `blanco_1604` las dos esquinas que acepta el
paso estricto caen **sobre el vidrio de la mesa, fuera del papel**. Los fiduciales verdaderos
están sin marcar, dentro de la hoja.

En `IMG_1614` —una hoja **respondida**, bien encuadrada, con los cuatro fiduciales visibles a
simple vista— el detector elige arriba a la derecha **el fiducial de otra hoja del montón**,
ignorando el verdadero que está unos centímetros a su izquierda.

Ese es el caso que más importa: no es una foto mala. Es una foto normal de una hoja apilada
sobre otras, que es como se ven las hojas en una sala de clases.

---

## Cuánto pesa

Segundo corpus, 8 fotos tomadas expresamente para esto (4 hojas respondidas, 4 en blanco):

| Hoja respondida   | Fiduciales estrictos | Resultado |
| ----------------- | -------------------- | --------- |
| IMG_1614 (Duarte) | 2/4                  | rechazada |
| IMG_1615          | 3/4                  | rechazada |
| IMG_1616 (Bravo)  | 2/4                  | rechazada |
| IMG_1617 (Bravo)  | 4/4                  | leída     |

**3 de 4 hojas respondidas fallan.** El QR se decodifica en 7 de las 8 fotos, así que la hoja se
ve perfectamente: lo único que falla es la elección de las esquinas.

El primer corpus (19 fotos) daba 11/11 hojas respondidas con 4/4 y sugería que el problema solo
tocaba fotos de hoja en blanco. **Ese corpus estaba sesgado** — eran fotos sacadas para calibrar
otra cosa, todas sobre superficies despejadas. La conclusión que salió de ahí era falsa.

---

## El arreglo

**Elegir por firma de grilla, no por cercanía.**

En vez de quedarse con el cuadrado más cercano a la esquina y validar después, enumerar los
candidatos de cada esquina y **elegir la combinación cuya homografía maximiza la firma de
grilla** — la comprobación de que las burbujas del spec caen sobre sus anillos impresos.

La firma ya existe (`_grid_signature_confirmed`, `services/omr/app/pipeline.py`). Hoy solo se
usa para **vetar**; el cambio es usarla para **elegir**.

Medido sobre las 8 fotos del segundo corpus:

| Foto     | Hoy            | Con búsqueda global      |
| -------- | -------------- | ------------------------ |
| IMG_1614 | 2/4, rechazada | **firma 1.000, legible** |
| IMG_1615 | 3/4, rechazada | **firma 1.000, legible** |
| IMG_1616 | 2/4, rechazada | **firma 1.000, legible** |
| IMG_1617 | leída          | sin cambios              |

Rescata las tres hojas respondidas que fallan. El espacio de búsqueda es de **3 a 15
combinaciones** y **0,1 a 0,3 segundos**, y solo se paga cuando el camino normal no confirma.

No hace falta un invariante nuevo, ni una constante nueva que calibrar, ni componer dos
políticas: la validación que decide ya está escrita y probada.

---

## Lo que este diagnóstico deja fuera

### El invariante de razón de aspecto no sirve

La versión anterior proponía verificar que los cuatro fiduciales formaran un cuadrilátero con la
razón de aspecto del layout (0.7569). La medición lo refuta:

| Caso                                             | Aspecto |
| ------------------------------------------------ | ------- |
| `blanco_1606` — cuadrilátero **verdadero**       | 0.7335  |
| `superseded__Escobar_8` — cuadrilátero **falso** | 0.7340  |

Cinco diezmilésimas separan un cuadrilátero correcto de uno incorrecto. **Cualquier banda que
acepte el verdadero acepta el falso.** Bajo perspectiva la razón de aspecto se deforma tanto que
deja de discriminar. La firma de grilla sí discrimina, porque mira el contenido de la página y
no su contorno.

### Dos fotos no fallan por esto

- `blanco_1608`: las cuatro esquinas son correctas y la firma da **0.895** contra un corte de
  **0.900**. El papel está curvado sobre tela: es un problema de **planaridad**, y de un umbral
  con 0.005 de margen.
- `IMG_1611`: la búsqueda global tampoco la rescata (mejor firma 0.474).

Ninguna de las dos se arregla con lo anterior, y agruparlas con el resto sobreestima el alcance
de cualquier propuesta.

---

## Hallazgo aparte: el gate de homografía tiene un hueco

`_homography_confirmed` acepta una homografía si **el QR decodifica _o_ la firma de grilla
valida**:

```python
if mode == "qr" and decode_region_qr(rectified, spec) is not None:
    return True
...
return _grid_signature_confirmed(rectified, spec, logical_page)
```

Un QR se decodifica bien aunque la homografía esté deformada — se midió en una página con
identidad de confianza 1.0 cuyas burbujas no calzaban con la grilla. **El QR confirma la
identidad, no la geometría.**

Eso deja un camino donde una homografía falsa se acepta sin comprobar la grilla. Hoy no se
conoce un caso que produzca una lectura mala —las páginas afectadas caen antes por
`no_separable_marks`— pero es el único error que el criterio de aceptación del MVP declara
inadmisible, y no depende de nada externo para manifestarse.

Es independiente del problema de selección de esquinas y tiene su propio arreglo.

---

## El motivo de rechazo miente

Las fotos que pierden fiduciales se rechazan con `cropped`, y la hoja está entera.
`_corner_looks_clipped` encuentra tinta oscura tocando el borde de la imagen —la mesa, otra
hoja, una sombra— y concluye que la captura cortó el papel.

Al usuario le dice **lo contrario** de lo que necesita. Con la búsqueda global este motivo deja
de emitirse en esas fotos sin escribir nada aparte, así que no merece trabajo propio.

---

## Consecuencia de producto

El modo de falla confirmado es **el fondo de la foto**, no el encuadre. La regla que sirve no es
_"acércate"_ sino **"pon la hoja sobre una superficie despejada, sin otras hojas al lado"**.

Es gratis: va en el texto de la pantalla de captura y ataca la causa medida. Vale hacerla
aunque el arreglo del detector aterrice, porque ninguna corrección de software recupera una foto
donde el fiducial verdadero quedó tapado.

---

## Nota sobre el corpus

Las fotos que produjeron este diagnóstico **no están versionadas**. Son dos juegos: 18 archivos
únicos del primero (hay dos duplicados exactos) y 8 del segundo.

El conjunto de oro sintético **no reproduce este modo de falla**: sus hojas siempre están sobre
un fondo limpio y siempre dan 4/4. La receta que haría falta no es "hoja pequeña y rotada" sino
**"cuadrado oscuro distractor en el fondo, más cerca de la esquina de la imagen que el
fiducial"**.
