# Plan — Analítica agregada desde informes oficiales DIA

> **Fecha:** 2026-07-14 · decisiones cerradas 2026-07-15
> **Estado:** **Aprobado, listo para implementar.** Las 5 decisiones de §9 están tomadas (ver §10). No implementado aún.
> **Objetivo:** permitir cargar los resultados de evaluaciones cuyo único origen es el informe oficial DIA en PDF (sin respuestas alumno×pregunta), haciendo que convivan con el motor de analítica granular actual sin romperlo ni degradarlo.
> **Rama sugerida:** `feat/analitica-agregada` desde `dev`.

---

## 1. Resumen ejecutivo

El esquema actual es **alumno-céntrico**: `responses`, `assessment_results` y `skill_results` tienen todos `student_id NOT NULL`. Los informes oficiales DIA entregan casi todo **a nivel de curso**. Hoy no hay dónde poner ese dato.

La propuesta central es introducir un **read-model de cohorte** con grano `(assessment_id, class_group_id, item_id)` que almacena **conteos enteros**, con:

- **dos escritores** — el cálculo desde `responses` (flujo actual, sin cambio semántico) y el importador de informes oficiales;
- **un lector** — `item-analysis` y `official-reports` dejan de hacer `GROUP BY` sobre `responses` y leen el read-model;
- **un calculador puro compartido** en `packages/types`, siguiendo el patrón que el proyecto ya usa con `aggregateStudentResults` / `aggregateSkillResults`.

La analítica que es **irreduciblemente granular** (matriz alumno×pregunta, punto-biserial, KR-20, detalle por alumno) sigue leyendo `responses` y queda **cerrada por capacidad**: no se ofrece para evaluaciones agregadas, con un estado vacío explicativo en vez de una tabla en cero.

Esto no es solo habilitar la carga histórica: hoy la distribución de alternativas se computa en **dos lugares distintos** (`item-analysis.service.ts` y `official-reports/lib/item-report-data.ts`), y la persistencia de resultados en **otros dos** (`computeAndPersist` y un fork inline en `answer-sheets.service.ts:476-535`). El refactor colapsa ambas duplicaciones.

---

## 2. Hallazgos que sostienen el diseño

Todo lo de esta sección está verificado contra el código y contra un informe real (`RBD25520_DIA_LECTURA_3_A_Resultados_Asignatura_Cierre_2025.pdf`, 3°A, N=43). No son supuestos.

### 2.1 Los dashboards no leen `responses`

`dashboards.service.ts`, `heatmap.service.ts` y `official-reports/course-report.service.ts` leen exclusivamente `assessment_results` y `skill_results`. `analytics.service.ts` tampoco toca `responses`. La dependencia de `assessment_results` hacia `responses` es **procedural, no estructural**: no hay FK ni CHECK entre ellas, y la política RLS valida por `EXISTS` sobre `assessments.org_id` sin mirar `responses`.

**Consecuencia:** el nivel por alumno se puede insertar directo en `assessment_results` (`metric_type='band'` + `band_label` + `performance_band_id`, con `percentage` NULL) y los dashboards de distribución de niveles funcionan sin tocar el esquema.

### 2.2 Los porcentajes del informe reconstruyen conteos exactos

El informe entrega porcentajes por alternativa y el N del curso ("Cantidad de estudiantes que considera este informe: 43"). `round(pct/100 × N)` recupera el conteo entero y **suma exactamente N** en los 8 casos probados, tanto selección múltiple como desarrollo:

| Pregunta | Porcentajes | Conteos | Suma |
|---|---|---|---|
| P4 (MC) | 4.65 / 2.33 / **90.70** / 2.33 | 2 / 1 / 39 / 1 | 43 ✓ |
| P7 (MC) | **81.40** / 9.30 / 9.30 / 0.00 | 35 / 4 / 4 / 0 | 43 ✓ |
| P1 (MC) | **97.67** / 0.00 / 2.33 / 0.00 | 42 / 0 / 1 / 0 | 43 ✓ |
| P22 (desarrollo) | RC 83.72 / RI 16.28 | 36 / 7 | 43 ✓ |
| P14 (desarrollo) | RC 55.81 / RPC 41.86 / RI 2.33 | 24 / 18 / 1 | 43 ✓ |

**Consecuencia — y es la decisión de diseño más importante del plan:** el read-model almacena **conteos, no porcentajes**. Los conteos se recombinan entre cursos por **suma exacta** (un profesor con 3 cursos, la referencia a nivel org). Promediar porcentajes entre cursos de distinto tamaño sería incorrecto. Además, los conteos son idénticos en tipo a lo que produce el `GROUP BY` actual, lo que hace la paridad verificable fila a fila.

La suma de conteos = N es una **validación de integridad dura** del importador: si no cuadra, el informe se rechaza.

