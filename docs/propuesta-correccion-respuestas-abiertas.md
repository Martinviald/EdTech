# Propuesta — Corrección automática de respuestas abiertas en la hoja

> Estado: propuesta para discusión (2026-10-08). No hay código nuevo todavía.
> Insumos: inventario del lector de marcas (`services/omr`, `apps/api/src/sheet-scanning`),
> conteo de ítems sobre 97 instrumentos DIA con pauta (2025 + 2026) e investigación
> académica y de industria (fuentes al final).

## 1. Resumen

**Recomendación:** extender el lector con un pipeline que **separa "leer" de "juzgar"**:

1. La hoja imprime, por cada ítem abierto, una **zona estructurada según el formato de la
   respuesta** (casillas de fracción, `(□ ; □)`, casillas por carácter para números) o
   **burbujas** cuando el formato lo permite (pareados, secuencias, puntaje del docente).
2. El motor OMR recorta esa zona (ya sabe hacerlo: `crop_region`).
3. Un modelo de visión (Gemini / OpenAI / Claude) **solo transcribe** lo escrito, en literal,
   con un JSON estructurado y estado explícito (`blank`, `illegible`, etc.).
4. La **corrección es determinística**, con la estrategia `short_answer` que ya existe
   (equivalencia numérica/racional, unidad, tuplas, secuencias).
5. Lo dudoso (baja confianza, dos lecturas que no coinciden, respuesta indecidible) va a una
   **cola de revisión agrupada**, donde el docente valida grupos de respuestas idénticas.

Para desarrollo con rúbrica 0/1/2 (un tercio de los ítems abiertos), la IA **propone** y el
docente **aprueba**, y además se ofrece una vía sin IA: burbujas de puntaje que el profesor
marca en la hoja (equivale al `puntajePapel` de la plataforma DIA).

La opción de enviar el recorte aislado a una API externa **es la mejor opción hoy** para la
lectura, siempre que el modelo no decida el puntaje de los ítems con clave: la evidencia muestra
que el 87 % de los errores de calificación con IA vienen de la transcripción, y que los
modelos tienden a "corregir" lo que el niño escribió. Por eso conviene pedirles que lean, no
que juzguen.

**Buena noticia:** gran parte de la infraestructura ya está construida (§3). El trabajo
principal es en el diseño de la hoja, el contrato de transcripción y la revisión.

## 2. Qué hay que corregir: ítems abiertos de la DIA

Universo: 97 instrumentos DIA con pauta (50 de 2025, 47 de 2026), 2.737 ítems, **338 no son
de alternativas** (169 por año). Matemática es la que más tiene (≈18 % de sus ítems); Lectura
≈8 %; Inglés 20 % (Writing).

Formatos de respuesta en 2026 (n = 169):

| Formato                                     | n   | %    | Ejemplo real                                       | Corrección             |
| ------------------------------------------- | --- | ---- | -------------------------------------------------- | ---------------------- |
| Número entero (14 con la unidad impresa)    | 51  | 30 % | Mate 4° P3 → `847`                                 | Clave exacta           |
| Entero negativo                             | 5   | 3 %  | Mate 8° P1 → `-135`                                | Clave exacta           |
| Decimal con coma                            | 4   | 2 %  | Mate 7° P6 → `10,962`                              | Clave exacta           |
| Fracción "o equivalente"                    | 9   | 5 %  | Mate 7° P33 → `21/10 o equivalente`                | Equivalencia racional  |
| Par ordenado                                | 7   | 4 %  | Mate 7° P18 → `(7;3)` (el orden importa)           | Tupla ordenada         |
| Secuencia / orden                           | 3   | 2 %  | Mate 5° P3 → `3-1-4-2`                             | Secuencia              |
| Lista de palabras                           | 1   | 1 %  | Lect 2° P6 → `Cabeza, tórax, abdomen`              | Conjunto de palabras   |
| Varias casillas (operación, tabla), 0–2 pts | 9   | 5 %  | Mate 1° P8 `__ + __ = __`                          | Parcial por casilla    |
| Términos pareados / unir con línea          | 12  | 7 %  | Hist 6° P16 → A1-B4, A2-B1…                        | Pares                  |
| Desarrollo con rúbrica 2/1/0                | 56  | 33 % | Lect: justificar con el texto; Mate: procedimiento | Rúbrica                |
| Writing inglés (una oración)                | 12  | 7 %  | Ing 6° P25 → «Pedro is cooking.»                   | Rúbrica de 2 criterios |

