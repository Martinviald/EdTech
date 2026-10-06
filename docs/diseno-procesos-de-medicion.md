# Diseño — Procesos de Medición

> Estado: **implementado** en `feat/procesos-de-medicion` (olas 0-4). El paso a
> producción (§7) está pendiente de ejecutar.
> Ámbito: `packages/db`, `packages/types`, `apps/api`, `apps/web`.
> Relacionado: `docs/diseno-panorama-comparable.md`, `docs/diseno-alcance-docente.md`,
> `docs/Diseño Tablero Maestro.md`.

---

## 1. Problema

Un colegio piensa y trabaja en **procesos de medición**: "el Monitoreo Intermedio",
"el ensayo PAES de agosto", "la evaluación semestral". Son eventos que se planifican,
se aplican durante unas semanas, se cargan y se cierran como una unidad.

La plataforma no tiene ese objeto. Hoy un proceso está repartido en tres lugares
distintos, y ninguna tabla lo representa:

| Dimensión      | Dónde vive hoy                                               |
| -------------- | ------------------------------------------------------------ |
| Año académico  | `class_groups.academic_year_id` (¡no en el instrumento!)     |
| Momento        | `instruments.application_period` (propiedad del instrumento) |
| Tipo de prueba | `instruments.type`                                           |

`DashboardsService.resolveScopedAssessments()`
(`apps/api/src/dashboards/dashboards.service.ts:1559`) es la evidencia directa: para
acotar un proceso hay que cruzar `assessments` × `instruments` × `class_groups` y
aplicar cinco filtros sueltos (`instrumentType`, `subjectId`, `gradeId`,
`applicationPeriod`, más los cursos del año). El propio comentario del método advierte
que el año "vive en `class_groups`, no en el instrumento, así que sin este cruce un
filtro por año no acota nada".

### Consecuencias concretas

1. **No hay a qué apuntar.** No existe una URL de proceso. La navegación obliga a
   reconstruirlo con tres selects en cada visita.
2. **No hay denominador.** La plataforma muestra lo que existe, no lo que _debería_
   existir. Puede decir "hay 61 evaluaciones", nunca "faltan 3 de 64". Todo el trabajo
   de cierre de celdas se hizo fuera del sistema, en scripts, porque no había dónde
   guardarlo.
3. **No hay dónde colgar nada.** El informe oficial en PDF, el análisis IA transversal,
   el acta de cierre, la comparación contra el proceso equivalente del año anterior:
   todos necesitan un identificador estable que no existe.
4. **El momento está en el objeto equivocado.** `application_period` describe el
   instrumento. Si un colegio aplica el instrumento "DIA Monitoreo Intermedio" dentro
   de su proceso interno "Medición de agosto", esas dos cosas están colapsadas en una
   sola columna. `backfill-application-period.ts` ya documenta el síntoma: un
   instrumento compartido por evaluaciones de varios momentos "no tiene un momento que
   deducir".

---

## 2. Definición

> Un **proceso de medición** es un mismo instrumento (o familia de instrumentos)
> aplicado a una población definida dentro de una ventana de tiempo, que el colegio
> cierra como una unidad.

```
Proceso: "DIA Monitoreo Intermedio 2026"
├─ año académico 2026 · marco DIA · momento intermedio
├─ ventana: 2026-08-04 → 2026-08-29
├─ estado: cerrado · cobertura 64/64
│
├─ assessment: Lenguaje 5°A  ─┐
├─ assessment: Lenguaje 5°B   │  la "celda" del runbook operativo
├─ assessment: Matemática 5°A │  (curso × instrumento)
└─ … 64 celdas ───────────────┘
```

La granularidad de abajo **ya existe y es correcta**: un `assessment` es una aplicación
concreta, y `assessment_course_assignments` permite que cubra varios cursos. Lo que
falta es el techo.

### 2.1 El borde: uno o varios

Criterio: **un proceso por ventana de aplicación y marco**, nunca por asignatura ni
por nivel.

| Caso                                                     | Decisión                                |
| -------------------------------------------------------- | --------------------------------------- |
| DIA Monitoreo Intermedio 2026 (5 asignaturas, 4 niveles) | **1 proceso**, 64 celdas                |
| "DIA Monitoreo Intermedio Matemática 2026"               | ❌ es una vista filtrada, no un proceso |
| Ensayo PAES agosto / Ensayo PAES octubre                 | **2 procesos**: se cierran por separado |
| Evaluación semestral 1er semestre 2026                   | **1 proceso** interno del colegio       |

