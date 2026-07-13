# Contratos — Motor Remedial Generativo · Ola 1 "Esqueleto anclado"

> **Rama/worktree destino:** `sprint-remedial-v2` (worktree sobre `dev`).
> **Método:** sprint-parallel — este doc es el contrato; al aprobarse, agentes backend/frontend trabajan en paralelo contra estos tipos y se integra al final.
> **Alcance:** G1 (activar en UI) · G4 (anclar al error) · G5 (referencia enriquecida) · G2 (preview del ítem completo). Ver propuesta madre en `docs/propuesta-motor-remedial-generativo.md`.
> **Fuera de alcance (Olas siguientes):** `ItemEditor` de edición, costo/tokens (G3), retry + índices (G13), secuencia pedagógica (G7), compuertas de calidad / LLM-juez (G9), multi-tipo (G10).

---

## 0. Objetivo y resultado observable

Que un docente, desde una brecha del Análisis IA, pueda **generar un set de ejercicios reales** (`practice_set`) —no solo la guía en prosa— cuyo contenido esté **anclado a la evidencia del error** (causa raíz + distractores realmente elegidos) y **fundamentado en ítems de referencia completos** (misma taxonomía/asignatura/nivel), y **revisar el ítem completo** (enunciado + alternativas + clave + explicación) antes de aprobarlo. Verificable E2E con `GEMINI_API_KEY` (ya configurada).

**Criterio de "listo":** desde `/analisis-ia`, botón "Generar ejercicios" en una brecha → job async → `ready` → `PracticeView` muestra N ítems completos cuyos distractores reflejan la misconception detectada → aprobar publica los ítems (`published`). Sin regresión en `guide`/`group_plan`.

---

## 1. Contrato de tipos (`packages/types`) — **aterriza primero**

Cambios **aditivos** (campos opcionales) para no romper consumidores actuales.

### 1.1 `schemas/curriculum-context.schema.ts` — ítem de referencia enriquecido

Extender `TaggedItemRef` (hoy `{ itemId, position, type, stem }`) con contenido completo opcional:

```ts
export type TaggedItemAlternative = { key: string; text: string; isCorrect: boolean };

export type TaggedItemRef = {
  itemId: string;
  position: number | null;
  type: string;
  stem: string | null;
  // NUEVO (opcional; poblado por el retriever enriquecido):
  alternatives?: TaggedItemAlternative[] | null; // para multiple_choice
  correctKey?: string | null;                     // clave, si aplica
  explanation?: string | null;                    // explicación/justificación
  difficulty?: number | null;                     // p empírico si está disponible (null en Ola 1)
  subjectId?: string | null;                      // para trazar el filtro asignatura/nivel
  gradeId?: string | null;
};
```

### 1.2 `schemas/remedial.schema.ts` — preview del ítem hidratado

El material `practice_set` sigue guardando **refs** (`{itemId, position, stem}`) como fuente ligera. El **preview completo NO se persiste en el material**: se **hidrata en la lectura** desde `items` (fuente de verdad). Añadir al Model de respuesta:

```ts
/** Preview hidratado de un ítem de práctica (se arma en la lectura desde `items`, no se persiste en el material). */
export const remedialPracticeItemPreviewSchema = z.object({
  itemId: z.string().uuid(),
  position: z.number().int(),
  type: z.string(),
  stem: z.string().nullable(),
  alternatives: z.array(z.object({ key: z.string(), text: z.string(), isCorrect: z.boolean() })).nullable(),
  correctKey: z.string().nullable(),
  explanation: z.string().nullable(),
});
export type RemedialPracticeItemPreview = z.infer<typeof remedialPracticeItemPreviewSchema>;

// En remedialMaterialModelSchema, agregar (opcional; solo se llena para type='practice_set' en el detalle):
//   practiceItems: z.array(remedialPracticeItemPreviewSchema).nullable().optional(),
```

> **Nota:** `generateRemedialSchema` **NO cambia** — ya incluye `sourceAnalysisId` (línea 150). El trabajo es **leerlo** en backend.

**Responsable:** agente TYPES (o BE si se unifica). Debe compilar `pnpm typecheck` en `packages/types` antes de que BE/FE consuman.

---

## 2. Contrato backend (`apps/api`)

