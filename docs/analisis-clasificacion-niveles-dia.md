# Análisis: ¿cómo clasifica el DIA a los estudiantes en niveles de logro?

> **Fecha:** 2026-07-05
> **Contexto:** Ingeniería inversa de los niveles de logro (I / II / III) del DIA Lectura 2025, a partir de los informes oficiales de CSCJ y las respuestas cargadas en la BDD demo.
> **Estado:** Concluido en lo esencial. Pendiente una validación física de 2 casos (§7).
> **Confidencialidad:** Este documento referencia datos del roster real de CSCJ (Ley 19.628). Los alumnos se identifican por curso + n° de lista + apellido, no con nombre completo.

---

## 1. Resumen ejecutivo

- **Pregunta:** ¿el nivel de logro del DIA es un corte por % de respuestas correctas, o una función que pondera distinto cada pregunta (pesos fijos / TRI)?
- **Conclusión:** con la evidencia disponible, el nivel es una **escala por % de logro del puntaje total (selección múltiple + desarrollo), con un umbral de corte propio de cada instrumento** (cada grado/forma tiene su corte). **No se requiere Teoría de Respuesta al Ítem (TRI) para replicarlo.**
- Todo el conjunto (8 cursos, ~290 alumnos) es consistente con ese modelo **salvo 2 registros**, que el análisis de patrón de respuestas muestra como **errores de datos** (respuestas que no corresponden al nivel III oficial bajo ningún modelo), no como evidencia de ponderación.
- **Implicación de diseño:** cada instrumento DIA necesita su **propio umbral almacenado**, recuperable del informe oficial. El default genérico `40/70/85` no aplica a DIA.

---

## 2. Pregunta de investigación

La clasificación interna de la plataforma hoy usa un corte por % de logro (umbrales por defecto 0.40 / 0.70 / 0.85 sobre 4 niveles). Surgió la duda de si eso es fiel a cómo clasifica realmente el DIA, que reporta 3 niveles de logro (**I / II / III**) sobre los "OA basales". En particular:

1. ¿El corte del DIA es solo cantidad/porcentaje de correctas, o pondera qué preguntas se acertaron?
2. ¿Los umbrales son iguales para todas las pruebas o distintos por prueba?

Un dato de partida relevante aportado por el equipo: **el informe oficial con el nivel de cada alumno se genera al instante al digitar las respuestas**, lo que descarta calibración con la cohorte (no es norm-referencing sobre el curso), pero **no** descarta pesos fijos por ítem ni parámetros TRI pre-fijados.

---

## 3. Datos y metodología

### 3.1 Extracción de niveles desde los informes PDF oficiales

- **Fuente:** `Histórico Pruebas DIA/Resultados/Resultados DIA lenguaje 2025/Intermedio/` (7 informes de Monitoreo) + el informe de 6°B entregado aparte. Total **8 cursos**: 3°A, 3°B, 4°A, 4°B, 5°A, 5°B, 6°A, 6°B.
- La figura relevante es la penúltima página: *"Figura 1. Resultados por estudiante según niveles de logro en los OA basales de X básico"* — cada alumno es un **punto verde** sobre una línea, ubicado en una de tres bandas (nivel I / II / III).
- **Método (programático, reproducible — no a ojo):**
  1. Render de la página a PNG 300 dpi (`pdftoppm`).
  2. Detección de los puntos verdes por color (RGB ≈ 61,107,96).
  3. Detección de las **fronteras de banda** por el perfil de "azuleza" del fondo (nivel I/III = azul intenso B−R≈44, nivel II = azul claro ≈25); los saltos marcan los cortes, y **se detectan por informe** (cada grado tiene su geometría).
  4. OCR (`tesseract`) del **n° de lista + nombre** de cada fila; se ancla la búsqueda del punto en la banda horizontal de cada fila OCR → emparejamiento 1:1 garantizado nombre↔punto.
