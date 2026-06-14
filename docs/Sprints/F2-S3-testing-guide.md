# Guía de testing — F2 · Sprint 3 (IA Remedial / RAG)

> H9.1 RAG context · H9.2 guía de reenseñanza · H9.3 ítems de práctica · H9.4 plan por grupo ·
> H9.5 aprobación · H9.6 UID `/material-remedial`. Rama `sprint-f2-3`.
> Requiere `DATABASE_URL` + `pnpm db:migrate` (aplica la migración `0003` + RLS), datos seedeados con
> una taxonomía (OAs/`taxonomy_nodes`), una evaluación con `skill_results`/`responses`, y
> `GEMINI_API_KEY` para la generación real (sin ella el job marca `failed`; el flujo UI/polling se
> prueba igual con `failed`).

## Pre-requisitos
1. `pnpm install` && `pnpm --filter @soe/types build` && `pnpm --filter @soe/db build`.
2. `pnpm db:migrate` (aplica `0003_chief_pete_wisdom.sql` — tabla `remedial_materials` + enums — y
   re-aplica `rls-policies.sql` con la política `remedial_materials_tenant_isolation`).
3. Levantar API (`pnpm --filter @soe/api dev`) y web (`pnpm --filter @soe/web dev`).
4. Sesión con `teacher` (con cursos asignados) y con `school_admin`/`academic_director`.

---

## H9.1 — RAG context (recuperación curricular estructurada)
- Indirecto (alimenta a los generadores). Verificar en `remedial_materials.input` (auditoría) que el
  contexto enviado al modelo contiene OA objetivo + ancestros + descriptores + hermanos + ítems
  etiquetados, y **NO** contiene PII.

## H9.2 — Guía de reenseñanza (UI + API)
### E2E (UI)
1. En `/analisis-ia?assessmentId=<id>` con un análisis generado, en una **brecha** pulsar
   **"Generar material remedial"** → navega a `/material-remedial?nodeId=…&assessmentId=…&type=guide&generate=1`.
2. Confirmar tipo `guide` y generar → polling hasta `ready` → render de la guía (objetivo, causa raíz,
   estrategia, actividades, materiales, criterios de éxito). **Disclaimer IA visible.**
### API
```
POST /api/remedial/generate  { "type":"guide", "nodeId":"<uuid>", "assessmentId":"<uuid?>", "force":false }
  → 201 { "materialId":"<uuid>", "status":"pending"|"ready" }
GET /api/remedial/:id  → RemedialMaterialModel (status='ready', content=<RemedialGuideContent>)
```

## H9.3 — Ítems de práctica
1. Generar `type=practice_set` desde una brecha → al `ready`, el `content` lista referencias
   (`itemId`, `position`, `stem`).
2. Verificar en DB que se crearon filas en `items` con `source='ai_generated'`, `status='draft'`,
   `instrument_id=null`, tags en `item_taxonomy_tags` (`tagged_by='ai'`) al `nodeId`.
3. **Aprobar** el material (H9.5) → los ítems pasan a `status='published'`.

## H9.4 — Plan por grupo (sin PII)
1. Generar `type=group_plan` con `classGroupId` → `ready` con `content` = `{ groupLabel, studentCount,
   sharedGap, sequence[], estimatedSessions }`.
2. **Verificar `studentCount`**: debe coincidir con los alumnos del curso bajo umbral en la habilidad
   (cálculo determinista backend), **no** lo que diga el modelo.
3. **PII**: inspeccionar `remedial_materials.input` y el prompt — sin nombres/RUT/studentId.

## H9.5 — Workflow IA propone / humano aprueba
```
PATCH /api/remedial/:id/review  { "action":"approve", "content": <RemedialContent editado?> }
PATCH /api/remedial/:id/review  { "action":"discard" }
```
- Solo `REMEDIAL_APPROVER_ROLES`. Solo desde estado `ready`. `approve` → `approved` (+ publica ítems del
  practice_set), sella `reviewedById`/`reviewedAt`; `discard` → `discarded`. El `content` editado se
  re-valida con `validateRemedialContent`.

## H9.6 — Sección Material Remedial
1. `/material-remedial`: banco con filtros (type/status/nodeId), tarjetas, paginación.
2. Detalle `/material-remedial/:id`: poller (pending/processing) → review (ready) → solo lectura
   (approved/discarded). Edición de la guía antes de aprobar (re-valida).
3. Nav "Material Remedial" visible para `REMEDIAL_VIEWER_ROLES`.

---

## Casos de error / borde
- **Caché**: dos `generate` iguales (mismo type+nodeId+classGroupId+itemCount) sin `force` → el segundo
  devuelve de caché (mismo material `ready`/`approved`, sin reencolar).
- **Sin GEMINI_API_KEY / salida no-JSON / schema inválido**: el job → `failed` (el detalle muestra el error).
- **Multi-tenant**: un material de otra org → 404. Toda query bajo `withOrgContext` + RLS.
- **Rol insuficiente**: un rol fuera de `REMEDIAL_APPROVER_ROLES` no puede aprobar/descartar (403).
- **Modo generación**: solo se activa con `?nodeId=&generate=1` explícito; `?type=`/`?nodeId=` sin
  `generate` filtran el banco (no caen en modo generación).

## Checklist de aceptación del sprint
- [ ] `pnpm typecheck` (api + web) sin errores · `nest build` ✅.
- [ ] `pnpm --filter @soe/api test` — suite `remedial` en verde (las `privacy/*` requieren `DATABASE_URL`).
- [ ] Lint sin errores en `remedial/` y `material-remedial/`.
- [ ] H9.1–H9.6 según los pasos de arriba; **cero PII al LLM**; ítems IA en draft, publican solo al aprobar.
