# Contratos — Motor Remedial con Estímulo · Ola 2.2 (Opción B: generar texto nuevo)

> Diseño: `docs/remedial-estimulo-ola2-diseno.md`. Base: rama de reconciliación (2.1 + editor de ítems).
> **Objetivo:** el docente genera preguntas sobre un **texto NUEVO original creado por IA**, de **dificultad pareja** a los textos donde los alumnos fallaron. Reutiliza TODO el core de 2.1 (anclaje, juez + loop, revisión, publicación); lo único nuevo es **"conseguir el estímulo" = generarlo** (patrón Strategy, punto de variación ya previsto).

## Decisiones / defaults
- **Readability: Fernández-Huerta** como primera fórmula, **enchufable** (`ReadabilityFormula`). Se usa como **target de generación + valor medido mostrado al docente + aviso blando** si queda fuera de banda. **NO es hard-gate** (los LLM no aciertan readability de forma fiable; forzarlo por loop no converge). Coherente con hard-gates lean (respondibilidad/unicidad/factual siguen siendo del juez sobre las PREGUNTAS).
- **Grounding:** el texto nuevo se genera **fundamentado en los pasajes fallados** (tema/registro/nivel) + un **perfil de target** (readability, largo, tipo de texto). Reusa `FailedStimulusService` (ya trae esos pasajes con su texto).
- **Modelo:** generación del texto = **Gemini Pro** (feature `remedial_reading`, reusada); juez = Flash (igual que 2.1).
- **Almacenamiento:** el pasaje generado se guarda en `instrument_sections` (`source='ai_generated'`, `instrumentId=null`, `orgId`=org, `kind='passage'`). Al ser `instrumentId=null`, **NO aparece en el picker del banco** (que hace innerJoin a instruments) — es per-material, correcto.
- **Fallback de A → B:** el terminal de la cadena de A pasa de `SelfContainedFallback` a **`GenerateStimulusFallback`** (A sin pasaje → generar uno). Swap ya previsto.
- **Edición del pasaje:** el docente puede **editar el texto generado** en la revisión (además de los ítems). Nota: editar mucho el texto puede desalinear las preguntas — se permite y se confía en el docente; re-juzgar tras editar el pasaje = futuro.

---

## 1. Tipos (`packages/types`)
- `updateRemedialStimulusSchema` = `{ title: z.string().nullable().optional(), text: z.string().min(1) }` + `UpdateRemedialStimulusDto` (edición del pasaje generado).
- (Los targets/readability son backend-internos, no en `@soe/types`.)

## 2. Backend (`apps/api/src/remedial/stimulus/` + module)

- **`ReadabilityFormula`** (puerto) + **`FernandezHuertaFormula`** (impl): `score(text): { value: number; gradeEstimate: number | null }`. Registrado por token (patrón policies), para enchufar otras fórmulas.
- **`TargetProfiler.profile(failedStimuli): StimulusTargetProfile`** — de los pasajes fallados: `{ readabilityTarget, wordCountRange: [min,max], textType }` (readability = promedio/mediana de los fallados; largo = rango; tipo = `passage_format` dominante o inferido).
- **`GenerateStimulusProvider`** (nuevo): dado `{ orgId, assessmentId, nodeId }`:
  1. `FailedStimulusService.list(...)` → pasajes fallados (grounding + `TargetProfiler`).
  2. Prompt a **Pro** (nuevo `generate-stimulus.prompt.ts`, versionado): "genera un TEXTO ORIGINAL en español de Chile, tipo {textType}, ~{words} palabras, nivel lector ~{grado/readability}, sobre un tema apropiado y NUEVO (no copies los de referencia), del que se puedan hacer preguntas de {habilidad}. Devuelve JSON `{ title, text }`." Inyecta los pasajes fallados como referencia de nivel/estilo (no a copiar).
  3. `FernandezHuertaFormula.score(text)` → medir; si fuera de banda, marcar (aviso blando, no regenera).
  4. Insertar en `instrument_sections` (`source='ai_generated'`, `instrumentId=null`, `orgId`, `kind='passage'`, `passage_title`, `passage_text`, `passage_format='plain'`) bajo `withOrgContext`/filtro org. Devolver `RemedialStimulus` (source=ai_generated) + el `readability` medido (para auditoría/UI).
