# Backport de la PR #275 a `dev`

Registro del backport de `feat/tablero-procesos-pruebas` (PR #275, contra `main`) a `dev`, en la
rama `backport/tablero-procesos-pruebas-dev`. Base: `origin/dev` en `ace3b0bd` (merge de #265,
que trajo `0038_handy_pretty_boy`). El worktree se creó sobre `878ac1a7` (#274) y se adelantó
por fast-forward a `ace3b0bd` antes del primer commit, porque `dev` ya había sumado la `0038`.

## Método

Nada se trajo con `git merge` ni `cherry-pick`. Por archivo:

| Situación del archivo en `dev`                                                      | Qué se hizo                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No existe, o es idéntico a `main` (base de la PR) o al estado portado en `0de7271d` | Se tomó la versión final de la rama fuente                                                                                                                                                                              |
| `dev` lo cambió por su cuenta                                                       | Merge de 3 vías: `dev` ← (base = `0de7271d`, el commit que portó procesos de `dev` a `main`) → rama fuente. Así solo se aplica lo que #275 agregó por encima del portado, y se conserva lo que `dev` evolucionó después |
| Migraciones `0034_lean_mindworm`, `0035_ordinary_wallop` y sus snapshots            | No se portaron. Se regeneró una sola migración sobre la cadena de `dev`                                                                                                                                                 |

Cuidado aplicado: lo que #275 agregó **antes** de `0de7271d` (banco de pruebas, slug parcial,
guarda de electivas en los cargadores) quedaba dentro de la base del merge y no se habría
aplicado. Se revisó archivo por archivo: faltaban los scripts `golden:master-board` y
`fixture:process-candidates` de `packages/db/package.json` (agregados a mano) y el índice
parcial del slug (se tomó `schema/measurement-processes.ts` de la rama fuente). La guarda de
electivas sobre `tx` llegó porque `import-dia-responses.ts` e `import-paes-2026-responses.ts`
no habían cambiado en `dev`.

## Migración `0039_soft_speedball`

Generada con `pnpm db:generate` sobre `0038_handy_pretty_boy`. Contiene exactamente el delta que
`dev` no tenía:

- `CREATE TABLE test_tracks` (`org_id` nullable, `UNIQUE(id, subject_id)`), FKs a
  `organizations` y `subjects`, y dos índices únicos parciales:
  `(subject_id, code) WHERE org_id IS NULL` y `(org_id, subject_id, code) WHERE org_id IS NOT
NULL` (compatible con PG 14, sin `NULLS NOT DISTINCT`).
- `instruments.track_id` + FK compuesta `instruments_track_subject_fk (track_id, subject_id)` +
  CHECK `instruments_track_requires_subject`.
- `instrument_sections.track_id` + FK + CHECK `instrument_sections_elective_requires_track` y
  `instrument_sections_track_only_elective`.
- `measurement_processes`: `DROP CONSTRAINT measurement_processes_org_slug_unique` y
  `CREATE UNIQUE INDEX measurement_processes_org_slug_active_uniq (org_id, slug) WHERE
deleted_at IS NULL`. En `dev` el slug era un constraint simple; el cambio solo relaja la
  unicidad (un borrado ya no bloquea su nombre), así que no puede fallar con datos existentes.

Es el mismo SQL de `0035_ordinary_wallop` de `main` más el cambio del slug, que en `main` venía
dentro de su `0034`. Antes de aplicarla en una BDD con datos, correr
`select count(*) from instrument_sections where role = 'elective';` (debe dar 0, o el CHECK
nuevo falla). En `dev` ningún JSON del repo declara secciones electivas.

**RLS:** `test_tracks` va en `packages/db/sql/rls-policies.sql` en la **forma indexable** que
`dev` adoptó en #265 (`org_id = nullif(current_setting(...), '')::uuid`, sin castear la
columna), no en la forma `org_id::text = …` de la rama fuente. Dos políticas permisivas:
tenant (todo comando, filas propias) y lectura de las oficiales (`org_id IS NULL`).

## Reconciliación con lo que `dev` ya tenía

