# Sprint 3 — Contratos de Desarrollo Paralelo

> Este documento es la fuente de verdad de endpoints, response shapes y reglas de calidad para todos los agentes del Sprint 3. **Léelo completo antes de escribir cualquier código.**

Historias del sprint:
- **H4.6** Subir hojas DIA en bloque
- **H4.5** Importar Excel/CSV de Gradecam, ZipGrade
- **H16.3** Plantillas Gradecam/ZipGrade
- **H16.4** Parser oficial DIA (Agencia de Calidad)
- **H5.7** Escalas configurables % → nota

---

## Módulos NestJS a crear (un directorio por agente — cero solapamiento de archivos)

| Agente | Directorio | Historias |
|---|---|---|
| **A** | `apps/api/src/answer-sheets/` | H4.5, H4.6, H16.3, H16.4 |
| **B** | `apps/api/src/grading-scales/` | H5.7 |
| **C** | `apps/api/src/assessment-results/` | apoya H4.5–H4.6 |

Frontend:

| Agente | Directorio | Historias |
|---|---|---|
| **D** | `apps/web/src/app/(dashboard)/importar-resultados/` | H4.5–H16.4 |
| **E** | `apps/web/src/app/(dashboard)/configuracion/escalas/` | H5.7 |

---

## Agente A — Answer Sheets (`apps/api/src/answer-sheets/`)

### Endpoints

```
POST   /answer-sheets/upload              → AnswerSheetUploadResponse
                                            multipart: file + AnswerSheetUploadMetadataDto fields
POST   /answer-sheets/preview              → AnswerSheetPreviewResponse
                                            body: { previewToken }
POST   /answer-sheets/confirm              → AnswerSheetConfirmResponse
                                            body: AnswerSheetConfirmRequestDto
GET    /answer-sheets/jobs/:jobId          → ImportJobModel
GET    /answer-sheets/templates             → AnswerSheetTemplate[]
GET    /answer-sheets/templates/:format     → AnswerSheetTemplate (404 si no existe)
```

### Estructura de archivos

```
apps/api/src/answer-sheets/
├── answer-sheets.module.ts
├── answer-sheets.controller.ts
├── answer-sheets.service.ts
├── answer-sheets.service.spec.ts
├── lib/
│   ├── parsers/
│   │   ├── gradecam-parser.ts
│   │   ├── zipgrade-parser.ts
│   │   ├── dia-official-parser.ts
│   │   ├── generic-csv-parser.ts
│   │   └── parser.types.ts        ← ParsedRow, ParserResult
│   ├── preview-store.ts            ← Cache en memoria por previewToken (TTL 30 min)
│   └── student-matcher.ts          ← Match alumnos por RUT/email
└── dto/                             ← Re-exporta Zod schemas de @soe/types si necesita adaptar
```

### Flujo de ingesta

1. `POST /answer-sheets/upload`: recibe archivo multipart + metadata (`format`, `instrumentId`, opcional `classGroupId`, `assessmentId`, `columnMapping`). Parsea el archivo a `ParsedRow[]`, lo persiste en memoria con `previewToken`. **No persiste a DB todavía.**
2. `POST /answer-sheets/preview`: con el `previewToken`, devuelve la previsualización (filas con matched students, errores, summary).
3. `POST /answer-sheets/confirm`: con el `previewToken`, en transacción:
   - Crea o reusa un `assessment` (filtrado por `org_id` del usuario)
   - Inserta `responses` (1 por student × item), calculando `isCorrect`, `rawScore`, `finalScore` contra la pauta del instrumento
   - Crea registro en `import_jobs` con el resultado
   - Llama al calculador puro (`packages/types/src/utils/grade-calculator.ts`) para `assessment_results` y `skill_results`
   - Inserta resultados aggregados — **batch insert con `.values([...])`, NO en loop**
   - Si la grading scale del instrumento es null, usa la escala default del org (o `linear_chilean` genérica como fallback)
4. `GET /answer-sheets/jobs/:jobId`: poll status.

### Parsers — contrato común

Cada parser exporta:
```typescript
export interface ParserResult {
  rows: Array<{
    rowNumber: number;
    studentRut: string | null;
    studentFullName: string | null;
    answers: Record<string, string | null>; // itemPosition → key seleccionada (o null si en blanco)
    errors: AnswerSheetRowError[];
  }>;
  detectedColumns: string[];
  warnings: string[];
}

export function parseXxx(buffer: Buffer): ParserResult;
```