Lectura para el diseño:

- **≈47 % tiene clave exacta** y se puede corregir de forma determinística una vez leída la
  respuesta. Este es el objetivo de la primera etapa.
- **≈53 % necesita puntaje 0–2** (desarrollo, writing, multicasilla, pareados). Los pareados y
  las secuencias se pueden sacar del problema de escritura usando burbujas.
- No hay ítems de "dibujar en la recta numérica" en 2026; en 2025 hay dos de "marcar/pintar"
  en 1° básico (dejar fuera por ahora).
- La hoja oficial DIA ya usa zonas estructuradas: fracción como numerador sobre denominador,
  par ordenado como `(□ ; □)`, número en un recuadro alargado. El desarrollo se escribe en el
  cuadernillo, no en la hoja.

**Prerrequisito de datos:** en 2025, 72 de 92 ítems `fill_in` de Matemática no tenían la
respuesta extraída; la rama `feat/items-autocorregibles` los convirtió a `short_answer` con
0 desvíos contra los informes oficiales. Sin pauta completa no hay corrección automática:
verificar que esa rama esté integrada antes de empezar.

## 3. Qué ya tenemos

| Pieza                                                      | Dónde                                                                               | Estado                                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Tipos de campo `bubble_group`, `digit_grid`, `crop_region` | `packages/types/src/schemas/omr-layout.schema.ts:30`, `services/omr/app/readers.py` | Construidos. `digit_grid` = grilla 0–9 por columna; `crop_region` = recorte JPEG como respuesta                                      |
| Recortes guardados en S3                                   | `sheet_scan_marks.cropFileId`, `sheet-scan.service.ts`                              | Construido. Retención 180 días                                                                                                       |
| Corrección IA de recortes                                  | `apps/api/src/sheet-scanning/development-grading.service.ts`                        | Construido: al confirmar el lote crea `ai_grading_jobs`, manda el recorte + enunciado + rúbrica al LLM y escribe `responses.aiScore` |
| Proveedores LLM multimodales por organización              | `apps/api/src/llm/`, `llm-settings.schema.ts`                                       | Anthropic y Gemini; `ai_grading` usa `gemini-2.5-pro` por defecto                                                                    |
| Separación IA / humano                                     | `responses.aiScore`, `humanScore`, `finalScore`, `scoredBy`                         | Construido                                                                                                                           |
| Comparador determinístico                                  | `packages/types/src/scoring/strategies/short-answer.strategy.ts`                    | Construido: numérico/racional, unidad, "indecidible ≠ incorrecto"                                                                    |
| Rúbricas con niveles y crédito parcial                     | `rubric-scored.strategy.ts`, `apps/api/src/rubrics/`                                | Construido                                                                                                                           |

**Lo que falta:**

1. El diseño automático de la hoja solo acepta `multiple_choice` y `true_false`
   (`sheet-layout.helpers.ts:74`). Los campos `digit_grid` / `crop_region` solo existen si el
   layout se arma a mano.
2. `DevelopmentGradingService` le pide al modelo el **puntaje** directamente. Para los ítems con
   clave hay que pedirle la **transcripción** y dejar que `short_answer` decida.
3. No hay casillas de puntaje para el docente en la hoja.
4. No hay (o no es completa) una vista de revisión de `aiScore` agrupada por respuesta.
5. No hay un conjunto de referencia para medir la precisión.

## 4. Estado del arte

### Academia

- **Expresiones matemáticas manuscritas (HMER).** Los mejores modelos especializados
  (CoMER, TAMER, PosFormer) reconocen ≈60–68 % de las expresiones exactas en CROHME/HME100K.
  Son expresiones largas en LaTeX; en respuestas cortas el techo es más alto. No hay datos de
  escritura infantil en español. Entrenar algo propio no compensa para nuestro caso.