### 2.1 `RemedialBriefService` (NUEVO) — anclaje al error (G4)

Módulo `remedial/`. Responsabilidad única: **ensamblar el brief diagnóstico PII-free** a partir del análisis IA de origen. **No** llama al LLM.

**Firma:** `build(input: { orgId; nodeId; assessmentId?; sourceAnalysisId? }): Promise<RemedialBrief | null>`

`RemedialBrief` (interface backend-interna, **no** en `packages/types`; se persiste en `remedial_materials.input` para auditoría):
```ts
interface RemedialBrief {
  rootCauseHypothesis: string | null;      // de output.skillGaps[nodeId].rootCauseHypothesis
  misconceptionSignal: string | null;      // idem .misconceptionSignal
  reteachStrategy: string | null;          // idem .reteachStrategy
  achievement: number | null;              // % de logro del grupo
  realErrors: Array<{                       // distractores REALMENTE elegidos (evidencia)
    stem: string | null;
    correctLabel: string | null;
    dominantDistractor: string | null;      // alternativa incorrecta más elegida
    distribution: Record<string, number>;   // label -> nº respuestas
  }>;
}
```

**Fuente de datos (reusar lo ya almacenado, sin recalcular):**
- Leer la fila `ai_analyses` por `sourceAnalysisId` **dentro de `withOrgContext(db, orgId, tx => …)`** (RLS). RLS garantiza que sea de la org.
- `output` → `safeParse` con `assessmentInsightsOutputSchema`; tomar `skillGaps.find(g => g.nodeId === nodeId)` → causa raíz/misconception/estrategia/achievement.
- `input` → parsear como `AiAnalysisSnapshot`; `items.filter(i => i.nodeId === nodeId)` → `realErrors` (`stem`, `correctLabel`, `dominantDistractor`, `distribution`). **PII-free por construcción** (el snapshot ya lo es).

**Degradación elegante:** si falta `sourceAnalysisId`, la fila no existe, o `output`/`input` no parsean, o el nodo no está en `skillGaps` → devolver `null`. La generación **sigue** con el contexto curricular (comportamiento actual), sin romperse. Loguear el motivo.

### 2.2 Recuperación de referencia enriquecida (G5)

**`StructuredCurriculumRetriever.loadTaggedItems`** (extender, no reescribir):
- Ya hace `select({... content })`. **Extraer del `content`**, además del `stem`: `alternatives` (map `{key,text,isCorrect}`), `correctKey` (la `key` con `isCorrect`), `explanation` — con helpers defensivos por tipo (reusar patrón `extractStem`). Poblar los nuevos campos opcionales de `TaggedItemRef`.
- **Filtro asignatura/nivel:** unir el pool al `subjectId`/`gradeId` del nodo objetivo (`taxonomy_nodes.subjectId/gradeId`), y traer `items.instrumentId → instruments.subjectId/gradeId` como fallback del criterio (`COALESCE`). Solo ítems `status='published'`, `deletedAt IS NULL`, pool visible (`org_id = :orgId OR org_id IS NULL`).
- **Fallback en el árbol:** si el nodo objetivo tiene `< MIN_REFERENCE_ITEMS` (p.ej. 3) ítems, completar con ítems de **nodos hermano/padre** (ya disponibles vía `loadSiblings`/`loadAncestors`), marcándolos como referencia secundaria. Tope total `MAX_TAGGED_ITEMS` (10).

> **Nota RLS:** `items`/`item_taxonomy_tags`/`taxonomy_nodes` **no** están bajo RLS → siguen corriendo en `this.db` sin `withOrgContext` (como hoy). El filtro `org_id = :orgId OR org_id IS NULL` se aplica **explícito** en el WHERE (el `orgId` debe pasarse al retriever/contexto; hoy `getContext(nodeId)` no lo recibe → **extender la firma a `getContext(nodeId, orgId?)`** de forma aditiva, o pasar `orgId` por el `RemedialContextService`).

**`RemedialContextService.assemble`** (extender): pasar `orgId`; mapear los ítems enriquecidos a `referenceItems` (renombrar/extender `fewShotItems` → conservar `fewShotItems` para compat de los prompts `guide`/`group_plan`, y añadir `referenceItems` con el shape completo para `practice`). Subir `MAX_FEW_SHOT_ITEMS` es opcional; mantener acotado por tokens.

