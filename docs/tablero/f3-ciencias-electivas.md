# F3 — Ciencias a secciones electivas

Registro de las fases F3b (figuras) y F3c (fusión y re-mapeo) del plan
(`docs/plan-desarrollo-tablero-procesos-pruebas.md`). F3a (ítems faltantes de E1 y E4) entra en
los mismos commits de datos. **Reemplaza los pasos de `docs/runbook-migracion-ciencias-electivas.md`**,
que suponían instrumentos sin respuestas.

## Qué quedó

| Pieza                                                                                        | Archivo                                                                                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 9 JSON por mención, con los 8 ítems de F3a y las 330 storage keys de sus figuras             | `packages/db/data/instruments-paes/CIE/CIE-E{1,3,4}-{BIO,FIS,QUI}-con-pauta.json`                         |
| 3 instrumentos fusionados (54 común + 3 × 26 = 132 ítems)                                    | `packages/db/data/instruments-paes/CIE/CIE-E{1,3,4}-fusionado.json`                                       |
| Mapa legacy → fusionado (por ensayo: qué JSON es cada rama y a qué ítem va cada ítem legacy) | `packages/db/data/instruments-paes/cie-electivas-mapa.json`                                               |
| Generador de los dos anteriores + gate de figuras                                            | `scripts/paes-2026/fusionar_cie_electivas.py` (usa `mapear_comun_cie.py`, copiado de `ensayos-paes/`)     |
| Script de migración (genérico, dry-run por defecto, `--commit`, `--rollback`)                | `packages/db/src/scripts/migrate-elective-sections.ts` → `pnpm --filter @soe/db db:migrate:cie-electivas` |
| Lógica pura y sus tests (emparejamiento, formas, agrupación, recálculo, unión de tags)       | `packages/db/src/lib/elective-migration.ts` + `.spec.ts`                                                  |
| El importador acepta documentos ya leídos dentro de otra transacción                         | `importInstrumentDocuments` en `packages/db/src/seed/import-instruments.ts`                               |

### Regenerar los fusionados

```bash
python3 scripts/paes-2026/fusionar_cie_electivas.py
```

Lee los 9 JSON por mención y reescribe los 3 fusionados y el mapa. Sale con código 1 si algún
ensayo no da 54 + 3 × 26 o si el gate de figuras no cierra. El contenido y el emparejamiento del
común son idénticos a los de la fusión de F3a (`fusionar_cie.py` de `ensayos-paes/`): 162 de 162
pares por ensayo y los mismos enunciados y claves en las 396 posiciones.

Forma de los fusionados:

- Instrumento con `track: "CIE-COMUN"` y `sourceJson` = `CIE-E{n}-fusionado.json`.
- Sección `Módulo común`, `role: core` y **sin** `track` (lo hereda del instrumento, según el CHECK
  de F2). Es canónica en Biología: Física y Química se emparejan por enunciado, porque en E1 el
  común está en otro orden en cada cuadernillo.
- Secciones `Mención Biología/Física/Química`, `role: elective`, `electiveGroup: mencion-ciencias`,
  `electiveKey` y `track` `BIO`/`FIS`/`QUI`.
- `printedNumber` del común = el de Biología; el de cada mención = el de su cuadernillo (55–80).

## F3b — Figuras

La key ya era explícita en el ítem (`items.scoring_config.imageRef`) y la API la sirve por key
(`ItemsService.getFigure` → `FilesService.resolveByStorageKey`). Lo que estaba acoplado a la
posición era cómo se **generaba** la key. Con la fusión, cada ítem conserva **su key original**:
nunca se deriva de la posición nueva. Nada se re-sube.

Gate (sin S3), lo corre el generador:

|                                    | Keys                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| En los 9 JSON legacy               | 330 (todas `item/global/paes-cie-{men}-e{n}-2026/item_figure/{NN}.png` con `NN` = posición) |
| Referenciadas por los 3 fusionados | **180** (77 del común + 103 de las menciones)                                               |
| Copias del común deduplicadas      | 150 (la figura de Física/Química de un común cuya copia canónica ya tiene la suya)          |
| Perdidas · inventadas · repetidas  | 0 · 0 · 0                                                                                   |

