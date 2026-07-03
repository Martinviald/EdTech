# Plan — Seeder de taxonomía real (OA oficial + indicadores/skills DIA) + tags de ítems

> **Objetivo:** reemplazar la taxonomía generada por IA por la **real**, sembrando `taxonomy_nodes`
> desde el catálogo construido a partir del currículo oficial (OA) y los informes DIA (indicadores,
> habilidades, tipos de texto), y luego asociar cada ítem a sus nodos vía `item_taxonomy_tags`.
>
> **Para el agente ejecutor:** plan autocontenido. Respeta `/.claude/CLAUDE.md` (Drizzle, Zod en
> `packages/types`, TS estricto, sin `any`). Trabaja en **worktree sobre rama paralela** y **commitea**.

---

## 0. Insumos (ya generados, fuera del repo)

En `Histórico Pruebas DIA/taxonomia-oficial/`:
- `taxonomia-catalogo.json` — **674 nodos**: `axis` (8, oficial MINEDUC), `learning_objective`
  (324, oficial), `descriptor` (332, indicadores DIA), `skill` (7), `text_type` (3).
  Cada nodo: `{ code, type, name, parentCode, subjectCode, level?, oaNumber?, shortName?, source, order }`.
  `source` ∈ {`mineduc`, `dia`}. Codes globales únicos. `parentCode`: descriptor→OA, OA→eje, axis/skill/text_type→null.
- `item-tags-plan.json` — `{ plan: [ { instrument, position, tags: [ { code, type, tagType } ] } ] }`,
  612 ítems → 2448 tags. `instrument` = ruta del JSON del instrumento (ej. `extraccion/lenguaje/3º lenguaje cierre 2025.json`).

**Paso 0:** copiar ambos a `packages/db/data/` (mismo patrón que `data/mineduc-2024.json`):
`taxonomia-catalogo.json` y `item-tags-plan.json`.

---

## 1. Hechos verificados del schema

- `taxonomies` (id, name, type `taxonomy_type`, language, version, isOfficial, orgId, metadata).
  Índice único parcial `(type, version)` para oficiales con `orgId IS NULL`.
- `taxonomy_nodes` (id, taxonomyId→cascade, parentId self-FK, type `taxonomy_node_type`, code,
  name, description, gradeId→grades, subjectId→subjects, order, depth, metadata). **Único `(taxonomyId, code)`** (parcial, code not null).
- `item_taxonomy_tags` (id, itemId→items cascade, nodeId→taxonomy_nodes **cascade**, tagType
  `item_tag_type` [primary|secondary], confidence, taggedBy `tagged_by` [human|ai], taggedAt).
  Único `(itemId, nodeId)`.
- Grados: resolver por **`grades.shortName`** ("1B".."6B"). Mapear `level` → shortName:
  `1_basico→1B`, …, `6_basico→6B`. Subjects por `subjects.code` (`LANG`, `MATH`).
- `taxonomy_nodes` NO tiene RLS → seed corre con `DATABASE_ADMIN_URL`, sin `withOrgContext`.
- Taxonomía IA actual a reemplazar: `seed/mineduc-taxonomy.ts` (consume `data/mineduc-2024.json`)
  + bloque inline "Habilidades DIA 2025" en `seed/index.ts` (codes `DIA-LANG-SK-*`, `DIA-MATH-SK-*`).
  `seed/e2e-testing.ts` referencia esos codes antiguos (ver §6).

---

## 2. Decisiones de diseño

1. **Una sola taxonomía** que contiene los 674 nodos (árbol conexo: descriptor→OA→eje en la misma
   taxonomía; skill y text_type como raíces de dimensión). Coincide con "crear una nueva taxonomía".
   - Fila: `type: 'dia'`, `version: '2025'`, `name: 'DIA 2025'`, `isOfficial: true`, `orgId: null`.
     (Reutiliza la fila DIA 2025 existente si está; el OA/eje llevan `metadata.source='mineduc'`,
     el resto `'dia'`, para distinguir origen sin partir el árbol.)
   - *Alternativa considerada y descartada por ahora:* dos taxonomías (mineduc para OA/eje, dia para
     skill/descriptor) con `parentId` cruzado entre taxonomías — más fiel semánticamente pero rompe
     el recorrido de árbol dentro de una taxonomía. Si se quiere, se migra después con `taxonomy_mappings`.
