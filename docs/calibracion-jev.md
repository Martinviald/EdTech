# Calibración del motor de decisiones (Jev)

> Generado por `scripts/decisions/run-calibration.ts` el 2026-09-27. No editar a mano: vuelve a correr el script.

| Campo                       | Valor                                   |
| --------------------------- | --------------------------------------- |
| Fecha                       | 2026-09-27T23:32:36.639Z                |
| Motor                       | jev                                     |
| Modelo pedido               | jev-1.13.0                              |
| Modelo que respondió        | jev-1.13.0                              |
| Idioma de las instrucciones | es (español neutro)                     |
| n remedial                  | 55                                      |
| n taxonomía (tareas)        | 87                                      |
| Concurrencia                | 4                                       |
| Precio                      | 0.042 USD / millón de tokens de entrada |

## Advertencias

- Instrucciones en español: Jev rinde mejor en inglés (docs de TypeSafe); los números miden el español que usará el producto.
- Aritmética y conteo son puntos débiles documentados de Jev (jaggedness #2): mira por separado las filas de matemática.
- Los ítems remediales con veredicto del juez LLM son pocos y de una sola asignatura (Lenguaje); el acuerdo de los Noul es indicativo.
- Ítems del banco con fórmulas extraídas de PDF pueden tener símbolos perdidos (exponentes, fracciones): el extractor filtra los casos evidentes, no todos.
- Taxonomía: el estado incluye asignatura y curso del instrumento (lo que sabría el producto al etiquetar).

## Juez remedial

Preguntas: `judge-decision-v1` (`apps/api/src/remedial/judge-decision.ts`, sin cambios). n = 55 ítems (15 generados por el motor remedial, 40 del banco oficial/importado); errores: 0.

### `clave`: exactitud contra la alternativa `isCorrect`

| Grupo           | n   | Exactitud | Confianza media |
| --------------- | --- | --------- | --------------- |
| Todos           | 55  | 89.1%     | 0.92            |
| Matemática      | 12  | 58.3%     | 0.73            |
| Resto           | 43  | 97.7%     | 0.97            |
| bank / HIST     | 8   | 100.0%    | 0.99            |
| bank / LANG     | 12  | 91.7%     | 0.93            |
| bank / MATH     | 12  | 58.3%     | 0.73            |
| bank / SCI      | 8   | 100.0%    | 0.96            |
| remedial / LANG | 15  | 100.0%    | 1.00            |

### Calibración de `clave` (todos)

| Tramo de confianza | n   | % del total | Exactitud | Confianza media |
| ------------------ | --- | ----------- | --------- | --------------- |
| [0, 0.5)           | 4   | 7.3%        | 0.0%      | 0.28            |
| [0.5, 0.7)         | 2   | 3.6%        | 50.0%     | 0.56            |
| [0.7, 0.85)        | 2   | 3.6%        | 100.0%    | 0.79            |
| [0.85, 0.95)       | 2   | 3.6%        | 100.0%    | 0.94            |
| [0.95, 1]          | 45  | 81.8%       | 97.8%     | 1.00            |

### Cobertura vs exactitud de `clave` (todos)

| Umbral (confidence >=) | Cobertura | n cubiertos | Exactitud cubiertos |
| ---------------------- | --------- | ----------- | ------------------- |
| 0.50                   | 92.7%     | 51          | 96.1%               |
| 0.55                   | 90.9%     | 50          | 96.0%               |
| 0.60                   | 90.9%     | 50          | 96.0%               |
| 0.65                   | 89.1%     | 49          | 98.0%               |
| 0.70                   | 89.1%     | 49          | 98.0%               |
| 0.75                   | 89.1%     | 49          | 98.0%               |
| 0.80                   | 87.3%     | 48          | 97.9%               |
| 0.85                   | 85.5%     | 47          | 97.9%               |
| 0.90                   | 85.5%     | 47          | 97.9%               |
| 0.95                   | 81.8%     | 45          | 97.8%               |

**Umbral sugerido para exactitud >= 95%:** `0.50` (cobertura 92.7%, n = 51).

### Cobertura vs exactitud de `clave` (sin matemática)

| Umbral (confidence >=) | Cobertura | n cubiertos | Exactitud cubiertos |
| ---------------------- | --------- | ----------- | ------------------- |
| 0.50                   | 97.7%     | 42          | 100.0%              |
| 0.55                   | 97.7%     | 42          | 100.0%              |
| 0.60                   | 97.7%     | 42          | 100.0%              |
| 0.65                   | 97.7%     | 42          | 100.0%              |
| 0.70                   | 97.7%     | 42          | 100.0%              |
| 0.75                   | 97.7%     | 42          | 100.0%              |
| 0.80                   | 95.3%     | 41          | 100.0%              |
| 0.85                   | 93.0%     | 40          | 100.0%              |
| 0.90                   | 93.0%     | 40          | 100.0%              |
| 0.95                   | 88.4%     | 38          | 100.0%              |

**Umbral sugerido para exactitud >= 95%:** `0.50` (cobertura 97.7%, n = 42).

### Noul vs veredicto guardado del juez LLM

Solo los 15 ítems generados con `quality_report`. El juez LLM no es verdad: esto mide acuerdo, no exactitud. Corte de P(sí) en 0.5.

| Pregunta Jev                    | n   | LLM dijo sí | Acuerdo | P(sí) media si LLM=sí | P(sí) media si LLM=no |
| ------------------------------- | --- | ----------- | ------- | --------------------- | --------------------- |
| respuesta_unica ↔ uniqueCorrect | 15  | 15/15       | 100.0%  | 0.94                  | —                     |
| factual ↔ factual               | 15  | 15/15       | 100.0%  | 0.74                  | —                     |
| habilidad ↔ skillMatch          | 15  | 15/15       | 100.0%  | 0.94                  | —                     |

`clave` de Jev = `derivedAnswer` del juez LLM en 15/15 ítems.

### Distribución de los Noul en todos los ítems

Los ítems del banco son oficiales y se asumen válidos (clave única, sin errores): una P(sí) baja ahí sugiere falsos rechazos, pero no hay verdad etiquetada para estos Noul.

| Pregunta        | Grupo      | n   | P(sí) media | P(sí) p10 | P(sí) mín | % con P(sí) >= 0.5 |
| --------------- | ---------- | --- | ----------- | --------- | --------- | ------------------ |
| respuesta_unica | matemática | 12  | 0.84        | 0.64      | 0.63      | 100.0%             |
| respuesta_unica | resto      | 43  | 0.88        | 0.75      | 0.56      | 100.0%             |
| factual         | matemática | 12  | 0.72        | 0.43      | 0.38      | 83.3%              |
| factual         | resto      | 43  | 0.69        | 0.47      | 0.29      | 88.4%              |
| habilidad       | matemática | 12  | 0.89        | 0.82      | 0.77      | 100.0%             |
| habilidad       | resto      | 43  | 0.91        | 0.84      | 0.79      | 100.0%             |

### Latencia, tokens y costo

| Set      | Llamadas | Latencia p50 (ms) | Latencia p95 (ms) | Tokens entrada | Tokens salida | Costo USD |
| -------- | -------- | ----------------- | ----------------- | -------------- | ------------- | --------- |
| remedial | 55       | 309               | 736               | 56048          | 5397          | 0.002354  |

## Taxonomía (`hierarchicalChoice`)

n = 87 tareas (ítem × dimensión) sobre 40 ítems; errores: 0. Se desciende siempre hasta la hoja (`minConfidence = 0`) y los umbrales se simulan cortando en el primer nivel con confianza menor.

Instrucciones usadas (una por tipo de hoja, igual en todos los niveles):

- `dia:descriptor`, `mineduc:learning_objective`, `paes:axis`: «¿Qué opción corresponde al contenido curricular que evalúa la `pregunta`?»
- `mineduc:skill`, `paes:skill`: «¿Qué opción corresponde a la habilidad que evalúa la `pregunta`?»
- `mineduc:text_type`: «¿Qué opción corresponde al tipo de texto del `pasaje`?»

### Hoja final vs tags humanos (sin umbral)

| Dimensión                  | n   | Hoja = tag humano | Todos los niveles en el camino correcto hasta el penúltimo |
| -------------------------- | --- | ----------------- | ---------------------------------------------------------- |
| dia:descriptor             | 8   | 37.5%             | 37.5%                                                      |
| mineduc:learning_objective | 8   | 37.5%             | 37.5%                                                      |
| mineduc:skill              | 9   | 66.7%             | 100.0%                                                     |
| mineduc:text_type          | 5   | 100.0%            | 100.0%                                                     |
| paes:skill                 | 31  | 71.0%             | 100.0%                                                     |
| paes:axis                  | 26  | 73.1%             | 100.0%                                                     |
| TODAS                      | 87  | 66.7%             | 88.5%                                                      |
| Matemática                 | 22  | 72.7%             | 90.9%                                                      |
| Resto                      | 65  | 64.6%             | 87.7%                                                      |

### Si el producto corta el descenso en un umbral

"Coincide" = la hoja es un tag humano, o se detuvo antes y todo el camino recorrido es ancestro de un tag humano.

| Umbral | Hoja correcta | Hoja incorrecta | Detenido, camino correcto | Detenido, camino incorrecto | Sin decisión | Coincide |
| ------ | ------------- | --------------- | ------------------------- | --------------------------- | ------------ | -------- |
| 0.00   | 66.7%         | 33.3%           | 0.0%                      | 0.0%                        | 0.0%         | 66.7%    |
| 0.50   | 63.2%         | 25.3%           | 10.3%                     | 1.1%                        | 0.0%         | 73.6%    |
| 0.60   | 59.8%         | 24.1%           | 13.8%                     | 1.1%                        | 1.1%         | 73.6%    |
| 0.70   | 51.7%         | 19.5%           | 23.0%                     | 3.4%                        | 2.3%         | 74.7%    |
| 0.80   | 47.1%         | 17.2%           | 29.9%                     | 3.4%                        | 2.3%         | 77.0%    |
| 0.90   | 37.9%         | 13.8%           | 40.2%                     | 3.4%                        | 4.6%         | 78.2%    |

### Calibración por nivel (decisiones con más de una opción y prefijo correcto)

| Tramo de confianza | n   | % del total | Exactitud | Confianza media |
| ------------------ | --- | ----------- | --------- | --------------- |
| [0, 0.5)           | 9   | 4.8%        | 33.3%     | 0.42            |
| [0.5, 0.7)         | 14  | 7.4%        | 78.6%     | 0.62            |
| [0.7, 0.85)        | 11  | 5.9%        | 63.6%     | 0.79            |
| [0.85, 0.95)       | 25  | 13.3%       | 76.0%     | 0.91            |
| [0.95, 1]          | 129 | 68.6%       | 92.2%     | 0.99            |

| Umbral (confidence >=) | Cobertura | n cubiertos | Exactitud cubiertos |
| ---------------------- | --------- | ----------- | ------------------- |
| 0.50                   | 95.2%     | 179         | 87.2%               |
| 0.55                   | 94.7%     | 178         | 87.1%               |
| 0.60                   | 93.1%     | 175         | 86.9%               |
| 0.65                   | 89.9%     | 169         | 88.2%               |
| 0.70                   | 87.8%     | 165         | 87.9%               |
| 0.75                   | 87.2%     | 164         | 87.8%               |
| 0.80                   | 84.6%     | 159         | 88.7%               |
| 0.85                   | 81.9%     | 154         | 89.6%               |
| 0.90                   | 77.7%     | 146         | 89.7%               |
| 0.95                   | 68.6%     | 129         | 92.2%               |

**Umbral sugerido para exactitud >= 95%:** ninguno de los umbrales 0.50–0.95 lo alcanza con n >= 10.

### Latencia, tokens y costo

| Set       | Llamadas | Latencia p50 (ms) | Latencia p95 (ms) | Tokens entrada | Tokens salida | Costo USD |
| --------- | -------- | ----------------- | ----------------- | -------------- | ------------- | --------- |
| taxonomía | 203      | 301               | 432               | 159695         | 11587         | 0.006707  |

## Total

| Set   | Llamadas | Latencia p50 (ms) | Latencia p95 (ms) | Tokens entrada | Tokens salida | Costo USD |
| ----- | -------- | ----------------- | ----------------- | -------------- | ------------- | --------- |
| todos | 258      | 304               | 453               | 215743         | 16984         | 0.009061  |
