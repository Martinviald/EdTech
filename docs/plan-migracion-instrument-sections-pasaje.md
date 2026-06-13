# Plan de migración — `instrument_sections` con texto/archivos (pasaje compartido)

> **Objetivo:** permitir que una sección de instrumento guarde un **texto base (pasaje)** y
> **archivos asociados**, de modo que varios ítems puedan relacionarse a un mismo texto
> (comprensión lectora). Habilita la carga de los JSON extraídos en
> `Histórico Pruebas DIA/extraccion/` (campo `sections[].passage` y `passage.attachments`).
>
> **Para el agente ejecutor:** este plan es autocontenido. Sigue los pasos en orden. Respeta
> `/.claude/CLAUDE.md` (Drizzle, Zod en `packages/types`, RLS, TS estricto, sin `any`).
> Trabaja en un **worktree sobre rama paralela** (no en `dev`/`main`) y **commitea al terminar**.

---

## 0. Contexto y hechos verificados

- Tabla actual: `packages/db/src/schema/instruments.ts` → `instrumentSections` (líneas ~59-71).
  Columnas hoy: `id, instrumentId(FK→instruments, cascade), name, type(sectionTypeEnum),
  order, maxPoints, timeLimitMin, instructions, config(jsonb)`. **No tiene `created_at`/`updated_at`.**
- **`instrument_sections` NO tiene `org_id` ni RLS.** Las tablas de contenido
  (`instruments`, `instrument_sections`, `items`) NO están en `packages/db/sql/rls-policies.sql`
  (solo `students, assessments, import_jobs, responses, assessment_results, skill_results,
  performance_bands`). El aislamiento de contenido es por filtro `org_id` vía el `instrument`.
- **La relación "varios ítems ↔ un texto" YA existe**: `items.sectionId` (FK→instrument_sections).
  Este plan **NO toca `items`**; solo agrega DÓNDE se guarda el texto del pasaje en la sección.
- DTOs de sección: `packages/types/src/schemas/instrument.schema.ts`
  (`createInstrumentSectionSchema`, `updateInstrumentSectionSchema`, `InstrumentSectionModel`).
- Enums Drizzle: `packages/db/src/schema/enums.ts`. Mirror TS de enums de sección viven en
  `instrument.schema.ts` (`SECTION_TYPES`).
- Service que persiste/lee secciones: `apps/api/src/instruments/instruments.service.ts`
  (insert inline en `createInstrument` ~L122, `addSection` ~L200, `updateSection` ~L248,
  populate en getById ~L82 y `getSections` ~L190).
- `schema/index.ts` ya re-exporta `./instruments` → tablas nuevas en ese archivo se exportan solas.
- `types/src/schemas/index.ts` ya re-exporta `./instrument.schema`.
- Migraciones: `pnpm db:generate` (genera SQL) y `pnpm db:migrate` (aplica + re-aplica
  `sql/rls-policies.sql` idempotente). **Nunca `db:push` salvo dev local.**

---

## 1. Decisiones de diseño (fijas)

1. **Pasaje = columnas tipadas en `instrument_sections`** (`passage_title`, `passage_text`,
   `passage_format`), no JSONB. Razón: el texto es contenido estable y consultable; cumple §5.4
   (campos que siempre tienen la misma forma → columnas tipadas). Una sección tiene **a lo más
   un** pasaje (1:1); las preguntas del texto se agrupan por `items.sectionId`.
2. **Archivos = tabla nueva `section_attachments`** (1:N con la sección). Razón: los archivos
   van a S3 (§11) con metadata propia y ciclo de vida (clave S3, mime, estado de subida); una
   tabla con FK e integridad es lo correcto, no un arreglo JSONB. `onDelete: cascade`.
3. **Sin `org_id` ni RLS en `section_attachments`**, por consistencia con `instrument_sections`
   (heredan tenant vía `instrument`). **NO** agregar RLS al schema Drizzle. Si en el futuro se
   protege la familia `instruments` con RLS, se añade la política a `sql/rls-policies.sql`
   (vía `EXISTS` sobre `instrument_sections → instruments`), nunca al schema. (Ver memoria
   "RLS Lost in Squash".)
4. **`passage_format`** soporta `plain | markdown | html`; el contrato JSON hoy usa `plain`.
5. **`attachment_kind`**: `image | audio | pdf | other` (audio cubre listening de inglés a futuro).
6. Compatibilidad: todas las columnas nuevas son **nullable** → migración no rompe filas/instrumentos
   existentes. Sección sin pasaje = `passage_text IS NULL`.

### Alternativa descartada
- Pasaje como tabla `passages` independiente (reusable entre instrumentos): se descarta por ahora
  (YAGNI); el contrato lo modela por-sección. Punto de extensión futuro: agregar `passageId` FK.
- `attachments` como JSONB en la sección: se descarta; los archivos son entidad con ciclo propio.

---

## 2. Cambios en `packages/db` (schema + migración)

