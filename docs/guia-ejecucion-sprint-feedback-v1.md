# Guía de Ejecución — Sprint "Iteración Feedback v1"

> Playbook operativo para desarrollar los 26 tickets del plan de iteración sobre el feedback de la v1.
> Documento hermano de [`plan-iteracion-feedback-v1.md`](./plan-iteracion-feedback-v1.md) (el *qué*) — este es el *cómo se ejecuta*.
> Se ejecuta **paso a paso, a orden del usuario**. Cada paso tiene su casilla de estado al final del documento.

---

## 0. Principio rector del sprint

Este sprint **no se paraleliza por ticket**, porque muchos tickets editan los mismos archivos del frontend de resultados (`question-detail-panel.tsx`, `report-body.tsx`, `cross-table.tsx` aparecen en 4-6 tickets cada uno). Mapear 1 ticket = 1 agente en worktree garantiza conflictos de merge.

La frontera de paralelismo del método `sprint-parallel` es **el módulo/directorio, no el ticket** (*"cada agente toca SOLO su directorio de módulo, no shared files"*). Por eso el sprint se organiza en **dos ejes que corren simultáneos**, no en cuatro olas secuenciales:

```
tiempo →
FRONT (1 stream serial):   [FRONT-1 terminología]──[FRONT-2 interacción]
                                    │ consume contratos de ↓
BACK-B analytics:          [escala + params orden/filtro]
BACK-C instrumentos/PDF:   [banco global + PDF + spec-table]     ← corren en
BACK-D remedial:           [imprimible + versión alumno]            PARALELO entre sí
BACK-E informe DIA:        [motor de reporte 6 secciones]           y con el stream FRONT
```

- **Un solo stream de frontend de resultados**, secuencial internamente (todo vive en las mismas vistas). Se hace a mano o con un agente dedicado. **Sin worktrees ni contratos.**
- **Cuatro streams de backend**, disjuntos por módulo → aquí sí aplica la maquinaria `sprint-parallel` (contratos → agentes → auditoría → integración).
- **Única dependencia cruzada:** los tickets con param backend (TKT-09 orden, TKT-12 filtro) — el frontend se tipa contra el **contrato Zod** commiteado en Fase 0 y no espera a que el backend termine.

---

## 1. Alcance del sprint

**Dentro de esta pasada (accionable ahora):**

| Stream | Tickets | Módulo/área | Método |
|---|---|---|---|
| **FRONT-1** — Terminología | 01, 02, 03, 05, 06, 07 | Vistas de resultados (`apps/web`) | Serial, a mano |
| **FRONT-2** — Interacción | 08, 10, 11, 13, 18 | Vistas de resultados + banco | Serial, detrás de FRONT-1 |
| **BACK-B** — Analytics | 04, 09, 12 | `analytics`, `item-analysis` | sprint-parallel |
| **BACK-C** — Instrumentos | 14, 15, 16 | `instruments`, banco, spec-table | sprint-parallel |
| **BACK-D** — Remedial | 17 | `remedial` | sprint-parallel |
| **BACK-E** — Informe DIA | 24, 25, 26 | motor de reporte (nuevo) | sprint-parallel |

**Diferido (fuera de esta pasada — no tocar):**

- **TKT-19** — Escritura asistida de ítems por el asistente (Apéndice A, feature grande).
- **TKT-20** — Benchmark inter-colegios (no hay data multi-colegio aún).
- **TKT-21 / TKT-22** — La parte "muestra de colegios" se difiere; el **histórico propio de la org** es viable y se puede sumar a BACK-B si el usuario lo pide.
- **TKT-23** — Diagnóstico IA de variación entre instrumentos (Apéndice A, feature grande).

> ⚠️ **Los file:line del mapeo tienen ~40 días.** Antes de tocar código en cada stream, se re-verifican contra el código actual (Fase 0 para backend; primer paso de cada stream frontend).

---

## 2. Pre-fase — Rama y worktrees

Se ejecuta **una vez**, antes de cualquier código.

1. Crear la rama del sprint desde `dev` (no `main`), en su propio worktree:
   ```bash
   git worktree add -b sprint-feedback-v1 ../sprint-feedback-v1 dev
   ```
