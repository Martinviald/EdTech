# Contratos — fix/flexibilidad-arquitectura

Objetivo: cerrar la historia *"la plataforma soporta cualquier asignatura, prueba, tipo
de pregunta y métrica"* resolviendo 3 hallazgos BLOQUEANTES + 3 ALTOS, **sin romper la
lógica ni la funcionalidad DIA actual**.

Rama base: `fix/flexibilidad-arquitectura` (sale de `dev` @ `9cda5b5`).
Metodología: oleadas por dependencia (no 6-en-paralelo, porque comparten archivos).

```
FASE 0 (este doc + item-content.schema.ts, ya commiteado)
OLEADA A: #5 content polimórfico          ── fundación
OLEADA B: #1 scoring  ∥  #4 dia-ingestion ── dependen de A
OLEADA C: #2+#3+#6 métricas/niveles       ── coordinado, 1 worktree
FASE 3: auditoría sin regresiones
FASE 4/5: integración + E2E
```

---

## ⚠️ SETUP OBLIGATORIO (primera instrucción de cada agente en worktree)

Los worktrees de agente **nacen de `main`, NO de esta rama**. Antes de leer o codear:

```bash
# 1. Traer la base del fix (incluye este doc y item-content.schema.ts):
#    árbol limpio →  git reset --hard fix/flexibilidad-arquitectura
#    con commits  →  git merge fix/flexibilidad-arquitectura --no-edit
git reset --hard fix/flexibilidad-arquitectura
git log --oneline -2   # debe verse el commit de contratos Fase 0

# 2. Deps + build de paquetes (dist/ está gitignoreado):
pnpm install
pnpm --filter @soe/types build
pnpm --filter @soe/db build
```

Y al terminar, **COMMIT OBLIGATORIO** o el worktree se borra y se pierde todo:
```bash
git add -A && git commit -m "fix(flex): <mensaje>"
git status   # nada sin commitear
```

---

## Matriz de ownership de archivos (NO cruzar entre oleadas)

