# Planificación — Módulo de Análisis IA de Resultados

> **Epic H7 — "De los resultados a la acción": análisis IA de evaluaciones, ítems e instrumentos.**
> Construye sobre el Informe de Evaluación (H6.13) ya entregado. La capa
> determinista (dificultad _p_, discriminación _D_, distractores, brechas) ya
> existe; este módulo añade la capa de **interpretación, diagnóstico y
> recomendación** con IA, para que directores y profesores identifiquen rápido
> en qué está fallando la enseñanza y cómo remediarla.
>
> **Principio rector:** la IA **propone**, el humano **aprueba** (CLAUDE.md §8.3).
> La IA nunca calcula métricas — razona sobre ellas. Los números siguen siendo
> auditables y deterministas; la IA aporta el lenguaje pedagógico, las hipótesis
> de causa raíz y el plan concreto.

---

## 0. Decisiones de alcance (cerradas)

| Decisión | Valor elegido | Implicancia de diseño |
|---|---|---|
| **Cierre del ciclo** | Insights IA (solo lectura) | La IA interpreta, diagnostica y recomienda; los insights se muestran y exportan. **No** hay entidad de seguimiento de acciones (`action_plans`) en este sprint — queda como evolución (H7-fase 2). |
| **Audiencia** | Ambos (vista adaptativa) | Cada análisis produce narrativa y secciones que se adaptan al rol (director ve gestión/priorización; profesor ve accionable de aula). |
| **Motor IA** | Gemini 2.0 Flash | Stack base del proyecto. Generación **asíncrona** (jobs en DB + polling, patrón F1 `import_jobs`). Costo bajo, cacheado y trazado. |
| **Superficie** | Nueva sección "Análisis IA" | Espacio propio (`/analisis-ia`), transversal a evaluaciones — escalable para que el director vea todo. Enlazado desde el Informe de Evaluación. |

> **Consideración de fase:** estratégicamente este módulo es la capa de _upsell_
> del PLG (IA remedial), territorio **F2** según `lineamientos proyecto.md`. Se
> planifica ahora como diferenciador, respetando los guardrails de F1 (multi-
> tenant, taxonomía universal, async, sin hardcodear "DIA").

---

## 1. Concepto del módulo

```
                 ┌─────────────────────────────────────────────┐
   Determinista  │  Informe de Evaluación (H6.13) — YA EXISTE   │
   (auditable)   │  p · D · distractores · brechas · cobertura  │
                 └───────────────────┬─────────────────────────┘
                                     │  + contenido de ítems (stems/alternativas)
                                     │  + confiabilidad (KR-20) · punto-biserial
                                     │  + histórico (persistencia de brecha)
                                     ▼
                 ┌─────────────────────────────────────────────┐
       IA        │   Motor de Análisis IA (Gemini 2.0 Flash)    │
   (interpreta)  │   snapshot de métricas → razonamiento →      │
                 │   salida ESTRUCTURADA y tipada (Zod)         │
                 └───────────────────┬─────────────────────────┘
                                     ▼
                 ┌─────────────────────────────────────────────┐
     Decisión    │  Sección "Análisis IA" (vista adaptativa)    │
                 │  narrativa · top/bottom 5 · diagnóstico ·    │
                 │  calidad de ítems · recomendaciones · export │
                 └─────────────────────────────────────────────┘
```

### Privacidad (guardrail crítico — Ley 19.628)
**Al LLM se envían métricas agregadas y contenido de ítems, NUNCA PII de alumnos**
(sin nombres ni RUT). La agrupación de alumnos para remediales se hace de forma
**determinista** en el backend; la IA solo etiqueta el grupo en abstracto
("alumnos con brecha en "inferir información implícita""). El `org_id` del token
acota todo (multi-tenant). El snapshot enviado se persiste en `ai_analyses.input`
para auditoría.

---

## 2. Jobs-to-be-done → qué responde el módulo