### 2.3 El % por eje de habilidad es derivable de la Tabla 1

No es un dato independiente. Derivando desde los conteos de la Tabla 1, con crédito parcial 0.5 para RPC y ponderando por puntaje:

| Eje | Derivado | Informe | Delta |
|---|---|---|---|
| Localizar | 77.67 | 77.67 | 0.004 pp |
| Interpretar y relacionar | 80.16 | 80.16 | 0.005 pp |
| Reflexionar | 75.00 | 75.00 | 0.000 pp |

**Consecuencia:** el Gráfico 2 del informe **no es input, es validación**. Cotejar el eje derivado contra el reportado valida en un solo golpe el etiquetado de taxonomía (`item_taxonomy_tags`), el `scoring_config` de los ítems y la reconstrucción de conteos. Es la mejor barrera de calidad que tiene este importador y sale gratis.

### 2.4 El filtro de alumnos siempre se deriva de cursos

`resolveAccessibleStudentIds` (`item-analysis.service.ts:1181-1216`) convierte el scope del rol + un `classGroupId` opcional en la lista de alumnos. **Nunca** recibe una lista arbitraria desde la UI: sale siempre de `student_enrollments` filtrado por `class_group`.

**Consecuencia:** pre-agregar por `(assessment, class_group, item)` puede responder **todas** las consultas actuales — filtro por curso es 1 fila, profesor sin filtro es la suma de sus N cursos, `references.org` es la suma de todas las filas del assessment.

> ⚠️ Sutileza a respetar: el filtro se construye sobre `student_enrollments`, **no** sobre `assessment_course_assignments`. La pre-agregación debe usar el mismo camino, o un alumno que respondió sin estar matriculado cambiaría de bucket.

### 2.5 La superficie granular real es pequeña

De los 4 call-sites de `/item-analysis/matrix` en `apps/web`, **tres pasan `limit=1`** y solo consumen `matrix.questions[]` (los agregados por ítem), descartando la nómina:

| Ruta | Uso |
|---|---|
| `/evaluaciones/[id]/detalle` | `all=true` — **único consumidor real de la matriz alumno×pregunta** |
| `/evaluaciones/[id]/analisis-ia` | `limit=1` — solo quiere `questions` |
| `/resultados/habilidades` (drill-down) | `limit=1` — solo quiere `questions` |
| `/dashboard`, `/evaluaciones`, `/material-remedial` | solo `/item-analysis/assessments` |

**Consecuencia:** casi toda la UI sobrevive a la analítica agregada. Lo que hay que cerrar es un conjunto acotado, no media plataforma.

### 2.6 `item-analysis` no calcula psicometría

No hay `discrimination`, `pointBiserial`, `kr20` ni `difficulty` en `item-analysis.service.ts`. Viven en `instrument-quality.service.ts`, que importa `kr20` / `pointBiserial` desde `ai-analysis/ai-analysis.metrics.ts` y operan sobre una `ScoreMatrix` alumno×ítem.

**Consecuencia:** `item-analysis` es **100% agregable** salvo la matriz y las filas de alumno. La psicometría es un módulo aparte y queda íntegramente del lado granular.

### 2.7 ⚠️ La lista de evaluaciones exige `assessment_results` (bloqueante)

`item-analysis.service.ts:105` filtra con:

```sql
exists (select 1 from assessment_results where assessment_id = assessments.id)
```

con el comentario *"Sólo evaluaciones con resultados (para que la matriz nunca salga vacía)"*.

**Consecuencia:** una evaluación agregada **sin niveles por alumno desaparece de toda la app** — no la listan `/evaluaciones`, `/dashboard` ni `/material-remedial`, y su hub solo es alcanzable por URL directa. Esto pasa *antes* de cualquier problema con `responses`.

Hay dos salidas y hay que elegir en Fase 0, porque define si `students` es opcional en el contrato del importador (§6.1):

- **(a)** Extender el `EXISTS` a `OR EXISTS (select 1 from assessment_item_stats ...)`. Desacopla visibilidad de niveles por alumno. **Recomendada.**
- **(b)** Hacer obligatorios los niveles por alumno en el importador, lo que ata cada carga al pipeline de OCR de la Figura 1 (§6.4) — el más frágil de los dos.

### 2.8 Degradar en silencio no es neutro

Sin `responses`, la mayoría de las superficies degradan bien (tabla vacía, `EmptyState`). **Dos no**, y son las que obligan a que el gating sea explícito y no "que se vea vacío":