2. Toda la Fase 0, la integración y la validación ocurren en `../sprint-feedback-v1`.
3. El **stream FRONT** también trabaja sobre `sprint-feedback-v1` (a mano, sin worktree propio).
4. El merge final natural es a **`dev`**, solo con confirmación explícita del usuario.

> ⚠️ **Los worktrees aislados de los agentes (`isolation: "worktree"`) nacen de `main`, no del HEAD actual.** Por eso cada agente backend debe, como primer paso, `git merge sprint-feedback-v1` (o `git reset --hard sprint-feedback-v1` si su worktree no tiene trabajo previo) para traer los contratos de Fase 0 y `@soe/types`. Esto se instruye explícitamente en cada prompt de agente.

---

## 3. Stream FRONT-1 — Terminología (serial, a mano)

Quick-wins de nomenclatura en las vistas de resultados. **Sin worktrees, sin contratos** — el overhead no se paga aquí. Un solo hilo de trabajo secuencial.

| Ticket | Cambio | Archivos (re-verificar) |
|---|---|---|
| **TKT-01** | "% de acierto" → **"% de logro"** en toda vista | `question-detail-panel.tsx`, `cross-table.tsx`, `report-body.tsx` |
| **TKT-02** | "Cobertura" → **"Asistencia"** | `report-body.tsx`, `evaluaciones/[id]/page.tsx`, `report-export-button.tsx` + rename campo backend `coverageRate`→`attendanceRate` en `assessment-report.schema.ts` (contrato) |
| **TKT-03** | Códigos `LANG-`/`OA` → render **"Lenguaje" / "OA-{n}"** (mapa código→label; el código en DB/seed no cambia) | `question-detail-panel.tsx`, `ItemDetailPanel.tsx` |
| **TKT-05** | **Ocultar descriptores** en TODA vista de resultados (se mantienen en el banco) | `question-detail-panel.tsx` (NODE_TYPE_LABELS) |
| **TKT-06** | **Quitar badge "secundario"** (el nodo se mantiene) | `question-detail-panel.tsx` |
| **TKT-07** | **Agrandar panel lateral** de resultados | `question-detail-panel.tsx` (`sm:max-w-lg lg:max-w-xl`) |

**Orden interno:** 01 → 03 → 05 → 06 → 07 (todos en `question-detail-panel.tsx`, se hacen juntos) → 02 (toca otros archivos + rename de contrato).

**Criterio de cierre FRONT-1:** `pnpm typecheck` + `pnpm lint` limpios; las tres vistas de resultados muestran la nueva nomenclatura; sin descriptores ni badge secundario visibles en resultados.

---

## 4. Stream FRONT-2 — Interacción (serial, detrás de FRONT-1)

Mejoras de interacción, mismos archivos de resultados → **no arranca hasta cerrar FRONT-1**.

| Ticket | Cambio | Depende de |
|---|---|---|
| **TKT-08** | Listas en vez de calugas (instrumentos + evaluaciones) | — |
| **TKT-10** | Drill-down habilidad → preguntas por **modal/panel** | — |
| **TKT-11** | Dropdown para elegir **dimensión** de análisis | — |
| **TKT-13** | Textos/pasajes del instrumento en bloque **colapsable** | — |
| **TKT-18** | Renombrar `/resultados` → **"Panorama pedagógico"** (solo nomenclatura UI; vistas intactas) | — |
| *(TKT-09 front)* | Consumir el param de **orden** del contrato de BACK-B | contrato B commiteado |
| *(TKT-12 front)* | Consumir el filtro **multi-tag** del contrato de BACK-B | contrato B commiteado |

**Criterio de cierre FRONT-2:** interacciones funcionan; el front se tipa contra los Models de `packages/types`, no tipos locales.

---

## 5. Fase 0 — Contratos (backend)

Antes de lanzar **cualquier** agente backend. Se define en `packages/types` y se **commitea en `sprint-feedback-v1`**.

Contratos necesarios (solo los tickets que cambian response/params shapes):

