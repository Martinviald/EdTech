# 02 · Gaps del análisis de factibilidad

> El estudio de factibilidad identificó bien los subsistemas y los riesgos técnicos. Estos son
> los huecos que aparecieron al bajar al diseño detallado. Son los que producen bugs **entre**
> componentes, no dentro de ellos — el modo de falla que este proyecto ya documentó como el
> más caro (`feedback-agentes-decisiones-compartidas`).

---

<a id="g1"></a>

## G1 · El instrumento editado después de imprimir

**El escenario.** Un coordinador agrega un ítem el lunes. Las hojas se imprimieron el viernes.
El sistema corrige todo corrido un lugar y nadie se entera hasta que un apoderado reclama.

**Por qué es el riesgo número uno.** Es silencioso, afecta al curso completo, y el resultado
se ve perfectamente plausible: notas más bajas de lo esperado, que es exactamente lo que un
colegio espera de un diagnóstico.

**Resolución.** [D6](01-decisiones.md#d6): el hash canónico del `LayoutSpec` viaja en el QR y
se verifica al escanear. Un hash distinto **no baja la confianza: rechaza el lote completo**
con el motivo exacto. No hay corrección parcial ni degradación elegante — cualquiera de las
dos sería peor que fallar.

---

<a id="g2"></a>

## G2 · El alumno que rinde en la hoja de otro

**El escenario.** El QR dice Pérez; el nombre escrito arriba dice González. Pasa cuando se
reparten las hojas sin mirar, o cuando dos alumnos se sientan cambiados.

**Resolución.** El `SheetIdentityResolver` devuelve **candidato + confianza**, nunca una
identidad cerrada. El QR es una hipótesis fuerte, no una verdad: lo que el QR garantiza es la
*hoja*, no el *alumno*. La cola de revisión permite reasignar, y la reasignación queda auditada
con su autor.

---

<a id="g3"></a>

## G3 · "En blanco" y "no escaneado" son cosas distintas

**El escenario.** Hoy el pipeline las colapsa: ambas llegan como celda vacía y se puntúan 0.

**Por qué importa.** Es literalmente el error que el proyecto ya documentó dos veces:
- `feedback-desarrollo-sin-puntaje-es-sintoma` — el P18 "sin corregir" de 6° Matemática eran
  20 respuestas sin cargar por alumno, no ceros legítimos.
- `feedback-gradecam-status-review` — cargar un escaneo `review` con `questions_remaining > 0`
  registra al alumno como entregado en blanco.

**Resolución.** El `MarkState` los separa en el origen (`blank` vs. página ausente). Una página
faltante **bloquea el lote** y no se persiste como respuestas en blanco.

---

<a id="g4"></a>

## G4 · Instrumentos que no caben en una plana

**El escenario.** 60 ítems necesitan dos páginas, y una puede perderse en el taco del escáner
o quedar mal fotografiada.

**Resolución.** El `LayoutSpec` es multipágina desde el día uno. Cada página lleva su propio
QR con `pageIndex` y `pageCount`. Un escaneo incompleto es un estado explícito, no una hoja
con ceros en la segunda mitad.

---

<a id="g5"></a>

## G5 · No hay forma de medir si el lector funciona

**El escenario.** Sin verdad de referencia, "parece que anda bien" es todo lo que se puede
decir. Y es lo que se va a decir, porque construir la referencia es trabajo manual aburrido.

**Resolución.** El MVP construye un **conjunto de oro**: 300 hojas rendidas de verdad,
transcritas a mano, con su etiqueta correcta, cubriendo escáner y celular. Es un entregable
versionado con criterio numérico, no una tarea de calidad opcional. Ver
[ola O4](06-plan-mvp-v1.md#olas-del-mvp).

**Sin esto el MVP no valida nada: es una demo.**

---

<a id="g6"></a>

## G6 · Quién puede corregir en la cola de revisión

**El escenario.** Es una decisión de autorización que nadie tomó.

**Resolución.** Constante nueva `SHEET_REVIEW_ROLES` en
`packages/types/src/access-policies/sheet-scanning.ts` (un archivo por dominio, per
`.claude/rules/backend/05-rbac-guards.md`). Ver un escaneo con el nombre del alumno cae bajo
`SensitiveDataGuard`.

---

<a id="g7"></a>

## G7 · El re-escaneo del mismo alumno

**El escenario.** El profesor vuelve a pasar la hoja —arrugada, mal fotografiada, con una
pregunta de desarrollo ya corregida a mano— y aparecen dos verdades para el mismo alumno.

**Resolución.** [D13](01-decisiones.md#d13): idempotencia por `(printedSheetId, pageIndex,
imageHash)`. El escaneo nuevo reemplaza al anterior y el anterior queda **archivado, nunca
borrado**.

> Antecedente: `project-gradecam-barrido-carga` documenta que recargar un curso entero borra
> los puntajes de desarrollo ya corregidos. El reemplazo debe ser por hoja, no por lote.

---

<a id="g8"></a>

## G8 · La hoja de reserva

**El escenario.** Alumno nuevo, ausente que se recupera, hoja arruinada. Con hojas
pre-impresas por alumno, esta gente queda fuera del sistema.

**Resolución.** Cada tirada imprime `spareCount` hojas de reserva **sin identidad**. Entran
por `ManualIdentityResolver`: se escanean normal, sus marcas se leen igual, y quedan en la
cola esperando que un humano les ponga nombre.

---

## Tabla resumen

| ID | Gap | Resuelto por |
|---|---|---|
| G1 | Instrumento editado tras imprimir | D6 · hash en el QR, rechazo del lote |
| G2 | Alumno rinde en hoja ajena | D4 · candidato + confianza, nunca identidad cerrada |
| G3 | "En blanco" ≠ "no escaneado" | `MarkState` separado en el origen |
| G4 | Instrumentos multipágina | `LayoutSpec` multipágina, QR por página |
| G5 | Imposible medir precisión | Conjunto de oro como entregable de la ola O4 |
| G6 | Autorización de la cola | `SHEET_REVIEW_ROLES` + `SensitiveDataGuard` |
| G7 | Re-escaneo duplicado | D13 · idempotencia por hoja + página |
| G8 | Ausentes y alumnos nuevos | Hojas de reserva + `ManualIdentityResolver` |
