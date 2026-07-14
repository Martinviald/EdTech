# Diseño y Planificación — Motor Remedial con Estímulo (Ola 2)

> Evolución del motor remedial para generar **preguntas nuevas ancladas a un "estímulo"** (hoy: textos de lectura), en dos modos que el docente elige: **(A) sobre los mismos textos** de la evaluación y **(B) sobre un texto nuevo generado por IA** de dificultad pareja. Con **juez automático + loop de regeneración (máx 3)**. El core se diseña genérico para extenderse luego a mate/ciencias/inglés sin re-arquitectura.
> Continúa `docs/propuesta-motor-remedial-generativo.md` (§6.4) y resuelve el gap detectado en producción: los ítems de lectura referenciaban un texto inexistente/inventado (ítems generados con `sectionId=null`).

---

## 1. Decisiones tomadas (y supuestos)

**Confirmado por el equipo:**
1. **Modelo de estímulo genérico** reusando `instrument_sections` (+`kind`, +`source`), ítems anclados por `items.sectionId`. Lectura = primer `kind`; ítems autocontenidos actuales = `sectionId NULL`.
2. **Opción A** toma los **pasajes de la evaluación de origen** (los ítems con mayor brecha en esa prueba).
3. **Hard-gates del juez** (disparan regeneración): **respondibilidad** (solve-then-check), **exactamente una correcta**, **corrección factual**. **Alineación a la habilidad = aviso blando** (se muestra, no regenera).
4. **No-convergencia tras 3 iteraciones** → guardar el **mejor borrador + las objeciones** del juez para corrección manual del docente (no `failed`).
5. **Orden de desarrollo:** primero **A** (más simple), luego **B**.
6. **Modelos:** **Gemini 2.5 Pro genera / Flash juzga** — configurable por feature para swappear de proveedor (idealmente juez de otra familia cuando haya Anthropic key).

**Supuestos (default; corregir si aplica):**
- **Readability (solo B):** target derivado de los textos fallados con fórmula nativa de español (Fernández-Huerta / Crawford) → se usa como **objetivo de generación + aviso blando**, no como hard-gate (coherente con mantener los hard-gates acotados).
- **Tipo de ítem:** MCQ primero (como hoy); open-ended con rúbrica = extensión futura.
- **Granularidad:** el docente elige A/B **por material**; **1 estímulo + N preguntas** por set (N = `itemCount`, 1–20 existente).
- **Anclaje al error:** se mantiene el `brief` (misconception/distractores) en A y B — las preguntas nuevas siguen atacando la brecha.
- **Editor:** se extiende el `ItemEditor` (Ola 1-resto) para mostrar/editar el estímulo y ver los flags del juez.
- **Detección lectura vs autocontenido:** por si los ítems de referencia del nodo dependen de un estímulo (`sectionId`), **no** por hardcodear "Lenguaje".
- **PII:** los pasajes son contenido, sin PII (igual que `item-insight`).
- **No-lectura (mate/ciencias/inglés):** se deja la **estructura** (enum `kind` + Strategy de estímulo); **no se construye ahora**.

---

## 2. Concepto central: un pipeline, un punto de variación

**A y B comparten TODO el pipeline salvo el paso "conseguir el estímulo".** Ese es el único punto de variación (patrón Strategy):