### 2.1 Enums nuevos — `packages/db/src/schema/enums.ts`
Agregar al final (junto a los demás `pgEnum`):
```ts
export const passageFormatEnum = pgEnum('passage_format', ['plain', 'markdown', 'html']);
export const attachmentKindEnum = pgEnum('attachment_kind', ['image', 'audio', 'pdf', 'other']);
```

### 2.2 Columnas de pasaje + tabla de adjuntos — `packages/db/src/schema/instruments.ts`
- Importar los enums nuevos arriba: `passageFormatEnum, attachmentKindEnum` (junto a
  `sectionTypeEnum` etc.).
- Extender `instrumentSections` agregando (después de `instructions`):
```ts
  // ── Pasaje / texto base de la sección (comprensión lectora) ──
  passageTitle: text('passage_title'),
  passageText: text('passage_text'),
  passageFormat: passageFormatEnum('passage_format'), // null si la sección no tiene pasaje
```
- Agregar la tabla `section_attachments` (debajo de `instrumentSections`):
```ts
export const sectionAttachments = pgTable('section_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  sectionId: uuid('section_id')
    .notNull()
    .references(() => instrumentSections.id, { onDelete: 'cascade' }),
  kind: attachmentKindEnum('kind').notNull(),
  order: integer('order').default(0).notNull(),
  storageKey: text('storage_key'),   // clave S3 (null mientras no se sube el archivo)
  url: text('url'),                  // url pública/externa opcional
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  note: text('note'),                // descripción (mapea `passage.attachments[].note` del JSON)
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```
- Actualizar `instrumentSectionsRelations` para incluir adjuntos:
```ts
export const instrumentSectionsRelations = relations(instrumentSections, ({ one, many }) => ({
  instrument: one(instruments, {
    fields: [instrumentSections.instrumentId],
    references: [instruments.id],
  }),
  attachments: many(sectionAttachments),
}));

export const sectionAttachmentsRelations = relations(sectionAttachments, ({ one }) => ({
  section: one(instrumentSections, {
    fields: [sectionAttachments.sectionId],
    references: [instrumentSections.id],
  }),
}));
```
- Exportar tipos inferidos (junto a `InstrumentSection`):
```ts
export type SectionAttachment = typeof sectionAttachments.$inferSelect;
export type NewSectionAttachment = typeof sectionAttachments.$inferInsert;
```
> `schema/index.ts` ya hace `export * from './instruments'` → no requiere cambios.

### 2.3 Generar la migración
```bash
pnpm db:generate          # genera packages/db/drizzle/migrations/XXXX_*.sql
```
- **Revisar el SQL generado** antes de aplicar: debe `CREATE TYPE "passage_format"`,
  `CREATE TYPE "attachment_kind"`, `ALTER TABLE "instrument_sections" ADD COLUMN ...` (×3),
  `CREATE TABLE "section_attachments" ...` con la FK `ON DELETE cascade`.
- Aplicar en local: `pnpm db:migrate` (re-aplica `rls-policies.sql` al final; **no** debe
  agregar RLS a las tablas nuevas — es correcto).
- **No** agregar nada a `sql/rls-policies.sql` (decisión §1.3).

---

## 3. Cambios en `packages/types` (Zod + modelos)

Editar `packages/types/src/schemas/instrument.schema.ts`:

### 3.1 Constantes + tipos de enum (mirror del DB)
```ts
export const PASSAGE_FORMATS = ['plain', 'markdown', 'html'] as const;
export type PassageFormat = (typeof PASSAGE_FORMATS)[number];

export const ATTACHMENT_KINDS = ['image', 'audio', 'pdf', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
```

### 3.2 Schemas de pasaje y adjunto
```ts
export const sectionAttachmentInputSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  order: z.number().int().min(0).default(0),
  storageKey: z.string().max(1024).optional(),
  url: z.string().url().optional(),
  fileName: z.string().max(300).optional(),
  mimeType: z.string().max(150).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  note: z.string().max(2000).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const passageSchema = z.object({
  title: z.string().max(300).optional(),
  text: z.string().min(1),
  format: z.enum(PASSAGE_FORMATS).default('plain'),
});
```

### 3.3 Extender el DTO de sección (fluye a createInstrument por `sections[]`)
En `createInstrumentSectionSchema` agregar:
```ts
  passage: passageSchema.optional(),
  attachments: z.array(sectionAttachmentInputSchema).optional(),
```
`updateInstrumentSectionSchema` (= `.partial()`) los hereda como opcionales automáticamente.

### 3.4 Modelos de respuesta (API shape)
Agregar el modelo de adjunto y extender `InstrumentSectionModel`:
```ts
export type SectionAttachmentModel = {
  id: string;
  sectionId: string;
  kind: AttachmentKind;
  order: number;
  storageKey: string | null;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string | Date;
  updatedAt: string | Date;
};
```
En `InstrumentSectionModel` agregar:
```ts
  passageTitle: string | null;
  passageText: string | null;
  passageFormat: PassageFormat | null;
  attachments?: SectionAttachmentModel[];
```

---

## 4. Cambios en `apps/api/src/instruments`

Objetivo: persistir y devolver pasaje + adjuntos. Mantener Clean Architecture (lógica en service).