| Rol | Decisión que toma | Feature que la habilita |
|---|---|---|
| Profesor | ¿Qué 3 cosas reenseño y cómo? | Diagnóstico de brechas con causa raíz (H7.5) |
| Profesor | ¿Qué funcionó en mis mejores preguntas? | Top 5 ítems → tarjetas de práctica (H7.4) |
| Profesor | ¿Es brecha de enseñanza o ítem malo? | Bottom 5 + Calidad de ítems (H7.4, H7.6) |
| Profesor | ¿A qué alumnos agrupo y por qué? | Agrupación remedial determinista + etiqueta IA (H7.5) |
| Director/UTP | ¿Dónde pongo recursos primero? | Recomendaciones priorizadas + narrativa de gestión (H7.3, H7.7) |
| Director/UTP | ¿Brecha sistémica o aislada? | Síntesis cruzando cursos (H7.3) |
| Director/UTP | ¿Qué instrumentos arreglar antes de reusar? | Calidad de instrumento KR-20 + ítems (H7.6) |

---

## 3. Métricas (lo que el motor IA "lee")

**Ya disponibles (H6.13):** dificultad _p_, discriminación _D_ (27% Kelley),
distractor dominante, distribución por nivel, comparativa por curso, ranking de
habilidades, cobertura (evaluados/matriculados).

**Nuevas a calcular (deterministas, alimentan a la IA):**

| Métrica | Qué aporta | Cómo |
|---|---|---|
| **KR-20 / α de Cronbach** | Confiabilidad del instrumento (¿mide consistente?) | Sobre la matriz de respuestas correctas/incorrectas del instrumento |
| **Correlación punto-biserial** | Discriminación más fina por ítem que _D_ | Corr. ítem-correcto vs puntaje total |
| **Cobertura del blueprint** | ¿El instrumento mide bien cada habilidad? (nº ítems por nodo vs esperado) | `item_taxonomy_tags` agrupado por nodo |
| **Persistencia de brecha** | ¿La brecha viene de antes? (señal de urgencia) | vs `analytics/progression` histórico |
| **Patrón de distractor** | El distractor dominante = la misconcepción común | distribución por alternativa (ya existe) |

---

## 4. Flujos y contrato de salida IA (lo ingeniado)

Cada análisis es un registro en `ai_analyses` con `output` **tipado** (validado
con Zod tras la respuesta del modelo). Bosquejo del contrato principal:

```ts
// packages/types/src/schemas/ai-analysis.schema.ts (contrato — borrador)

type AssessmentInsightsOutput = {
  headline: string;                       // titular de una línea
  executiveSummary: {                     // narrativa adaptativa (H7.3)
    director: string;                     // foco gestión / priorización
    teacher: string;                      // foco accionable de aula
  };

  topItems: ItemPracticeCard[];           // 5 mejores (alto p + alta D) — H7.4
  bottomItems: ItemDiagnosisCard[];       // 5 peores — H7.4

  skillGaps: SkillDiagnosis[];            // brechas con causa raíz — H7.5
  itemQuality: ItemQualityIssue[];        // ítems a revisar/arreglar — H7.6
  recommendations: AiRecommendation[];    // priorizadas y por audiencia — H7.7

  reliability: { kr20: number | null; interpretation: string };
  confidence: number;                     // 0..1 autoevaluación del análisis
  caveats: string[];                      // límites/datos insuficientes
};

type ItemPracticeCard = {                 // "¿qué hizo buena a esta pregunta?"
  position: number; skillName: string | null;
  difficulty: number | null; discrimination: number | null;
  whatWorked: string[];                   // claridad, alineación al OA, nivel cognitivo
  replicableAction: string;               // práctica reutilizable para clases
};

type ItemDiagnosisCard = {                // "¿por qué falló y qué hago?"
  position: number; skillName: string | null;
  difficulty: number | null;
  likelyCause: 'not_taught' | 'misconception' | 'item_quality' | 'insufficient_practice';
  misconception: string | null;          // inferida del distractor dominante
  actionPlan: string[];                   // pasos concretos de remediación
};

type SkillDiagnosis = {
  nodeId: string; nodeName: string; achievement: number | null;
  rootCauseHypothesis: string;            // hipótesis de por qué la brecha
  misconceptionSignal: string | null;     // desde patrones de distractor
  reteachStrategy: string;                // estrategia de reenseñanza
  exampleActivity: string;                // actividad concreta de ejemplo
  remedialGroupSize: number;              // nº alumnos (determinista, sin PII)
};

type ItemQualityIssue = {
  position: number;
  issue: 'low_discrimination' | 'ambiguous_key' | 'strong_distractor' | 'too_easy' | 'misaligned';
  evidence: string; suggestedFix: string; // p.ej. "reformular alternativa C"
};

type AiRecommendation = {
  audience: 'director' | 'teacher';
  priority: 'high' | 'medium' | 'low';
  title: string; rationale: string;
  suggestedActions: string[];
  linkedSkillIds: string[]; linkedItemPositions: number[];
};
```