- **Casillas por carácter (ICR restringido).** Es el formato que mejor funciona: precisión por
  carácter en el alto 90 % (el Censo de EE.UU. 2000 reportó >99 % con revisión de lo
  rechazado). En texto libre sin casillas el error se dispara. La precisión de un campo cae con
  su largo: un solo carácter mal leído invalida el campo.
- **Modelos de visión que califican.** Resultados muy dispares según la tarea:
  - Aritmética escolar corta: 95 % de acuerdo, κ = 0,90.
  - Interpretar dibujos matemáticos: κ = 0,20.
  - Desarrollo de cálculo universitario con GPT-5: R² ≈ 0,85 sin filtro; filtrando por riesgo
    se acepta solo el 30–80 % y el resto va a un humano.
  - GPT-4o con rúbrica en matemática manuscrita: accuracy 0,47 (insuficiente).
- **El error está en la lectura.** Un estudio de 2026 atribuye el **87 %** de los errores del
  mejor modelo a la transcripción, no a la rúbrica. Varios trabajos documentan la
  **sobrecorrección**: el modelo "arregla" el error del alumno o lee lo que espera leer (y si
  ve la solución de referencia, alucina una respuesta parecida). Gemini 2.5 Flash aparece como
  el transcriptor más fiel en uno de esos estudios.
- **Equivalencia matemática.** Math-Verify (Hugging Face, sobre SymPy) resuelve la comparación
  simbólica y numérica. Nuestro comparador ya cubre los casos DIA; sirve de referencia si se
  amplía a expresiones algebraicas.
- **Abstención.** Mandar a un humano lo de baja confianza o lo que dos lecturas no coinciden
  está bien respaldado (CHiL(L)Grader: 35–65 % automático con QWK ≥ 0,80; SURE: −40 a −90 %
  de trabajo manual). Qué señal de confianza funciona mejor no está resuelto: hay que medirlo
  con datos propios.

### Industria

- **Gradescope** agrupa respuestas manuscritas de una línea dentro de un recuadro fijo y el
  docente califica por grupo. Es el patrón de revisión más probado.
- **GradeCam** (que ya usa el colegio) tiene "Number Grid" de burbujas y un "Handwritten
  Numeric" con IA propia, sin precisión publicada. **Remark OMR** ofrece grid-in de burbujas
  con fracciones, decimales y negativos.
- **Crowdmark** se niega explícitamente a puntuar respuestas abiertas con IA.
- **Mathpix** (OCR matemático): USD 0,002 por imagen. **AWS Textract** solo lee manuscrito en
  inglés. **Azure Document Intelligence** sí soporta español manuscrito.
- **Evaluaciones nacionales** (SIMCE, NAEP, PISA): las respuestas abiertas en papel siguen
  corrigiéndose con humanos sobre imágenes escaneadas. La IA se usa sobre respuestas
  digitadas.
- **Productos "IA que corrige papel"** (Marking.ai, GradeOrbit, etc.): no publican precisión
  verificable.

## 5. Opciones evaluadas

| Opción                                      | Precisión esperada              | Costo marginal                          | Esfuerzo                              | Riesgo principal                                             | Veredicto                                                 |
| ------------------------------------------- | ------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| A. Grid-in de burbujas (`digit_grid`)       | ≈ OMR actual (>99 %)            | ~0                                      | Bajo (ya existe el lector)            | Difícil para 2°–4° básico; ocupa mucho espacio; solo números | Útil desde 5° básico como respaldo, no como vía principal |
| B. ICR local (CNN en casillas)              | 97–99 % por carácter (adultos)  | ~0                                      | Medio-alto: dataset propio etiquetado | Escritura infantil fuera de distribución; no lee palabras    | Postergar; puede alimentarse de los datos de C            |
| C. **Modelo de visión transcribe + reglas** | Alta en respuestas cortas       | ≈ USD 0,0002–0,002 por recorte          | Medio                                 | Sobrecorrección; privacidad; cambios de versión del modelo   | **Recomendada para ítems con clave**                      |
| D. Modelo de visión califica con rúbrica    | Moderada y variable             | Mayor                                   | Medio (ya existe)                     | Sesgo, crédito mal asignado                                  | **Solo como propuesta, con docente**                      |
| E. OCR matemático comercial (Mathpix)       | Sin datos de escritura infantil | USD 0,002 por imagen                    | Bajo                                  | Normaliza; sin estado de confianza útil                      | Como segunda lectura, opcional                            |
| F. Burbujas de puntaje para el docente      | ≈ OMR actual                    | ~0 (tiempo docente)                     | Bajo                                  | El docente igual corrige el cuadernillo                      | **Recomendada para desarrollo** (vía sin IA)              |
| G. Revisión humana agrupada                 | Referencia                      | Tiempo docente, reducido por los grupos | Medio (UI)                            | Fatiga                                                       | **Siempre**, como red de seguridad                        |