```
Brecha (nodeId, assessmentId, sourceAnalysisId)
  │
  ├─▶ Brief del error (RemedialBriefService)          [existe]
  │
  ├─▶ Recuperar los estímulos fallados                [nuevo, común a A y B]
  │     pasajes de los ítems con mayor brecha en la evaluación
  │     (reusa el retrieval de item-insight: items.sectionId → instrument_sections)
  │
  ├─▶ StimulusProvider.provide(...)   ◀── ÚNICO punto que difiere A/B
  │     · A (reuse):    elegir uno de los pasajes fallados (source=official)
  │     · B (generate): medir targets → Pro genera pasaje nuevo → readability → guardar
  │     · self_contained (hoy): sin estímulo (sectionId null)
  │     · figure/table (futuro): otro Provider, mismo contrato
  │
  ├─▶ Generar N preguntas ancladas al estímulo + brief (Pro)   [común]
  │     ítems draft, source=ai_generated, sectionId = estímulo
  │
  ├─▶ Juez + loop (máx 3)                              [nuevo, común]
  │     solve-then-check + unicidad + factual (hard) · skill (blando)
  │     falla hard-gate → regenerar ítems (+texto si B) con las objeciones
  │     converge → ready · no converge en 3 → ready + qualityReport(exhausted)
  │
  ├─▶ Revisión/edición docente (estímulo + preguntas + flags)  [extiende Ola 1-resto]
  │
  └─▶ Aprobar → publica ítems (+ estímulo si generado)         [extiende existente]
```

**Reuso A vs B:**

| Etapa | Común | A-específico | B-específico |
|---|---|---|---|
| Brief del error | ✔ | | |
| Recuperar pasajes fallados | ✔ | (elige uno) | (mide targets) |
| Proveer estímulo | | `ReuseOfficialProvider` | `GenerateStimulusProvider` |
| Generar preguntas | ✔ | | |
| Juez + loop | ✔ | | |
| Revisión/edición | ✔ | (pasaje solo-lectura) | (pasaje editable) |
| Publicar | ✔ | | (publica pasaje IA) |

> B reutiliza ~90% de A. La única pieza nueva de B es `GenerateStimulusProvider` + la edición del pasaje. Por eso A primero "construye el core", y B "enchufa una estrategia".

---

## 3. Arquitectura (módulos y servicios)

Extiende el módulo `remedial`. En **negrita** lo nuevo.

- **`FailedStimulusService`** (nuevo, común): dado `(nodeId, assessmentId)`, recupera los pasajes de los ítems con mayor brecha (reusa la lógica de `item-insight`/`instrument_sections`). Devuelve `FailedStimulus[]` con `{ sectionId, kind, text, textType, itemPositions, gap }`. Alimenta A (elegir) y B (medir).
- **`StimulusProvider`** (puerto, Strategy): `provide(ctx): Promise<ProvidedStimulus>`.
  - **`ReuseOfficialProvider`** (A): elige el pasaje fallado más relevante (mayor brecha / más ítems); no crea registro (linkea al `sectionId` existente).
  - **`GenerateStimulusProvider`** (B): `TargetProfiler` (mide readability/largo/tipo) → prompt de texto (Pro) → `ReadabilityChecker` (soft) → inserta `instrument_sections(source=ai_generated, orgId, kind=passage)`.
  - *(futuro)* `FigureStimulusProvider`, etc. — mismo contrato.
- **`StimulusQuestionGenerator`** (nuevo): genera N preguntas ancladas al estímulo + brief (Pro), valida con `validateItemContent`, inserta ítems draft con `sectionId`. Generaliza al `PracticeGenerator` actual (el caso `sectionId=null` = autocontenido).
- **`RemedialJudgeService`** (nuevo, común): corre el juez (Flash) por ítem, devuelve `JudgeReport`.
- **`RemedialQualityLoop`** (nuevo, común): orquesta generar→juzgar→regenerar hasta converger o 3 iteraciones; arma el `qualityReport`.
- **`RemedialRunner`** (existe, se extiende): resuelve method (A/B/self_contained) → provider → generator → quality loop → markReady con `content` + `stimulus` + `qualityReport`.
- **Reusados tal cual:** `RemedialBriefService`, `RemedialContextService`, `LlmService.completeWithUsage` (con cost tracking, recién mergeado), `JOB_DISPATCHER`, `FeatureGuard`, `validateItemContent`, el `ItemEditor` (se extiende).

---

## 4. Modelo de datos

