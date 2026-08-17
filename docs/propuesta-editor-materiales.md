# Propuesta de Diseño — Editor de Materiales (Motor de Documentos por Bloques)

> Estado: **diseño aprobado (cimientos), pendiente de implementación.** Este documento es el contrato
> técnico del módulo. Las decisiones de cimiento (A–H) están cerradas y registradas en §16. Toda
> implementación debe respetar la regla de oro (§6): `documents` es la capa de autoría/presentación;
> el backbone de medición (`instruments`/`items`/`assessments`/`results`) permanece intacto y se reutiliza.

---

## 0. Resumen ejecutivo

Hoy el material remedial generado por IA solo se puede exportar como PDF plano vía `window.print()`, sin
branding del colegio y sin edición libre. No existe un motor para crear/editar guías, instrumentos o
materiales del banco.

Se propone un **motor de documento genérico basado en bloques** ("Editor de materiales"). La pieza clave
que lo hace reutilizable y escalable a miles de colegios: el motor **no sabe nada de remedial ni de
ítems**. Edita un documento que es una lista ordenada de bloques tipados. Remedial, instrumentos, ítems
del banco, etc. son **fuentes** (se convierten en documento vía *adapters*) y **consumidores** (se
renderizan/exportan). Esto calca el patrón polimórfico-JSONB + Open/Closed que ya usa todo el repo
(`items.content`, `remedial.content`).

Alcance v1 (F1): modelo de datos, motor `<DocumentCanvas>` con ~9 tipos de bloque, puntos de entrada
(remedial, banco de ítems, instrumento, en blanco), especificación derivada (orientación), promoción
opt-in a instrumento (medición), branding básico de organización y export print-CSS con branding.

---

## 1. Diagnóstico del sistema actual

Lo que existe y **se reutiliza** (no se reescribe):

| Pieza | Ubicación | Rol en este módulo |
|---|---|---|
| Material remedial | `remedial_materials` (`content` IA inmutable + `editedContent`) | **Fuente** vía adapter. Sistema de registro de generación IA (§8.3). |
| Ítems polimórficos | `items` (13 tipos, `content` JSONB validado por tipo con Zod) | **Referenciados** por bloques `item`. Sistema de registro medible. |
| Instrumentos + secciones | `instruments`, `instrument_sections` | **Backbone de medición**. Los documentos evaluables se vinculan aquí (opt-in). |
| Tabla de especificaciones | `spec-tables` (módulo API) | **Derivada** de ítems + `item_taxonomy_tags`. `getSpecTable(instrumentId)` la reconstruye. |
| Taxonomía | `taxonomy_nodes`, `item_taxonomy_tags` | Cobertura de OA/habilidades de un documento (agregada desde sus ítems). |
| Resultados / progresión | `assessments → responses → assessment_results / skill_results → dashboards / heatmap / trayectoria` | Fluye automático si el documento se promueve a instrumento. |
| Storage S3 | `apps/api/src/storage` + tabla `files` (polimórfica, RLS, 50MB) | Imágenes de bloques y logo de branding. |
| Markdown seguro | `apps/web/.../assistant/markdown.tsx` (`react-markdown` + `remark-gfm`, sin HTML crudo) | Render de bloques `text`/`callout`. |
| RLS multi-tenant | `withOrgContext` + `packages/db/sql/rls-policies.sql` | Aislamiento por org (con soporte `org_id NULL` para plataforma). |

Lo que **falta** (lo que construimos): un modelo de documento genérico, el motor de edición por bloques,
los adapters de fuentes, branding de organización y un renderer de impresión brandeado.

**No instalado** (relevante): Tiptap/Slate/Lexical/Quill, Puppeteer/Playwright, DOMPurify.

---

## 2. Principios de diseño

1. **El motor es agnóstico de dominio.** `<DocumentCanvas>` recibe bloques y emite bloques. Toda la
   lógica de dominio (remedial, ítems, instrumentos) vive en *adapters*, nunca dentro del motor.
2. **Open/Closed por tipo de bloque.** Agregar un tipo de bloque = un miembro más en la unión Zod +
   registrar su renderer. **Nunca** una migración de schema.
3. **Un solo stack de medición.** No se duplica la analítica. Los documentos evaluables se apoyan en
   `instruments`/`items`/`assessments`/`results` (§6, regla de oro).
4. **El dato almacenado es el cimiento; la UI y el export son reversibles.** El envelope de contenido
   siempre va versionado (`{ version, blocks }`) para migrar el esquema hacia adelante sin reescribir.