La propuesta combina **C + F + G**, con **A** opcional y **D** para desarrollo.

## 6. Propuesta de arquitectura

### 6.1 Diseño de la hoja: una zona por formato

El layout automático debe derivar el campo desde `item.type` + `scoring_config` / `content`:

| Formato del ítem                   | Campo en la hoja                                                                                  | Lectura                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| Entero / negativo / decimal        | `crop_region` con **casillas por carácter** impresas (signo y coma decimal como casillas propias) | Visión: transcripción            |
| Fracción                           | `crop_region` con caja de numerador sobre caja de denominador                                     | Visión, con las partes separadas |
| Par ordenado                       | `crop_region` con `( □ ; □ )`                                                                     | Visión, con las partes separadas |
| Secuencia / orden                  | `bubble_group` por posición (1°: ①②③④ …)                                                          | OMR puro                         |
| Términos pareados                  | `bubble_group` por término de la columna A (A1 → ①②③④)                                            | OMR puro                         |
| Lista de palabras / oración corta  | `crop_region` con renglón                                                                         | Visión: transcripción            |
| Desarrollo (rúbrica 0–2)           | **Burbujas de puntaje docente** `⓪①②`, y opcionalmente `crop_region` si se responde en la hoja    | OMR, o propuesta IA              |
| Enteros desde 5° básico (opcional) | `digit_grid`                                                                                      | OMR puro                         |

Reglas de impresión que ayudan a la precisión:

- Casillas cuadradas y separadas.
- La unidad impresa fuera de las casillas ("\_\_\_ grados").
- El recorte **nunca incluye** el encabezado con nombre, RUT o QR.
- Margen de recorte para alcanzar lo que se sale de la caja.

Hay que agregar los formatos (fracción, tupla) al esquema del layout y extender el diseñador
web para editarlos.

### 6.2 Contrato de transcripción (salida estructurada)

Prompt de **lectura**, no de corrección:

- No se envían la clave ni la respuesta modelo, para no inducir a leer lo esperado.
- Sí se envía el formato esperado.
- Se prohíbe normalizar, completar o corregir.

Respuesta con JSON schema forzado (los tres proveedores lo soportan):

```json
{
  "status": "answered | blank | illegible | crossed_out_only | multiple_answers",
  "literal": "3/4",
  "parts": { "numerator": "3", "denominator": "4" },
  "alternativeReadings": [{ "literal": "3/9", "plausibility": 0.15 }],
  "confidence": 0.93,
  "notes": "el 4 tiene el trazo superior abierto"
}
```

- `parts` depende del formato: `{integer}`, `{numerator, denominator}`, `{x, y}`,
  `{words: []}`.
- `alternativeReadings` es la señal clave para la abstención: si hay una lectura alternativa
  plausible **y** cambia el resultado de la corrección, el caso va a revisión.
- `literal` + recorte + modelo + `promptVersion` se guardan como evidencia (§8.3 del
  `CLAUDE.md`).

### 6.3 Corrección determinística

`literal` / `parts` se normalizan (coma decimal, espacios, guiones, número mixto) y pasan
como `rawAnswer` a `shortAnswerStrategy`, que ya devuelve match, no-match o indecidible.

Decisiones pedagógicas que van como configuración del ítem, no en el código:

- ¿Se exige la fracción irreducible? La DIA dice "o equivalente".
- ¿Se acepta `0,5` cuando la clave es `1/2`?
- Tolerancia de los decimales.
- Crédito parcial por componente en pares ordenados (la Agencia lo da: verificado en II° P12).

### 6.4 Confianza, doble lectura y revisión

Se acepta automáticamente si:

