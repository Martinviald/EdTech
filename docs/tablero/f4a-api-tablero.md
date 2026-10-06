# F4a — API del tablero por procesos y pruebas

Registro de la fase F4a del plan (`docs/plan-desarrollo-tablero-procesos-pruebas.md`): el
contrato que consume la web (F4b), las reglas que quedaron en código y cómo verificarlas.

## Contrato (`packages/types/src/schemas/master-board.schema.ts`)

| Tipo | Campos nuevos o cambiados |
| --- | --- |
| `masterBoardMatrixQuerySchema` | `processId` (uuid). `.strict()`: una clave desconocida da 400. `processId` junto a `academicYearId`, `instrumentType`, `applicationPeriod` o `assessmentId` da 400. `gradeId`, `subjectId` y `metric` sí se combinan |
| `masterBoardTakesQuerySchema` | `.strict()` |
| `MasterBoardTake` | `key` = `process:<id>` o `legacy:<yearId>:<type>:<period\|_>`. `processId`, `processKind`, `instrumentType` (nullable: proceso sin evaluaciones o con tipos mezclados), `administeredFrom`/`administeredTo` (YYYY-MM-DD), `assessmentCount` (con resultados), `linkedAssessmentCount`, `hasResults`, `partial` |
| `MasterBoardTest` (nuevo) | `testKey` (`track:<id>` o `subject:<id>`, estable entre tandas), `trackId`, `source` (`subject` / `instrument` / `section`), `name`, `shortName`, `order`, `hasLevels`, `mixed` |
| `MasterBoardSubject` | `tests: MasterBoardTest[]` (una asignatura sin líneas trae un solo test) |
| `MasterBoardCell` / `MasterBoardCourseCell` | `testKey`, `mixed`, `hasLevels`, `comparability` (por celda). La celda de curso conserva `teacher` (por asignatura) y `assessmentIds` |
| `MetricValue.level` | Banda genérica `MasterBoardLevel = { key, label, order, color }`. `color` es `PerformanceLevel` (`insufficient`/`elementary`/`adequate`/`advanced`): la posición de la banda en su set proyectada a los tokens `--level-*` con `bandToLegacyLevel`. En el DIA: Nivel I → `insufficient`, II → `adequate`, III → `advanced` |
| `MasterBoardResolvedTake` | `processId`, `processKind` |
| `MasterBoardMatrix` | `redirectProcessId` |

Las celdas de nivel y de curso vienen en el orden asignatura (por nombre) → prueba (por `order`
y nombre). La web busca la celda por `testKey`.

## Reglas

**Tomas (`getTakes`).**

- Tomas de proceso: todo `measurement_processes` vigente de la org (y del año si se filtra),
  aunque no tenga resultados (`hasResults: false`). Un profesor solo ve los procesos con alguna
  evaluación vinculada en su alcance (curso, asignatura).
- Tomas legacy: las de siempre (año, tipo, período, desde `assessment_item_stats`), pero solo con
  evaluaciones sin proceso vigente. Un proceso borrado devuelve sus evaluaciones a la toma
  legacy. Etiqueta con "· sin proceso".
- Se excluyen evaluaciones `cancelled` (las legacy de Ciencias tras F3) e instrumentos borrados.
- Orden: `coalesce(max(administered_at), starts_on, created_at)` descendente, en las dos clases
  de toma. La primera es la toma por defecto.
- **`partial`.** Un proceso es parcial si existe una evaluación sin proceso (de la org, no
  cancelada, con instrumento vigente) del mismo año académico, tipo de instrumento y período
  que alguna de las vinculadas, y que cabría sin romper la invariante: en su (grado del curso,
  prueba) el proceso no tiene instrumento, o tiene exactamente el mismo. La prueba es la del
  agrupador (`trackOrSubjectTestKey`). Así una tanda PAES no se marca parcial por las
  evaluaciones de otra tanda (otro instrumento para el mismo grado y prueba).

**Toma de la matriz.** Gana `processId` (404 si el proceso no existe, es de otra org o está
borrado). El camino legacy excluye las evaluaciones con proceso; si todas sus evaluaciones
están en un único proceso, la respuesta trae `redirectProcessId` y la matriz vacía. La selección
libre (`assessmentId`) no cambia.