### 2.3 Wiring en el runner y el generador de práctica

- **`RemedialRunner.run`**: antes de invocar el generador, llamar a `RemedialBriefService.build(...)` y a `RemedialContextService.assemble(nodeId, orgId)`; pasar **ambos** (`brief` + `context`) al generador. Persistir el `brief` + `context` (sin PII) en `remedial_materials.input` (auditoría, ya existe la columna).
- **`practice.generator.ts` + `practice.prompt.ts`**: inyectar en el prompt (a) los **ítems de referencia completos** (enunciado + alternativas + clave + explicación) como few-shot de estilo/nivel, y (b) el **brief del error** ("estos son los errores reales a atacar: el distractor X refleja la misconception Y — genera ítems cuyas alternativas incorrectas capturen ese error"). Mantener: salida JSON estricta, `validateItemContent('multiple_choice', …)` por ítem antes de insertar, insert batch con `source='ai_generated'`, `status='draft'`, tag `ai` al `nodeId`. **Bump `PRACTICE_PROMPT_VERSION`** (`s3-practice-v1` → `ola1-practice-v2`).
- **Opcional (bajo costo):** inyectar el brief también en `guide.prompt.ts` (mejora la guía sin trabajo extra). `group_plan` queda igual en Ola 1.

### 2.4 Caché por `inputHash` — **debe invalidar por diagnóstico**

Hoy `inputHash = hash(type, nodeId, classGroupId, itemCount)`. **Añadir `sourceAnalysisId`** (y opcionalmente un hash del `brief`) a la composición, para que dos generaciones del mismo nodo con distinto diagnóstico no colisionen en caché. Documentar el cambio de `PROMPT_VERSION` como parte de la clave si ya lo fuera.

### 2.5 Hidratación del preview en la lectura (G2)

- **`RemedialService.get(id)`** (detalle): si `type='practice_set'` y `status ∈ {ready, approved}`, **hidratar** `practiceItems` leyendo `items` por los `itemId` del `content` (pool visible `org_id = :orgId OR org_id IS NULL`, `deletedAt IS NULL`), mapeando `content` → `RemedialPracticeItemPreview` (stem, alternatives, correctKey, explanation). No persistir; se arma on-read. Mantener el `content` (refs) intacto.

**RLS/PII checklist backend:** `ai_analyses` y `remedial_materials` bajo `withOrgContext`; `items` con filtro explícito `org_id`; el LLM recibe **solo** taxonomía + ítems del banco + agregados del brief (cero nombres/RUT). El snapshot reutilizado ya es PII-free.

---

## 3. Contrato frontend (`apps/web`)

### 3.1 Activar la generación de ejercicios (G1)

- **`analisis-ia/components/skill-gaps.tsx`** (hoy `:74` fuerza `type=guide`): por cada brecha ofrecer **dos acciones** — "Generar guía" (`type=guide`) y **"Generar ejercicios"** (`type=practice_set`) — y **pasar siempre `sourceAnalysisId`** (el id del análisis que ya renderiza estas brechas) además de `nodeId`/`assessmentId`. (Opcional: "Generar plan de grupo" si hay `classGroupId`.)
- **`material-remedial/components/generate-panel.tsx`** (hoy `:105` bloquea el selector con `presetType`): tratar `presetType` como **valor inicial, no candado** — el usuario puede cambiar el tipo. Para `practice_set`, mostrar el control de `itemCount` (1–20).

### 3.2 Preview del ítem completo (G2)

- **`material-remedial/components/practice-view.tsx`** (hoy muestra solo `stem`): renderizar cada ítem desde `practiceItems` — enunciado + **alternativas** (marcando la correcta) + **explicación**. Mantener el aviso "los ítems se publican al aprobar". Si `practiceItems` viene vacío (nodo sin generación), degradar al listado de `stem` actual.
- Sin editor en Ola 1 (solo lectura + Aprobar/Descartar del `ReviewPanel` actual). El botón "Aprobar" ya publica los ítems (`remedial.service.ts` review) — sin cambios.

**No regresión:** `guide` sigue con `GuideEditor`/`GuideView`; `group_plan` con `PlanView`.

