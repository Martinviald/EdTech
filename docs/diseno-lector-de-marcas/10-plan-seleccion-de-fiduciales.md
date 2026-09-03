# 10 · Plan: elegir bien los fiduciales

> Plan de desarrollo para lo diagnosticado en
> [09-robustez-de-encuadre.md](09-robustez-de-encuadre.md).
>
> **Reemplaza un plan anterior de cuatro fases** que partía de un diagnóstico equivocado. Aquel
> proponía medir si el problema afectaba a hojas respondidas (ya está medido: sí, 3 de 4),
> componer dos políticas de rectificación y construir un invariante de razón de aspecto (la
> medición lo refutó). Nada de eso sobrevive.

---

## Resumen

|        | Qué                                       | Prioridad         | Costo  |
| ------ | ----------------------------------------- | ----------------- | ------ |
| **P1** | Cerrar el hueco del gate de homografía    | **Primero**       | Chico  |
| **P2** | Elegir los fiduciales por firma de grilla | Alta              | Medio  |
| **P3** | Receta de conjunto de oro con distractor  | Junto con P2      | Chico  |
| **P4** | Guía de producto: superficie despejada    | Cualquier momento | Mínimo |

P1 va primero porque es seguridad y es barato. P2 es el arreglo. P3 sin P2 no tiene qué probar;
P2 sin P3 queda sin red. P4 es independiente de todo lo demás.

---

## P1 · Cerrar el hueco del gate de homografía

**Por qué primero.** Es el único riesgo vivo de **lectura mala con confianza**, que el criterio
de aceptación del MVP declara inadmisible. No depende de P2 ni de nadie, y es chico.

**El problema.** `_homography_confirmed` acepta si el QR decodifica **o** la firma de grilla
valida. El QR confirma la identidad, no la geometría: decodifica igual con una homografía
deformada.

**Qué hacer.** Que la firma de grilla sea obligatoria para aceptar una homografía, con el QR
como señal de identidad y no de geometría. Revisar de paso `leave_one_out_rectifications`, que
hoy tampoco la exige.

**Criterio de aceptación.**

- Ninguna de las 26 fotos reales pierde una lectura que hoy tenga.
- Conjunto de oro sin empeorar en ninguna métrica.
- Un test que construya una homografía deliberadamente falsa cuyo QR decodifique y compruebe que
  el gate la rechaza.

**Riesgo.** Endurecer un gate puede rechazar páginas que hoy se leen bien apoyadas solo en el
QR. Hay que medirlo sobre el corpus **antes** de decidir, no después: si aparecen, el arreglo es
otro (por ejemplo exigir la firma solo cuando la rectificación no es estricta-4/4).

---

## P2 · Elegir los fiduciales por firma de grilla

**El cambio.** En vez de que `_best_square` se quede con el cuadrado más cercano a la esquina de
la imagen, enumerar los candidatos por esquina y elegir la combinación cuya homografía maximiza
la firma de grilla.

**Ya está probado en prototipo:** rescata las 3 hojas respondidas del segundo corpus que hoy
fallan, con firma 1.000, entre 3 y 15 combinaciones y 0,1–0,3 s por foto.

### Cómo acotarlo

- **Solo en el camino de reintento.** Si la rectificación estricta ya confirma, no se enumera
  nada y el costo es cero. Es la misma forma del aplanado de #183 y del rescate de #187.
- **Tope de combinaciones.** El prototipo limitó a 6 candidatos por esquina (máximo 1296
  combinaciones, observado 15). Hace falta un tope explícito y un camino de salida cuando se
  excede, no confiar en que el caso feliz se repita.
- **Descartar temprano** las combinaciones no convexas: es barato y poda mucho.

### Qué se puede borrar después

El rescate por radio ampliado de #187 queda subsumido: la búsqueda global cubre la esquina
faltante y además la falsa. **Conviene borrarlo en la misma PR** en vez de dejar dos caminos que
hacen lo mismo — el rectificador ya acumula cuatro (estricto, paralelogramo, radio ampliado,
leave-one-out) y cada uno tapa el falso positivo del anterior.