Templates esperados:
- **`gradecam_csv`**: columnas `Student ID, First Name, Last Name, Q1, Q2, ...`
- **`zipgrade_csv`**: columnas `Student First Name, Student Last Name, Student ID, Q01, Q02, ...`
- **`dia_official`**: formato Agencia de Calidad (puede ser CSV con columnas `RUT, Nombre, Apellido, p1, p2, ...` — implementar la versión documentada, si la real no está disponible)
- **`generic_csv`**: columnas configurables via `columnMapping`

### Datos de seed

Crear `packages/db/data/answer-sheets-sample/`:
- `dia-2025-lectura-2basico-respuestas.csv` (~10 alumnos del seed existente, respuestas inventadas)
- `gradecam-sample.csv`
- `zipgrade-sample.csv`

### Guards

```typescript
@Controller('answer-sheets')
@UseGuards(RolesGuard)
@Roles(...ANSWER_SHEET_IMPORT_ROLES)
```

---

## Agente B — Grading Scales (`apps/api/src/grading-scales/`)

### Endpoints

```
GET    /grading-scales                       → GradingScaleListResponse  { data, total, page, limit }
                                                Query: ?page=&limit=&type=&isGlobal=
GET    /grading-scales/:id                   → GradingScaleResponseModel
POST   /grading-scales                       → GradingScaleResponseModel  (body: GradingScaleCreateDto)
PATCH  /grading-scales/:id                   → GradingScaleResponseModel  (body: GradingScaleUpdateDto)
DELETE /grading-scales/:id                   → 204
POST   /grading-scales/:id/preview           → GradingScalePreviewResponse  (body: { percentages: number[] })
```

### Estructura de archivos

```
apps/api/src/grading-scales/
├── grading-scales.module.ts
├── grading-scales.controller.ts
├── grading-scales.service.ts
├── grading-scales.service.spec.ts
└── lib/
    └── conversion.ts   ← Wrappers sobre packages/types/src/utils/grade-calculator.ts (opcional)
```

### Notas

- La tabla `grading_scales` **no tiene `deletedAt`** (chequeado en `packages/db/src/schema/instruments.ts`). DELETE es hard delete pero debe validar que no haya instrumentos usándola — si los hay, devolver 409 Conflict con mensaje claro.
- Multi-tenancy: escalas con `org_id = null` son globales (visibles para todos), las custom de un colegio tienen `org_id = X`.
- Solo `platform_admin` puede crear/editar/borrar escalas globales (orgId null). El resto sólo puede tocar las de su org.
- Validación: `minGrade < passingGrade < maxGrade`, `0 < passingThreshold < 1`.

### Guards

```typescript
@Controller('grading-scales')
@UseGuards(RolesGuard)
// Lecturas: ANSWER_SHEET_IMPORT_ROLES (incluye eval_coordinator)
// Escrituras: GRADING_SCALE_ROLES
```

---

## Agente C — Assessment Results (`apps/api/src/assessment-results/`)

### Endpoints

```
POST   /assessments/:assessmentId/results/calculate
                                              → CalculateAssessmentResultsResponse
                                                body: CalculateAssessmentResultsRequestDto
GET    /assessments/:assessmentId/results
                                              → AssessmentResultsListResponse
                                                Query: ?classGroupId=&performanceLevel=&page=&limit=
GET    /assessments/:assessmentId/skill-results
                                              → SkillResultsListResponse
                                                Query: ?classGroupId=&page=&limit=
GET    /assessments/:assessmentId/results/:studentId
                                              → StudentResultDetail
```

### Estructura de archivos

```
apps/api/src/assessment-results/
├── assessment-results.module.ts
├── assessment-results.controller.ts
├── assessment-results.service.ts
├── assessment-results.service.spec.ts
└── lib/
    └── result-aggregator.ts   ← Helpers para leer responses + grading scale + tags y delegar al calculador puro
```

### Notas críticas

- **Calculador puro:** importar `aggregateStudentResults`, `aggregateSkillResults` desde `@soe/types` (`packages/types/src/utils/grade-calculator.ts`). NO duplicar lógica.
- **Multi-tenancy:** filtrar `assessments.orgId === user.orgId` antes de cualquier acceso.
- **Scoping de profesor:** si el caller es `teacher` o `homeroom_teacher` (y NO tiene también `school_admin` o `academic_director`), filtrar resultados por sus `teacher_assignments` (sólo cursos asignados al user). Usar `userHasAnyRole(user.roles, ['school_admin', 'academic_director', ...])` para distinguir.
- **Recálculo:** borra los `assessment_results` y `skill_results` previos del assessment y los reinsert en batch.
- **Performance level:** usar el calculador puro; thresholds configurables vía `gradingScale.config.performanceThresholds`.

### Guards

```typescript
@Controller()  // rutas con prefix /assessments
@UseGuards(RolesGuard)
// Lecturas: RESULTS_VIEWER_ROLES
// POST /calculate: RESULTS_RECALCULATE_ROLES
```