5. **Nada hardcodeado a un instrumento/currículo** (CLAUDE.md §5.3, §8.2). Todo por IDs y enums.
6. **Multi-tenancy no negociable.** `org_id` + RLS + `withOrgContext` en toda query (§5.2).

---

## 3. Arquitectura en 4 capas (el desacople)

```
┌─ Capa 4: Puntos de entrada (integración) ───────────────────────────────┐
│  "Abrir en editor" (remedial) · "Nuevo material" · "Agregar ítems"      │
│  (banco) · "Instrumento → material imprimible" · biblioteca /materiales  │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ Capa 3: Adapters (dominio → documento) ─────────────────────────────────│
│  remedialToDocument() · instrumentToDocument() · itemsToBlocks()          │
│  · blankDocument(template) · duplicateDocument() (copy-on-use)            │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ Capa 2: Motor de edición (componente React reutilizable) ───────────────│
│  <DocumentCanvas value onChange/> — controlado, agnóstico                 │
│  BlockRegistry: type → { EditView, PrintView }  (Open/Closed)            │
│  <DocumentRenderer/> (read-only, reusado por editor y ruta de impresión) │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ Capa 1: Modelo de documento (core agnóstico) ───────────────────────────│
│  documents · document_item_refs (tablas) · Block union (Zod)             │
└───────────────────────────────────────────────────────────────────────────┘
```

El `<DocumentCanvas>` (Capa 2) no importa nada de remedial/items. El mismo `BlockRegistry` sirve para
editar (`EditView`) y para renderizar en lectura/impresión (`PrintView`) → DRY total.

---

## 4. Modelo de datos

### 4.1 Tabla `documents` (`packages/db/src/schema/documents.ts`)

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid PK defaultRandom` | |
| `org_id` | `uuid` **nullable** | `NULL` = material de plataforma (plantillas entre colegios, Decisión B). Precedente: `files`, `instrument_sections`. |
| `created_by_id` | `uuid` FK `users` | Propiedad (copy-on-use / copy-on-write). |
| `title` | `text NOT NULL` | |
| `type` | `document_type` enum | `guide · worksheet · assessment · generic`. Extensible. |
| `status` | `document_status` enum | `draft · published · archived`. |
| `visibility` | `document_visibility` enum | `private · department · org · network · platform`. **Default `org`** (Decisión B). |
| `subject_id` | `uuid` FK `subjects` nullable | Faceta de biblioteca (filtro a escala). |
| `grade_id` | `uuid` FK `grades` nullable | Faceta de biblioteca. |
| `node_id` | `uuid` FK `taxonomy_nodes` nullable | OA/habilidad principal a nivel documento (para guías sin ítems). |
| `instrument_id` | `uuid` FK `instruments` nullable | **Binding de medición** (Decisión G2). Se setea solo al promover. |
| `content` | `jsonb .$type<DocumentContent>()` | `{ version: number, blocks: Block[] }` (§5). |
| `source` | `jsonb .$type<DocumentSource>()` | `{ kind, refId? }` — trazabilidad de fork. |
| `branding` | `jsonb .$type<BrandingSnapshot>()` nullable | Snapshot al publicar/exportar (estabilidad). Render por defecto usa branding vivo de la org. |
| `created_at` / `updated_at` / `deleted_at` | `timestamp` | Soft-delete (§5.1). |

Relaciones Drizzle: `org`, `createdBy`, `subject`, `grade`, `node`, `instrument`, y `itemRefs` (one-to-many).

### 4.2 Tabla `document_item_refs` (tabla puente — Decisión A3)

Traza normalizada "qué documentos usan el ítem X" (integridad, deprecación de ítems, métricas de
reutilización). Se **recalcula al guardar** el documento (delete + insert de las refs del doc).

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid PK` | |
| `org_id` | `uuid` nullable | Espeja el doc para RLS. |
| `document_id` | `uuid` FK `documents` `ON DELETE CASCADE` | |
| `item_id` | `uuid` FK `items` | |
| `created_at` | `timestamp` | |
| — | `UNIQUE(document_id, item_id)` | Una ref por par (aunque el ítem aparezca 2× en el doc). |

> Los bloques siguen viviendo en `documents.content` (JSONB). Esta tabla es **solo** el índice de
> referencias, no la fuente de verdad del contenido. Migrar a `document_blocks` normalizado más adelante
> es mecánico gracias al `content.version`.

### 4.3 Enums nuevos (`packages/db/src/schema/enums.ts`)