---

## 4. Contrato de API (endpoints)

**Sin endpoints nuevos.** Se reutilizan:
- `POST /api/remedial/generate` — ya acepta `type` + `sourceAnalysisId`.
- `GET /api/remedial/:id` — respuesta **extendida** con `practiceItems` (hidratado) para `practice_set`.
- `GET /api/remedial` (lista) y `PATCH /api/remedial/:id/review` — sin cambios.

Gating y roles sin cambios: `@RequireFeature('remedial')` + `REMEDIAL_*_ROLES`.

---

## 5. Criterios de aceptación + verificación E2E (con Gemini real)

1. **Activación:** en `/analisis-ia`, una brecha ofrece "Generar ejercicios"; al hacer clic navega a `/material-remedial` con `type=practice_set` + `sourceAnalysisId` presente en la request.
2. **Async:** el material entra `pending→processing→ready`; el poller refresca sin recargar.
3. **Anclaje (G4):** inspeccionar `remedial_materials.input` → contiene el `brief` con `rootCauseHypothesis`/`misconceptionSignal` y `realErrors` del nodo. Al menos un ítem generado tiene un distractor que refleja el `dominantDistractor` real.
4. **Referencia (G5):** con un nodo que tiene ítems etiquetados, el `input` registra `referenceItems` con alternativas/clave (no solo stem); con un nodo sin ítems propios, aparece fallback de hermano/padre y la generación no falla.
5. **Preview (G2):** `PracticeView` muestra enunciado + alternativas (correcta marcada) + explicación de cada ítem.
6. **Aprobación:** aprobar publica los `items` (`draft→published`); descartar no.
7. **Degradación:** generar `practice_set` **sin** `sourceAnalysisId` → funciona con contexto curricular (brief `null`), sin error.
8. **No regresión:** `guide` y `group_plan` siguen generando y renderizando igual.
9. **Calidad de gate mínimo:** `pnpm typecheck` + `pnpm lint` limpios; tests de `RemedialBriefService` (parseo/degradación) y del retriever enriquecido (extracción de alternativas, fallback, filtro) en verde. Usar `/verify` para conducir el flujo real.

> Requiere seed con al menos un análisis IA (`ai_analyses`) generado sobre una evaluación con respuestas reales, para que el brief tenga de dónde leer.

---

## 6. Reparto por agente y orden de integración

| Agente | Alcance | Depende de |
|---|---|---|
| **TYPES** | §1 (extender `TaggedItemRef`, `remedialPracticeItemPreviewSchema`, campo `practiceItems`) | — (aterriza primero) |
| **BE-retrieval** | §2.2 retriever enriquecido + `RemedialContextService` (`orgId`, `referenceItems`, fallback, filtro) + tests | TYPES |
| **BE-brief** | §2.1 `RemedialBriefService` + §2.3 wiring runner/prompt + §2.4 caché + §2.5 hidratación preview + tests | TYPES |
| **FE** | §3 (skill-gaps, generate-panel, practice-view) | TYPES (shape de `practiceItems`) |

Integración: TYPES → (BE-retrieval ∥ BE-brief ∥ FE) → merge en `sprint-remedial-v2` → verificación E2E §5 → PR a `dev`.

**Anti-patrones a vigilar (CLAUDE.md):** nada hardcodeado a "DIA"/nodo (todo por `node_id`); ítems polimórficos (`validateItemContent`); `withOrgContext` en `ai_analyses`/`remedial_materials`; filtro `org_id` explícito en `items`; cero PII al LLM; sin `any` (inferir de Zod/Drizzle); DTOs/roles desde `@soe/types`.

---

## 7. Riesgos de esta ola

- **Seed insuficiente:** sin un `ai_analyses` real, el brief degrada a `null` y no se puede verificar el anclaje. → Asegurar seed con análisis generado antes de la verificación E2E.
- **`content` de ítems de referencia heterogéneo:** la extracción de alternativas debe ser defensiva por `item_type` (no todos son `multiple_choice`). → Helpers por tipo, degradar a solo `stem`.
- **Costo/latencia:** inyectar ítems completos + brief agranda el prompt. Aceptable en Ola 1 (Gemini Flash); la medición de costo llega en Ola 1-resto (G3).