**`instrument_sections`** (pasa a ser el store de "estímulo"):
- `+ kind` enum `stimulus_kind` (`passage | figure | table | dataset`; default `passage`).
- `+ source` enum `stimulus_source` (`official | ai_generated`; default `official`).
- `+ orgId uuid` **nullable** (`null` = oficial/compartido; set = privado del tenant que lo generó). Filtro `orgId = :org OR orgId IS NULL` (idéntico patrón que `items`; la tabla no está bajo RLS).
- `instrumentId` → **nullable** (los estímulos generados no pertenecen a un instrumento). ⚠️ revisar el `NOT NULL`/FK actual en la migración.
- Índice `(orgId, kind)`.

**`items`** (sin cambio estructural): los ítems generados quedan `source=ai_generated`, `status=draft`, `sectionId=<estímulo>`, `orgId=<org>`.

**`remedial_materials`**:
- `+ method` enum `remedial_method` (`self_contained | reuse_stimulus | generate_stimulus`).
- `+ stimulusId uuid` nullable (el estímulo del set).
- `+ qualityReport jsonb` — verdicts del juez por ítem, objeciones, nº de iteraciones, `finalStatus` (`converged | exhausted`).

**`packages/types`**: `stimulusKindSchema`, `stimulusSourceSchema`, `remedialMethodSchema`; `judgeVerdictSchema` (`{ itemRef, answerable, derivedAnswer, uniqueCorrect, factual, skillMatch, objections[] }`); extender el content/model remedial con `stimulus` (preview del pasaje) + `method` + `qualityReport`.

**`llm-settings`**: nuevo `LlmFeature` **`remedial_judge`** (para rutear el juez independiente del generador). El generador usa la feature `remedial` (ahora ruteada a Pro).

---

## 5. El juez + loop de calidad

**Por ítem (Flash), el juez recibe SOLO el estímulo + la pregunta (sin la clave) y produce:**
- **Respondibilidad (hard):** resuelve la pregunta usando solo el texto → `derivedAnswer`. Si `derivedAnswer ≠ clave` o "no se puede responder desde el texto" → falla.
- **Unicidad (hard):** evalúa cada alternativa; falla si hay 0 o ≥2 defendibles como correctas.
- **Factual (hard):** errores de hecho en texto/clave/explicación.
- **Alineación a la habilidad (blando):** predice qué habilidad mide el ítem; si ≠ el OA objetivo → **flag** (no regenera).

**Loop (`RemedialQualityLoop`):**
```
iter = 0
generar set → juzgar
while (hay fallas de hard-gate) and (iter < 3):
    iter++
    regenerar SOLO los ítems que fallaron, inyectando las objeciones del juez
    (B: si la falla factual es del TEXTO, regenerar también el pasaje)
    juzgar de nuevo
finalStatus = (sin fallas) ? 'converged' : 'exhausted'
markReady(draft, content, stimulus, qualityReport)   // exhausted igual queda draft + objeciones
```
- Regeneración **por ítem** (no todo el set) → más barato y preserva los buenos.
- **Costo acotado** por las 3 iteraciones; se registra (cost tracking ya mergeado). B es más caro (genera texto + más pases).

**Nota crítica honesta (modelo del juez):** con Flash juzgando a Pro, **juez y generador son de la MISMA familia** (Gemini). Un modelo tiende a aprobar su propio estilo (sesgo de auto-preferencia, +10–25% en la literatura). Este juez **atrapa errores gruesos** (no respondible, no única, factual evidente) pero es un **compromiso más débil** que un juez de otra familia. **Mitigación:** el juez está ruteado por `remedial_judge` en `llm_settings` → cuando haya Anthropic key, cambiar a **Claude (otra familia) es un cambio de config de una línea**. Recomendación fuerte: hacerlo apenas esté la key.

---

## 6. Modelos y configuración

| Rol | Modelo (hoy) | Feature (`llm_settings`) | Meta |
|---|---|---|---|
| Generar preguntas / texto | `gemini-2.5-pro` | `remedial` | — |
| Juez | `gemini-2.5-flash` | **`remedial_judge`** | → **Claude (otra familia)** al tener key |

Swappear de proveedor/modelo = editar `llm_settings` (no código). El cost/tokens se puebla vía `completeWithUsage` (mergeado). La feature `remedial` sigue detrás de `@RequireFeature('remedial')` (tier pago).

