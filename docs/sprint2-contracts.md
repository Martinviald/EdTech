# Sprint 2 — Contratos de Desarrollo Paralelo

> Este documento define las interfaces, endpoints y convenciones que todos los agentes de desarrollo deben respetar. Es la fuente de verdad para evitar conflictos entre workstreams paralelos.

---

## Módulos NestJS a crear (cada uno en su directorio)

| Módulo | Directorio | Responsable |
|--------|-----------|-------------|
| Instruments | `apps/api/src/instruments/` | Agente A |
| Items | `apps/api/src/items/` | Agente A |
| DIA Ingestion | `apps/api/src/dia-ingestion/` | Agente B |
| AI Tagging | `apps/api/src/ai-tagging/` | Agente C |
| Spec Tables | `apps/api/src/spec-tables/` | Agente D |

---

## API Endpoints — Contratos

### Instruments Module (Agente A)

```
GET    /instruments              → { data: InstrumentModel[], total, page, limit }
GET    /instruments/:id          → InstrumentModel (with sections)
POST   /instruments              → InstrumentModel (body: CreateInstrumentDto)
PATCH  /instruments/:id          → InstrumentModel (body: UpdateInstrumentDto)
DELETE /instruments/:id          → 204

GET    /instruments/:id/sections → InstrumentSectionModel[]
POST   /instruments/:id/sections → InstrumentSectionModel (body: CreateInstrumentSectionDto)
PATCH  /instruments/:instrumentId/sections/:sectionId → InstrumentSectionModel
DELETE /instruments/:instrumentId/sections/:sectionId → 204

GET    /grading-scales           → GradingScaleModel[]
POST   /grading-scales           → GradingScaleModel (body: CreateGradingScaleDto)
PATCH  /grading-scales/:id       → GradingScaleModel
DELETE /grading-scales/:id       → 204
```

**Guards:** `@Roles(...ITEM_BANK_ROLES)` para escritura, `@Roles(...ITEM_VIEWER_ROLES)` para lectura.

### Items Module (Agente A)

```
GET    /items                    → { data: ItemModel[], total, page, limit }
GET    /items/:id                → ItemModel (with tags populated)
POST   /items                    → ItemModel (body: CreateItemDto)
PATCH  /items/:id                → ItemModel (body: UpdateItemDto)
DELETE /items/:id                → 204 (soft delete)

POST   /items/:id/tags           → ItemTaxonomyTagModel (body: CreateItemTagDto)
DELETE /items/:id/tags/:tagId     → 204
POST   /items/batch-tag           → { created: number } (body: BatchTagItemsDto)

GET    /items/:id/versions        → ItemVersionModel[]
POST   /items/:id/versions        → ItemVersionModel (body: CreateItemVersionDto)
```

**Guards:** `@Roles(...ITEM_BANK_ROLES)` para escritura, `@Roles(...ITEM_VIEWER_ROLES)` para lectura.

### DIA Ingestion Module (Agente B)

```
POST   /dia-ingestion/upload      → { jobId: string, status: 'pending' }
                                    (multipart: file + DiaIngestionRequestDto)
GET    /dia-ingestion/jobs/:id    → { jobId, status, progress, result }
POST   /dia-ingestion/preview     → { items: DiaItemPreview[], warnings: string[] }
POST   /dia-ingestion/confirm     → { instrumentId, itemsCreated: number }
```

**Flujo:** Upload → Preview (muestra lo parseado) → Confirm (crea instrument + items).

**Guards:** `@Roles(...ITEM_BANK_ROLES)`.

### AI Tagging Module (Agente C)

```
POST   /ai-tagging/suggest        → { suggestions: AiTagSuggestion[][] }
                                    (body: AiTagRequestDto)
POST   /ai-tagging/confirm        → { applied: number, rejected: number }
                                    (body: ConfirmAiTagsDto)
GET    /ai-tagging/history        → { itemId, suggestions, confirmedAt }[]
```

**Integración:** llama Claude API con el contenido del item + nodos del currículum disponibles.

**Guards:** `@Roles(...ITEM_BANK_ROLES)`.

### Spec Tables Module (Agente D)

