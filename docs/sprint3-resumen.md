# Sprint 3 — Resumen de lo desarrollado

> Documento de contexto rápido para agentes. Resume **qué se construyó** en el Sprint 3,
> dónde vive cada pieza y cómo se conecta. Para los contratos de tipos/Zod previos a la
> implementación ver [`sprint3-contracts.md`](./sprint3-contracts.md).

**Rama de integración:** `sprint-3` (mergeada a `dev` para testing).
**Base:** parte de `dev` e incluye además todo `main` (cierre Sprint 2 + design-system + módulo LLM).

---

## 1. Objetivo del Sprint

Cerrar el ciclo del DIA: **subir las respuestas de los alumnos → calcular resultados →
convertir puntaje a nota → visualizar**. Sprint 2 dejó el banco de ítems y la ingesta del
instrumento; Sprint 3 agrega la captura de respuestas y el cálculo pedagógico.

Historias cubiertas: **H4.5, H4.6, H16.3, H16.4** (hojas de respuesta / importación) y
**H5.7** (escalas de notas).

---

## 2. Módulos nuevos (Backend — `apps/api/src`)

### `answer-sheets/` — Hojas de respuesta (H4.5, H4.6, H16.3, H16.4)
Carga y parseo de las respuestas de los alumnos desde CSV/Excel, con preview antes de confirmar.
- **Parsers intercambiables** (`lib/parsers/`): `gradecam`, `zipgrade`, `dia-official`, `generic-csv`.
  Cada uno implementa `parser.types.ts`; se elige por formato.
- `lib/student-matcher.ts`: vincula filas a alumnos (por RUT/nombre).
- `lib/preview-store.ts`: guarda el preview entre `upload` y `confirm` (patrón job, sin persistir aún).
- `lib/templates.ts`: plantillas descargables por formato.
- **Endpoints** (`/api/answer-sheets`):
  - `POST /upload` — sube archivo, parsea y devuelve preview + jobId
  - `POST /confirm` — confirma el preview y persiste respuestas (`responses`)
  - `GET /templates/:format` — descarga plantilla del formato
  - `GET /jobs/:jobId` — estado del job de importación
  - `GET /assessment/:assessmentId` — respuestas cargadas de una evaluación

### `assessment-results/` — Cálculo y lectura de resultados
Calcula resultados por alumno × pregunta × habilidad y los agrega por curso.
- `lib/result-aggregator.ts`: agrega puntajes a nivel alumno / curso / habilidad.
- **Endpoints** (`/api/assessment-results`):
  - `GET /assessment/:assessmentId` — resultados de una evaluación
  - `GET /student/:studentId` — resultados de un alumno
  - `GET /class-group/:classGroupId/summary` — resumen agregado del curso
  - `GET /assessment/:assessmentId/export` — exportación (Excel)

### `grading-scales/` — Escalas de notas (H5.7)
Configuración de escalas de conversión puntaje→nota por organización.
- `dto/grading-scale.dto.ts` + servicio con CRUD y preview de conversión.
- **Endpoints** (`/api/grading-scales`): `POST /`, `GET /`, `GET /:id`,
  `GET /:id/preview`, `PATCH /:id`, `DELETE /:id`.

Todos los módulos están registrados en `apps/api/src/app.module.ts`.

---

## 3. Vistas nuevas (Frontend — `apps/web/src/app/(dashboard)`)

### `importar-resultados/` — Wizard de importación de respuestas
Flujo multi-paso: subir archivo → preview → seguimiento del job.
- `page.tsx` (entrada), `cargar/`, `preview/`, `jobs/[jobId]/`.
- `components/`: `upload-form`, `preview-table`, `format-card`, `job-status-card`.
- `actions.ts`: server actions que llaman a `/api/answer-sheets/*`.

### `configuracion/escalas/` — UI de escalas de notas (H5.7)
CRUD de escalas con preview de conversión en vivo.
- `page.tsx` (listado), `nueva/`, `[id]/` (edición).
- `components/`: `escala-form`, `escalas-table`, `conversion-preview`, `delete-button`, `scale-format`.

Entradas agregadas al sidebar (`components/layout/nav-items.ts`): **Importar resultados** y
**Escalas de notas** (más **Resultados**, aún `status: 'soon'`).

---

## 4. Contratos compartidos (`packages/types/src`)

- **Schemas Zod** (`schemas/`): `answer-sheet.schema.ts`, `assessment-result.schema.ts`,
  `grading-scale.schema.ts` — fuente de verdad compartida api↔web (exportados desde `schemas/index.ts`).
- **Utilidades de cálculo** (`utils/`):
  - `grade-calculator.ts` — puntaje crudo → porcentaje / nota.
  - `grading-scale-calculator.ts` — aplica una escala configurable a un puntaje.
- **Access policies** (`access-policies.ts`): roles permitidos por feature de S3.

---

## 5. Base de datos

**No se requirió migración nueva.** Los módulos usan tablas ya definidas en el schema de F1:
`responses`, `results`, `assessments`, `students`, `instruments`, `items`. Se respeta el
patrón `ai_score` / `human_score` / `final_score` y multi-tenancy por `org_id`.

`packages/db/data/answer-sheets-sample/` incluye CSV de muestra por formato (gradecam,
zipgrade, dia-official) para probar la importación.

---

## 6. Cómo probar (desde `dev`)

1. Levantar API + web (`pnpm dev`) y la DB con seed.
2. **Escalas**: `Configuración → Escalas de notas` → crear una escala y ver el preview de conversión.
3. **Importar**: `Importar resultados` → subir un CSV de `packages/db/data/answer-sheets-sample/`
   → revisar preview → confirmar.
4. **Resultados**: consultar `/api/assessment-results/...` (la vista `/resultados` está pendiente).

> Nota: el backend en runtime corre desde `dist/`. Tras cambiar `src/` recompilar/reiniciar la API.

---

## 7. Procedencia (cómo se integró)

Sprint 3 se desarrolló en paralelo (un agente por dominio) en worktrees separados y se
integró en `sprint-3` vía merges por agente (answer-sheets, grading-scales, assessment-results,
importar-resultados UI, escalas UI). Luego se mergeó `main` para incorporar el cierre de
Sprint 2, el design-system y el módulo LLM provider-agnóstico. Typecheck de `api` y `web` en verde.
