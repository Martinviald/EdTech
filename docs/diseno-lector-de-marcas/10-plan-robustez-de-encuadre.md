# 10 · Plan: qué hacer con lo que quedó del pendiente de encuadre

> Plan de desarrollo para los cuatro puntos abiertos en
> [09-robustez-de-encuadre.md](09-robustez-de-encuadre.md), medidos sobre `dev` después de
> mergear #185 y #187.
>
> **La recomendación central es hacer dos de los cuatro y aplazar los otros dos** hasta que una
> medición barata demuestre que hacen falta. El resto del documento es el argumento.

---

## El dato que reordena todo

Después de #187, sobre las 19 fotos reales de prueba:

| | Fiduciales | Resultado |
|---|---|---|
| **11 fotos de hojas respondidas** | **4/4 en TODAS** | 8 leídas, 3 rechazadas por `no_separable_marks` |
| 4 fotos de hoja en blanco | 4/4 | rechazadas, `likely_blank` (correcto) |
| **4 fotos de hoja en blanco** | **2/4** | rechazadas, `cropped` |

**Ninguna foto de una hoja respondida falla ya por fiduciales.** Las que se rechazan lo hacen
por marcas ilegibles, que es otro problema con otro dueño.

Las únicas que siguen fallando por fiduciales son cuatro fotos de una hoja **en blanco**.
Rescatarlas no recupera ni una respuesta: cambia el mensaje de `cropped` a *"parece en blanco,
¿quieres subirla igual?"*. Es una mejora de UX, no de datos.

Eso rebaja el valor medido de los dos puntos caros —componer políticas y el invariante de
consistencia— a **cuatro fotos de hoja en blanco con mejor mensaje**. Con la evidencia de hoy,
construirlos sería resolver un problema que no se ha manifestado donde importa.

### La objeción a ese razonamiento

Las cuatro fotos que fallan son de una hoja en blanco **por accidente**: son las fotos que el
usuario sacó para calibrar el discriminador. El modo de falla que las tumba —otras hojas de
respuesta visibles en el encuadre, aportando sus propios fiduciales— **no tiene nada que ver
con que la hoja esté en blanco**, y en una sala de clases las hojas se apilan.

Si esa hipótesis se confirma, el problema sí llega a hojas respondidas y los puntos caros
recuperan su valor. Por eso el plan **empieza por confirmarla**, no por construir.

---

## F0 · Confirmar la hipótesis de las hojas vecinas

**Costo:** una tarde. **Bloquea:** F3 y F4.

En `blanco_1604` hay otras hojas de respuesta al borde del encuadre con sus fiduciales negros
visibles, y la detección estricta ubica una esquina en x=86, aparentemente fuera del papel
objetivo. Está **anotado como hipótesis, no medido**.

**Qué hacer:**

1. Medir, para las 4 fotos que fallan, si cada esquina detectada cae dentro o fuera del
   cuadrilátero del papel objetivo (el papel se puede acotar por su brillo, o a mano sobre la
   imagen: son cuatro fotos).
2. Sacar 4-6 fotos nuevas de una hoja **respondida** con otras hojas al lado, imitando una mesa
   de sala de clases, y medir cuántas pierden fiduciales.

**Criterio de decisión:**

- Si las hojas vecinas **sí** roban fiduciales y eso tumba hojas respondidas → F3 y F4 tienen
  valor demostrado; seguir el plan completo.
- Si **no** → el problema queda circunscrito a fotos de hoja en blanco y F3/F4 se archivan con
  la medición que lo justifica.

Sin F0, cualquier decisión sobre F3 y F4 es una apuesta.

---

## F1 · Corregir el motivo `cropped`

**Costo:** chico. **Depende de:** nada. **Hacer ahora.**

Las cuatro fotos se rechazan con `cropped` y la hoja está entera. `_corner_looks_clipped`
encuentra tinta oscura tocando el borde de la imagen —el canto de la mesa, otra hoja, una
sombra— y concluye que la captura cortó la hoja.

Al usuario le dice **lo contrario de lo que necesita**: `cropped` invita a encuadrar más cerca
del papel, cuando el problema es que el papel ya está demasiado lejos y pequeño.

**Qué hacer:** distinguir "hay tinta pegada al borde" de "el fiducial que falta está fuera del
radio". El dato para separarlos ya existe en el detector: si el paso ampliado **sí** encuentra
un cuadrado donde el estricto no encontraba nada, la hoja no está recortada — está lejos.

**Criterio de aceptación:** las 4 fotos dejan de reportar `cropped`; ninguna de las 15 restantes
cambia de motivo. Conjunto de oro idéntico.

**Por qué hacerlo aunque F3/F4 se archiven:** un mensaje que manda al usuario en la dirección
equivocada le hace repetir fotos que no van a mejorar. El costo es de minutos por hoja, en
manos de un profesor.

---

## F2 · Recetas de conjunto de oro que reproduzcan la falla

**Costo:** medio. **Depende de:** nada. **Hacer ahora.**