**Columnas.** `loadMatrixRows` (`apps/api/src/master-board/queries/matrix-rows.query.ts`)
agrupa por (curso, asignatura, `coalesce(section.track_id, instrument.track_id)`). Sin línea, la
columna es la asignatura. Una columna es `section` si sale de un instrumento con secciones
electivas: la Común (core, hereda `CIE-COMUN` del instrumento) y cada mención. Las agregaciones
no cambian: `sum(score_sum)`, `sum(max_sum)`, `max(student_count)`.

**Celdas.** Por celda de nivel y de curso:

- `comparability` = `buildComparabilityMeta` de los instrumentos de la celda.
- `hasLevels` = la columna no es `section`, la celda tiene un único instrumento y ese instrumento
  tiene bandas efectivas (`resolveEffectiveBandsForInstruments`: propias o de la versión
  anterior). Solo entonces `level` viene poblado. Los instrumentos sin bandas (hoy, los PAES)
  muestran el % sin nivel; ya no se usa el corte 40/70/85 de la escala de notas.
- `mixed` = columna `subject` con más de un instrumento en la celda.
- Sin total de asignatura.

`getTeacherPerformance` y `loadCourseSubjectStats` siguen por asignatura, con el corte legacy
40/70/85 expresado como bandas (`LEGACY_PERFORMANCE_BANDS`).

## Golden

```bash
scripts/tablero/crear-bd-pruebas.sh            # estado F0: sin procesos, Ciencias legacy
DATABASE_ADMIN_URL=postgresql://$(whoami)@localhost:5432/soe_tablero \
  pnpm --filter @soe/api golden:master-board:check
```

El check (`apps/api/scripts/check-golden-master-board.ts`) abre una transacción, deja todas las
líneas en null y todas las evaluaciones sin proceso, corre `getTakes`, `getMatrix` (toma legacy)
y `loadMatrixRows` nuevos, compara contra `docs/golden/master-board-local.json` por `stableKey` y
revierte. Si la BDD tiene Ciencias migrada, aborta (el golden es del modelo legacy).

Resultado del 2026-10-05: **3 tomas, 66 celdas, 0 diferencias** (score_sum, max_sum,
student_count, instrumentos de la celda y la celda que sirve `getMatrix`).

El golden se regeneró en esta fase con la query de `main` (`pnpm --filter @soe/db
golden:master-board`) sobre el banco recreado. Contra el golden anterior difieren solo las 3
celdas de Ciencias de IV° medio, y la query de `main` da la misma diferencia sobre el banco
actual: es el cambio de datos de F3a (ítems agregados a los JSON de CIE), no de la query.

## Banco completo para F4b

```bash
scripts/tablero/crear-bd-pruebas.sh --completo
```

Agrega al estado F0: `db:backfill:processes --commit` (DIA Monitoreo 2026, 41 evaluaciones),
`db:migrate:cie-electivas --commit` (9 fusionadas, 215 alumnos) y `db:backfill:processes:paes
--commit` (Ensayo PAES 1–5 2026: 12, 6, 15, 12 y 6 evaluaciones; ninguna sin proceso).

Dato del banco a tener presente: el Ensayo PAES 1 trae filas de `assessment_item_stats` de un
curso de 2025 (III° medio C) en CL, HIS y M1, así que su matriz muestra una fila "3° Medio" con
un curso. Viene de la carga (el grano de stats es el curso del alumno), no del tablero.

## API local para F4b

```bash
pnpm --filter @soe/types build && pnpm --filter @soe/db build && pnpm --filter @soe/api build
cd apps/api && NODE_ENV=development \
  DATABASE_URL=postgresql://soe_app@localhost:5432/soe_tablero API_PORT=4010 node dist/main.js
```

El token es un JWE de NextAuth v5 (`dir` + `A256CBC-HS512`) con la clave derivada por HKDF del
`AUTH_SECRET` del `.env` y el salt `authjs.session-token`. El AuthGuard lee el claim `userId`;
para un directivo basta `roles: ['school_admin']`, `activeRole: 'school_admin'` y el `orgId` de
CSCJ (`c5c10000-0000-0000-0000-000000000001`).