- **Validación:** cruce visual contra las figuras; 0 alumnos sin punto; los casos límite (punto sobre la línea II/III) quedan marcados por su coordenada `x`.
- **Salida:** `Histórico Pruebas DIA/Resultados/dia_niveles_lenguaje_2025.csv` (curso, n° lista, nombre OCR, nivel, x del punto).

> Un subproducto valioso: la **posición horizontal del punto** (`x`) no es decorativa — correlaciona 0.94–0.98 con el puntaje y es la **medida continua latente del DIA** (su puntaje/θ subyacente), capturada para ~290 alumnos.

### 3.2 Resultados desde la BDD

- Origen: BDD **demo** (RDS Postgres privado, AWS). Acceso vía `sst tunnel` + rol admin; lectura con contexto RLS (`app.current_org_id` = CSCJ). Ver skill `demo-db-access`.
- Por alumno: `total_score`, `max_score`, `percentage`, `performance_level` (nuestro cálculo), respuestas ítem-a-ítem (`responses.is_correct`, `value`), y la clave correcta (`items.content.alternatives[].isCorrect`).
- **Importante:** las respuestas cargadas son **solo la sección de selección múltiple (MC)**. La sección de desarrollo (open-ended) se excluyó al digitar. Por eso `max_score` en BDD = solo ítems MC (19 / 21 / 25 / 26 según grado).

### 3.3 Cruce

- Cruce difuso por nombre (normalización sin tildes + solape de tokens de apellidos) entre el CSV de niveles y los resultados de BDD, dentro de cada curso.
- Cobertura: ~256–290 alumnos cruzados. Nota: 3°B tenía la carga incompleta al inicio (8 de 39) y se completó durante el análisis.

---

## 4. Hallazgo 1 — Los umbrales son **por instrumento**

Recuperando el corte que mejor separa los niveles en cada curso (puntaje mínimo para entrar al nivel, expresado también como % sobre los ítems MC):

| Grado | Ítems MC | Corte I→II | Corte II→III (A) | Corte II→III (B) |
|---|---|---|---|---|
| 3° | 19 | ~32% (6/19) | 17/19 = **89%** | 17/19 = **89%** |
| 4° | 21 | ~33–38% (7–8/21) | 15/21 = **71%** | 16/21 = **76%** |
| 5° | 25 | ~32–36% (8–9/25) | 19/25 = **76%** | 20/25 = **80%** |
| 6° | 26 | ~35% (9/26) | 19/26 = **73%** | 20/26 = **77%** |

**Lectura:**
- El corte II→III varía **71%–89%** según el grado → **no hay un % único universal**.
- Las secciones **A y B del mismo grado coinciden** dentro de ±1 punto (mismo instrumento → mismo corte; la diferencia de 1 punto es ruido de estimación con pocos alumnos en el borde).
- Es lo esperable en pruebas estandarizadas: el corte se fija por *standard-setting* sobre cada forma; un % fijo clasificaría mal formas de distinta dificultad. Por extensión, Diagnóstico / Intermedio / Final (instrumentos distintos) tendrían cada uno su corte.

---

## 5. Hallazgo 2 — ¿% de logro o ponderación por ítem?

### 5.1 Señal inicial: inversiones

Cruzando puntaje MC con nivel oficial aparecían **inversiones**: alumnos con *más* respuestas correctas pero *menor* nivel. Si el nivel fuese un corte por % puro, la correlación puntaje↔nivel sería perfecta y no habría inversiones. Esto sugería, en primera instancia, ponderación por ítem.

### 5.2 Confound correcto: la sección de desarrollo faltante

Como en BDD faltan los puntos de desarrollo, dos alumnos con igual MC pueden diferir en el total real → explicaría inversiones **pequeñas**. Clave: **cuánto vale el desarrollo**.

- La pauta no fija puntaje. Pero define 3 categorías por pregunta de desarrollo (correcta / parcial / incorrecta) → lo natural es **0/1/2 = máx 2 puntos por pregunta**.
- Preguntas de desarrollo: 3 en 3°/4°, 2 en 5°/6° → **techo de desarrollo: 6 pts (3°/4°), 4 pts (5°/6°)**.