- **`instrument-quality` afirma mala calidad donde solo faltan datos.** Compone sobre `report.items` (que siempre existe vía `emptyItemRow`), no sobre `responses` → `items.length > 0` → **no** dispara el `EmptyState` de `quality-panel.tsx:71`. Renderiza la tabla completa con métricas `—`, badge **warning** "KR-20 —", y `deriveFlags:208` marca `misaligned` todo ítem sin tags → `flaggedCount` inflado → "N ítems con alertas". Es un **falso negativo**, no un vacío.
- **`ai-analysis` genera un informe LLM sobre datos nulos.** `loadItemMeta:188` hace `innerJoin(responses)` → `itemMeta: []`, `matrix: []`, `kr20: null`, pero `assembleItems:113` recorre `report.items` y no lanza. El LLM recibe un snapshot con alumnos y habilidades pero sin psicometría, y **sin ninguna señal de "no aplica"** → alucinación probable. La UI solo distingue `pending`/`processing`/`failed`.

---

## 3. Modelo de datos

### 3.1 `assessment_item_stats` (nueva)

Read-model de cohorte por pregunta. Grano `(assessment_id, class_group_id, item_id)`.

```ts
export const assessmentItemStats = pgTable('assessment_item_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  assessmentId: uuid('assessment_id').notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  classGroupId: uuid('class_group_id').notNull()
    .references(() => classGroups.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id),

  // Conteos, NUNCA porcentajes (§2.2). Recombinables entre cursos por suma.
  studentCount: integer('student_count').notNull(),    // N de la cohorte
  responseCount: integer('response_count').notNull(),  // denominador; = totalResponses actual
  correctCount: integer('correct_count').notNull(),

  // [{ key: 'A'|'RC'|null, count, isCorrect }]. key null = blanco/nulo.
  answerCounts: jsonb('answer_counts').$type<AnswerCount[]>().notNull().default([]),

  // Puntaje acumulado del curso en el ítem (soporta crédito parcial: RPC = 0.5).
  scoreSum: decimal('score_sum', { precision: 9, scale: 2 }).notNull(),
  maxSum: decimal('max_sum', { precision: 9, scale: 2 }).notNull(),

  source: statsSourceEnum('source').notNull(),         // 'computed' | 'imported'
  computedAt: timestamp('computed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.assessmentId, t.classGroupId, t.itemId),
  index('assessment_item_stats_item_idx').on(t.assessmentId, t.itemId),
]);
```

`scoreSum`/`maxSum` existen porque el % por eje es ponderado por puntaje (§2.3) y porque RPC vale 0.5. Sin ellos el eje no se deriva bien para ítems de desarrollo.

`blankCount` **no se almacena**: es la entrada de `answerCounts` con `key === null`. Se deriva en lectura (§5.4 — no se filtra ni indexa en SQL).

### 3.2 `assessment_skill_stats` (nueva)

Read-model de cohorte por eje/habilidad. Grano `(assessment_id, class_group_id, node_id)`.

```ts
export const assessmentSkillStats = pgTable('assessment_skill_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  assessmentId: uuid('assessment_id').notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  classGroupId: uuid('class_group_id').notNull()
    .references(() => classGroups.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').notNull()
    .references(() => taxonomyNodes.id, { onDelete: 'cascade' }),

  studentCount: integer('student_count').notNull(),
  correctCount: integer('correct_count').notNull(),
  totalCount: integer('total_count').notNull(),
  percentage: decimal('percentage', { precision: 5, scale: 2 }),  // 0..100
  source: statsSourceEnum('source').notNull(),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.assessmentId, t.classGroupId, t.nodeId)]);
```

> **Nuance semántica que hay que decidir (§9.2).** `percentage` no significa exactamente lo mismo según el origen:
> - `source='computed'` → **media de los porcentajes por alumno** de `skill_results`. Se elige así para que los números que ya ve el usuario en el heatmap **no cambien**.
> - `source='imported'` → **tasa agrupada ponderada por puntaje** derivada de `assessment_item_stats`. Es la definición del propio DIA y reproduce el informe con error < 0.01 pp (§2.3).
>
> Ambas coinciden cuando todos los alumnos responden todos los ítems, y divergen levemente si hay respuestas faltantes. La alternativa (unificar a la definición agrupada) es más limpia conceptualmente pero **cambiaría números ya publicados** en dashboards existentes.

### 3.3 `assessments.data_granularity` (columna nueva)

```ts
export const dataGranularityEnum = pgEnum('data_granularity', ['item_level', 'aggregate_only']);
// en assessments:
dataGranularity: dataGranularityEnum('data_granularity').default('item_level').notNull(),
```

Columna tipada, **no** `config` JSONB: se ramifica y se filtra en SQL, que es exactamente el criterio de §5.4.

`default 'item_level'` hace que la migración sea inerte — todo lo existente queda como está.

### 3.4 Enums nuevos

```ts
export const statsSourceEnum = pgEnum('stats_source', ['computed', 'imported']);
// import_job_type += 'dia_official_report'
```