> **Top/Bottom 5 (H7.4)** es exactamente la práctica que ya hacen los profesores
> manualmente (de los 5 mejores extraer buenas ideas; de los 5 peores definir
> plan), automatizada y conectada a la psicometría. Es la feature insignia.

---

## 5. Modelo de datos (1 tabla nueva)

`packages/db/src/schema/ai-analysis.ts` — sirve a la vez de **job async** (status)
y de **caché** (input_hash). No requiere `action_plans` (alcance solo lectura).

```ts
export const aiAnalyses = pgTable('ai_analyses', {
  id: uuid().defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),                 // multi-tenant
  assessmentId: uuid('assessment_id'),             // objetivo del análisis
  classGroupId: uuid('class_group_id'),            // drill-down opcional
  analysisType: text('analysis_type').notNull(),   // 'assessment_insights' | …
  audience: text('audience').notNull().default('general'),
  status: text('status').notNull().default('pending'), // pending|processing|completed|failed
  model: text('model'), promptVersion: text('prompt_version'),
  inputHash: text('input_hash'),                   // clave de caché
  input: jsonb('input').$type<Record<string, unknown>>(),   // snapshot (auditoría)
  output: jsonb('output').$type<AssessmentInsightsOutput>(),
  tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
  costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
  error: text('error'),
  createdById: uuid('created_by_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),              // "descartar" análisis
});
```

Índices: `(org_id, assessment_id, analysis_type, audience)` para la última versión;
`input_hash` para reuso de caché. RLS por `org_id` (filtro manual, ver memoria
`project-rls-lost-in-squash`).

---