No son 330 porque el común existía tres veces: un ítem común fusionado lleva **una** figura. Las
150 keys de las copias no canónicas siguen en S3, sin referencia. En 3 comunes la copia de Biología
no tenía figura y se usó la de Física: E1 #3 (`paes-cie-fis-e1-2026/…/21.png`), E1 #45
(`…/fis-e1-2026/…/45.png`) y E4 #28 (`…/fis-e4-2026/…/28.png`). Con eso quedan resueltas las
figuras del ítem de E1 #45 y E4 #28 que F3a dejó pendientes.

⚠️ Los JSON de `main` no traían las 330 keys (solo estaban en `feat/paes-m1e5-y-roster`, commit
`7c3b21b`, y en demo). Ahora sí; son las mismas que ya están cargadas en demo.

## F3c — Migración

```bash
DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:migrate:cie-electivas --org <uuid> [--commit]
DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:migrate:cie-electivas --org <uuid> --rollback [--commit]
```

Opcional: `--loadKey <clave>` (por defecto el del mapa, `paes-2026-cie`) y `--map <ruta>`. Usa
`NODE_ENV=production` para que el cliente no imprima cada query.

Todo corre en una transacción dentro de `withOrgContext`. El dry-run ejecuta la migración completa,
incluido el gate interno, y luego revierte.

1. Importa los fusionados que falten (o reactiva los que dejó un rollback) y verifica que el árbol
   (ítems por sección) calce con el JSON.
2. Agrupa las evaluaciones legacy del `loadKey` por (instrumento fusionado, curso) y crea o reusa
   **una evaluación fusionada por grupo**, con su `assessment_course_assignments`. Copia
   `administered_at`, `process_id` (aborta si las legacy están en procesos distintos), `ensayo` y
   `subject`. Le pone `config.loadKey = <loadKey>-electivas` y
   `config.electiveMigration = { sourceLoadKey, legacyAssessmentIds: {BIO, FIS, QUI} }`.
3. Crea una `assessment_forms` por rama (`section_ids` = común + esa rama) y asigna a cada alumno
   la forma de la evaluación legacy donde tiene respuestas. La mención salió de `stats.version`
   de GradeCam al cargar. Si un alumno tiene respuestas en dos ramas, aborta.
4. Re-apunta cada `response` (`assessment_id`, `item_id`, `form_id`). Usa el mapa: el ítem legacy
   (rama, número impreso) va al ítem fusionado (sección, número impreso). No crea ni borra
   respuestas, y los 8 ítems nuevos de F3a quedan sin respuestas.
5. Copia a cada ítem fusionado la unión de los tags de sus ítems legacy; los tags legacy no se
   tocan. Solo 1 de 162 comunes difería entre copias (E1 #3: Biología con 2 tags, las otras sin
   tags).
6. Recalcula `assessment_results`, `skill_results`, `assessment_item_stats` y
   `assessment_skill_stats`. Usa la semántica de los cargadores de seed: escala por defecto y
   pendientes fuera del total. Conserva `completed_at`. El % de las habilidades pasa por la columna,
   como en `db:backfill:cohort-stats`. En las evaluaciones legacy borra los derivados (quedan sin
   respuestas).
7. Marca las legacy `status = cancelled` con `config.electiveMigration = { supersededBy,
previousStatus }` (la tabla `assessments` no tiene `deleted_at`) y hace soft delete de los 9
   instrumentos legacy.
8. Gate interno: por alumno, el puntaje, el máximo, el %, la nota y la completitud son iguales a los
   del legacy. Además verifica que no queden respuestas en las legacy, que el total no cambie y que
   no haya respuestas ni alumnos sin forma. Si algo falla, revierte.