- **BACK-B:** param de orden (`sort`) y filtro (`tagIds[]`, multi-tag OR) en el schema de `item-analysis`. Rename `coverageRate`→`attendanceRate` en `assessment-report.schema.ts` (coordinar con TKT-02).
- **BACK-C:** Model de **PDF por instrumento** (TKT-15) — mover `attachment` de nivel sección a nivel instrumento en el contrato. Model de **banco global** (TKT-14).
- **BACK-E:** Model completo del **Informe DIA** — las 6 secciones (portada+metadatos, resultado general, ejes de habilidad, tabla de especificaciones con %respuestas por alternativa, resultados por estudiante, conclusiones). Es el contrato más grande; ver §7 del plan para la estructura exacta.

Al cerrar Fase 0: `pnpm --filter @soe/types build` + commit. Recién ahí se lanzan los agentes.

---

## 6. Fases del método por stream backend (B/C/D/E)

Cada stream backend sigue el ciclo `sprint-parallel` v2:

1. **Fase 1 — Backend:** 1 agente por stream, en worktree aislado. Recibe: tickets + criterios de aceptación + reglas de calidad (§7) + instrucción de traer contratos (`git merge sprint-feedback-v1` + `pnpm install` + build de `@soe/types` y `@soe/db`).
2. **Fase 2 — Frontend (por stream que lo requiera):** agente que tipa contra los Models del contrato. `canAccess` obligatorio, RLS respetado.
3. **Fase 3 — Auditoría:** agentes de review (backend + frontend) con checklist de 10 puntos, **antes** del merge. Reportan violations.
4. **Fase 4 — Integración:** juntar todas las ramas de agente en `sprint-feedback-v1` (merge secuencial), registrar módulos (`app.module.ts`, `nav-items.ts` se tocan **solo aquí**), aplicar fixes de auditoría, verificar compilación.
5. **Fase 5 — Validación E2E:** levantar servers, smoke test de endpoints (401 esperado = guard OK), verificar que las rutas frontend cargan.

Los streams B/C/D/E corren **en paralelo entre sí** y en paralelo con el stream FRONT.

---

## 7. Reglas de calidad (obligatorias en cada agente)

Se inyectan en cada prompt de agente y se auditan en Fase 3:

- **Commit obligatorio en worktree:** un agente que no commitea pierde todo su trabajo. Commitear antes de reportar.
- **Multi-tenancy / RLS:** toda query a tabla sensible corre dentro de `withOrgContext(db, orgId, tx => ...)` usando `tx`, nunca `this.db`. Filtrar por `org_id` del token, nunca del body.
- **Roles:** usar `userHasRole` / `userHasAnyRole` / `canAccess` de `@soe/types`; constantes en `access-policies.ts`. Nunca `user.role === 'xxx'`.
- **Contratos primero:** el frontend se tipa contra Models de `packages/types`, no tipos locales. Nunca duplicar un schema Zod.
- **TypeScript estricto:** sin `any`. Inferir desde Drizzle (`$inferSelect`) y Zod (`z.infer`).
- **Clean architecture:** Controller valida y delega; toda la lógica en el Service; cero queries Drizzle directas en el controller.
- **Extensibilidad:** nada hardcodeado a "DIA"/"Lenguaje" — usar IDs de `curricula`/`taxonomy_nodes`. (Aplica especialmente al informe DIA de BACK-E: es una plantilla sobre datos que la plataforma ya calcula, no un caso especial.)
- **Cierre:** `pnpm typecheck` + `pnpm lint` limpios antes de commitear.

---

## 8. Checklist maestro de ejecución

Se marca a medida que avanzamos. Estados: ⬜ pendiente · 🟡 en curso · ✅ hecho.

### Pre-fase
- [x] ✅ P0 — Crear rama+worktree `sprint-feedback-v1` desde `dev` *(worktree en `../sprint-feedback-v1`, commit `c6eb570` con plan+guía)*