---

## Frontend D — Importar Resultados (`apps/web/src/app/(dashboard)/importar-resultados/`)

### Rutas

| Ruta | Tipo | Descripción |
|---|---|---|
| `/importar-resultados` | Server Component | Landing: instrucciones + selector de formato + plantillas |
| `/importar-resultados/cargar` | Client Component | Upload archivo + selección de instrumento + curso |
| `/importar-resultados/preview` | Client Component | Tabla de filas parseadas + errores + botón confirmar |
| `/importar-resultados/jobs/[jobId]` | Server Component | Estado del job + resumen + link a resultados |

### Patrón

```typescript
// Server Component (page.tsx):
const session = await auth();
if (!session?.user?.orgId) redirect('/login');
if (!canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES)) redirect('/dashboard');

const instruments = await apiGet<InstrumentListResponse>('/instruments?type=dia&isOfficial=true');
const templates = await apiGet<AnswerSheetTemplate[]>('/answer-sheets/templates');
```

### Mutations

`actions.ts`:
```typescript
'use server';
export async function uploadAnswerSheetAction(formData: FormData): Promise<AnswerSheetUploadResponse>
export async function previewAnswerSheetAction(token: string): Promise<AnswerSheetPreviewResponse>
export async function confirmAnswerSheetAction(token: string, opts: AnswerSheetConfirmRequestDto): Promise<AnswerSheetConfirmResponse>
```

### Tipar con los Models del contrato

```typescript
import type {
  AnswerSheetUploadResponse,
  AnswerSheetPreviewResponse,
  AnswerSheetConfirmResponse,
  AnswerSheetTemplate,
} from '@soe/types';
```

---

## Frontend E — Escalas de Notas (`apps/web/src/app/(dashboard)/configuracion/escalas/`)

### Rutas

| Ruta | Tipo | Descripción |
|---|---|---|
| `/configuracion/escalas` | Server Component | Lista de escalas (globales + de la org) |
| `/configuracion/escalas/nueva` | Client Component | Form de creación |
| `/configuracion/escalas/[id]` | Server Component | Detalle + edit + preview de conversiones |

### Patrón

```typescript
const session = await auth();
if (!session?.user?.orgId) redirect('/login');
if (!canAccess(session.user.roles, GRADING_SCALE_ROLES)) redirect('/dashboard');

const scales = await apiGet<GradingScaleListResponse>('/grading-scales?limit=50');
```

### Mutations

```typescript
'use server';
export async function createGradingScaleAction(input: GradingScaleCreateDto): Promise<GradingScaleResponseModel>
export async function updateGradingScaleAction(id: string, input: GradingScaleUpdateDto): Promise<GradingScaleResponseModel>
export async function deleteGradingScaleAction(id: string): Promise<void>
export async function previewConversionAction(id: string, percentages: number[]): Promise<GradingScalePreviewResponse>
```

---

## Convenciones de código (obligatorias)

### Imports estándar (backend)

```typescript
// Database injection
import { InjectDb, type Database } from '../database/database.types';

// Auth
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// DB schema (from @soe/db)
import { assessments, responses, assessmentResults, skillResults, gradingScales, ... } from '@soe/db';

// Types/DTOs (from @soe/types)
import {
  ANSWER_SHEET_IMPORT_ROLES,
  GRADING_SCALE_ROLES,
  RESULTS_VIEWER_ROLES,
  RESULTS_RECALCULATE_ROLES,
  answerSheetConfirmRequestSchema,
  type AnswerSheetUploadResponse,
  // ...
} from '@soe/types';

// Drizzle
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
```

### Multi-tenancy (NO NEGOCIABLE)

- Toda query filtra por `org_id` del JWT (`user.orgId`).
- Excepciones autorizadas: lectura de instruments/items oficiales (`org_id IS NULL`).
- Al crear: `org_id` siempre proviene del JWT (`user.orgId`), nunca del body.

### Soft deletes

- `assessments` no tiene `deletedAt` — usar `status = 'cancelled'`.
- `assessment_results` y `skill_results` no tienen `deletedAt` — recálculo es delete + reinsert (en transacción).
- `grading_scales` no tiene `deletedAt` — hard delete con validación de FK constraint (instrumentos que la usen).

### Batch operations

- Inserts masivos siempre con `.values([...])` en un solo `INSERT`.
- No insertar dentro de loops `for/await` — agrupar y hacer un solo round-trip.

### Validación

- DTOs validados con Zod en el controller antes de pasar al service (`schema.parse(body)`).
- Multipart: validar metadata con `safeParse` sobre los fields del form.

### Paginación

- Endpoints de lista retornan exactamente `{ data: T[], total, page, limit }`.