El conjunto de oro **no cubre este modo de falla**: sus 48 hojas sintéticas siempre llenan el
encuadre y siempre dan 4/4. Por eso #187 salió idéntico marca por marca — su código nuevo nunca
se ejecutó ahí.

Hoy la única evidencia de este problema son 19 fotos reales **que no están versionadas**.
Cualquier arreglo futuro se valida contra un conjunto que no existe en el repositorio.

**Qué hacer:** agregar recetas con la hoja pequeña dentro del marco, rotada, y con fiduciales de
otra hoja en el borde del encuadre. Que al menos una receta **falle hoy** en `dev`: una receta
que pasa antes y después no prueba nada.

**Criterio de aceptación:** al menos una receta nueva reproduce la pérdida de fiduciales en
`dev`, y el veredicto global no empeora en ninguna métrica.

**Por qué hacerlo aunque F3/F4 se archiven:** hoy nada impide que una futura optimización del
detector rompa el rescate de #187 sin que ninguna prueba se entere.

⚠️ Ojo con el riesgo de sobreajuste: una receta sintética que reproduzca *exactamente* estas
cuatro fotos no prueba robustez, prueba que sabemos copiar cuatro fotos. Las recetas deben
variar distancia, rotación y presencia de hojas vecinas de forma independiente.

---

## F3 · Componer `leave_one_out` con el rescate por radio ampliado

**Costo:** medio. **Depende de:** F0 con resultado positivo. **Aplazar hasta entonces.**

El rescate de #187 conserva las detecciones estrictas y solo re-busca las faltantes, así que no
puede corregir una detección estricta falsa. `leave_one_out_rectifications` ya existe para el
falso fiducial, pero las dos políticas corren por caminos separados y ninguna cubre el caso
"una detección estricta es falsa **y** falta otra esquina".

**Recomendación: probablemente NO hacerlo, y saltar a F4.**

F4 subsume a F3: una búsqueda global sobre candidatos resuelve tanto la esquina faltante como
la falsa, sin componer dos políticas. Construir F3 y después F4 es escribir código para
borrarlo. Y componer dos políticas que hoy son independientes agrega un camino más al
rectificador, que ya tiene cuatro (estricto, paralelogramo, radio ampliado, leave-one-out).

**Cuándo sí valdría:** si F0 confirma el problema Y F4 resulta más caro de lo estimado, F3 es
la mitigación intermedia. Decidir con la estimación de F4 en la mano, no antes.

---

## F4 · El invariante de consistencia

**Costo:** alto. **Depende de:** F0 con resultado positivo, y F2 como red de seguridad.
**Aplazar.**

Reemplazar el tope de distancia por una verificación de que los cuatro fiduciales forman un
cuadrilátero convexo con la razón de aspecto del layout. Es el arreglo de fondo: elimina el
supuesto de que la hoja llena el encuadre y descarta un cuadrado que pertenece a otra hoja,
porque no encaja en el cuadrilátero.

**Por qué aplazarlo aunque sea "lo correcto":**

- Toca el corazón del módulo. El detector ya acumuló tres correcciones seguidas (el tope, el
  gate de forma, el radio ampliado), cada una tapando el falso positivo de la anterior.
- Su valor está **sin demostrar** para hojas respondidas: hoy ninguna falla por fiduciales.
- Sin F2, no hay forma de validarlo en CI.

**Criterio de aceptación cuando se haga:** las recetas nuevas de F2 pasan; el conjunto de oro no
empeora en ninguna métrica; las 19 fotos reales no pierden ninguna lectura; y la verificación
por mutación de #187 (sustituir la firma de grilla por `True` y comprobar que un test falla)
sigue demostrando que el gate es load-bearing.

**Riesgo específico:** la razón de aspecto del cuadrilátero bajo perspectiva fuerte **no es** la
del layout — cambia con el ángulo. El invariante tiene que tolerar esa deformación sin volverse
tan laxo que acepte cualquier cuadrilátero. Ese es el problema difícil de F4 y hay que
resolverlo en el diseño, no descubrirlo implementando.

---

## Resumen

| | Qué | Cuándo | Por qué |
|---|---|---|---|
| **F0** | Confirmar la hipótesis de las hojas vecinas | **Primero** | Decide si F3/F4 valen algo |
| **F1** | Corregir el motivo `cropped` | **Ahora** | El mensaje manda al usuario al lado equivocado |
| **F2** | Recetas de conjunto de oro | **Ahora** | Hoy nada detecta esta clase de falla |
| **F3** | Componer las dos políticas | Solo si F0 positivo **y** F4 resulta caro | F4 lo subsume |
| **F4** | Invariante de consistencia | Solo si F0 positivo | Valor sin demostrar; toca el núcleo |

**El sesgo de este plan es explícito:** hacer lo barato que tiene valor demostrado (F1, F2),
medir antes de decidir lo caro (F0), y **no construir** lo caro mientras su valor siga sin
demostrarse. Si F0 sale negativo, el resultado correcto de este plan es archivar F3 y F4 con la
medición que lo justifica — no construirlos porque ya estaban escritos.