`--rollback` devuelve cada respuesta a su evaluación e ítem legacy. Lo hace por construcción:
rama del alumno + inverso del mapa, que el script exige inyectivo. Además borra las evaluaciones
fusionadas con sus formas, alumnos por forma, cursos y derivados (no les quedan respuestas),
restaura `status` y `config` de las legacy, las recalcula, reactiva los instrumentos legacy y hace
soft delete de los fusionados. Los tags de los ítems fusionados se quedan, sobre instrumentos
borrados.

Después de migrar, el cargador `import-paes-2026-responses.ts` ya no encuentra los instrumentos
legacy (están borrados) y aborta: para recargar un lote migrado, primero se deshace.

## Gate sobre `soe_tablero` (2026-10-05)

| Verificación                                               | Resultado                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluaciones                                               | 26 legacy (E1: 8, E3: 9, E4: 9) → 9 fusionadas (3 ensayos × IV°A/B/C)                                                                                                                                                                                                           |
| Alumnos por mención                                        | E1 41/30/5 · E3 30/29/8 · E4 34/29/9 (BIO/FIS/QUI) = 76 + 67 + 72 = 215                                                                                                                                                                                                         |
| % de logro, puntaje, máximo, nota y completitud por alumno | **215/215** idénticos (gate interno + foto externa por (ensayo, alumno))                                                                                                                                                                                                        |
| Respuestas                                                 | 17.014 antes y después · 0 huérfanas (ítem de otro instrumento, instrumento borrado o sin forma)                                                                                                                                                                                |
| Alumnos sin forma                                          | 0 · 27 formas · 215 `assessment_form_students`                                                                                                                                                                                                                                  |
| `assessment_item_stats` por mención                        | En los 27 (curso, mención), `response_count` = `student_count` = alumnos de la mención, en todos sus ítems                                                                                                                                                                      |
| `assessment_item_stats` del común                          | `n` = cohorte completa del curso en 53/54 ítems de E1, 53/54 de E4 y 54/54 de E3. Las 2 excepciones son ítems nuevos de F3a: E1 #45 (sin respuestas de Biología) y E4 #28 (solo Física)                                                                                         |
| Líneas                                                     | Instrumentos `CIE-COMUN`, común sin línea, ramas `BIO`/`FIS`/`QUI` (la FK compuesta acepta `CIE-COMUN`: es de SCI, como el instrumento)                                                                                                                                         |
| Segunda corrida con `--commit`                             | 0 cambios: hash idéntico de las 13 tablas relevantes                                                                                                                                                                                                                            |
| `--rollback --commit`                                      | Firma idéntica a la copia previa en resultados, habilidades, `assessment_item_stats`, `assessment_skill_stats`, respuestas (salvo `updated_at`), `assessments`, cursos, instrumentos activos y tags activos. Después se volvió a migrar sin problemas (reactiva los fusionados) |
| RLS                                                        | Como `soe_app`: 0 filas sin contexto, 215 / 27 con el de CSCJ                                                                                                                                                                                                                   |

`soe_tablero` queda **migrado**.

## Pendientes registrados

**Ítems sin respuestas.** Los 8 ítems de F3a no se respondieron en la carga legacy. Se pueden
cargar desde GradeCam en otra tarea: la hoja COMÚN usa la numeración de Biología y la de MENCIÓN,
la del cuadernillo.

- Sin ninguna respuesta: E1 Biología #58, E4 Biología #58, E4 Química #57, #60 y #66.
- Comunes con respuestas parciales: E1 #45 (sin las de Biología) y E4 #28 (sin las de Biología y
  Química).

**Respuestas vacías heredadas.** El conversor (`scripts/paes-2026/cie_a_artefacto.py`) empareja el
común por enunciado **exacto** y no encontró par para cuatro ítems. Esas respuestas quedaron en
blanco y puntuaron 0. Siguen así; recargarlas cambiaría puntajes ya publicados.