Si el equipo prefiere no borrar código recién mergeado, la alternativa es dejarlo un ciclo y
borrarlo cuando la búsqueda global tenga uso real. Pero decidirlo, no dejarlo por omisión.

**Criterio de aceptación.**

- Las 3 hojas respondidas del segundo corpus se leen.
- Ninguna de las 26 fotos pierde una lectura ni cambia una respuesta ya correcta.
- Conjunto de oro sin empeorar en ninguna métrica, con la receta de P3 fallando antes y pasando
  después.
- La verificación por mutación de #187 sigue valiendo: sustituir la firma por `True` debe hacer
  fallar un test. Si la firma pasa de vetar a **elegir**, esa prueba importa más, no menos.

**Riesgo principal.** La firma pasa a decidir qué es un fiducial. Si se equivoca, se equivoca
eligiendo, no solo vetando. Por eso P1 va antes: un gate con un hueco no debería ascender a
criterio de selección.

---

## P3 · Receta de conjunto de oro con distractor

**Por qué.** El conjunto de oro no reproduce este modo de falla — sus hojas están sobre fondo
limpio y siempre dan 4/4. Por eso #187 salió idéntico marca por marca: su código nuevo nunca se
ejecutó ahí. Hoy la única evidencia son fotos reales sin versionar.

**La receta correcta** no es "hoja pequeña y rotada" —eso no reproduce nada— sino **un cuadrado
oscuro distractor en el fondo, más cerca de la esquina de la imagen que el fiducial verdadero**.
Ese es el mecanismo medido.

**Criterio de aceptación.** Al menos una receta nueva **falla en `dev` antes de P2** y pasa
después. Una receta que pasa en ambos lados no prueba nada.

**Riesgo de sobreajuste.** Una receta calcada de estas fotos prueba que sabemos copiarlas. Lo
que hay que variar es la **posición del distractor** respecto del fiducial verdadero —más cerca,
más lejos, en distintas esquinas— no la distancia y rotación de la hoja.

---

## P4 · Guía de producto: superficie despejada

**Independiente del código y casi gratis.** El modo de falla confirmado es el fondo, no el
encuadre. El texto de la pantalla de captura debe pedir **"pon la hoja sobre una superficie
despejada, sin otras hojas al lado"**.

Vale hacerlo aunque P2 aterrice: ninguna corrección de software recupera una foto donde el
fiducial verdadero quedó tapado por la hoja de encima.

**Lo que NO hay que escribir es "acércate"** — el corpus muestra que el área de la hoja no
separa los casos que funcionan de los que fallan.

---

## Lo que se archiva, y por qué

| Idea                                           | Por qué se descarta                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Invariante de razón de aspecto                 | Medido: no separa. Un cuadrilátero verdadero (0.7335) y uno falso (0.7340) difieren en 5 diezmilésimas |
| Componer `leave_one_out` con el radio ampliado | La búsqueda global lo subsume y es más simple que componer dos políticas                               |
| Subir o ajustar `MAX_CORNER_DISTANCE_FRACTION` | No es la causa: hay fiduciales verdaderos **dentro** del tope que igual se descartan                   |
| Corregir el motivo `cropped` por separado      | P2 hace que deje de emitirse en esas fotos; hacerlo aparte es escribir código para borrarlo            |
| Sacar más fotos para confirmar la hipótesis    | Ya está confirmada por el segundo corpus                                                               |

---

## Fuera de alcance, anotado

- **Planaridad del papel.** `blanco_1608` tiene las cuatro esquinas correctas y firma 0.895
  contra un corte de 0.900, con el papel curvado sobre tela. Ni P1 ni P2 lo tocan.
- **El margen del corte de firma.** Con un caso a 0.005 del umbral, conviene medir la
  distribución de la firma sobre el corpus antes de que ese número decida más cosas de las que
  decide hoy — y con P2 pasa a decidir más.
- **`IMG_1611`.** La búsqueda global tampoco la rescata (mejor firma 0.474). Sin diagnóstico.
- **Un corpus versionado.** Las 26 fotos viven fuera del repositorio y nadie controla su
  contenido. Mientras siga así, cada medición de este tipo se rehace a mano.
