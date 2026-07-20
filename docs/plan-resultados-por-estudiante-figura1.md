# Plan maestro — "Resultados por estudiante" desde la Figura 1 de los informes DIA (E2E)

> Objetivo: llenar la sección §5 "Resultados por estudiante" de los informes DIA agregados con la
> **nómina + nivel** de cada alumno, extraídos de la **"Figura 1"** del PDF (roster raster con n° de
> lista + nombre + punto verde por nivel). Cubre el fix de código, la extracción de los datos
> faltantes, la ingesta en la BDD demo y todo lo necesario para que quede operativo en demo. Se ejecuta
> por fases con subagentes.

---

## Contexto

Los informes DIA se cargaron como `aggregate_only` (sin datos por-alumno). La §5 "Resultados por
estudiante" muestra hoy "no disponible". Se creía que este tipo de informe no traía datos por alumno,
pero **sí los trae**: la "Figura 1" (penúltima página, raster) lista a cada alumno con su **n° de
lista + nombre + un punto verde** cuya banda da su **nivel** (I/II/III) y cuya posición x ≈ su puntaje
(correlación 0.94–0.98). El método de extracción ya está documentado y probado — hay un CSV de
referencia (`Histórico Pruebas DIA/Resultados/dia_niveles_lenguaje_2025.csv`, 292 alumnos de Lengua
Intermedio, columnas `curso,n_lista,nombre_ocr,nivel,x_dot`) y la metodología en
`docs/analisis-clasificacion-niveles-dia.md §3.1`.

**Resultado esperado:** en demo, §5 de los informes agregados muestra la tabla de alumnos (nombre +
nivel). El % de logro individual **no** se muestra como dato oficial (es una estimación de la posición
x); se muestra el **nivel** (firme) y el % queda "—" (o como enhancement opcional flagueado).

**Lo que YA existe y se reutiliza (no reinventar):**
- Contrato `students[]: {listNumber, name, level}` en `official-report-import.schema.ts` y la escritura
  por-alumno del importador (`confirm` → `assessment_results` con `metricType:'band'`,
  `performanceBandId`, `bandLabel`, `percentage:null`) — `official-report-import.service.ts:244-279`.
- Matcher de nombres OCR→nómina: `apps/api/src/official-report-import/lib/student-name-matcher.ts`
  (`matchReportName`, `normalizeName`, `similarity`; auto-match ≥0.85, margen ambigüedad 0.05).