```
POST   /spec-tables/upload        → { preview: SpecTableRow[], columns: string[] }
                                    (multipart: file Excel/CSV)
POST   /spec-tables/link          → { linked: number, errors: string[] }
                                    (body: SpecTableMappingDto)
GET    /spec-tables/:instrumentId → SpecTableRow[]
```

**Guards:** `@Roles(...ITEM_BANK_ROLES)`.

---

## Convenciones de Código (obligatorias para todos los agentes)

### Estructura de cada módulo NestJS

```
src/{module}/
├── {module}.module.ts          # @Module declaration
├── {module}.controller.ts      # Endpoints REST
├── {module}.service.ts         # Lógica de negocio
├── dto/                        # Re-exporta DTOs de @soe/types (solo si necesita adaptar)
└── lib/                        # Helpers internos del módulo (parsers, etc.)
```

### Imports que TODOS los agentes deben usar

```typescript
// Database injection
import { InjectDb, type Database } from '../database/database.types';

// Auth context
import type { JwtPayload } from '../auth/jwt-payload.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// DB schema (from @soe/db)
import { instruments, items, itemTaxonomyTags, ... } from '@soe/db';

// Types/DTOs (from @soe/types)
import { CreateInstrumentDto, ITEM_BANK_ROLES, ... } from '@soe/types';

// Drizzle operators
import { eq, and, or, inArray, isNull, sql } from 'drizzle-orm';
```

### Patrón de Service (ejemplo)

```typescript
@Injectable()
export class ItemsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(user: JwtPayload, query: ListItemsQueryDto) {
    // SIEMPRE filtrar por org_id del token + deletedAt IS NULL
    const conditions = [
      isNull(items.deletedAt),
      // Items oficiales (orgId null) + items de la org del user
      or(isNull(items.orgId), eq(items.orgId, user.orgId!)),
    ];
    // ... agregar filtros del query
    // ... paginación con offset/limit
  }
}
```

### Patrón de Controller

```typescript
@Controller('items')
@UseGuards(RolesGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @Roles(...ITEM_VIEWER_ROLES)
  list(@CurrentUser() user: JwtPayload, @Query() query: ListItemsQueryDto) {
    return this.itemsService.list(user, query);
  }

  @Post()
  @Roles(...ITEM_BANK_ROLES)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateItemDto) {
    return this.itemsService.create(user, dto);
  }
}
```

### Validación de DTOs

Los DTOs se importan de `@soe/types`. La validación con Zod se hace en el controller usando un pipe o manualmente:

```typescript
import { createItemSchema } from '@soe/types';

// En el controller, antes de pasar al service:
const parsed = createItemSchema.parse(body);
```

### Multi-tenancy (NO NEGOCIABLE)

- Toda query de lectura: `WHERE (org_id = :userOrgId OR org_id IS NULL) AND deleted_at IS NULL`
- Items oficiales (DIA, SIMCE) tienen `org_id = NULL` → visibles para todos
- Items custom de un colegio tienen `org_id = X` → solo visibles para ese colegio
- Al crear: `org_id` viene del `user.orgId` del JWT, NUNCA del body

### Soft Deletes

```typescript
// DELETE endpoint hace soft delete:
await this.db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, id));
```

---

## Schema DB Existente (NO modificar)

Los schemas Drizzle ya están creados en `packages/db/src/schema/`:
- `instruments.ts` — `gradingScales`, `instruments`, `instrumentSections`
- `items.ts` — `items`, `itemTaxonomyTags`, `itemVersions`, `rubrics`, `rubricCriteria`, `rubricLevels`
- `assessments.ts` — `assessments`, `assessmentCourseAssignments`, `assessmentForms`, `importJobs`

**Regla:** ningún agente modifica estos archivos. Si se necesita un cambio de schema, se documenta y se resuelve en la fase de integración.

---

## Archivos Compartidos (NO tocar durante desarrollo paralelo)

Estos archivos se actualizan SOLO en la fase de integración:
- `apps/api/src/app.module.ts` — registrar nuevos módulos
- `packages/types/src/schemas/index.ts` — ya actualizado con los exports
- `packages/types/src/access-policies.ts` — ya actualizado con ITEM_BANK_ROLES

---

## Datos de Seed para Testing

El Agente B (DIA Ingestion) creará un archivo de seed en:
`packages/db/data/dia-2025-lectura-2basico.json`