- `status = answered`, y
- `confidence ≥ umbral`, y
- ninguna lectura alternativa cambiaría el resultado, y
- (en la fase de validación) una segunda lectura con **otro proveedor** coincide.

Todo lo demás va a la cola de revisión. Ahí:

- Las respuestas se **agrupan** por `literal` normalizado y ítem (estilo Gradescope): el
  docente confirma "`21/10` → correcta" una vez para 30 alumnos.
- Se muestra el recorte al lado de cada lectura.

Los casos `blank` se resuelven sin modelo cuando el lector detecta tinta casi nula, que es más
barato y evita que el modelo alucine.

El umbral **se calibra con datos propios**, no se fija de antemano. La meta es la precisión de
lo aceptado automáticamente (≥ 99,5 %), no la tasa de automatización.

### 6.5 Desarrollo y Writing (rúbrica)

- **Vía 1 (sin IA, inmediata):** el docente corrige el cuadernillo y marca ⓪①② en la hoja.
  Reemplaza el tipeo del `puntajePapel` y reutiliza el OMR completo.
- **Vía 2 (IA asistida):** extender `DevelopmentGradingService` en dos pasos:
  1. Transcripción literal (como en §6.2).
  2. Calificación con la rúbrica y los **ejemplos por código** de la ficha técnica (las 67
     rúbricas extraídas los traen).

  El resultado queda siempre como `aiScore` propuesto. Es obligatorio que el docente lo
  apruebe hasta que la medición del §7 demuestre acuerdo suficiente (QWK ≥ 0,80 contra
  docente, por ítem).

- **A futuro:** desarrollo matemático paso a paso. Se construye sobre la misma transcripción.
  Lo nuevo es la rúbrica por pasos (por ejemplo, procedimiento correcto con error de cálculo
  = código 1) y el crédito por arrastre del error. No se automatiza sin la misma medición.

### 6.6 Proveedor y modelo

- La transcripción es una tarea liviana: un modelo rápido (Gemini Flash / GPT-mini / Claude
  Haiku) basta, y es varias veces más barato que `gemini-2.5-pro`.
- Cada lectura se configura por funcionalidad y organización con `llm-settings` (ya existe).
  Conviene una feature nueva, `answer_transcription`, separada de `ai_grading`.
- **Fijar la versión del modelo** y repetir la medición antes de cambiarla: el comportamiento
  cambia entre versiones.
- Usar batch (−50 %) para la corrección diferida: no se necesita la respuesta en segundos.

### 6.7 Costo (estimación, sin verificar)

Un colegio de 1.300 alumnos × ~6 instrumentos al año × ~4 ítems abiertos de lectura por
instrumento ≈ **31.000 recortes al año**. Con doble lectura a ~USD 0,001 por recorte, son
≈ **USD 60–100 al año por colegio**. Lo caro no es el modelo: es el tiempo docente en la
revisión, que es lo que hay que minimizar.

### 6.8 Privacidad y cumplimiento

- Se envía **solo el recorte**, sin nombre, RUT ni QR, identificado por un ID opaco. El
  enunciado del ítem no es dato personal.
- Contratar el tier **pago** con DPA. El tier gratuito de Gemini / AI Studio admite revisión
  humana de los datos: **no usarlo**. Solicitar _zero data retention_ donde sea posible.
- **Ley 21.719:** entra en vigor el 1 de diciembre de 2026, con un proyecto de postergación a
  2027 en trámite.
  - Implica datos de menores, principio de interés superior del niño y transferencia
    internacional regulada (art. 28).
  - Hay que reflejarlo en el contrato con el colegio (encargo de tratamiento) y en la política
    de privacidad.
  - Ofrecer un **interruptor por organización**: "no enviar imágenes a terceros", que deja solo
    las vías OMR (A, F) y la revisión humana.
- La retención de los recortes (180 días) debe cubrir el plazo de reclamo de una nota.

## 7. Validación antes de automatizar

1. **Conjunto de referencia:** 2–3 cursos reales por formato. Un docente transcribe cada
   recorte (la verdad) y se guarda el puntaje oficial.
2. **Oráculo extra:** los informes oficiales DIA traen % de respuesta correcta, parcial e
   incorrecta por pregunta. La agregación de nuestras correcciones debe cuadrar con ellos,
   igual que se hizo con `items-autocorregibles`.