```
document_type       : ['guide', 'worksheet', 'assessment', 'generic']
document_status     : ['draft', 'published', 'archived']
document_visibility : ['private', 'department', 'org', 'network', 'platform']
```

### 4.4 RLS (`packages/db/sql/rls-policies.sql`)

`documents` y `document_item_refs` llevan `ENABLE` + `FORCE ROW LEVEL SECURITY`. Política de tenant que
**además admite material de plataforma** (`org_id IS NULL`), espejando el patrón de tablas con contenido
compartido:

```sql
CREATE POLICY "documents_tenant_isolation" ON "documents"
  AS PERMISSIVE FOR ALL
  USING (org_id IS NULL OR org_id::text = current_setting('app.current_org_id', true));
```

> ⚠️ Al agregar estas tablas sensibles, sus políticas van en `rls-policies.sql` (re-aplicado en
> `db:migrate`), no en el schema Drizzle (CLAUDE.md §5.2). Toda query en `withOrgContext`.

### 4.5 Branding en `organizations.config`

`orgConfigSchema` (`packages/types/src/schemas/feature.schema.ts`) ya tiene `.passthrough()`. Se agrega
clave tipada `branding`:

```ts
export const orgBrandingSchema = z.object({
  logoFileId: z.string().uuid().nullable().optional(),   // vía tabla `files`, purpose='org_logo'
  displayName: z.string().max(120).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  headerText: z.string().max(200).optional(),
  footerText: z.string().max(300).optional(),
});
```

El logo usa la infra `files` existente (`ownerType='organization'`, `purpose='org_logo'`, presigned S3).

---

## 5. Modelo de bloques

Envelope versionado + unión discriminada por `type`, cada bloque con `id` uuid estable. Vive en
`packages/types/src/schemas/document.schema.ts` (compartido api ↔ web, DRY).

```ts
export const documentContentSchema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema),
});

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().uuid(), type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: z.string() }),
  z.object({ id: z.string().uuid(), type: z.literal('text'), markdown: z.string() }),
  z.object({ id: z.string().uuid(), type: z.literal('list'), style: z.enum(['bullet', 'number']), items: z.array(z.string()) }),
  z.object({ id: z.string().uuid(), type: z.literal('callout'), tone: z.enum(['info', 'tip', 'warning']), title: z.string().optional(), markdown: z.string() }),
  z.object({ id: z.string().uuid(), type: z.literal('item'), itemId: z.string().uuid(), showAnswer: z.boolean(), snapshot: itemSnapshotSchema }),
  z.object({ id: z.string().uuid(), type: z.literal('image'), fileId: z.string().uuid(), caption: z.string().optional(), align: z.enum(['left', 'center', 'right']).optional() }),
  z.object({ id: z.string().uuid(), type: z.literal('divider') }),
  z.object({ id: z.string().uuid(), type: z.literal('spacer'), size: z.enum(['sm', 'md', 'lg']) }),
  z.object({ id: z.string().uuid(), type: z.literal('activity'), title: z.string(), description: z.string(), durationMin: z.number().int().nullable() }),
]);
```

**Bloque `item` (el puente medible):** `itemId` es **autoritativo** — apunta a una fila viva de `items`
que está en la cadena instrument→assessment→results. `snapshot` es una **caché de render** (enunciado,
alternativas, clave) para estabilidad de impresión y velocidad; es refrescable desde el ítem vivo. Mismo
espíritu que `remedialPracticeItemRefSchema` (`{itemId, stem}`), extendido.

Texto rico = **markdown** dentro de bloques `text`/`callout` (Decisión D). El `EditView` del bloque `text`
se implementa detrás de una interfaz `BlockEditProps` para que un futuro editor visual (que serialice a
markdown, o con bump de `version`) se cambie sin tocar datos ni el resto del motor.

---

## 6. Regla de oro — Documentos sobre el backbone de medición

> **NO se construye un stack de medición paralelo. `documents` es la capa de autoría/branding/presentación;
> `instruments`/`items`/`assessments`/`results` siguen siendo los sistemas de registro de la medición.**

Dos familias de documento:

- **Presentación** (`guide`, `generic`): contenido libre, sin ítems, no medibles. Taxonomía a nivel
  documento vía `node_id`.
- **Con ítems** (`worksheet`, `assessment`): los bloques `item` referencian filas vivas de `items`.

Para los documentos con ítems, **especificación y medición son cosas distintas** (resolución de Decisión G2):

