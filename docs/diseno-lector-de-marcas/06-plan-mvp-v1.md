# 06 · Plan — MVP y v1

---

## El propósito del MVP

El MVP no existe para tener una feature: existe para **responder una pregunta con un número**.
La pregunta es *"¿el lector lee bien?"*, y hoy no hay forma de contestarla.

### Criterio de aceptación

Sobre un conjunto de oro de **300 hojas rendidas de verdad** —transcritas a mano, con su
etiqueta correcta, cubriendo escáner y celular—:

| Métrica | Umbral |
|---|---|
| Marcas leídas correctamente | **≥ 99,0 %** |
| Marcas enviadas a revisión | **≤ 3 %** |
| **Marcas incorrectas decididas con confianza alta** | **0** |

**La tercera cifra es la que importa.** Un error que el sistema declara dudoso cuesta treinta
segundos de un profesor. Uno que declara seguro le cambia la nota a un alumno y nadie se entera.

Un resultado de 97% correctas con 0 errores confiados **aprueba**. Un 99,5% con 3 errores
confiados **no aprueba**: significa que el clasificador no sabe cuándo no sabe, y ese es el
único defecto que la cola de revisión no puede compensar.

---

## Alcance del MVP

### Incluye

- Los 21 componentes marcados MVP en [04-componentes.md](04-componentes.md).
- Tipos de ítem: `multiple_choice` y `true_false` **solamente** ([D14](01-decisiones.md#d14)).
- Hoja pre-impresa por alumno con QR, más hojas de reserva ([D5](01-decisiones.md#d5), [G8](02-gaps.md#g8)).
- Un solo pipeline con `CaptureProfile` para escáner y celular ([D2](01-decisiones.md#d2)).
- Cola de revisión completa y operable.
- El conjunto de oro como entregable versionado.

### Deja fuera a propósito

| Fuera | Entra por |
|---|---|
| Numérico en grilla | [D10](01-decisiones.md#d10) |
| Desarrollo por LLM | [D10](01-decisiones.md#d10) |
| Hoja genérica con burbujas de RUT | [D4](01-decisiones.md#d4) |
| Múltiples formas por instrumento (A/B) | [D6](01-decisiones.md#d6) |
| Captura desde la cámara del navegador | [D3](01-decisiones.md#d3) |
| Calibración del umbral por organización | [D8](01-decisiones.md#d8) + [D11](01-decisiones.md#d11) |

Ninguno de estos requiere volver a tocar el pipeline. Es lo que hace que dejarlos fuera sea
acotar el alcance y no acumular deuda.

---

## Olas del MVP

| Ola | Alcance | Termina cuando | Semanas |
|---|---|---|---|
| **O0** | Congelar `LayoutSpec`, `ScanResult`, el hash y el contrato HTTP. Esqueleto del servicio Python desplegado | Los contratos están en `packages/types` y el servicio responde a una llamada de prueba | 1 |
| **O1** | Tablas + RLS + `SheetLayoutService` + `SheetPrintService` + diseñador | Sale un PDF imprimible cuyas burbujas caen donde el spec dice (test de ida y vuelta verde) | 2–3 |
| **O2** | Pipeline de visión completo: `PageSource`, `Rectifier`, `QualityGate`, `MarkClassifier` | Una hoja escaneada de verdad produce un `ScanResult` correcto | 3 |
| **O3** | `SheetScanService`, identidad, adaptador, cola de revisión | Un lote sube, se corrige, se revisa y aparece en el dashboard | 2 |
| **O4** | **Conjunto de oro y medición.** Papel de verdad, impresoras de verdad | Las tres cifras del criterio están medidas y publicadas | 2 |

**Total: 10–11 semanas de un desarrollador.** Un MVP demostrable (sin O4) en 6–8.

### O0 es la ola que evita los bugs caros

Los contratos de [03-contratos.md](03-contratos.md) se congelan **antes** de que se escriba
código que los consuma. Tres componentes escritos por separado —diseñador, impresor, lector—
comparten el `LayoutSpec`; si deriva, los tres funcionan y el sistema no.

> Este proyecto ya tiene la lección escrita: *"los peores bugs quedan ENTRE tareas, no dentro"*
> (`feedback-agentes-decisiones-compartidas`). Fijar las semánticas compartidas antes de
> despachar es la contramedida.

### O4 es la ola que no se salta

Es la única que produce evidencia. Sin ella no hay MVP: hay una demo. Y por tratarse de un
producto físico, cada defecto encontrado después de O4 se paga en papel ya impreso y ya rendido
por alumnos.

**Composición del conjunto de oro:**

| Corte | Hojas |
|---|---|
| Escáner con ADF, hojas planas | 100 |
| Foto de celular, condiciones buenas | 100 |
| Foto de celular, condiciones malas (sombra, ángulo, arruga) | 50 |
| Casos sucios deliberados (doble marca, marca borrada, hoja en blanco) | 50 |

Cada hoja con su transcripción manual verificada por dos personas. Versionado en el repo junto
a los fixtures del clasificador.

---

## v1 productiva

Todo lo de abajo entra por un punto de extensión que el MVP ya dejó abierto. **Ninguno requiere
volver a tocar el pipeline.**

| Incremento | Entra por | Qué habilita | Semanas |
|---|---|---|---|
| **Campos numéricos en grilla** | D10 · registrar `DigitGridReader` | Buena parte de Matemática sin salir del terreno determinístico. Sin LLM, sin costo por hoja | 1–2 |
| **Respuestas de desarrollo** | D10 · `CropRegionReader` + módulo `llm` existente | El recorte va a Gemini con la rúbrica del ítem. Escribe `ai_score`; el humano aprueba (§8.3). El esquema `responses` ya lo soporta | 2 |
| **Hoja genérica con RUT** | D4 · `RutBubbleResolver` | Elimina la logística de imprimir por curso. Reusa `normalizeRut` | 1 |
| **Captura desde el navegador** | D3 · `PageSource` de cámara | El profesor fotografía y ve el resultado al instante. La compuerta de calidad ya existe: aquí se muestra **antes** de aceptar la foto | 2 |
| **Umbral calibrado por organización** | D8 + D11 · la evidencia acumulada | Cada colegio angosta su banda de revisión con sus propios datos | 1 |
| **Formas múltiples (A/B)** | D6 · el layout ya es versionado | Anti-copia. Se apoya en `assessment_forms`, que ya existe en el esquema | 2 |
| **Endurecimiento operativo** | — | Retención y borrado (D18), métricas de precisión por colegio, reintentos, límites de tamaño de lote | 2 |

**Total v1: 11–12 semanas adicionales.** Acumulado desde cero: 14–17 semanas para el módulo
completo en producción.

---

## Riesgos vivos

| Riesgo | Por qué duele | Cómo se apaga |
|---|---|---|
| **Corrección silenciosamente corrida** | Afecta al curso completo y nadie lo nota hasta que un apoderado reclama | D6 + G1: hash en el QR, verificación obligatoria, rechazo del lote entero. **Es el riesgo número uno del módulo** |
| **El colegio abandona la cola de revisión** | Un lote a medio revisar es peor que no tener el módulo: datos incompletos que parecen completos | La cola se diseña para velocidad, no para completitud. Confirmar con pendientes está permitido y queda registrado con autor |
| **La foto de celular resulta peor de lo estimado** | Se descubre en O4, con la mayor parte del trabajo hecha | D2: un solo pipeline. Si el celular no da, el escáner funciona igual con el mismo código. El producto no se cae, se acota |
| **El conjunto de oro nunca se construye** | Es trabajo manual aburrido y siempre hay algo más urgente. Sin él, la validación es una opinión | O4 es entregable con criterio numérico, no una tarea de calidad opcional |
| **Deriva entre los tres consumidores del spec** | Diseñador, impresor y lector se escriben por separado y las coordenadas dejan de calzar | Un solo `LayoutSpec` en `packages/types`, congelado en O0, con test de ida y vuelta impresión ↔ lectura |
| **El servicio Python queda huérfano** | Otro despliegue que mantener, en un lenguaje que el resto del equipo no toca | Sin estado, un solo endpoint, contrato versionado. Reemplazable sin tocar la API porque el acceso pasa por el puerto `OmrClient` |

---

## Dependencias externas

| Qué | Dónde | Estado |
|---|---|---|
| Contenedor ECR para el servicio de visión | `sst.config.ts` | Por agregar (el patrón ya existe para el backend) |
| `pdf-lib` en `apps/api` | `apps/api/package.json` | Por agregar |
| Bucket S3 | Módulo `files` existente | Listo |
| `SHEET_REVIEW_ROLES` | `packages/types/src/access-policies/sheet-scanning.ts` | Por crear |
| Política RLS | `packages/db/sql/rls-policies.sql` | Por agregar (6 tablas) |