3. **Métricas por formato y por grado:**
   - Exactitud de la transcripción de campo completo.
   - Precisión de lo autoaceptado.
   - % autoaceptado.
   - Para rúbricas: QWK y acuerdo exacto contra el docente.
4. **Comparación de proveedores** sobre el mismo set, en el mismo contrato: Gemini Flash vs
   GPT-mini vs Claude Haiku, y opcionalmente Mathpix.

## 8. Plan por fases

| Fase       | Contenido                                                                                                                           | Resultado                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0          | Integrar `items-autocorregibles`; verificar pautas 2025/2026; elegir y medir 2–3 cursos de referencia                               | Datos listos                              |
| 1          | Layout automático de pareados y secuencias como burbujas + burbujas ⓪①② de puntaje docente                                          | ≈ 60 % de los abiertos sin IA             |
| 2          | Formatos de hoja (casillas por carácter, fracción, tupla) + `answer_transcription` (contrato §6.2) + puente a `shortAnswerStrategy` | Respuesta corta automática con abstención |
| 3          | Cola de revisión agrupada (`aiScore` / transcripción → `humanScore` / `finalScore`)                                                 | El docente valida por grupo               |
| 4          | Doble lectura y calibración del umbral con el conjunto de referencia; decidir el proveedor                                          | Automatización con precisión medida       |
| 5          | Desarrollo y Writing: transcripción + rúbrica con ejemplos, siempre como propuesta                                                  | IA asistida en rúbricas                   |
| 6 (futuro) | Desarrollo matemático por pasos; texto largo manuscrito                                                                             | Sobre la misma base                       |

## 9. Decisiones abiertas

1. ¿Los alumnos responden los ítems abiertos **en nuestra hoja** (como la hoja oficial DIA) o
   en el cuadernillo? Esto define si el desarrollo se lee con IA o solo con burbujas de puntaje.
2. ¿Política de equivalencias por defecto? (fracción no reducida, decimal ↔ fracción).
3. ¿Interruptor de "no enviar imágenes a terceros" activado o desactivado por defecto, por
   organización?
4. ¿Proveedor preferido para el contrato de datos? Hoy la configuración por defecto es Gemini.

## Fuentes principales

- TAMER (AAAI 2025): https://arxiv.org/pdf/2408.08578 · CoMER: https://arxiv.org/pdf/2207.04410 · Uni-MuMER: https://arxiv.org/pdf/2505.23566
- Aritmética manuscrita con LLM (κ 0,90): https://arxiv.org/abs/2510.05538
- GPT-5 corrigiendo cálculo con filtrado por riesgo: https://arxiv.org/html/2510.05162v2
- 87 % de errores por transcripción: https://arxiv.org/abs/2605.19043
- LLM con rúbrica en matemática manuscrita (LAK 2025): https://arxiv.org/html/2411.05231v2
- FERMAT (detección de errores en manuscrito): https://arxiv.org/html/2501.07244v2
- CHiL(L)Grader (abstención calibrada): https://arxiv.org/abs/2603.11957
- Math-Verify: https://github.com/huggingface/Math-Verify
- Gradescope AI-assisted grading: https://guides.gradescope.com/hc/en-us/articles/24838908062093
- Remark OMR grid-in: https://remarksoftware.com/blog/2016/08/support-video-setting-up-a-math-grid-in-region-in-remark-office-omr
- Mathpix precios: https://mathpix.com/blog/image-api-price-reduction
- Diseño de formularios para ICR: https://www.accusoft.com/resources/blog/improving-intelligent-character-recognition-icr-accuracy-better-form-design/
- Términos Gemini API: https://ai.google.dev/gemini-api/terms · Datos en la API de OpenAI: https://developers.openai.com/api/docs/guides/your-data
- Ley 21.719: https://www.bcn.cl/leychile/navegar?i=1209272 · Postergación: https://www.carey.cl/gobierno-ingresa-proyecto-de-ley-que-posterga-en-un-ano-entrada-en-vigor-de-la-ley-sobre-proteccion-de-datos-personales

Las cifras de precio por token, la precisión de GradeCam "Handwritten Numeric" y el estado de
la postergación de la Ley 21.719 no se pudieron verificar en la fuente primaria.