### 3.5 RLS

Ambas tablas heredan el tenant vía `assessments`, igual que `responses` / `assessment_results` / `skill_results`. En `packages/db/sql/rls-policies.sql` (**no** en el schema Drizzle — §5.2 y el aviso del commit `53aa242`):

```sql
ALTER TABLE "assessment_item_stats"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_item_stats"  FORCE  ROW LEVEL SECURITY;
-- idem assessment_skill_stats

DROP POLICY IF EXISTS "assessment_item_stats_tenant_isolation" ON "assessment_item_stats";
CREATE POLICY "assessment_item_stats_tenant_isolation" ON "assessment_item_stats"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "assessment_item_stats"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );
```

---

## 4. Modelo de capacidades

Nuevo archivo `packages/types/src/analytics-capabilities.ts`, hermano de `access-policies.ts` y con la misma filosofía: **la lista de capacidades vive una vez y se importa en api y web** (§4.2).

```ts
export const DATA_GRANULARITIES = ['item_level', 'aggregate_only'] as const;
export type DataGranularity = (typeof DATA_GRANULARITIES)[number];

export const ANALYTICS_CAPABILITIES = [
  'cohort_item_stats',   // % logro por pregunta + distribución de alternativas
  'cohort_skill_stats',  // % por eje de habilidad
  'student_levels',      // nivel de logro por alumno
  'student_matrix',      // matriz alumno × pregunta
  'student_detail',      // detalle respuesta a respuesta de un alumno
  'psychometrics',       // KR-20, punto-biserial, discriminación
  'answer_sheet_import', // cargar hojas de respuesta
  'ai_item_insight',     // snapshots IA que leen responses
  'remedial_stimulus',   // identificación de estímulos fallados
] as const;
export type AnalyticsCapability = (typeof ANALYTICS_CAPABILITIES)[number];

const BY_GRANULARITY: Record<DataGranularity, readonly AnalyticsCapability[]> = {
  item_level: ANALYTICS_CAPABILITIES,
  aggregate_only: ['cohort_item_stats', 'cohort_skill_stats', 'student_levels'],
};

export function capabilitiesFor(g: DataGranularity): readonly AnalyticsCapability[]
export function supportsCapability(g: DataGranularity, c: AnalyticsCapability): boolean
```

### 4.1 Contrato de error

Un endpoint que requiere una capacidad ausente responde **409** con código legible por máquina, para que la web pinte un estado vacío específico y no un error genérico:

```json
{
  "statusCode": 409,
  "error": "CapabilityUnavailable",
  "code": "REQUIRES_ITEM_LEVEL_DATA",
  "capability": "student_matrix",
  "message": "Esta evaluación se cargó desde un informe oficial y no tiene respuestas por alumno."
}
```

### 4.2 Guard

`@RequiresCapability('student_matrix')` + `CapabilityGuard`, espejando `RolesGuard` / `SensitiveDataGuard`. El guard resuelve el `assessmentId` desde `@Param` o `@Query` y consulta la granularidad.

Para los endpoints donde `assessmentId` es **opcional** (`/item-analysis/questions/:itemId` agrega across assessments), el guard no aplica: la resolución va en el service, que filtra el read-model — y ahí la mezcla de granularidades es legítima, porque el read-model es homogéneo.

### 4.3 Exposición — y por qué no inventamos el patrón

`AssessmentOption` y los DTOs de detalle suman `dataGranularity` + `capabilities: AnalyticsCapability[]`. La web decide qué pestañas y acciones renderiza sin adivinar ni gatillar un fetch que va a fallar.

Esto **no es un patrón nuevo**: el repo ya resuelve exactamente esta forma de problema dos veces, y conviene copiar el estilo en vez de inventar.

| Precedente | Dónde | Qué hace |
|---|---|---|
| **`hasGradingScale`** (TKT-04) | `assessment-report.service.ts:152-154`; consumido en `evaluaciones/[assessmentId]/page.tsx:100,160` y `resultados/informe/report-body.tsx:144,167` | Booleano de disponibilidad en el payload que colapsa secciones de UI. El comentario del código dice literalmente *"para que la UI oculte los campos de nota en vez de mostrar 4.0"* — que es, palabra por palabra, nuestro problema. |
| **`suppressed` + `suppressionReason`** (k-anonimato) | `benchmarking/components/comparison-view.tsx:60-78` | El backend marca la supresión **y manda el motivo**; la UI reemplaza el bloque por un `AlertCallout tone="warning"` con el texto del servidor. Capacidad + razón, ambas decididas en backend. |