2. **Reconstrucción limpia e idempotente:** el seeder borra los nodos de la taxonomía DIA 2025 y los
   re-crea desde el catálogo (el cascade elimina tags viejos; los tags se re-aplican en Parte B).
3. **Origen en metadata:** cada nodo lleva `metadata = { source, ...}` (`mineduc` para axis/OA, `dia`
   para skill/descriptor/text_type). Permite filtrar "oficial vs DIA" sin columnas nuevas.
4. **Dos partes con dependencia distinta:**
   - **Parte A (nodos):** independiente, se puede correr ya (no necesita ítems).
   - **Parte B (tags):** requiere que los **ítems existan en BDD** (depende del import de instrumentos,
     plan aparte). Se ejecuta DESPUÉS del import.
5. **Sin migración de schema:** todos los tipos de nodo y tablas existen. Solo datos + código de seed.

---

## 3. Validación de insumos (Zod en `packages/types`)

Agregar en `packages/types/src/schemas/` (p.ej. `taxonomy-seed.schema.ts`) y exportar:
- `taxonomyCatalogSchema`: `{ note?, counts?, nodes: TaxonomyNodeSeed[] }` con
  `TaxonomyNodeSeed = { code, type: TaxonomyNodeType, name, parentCode: string|null, subjectCode:'LANG'|'MATH',
  level?: string, oaNumber?: number, shortName?: string, source:'mineduc'|'dia', order: number }`.
- `itemTagsPlanSchema`: `{ plan: { instrument: string, position: number,
  tags: { code: string, type: string, tagType: 'primary'|'secondary' }[] }[] }`.
El seeder parsea los JSON con estos schemas antes de tocar la BDD (falla temprano si el dato no calza).

---

## 4. Parte A — Seeder de nodos: `packages/db/src/seed/dia-taxonomy.ts`

`export async function seedDiaTaxonomy(db: Database): Promise<void>`:

1. **Upsert taxonomía** DIA 2025 (`type='dia', version='2025', isOfficial=true, orgId=null`) → obtener `taxonomyId`.
2. **Limpieza:** `DELETE FROM taxonomy_nodes WHERE taxonomy_id = :taxonomyId` (cascade borra tags previos).
3. **Cargar y validar** `data/taxonomia-catalogo.json` con `taxonomyCatalogSchema`.
4. **Resolver FKs:** mapas `subjectIdByCode` (LANG/MATH) y `gradeIdByShortName` (1B..6B). Para cada OA,
   `subjectId` = subjectCode, `gradeId` = shortName(level). Para axis/skill/text_type: `subjectId` = subjectCode,
   `gradeId` = null. Para descriptor: hereda `subjectId`/`gradeId` del OA padre.
5. **Insertar en orden topológico** (para resolver `parentId` por code):
   - Pase 1: `axis`, `skill`, `text_type` (parentCode null), `depth=0`.
   - Pase 2: `learning_objective` (`parentId` = id del eje por code), `depth=1`.
   - Pase 3: `descriptor` (`parentId` = id del OA por code), `depth=2`.
   Mantener `Map<code, id>`. Setear `code, name, type, order, depth, metadata={source}`,
   `description=null`. (`shortName` del OA → guardar en `metadata.shortName` o ignorar; el schema no tiene columna shortName.)
6. Log de conteos por tipo. Idempotente (re-correr = borra y recrea iguales).

> Nota: si se prefiere no borrar, usar upsert `onConflictDoUpdate` por `(taxonomyId, code)`. El borrado
> simple es más limpio para una reconstrucción total y los tags se rehacen en Parte B.

---

## 5. Parte B — Aplicar `item_taxonomy_tags`: `packages/db/src/seed/dia-item-tags.ts`

`export async function applyDiaItemTags(db: Database): Promise<void>` (correr **después** del import de instrumentos):

1. Cargar y validar `data/item-tags-plan.json` con `itemTagsPlanSchema`.
2. **Resolver ítems:** el plan referencia `instrument` por ruta de JSON + `position`. El import de
   instrumentos debe permitir mapear eso a `instrumentId`. Contrato requerido del import:
   - El import crea cada `instruments` con su `name` (ej. "DIA Lectura 3° Básico 2025 — Cierre") y
     guarda en `instruments.config`/metadata la clave de origen (sugerido: `config.sourceJson = "<instrument>"`).
   - Aquí: construir `itemIdBy[(instrumentId, position)]` consultando `items` por `instrumentId` y `position`.
   - Resolver `instrumentId` por `config.sourceJson == plan.instrument` (o, si no se guardó, por
     `name` derivado del JSON del instrumento). Si un instrumento no está importado aún → **saltar y loguear**
     (Parte B es incremental: taguea lo que exista).