| Capacidad | Cómo se obtiene | ¿Requiere promover a instrumento? |
|---|---|---|
| **Especificación (orientar el trabajo)** — cobertura de OA/habilidades, distribución de dificultad | *Derivada* de los `item_taxonomy_tags` de los ítems referenciados (vía `document_item_refs`) | **No.** Disponible siempre en el editor. |
| **Medición** — aplicar, calificar, resultados, progresión, seguimiento | Promoción opt-in → `instrument` → `assessment` → `results` (reutiliza módulos existentes) | **Sí** (acción "Preparar para aplicar / medir"). |

Así, una guía de trabajo tiene su especificación para orientar sin meter ruido al sistema de medición; y
cuando el profesor quiere medir, un clic la promueve y todo fluye a dashboards/heatmap/trayectoria **sin
código de analítica nuevo**. La promoción crea/vincula el `instrument` (`type='custom'`), materializa
`instrument_sections` desde la estructura del doc, y liga los ítems (`items.instrumentId`/`sectionId`).
La tabla de especificaciones completa (import Excel, tagging por posición) queda disponible vía el módulo
`spec-tables` sobre ese instrumento.

---

## 7. Semánticas de copia (fork / copy-on-use / copy-on-write)

- **Fork/snapshot unidireccional (Decisión C):** "Abrir en editor" copia el contenido de la fuente a un
  `document` independiente con `source = {kind, refId}` de backref. Editable libre. No re-sincroniza si la
  fuente cambia. Preserva §8.3 (evidencia IA intacta en `remedial_materials`).
- **Copy-on-use (Decisión B):** usar una plantilla compartida (`visibility` ≥ `org`, o de plataforma con
  `org_id NULL`) crea una **copia propia** del documento (no edita el original). `source.kind='document'`.
- **Copy-on-write por propiedad del ítem (Decisión H):** al editar el contenido de un ítem *dentro* del
  canvas:
  - Ítem del banco **no propio** (oficial/compartido) → se **clona** a un ítem draft de la org y se
    re-vincula el bloque. Original y su historial de medición intactos.
  - Ítem **propio** del documento (ej. `ai_generated` para este material) → **edición in-place** con bump
    de `version` (comportamiento actual de `items.service`).
  - Esta regla se encapsula en el backend (endpoint dedicado, §12), no en el frontend (Clean Architecture).

---

## 8. Adapters (Capa 3)

Funciones puras que convierten una fuente en `Block[]` + metadatos de documento. Viven en el módulo
`documents` del backend (o helpers compartidos si se reusan). No mutan la fuente.

| Adapter | Fuente → Documento |
|---|---|
| `remedialToDocument(remedial)` | `guide`/`practice_set`/`group_plan` → bloques (`heading`, `text`, `activity`, `item`, `callout`). Toma `editedContent ?? content`. |
| `instrumentToDocument(instrument, items)` | Secciones + ítems → `assessment` con bloques `heading` (por sección) + `item`. Habilita versión profesor/alumno vía `showAnswer`. |
| `itemsToBlocks(items)` | Selección del explorador del banco → bloques `item` (append). |
| `blankDocument(template)` | Plantilla mínima por `type`. |
| `duplicateDocument(doc)` | Copy-on-use. |

---

## 9. Motor de edición (Capa 2, frontend)

Ubicación reutilizable: `apps/web/src/components/document-editor/` (no atado a una ruta).

- **`<DocumentCanvas value={blocks} onChange />`** — controlado y puro. Lista de bloques + toolbar
  "insertar bloque" + acciones por bloque (editar inline, subir/bajar, duplicar, borrar). Reordenar con
  botones ↑/↓ en v1 (dnd-kit como mejora posterior). Guardado atómico del `content` completo (autosave con
  debounce + `PATCH /documents/:id`).
- **`BlockRegistry`** — mapa `type → { EditView, PrintView, defaultData }`. Único punto de extensión
  (Open/Closed). Los `PrintView` de `text`/`callout` reutilizan el `react-markdown` seguro existente.
- **`<DocumentRenderer document />`** — read-only, arma la vista desde los `PrintView`. Lo usan el editor
  (preview) y la ruta de impresión standalone (§10) → mismo árbol, un solo lugar de estilos.
- **Agregar ítems del banco:** botón "Agregar ítem" abre el **explorador de ítems existente** reutilizado
  como `Sheet`/`Dialog`; la selección inserta bloques `item`. A la inversa, desde el explorador/colecciones:
  "Agregar a material" → elige/crea documento → append.