### AI scores

- N/A en este sprint (no hay AI grading), pero si se persisten campos `aiScore`/`humanScore`/`finalScore` en `responses`, **preservar valores originales**, nunca hardcodear `1.00`.

---

## Schema DB existente (NO modificar)

Los schemas usados por S3 ya están definidos:
- `packages/db/src/schema/assessments.ts` — `assessments`, `assessmentCourseAssignments`, `assessmentForms`, `importJobs`
- `packages/db/src/schema/responses.ts` — `responses`, `aiGradingJobs`
- `packages/db/src/schema/results.ts` — `assessmentResults`, `skillResults`
- `packages/db/src/schema/instruments.ts` — `gradingScales`

Importar desde `@soe/db`. Ningún agente modifica estos archivos.

---

## Archivos compartidos (NO tocar durante desarrollo paralelo)

Estos se actualizan SOLO en la fase de integración:

- `apps/api/src/app.module.ts` — registrar módulos nuevos
- `apps/web/src/components/layout/nav-items.ts` — agregar nav items
- `packages/types/src/schemas/index.ts` — **ya actualizado** con los exports del S3
- `packages/types/src/access-policies.ts` — **ya actualizado** con `ANSWER_SHEET_IMPORT_ROLES`, `GRADING_SCALE_ROLES`, `RESULTS_VIEWER_ROLES`, `RESULTS_RECALCULATE_ROLES`
- `packages/types/src/utils/grade-calculator.ts` — calculador puro, importarlo desde `@soe/types`

---

## Checklist de entrega por agente

### Agente A — Answer Sheets
- [ ] `answer-sheets.module.ts`, `.controller.ts`, `.service.ts`
- [ ] Parsers en `lib/parsers/` para los 4 formatos
- [ ] Preview store en memoria (TTL 30 min)
- [ ] Student matcher por RUT (case-insensitive, normaliza el formato chileno)
- [ ] Flujo upload → preview → confirm en transacción
- [ ] Crea `responses` calculando `isCorrect` + `rawScore` + `finalScore` contra la pauta
- [ ] Llama al calculador puro de `@soe/types` para crear `assessment_results` + `skill_results` (batch insert)
- [ ] Tracking via `import_jobs`
- [ ] Manejo robusto de errores por fila (skipErrorRows)
- [ ] Tests del service (≥8 tests cubriendo upload, preview, confirm, error rows, multi-tenancy)
- [ ] Datos de seed en `packages/db/data/answer-sheets-sample/`

### Agente B — Grading Scales
- [ ] `grading-scales.module.ts`, `.controller.ts`, `.service.ts`
- [ ] CRUD completo
- [ ] Endpoint `/preview` con previsualización de conversiones
- [ ] Validación de min < passing < max, 0 < threshold < 1
- [ ] Tests (≥8) cubriendo CRUD, validación, multi-tenancy, conflict en delete con FK

### Agente C — Assessment Results
- [ ] `assessment-results.module.ts`, `.controller.ts`, `.service.ts`
- [ ] Endpoint `POST /assessments/:id/results/calculate` — usa el calculador puro
- [ ] Endpoints de lectura: list, by student, skill-results
- [ ] Scoping por `teacher_assignments` cuando el caller es teacher puro
- [ ] Tests (≥8) cubriendo cálculo, scoping, recálculo, multi-tenancy

### Agente D — Frontend Importar Resultados
- [ ] `/importar-resultados/page.tsx` (Server, lista de templates + acceso al wizard)
- [ ] `/importar-resultados/cargar/page.tsx` (Client, upload + selección)
- [ ] `/importar-resultados/preview/page.tsx` (Client, tabla preview + confirmar)
- [ ] `/importar-resultados/jobs/[jobId]/page.tsx` (Server, status)
- [ ] `actions.ts` con server actions: upload, preview, confirm
- [ ] Tipos importados de `@soe/types` (`AnswerSheetUploadResponse`, etc.)
- [ ] `canAccess(roles, ANSWER_SHEET_IMPORT_ROLES)` en cada página
- [ ] Mobile-first responsive
- [ ] UI en español

### Agente E — Frontend Escalas
- [ ] `/configuracion/escalas/page.tsx` (Server, lista)
- [ ] `/configuracion/escalas/nueva/page.tsx` (Client, form crear)
- [ ] `/configuracion/escalas/[id]/page.tsx` (Server, detalle + edit + preview)
- [ ] `actions.ts` con server actions: create, update, delete, previewConversion
- [ ] Tipos importados de `@soe/types` (`GradingScaleResponseModel`, etc.)
- [ ] `canAccess(roles, GRADING_SCALE_ROLES)` en cada página
- [ ] Mobile-first responsive
- [ ] UI en español