### Stream FRONT (serial)
- [x] ✅ FRONT-1 — Terminología (TKT-01, 02, 03, 05, 06, 07) *(typecheck + lint OK; helper `lib/taxonomy-labels.ts`; mergeado a `dev` `3dae945`)*
- [x] ✅ FRONT-2a — Pure-front: TKT-08 listas ✅, TKT-18 renombrar ✅. **TKT-13 BLOQUEADO** (el picker de textos remediales no está en la base del sprint; depende del motor remedial E9). *(rama `front-2a`, integrada)*
- [ ] ⬜ FRONT-2b — Consumo de contratos backend (frontend serial): TKT-09 orden, 11 dropdown dimensión, 12 filtro multi-tag, 14 vista banco global, 15 dropzone PDF, 16 vista revisión spec-table, 17 toggle estudiante + editar tipos + imprimible, 24/25/26 maquetado de los 3 informes DIA, 10 drill-down. *(pendiente)*

### Backend (paralelo) — TODOS INTEGRADOS en `sprint-feedback-v1`
- [x] ✅ Fase 0 (adaptada) — cada agente backend definió su contrato en `packages/types` (archivos separados → sin colisión); el frontend los consume en el stream serial.
- [x] ✅ BACK-B — Analytics (TKT-04, 09, 12 + TKT-05 backend) *(rama `back-b-analytics`, sin migración, 99/99 tests)*
- [x] ✅ BACK-C — Instrumentos/PDF/banco global (TKT-14, 15; 16 = solo front) *(rama `back-c-instruments`, tabla `instrument_attachments`, 61/61 tests)*
- [x] ✅ BACK-D — Remedial (TKT-17) *(rama `back-d-remedial`, columna `edited_content`, 45/45 tests)*
- [x] ✅ BACK-E — Informe DIA (TKT-24, 25, 26) *(rama `back-e-informe-dia`, 3 endpoints, sexo del alumno SÍ existe → tablas 1.5–1.8 hechas, 14/14 tests)*

### Cierre
- [x] ✅ Fase 3 — Auditoría (ligera): reportes de agentes revisados + typecheck/tests por stream
- [x] ✅ Fase 4 — Integración de los 5 streams en `sprint-feedback-v1` (migración 0008 unificada; wiring `app.module.ts`/`nav-items.ts` vía merge; fix TKT-04 front)
- [x] ✅ Fase 5 — Validación: build types/db ✅, typecheck api+web ✅, lint web ✅, tests api 575/591 (16 fallas = `privacy/*`, requieren DB, ajenas al sprint)
- [ ] ⬜ FRONT-2b — Frontend serial que consume los endpoints backend (ver arriba)
- [ ] ⬜ Merge a `dev` (con confirmación del usuario)
- [ ] ⬜ Marcar tickets restantes en Notion + en el plan

**Estado de tickets tras integración:**
- ✅ Completos (backend+front): TKT-01,02,03,04,05,06,07,08,18
- 🏗️ Backend listo, falta frontend (FRONT-2b): TKT-09,11,12,14,15,16,17,24,25,26 · TKT-10 drill-down
- 🚫 Bloqueado: TKT-13 (dependencia motor remedial)
- 🗿 Diferidos: TKT-19,20,23 + parte "muestra" de 21/22

### Diferidos (no ejecutar en esta pasada)
- TKT-19, TKT-20, TKT-23 · parte "muestra de colegios" de TKT-21/22

---

## 9. Insumos pendientes antes de arrancar streams específicos

- ✅ **BACK-E / TKT-25 — RESUELTO.** Existe el informe DIA oficial de establecimiento (muestra real: `Informe_de_resultados_establecimiento_rbd-25520_monitoreo_2025`, guardada en `Histórico Pruebas DIA/Informes resultados/`). Es un formato **agregado por grado×asignatura** (Tablas 1.1–1.9), distinto del informe por curso de TKT-24. Se reproduce **solo el Área Académica**; el Área Socioemocional queda fuera (la plataforma no ingesta ese cuestionario). Estructura completa documentada en TKT-25 del plan.

**No quedan insumos pendientes. El sprint está listo para arrancar (Pre-fase P0).**

---

## 10. Cómo se opera este documento

- El usuario da la orden de avanzar paso a paso (ej. *"arranca FRONT-1"*, *"lanza Fase 0"*).
- Al completar cada paso: marcar su casilla en §8, y reflejar el avance en Notion (Sprint "Iteración Feedback v1") y en el plan.
- Cualquier decisión nueva que surja durante la ejecución se anota en el plan (`plan-iteracion-feedback-v1.md`), no aquí — esta guía es solo de proceso.