- Sigue las reglas de frontend: RSC-first + `<Suspense>` por sección, `useTransition` + `TopProgressBar`
  en filtros, tokens de diseño (sin colores hardcodeados), `PageHeader`/`PageContainer`, toasts `sonner`.

---

## 10. Branding + Export

- **Branding de organización:** pantalla mínima en Configuración para `displayName`, colores, header/footer
  y **subida de logo** (infra `files` + presigned S3). Persistido en `organizations.config.branding` (§4.5).
- **Renderer standalone (lo durable):** ruta `apps/web/.../materiales/[id]/imprimir` que renderiza el
  documento con `<DocumentRenderer>` + cabecera/pie brandeados + CSS `@media print`. Soporta
  `?version=teacher|student` (reutiliza el concepto profesor/alumno de remedial vía `showAnswer`).
- **Export v1 = print-CSS** disparado por `window.print()` (patrón existente de remedial y reportes
  oficiales; cero dependencias nuevas). Salida "mucho mejor que el PDF plano actual".
- **F2 (Decisión E):** **Playwright** (estándar actual, más robusto/mantenido que Puppeteer) apuntando a
  *esa misma ruta* para PDF server-side asíncrono (batch por curso, envío por correo) cuando madure la
  infra de jobs (BullMQ, §12 CLAUDE.md). El renderer no cambia; solo cambia el disparador.

---

## 11. Permisos y visibilidad

- **Roles:** nuevo archivo `packages/types/src/access-policies/documents.ts` con `DOCUMENT_EDITOR_ROLES`
  (docentes + coordinaciones + dirección) y `DOCUMENT_VIEWER_ROLES`. Guards `RolesGuard` +
  `@RequireFeature(...)` si aplica. Nunca listas de roles inline (CLAUDE.md §6.3, rule 05).
- **Propiedad vs visibilidad:** el rol autoriza *usar el módulo*; editar un documento ajeno depende de
  `created_by_id` + `visibility` (v1: puedes editar los propios; los de la org son visibles y se usan por
  copy-on-use). La escalera `private · department · org · network · platform` existe en el enum desde el
  día 1; v1 implementa `private` + `org` (default `org`), con la puerta abierta a restringir/expandir.
- **Aislamiento:** RLS + `withOrgContext` en toda query; material de plataforma vía `org_id NULL`.

---

## 12. Contratos de API (NestJS, `apps/api/src/documents/`)