| Común fusionado | Copia legacy            | Respuestas en blanco |
| --------------- | ----------------------- | -------------------- |
| E1 #26          | Física #8               | 30                   |
| E1 #45          | Física #45 y Química #9 | 30 y 5               |
| E4 #28          | Física #28              | 29                   |

**Tags.** 14 ítems fusionados no tienen tags: los 5 nuevos sin copia legacy, el común E4 #28 (su
única copia legacy, Física #28, no tenía tags) y 8 que ya venían sin tags en el plan (E1 común #38, E1 Física #68, E1 Química #55, E3 común #9 y #10, E4 Biología #65 y
#80, E4 Física #67).

**Figuras.** Siguen pendientes los recortes por alternativa A–E de E1 #45 y el modelo atómico de
E4 Química #60. Las de E1 #45 (figura del ítem) y E4 #28 se resolvieron con la key de Física.

**Claves fuera de alcance** (no se tocaron porque cambiarían puntajes ya corregidos):

- CIE-E4-FIS #28 tiene `correctKey: null`; GradeCam y la tabla dan B. En el fusionado manda la
  copia de Biología, que lleva B. Las 29 respuestas de Física están en blanco (ver arriba).
- CIE-E1-BIO #23 (D vs E en GradeCam) y #51 (A vs D) no coinciden con la hoja COMÚN v1. Hay que
  revisarlos contra el informe.
- CIE-E1-FIS #45 y CIE-E1-QUI #9 traen alternativas A–D reconstruidas; el PDF tiene A–E. En el
  fusionado manda la copia de Biología, con A–E.
- CIE-E4-BIO #57 y CIE-E4-QUI #65 tienen alternativas ilegibles; los dos son ítems con figura.

## Para F4, F5 y el runbook de demo

- **Modelo de Ciencias en el read-model:** 3 instrumentos `CIE-COMUN`, 4 secciones cada uno.
  `assessment_item_stats` ya tiene grano (curso, ítem): en un ítem de mención `student_count` y
  `response_count` son los alumnos de esa mención. La columna Común del tablero es
  `coalesce(section.track_id, instrument.track_id)` = `CIE-COMUN` sobre los ítems `core`. Las
  menciones son `BIO`/`FIS`/`QUI`. Por curso, `max(student_count)` del común da la cohorte completa.
- **Legacy:** las 26 evaluaciones viejas siguen en `assessments`, con `status = cancelled`, sin
  respuestas ni derivados y con instrumento borrado. Los lectores que ya filtran
  `instruments.deleted_at IS NULL` (el tablero maestro, el backfill de procesos) no las ven. Un
  lector nuevo debería filtrar igual, o por `status <> 'cancelled'`.
- **Golden del tablero:** sobre el banco migrado, Ciencias cambia de forma. `studentsAssessed` por
  (curso, SCI) pasa de la mención más grande a la cohorte completa (era el bug del modelo por
  mención). `score_sum` y `max_sum` por curso no cambian, porque son las mismas respuestas. Para
  comparar con `docs/golden/master-board-local.json` en estado legacy, usa
  `db:migrate:cie-electivas --rollback --commit` y vuelve a migrar después; las dos operaciones son
  exactas.
- **Procesos (F5):** las fusionadas conservan `config.ensayo` y `administered_at`. Su `loadKey` es
  `paes-2026-cie-electivas`, distinto del legacy, para que una recarga con `--prune` del cargador
  legacy no las toque. `db:backfill:processes` cuenta las 26 legacy como "sin curso asignado"
  porque excluye los instrumentos borrados. El mensaje confunde, pero no las vincula.
- **Demo (runbook F6):** antes de migrar, corre `db:seed:test-tracks` (crea `CIE-COMUN`, `BIO`,
  `FIS`, `QUI`) y verifica que existan el marco de taxonomía `paes 2026` y la matrícula del año.
  Después corre el dry-run y revisa que diga 26 legacy, 9 grupos y 215 alumnos idénticos (o los
  conteos de demo), y recién entonces `--commit`. Después no hace falta correr
  `db:backfill:cohort-stats`: el script ya recalcula.