La razón de agrupar por ventana y no por asignatura: _es la unidad que se cierra_. Un
director no cierra "Matemática", cierra "el Monitoreo". Partirlo por asignatura
destruye el indicador de cobertura — cinco barras de progreso donde debería haber una.

Caso que tensiona la regla: una ventana larga donde Lenguaje se aplica en agosto y
Ciencias en octubre. `starts_on`/`ends_on` del proceso son el rango envolvente y la
fecha fina sigue en `assessments.administered_at`, que ya la tiene. No se parte el
proceso.

### 2.2 Identidad

Un proceso queda determinado por `(org_id, academic_year_id, kind, period, slug)`.
Esa tupla es justamente la que hoy hay que reconstruir con tres joins — y es la clave
natural para derivar los procesos que ya ocurrieron (§7).

---

## 3. Decisión de modelado

### 3.1 Entidad de primera clase, no tabla pivote

La alternativa evaluada era una pivote `process_assessments` (N:M). Se descarta:

- Una aplicación concreta pertenece **a un solo proceso**. No apareció ningún caso en
  el modelo actual donde un `assessment` deba contar en dos procesos a la vez.
- Una N:M sin ese caso real obliga a resolver ambigüedad en **cada** agregación:
  ¿este alumno cuenta una vez o dos? Es un costo permanente por una flexibilidad
  hipotética.
- Migrar después de FK a pivote es barato (un `INSERT ... SELECT`). Salir de una
  pivote mal poblada, no.

Se descarta también una **vista materializada** que agrupe por la tupla sin tabla
nueva: es más barata y no toca el modelo, pero no admite nombre editable, ni estado,
ni adjuntos, ni un id estable al que apuntar desde `files` o `ai_analyses`. Sirve como
reporte, no como objeto de producto — y el requisito es tener accesos directos, que es
precisamente lo que una vista no puede dar.

### 3.2 Schema

`packages/db/src/schema/processes.ts` (nuevo archivo de dominio, §3 CLAUDE.md):

```ts
export const measurementProcesses = pgTable(
  'measurement_processes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(), // "monitoreo-intermedio-2026"
    kind: processKindEnum('kind').notNull(),
    // Momento DEL PROCESO. Independiente de instruments.application_period, que
    // describe el instrumento. Nullable: un proceso interno puede no tener momento.
    period: instrumentApplicationPeriodEnum('period'),
    // Marco de referencia (curricula/taxonomies). Nullable para procesos internos.
    taxonomyId: uuid('taxonomy_id').references(() => taxonomies.id),
    status: processStatusEnum('status').default('planned').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    // Población esperada: la definición del DENOMINADOR (§4).
    expectedScope: jsonb('expected_scope').$type<ExpectedScope>().default({}),
    ownerId: uuid('owner_id').references(() => users.id),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at'), // soft delete (§5.1)
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    unique().on(t.orgId, t.slug),
    index('idx_processes_org_year').on(t.orgId, t.academicYearId),
  ],
);
```

Y en `assessments`, **una sola columna nueva**:

```ts
processId: uuid('process_id').references(() => measurementProcesses.id),
```

Nullable a propósito: todo lo que ya existe sigue funcionando mientras se migra.

### 3.3 Enums nuevos (`enums.ts`)

```ts
export const processKindEnum = pgEnum('process_kind', [
  'dia',
  'simce_ensayo',
  'paes_ensayo',
  'evaluacion_interna',
  'cambridge_mock',
  'custom',
]);

export const processStatusEnum = pgEnum('process_status', [
  'planned', // planificado, sin aplicar
  'in_progress', // en aplicación
  'loading', // aplicado, cargando respuestas
  'closed', // cerrado: cobertura completa, resultados firmes
  'archived',
]);
```

`kind` gobierna ícono y layout del dashboard. `taxonomy_id` sigue mandando para la
taxonomía — no se duplica esa autoridad (§5.3 CLAUDE.md).

### 3.4 `expected_scope`: el denominador

JSONB porque varía por `kind` y no se filtra en SQL (§5.4 CLAUDE.md). Declara qué
celdas _debería_ haber:

```ts
type ExpectedScope = {
  classGroupIds?: string[];
  subjectIds?: string[];
  // Excepciones explícitas: celdas que no corresponden (ej. no hay Inglés en 5°B).
  excludedCells?: Array<{ classGroupId: string; subjectId: string }>;
};
```