### 4.1 `instruments.service.ts`
- Importar `sectionAttachments` desde `@soe/db` (junto a `instrumentSections`).
- **Helper** privado para mapear el `passage` del DTO a columnas:
```ts
private passageColumns(p?: { title?: string; text: string; format?: PassageFormat }) {
  if (!p) return {};
  return { passageTitle: p.title ?? null, passageText: p.text, passageFormat: p.format ?? 'plain' };
}
```
- **`createInstrument`** (insert inline de secciones, ~L122): al insertar cada sección, hacer
  `.returning({ id: instrumentSections.id })`, esparcir `...this.passageColumns(section.passage)`,
  y si `section.attachments?.length`, insertar las filas en `sectionAttachments` con ese `sectionId`.
- **`addSection`** (~L200): idem (passage columns + attachments).
- **`updateSection`** (~L248): incluir las columnas de pasaje en el `.set(...)`; para `attachments`
  en update, estrategia simple y explícita: si `dto.attachments` viene definido, **reemplazar**
  (delete de los existentes de esa sección + insert de los nuevos) dentro de una transacción.
  Documentar este comportamiento de reemplazo.
- **Lectura** (getById ~L82 y `getSections` ~L190): traer los adjuntos por sección
  (subconsulta/`inArray(sectionAttachments.sectionId, ids)` y agrupar, u `with: { attachments }`
  vía query relacional de Drizzle) y exponer `passageTitle/passageText/passageFormat` +
  `attachments` en el `InstrumentSectionModel`.
- Si las operaciones tocan varias tablas (sección + adjuntos), envolver en transacción
  (`this.db.transaction(...)`). **Nota RLS:** estas tablas NO tienen RLS, así que NO requieren
  `withOrgContext`; mantener el patrón existente del service (no introducir `withOrgContext` aquí).

### 4.2 `dto/instrument.dto.ts` y `instruments.controller.ts`
- Si los DTOs son wrappers de los schemas Zod de `@soe/types`, no requieren cambios de forma
  (heredan `passage`/`attachments`). Verificar que la validación en el controller use el schema
  actualizado. Ajustar tipos si están declarados manualmente.

---

## 5. Tests

- `apps/api`: extender los tests del módulo instruments (service y/o controller con supertest):
  1. crear instrumento con una sección que trae `passage` (+ `attachments`) → leer y verificar
     que `passageText`, `passageFormat` y `attachments` vuelven correctos.
  2. `updateSection` con `attachments` definido → reemplaza; con `attachments` undefined → no toca.
  3. borrar sección → `section_attachments` se eliminan por cascade (verificar).
- Usar DB de test real con seed (no mockear DB; §10.2).

---

## 6. Documentación

- Actualizar `docs/Diseño bdd.md` (fuente de verdad del modelo) con las columnas nuevas de
  `instrument_sections` y la tabla `section_attachments` (§13).
- Nota breve en el plan de extracción / contrato: el import mapeará
  `sections[].passage → {passageTitle, passageText, passageFormat}` y
  `passage.attachments[] → section_attachments` (kind/note; `storageKey` se llena al subir a S3).

---

## 7. Verificación final (checklist)

```bash
pnpm db:generate     # migración generada y revisada (2 CREATE TYPE, 3 ADD COLUMN, 1 CREATE TABLE)
pnpm db:migrate      # aplica en local; rls-policies.sql se re-aplica sin tocar tablas nuevas
pnpm typecheck       # sin errores
pnpm lint            # sin warnings
pnpm test            # tests de instruments en verde
```
- [ ] Enums `passage_format` y `attachment_kind` creados.
- [ ] `instrument_sections` tiene `passage_title/passage_text/passage_format`.
- [ ] `section_attachments` creada con FK cascade, sin `org_id`, sin RLS.
- [ ] Zod `passageSchema`/`sectionAttachmentInputSchema` + DTOs de sección extendidos.
- [ ] Service persiste y devuelve pasaje + adjuntos; cascade verificado.
- [ ] `docs/Diseño bdd.md` actualizado.
- [ ] Migración existente NO regenerada/aplanada (no se pierde RLS).

---

## 8. Fuera de alcance (no implementar aquí)

- Endpoints de subida de archivos a S3 / presigned URLs (solo se deja la columna `storageKey`).
- Script de import de los JSON a la BDD (fase aparte; este plan solo habilita el esquema).
- Carga de pauta (`correctKey`/`isCorrect`) y tabla de especificaciones.
- Cambios en `items` (ya tienen `sectionId`; la relación pregunta↔texto ya está cubierta).

---

## 9. Ejecución (metodología del proyecto)

1. Crear rama + worktree paralelo desde `dev` (p.ej. `feat/instrument-sections-passage`).
2. Implementar §2→§6 en ese worktree.
3. Correr §7. **Commitear** al terminar (regla de worktree: si no commiteas, se pierde el trabajo).
4. Mensaje de commit sugerido:
   `feat(db): instrument_sections acepta pasaje (texto) y section_attachments (archivos)`.