Componentes a reutilizar (no crear nuevos):
- `components/patterns/EmptyState.tsx` — cuando la sección entera no aplica. Con `action` para ofrecer una salida.
- `components/patterns/AlertCallout.tsx` — cuando los datos están pero con una limitación. El mejor ejemplo vivo es `material-remedial/components/generate-panel.tsx:324-328`, que ante la ausencia de estímulos cambia el método por defecto, deshabilita la opción imposible y explica por qué. **Es el patrón de degradación mejor resuelto del repo.**
- `components/feature-gate.tsx` (`FeatureUpgradeNotice`) — **no sirve tal cual**: es un flag por organización (`organizations.config.allowedFeatures`), no por evaluación. Sirve como referencia de estilo visual, no de mecánica.

### 4.4 Las pestañas hoy solo miran el rol

`evaluaciones/[assessmentId]/layout.tsx:86-106` calcula las pestañas únicamente con `canAccess(roles, ...)`. No hay filtro por disponibilidad de datos: *Detalle por pregunta*, *Calidad* y *Análisis IA* se muestran siempre. Ese cálculo es el punto exacto donde entra `capabilities`.

Señal de origen existente que **no** sirve: `meta.instrumentType === 'dia'` (`page.tsx:97`) ya condiciona render, pero es una propiedad del **instrumento**, no de la granularidad del dato. Un DIA cargado por planilla y uno cargado por PDF agregado son indistinguibles hoy.

---

## 5. Arquitectura: un lector, dos escritores

```
                    ┌─ responses ──► aggregateItemStats() ─┐
                    │  (flujo actual)                      │
ESCRITURA           │                                      ├─► assessment_item_stats
                    │                                      │   assessment_skill_stats
                    └─ informe DIA JSON ──► importer ──────┘
                       (nuevo)

LECTURA             assessment_item_stats ──► item-analysis (capa agregable)
                                          ──► official-reports (specTable)
                    assessment_skill_stats ─► dashboards getSkills / heatmap

LECTURA GRANULAR    responses ──► matriz alumno×pregunta ──┐
                              ──► instrument-quality       ├─► capability-gated
                              ──► student-detail, ai, ...  ┘
```

El calculador `aggregateItemStats(...)` es **puro** y vive en `packages/types/src/utils/item-stats-calculator.ts`, junto a `grade-calculator.ts`. Debe congelar dos detalles del comportamiento actual, o la paridad se rompe:

1. **Precedencia de la alternativa**: `value.raw ?? value.key ?? value.answer`, string vacío → `null`. Hoy está duplicada en `extractRawAnswer` (`:1254-1263`, TypeScript) y en el `coalesce` SQL de `loadAnswerDistribution` (`:853-855`), con un comentario que dice explícitamente que deben coincidir. El calculador puro **elimina esa duplicación**.
2. **Corrección de la alternativa**: `correctKey != null ? alt.key === correctKey : alt.isCorrect` (`:428`) — la clave derivada gana sobre el flag por alternativa.

---

## 6. El importador

Módulo nuevo `apps/api/src/official-report-import/`. **No** va en `dia-ingestion/`: ese módulo importa bancos de preguntas (crea `instruments` + `items` + `item_taxonomy_tags`) y no toca resultados.

El patrón a imitar es **`answer-sheets/`**: `upload` → `preview` → `confirm`, síncrono, con token de preview de un solo uso y registro de auditoría en `import_jobs` escrito ya `completed`/`partial` dentro de la misma transacción.

### 6.1 Contrato de entrada

`packages/types/src/schemas/official-report-import.schema.ts`. Formato intermedio PDF → JSON, en la línea del `CONTRATO.md` que ya existe para los cuadernillos:

```jsonc
{
  "schemaVersion": "1.0",
  "source": { "file": "RBD25520_DIA_LECTURA_3_A_..._Cierre_2025.pdf" },
  "report": {
    "rbd": "25520", "courseLabel": "3 A", "period": "cierre", "year": 2025,
    "subjectCode": "LANG", "gradeCode": "3RD_BASIC",
    "studentCount": 43                    // "Cantidad de estudiantes que considera este informe"
  },
  "items": [
    { "position": 4,  "distribution": [
        {"key":"A","pct":4.65}, {"key":"B","pct":2.33},
        {"key":"C","pct":90.70,"isCorrect":true}, {"key":"N","pct":2.33}] },
    { "position": 14, "distribution": [
        {"key":"RC","pct":55.81}, {"key":"RPC","pct":41.86}, {"key":"RI","pct":2.33}] }
  ],
  "skillAxes":         [ {"name":"Localizar","pct":77.67} ],        // VALIDACIÓN, no input (§2.3)
  "levelDistribution": [ {"level":"I","pct":0.0}, {"level":"II","pct":41.86} ], // VALIDACIÓN
  "students": [ {"listNumber":"02","name":"ARREDONDO SABALLA C.","level":"III"} ]  // opcional
}
```