Con ese techo, **casi todas las inversiones se explican** (caben dentro de los 2–4 puntos de desarrollo). Quedan solo las inversiones "duras" cuya brecha MC supera el techo.

### 5.3 Los casos que no cerraban: 2 registros

Bajo el techo realista (2 pts/pregunta), en los 8 cursos quedan **exactamente 2** casos "sobre-ubicados" (nivel mayor al que el puntaje permite, aun dando el máximo de desarrollo):

| Curso | N° | Alumno | MC en BDD | Nivel oficial |
|---|---|---|---|---|
| 5°A | 40 | Sánchez G. | **13/25 (52%)** | III |
| 6°B | 10 | Cerda O. | **13/26 (50%)** | III |

Ambos: respuestas **completas** en BDD (0 pendientes) y punto **verificado visualmente** en la banda III. Coincidencia llamativa: los dos con **exactamente 13 correctas → nivel III**.

### 5.4 Análisis del patrón de respuestas de los 2 casos

Se analizó ítem-a-ítem el perfil de ambos, usando la dificultad (p = % del curso que acierta) y la discriminación (point-biserial) de cada ítem:

| Métrica | Sánchez G. (5°A) | Cerda O. (6°B) | Interpretación |
|---|---|---|---|
| p̄ de sus **aciertos** | 0.77 | 0.76 | acertó ítems **fáciles** |
| Ítems **difíciles** (p≤.40) acertados | 0 | 0 | no acertó ninguno difícil |
| Ítems **fáciles** (p≥.75) fallados | 7 | 8 | falló varios fáciles |
| Discriminación media de sus aciertos | +0.51 (test +0.47) | **+0.23** (test +0.32; sus errores +0.40) | Cerda acertó los de **baja** discriminación |
| Aciertos entre los de **alta** discriminación | 8/13 | **3/13** | no es "clavó los decisivos" |
| Desfase de digitación (offset) | ninguno | ninguno | no es un error "corrido" |

**Conclusión del patrón:** ambos tienen perfil de **rendimiento bajo** (aciertos fáciles, cero difíciles, discriminación normal/baja). **Ningún modelo — % de logro, ponderado por dificultad, ni TRI/2PL — los pondría en nivel III con estas respuestas.** Por tanto, las respuestas registradas bajo esos nombres **no corresponden al alumno que el informe ubicó en III**: es un **error de datos** (probable cruce de hoja / desalineo de nómina al digitar), no evidencia de ponderación.

### 5.5 Veredicto del mecanismo

Excluyendo esos 2 registros inconsistentes, **el conjunto completo queda consistente con: nivel = % de logro del puntaje total (MC + desarrollo), con corte por instrumento.** La señal de "ponderación por ítem" observada al inicio era un artefacto de 2 registros malos + los puntos de desarrollo faltantes.

---

## 6. Conclusión

1. **Mecanismo:** el nivel de logro del DIA es (con la evidencia actual) una **escala por % de logro del puntaje total**, no una función que pondere distinto cada pregunta.
2. **Umbrales:** **por instrumento** (cada grado/forma/período tiene su corte oficial), no un % universal.
3. **No se necesita TRI** para replicar la clasificación oficial: basta aplicar el corte oficial de cada instrumento sobre el % de logro.

---

## 7. Pendiente de validación

Confirmar con las **hojas físicas** de los 2 casos:

- **Sánchez G. (5°A, n°40)** y **Cerda O. (6°B, n°10)**.
- Pregunta a responder: ¿las respuestas digitadas son realmente de ese alumno? Sus respuestas son de un alumno de nivel bajo, pero el informe los pone en III. Sospechar de hoja intercambiada u orden de nómina desalineado al cargar ese curso.
- Si se confirma el error de datos, el mecanismo queda cerrado: **% de logro con umbral por instrumento**.
- Recomendación adicional: **cargar la sección de desarrollo** para poder verificar el modelo % de forma completa (hoy las inversiones chicas quedan *explicables* por el desarrollo, no *verificadas*).