La cobertura es entonces una resta: celdas esperadas (producto cartesiano menos
exclusiones) contra `assessments` reales con datos. **Este es el aporte central del
diseño**: convierte "hay 61 evaluaciones" en "faltan 3 de 64".

Si `expected_scope` viene vacío, la cobertura se reporta como no definida — nunca se
inventa un denominador.

### 3.5 Multi-tenancy y RLS

`measurement_processes` lleva datos sensibles por colegio ⇒ **RLS obligatorio**.
Añadir a `packages/db/sql/rls-policies.sql` (§5.2; el archivo es la fuente de verdad,
no el schema Drizzle):

```sql
ALTER TABLE "measurement_processes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_processes" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "measurement_processes_tenant_isolation" ON "measurement_processes"
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
```

Toda query del service corre dentro de `withOrgContext(db, orgId, tx => ...)` usando
`tx`, nunca `this.db`.

---

## 4. Superficie de API

Módulo nuevo `apps/api/src/processes/`, con la estructura estándar (§6.1).

| Endpoint                                      | Devuelve                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /measurement-processes`                  | lista paginada `{ data, total, page, limit }`, filtrable por año, kind y status |
| `POST /measurement-processes`                 | crea el proceso (DTO Zod en `packages/types`)                                   |
| `GET /measurement-processes/:id`              | cabecera + cobertura + KPIs                                                     |
| `PATCH /measurement-processes/:id`            | nombre, ventana, estado, `expected_scope`                                       |
| `DELETE /measurement-processes/:id`           | soft delete; desvincula sus evaluaciones                                        |
| `GET /measurement-processes/:id/coverage`     | **informe de rendición**: matriz curso × asignatura                             |
| `GET /measurement-processes/:id/candidates`   | evaluaciones del mismo año sin proceso, para asociarlas                         |
| `POST /measurement-processes/:id/assessments` | asocia/desasocia evaluaciones                                                   |

**No existe `/measurement-processes/:id/results`.** Un endpoint propio de resultados
habría duplicado la lógica del panorama. En su lugar `processId` es un filtro de
primera clase de los dashboards (§4.2): el hub del proceso enlaza a
`/resultados?processId=…` y el panorama muestra un aviso con el nombre del proceso y
un enlace para quitarlo — un filtro que acota sin decirlo es peor que no tenerlo.

### 4.1 Informe de rendición (`/coverage`)

La matriz curso × asignatura con un estado por celda:

| Estado      | Significado                                  |
| ----------- | -------------------------------------------- |
| `missing`   | esperada, sin `assessment`                   |
| `scheduled` | existe el `assessment`, sin respuestas       |
| `partial`   | con respuestas, bajo el N esperado del curso |
| `complete`  | N de respuestas consistente con la matrícula |

El conteo por celda sale de `assessment_results` (alumnos con resultado calculado)
cruzado con `student_enrollments` para atribuir cada resultado a su curso; el
denominador es la matrícula activa de ese curso. Dos evaluaciones que caen en la misma
celda **suman** sus alumnos en vez de que una tape a la otra.

`partial` es el estado que hoy nadie ve y que ya ha costado caro en operación: un
curso cargado a medias se ve idéntico a uno completo. El umbral se calcula contra la
matrícula del curso (`student_enrollments`), no contra una constante.

### 4.2 Impacto en dashboards

`DashboardFiltersQueryDto` gana `processId`. En `resolveScopedAssessments()` el
filtro por proceso **reemplaza** el cruce de cinco filtros por un `eq(assessments.processId, …)`.
Los filtros actuales se conservan intactos: coexisten, y el de proceso es un atajo.
Esto es lo que hace que la migración pueda ser incremental y no un big bang.

---

## 5. Superficie de frontend

| Ruta                              | Contenido                                                               |
| --------------------------------- | ----------------------------------------------------------------------- |
| `/procesos`                       | tarjetas por proceso, agrupadas por año                                 |
| `/procesos/[processId]`           | Resumen: KPIs, avance de rendición y accesos directos a cada evaluación |
| `/procesos/[processId]/rendicion` | matriz curso × asignatura con el estado de cada celda                   |

Dos tabs, no tres: los resultados son el panorama existente acotado por `processId`
(botón "Ver panorama" en la cabecera), no una vista nueva que lo reimplemente.

**Gestión** (sólo `PROCESS_MANAGEMENT_ROLES`), como diálogos sobre Server Actions con
el patrón `Result` del repo:

| Diálogo              | Para qué                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| Crear / editar       | nombre, año, tipo, momento, estado, ventana, notas                          |
| Declarar alcance     | cursos × asignaturas, con el conteo de celdas esperadas en vivo             |
| Asociar evaluaciones | vincula las del año, incluidas las que ya están en otro proceso (las mueve) |

El diálogo de alcance es el que hace que la rendición mida algo: mientras nadie lo use,
la cobertura de un proceso derivado es la tautología del §7 Paso 4.

La tarjeta de proceso es la unidad de navegación nueva: nombre, ventana, barra de
cobertura, estado. El home del directivo pasa a ser una lista de procesos en vez de
tres selects vacíos.

Acceso por rol vía `packages/types/src/access-policies.ts` (constante nueva
`PROCESS_MANAGEMENT_ROLES`), sin listas inline (§6.3).

---

## 6. Plan de implementación

Una PR por ola, todas sobre la misma rama de trabajo. Los tests corren en el CI, no en
local.

> **Estado:** olas 0-4 implementadas. La ola 5 (adopción) queda como punto de
> extensión documentado, no construido.

### Ola 0 — Contratos (bloqueante) ✅

- `packages/types/src/schemas/measurement-process.schema.ts`: Zod de creación,
  actualización, respuesta, cobertura. DTOs separados (§4.1 I).
- Tipo `ExpectedScope` y el helper `expandExpectedCells(scope)` que produce las celdas
  esperadas — **una sola implementación**, compartida por el backfill, el service y
  los tests. Es la semántica compartida entre olas: si se duplica, se desincroniza.
- `slugify()` / `uniqueSlug()` en `packages/types/src/utils/slug.ts`: el nombre del
  proceso se convierte en slug en dos lugares (el service y el backfill) y no existía
  un helper de slug en el repo.
- `PROCESS_MANAGEMENT_ROLES` en `access-policies.ts`.

### Ola 1 — Schema y migración ✅

- `packages/db/src/schema/processes.ts` + enums + `relations()` + export en `index.ts`.
- `assessments.processId` nullable.
- Política RLS en `packages/db/sql/rls-policies.sql`.
- `pnpm db:generate` → revisar que la migración traiga **solo** este delta (riesgo
  conocido de colisión de numeración entre ramas: si `0025` ya existe en dev,
  conservar el meta de dev, borrar el `.sql` propio y regenerar).

### Ola 2 — Script de derivación ✅

`packages/db/src/scripts/backfill-measurement-processes.ts`, siguiendo el patrón de
`backfill-application-period.ts`: `--dry-run` por defecto real, idempotente, reporta lo
que no pudo clasificar en vez de adivinar.

Deriva los procesos existentes agrupando por
`(org_id, año del class_group, instruments.type, instruments.application_period)`:

1. `SELECT DISTINCT` de esa tupla sobre los `assessments` con datos.
2. Crea un `measurement_processes` por grupo, con `name` y `slug` generados, `status:'closed'`
   (son procesos que ya ocurrieron) y ventana derivada de `min/max(administered_at)`.
3. `UPDATE assessments SET process_id = …` para las filas del grupo.
4. `expected_scope` se puebla con los cursos y asignaturas **observados**. Ojo con la
   circularidad: un denominador derivado de lo cargado siempre da 100% de cobertura.
   Es correcto para lo histórico (ya cerrado) y **no** debe usarse para procesos vivos,
   donde el scope lo declara una persona. El script marca estas filas con
   `expected_scope.derived: true` para que la UI no presuma una cobertura que no midió.

Sólo toca `assessments` con `process_id IS NULL`. Correrlo dos veces no cambia nada.

### Ola 3 — Backend ✅

Módulo `processes` completo + `processId` en los filtros de dashboards. Tests unitarios
del service (cobertura, expansión de celdas, casos de scope vacío) e integración del
controller contra DB real con seed (§10.2).

### Ola 4 — Frontend ✅

Rutas, tarjeta de proceso, matriz de rendición, y los tres diálogos de gestión.
Responsive mobile-first desde el inicio (§7.4); la matriz scrollea en su propio
contenedor en vez de romper el ancho de la página.

### Ola 5 — Adopción ⏳ no construida

- `files` puede colgar del proceso: `owner_type:'measurement_process'`,
  `purpose:'informe_oficial'` (la asociación polimórfica ya existe, no requiere schema).
- Los análisis IA transversales apuntan al `process_id`.
- Comparación contra el proceso equivalente del año anterior (mismo `kind` + `period`,
  año distinto).

---

## 7. Paso a producción y backfill

El orden importa: la migración es inerte, el backfill no.

### Paso 1 — Migración de schema (sin riesgo)

```bash
DATABASE_ADMIN_URL=<prod> pnpm --filter @soe/db db:migrate
```

Crea las tablas y enums nuevos, agrega `assessments.process_id` **nullable**, y
re-aplica todas las políticas RLS (incluida la nueva). No modifica ninguna fila
existente. La aplicación anterior sigue funcionando sin cambios: nada lee la columna
todavía.

### Paso 2 — Deploy del backend

Con `process_id` siempre `NULL`, `/processes` devuelve lista vacía y los dashboards se
comportan exactamente como antes (el filtro nuevo es opcional). Ventana segura para
verificar que nada se rompió.

### Paso 3 — Backfill en seco

```bash
DATABASE_ADMIN_URL=<prod> pnpm --filter @soe/db db:backfill:processes --dry-run
```

Revisar el reporte **antes** de escribir:

- Nº de procesos que se crearían y su nombre generado.
- Nº de `assessments` que quedarían sin asignar y por qué.
- ⚠️ **Grupos anómalos**: un proceso con una sola celda, o uno con más celdas que
  cursos × asignaturas del año, indica datos sucios (un instrumento compartido entre
  momentos, el caso que `backfill-application-period.ts` ya documenta). Resolver eso
  antes de escribir, no después.

Contrastar el conteo con una fuente independiente: los 64 del Monitoreo Intermedio 2026
son un número conocido y verificado en operación. Si el dry-run no los reproduce, el
agrupador está mal — no los datos.

### Paso 4 — Backfill real

```bash
DATABASE_ADMIN_URL=<prod> pnpm --filter @soe/db db:backfill:processes
```

Idempotente y acotado a `process_id IS NULL`. Es reversible sin drama:
`UPDATE assessments SET process_id = NULL` + borrar las filas creadas deja el sistema
en el estado del Paso 2. Esa reversibilidad es la razón de que la FK sea nullable.

### Paso 5 — Verificación

- Toda `assessment` con datos tiene `process_id`, o está en la lista de excepciones
  reportada.
- La suma de celdas por proceso reproduce el total de `assessments` (sin duplicados:
  la FK 1:N lo garantiza por construcción, a diferencia de una pivote).
- `/processes` con un usuario del tenant devuelve sólo sus procesos (prueba de RLS:
  una query sin `withOrgContext` debe devolver 0 filas, no todas).

### Paso 6 — Deploy del frontend

Recién acá aparecen las rutas nuevas. Los procesos ya existen y tienen datos, así que
la primera vez que alguien entra ve su historia completa, no una pantalla vacía.

### Paso 7 — Curación

Los nombres derivados son mecánicos ("DIA Intermedio 2026"). Un administrador los
renombra a como el colegio los llama, y declara el `expected_scope` real de los procesos
vivos. Sólo desde ahí la cobertura mide algo.

---

## 8. Riesgos

| Riesgo                                            | Mitigación                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| El agrupador del backfill parte mal los procesos  | Dry-run contrastado contra un conteo conocido (64 del Monitoreo 2026) antes de escribir        |
| Cobertura circular en lo histórico                | `expected_scope.derived: true`; la UI no muestra % de cobertura para esos procesos             |
| Colisión de numeración de migración con otra rama | Conservar meta de dev, borrar el `.sql` propio, regenerar, verificar el delta                  |
| Se olvida la política RLS de la tabla nueva       | Va en `rls-policies.sql`, que `db:migrate` re-aplica siempre                                   |
| Duplicar el filtrado (proceso vs. cinco filtros)  | El filtro de proceso es un atajo dentro de `resolveScopedAssessments()`, no un camino paralelo |

---

## 9. Fuera de alcance

- Planificación/calendarización del proceso antes de aplicarlo (crear las celdas
  esperadas como `assessments` vacíos). El `expected_scope` deja el punto de extensión.
- Notificaciones de avance de carga.
- Procesos que cruzan organizaciones (redes de colegios). El `org_id` NOT NULL lo
  impide a propósito; una red se modela sobre benchmarking, que ya existe.
