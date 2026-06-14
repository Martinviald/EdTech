# Guía de testing — F2 · Sprint 2

> Análisis IA por-pregunta (H20.8) · Calidad de instrumento (H20.9) · Export (H20.10) · Informe consolidado (H20.11).
> Rama `sprint-f2-2`. Requiere `DATABASE_URL` + datos seedeados con una evaluación DIA con respuestas,
> ítems con pasaje (`instrument_sections`) y, opcionalmente, imágenes con `url` http(s). Para H20.8 la
> generación real necesita `GEMINI_API_KEY` (sin ella, el provider degrada y el job marca `failed`; el
> flujo de UI/polling igual se prueba con el estado `failed`).

## Pre-requisitos
1. `pnpm install` && `pnpm --filter @soe/types build` && `pnpm --filter @soe/db build`.
2. DB con migraciones aplicadas (`pnpm db:migrate`) y seed con: una evaluación con resultados/`responses`,
   ítems de selección múltiple, al menos un ítem con sección/pasaje y un ítem con `content.imageUrl`.
3. Levantar API (`pnpm --filter @soe/api dev`) y web (`pnpm --filter @soe/web dev`).
4. Iniciar sesión con un usuario `school_admin`/`academic_director` (generador IA) y, por separado, un
   `teacher` (viewer, con cursos asignados) para probar el scoping.

---

## H20.8 — Análisis IA por-pregunta (drill-down multimodal)

### E2E feliz (UI)
1. Ir a `/analisis-ia?assessmentId=<id>` con un análisis de evaluación ya generado (S1).
2. En el informe, abrir el **selector de pregunta** (o desde Top/Bottom 5) y elegir una pregunta → se
   abre el modal de drill-down.
3. Pulsar **Generar análisis**. Verificar: el modal muestra estado `pending/processing` con feedback y
   hace polling. Al completar, renderiza: headline, por qué se obtuvo el resultado, causa probable,
   misconcepción (si hay distractor dominante), lectura de distractores, **insight del pasaje** (si el
   ítem tiene pasaje), **insight visual** (si se adjuntó imagen), veredicto de calidad del ítem,
   acciones recomendadas, confianza y caveats.
4. Verificar el **disclaimer "sugerencia IA, validar"** visible.
5. Pulsar **Regenerar** (force) → crea un análisis nuevo ignorando caché.

### API directa
```
POST /api/ai-analysis/items/:itemId/generate
  body: { "assessmentId": "<uuid>", "audience": "teacher", "classGroupId": "<uuid?>", "force": false }
  → 201 { "analysisId": "<uuid>", "status": "pending" | "completed" }
GET /api/ai-analysis/:analysisId
  → { ..., "status": "completed", "output": <ItemInsightOutput> }
```

### Casos de error / borde
- **Sin imagen fetcheable** (solo `storageKey` S3 o `url` caída): el análisis se completa en **modo
  texto** (visualInsight = null). No debe fallar el job.
- **Sin pasaje**: passageInsight = null.
- **Caché**: dos `generate` iguales (mismo item+assessment+audience+classGroup) sin `force` → el segundo
  responde de caché (mismo `analysisId` completado, sin reencolar).
- **Cohorte**: con `classGroupId`, el point-biserial del snapshot se calcula sobre los alumnos de ese
  curso (consistente con p/D). Sin `classGroupId`, sobre toda la evaluación.
- **Multi-tenant**: un `itemId`/`assessmentId` de otra org → 404 (no filtra existencia entre orgs).
- **Rol insuficiente**: un `teacher` NO puede gatillar `generate` (no está en `AI_ANALYSIS_GENERATOR_ROLES`) → 403.
- **PII**: inspeccionar `ai_analyses.input` y el prompt — NO debe contener nombres ni RUT de alumnos.

---

## H20.9 — Calidad de instrumento e ítems (determinista)

### E2E (UI)
1. En `/analisis-ia?assessmentId=<id>` con un usuario con `INSTRUMENT_QUALITY_VIEWER_ROLES`, verificar el
   **panel de calidad**: KR-20 + interpretación, conteo de ítems con alertas, y la tabla de ítems con
   sus flags (chips) y sugerencias.

### API directa
```
GET /api/instrument-quality?assessmentId=<uuid>&classGroupId=<uuid?>
  → InstrumentQualityResponse { assessmentId, assessmentName, instrumentId, instrumentName,
       reliability: { kr20, interpretation, itemsAnalyzed, studentsAnalyzed },
       items: [{ itemId, position, skillName, contentName, correctKey, difficulty, discrimination,
                 pointBiserial, dominantDistractor, dominantDistractorRate, flags, suggestions }],
       flaggedCount }
```

### Casos a verificar
- **Flags** (umbrales): `low_discrimination` (D<0.20), `ambiguous_key` (point-biserial<0.10 o negativo),
  `strong_distractor` (un distractor ≥ clave o >35%), `too_easy` (p>90%), `misaligned` (ítem sin tags).
- **Sugerencias**: cada flag aporta una sugerencia determinista (texto en español) — confirmar que NO
  hay variación entre llamadas (no hay IA).
- **KR-20 interpretación** por rango: ≥0.9 Excelente / 0.8–0.9 Buena / 0.7–0.8 Aceptable / 0.6–0.7
  Cuestionable / <0.6 Pobre / null No calculable.
- **Scoping profesor**: un `teacher` ve solo la calidad calculada sobre sus cursos; sin cursos → vacío/Forbidden.
- **Multi-tenant**: evaluación de otra org → 404.

---

## H20.10 — Export Excel/PDF

1. En `/analisis-ia` con un análisis completado, pulsar **Exportar análisis**.
2. **Excel (.xlsx)**: verificar hojas con narrativa, Top/Bottom 5, brechas, recomendaciones y calidad de
   instrumento (si está disponible).
3. **PDF (.pdf)**: documento con las mismas secciones + disclaimer IA. Colores coherentes con la pantalla.
4. Sin red (offline): el export debe funcionar (es 100% client-side, opera sobre datos ya cargados).

---

## H20.11 — Informe IA consolidado

1. Verificar que `/analisis-ia` reúne en un documento único: titular + narrativa adaptativa por rol
   (`activeRole` director vs profesor) + Top/Bottom 5 + brechas + recomendaciones + resumen de calidad de
   instrumento + preguntas destacadas (bottomItems con su diagnóstico).
2. Cambiar el `activeRole` (switch-role) y refrescar → la narrativa/recomendaciones se adaptan.
3. Exportar el consolidado (H20.10) → un solo archivo compartible.

---

## Checklist de aceptación del sprint
- [ ] `pnpm typecheck` (api + web) sin errores.
- [ ] `pnpm --filter @soe/api test` — suites de `ai-analysis` + `item-insight` + `instrument-quality` en
      verde (las suites `privacy/*` requieren `DATABASE_URL` real; fallan igual en `dev`).
- [ ] Lint sin errores en los módulos nuevos.
- [ ] H20.8: drill-down genera, hace polling y renderiza `ItemInsightOutput`; degrada sin imagen; caché
      por item+cohorte; sin PII al LLM; 403 para `teacher` en generate.
- [ ] H20.9: KR-20 + flags + sugerencias deterministas; scoping por rol; 100% sin IA.
- [ ] H20.10: export Excel/PDF client-side con disclaimer.
- [ ] H20.11: informe consolidado adaptativo por rol, exportable.