## 6. API (módulo `apps/api/src/ai-analysis/`)

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/ai-analysis/assessments/:assessmentId/generate` | Dispara generación async (body: `{ analysisType?, audience?, classGroupId?, force? }`). Si hay caché válida (mismo `input_hash`) y no `force`, la devuelve. Retorna `{ analysisId, status }`. |
| `GET` | `/ai-analysis/:analysisId` | Poll de estado + `output` cuando `completed`. |
| `GET` | `/ai-analysis/assessments/:assessmentId?type=&audience=` | Último análisis disponible (404 → la UI ofrece "Generar"). |

Servicios:
- `ai-analysis.service.ts` — orquestación, scoping (replica el de resultados),
  caché por `input_hash`, persistencia, control de costo.
- `ai-analysis.snapshot.ts` — ensambla el input: **reusa `AssessmentReportService`**
  (gran reuso) + contenido de ítems + KR-20/punto-biserial/cobertura.
- `gemini.provider.ts` — wrapper del LLM (reusar patrón del módulo `ai-tagging`
  de H3.11 si aplica), con `prompt_version` y parseo Zod estricto de la salida.
- Procesamiento async: el controller inserta `pending` y retorna; el trabajo corre
  fuera del ciclo de request actualizando `processing → completed/failed`. **F1
  usa polling en DB** (no BullMQ); migrable a BullMQ en F3+ sin cambiar el schema.

Guardrails: salida IA en `output` (nunca sobrescribe datos deterministas) ·
`org_id` siempre del token · costo trazado en `cost_usd` · timeout + retry con
backoff · si el modelo devuelve algo no parseable por Zod → `failed` con `error`.

---

## 7. Historias de usuario (Epic H7)

> Numeración **provisional** (H6 = dashboards/resultados; H7 = nuevo epic Análisis IA).
> Confirmar contra el roadmap antes de congelar.

| ID | Historia | Compl. | MVP |
|---|---|---|---|
| **H7.1** | Infraestructura del motor IA: tabla `ai_analyses`, job async + polling, proveedor Gemini Flash, caché por `input_hash`, trazado de costo, guardrails de privacidad | ★★★★ | ✅ |
| **H7.2** | Snapshot de métricas para IA: ensamblar input reusando el Informe (H6.13) + contenido de ítems + KR-20 + punto-biserial + cobertura blueprint | ★★★ | ✅ |
| **H7.3** | Síntesis narrativa adaptativa (director / profesor) | ★★★ | ✅ |
| **H7.4** | Top/Bottom 5 ítems: tarjetas de práctica (mejores) + diagnóstico con causa raíz (peores) | ★★★★ | ✅ |
| **H7.5** | Diagnóstico de brechas por habilidad con causa raíz (distractor → misconcepción → estrategia) + tamaño de grupo remedial (determinista) | ★★★★ | ✅ |
| **H7.6** | Calidad de instrumento e ítems: KR-20 + flags + sugerencia de corrección | ★★★ | — |
| **H7.7** | Recomendaciones priorizadas y por audiencia (impacto × factibilidad) | ★★★ | ✅ |
| **H7.8** | Nueva sección "Análisis IA": generar, estado/polling, render de tarjetas, vista adaptativa por rol, enlace desde el Informe | ★★★★ | ✅ |
| **H7.9** | Exportar el análisis IA a Excel/PDF (reusa patrón H6.13) | ★★ | — |
| **H7.10** | Confianza + caveats + disclaimer ("sugerencia IA, validar") + regenerar/descartar | ★★ | ✅ |

**Criterios de aceptación (ejemplos clave):**

- **H7.4** — Dado un análisis completado, la sección muestra exactamente los 5
  ítems de mayor calidad (alto _p_ y _D_) con ≥1 práctica reutilizable cada uno, y
  los 5 de peor desempeño con causa raíz clasificada y un plan de ≥2 pasos. La
  causa "ítem malo" se distingue de "no enseñado" usando _D_ y el distractor.
- **H7.5** — Cada brecha de habilidad de nivel insuficiente/elemental tiene
  hipótesis de causa, señal de misconcepción derivada del distractor dominante,
  estrategia de reenseñanza y una actividad de ejemplo. El nº de alumnos del grupo
  remedial es determinista; **no** se exponen nombres al LLM.
- **H7.8** — Si no hay análisis, la UI ofrece "Generar análisis"; durante el
  proceso muestra estado (pending/processing) con feedback; al completar, render
  de tarjetas. La narrativa mostrada cambia según el `activeRole` del usuario.
- **H7.10** — Todo análisis muestra confianza, caveats y un disclaimer visible de
  "sugerencia generada por IA — validar antes de actuar".

**MVP del sprint:** H7.1, H7.2, H7.3, H7.4, H7.5, H7.7, H7.8, H7.10.
**Segunda ola:** H7.6 (calidad de instrumento) y H7.9 (export) — valor alto pero
no bloquean la demo del flujo dato→insight.

---

## 8. Secuenciación (metodología sprint-parallel)

Rama de integración `sprint-ia` desde `dev`. Cada agente en su worktree aislado y
**commitea antes de terminar** (memoria `feedback-worktree-commit`).

**Paso 0 — Contratos (orquestador, antes de los agentes):**
- `packages/types/src/schemas/ai-analysis.schema.ts` — query/response DTOs +
  `AssessmentInsightsOutput` y sub-modelos.
- `packages/db/src/schema/ai-analysis.ts` + migración `ai_analyses`.
- `packages/types/src/access-policies.ts` — `AI_ANALYSIS_VIEWER_ROLES`,
  `AI_ANALYSIS_GENERATOR_ROLES` (quién puede gatillar generación = costo).
- Confirmar credenciales/SDK de Gemini en `apps/api` y variable de entorno.

**Paso 1 — Agentes:**

| Agente | Tipo | Propiedad exclusiva | Historias |
|---|---|---|---|
| **BE-A** | backend | `apps/api/src/ai-analysis/` (módulo, controller, service, job) | H7.1 |
| **BE-B** | backend | `ai-analysis/snapshot.ts` + métricas nuevas (KR-20, punto-biserial, cobertura) | H7.2, H7.6-métricas |
| **BE-C** | backend | `ai-analysis/gemini.provider.ts` + prompt builders + parseo Zod por tipo de análisis | H7.3, H7.4, H7.5, H7.7 (prompts) |
| **FE-A** | frontend | `apps/web/src/app/(dashboard)/analisis-ia/` (página, generación, polling, layout adaptativo) | H7.8, H7.3 (render), H7.10 |
| **FE-B** | frontend | componentes de tarjetas (top/bottom, brechas, recomendaciones) + export | H7.4, H7.5, H7.7 (render), H7.9 |

> BE-B y BE-C tocan el mismo módulo que BE-A → coordinar vía archivos separados
> (`snapshot.ts`, `gemini.provider.ts`, `prompts/`) para evitar conflictos; BE-A
> define las interfaces que B y C implementan. Alternativa más segura: BE-A entrega
> el esqueleto del módulo + interfaces committeado antes de que B y C arranquen.

**Paso 2 — Integración:** juntar agentes en `sprint-ia`, probar el flujo
end-to-end con una evaluación seedeada, validar costo/latencia reales de Gemini.

---

## 9. Flujo demo del sprint

Abrir una evaluación → "Análisis IA" → Generar → (async, ~segundos) → leer titular
+ narrativa según rol → revisar Top 5 (qué replicar) y Bottom 5 (qué remediar) →
ver brechas con causa raíz y actividad sugerida → revisar recomendaciones
priorizadas → exportar. El director ve priorización; el profesor, accionable de aula.

## 10. Criterio de salida

Un usuario genera un análisis IA de una evaluación real; el resultado se persiste
y cachea; la narrativa se adapta al rol; Top/Bottom 5 y diagnóstico de brechas son
coherentes con la psicometría determinista; no se envía PII al LLM; el costo queda
trazado; todo con `typecheck` + `lint` + tests de service en verde.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Privacidad (PII al LLM) | Snapshot agregado sin nombres/RUT; agrupación determinista; auditoría en `input` |
| Alucinación / inconsistencia con los números | La IA solo razona sobre métricas dadas; salida validada con Zod; mostrar siempre la métrica junto al insight; disclaimer |
| Costo / latencia | Caché por `input_hash`; async + polling; Gemini Flash (barato); trazado en `cost_usd` |
| Calidad pedagógica variable de Flash | Prompts versionados + few-shot; evaluación humana en demo; opción futura híbrida con Claude para diagnóstico (H7-fase 2) |
| Alcance (es F2) | MVP acotado a insights solo-lectura; sin entidad de acciones todavía |
| Latencia de un solo job grande | Posibilidad de dividir por tipo de análisis (varios registros) si un prompt único excede contexto/tiempo |