3. **Resolver nodos:** `nodeIdByCode` desde `taxonomy_nodes` de la taxonomía DIA 2025.
4. Para cada `tag` del plan: insertar `item_taxonomy_tags { itemId, nodeId, tagType,
   taggedBy: 'human', confidence: '1.00' }` con `onConflictDoNothing` por `(itemId, nodeId)`.
   (`taggedBy='human'`: provienen de fuentes oficiales/informes, no de inferencia del modelo. Ajustar a `'ai'` si se prefiere.)
5. Log: tags insertados, ítems no resueltos (instrumentos aún no importados), nodos faltantes (no debería haber).

---

## 6. Reemplazo del seed IA actual

- En `seed/index.ts`: **quitar** la llamada a `seedMineducTaxonomy(db)` y el bloque inline "Habilidades
  DIA 2025" (codes `DIA-*-SK-*`); **llamar** a `seedDiaTaxonomy(db)`. Mantener la creación de la fila
  `taxonomies` DIA 2025 (o moverla dentro de `seedDiaTaxonomy`). Quitar la fila/seed "MINEDUC 2024" si
  ya no se usa (o dejarla vacía); el OA oficial ahora vive en la taxonomía DIA 2025.
- `seed/mineduc-taxonomy.ts` y `data/mineduc-2024.json`: quedan **obsoletos** → eliminar o marcar
  deprecated (no llamarlos). Documentar en el commit.
- `seed/e2e-testing.ts`: referencia codes antiguos (`DIA-LANG-SK-LOC`, etc.) para generar resultados de
  prueba. **Actualizar** esos codes a los nuevos (`LANG-SK-LOCALIZAR`, `MATH-SK-REPRESENTAR`, …) o derivarlos
  del catálogo, para que el seed e2e no rompa. Listar el mapeo viejo→nuevo en el commit.
- `applyDiaItemTags` NO se llama desde el seed base (depende del import); se invoca como paso post-import
  (script dedicado `pnpm --filter @soe/db db:tag-items` o dentro del flujo de import).

---

## 7. Verificación

```bash
pnpm db:generate   # NO debe generar migración nueva (sin cambios de schema). Si genera algo, revisar.
pnpm db:seed       # crea taxonomía DIA 2025 + 674 nodos; sin errores
pnpm typecheck && pnpm lint
```
Checks post-seed (SQL o test):
- [ ] `taxonomy_nodes` de DIA 2025: 8 axis, 324 learning_objective, 332 descriptor, 7 skill, 3 text_type.
- [ ] Todo `descriptor.parent_id` apunta a un `learning_objective`; todo OA a un `axis`.
- [ ] `(taxonomy_id, code)` único; sin huérfanos (parentId no nulo siempre resuelve).
- [ ] Tras Parte B (con ítems sembrados de prueba): los tags de un ítem resuelven a indicador(primary)+OA+skill+eje/text_type.
- [ ] Test de integración en `apps/api` o `packages/db`: sembrar + consultar un OA con sus descriptores.

---

## 8. Fuera de alcance

- Migración de `instrument_sections` (plan aparte) e import de instrumentos/ítems (plan aparte) —
  Parte B depende de que el import exista.
- Indicadores oficiales MINEDUC (Programas de Estudio, PDF) — mejora futura; hoy se usan los DIA.
- `taxonomy_mappings` (cruces OA↔habilidad o DIA↔MINEDUC) — no necesarios ahora.
- Corregir/normalizar el texto verbatim de OA (spot-check de Matemática 1° pendiente, no bloquea).

---

## 9. Ejecución (metodología del proyecto)

1. Rama + worktree paralelo desde `dev` (ej. `feat/seed-taxonomia-real`).
2. Implementar §0, §3, §4, §6 (Parte A + reemplazo del seed IA). Parte B (§5) se puede dejar lista pero
   su ejecución real espera al import de instrumentos.
3. Correr §7. **Commitear** en el worktree.
   Mensaje sugerido: `feat(db): sembrar taxonomía real (OA oficial + indicadores/skills DIA) y reemplazar seed IA`.