---

## 7. Revisión y edición docente

- El detalle muestra: **el estímulo** (pasaje) arriba + **las N preguntas** con sus flags del juez (verde/aviso) y, si `finalStatus=exhausted`, un banner "no convergió — revisa estas objeciones".
- **A:** pasaje **solo-lectura** (es oficial). **B:** pasaje **editable** (se extiende el `ItemEditor` para el texto).
- Preguntas editables (reusa el `ItemEditor` de Ola 1-resto) + quitar ítem.
- **Aprobar** → publica los ítems (`draft→published`) y, en B, marca el estímulo generado como publicado/visible.

---

## 8. Métricas

- **Tasa de convergencia** (converged vs exhausted) y **nº medio de iteraciones**.
- **% de ítems que pasan cada hard-gate al primer intento** (calidad del generador).
- **Tasa de aprobación / edición docente** (proxy de calidad).
- **Costo por material** (A vs B) y latencia.
- **(B) Match de readability** vs banda objetivo.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Juez misma familia (débil)** | Ruteo por `remedial_judge`; swap a Claude apenas haya key |
| **Control de dificultad (B) poco fiable** | Target objetivo por fórmula ES + validación; no confiar en el juicio del modelo |
| **Costo del loop (B, Pro×3)** | Cap de 3 iteraciones; regen por ítem; cost tracking visible |
| **Texto IA con contenido inapropiado/erróneo (B)** | Hard-gate factual + revisión docente + label "IA" |
| **Migración `instrument_sections` (instrumentId nullable)** | Revisar FK/constraint; migración aditiva; RLS n/a (filtro orgId como items) |
| **Pasaje oficial reproducido en material (A)** | Es material propio del colegio / DIA que ya licencia; sin exfiltración |
| **A sin pasajes en la evaluación** | Fallback documentado (pedir al docente elegir, o banco) — ver decisión abierta |

---

## 10. Plan por sub-olas

**Ola 2.1 — Opción A + core (lo grande):**
- Schema: `instrument_sections` (kind/source/orgId/instrumentId nullable) + `remedial_materials` (method/stimulusId/qualityReport) + enums + tipos.
- `FailedStimulusService` + `StimulusProvider`/`ReuseOfficialProvider`.
- `StimulusQuestionGenerator` (Pro, ancla estímulo+brief).
- `RemedialJudgeService` + `RemedialQualityLoop` (3 hard-gates + flag blando, máx 3, no-convergencia→draft+objeciones).
- Revisión: estímulo (solo-lectura) + preguntas + flags; UI elige "Mismas lecturas".
- **Entrega:** remediación de lectura **fiable sobre textos oficiales** + todo el core del juez/loop.

**Ola 2.2 — Opción B (generar texto):**
- `GenerateStimulusProvider` (`TargetProfiler` + Pro + `ReadabilityChecker`), persiste el pasaje IA.
- Edición del pasaje en la revisión; UI elige "Texto nuevo IA" + label.
- **Reusa TODO el core de 2.1** (juez, loop, review, publicación).

**Futuro (solo estructura hoy):** providers de estímulo no-lectura (figure/table/dataset); ítems open-ended + rúbrica; juez cross-familia (Claude).

---

## 11. Decisiones abiertas (para cerrar antes de contratar 2.1)

1. **A — cuál pasaje reusar** cuando la evaluación tiene varios en la brecha: ¿el del ítem de mayor brecha (default), el de más ítems, o **dejar que el docente elija** de una lista?
2. **A — fallback** si el nodo/evaluación no tiene pasaje: ¿caer a `self_contained` (MCQ sin texto), pedir al docente elegir, o usar el banco?
3. **Fórmula de readability (B):** Fernández-Huerta (default) vs INFLESZ vs Crawford.
4. **¿Sumar el paso pedagógico "revisitar el texto original con un ejemplo resuelto"** antes de la práctica (híbrido A+worked-example), o dejarlo para después?
