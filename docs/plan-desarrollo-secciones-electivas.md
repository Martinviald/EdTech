# Plan de desarrollo — Secciones electivas

> Ejecución de `docs/diseno-secciones-electivas.md` (v2, post-auditoría). El orden **no es
> negociable**: la etapa 1 es precondición de todo lo demás porque sin ella cualquier carga
> sobre un instrumento con secciones electivas produce datos falsos **sin ningún error**.
>
> Regla de oro del repo: rama nueva por PR, y una PR mergeada está cerrada para trabajo nuevo.

---

## Antes de escribir código: 3 decisiones de producto

Ninguna es técnica y **todas bloquean** la etapa que se indica. Pedirlas juntas.

| # | Decisión | Bloquea | Opciones |
|---|---|---|---|
| P1 | **Alumno sin forma asignada**: ¿se rechaza su hoja, queda en cola de revisión, o se infiere? | Etapa 3 | Recomendado: **cola de revisión**, igual que las identidades sin resolver del lector. Nunca inferir en silencio. |
| P2 | **`imageRef` acoplado a la posición**: ¿re-subir las 330 figuras con key nueva, o desacoplar la key del `position`? | Etapa 6 | Recomendado: **desacoplar** (usar `printedNumber` + sección, o un id estable). Re-subir repite la deuda. |
| P3 | **La matrícula del electivo**: ¿de dónde sale qué mención cursa cada alumno? | Etapa 3 | Hoy no existe en ninguna fuente. Hay que pedirla a UTP. Sin esto la etapa 3 se implementa pero no se puede poblar. |

---

## Etapas

Cada etapa es **una rama y una PR**. Las que se pueden paralelizar están marcadas.

### Etapa 1 — La ingesta itera por forma, no por instrumento 🔴 precondición

**Por qué primero:** `answer-sheets.service.ts:345` crea una `response` por cada ítem del
instrumento, con 0 para los no respondidos. Con secciones electivas eso fabrica respuestas
fantasma. Hoy es inocuo (todos los instrumentos se rinden enteros); mañana no.

- Introducir `resolveItemsForStudent(assessment, student)` que devuelva los ítems de las
  secciones que le corresponden: **todas las `core` + la `elective` de su forma**.
- Sin forma asignada y sin secciones electivas ⇒ **todos los ítems** (comportamiento actual,
  bit a bit).
- Aplicar en los 3 escritores: `answer-sheets.service.ts`, `import-dia-responses.ts:234`,
  `import-paes-2026-responses.ts:639`. Este último tiene además un gate que compara posiciones
  del instrumento contra la planilla (`:598-605`): pasa a comparar contra las de la forma.
- **Gate de regresión:** los 1.236 tests de backend en verde, y una carga real de un
  instrumento sin electivas (ej. CL E1) debe producir **exactamente** las mismas filas que hoy.

### Etapa 2 — Rol de sección en columnas tipadas

- Migración: `section_role` enum (`core`|`elective`), y en `instrument_sections` las columnas
  `role` (default `core`), `elective_group`, `elective_key`, más un `CHECK`
  (`role='elective'` ⇒ `elective_group` y `elective_key` no nulos).
- Zod en `packages/types`; el tipo `Section` del importador aprende `role`/`electiveGroup`/
  `electiveKey` y los persiste (`import-instruments.ts:501`, que hoy los descarta junto con
  `config`, `max_points` y `org_id`).
- Regla de validación en el Service: *todas las `core` + exactamente una por `elective_group`*.
- **Inerte por diseño:** con default `core`, los 23 instrumentos existentes no cambian.
- **Gate:** `pnpm --filter @soe/db typecheck` y los tests del importador; un re-import de un
  instrumento cualquiera produce el mismo árbol.

### Etapa 3 — Forma del alumno 🔴 bloqueada por P1 y P3

- `assessment_forms` gana `org_id NOT NULL` (hoy no lo tiene) y `section_ids uuid[]`.
- Tabla `assessment_form_students` (`org_id`, `assessment_form_id`, `student_id`, unique).
- **Política RLS** para la tabla nueva en `packages/db/sql/rls-policies.sql` — y de paso para
  `assessment_forms`, que hoy es un hueco. Sin esto, dato personal sin aislamiento.
- Estampar `responses.form_id` (la columna ya existe, 0 filas en uso) al crear respuestas.
- Camino de carga de la matrícula del electivo (P3).
- **Gate:** un test que verifique que sin `withOrgContext` la tabla devuelve 0 filas.

### Etapa 4 — Migrar el matching de tags a `printedNumber` 🔴 antes de renumerar

`import-item-tags.ts:39` empareja por `(sourceJson, position)`. Si se renumera, aplica los tags
**al ítem equivocado sin detectarlo**.

- Cambiar la clave a `(sourceJson, printedNumber)`; si un instrumento no tiene `printedNumber`,
  caer a `position` con aviso explícito.