- **`GenerateStimulusFallback`** (impl de `TerminalFallbackPolicy`): llama a `GenerateStimulusProvider` → `{ method:'generate_stimulus', stimulus }`. Reemplaza a `SelfContainedFallback` en el binding del module.
- **`StimulusResolver`**: rama `method==='generate_stimulus'` → `GenerateStimulusProvider` (además del override/auto de A). El generador de preguntas (2.1) ya ancla al `stimulus` sin cambios.
- **Edición del pasaje:** `PATCH /api/remedial/:id/stimulus` (roles `REMEDIAL_APPROVER_ROLES`, `@RequireFeature('remedial')`) + `RemedialService.updateStimulus`: material del org, `ready`, con un `content.stimuli[0]` `source='ai_generated'`; actualiza `instrument_sections.passageText/passageTitle` (solo si `source='ai_generated'` — NUNCA editar un pasaje oficial). Devuelve el `RemedialMaterialModel` con `stimuli` re-hidratado.
- **Auditoría/costo:** el pasaje generado agrega una llamada Pro extra → el cost tracking ya lo captura; persistir el `readability` medido en `remedial_materials.input` (auditoría).

## 3. Frontend (`apps/web`)
- **`generate-panel.tsx`:** habilitar la opción **"Texto nuevo IA (Opción B)"** (`generate_stimulus`) — ya no deshabilitada. No requiere picker (no hay pasaje a elegir); opcional: nota "la IA creará un texto nuevo de dificultad similar". El fallback de A (sin pasaje) también puede caer aquí.
- **Revisión (`practice-view.tsx`):** cuando el pasaje es `source='ai_generated'`, mostrar un **label "Texto generado por IA"** y hacer el pasaje **editable** (nuevo `StimulusEditor`: título + texto, Guardar → `updateRemedialStimulus`), coexistiendo con el editor de ítems + flags del juez. Pasajes `official` (Opción A) siguen read-only. Mostrar el **readability medido** si está.
- Server action `updateRemedialStimulus(materialId, dto)` → `PATCH /remedial/:id/stimulus`.

## 4. Criterios de aceptación + E2E
1. Elegir "Texto nuevo IA" → genera un pasaje `ai_generated` + N preguntas ancladas a él; el juez corre igual (converge/exhausted).
2. El pasaje generado NO aparece en el picker del banco (instrumentId null).
3. El readability medido se muestra; si está fuera de banda, aviso blando (no bloquea).
4. Editar el texto generado en la revisión persiste; editar un pasaje oficial → rechazado.
5. Fallback: Opción A sin pasaje → cae a generar (B) con aviso.
6. `pnpm typecheck` (api/web/types) limpio + tests remediales verdes.
7. E2E real: generar B sobre una brecha, revisar el texto + preguntas + flags, editar, aprobar.

## 5. Reparto (secuencial en worktree)
| Agente | Alcance |
|---|---|
| **TYPES** | §1 (`updateRemedialStimulusSchema`) |
| **BE-1** | §2 generación: `ReadabilityFormula`+`FernandezHuerta`, `TargetProfiler`, `GenerateStimulusProvider`, `GenerateStimulusFallback`, wiring `StimulusResolver`, prompt, routing + tests |
| **BE-2** | §2 edición: `PATCH /remedial/:id/stimulus` + `updateStimulus` + tests |
| **FE** | §3 (habilitar Opción B + `StimulusEditor` + label IA + action) |

Rama: `sprint-remedial-ola2.2` (stacked sobre `ola1resto-integ` → #26 → #25 → dev).