| Archivo | Oleada A (#5) | B-#1 | B-#4 | Oleada C (#2/#3/#6) |
|---|:-:|:-:|:-:|:-:|
| `packages/types/src/schemas/item.schema.ts` | ✏️ | | | |
| `packages/types/src/schemas/item-content.schema.ts` | ✏️ (afinar) | lee | lee | |
| `packages/db/src/schema/items.ts` | ✏️ | | | |
| `apps/api/src/items/**` | ✏️ | | | |
| `apps/api/src/answer-sheets/answer-sheets.service.ts` | | ✏️ | | |
| `apps/api/src/answer-sheets/scoring/**` (nuevo) | | ✏️ | | |
| `apps/api/src/dia-ingestion/**` | | | ✏️ | |
| `packages/types/src/utils/grade-calculator.ts` | | | | ✏️ |
| `packages/db/src/schema/results.ts` | | | | ✏️ |
| `packages/db/src/schema/enums.ts` | | | | ✏️ |
| `apps/api/src/heatmap/heatmap.service.ts` | | | | ✏️ |
| `apps/api/src/dashboards/dashboards.service.ts` | | | | ✏️ |
| `apps/web/.../resultados/components/performance-level.ts` + UI niveles | | | | ✏️ |

**Archivos compartidos que NADIE toca** (se integran en Fase 4): `app.module.ts`,
`nav-items.ts`, `packages/types/src/schemas/index.ts` (ya editado en Fase 0).

---

## Regla de oro: CERO regresiones en el flujo DIA

DIA es 100% opción múltiple, % de logro, 4 niveles. **Para un instrumento DIA existente,
el resultado calculado debe ser IDÉNTICO antes y después.** Cada oleada incluye un test
que lo prueba (golden test: mismas respuestas → mismo `totalScore`/`percentage`/
`performanceLevel`/`grade`). Multi-tenancy: toda query nueva filtra `org_id`.

---

## OLEADA A — #5 Contenido polimórfico de ítems

**Fundación. Bloquea B.** Contrato ya provisto en `item-content.schema.ts`.

Entregables:
1. Afinar (si hace falta) los schemas por tipo en `item-content.schema.ts`. **No** cambiar
   nombres públicos: `ITEM_CONTENT_SCHEMAS`, `ItemContent`, `validateItemContent`,
   `isAutoScorable`, `AUTO_SCORABLE_ITEM_TYPES`.
2. `packages/db/src/schema/items.ts`: tipar `content` como `.$type<ItemContent>()`
   (importando el tipo de `@soe/types`). Cumple CLAUDE.md §5.4.
3. `item.schema.ts`: en `createItemSchema`/`updateItemSchema`, reemplazar
   `content: z.record(z.unknown())` por validación cruzada con `type` usando
   `z.superRefine` + `ITEM_CONTENT_SCHEMAS[type]` (un content inválido para su tipo → error Zod).
4. `apps/api/src/items/items.service.ts`: validar content con `validateItemContent(type, content)`
   en create/update antes de persistir. Propagar `ZodError` como `BadRequestException`.
5. Tests: ≥8 — uno por tipo válido + casos inválidos (MC sin alternativas, true_false sin
   `correctAnswer`, etc.).

Aceptación: crear un ítem `matching`/`gap_fill`/`writing` válido funciona; uno con content
del tipo equivocado se rechaza; un ítem `multiple_choice` existente del seed sigue validando.

---

## OLEADA B — #1 Registro de estrategias de scoring

**Depende de A.** Dueño: `answer-sheets.service.ts` + `answer-sheets/scoring/` (nuevo).

Problema: `answer-sheets.service.ts:323-355` puntúa TODO como opción múltiple
(`rawAnswer === correctKey`), ignorando `item.type`. Un ítem no-MCQ → 0 silencioso.

Implementar un registro de estrategias. Interfaz (crear en `answer-sheets/scoring/scoring-strategy.ts`):

```ts
export interface ScoringInput {
  item: { id: string; type: ItemType; content: ItemContent; maxScore: number };
  rawAnswer: unknown;            // valor crudo del alumno (letra, texto, pares, etc.)
}
export interface ScoringOutput {
  isCorrect: boolean | null;     // null = no autocorregible (pendiente humano/IA)
  rawScore: number | null;       // null si pendiente
  requiresManualGrading: boolean;
}
export interface ScoringStrategy {
  score(input: ScoringInput): ScoringOutput;
}
export const SCORING_STRATEGIES: Record<ItemType, ScoringStrategy>;
export function getScoringStrategy(type: ItemType): ScoringStrategy;
```

Reglas:
- `multiple_choice`/`true_false`: misma lógica binaria de hoy (clave/booleano).
- `matching`/`ordering`/`gap_fill`: corrección determinística según content.
- No auto-scorable (`isAutoScorable(type) === false`): `{ isCorrect: null, rawScore: null,
  requiresManualGrading: true }`. En la fila `responses`: `scoredBy:'human'`, `finalScore:null`.
  **Nunca** marcar incorrecto/0 lo que no se puede corregir por máquina.
- El loop de ingesta usa `getScoringStrategy(item.type).score(...)` en vez del `===` fijo.
- `loadInstrumentItems` debe seleccionar `items.type` y pasar el `content` tipado (hoy lo descarta).

Aceptación: golden test DIA (MCQ) idéntico; un instrumento con un ítem `open_ended` deja
ese ítem `pendiente` (no 0) y no contamina el % de los demás. Tests ≥8.

---

## OLEADA B — #4 Desacoplar dia-ingestion

**Depende de A.** Dueño: `apps/api/src/dia-ingestion/**`.

Problemas: `dia-parser.ts:42` `VALID_KEYS=['A','B','C','D']` fijo; `:99` fuerza
`type:'multiple_choice'`; `dia-ingestion.service.ts:136` `type:'dia'`; `:218`
`eq(instruments.type,'dia')`.

Entregables:
1. Parametrizar las claves válidas (aceptar ≥2 alternativas, A–E o configurable) en vez de A–D fijo.
2. El parser produce `content` que pasa `validateItemContent('multiple_choice', ...)`.
3. Documentar/aislar el `type:'dia'` y el filtro `eq(type,'dia')` detrás de una constante de
   módulo (`DIA_INSTRUMENT_TYPE`) para que quede como punto de extensión explícito, no un literal disperso.
4. No romper la ingesta DIA actual (es el flujo F1 productivo).

Aceptación: cargar el banco DIA de prueba sigue funcionando; un DIA con 5 alternativas ya no
se rechaza. Tests ≥6.

---

## OLEADA C — #2 + #3 + #6 Métricas y niveles flexibles (coordinado)

**1 worktree, 3 secciones de plan.** Dueño: `grade-calculator.ts`, `results.ts`, `enums.ts`,
`heatmap.service.ts`, `dashboards.service.ts`, UI de niveles. Cambia schema → genera migración.

### #2 — Niveles de desempeño como datos (no enum cerrado de 4)
- El enum `performance_level` (4 valores) no representa SIMCE (3), Cambridge CEFR (6), bandas N.
- Modelo objetivo: tabla `performance_bands` (o usar `taxonomy_nodes` tipo `performance_level`,
  que ya existe en `taxonomy_node_type`) configurable por escala/instrumento:
  `{ id, scaleId|orgId, key, label, order, minThreshold, maxThreshold, color }`.
- `assessment_results.performanceLevel` / `skill_results.performanceLevel`: pasar de enum a
  FK `performanceBandId uuid NULL` (mantener la columna enum como **fallback deprecated** durante
  transición para no romper datos existentes — soft migration).
- UI `performance-level.ts` y consumidores: derivar labels/colores de las bandas (datos), con
  fallback a los 4 niveles DIA por defecto. NO romper la vista actual.

### #3 — Puntaje escalado / banda (métrica raíz no solo %)
- `assessment_results`: agregar `scaledScore decimal NULL`, `metricType` (ej. `percentage`|
  `scaled`|`band`), `bandLabel text NULL`. Permite PAES (150–1000), CEFR (A1–C2), stanine, etc.
- `grade-calculator`: `StudentAggregateResult` gana `scaledScore?:number|null` y `bandLabel?`.

### #6 — Conversión real de escalas
- `percentageToGrade` (`grade-calculator.ts:49`): implementar de verdad `paes_scaled` e
  `irt_based` (hoy caen a `linear_chilean`). Definir las fórmulas en `config JSONB` de la escala
  (puntos de anclaje) para no hardcodear.
- Default thresholds 0.4/0.7/0.85: centralizar en UNA constante (hoy duplicada en 3 lugares).
- **Bug #8**: `heatmap.service.ts:244-273` llama `percentageToPerformanceLevel()` sin pasar la
  escala → siempre usa defaults. Pasar la escala del instrumento.
- **Bug #7/#9**: `aggregateSkillResults` (`grade-calculator.ts:192`) usa conteo binario con peso
  igual e ignora `finalScore`. Ponderar por `maxScore` y respetar `finalScore` (CLAUDE.md §8.3).

Migración: `pnpm db:generate` (NUNCA `db:push`). Revisar el SQL: **no debe pisar el filtrado
`org_id`** (el RLS ya se perdió en un squash previo; el aislamiento hoy es por query manual).

Aceptación: golden test DIA idéntico (4 niveles, %); un instrumento con escala `paes_scaled`
configurada produce un `scaledScore` correcto; heatmap respeta thresholds custom. Tests ≥10.

---

## Fase 3 — Auditoría (read-only)
Verifica: contratos respetados, ownership no cruzado, multi-tenancy, y **golden tests DIA
verdes en las 4 oleadas** (cero regresión). Reporta ❌/⚠️ con archivo:línea.

## Fase 4/5 — Integración
Merge A → B(#1,#4) → C en `fix/flexibilidad-arquitectura`; `pnpm typecheck && pnpm lint`;
revisar migración; levantar API+web smoke test.