- **Gate:** re-aplicar el plan actual sobre los 23 instrumentos debe dar **exactamente los
  2.658 tags de hoy**, sin diferencias.

### Etapa 5 — Resolver las divergencias de E1 y E4 (trabajo de datos, paralelizable)

En E1 hay 3 ítems comunes que no calzan entre cuadernillos y en E4 hay 1 (§4.2 del diseño). No
son preguntas distintas: es la misma en otra posición, y con el texto extraído levemente
distinto.

- Contrastar cada caso contra el PDF y elegir la versión canónica.
- Reusar `mapear_comun_cie.py` (empareja por enunciado, validado 53/53 contra T1) y las
  columnas `N°B`/`N°F`/`N°Q` de la Tabla de especificaciones de la Tanda 1.
- **Entregable:** el mapa `(ensayo, mención, posición) → ítem canónico` de los 3 ensayos.
- **Gate:** el mapa cubre las 54 comunes de cada ensayo, sin ambigüedad.

### Etapa 6 — Re-extraer e importar Ciencias como 3 instrumentos 🔴 necesita 4 y 5

- `merge_pauta_cie.py` emite **un JSON por ensayo** con 4 secciones (común + 3 menciones) en
  vez de 3 JSON de 80.
- Borrar los 9 antiguos (verificado: sin respuestas, assessments, layouts ni bandas colgando).
- Re-subir o re-mapear las **330 figuras** según P2.
- Re-aplicar los tags con el matching de la etapa 4.
- **Gate:** 3 instrumentos, ~131/132/128 ítems, cada común una sola vez; el conteo de tags
  cuadra; las 330 figuras resuelven a un objeto que existe en S3 (round-trip en los dos
  sentidos, como se hizo con las 574 actuales).

### Etapa 7 — `studentCount` al grano (curso, ítem)

`item-stats-calculator.ts` define `studentCount` como el N de la cohorte del curso, *"constante
entre los ítems de un mismo curso"*. Con electivas reportaría 80 donde respondieron 26.

- Llevarlo a `(curso, ítem)`, o a `(curso, sección)` si alcanza.
- Revisar los consumidores que hacen `max(student_count)`: `cohort-item-stats.helper.ts:62,122`,
  `item-analysis.service.ts:920,929`, y el `max()` de `deriveSkillStatsFromItemStats`.
- **Gate:** para un instrumento sin electivas, los stats no cambian ni un decimal.

### Etapa 8 — Layout del lector por forma (independiente, paralelizable)

- `sheet_layouts` gana `assessment_form_id`; relajar `instrument_id`; rehacer el unique
  `(org_id, instrument_id, version)`.
- `LayoutSpec` gana `formId`. ⚠️ **Decidir si entra al `layoutHash`**: cambiar el hash invalida
  todo layout ya congelado. Recomendado: entra, y los layouts existentes se versionan.
- Parametrizar `loadDerivableItems` y el **invariante 4** (biyección exacta layout↔ítems, que
  con un subconjunto electivo falla hoy).
- Ajustar `SheetPrintService.requireRunForm`, que valida `form.instrumentId === layout.instrumentId`.
- **Gate:** congelar un layout de una forma de 80 ítems (2 páginas) y que la tirada valide.

---

## Orden y paralelismo

```
1 ──▶ 2 ──▶ 3        (3 bloqueada por P1 y P3)
      │
      └──▶ 4 ──┐
               ├──▶ 6 ──▶ 7
         5 ────┘
      8   (independiente, en cualquier momento tras 2)
```

**Lo que desbloquea la carga de los ~430 escaneos de Ciencias es 1→6.**

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La etapa 1 cambia el escritor más crítico del sistema | Comportamiento idéntico cuando no hay electivas; regresión contra una carga real |
| Renumerar rompe tags y figuras en silencio | Etapas 4 y 5 son precondición de la 6, con gates de conteo |
| Cambiar el `layoutHash` invalida layouts congelados | Decisión explícita en la etapa 8; hoy hay 3 layouts, todos de prueba |
| El re-import borra los 1.399 tags de Ciencias | Se reaplican desde el plan; el gate compara el conteo antes y después |
| P3 nunca llega (no hay matrícula del electivo) | Las etapas 1, 2 y 4-7 no dependen de ella; sólo la 3 queda a la espera |

---

## Lo que NO entra

- **Equating entre menciones.** Dos alumnos de menciones distintas rinden pruebas distintas y
  no hay equating en el código. Clasificar a ambos con las mismas `performance_bands` asume una
  equivalencia que nadie midió. Fuera de alcance, y hay que dejar de venderlo como resuelto.
- **% de logro por sección.** No existe hoy y no lo necesita ninguna de las etapas.
- **M2 de la PAES.** Es una prueba electiva aparte, no una sección de otra. No aplica.