---

## 8. Implicaciones de diseño

- **Umbrales por instrumento (no global).** El default `40/70/85` no sirve para DIA. Cada instrumento DIA debe tener su corte almacenado (mecanismo `scale.config` / por instrumento).
- **Recuperación de cortes oficiales.** El método de este análisis permite recuperar el corte de un instrumento nuevo a partir de un informe oficial de muestra, **sin depender de que el colegio suba las respuestas al DIA** — punto de valor para el PLG (dar el nivel oficial dentro de la plataforma).
- **La sofisticación (TRI, perfiles por habilidad, incertidumbre) NO va en el nivel/label oficial** (eso se replica tal cual el DIA), sino en una capa **diagnóstica** separada, que responde otra pregunta (dónde está la brecha), sin desalinear del estándar oficial.
- **3 vs 4 niveles.** Estos informes usan 3 niveles (I/II/III) sobre "OA basales", distintos de los 4 niveles internos (Insuficiente/Elemental/Adecuado/Avanzado). La relación entre ambas escalas es una decisión pendiente aparte.

---

## 9. Reproducibilidad

- **Extracción de niveles:** scripts en el scratchpad de la sesión (`extract2.py`, `run6b.py`) — render 300 dpi + detección de puntos + fronteras + OCR. Salida: `dia_niveles_lenguaje_2025.csv`.
- **Datos de BDD:** vía skill `demo-db-access` (túnel + RLS). Evaluaciones DIA Lectura 2025 Intermedio (org CSCJ `c5c10000-0000-0000-0000-000000000001`).
- **Cruce y análisis:** `join`, recuperación de cortes, inversiones, y patrón ítem-a-ítem (dificultad + discriminación + test de offset).

---

## 10. Anexo — datos clave por curso

| Curso | Ítems MC | N (nivel) | N (BDD) | Corte II→III | Nivel I / II / III |
|---|---|---|---|---|---|
| 3°A | 19 | 40 | 40 | 17/19 (89%) | 0 / 21 / 19 |
| 3°B | 19 | 39 | 39 | 17/19 (89%) | 1 / 27 / 11 |
| 4°A | 21 | 46 | 43 | 15/21 (71%) | 6 / 19 / 21 |
| 4°B | 21 | 45 | 44 | 16/21 (76%) | 5 / 22 / 17 |
| 5°A | 25 | 37 | 38 | 19/25 (76%) | 2 / 14 / 21 |
| 5°B | 25 | 43 | 44 | 20/25 (80%) | 1 / 20 / 22 |
| 6°A | 26 | 42 | 43 | 19/26 (73%) | 1 / 14 / 27 |
| 6°B | 26 | 40 | 40 | 20/26 (77%) | 0 / 21 / 19 |

*(Diferencias de N entre "nivel" y "BDD" se deben a alumnos presentes en un origen y no en el otro; el cruce es por nombre.)*

---

## Anexo — Sembrado de bandas para instrumentos sin corte derivable (2026-07-19)

Los cortes reverse-engineered de arriba solo existen para **Lectura Intermedio 3°–6°** (la única
cohorte con datos por-alumno). Los demás instrumentos DIA (Matemática, y Lectura Cierre/Diagnóstico)
no tienen datos por-alumno para su standard-setting, pero necesitan las 3 bandas (Nivel I/II/III)
sembradas para colgar la **distribución por nivel** de sus informes agregados
(`assessment_level_stats`).

**Decisión:** `seed-performance-bands.ts` siembra las bandas de **todos** los instrumentos DIA
oficiales — con el corte real donde se conoce, y un **corte genérico provisional** (promedio de los 4
conocidos: `iToII≈0.34`, `iiToIII≈0.79`) donde no. El corte provisional **no afecta** la distribución
por nivel ni "requiere apoyo" (que vienen del informe, colgados por identidad de banda), solo la
etiqueta derivada logro→nivel del curso — que el DIA no reporta. Se corrige por instrumento vía el
endpoint platform_admin cuando haya cortes oficiales.