REST estricto (§6.2), DTOs Zod en `packages/types`, respuestas de lista paginadas.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/documents` | Biblioteca paginada. Filtros: `type`, `status`, `visibility`, `subjectId`, `gradeId`, `q`. |
| `POST` | `/documents` | Crear en blanco o desde fuente (`{ type, source? }`). |
| `GET` | `/documents/:id` | Detalle (bloques + refs hidratadas). |
| `PATCH` | `/documents/:id` | Actualiza `title`/`content`/`status`/`visibility`. Recalcula `document_item_refs`. |
| `DELETE` | `/documents/:id` | Soft-delete. |
| `POST` | `/documents/from-remedial/:remedialId` | Adapter fork (remedial → documento). |
| `POST` | `/documents/from-instrument/:instrumentId` | Adapter (instrumento → documento). |
| `POST` | `/documents/:id/duplicate` | Copy-on-use. |
| `POST` | `/documents/:id/items/:itemId/customize` | Copy-on-write por propiedad (§7, lógica en service). |
| `GET` | `/documents/:id/specification` | Especificación derivada (cobertura taxonómica; sin instrumento). |
| `POST` | `/documents/:id/promote-to-instrument` | Opt-in (G2): materializa/vincula instrumento + secciones + liga ítems. Devuelve `instrumentId`. |
| `PATCH` | `/organizations/me/branding` | Branding de la org (o extender el update de perfil existente). |

---

## 13. Scope F1

**Dentro:** tablas `documents` + `document_item_refs` + enums + RLS; block union Zod versionada;
`<DocumentCanvas>` con los 9 tipos de bloque; `<DocumentRenderer>` + ruta de impresión; adapters
(remedial, instrumento, blank, items del banco, duplicate); especificación derivada; promoción opt-in a
instrumento; branding básico de org (logo + colores + header/footer); export print-CSS con versión
profesor/alumno; biblioteca `/materiales` con facetas.

**Fuera (puntos de extensión documentados, no implementados):** colaboración en tiempo real; WYSIWYG con
estilos arbitrarios; drag-drop tipo Canva; PDF server-side (Playwright, F2); historial/versiones de
documento; plantillas entre colegios/marketplace (`network`/`platform`); generación/edición de documento
asistida por IA (aunque el modelo de bloques no la impide — encaja con `item-edit-proposals`).

---

## 14. Plan de implementación por fases

| Fase | Entregable | Notas |
|---|---|---|
| **0 — Cimientos de datos** | Schema `documents` + `document_item_refs` + enums + RLS + migración; block union Zod en `packages/types`; branding en `orgConfigSchema`. | Base inmutable; se revisa con cuidado. Sin `db:push` en staging/prod. |
| **1 — Motor core** | `<DocumentCanvas>` + `BlockRegistry` + `<DocumentRenderer>` con los 9 bloques; módulo NestJS `documents` (CRUD) con `withOrgContext`; recálculo de `document_item_refs` al guardar. | Motor agnóstico, testeado (helpers puros + fake `Database`). |
| **2 — Puntos de entrada / adapters** | `from-remedial`, `from-instrument`, `blankDocument`, picker de ítems del banco, `duplicate` (copy-on-use), `customize` (copy-on-write). | Botones en detalle de remedial y en explorador del banco. |
| **3 — Especificación + medición** | `GET /:id/specification` (derivada); `promote-to-instrument` (opt-in) reutilizando `spec-tables` + `assessments`; verificar flujo a resultados/heatmap/trayectoria. | Regla de oro §6. |
| **4 — Branding + Export** | Config de branding + subida de logo; ruta de impresión brandeada; versión profesor/alumno; `window.print()`. | Playwright/PDF server = backlog F2. |
| **5 — Biblioteca a escala** | `/materiales` con facetas (`subject`, `grade`, `type`, `visibility`), paginación, RSC-first + Suspense. | Reglas de reactividad de navegación. |

---

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El JSONB de bloques limita consultas a escala | Tabla puente `document_item_refs` para la query crítica ("quién usa el ítem X"); `content.version` habilita migración a `document_blocks` sin rewrite. |
| Divergencia entre snapshot del bloque `item` y el ítem vivo | `itemId` es autoritativo para medición; `snapshot` es caché refrescable; acción "actualizar desde el banco". |
| Documentos evaluables ensucian el banco de instrumentos | Promoción **opt-in** (G2); documentos de guía nunca crean instrumento. |
| Edición de ítem compartido contamina medición de otros | Copy-on-write por propiedad (H). |
| Inyección vía markdown de IA | `react-markdown` sin `rehype-raw` (patrón existente). |
| Fuga entre tenants | RLS + `withOrgContext`; material de plataforma explícito con `org_id NULL`. |

---

## 16. Decisiones cerradas (registro)

| # | Decisión | Resolución |
|---|---|---|
| **A** | Almacenamiento de bloques | Híbrido: JSONB `content` + tabla puente `document_item_refs`. |
| **B** | Propiedad / visibilidad | `visibility` + `created_by_id` de primera clase; default `org`; enum completo `private→platform`; copy-on-use; `org_id` nullable para plataforma. |
| **C** | Relación con la fuente | Fork/snapshot unidireccional; `documents` es capa de autoría sobre los sistemas de registro; **medible/trazable** vía backbone de instrumentos (§6). |
| **D** | Texto rico | Markdown v1; `EditView` de `text` detrás de interfaz para swap a editor visual sin migrar datos. |
| **E** | Export | Renderer standalone + `window.print()` v1; Playwright a la misma ruta para PDF server-side en F2. |
| **F** | Nombres | Dominio `documents` (inglés); UI "Editor de materiales". |
| **G** | Medición | **Opt-in** (G2): promoción a instrumento vía acción explícita; especificación derivada disponible siempre. |
| **H** | Edición de ítem | Copy-on-write si el ítem no es propio; in-place con bump de `version` si es propio. |

---

## Apéndice — Puntos de extensión futuros (no F1)

- **PDF server-side (Playwright)** sobre la ruta de impresión → batch/correo (F2).
- **Editor visual (Tiptap/Lexical/BlockNote)** reemplazando solo el `EditView` de `text` (serializar a markdown o bump de `version`).
- **`document_blocks` normalizado** para colaboración en tiempo real (migración mecánica desde JSONB).
- **Plantillas de plataforma / entre colegios** (`visibility` `network`/`platform`, `org_id NULL`).
- **Generación/edición asistida por IA** de bloques (encaja con `item-edit-proposals` y el patrón §8.3).
- **Más tipos de bloque:** tabla, ecuación, código, embed, rúbrica — cada uno aditivo al `BlockRegistry`.