### 6.2 Validaciones del preview

Ninguna es opcional. El preview no persiste nada y devuelve el resultado de cada gate:

| # | Gate | Falla ⇒ |
|---|---|---|
| 1 | `round(pct/100 × N)` por bucket **suma exactamente N** en cada ítem | rechazo duro |
| 2 | Cada `position` resuelve a un `item_id` del instrumento | rechazo duro |
| 3 | Eje derivado de los conteos ≈ eje reportado (tol. 0.01 pp) | rechazo duro — valida taxonomía + scoring + conteos de una vez (§2.3) |
| 4 | Distribución de niveles derivada ≈ reportada (si vienen `students`) | advertencia |
| 5 | Match difuso de alumnos por nombre → propuesta con confianza | **confirmación humana obligatoria** (§8.3) |

Gate 5 nunca crea alumnos. Si un nombre no cruza, ese alumno queda fuera y se reporta; no se inventa una fila.

### 6.3 Qué escribe el `confirm`

Todo dentro de un solo `withOrgContext(this.db, orgId, tx => ...)`:

1. `assessments` con `data_granularity = 'aggregate_only'` (crear o reusar; si el existente es `item_level` → **409**, ver §8.3).
2. `assessment_course_assignments` con el curso del informe.
3. `assessment_item_stats` con `source='imported'`.
4. `assessment_skill_stats` derivado de (3) con `source='imported'`.
5. `assessment_results` por alumno (solo si vienen `students`): `metric_type='band'`, `band_label`, `performance_band_id` resuelto contra las bandas del instrumento; `percentage` **NULL**.
6. `import_jobs` con `type='dia_official_report'`, `result`, `error_log`.

### 6.4 Extracción PDF → JSON

La Tabla 1 es texto y se extrae de forma fiable. La **Figura 1** (nivel por alumno) es un scatter que requiere visión por computador + OCR; ya está resuelto y documentado en `docs/analisis-clasificacion-niveles-dia.md`, con salida en `Histórico Pruebas DIA/Resultados/dia_niveles_lenguaje_2025.csv`.

Son **dos pipelines independientes** y el contrato los desacopla: `students` es opcional, de modo que un informe pueda cargarse solo con datos de cohorte.

> Que `students` sea realmente opcional **depende de resolver §2.7 por la vía (a)**. Con el `EXISTS` actual, una evaluación sin niveles por alumno es invisible en toda la app, y entonces `students` sería obligatorio de facto — atando cada carga al pipeline de OCR, que es el frágil.

---

## 7. Fases

Cada fase deja el repo verde y desplegable. Ninguna rompe nada por sí sola.

### Fase 0 — Contratos y esquema (inerte)
- `packages/types`: `DataGranularity`, capacidades, `AnswerCount`, `ItemCohortStats`, schemas Zod.
- `packages/db`: 2 tablas, `assessments.data_granularity` (default `item_level`), enums `stats_source` + `dia_official_report`.
- Migración `db:generate` + políticas en `rls-policies.sql`.
- Resolver §2.7 (visibilidad) y §9.3 (granularidad por assessment vs. por sección) **antes de generar la migración** — ambas cambian el esquema.
- **Nada lee ni escribe todavía.** Todos los assessments quedan `item_level`.

### Fase 1 — Calculador puro + read-model poblado (paridad, sin cambio visible)
- `aggregateItemStats()` / `aggregateCohortSkillStats()` puros en `packages/types`, con tests unitarios.
- Poblar desde **los dos escritores actuales**: `computeAndPersist` (`:130-227`) y el fork inline de `answer-sheets.service.ts:476-535`. **Unificar ese fork es parte de esta fase, no un extra** (ver §8.1).
- Backfill: recomputar el read-model para todos los assessments existentes, org por org bajo `withOrgContext`.
- **Test de paridad**: para cada assessment existente, la salida del `GROUP BY` actual debe ser idéntica al read-model, fila a fila.
- **Nadie lee el read-model todavía** → riesgo cero.

### Fase 2 — Migrar los lectores agregables
- `item-analysis`: `attachCorrectRates` (`:533-574`), `attachOrgReferences` (`:593-634`) y `loadAnswerDistribution` (`:834-872`) pasan a sumar `assessment_item_stats` filtrando por los `class_group` del scope.
- `official-reports/lib/item-report-data.ts` migra al mismo read-model → muere la segunda copia del cómputo de distribuciones.
- La matriz (`loadCells`, `loadStudentsPage`) **no se toca**: sigue en `responses`.
- Verificar en demo con `/verify` que los números no se mueven.