Formato esperado del JSON de pauta DIA:
```json
{
  "instrument": {
    "name": "DIA Lectura 2° Básico 2025",
    "type": "dia",
    "subject": "Lenguaje y Comunicación",
    "grade": "2° Básico",
    "year": 2025
  },
  "items": [
    {
      "position": 1,
      "type": "multiple_choice",
      "content": {
        "stem": "Lee el siguiente texto y responde...",
        "alternatives": [
          { "key": "A", "text": "...", "isCorrect": false },
          { "key": "B", "text": "...", "isCorrect": true },
          { "key": "C", "text": "...", "isCorrect": false },
          { "key": "D", "text": "...", "isCorrect": false }
        ]
      },
      "scoringConfig": { "points": 1 },
      "tags": [
        { "nodeType": "skill", "nodeCode": "OA1", "tagType": "primary" },
        { "nodeType": "content", "nodeCode": "comprension_literal", "tagType": "secondary" }
      ]
    }
  ]
}
```

---

## Frontend Routes (Fase 2)

| Ruta | Descripción | Agente Frontend |
|------|-------------|-----------------|
| `/banco-items` | Lista del banco de ítems con filtros | E |
| `/banco-items/[instrumentId]` | Detalle de instrumento con sus ítems | E |
| `/banco-items/nuevo` | Formulario creación de instrumento | E |
| `/importar-dia` | Wizard de ingesta DIA (upload → preview → confirm) | F |
| `/importar-dia/[jobId]` | Estado del job de importación | F |
| `/banco-items/[instrumentId]/spec-table` | Vista de tabla de especificaciones | F |

---

## Dependencias entre Agentes (resumen)

```
Agente A (Items CRUD) ──┐
                        │── Agente B puede llamar a ItemsService.createBulk()
Agente B (DIA Parser) ──┘   pero lo implementa como su propio método interno
                             que inserta directamente en la DB usando el mismo
                             patrón (no importa el service de A).

Agente C (AI Tagging) ──── Lee items de la DB (SELECT) + escribe en item_taxonomy_tags.
                           No necesita importar nada del Agente A.

Agente D (Spec Table) ──── Lee items de la DB + escribe tags.
                           Independiente del Agente A.
```

**Clave:** cada agente accede a la DB directamente via Drizzle (inyectado con `@InjectDb()`). No necesitan importar servicios de otros módulos. La coordinación es a nivel de DATOS (mismas tablas), no de código.

---

## Checklist de Entrega por Agente

### Agente A — Items + Instruments CRUD
- [ ] `instruments.module.ts`, `.controller.ts`, `.service.ts`
- [ ] `items.module.ts`, `.controller.ts`, `.service.ts`
- [ ] CRUD completo para instruments (con sections)
- [ ] CRUD completo para items (con tags y versiones)
- [ ] Paginación en listados
- [ ] Soft deletes
- [ ] Tests unitarios del service

### Agente B — DIA Ingestion
- [ ] `dia-ingestion.module.ts`, `.controller.ts`, `.service.ts`
- [ ] `lib/dia-parser.ts` — parser del formato DIA
- [ ] Archivo seed: `packages/db/data/dia-2025-lectura-2basico.json`
- [ ] Flujo upload → preview → confirm
- [ ] Crea instrument + sections + items + tags en una transacción
- [ ] Manejo de errores robusto (filas inválidas no bloquean las válidas)
- [ ] Tests del parser

### Agente C — AI Tagging
- [ ] `ai-tagging.module.ts`, `.controller.ts`, `.service.ts`
- [ ] `lib/prompt-builder.ts` — construye el prompt para Claude API
- [ ] Integración con Claude API (Anthropic SDK)
- [ ] Flujo suggest → review → confirm
- [ ] Guarda historial de sugerencias IA
- [ ] Manejo de rate limits y errores de API
- [ ] Tests con mock de Claude API

### Agente D — Spec Tables
- [ ] `spec-tables.module.ts`, `.controller.ts`, `.service.ts`
- [ ] `lib/excel-parser.ts` — parser genérico de Excel/CSV
- [ ] Flujo upload → preview columnas → mapear → vincular a items
- [ ] Soporta xlsx y csv
- [ ] Tests del parser