| Punto de #275                                                                                                    | Estado en `dev`                                                                                                                       | Decisión                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Módulo de procesos (controller, service, form de edición)                                                        | Idéntico al estado portado a `main` (`0de7271d`)                                                                                      | Se tomó la versión final de #275: `linkAssessments` valida org (en `withOrgContext`), cursos, año e invariante y permite la vinculación parcial; el slug no se regenera al renombrar; el controller usa `parseDtoOrBadRequest`; arreglo del formulario de edición |
| `process-coverage.service`, `measurement-processes.helpers`, `procesos/data.ts`, `procesos/[processId]/page.tsx` | #274 los cambió (resultados del proceso, `gradeId` en la celda de cobertura, `assessmentId` en celdas sin unidad, `source` de bandas) | #275 no les agregó nada por encima del portado: se conservó la versión de `dev` tal cual (incluye `process-results.tsx` y los cinco hallazgos de `1e799cc9`)                                                                                                      |
| DTOs de procesos `.strict()`                                                                                     | `dev` no los tenía                                                                                                                    | Agregado sobre el schema de `dev`, conservando `gradeId` en `ProcessCoverageCell` (#274)                                                                                                                                                                          |
| Slug único que ignora borrados                                                                                   | Constraint simple                                                                                                                     | Índice parcial en `0039` + `buildUniqueSlug` y backfill que ignoran borrados                                                                                                                                                                                      |
| Agrupador con invariante por celda (`process-grouping.ts`) y backfill dry-run por defecto                        | `dev` tenía el backfill viejo (sin invariante, escribe directo)                                                                       | Se tomó el backfill de #275. **Cambio de comportamiento:** `db:backfill:processes` ahora es dry-run por defecto; hay que pasar `--commit`                                                                                                                         |
| `parse-dto.helper`                                                                                               | En `sheet-scanning/`                                                                                                                  | Movido a `common/helpers/` con sus 8 importadores de `sheet-scanning` actualizados                                                                                                                                                                                |
| Filtro `processId` en dashboards, mapa de calor, `/evaluaciones` y banda de previsualización                     | Ya estaba en `dev` (#230/#243/#262/#263), con el buscador `q` y el orden por severidad                                                | Nada que portar. El merge de 3 vías solo sumó `trackId` en las referencias de comparabilidad; buscador, severidad y resultados del proceso quedan intactos                                                                                                        |
| `rls-policies.sql`                                                                                               | #265 pasó todas las políticas a la forma indexable                                                                                    | `test_tracks` se escribió en esa forma (ver arriba)                                                                                                                                                                                                               |
| Índices de #265 en `instruments` (`instruments_org_deleted_idx`, `instruments_subject_idx`)                      | Nuevos en `dev`                                                                                                                       | Se conservan junto a la FK compuesta y el CHECK de `track_id`                                                                                                                                                                                                     |

Llamadores de las claves de comparabilidad y de `MetricValue.level`: `git grep` sobre `dev` no
encontró llamadores nuevos fuera de los que #275 ya actualizó (assembler, vista 360, panorama,
trayectoria, mapa de calor, dashboards, alertas, master-board, `effective-bands`). Los
typecheck de los cuatro paquetes pasan con `trackId` obligatorio.

**Pendiente conocido (no se tocó):** el plegado de resultados del proceso de #274
(`packages/types/src/utils/process-rollup.ts`) arma las celdas por (grado, asignatura). En un
proceso PAES, M1 y M2 caen en la misma celda de Matemáticas, y las menciones de Ciencias en la
misma celda de Ciencias. Las escalas de bandas se separan por `ladderKey`, así que los conteos
por nivel no se mezclan entre escalas distintas, pero la celda no distingue la prueba. Separarla
por línea es un cambio de diseño de #274, fuera de este backport.

## Banco local `soe_tablero_dev`

`scripts/tablero/crear-bd-pruebas.sh` acepta `DB_NAME` (por defecto `soe_tablero`, así el uso en
`main` no cambia). Se eligió parametrizar en vez de copiar el script: es el mismo procedimiento y
una copia se desincronizaría.

```bash
DB_NAME=soe_tablero_dev scripts/tablero/crear-bd-pruebas.sh            # F0
```

Estado F0 (2026-10-06): migraciones de `dev` + `0039`, 7 líneas oficiales, 109 evaluaciones
CSCJ (DIA Monitoreo 2026: 41; PAES: 68 en 5 tandas, con M1 y M2 en E3, E4 y E5 y las tres
menciones de Ciencias en E1, E3 y E4), 6.452 filas de `assessment_item_stats`.

Los pasos de `--completo` se corrieron a mano sobre ese mismo banco (equivalente a re-crearlo
con `--completo`):

| Paso                                  | Resultado                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `db:backfill:processes --commit`      | 0 nuevos (los cargadores ya vincularon); las 26 de Ciencias legacy quedan en conflicto, como se espera   |
| `db:migrate:cie-electivas --commit`   | 3 instrumentos de 132 ítems; gate: 215 alumnos con el mismo % de logro, nota y completitud que el legacy |
| `db:backfill:processes:paes --commit` | 0 nuevos                                                                                                 |
| Segunda corrida (dry-run) de los tres | Sin cambios                                                                                              |

Resultado: **6 procesos** (DIA Monitoreo 2026: 41; Ensayo PAES 1–5 2026: 12, 6, 15, 12 y 6 = 51),
0 violaciones de la invariante (grado, prueba), 0 evaluaciones activas sin proceso.

## Golden

`dev` no tiene `golden-master-board.ts`, pero su `apps/api/src/master-board/**` y su
`master-board.schema.ts` son **idénticos byte a byte** a los de la base de #275 en `main`
(`git diff 56329f1c origin/dev -- apps/api/src/master-board packages/types/src/schemas/master-board.schema.ts`
vacío). El script `packages/db/src/scripts/golden-master-board.ts` reproduce esa query, así que
se usó para generar el golden de `dev` sobre `soe_tablero_dev` en estado F0:

```bash
DATABASE_ADMIN_URL=postgresql://$(whoami)@localhost:5432/soe_tablero_dev \
  pnpm --filter @soe/db golden:master-board
DATABASE_ADMIN_URL=postgresql://$(whoami)@localhost:5432/soe_tablero_dev \
  pnpm --filter @soe/api golden:master-board:check
```

El golden de `dev` difiere del de `main` solo en los UUID (mismos números). El check con la
query nueva da **3 tomas · 66 celdas · 0 diferencias**.

## Verificación

- Typecheck en serie: `@soe/types`, `@soe/db`, `@soe/api`, `@soe/web` sin errores.
- ESLint de los archivos tocados de `apps/api` y `next lint` de los de `apps/web`: sin errores.
  `lint:ds` ok.
- Specs por archivo: process-grouping (15), comparability (27), test-tracks (12),
  measurement-process.schema (4), elective-sections (20), generational-highlights (7),
  process-rollup de #274 (23), expected-scope (8); config-process-grouping (5),
  elective-migration (19), load-process-linking (10), backfill-instrument-tracks (10),
  import-instruments (9), effective-bands (7); measurement-processes service (10), controller
  (5), helpers (12); master-board service (15) y metrics (11); comparable-unit.assembler (10),
  dashboards.service (53), item-analysis (41), heatmap (18), parse-dto (3),
  comparable-alerts (9), dashboard-tools (13), `src/students` (52); web: filtros, tabla y
  controles del tablero (26).
- API local (una vez, puerto 4011, token forjado de directivo CSCJ): `getTakes` lista las 6
  tomas de proceso; la matriz del Ensayo PAES 3 trae Matemáticas como M1 | M2 y Ciencias como
  Común | Bio | Fís | Quí.
- RLS como `soe_app`: sin contexto, `measurement_processes` da 0 filas y `test_tracks` solo las
  7 oficiales; la org CSCJ crea una línea privada que la otra org no ve; `UPDATE`/`DELETE` sobre
  oficiales afectan 0 filas; insertar una oficial o un proceso de otra org viola la política.
- Restricciones: la BDD rechaza una línea de otra asignatura (FK compuesta), una línea en una
  sección core (CHECK) y un código oficial duplicado (índice parcial).

## Riesgos

- **Choque de numeración con la PR #273** (benchmarking en contexto, abierta contra `dev`): trae
  `0038_certain_valkyrie.sql` + snapshot + journal. Ya choca con `0038_handy_pretty_boy` de
  `dev`, y con este backport también con `0039`. La que se mergee después debe borrar su `.sql`
  propio, conservar la meta de `dev` y **regenerar**. No se tocó #273.
- **Sincronización `main` ↔ `dev`:** cuando #275 entre a `main`, `main` tendrá `0034_lean_mindworm`
  y `0035_ordinary_wallop`, y `dev` tendrá `0034_public_nitro` + `0039_soft_speedball` con el
  mismo resultado de schema. La cadena canónica es la de `main`; al sincronizar, regenerar las
  de `dev`.
- **`db:backfill:processes` es dry-run por defecto** en `dev` a partir de este backport.
- M1/M2 Ensayo 5 siguen fuera del repo (vienen de `feat/paes-m1e5-y-roster` y
  `feat/paes-m2e5-figuras`); el banco los toma de esas ramas, igual que en `main`.