### Fase 3 — Granularidad, capacidades y gating
- Guards de escritura: `calculate()`, `recalculateByInstrument()` y `answer-sheets.confirm()` rechazan `aggregate_only` (§8.2).
- `@RequiresCapability` + `CapabilityGuard`.
- DTOs exponen `dataGranularity` + `capabilities`; las pestañas de `layout.tsx:86-106` pasan a mirarlas además del rol (§4.4).
- Visibilidad: extender el `EXISTS` de `item-analysis.service.ts:105` (§2.7).
- UI, en orden de peligrosidad:

  | Prioridad | Superficie | Acción |
  |---|---|---|
  | **1** | `instrument-quality` → `calidad/page.tsx`, `quality-panel.tsx` | **Cerrar por capacidad `psychometrics`.** No basta con dejarlo degradar: hoy afirma mala calidad donde solo faltan datos (§2.8). |
  | **2** | `ai-analysis` → `analisis-ia/page.tsx` | **Cerrar `generate` por capacidad `ai_item_insight`.** Un informe LLM sobre matriz vacía alucina sin señal de "no aplica" (§2.8). |
  | 3 | `/evaluaciones/[id]/detalle` | `EmptyState` explicando el origen. Ya cubre `students.total === 0` (`detalle/page.tsx:62-84`) pero con un texto genérico que miente sobre la causa. |
  | 4 | `official-reports` → `course-report.tsx:240` (`SpecTable`) | Sobrevive vía read-model tras Fase 2; verificar. |
  | — | `answer-sheets`, `failed-stimulus`, `student-report` | Ya degradan bien o quedan cubiertos por el guard de escritura. |

- **Aún no existe ningún assessment `aggregate_only`** → sigue sin cambiar nada para el usuario.

### Fase 4 — Importador
- Módulo `official-report-import` (upload/preview/confirm, patrón `answer-sheets`).
- Contrato + los 5 gates de §6.2.
- Extracción PDF → JSON (skill/pipeline, en la línea de `extraer-pruebas-pdf`).

### Fase 5 — Dashboards de habilidades sobre el read-model
- `dashboards.getSkills` y `heatmap.service` pasan a `assessment_skill_stats`.
- Paridad verificada contra los números actuales (por eso `computed` conserva la definición vieja — §3.2).

### Fase 6 — Carga histórica CSCJ
- Los 48 informes.
- Decisión previa requerida: §9.3.

---

## 8. Riesgos

### 8.1 El fork duplicado de `answer-sheets` (alto)
`answer-sheets.service.ts:476-535` duplica delete + aggregate + insert sin pasar por `computeAndPersist`, y además **diverge**: filtra `isCorrect !== null` antes de agregar (`:490`) y recalcula `isComplete` con `studentsWithPending` (`:497-500`), cosa que `computeAndPersist` no hace. Si el read-model se puebla solo en `computeAndPersist`, cargar una hoja de respuestas lo deja **desincronizado y silenciosamente falso**. Por eso la unificación va en Fase 1 y no se puede diferir.

### 8.2 `recalculateByInstrument` + `performance_bands` (alto)
`performance-bands.service.ts:47` dispara `recalculateByInstrument()` al cambiar umbrales de un instrumento. Para un assessment `aggregate_only` no hay `percentage` que reclasificar: el nivel vino dado por el informe. Debe **saltarlos y reportarlo**, no fallar ni recalcular sobre NULL.

Hay además un pie de bomba que hoy solo está desactivado por suerte: `computeAndPersist` hace early-return con 0 responses (`:150-159`) **antes** del DELETE (`:182-184`), así que hoy un recálculo sobre un assessment sin responses es un no-op inofensivo. Pero con responses **parciales**, el delete+reinsert arrasaría con los niveles importados. El guard de Fase 3 lo convierte en un 409 explícito.

### 8.3 Assessments mixtos — **el caso real de CSCJ** (medio)
Los 8 cursos de Lenguaje Monitoreo 2025 **ya tienen respuestas granulares** en la BDD demo... pero solo de la sección de selección múltiple: el desarrollo se excluyó al digitar (`analisis-clasificacion-niveles-dia.md` §3.2). El informe oficial de esos mismos cursos **sí** trae el desarrollo.

O sea: para esos assessments el informe agregado tiene **más cobertura** que el dato granular, y la granularidad real es **por sección**, no por evaluación.

Este plan **no soporta eso**: la granularidad es por assessment y el importador rechaza con 409 un assessment `item_level`. Es un punto de extensión documentado, no implementado (§8.1 del CLAUDE.md).

**Decidido (9.3): gana el granular** — esos 8 cursos quedan `item_level` y su informe no se importa. El costo de esa decisión está abierto y hay que medirlo: ver **§9.6**.