- `resolveLevelBand` (nivel→banda) y `loadInstrumentBands` — ya usados por el importador y el backfill
  de nivel. Las bandas DIA ya están sembradas para todos los instrumentos (PR #56/#57).
- Patrón `hydrateBands` (`assessment-report.service.ts:393-406`): deriva `performanceLevel` desde
  `performanceBandId` cuando el % es null. **Reutilizar** en course-report.
- `StudentTable` (`course-report.tsx:345`) ya renderiza "nivel sin %" (muestra "—" en % y el badge de
  nivel). `OfficialCourseStudentRow` ya tiene `achievement`/`performanceLevel` nullable.

---

## Contratos compartidos (fijar ANTES de despachar subagentes)

1. **`students[]`** por informe: `{ listNumber: number, name: string (OCR), level: 'I'|'II'|'III' }`.
   El extractor emite `[]` si el gate no pasa (sin regresión: hoy siempre es `[]`).
2. **Ingesta**: escribe `assessment_results` con `metricType:'band'`, `performanceBandId` =
   `resolveLevelBand(level, bands)`, `bandLabel`, `percentage:null`, `performanceLevel:null` (se deriva
   en lectura). Matchea el assessment `aggregate_only` EXISTENTE por (instrument, classGroup, period) —
   **no** re-importa (evita el bug de idempotencia). Idempotente (delete+reinsert / onConflictDoUpdate
   por (assessment, student)).
3. **Matching**: `matchReportName(name, roster)`; auto-aprobar `confidence ≥ 0.85 && !ambiguous`; el
   resto se reporta como pendiente de revisión manual (no se inventa).
4. **Lectura §5**: `performanceLevel` se deriva de `performanceBandId` vía el patrón `hydrateBands`; el
   `achievement` (%) queda null → la tabla muestra "—" y el badge de nivel.
5. **% individual**: NO se persiste ni se muestra como oficial en el core. El `x_dot`→% aproximado y el
   dot-plot son **enhancement opcional** (Fase 5), fuera del core.

---

## Fases

### Fase 0 — Spike de extracción de la Figura 1 (subagente Python) · GATE DE RIESGO
Portar el método de `analisis-clasificacion-niveles-dia.md §3.1` a una función
`parse_student_roster()` en `.claude/skills/extraer-informes-dia/extraer_informe.py` (fuera del repo):
render 300dpi → detectar puntos verdes (RGB≈61,107,96) → fronteras de banda por "azuleza" → OCR de
`n° lista + nombre` por fila → emparejar punto↔fila (1:1) → `{listNumber, name, level}`.
- **Validar contra verdad conocida**: los 8 cursos de Lengua Intermedio tienen el CSV
  `dia_niveles_lenguaje_2025.csv` — comparar nombre/nivel extraído vs CSV (debe reproducirlo). Además
  4-6 informes de Matemática/Cierre a ojo contra el PDF.
- **Gate**: fiabilidad del emparejamiento nombre↔punto y del nivel; % de filas con nombre legible;
  0 alumnos sin punto. Si no es confiable → parar y reportar; el resto de fases de datos esperan.
- Confirmar cobertura por período (la sección aparece en Diagnóstico/Monitoreo/Cierre — validar que la
  Figura 1 con puntos existe en los tres). **NO batch todavía.**

### Fase 1 — Batch de extracción (subagente Python) · tras Fase 0 OK
Integrar `parse_student_roster` en `build()` (reemplazar el `students: []` hardcodeado), correr el
batch sobre todos los informes con Figura 1, sobrescribir los JSON de
`Histórico Pruebas DIA/Resultados/extraccion/*.json`. Extender `validar_vs_cuadernillos.py` con un
chequeo de niveles del roster (nivel del alumno coherente con la distribución agregada). Reportar
cobertura por informe (alumnos extraídos / N).

### Fase 2 — Backend read + frontend §5 (subagente repo) · en paralelo con Fase 0/1
No depende de la extracción. Sobre `origin/dev`:
- **`course-report.service.ts`**: agregar `performanceBandId` al select de `loadEvaluatedStudents`
  (~:572) y al tipo `EvaluatedStudent` (~:60); cargar `loadInstrumentBands` siempre; aplicar la lógica
  de `hydrateBands` (extraer un helper compartido desde `assessment-report.service.ts:393` o replicarla)
  para derivar `performanceLevel` desde la banda cuando el % es null. `buildStudentResults` ya copia
  `performanceLevel`.
- **Frontend `course-report.tsx` §5** (~:190-214): des-gatear — mostrar `StudentTable` cuando
  `studentResults` tiene filas (condicionar a datos, NO a `isAggregate`), igual que Bloque B hizo con la
  torta. `StudentTable` ya sirve para "nivel sin %". El `StudentDotPlot` depende de `achievement` (filtra
  filas con % null → vacío): en el core **ocultarlo** cuando no hay %, y dejarlo para la Fase 5.
  Mantener el texto "no disponible" solo cuando NO hay filas por-alumno.
- Tests: agregado con filas band-only → §5 con nómina + nivel, % "—"; agregado sin filas → nota;
  item_level → sin regresión. Actualizar `course-report.service.spec.ts`.

### Fase 3 — Script de ingesta (subagente repo) · tras Fase 1 (datos) + Fase 2 (contrato)
Nuevo `apps/api/scripts/backfill-student-levels.ts` (espejo de `backfill-level-stats.ts`):
por cada JSON con `students[]` no vacío → resolver el assessment `aggregate_only` existente por
(instrument, classGroup, period) → cargar roster (`student_enrollments` activos) y bandas del
instrumento → por alumno: `matchReportName` (auto ≥0.85), `resolveLevelBand(level, bands)` → escribir
`assessment_results` (metricType 'band', performanceBandId, bandLabel, percentage null), idempotente
(delete+reinsert por assessment o onConflictDoUpdate). Dry-run por defecto; `--confirm` persiste.
Loguear por cohorte: matcheados / ambiguos / no encontrados (para revisión manual). Documentar como
paso MANUAL post-deploy (los JSON viven fuera del repo, no en CI), en
`docs/revision-carga-informes-dia-2025.md`.

### Fase 4 — Ingesta + validación en demo (por el túnel, lo corre el orquestador)
Con el túnel `sst tunnel --stage demo` (skill `demo-db-access`): correr `backfill-student-levels.ts`
dry-run → revisar matcheos → `--confirm`. Smoke: instanciar `CourseReportService` standalone contra un
assessment real (p.ej. Mate 3° Cierre 3A `88b284d9`) y verificar `studentResults` con nombre+nivel.
Verificar en CloudFront que §5 muestra la nómina. Cerrar túnel + borrar credenciales.

### Fase 5 (opcional, enhancement) — % aproximado + dot-plot
Persistir `x_dot`→% aproximado (extender `students[]` con `xPct?` + el importador/ingesta), adaptar
`StudentDotPlot` para posicionar por ese % (flagueado "estimación"), o por centro de banda. Fuera del
core; evaluar después.

---

## Orquestación (olas de subagentes)
- **Ola 1 (paralelo):** Fase 0 (spike extracción) ‖ Fase 2 (backend read + frontend §5, worktree).
- **Ola 2:** Fase 1 (batch, tras Fase 0 OK) ‖ Fase 3 (script de ingesta, worktree; se escribe con el
  contrato de Fase 2, se prueba con los JSON de Fase 1).
- **Ola 3 (orquestador, túnel):** Fase 4 ingesta + validación en demo.
- **Ola 4:** PRs a dev y main (Fase 2 + Fase 3 son código; la extracción y la ingesta son datos/manual).
- **Gate duro:** si Fase 0 no es confiable, Fase 2 igual entrega (§5 lista para cuando haya datos), pero
  Fases 1/3/4 esperan. No mergear §5 mostrando una nómina con nombres OCR errados o niveles mal
  emparejados.

## Verificación E2E
- `pnpm typecheck` en `@soe/types`/`@soe/api`/`@soe/web`; tests de `course-report`/`official-report-import`.
- Fase 0: extracción reproduce el CSV de Lengua (nombre+nivel) y cuadra a ojo en Matemática.
- Fase 4 (demo): §5 muestra la nómina con nivel; el nº de alumnos matcheados ≈ N de la cohorte; los
  ambiguos/no-encontrados quedan listados para revisión.

## Riesgos
- **OCR de nombres** (el mayor): typos → fuzzy-match ≥0.85, el resto a revisión manual. El CSV de Lengua
  valida la fiabilidad antes de escalar.
- **Emparejamiento punto↔fila** en la Figura 1 (geometría por informe): validado en el spike contra el
  CSV/PDF.
- **Semi-granular**: escribir niveles por alumno cambia el import de "solo agregado" — pero está dentro
  del modelo (`student_levels`) y no rompe las vistas agregadas.
- **PII**: son alumnos propios de CSCJ matcheados a su nómina; dentro del tenant, sin volcar a logs.
- **% aproximado**: NO se presenta como oficial (core muestra nivel; % "—").

## Archivos críticos
- Extractor (fuera del repo): `.claude/skills/extraer-informes-dia/extraer_informe.py`,
  `validar_vs_cuadernillos.py`.
- Backend: `apps/api/src/official-reports/course-report.service.ts` (+ reuso de `hydrateBands` de
  `assessment-report.service.ts`), `apps/api/scripts/backfill-student-levels.ts` (nuevo).
- Frontend: `apps/web/src/components/official-reports/course-report.tsx` (§5), `report-charts.tsx`
  (StudentDotPlot, solo si Fase 5).
- Reuso: `lib/student-name-matcher.ts`, `lib/evaluate-gates.ts` (`resolveLevelBand`),
  `performance-bands/lib/load-instrument-bands`.
- Tests: `course-report.service.spec.ts`.