### 8.4 `benchmark_aggregates` (medio)
`benchmarking-refresh.service.ts:164,181` lo reconstruye desde `assessment_results` + `skill_results`. Un assessment `aggregate_only` aporta `assessment_results` (niveles) pero **no** `skill_results` → `per_skill` quedaría incompleto y `avg_achievement` sesgado (los niveles no traen `percentage`). Debe leer `assessment_skill_stats` o excluir explícitamente los `aggregate_only`. Es la única tabla **sin RLS** y **cross-tenant** del proyecto: un error acá se propaga a otros colegios.

### 8.5 `course-report` con datos agregados (medio)
`buildGeneralResult` (`course-report.service.ts:201-221`) promedia `assessment_results.percentage`, que es NULL en `aggregate_only` → `averageAchievement` sale NULL. Irónicamente es el módulo que **reproduce el informe DIA desde nuestros datos**, así que debería ser el que mejor funcione con un informe DIA importado. Opciones: derivar el promedio desde `assessment_item_stats` (definición agrupada, que es la del propio DIA) o mostrar solo la distribución.

Nota aparte: este servicio ya tiene una divergencia **preexistente** — recalcula el nivel con `percentageToPerformanceLevel` (enum legacy de 4 niveles) en vez de leer `performance_bands`. No la introduce este plan, pero conviene resolverla en la misma pasada.

### 8.6 OCR de la Figura 1 (medio)
El nivel por alumno sale de visión por computador + OCR de nombres, con cruce difuso. Ya produjo 2 casos dudosos en ~290 alumnos. Confirmación humana obligatoria; nunca auto-crear alumnos.

### 8.7 Alumnos sintéticos (crítico si alguien cede a la tentación)
No se pueden reconstruir respuestas por alumno desde los agregados: se sabe que 2 de 43 marcaron A en la P8, no **quiénes**. Los marginales serían correctos y la distribución conjunta, ficción. Además contaminaría `student_count` / `avg_achievement` de `benchmark_aggregates` (§8.4) y violaría la Ley 19.628. **No es una alternativa considerada.**

---

## 9. Decisiones tomadas (2026-07-15)

| # | Decisión | Resuelto |
|---|---|---|
| 9.1 | Arquitectura | **Read-model unificado.** Un lector, dos escritores, un calculador puro. Es lo que describe este plan. |
| 9.2 | Semántica del % por eje | **Conservar la actual.** `computed` sigue siendo la media de porcentajes por alumno; `imported` usa la tasa agrupada. Los números publicados no se mueven. Ver §3.2. |
| 9.3 | Granularidad | **Por assessment; en conflicto gana el granular.** Los 8 cursos de Lenguaje Monitoreo 2025 quedan `item_level` con lo que hay y su informe **no** se importa. Granularidad por sección queda como punto de extensión documentado, no implementado (§8.1 del CLAUDE.md). ⚠️ Ver §9.6. |
| 9.4 | Alcance | **Piloto Lenguaje 2025.** Validar el circuito completo donde ya existen los niveles por alumno (`dia_niveles_lenguaje_2025.csv`, ~290 alumnos). Extracción de Figura 1 semi-manual; automatizar solo si el piloto lo justifica. |
| 9.5 | Visibilidad | **Vía (a) de §2.7:** extender el `EXISTS` de `item-analysis.service.ts:105` para aceptar también `assessment_item_stats`. `students` queda opcional de verdad en el importador. |

### 9.6 ⚠️ Deuda abierta por 9.3 — el eje Reflexionar

**Pendiente de verificar antes de la Fase 6.** La decisión 9.3 tiene un costo que hay que medir, no asumir.

En el informe de **3°A Cierre 2025** el eje *Reflexionar* lo componen únicamente P14 y P19, y **ambas son preguntas de desarrollo**. Como el dato granular de la BDD es MC-only (el desarrollo se excluyó al digitar — `analisis-clasificacion-niveles-dia.md` §3.2), en ese instrumento el eje Reflexionar **no tendría ítems y desaparecería** de `skill_results`: el heatmap y el drill-down de habilidades quedarían sin la habilidad de orden superior.

Lo que hay que comprobar, **informe por informe**, antes de dar 9.3 por buena:

1. ¿Pasa lo mismo en los 8 cursos de **Monitoreo** (que son los que tienen granular), o solo lo verifiqué en un **Cierre**? Son informes distintos y la mezcla de ítems puede cambiar.
2. ¿Se repite en 4°, 5° y 6°, o es específico de 3° básico?
3. Si el eje efectivamente desaparece: ¿se acepta como statu quo (ya es el estado actual de esos cursos hoy, no una regresión), se digita el desarrollo de esas 2 preguntas por curso, o se reabre 9.3 hacia la opción (b)?

Digitar el desarrollo son ~2 preguntas × 8 cursos — puede que sea más barato que cualquiera de las alternativas de diseño, y volvería el punto irrelevante.
