# Sprint 3 — Guía de Testing E2E Manual

> Cobertura: **H4.5, H4.6, H16.3, H16.4, H5.7**. Antes de mergear a `main`, validar manualmente cada flujo en `sprint-3` con la base de datos local y un usuario SSO con rol `eval_coordinator` o superior.

---

## Setup previo

1. **Levantar servicios:**
   ```bash
   # Terminal 1 — API
   cd apps/api && pnpm dev

   # Terminal 2 — Web
   cd apps/web && pnpm dev
   ```
2. **Login** en `http://localhost:3000` con un usuario que tenga rol `school_admin` o `academic_director` (acceso completo) o `eval_coordinator` (acceso de ingesta y lectura de escalas).
3. **Pre-requisitos de datos** (vienen de sprints anteriores):
   - Año académico activo (S0)
   - Alumnos cargados con RUTs reales (S1)
   - Instrumento DIA con sus ítems y pauta (S2)

---

## H5.7 — Escalas de notas configurables

### Caso 1: ver escalas disponibles
1. Ir a **Configuración → Escalas de notas** (`/configuracion/escalas`).
2. **Esperado:** la lista muestra al menos una escala global (orgId=null) si fue precargada. Cada fila muestra: nombre, tipo, rango (`1.0 — 7.0`), nota aprobación, exigencia (`60%`), badge "Global" o "Mi colegio".

### Caso 2: crear nueva escala custom
1. Click **"Nueva escala"** → `/configuracion/escalas/nueva`.
2. Llenar:
   - Nombre: "Escala estricta 70%"
   - Tipo: `linear_chilean`
   - minGrade: `1.0`, maxGrade: `7.0`
   - passingGrade: `4.0`, threshold: `70%`
3. Submit.
4. **Esperado:** redirige al detalle. La escala aparece en la lista como "Mi colegio". `org_id = orgId del usuario` en DB.

### Caso 3: previsualizar conversión
1. En el detalle, ir a la sección **"Previsualizar conversión"**.
2. Verificar porcentajes default: 0%, 30%, 50%, 60%, 70%, 85%, 100%.
3. Click **"Calcular"**.
4. **Esperado:** tabla con `% → nota → Aprobado/Reprobado`. Para escala 60%, threshold:
   - 0% → 1.0 (Reprobado)
   - 50% → 3.0 (Reprobado)
   - 60% → 4.0 (Aprobado)
   - 100% → 7.0 (Aprobado)

### Caso 4: editar y eliminar
1. En el detalle, cambiar el `passingThreshold` a `50%` → guardar.
2. **Esperado:** se actualiza. Re-previsualizar refleja la nueva curva.
3. Click **"Eliminar"** → confirmar.
4. **Esperado:** redirige a la lista. La escala ya no aparece.

### Caso 5: validación de invariantes
1. Crear con `minGrade=5, passingGrade=4, maxGrade=7`.
2. **Esperado:** error inline "passingGrade debe ser mayor que minGrade".

### Caso 6: rol insuficiente
1. Login con `teacher`.
2. **Esperado:** acceso a `/configuracion/escalas` redirige a `/dashboard`. Endpoint backend `POST /grading-scales` responde 403.

### Caso 7: eliminar escala en uso (409)
1. Crear instrumento con `gradingScaleId` apuntando a una escala custom.
2. Intentar eliminar esa escala.
3. **Esperado:** modal con error "No se puede eliminar: hay instrumentos usando esta escala".

### Caso 8: escala global no editable
1. Login con `school_admin`.
2. Abrir escala global (`orgId=null`).
3. **Esperado:** form en modo read-only (no editable). Solo `platform_admin` puede editar globales.

---

## H4.5 / H4.6 / H16.3 / H16.4 — Importar resultados

### Caso 9: ver formatos disponibles
1. Ir a **Importar resultados** (`/importar-resultados`).
2. **Esperado:** 4 cards con formatos: DIA Oficial, Gradecam, ZipGrade, CSV Genérico. Cada uno muestra columnas requeridas + opcionales + botón "Usar este formato".

### Caso 10: subir hoja DIA oficial (H4.6 / H16.4)
1. Click **"Usar este formato"** en DIA Oficial → `/importar-resultados/cargar?format=dia_official`.
2. Seleccionar instrumento DIA cargado en S2.
3. Adjuntar `packages/db/data/answer-sheets-sample/dia-2025-lectura-2basico-respuestas.csv` (o crear uno con los RUTs reales de la org).
4. Asignar nombre: "DIA Marzo 2026".
5. Submit.
6. **Esperado:** redirige a `/importar-resultados/preview?token=...`. La página muestra:
   - Resumen: totalRows, matchedStudents, unmatchedStudents, rowsWithErrors, itemsInInstrument, itemsCovered.
   - Tabla con filas, badge matched/no-matched, errores por fila.
   - Advertencias (si hay).

### Caso 11: confirmar ingesta
1. Click **"Confirmar importación"**.
2. **Esperado:** redirige a `/importar-resultados/jobs/{jobId}`. Status `completed` o `partial` (si hubo filas saltadas).
3. Resumen muestra: responsesCreated, studentsProcessed, rowsSkipped, errors.
4. En DB: `responses`, `assessment_results`, `skill_results` poblados para el assessment creado.

### Caso 12: importar Gradecam (H4.5 / H16.3)
1. Crear CSV con columnas `Student ID, First Name, Last Name, Q1, Q2, Q3` (RUTs reales).
2. Subir con `format=gradecam_csv`.
3. **Esperado:** mismo flujo que DIA — preview → confirm → results.

### Caso 13: importar ZipGrade (H4.5 / H16.3)
1. Crear CSV con columnas `Student First Name, Student Last Name, Student ID, Q01, Q02, Q03`.
2. Subir con `format=zipgrade_csv`.
3. **Esperado:** parser maneja `Q01`, `Q02` (con cero padding) correctamente.

### Caso 14: CSV genérico con columnMapping (H4.5)
1. Crear CSV con columnas `rut, nombre, apellido, p1, p2, p3`.
2. Subir con `format=generic_csv` y `columnMapping={"rut":"rut","firstName":"nombre","lastName":"apellido","questionsPrefix":"p"}`.
3. **Esperado:** parsea bien con el mapping configurable.

### Caso 15: validación de filas con error
1. CSV con un alumno cuyo RUT no existe en la org.
2. **Esperado:** preview muestra "matched: false" para esa fila + error explícito.
3. Confirmar con `skipErrorRows: true` → la fila se salta, el resto procesa.

### Caso 16: token expirado
1. Subir un archivo → esperar 31 minutos (o ajustar TTL para testing).
2. **Esperado:** `POST /preview` responde 404 con "Token expirado o no encontrado".

### Caso 17: cross-tenant token (seguridad)
1. Usuario de Org A sube un archivo → recibe `previewToken`.
2. Usuario de Org B intenta `POST /preview` con ese token (via curl con su JWT).
3. **Esperado:** 403 Forbidden.

### Caso 18: assessment_results calculados (verifica integración A↔C)
1. Después del Caso 11, ir a la DB:
   ```sql
   SELECT * FROM assessment_results WHERE assessment_id = '...';
   SELECT * FROM skill_results WHERE assessment_id = '...';
   ```
2. **Esperado:**
   - `assessment_results.percentage` es 0..100 (no 0..1) — fix de audit.
   - `assessment_results.grade` es 1.0..7.0 según la escala.
   - `assessment_results.performance_level` ∈ {`insufficient`, `elementary`, `adequate`, `advanced`}.
   - `skill_results` tiene una fila por `(student × nodo_taxonomico)` con `correct_count` y `total_count`.

### Caso 19: recalcular vía endpoint dedicado (H4.5/H4.6 + S4 preview)
1. `POST /api/assessments/{id}/results/calculate` con body `{ "force": true }`.
2. **Esperado:** 200 con `{ resultsCreated, resultsUpdated, skillResultsCreated, studentsProcessed }`.
3. Los `assessment_results` se reemplazan (delete + insert en transacción).

### Caso 20: teacher scoping en lectura
1. Login como `teacher` asignado al class_group del assessment.
2. `GET /api/assessments/{id}/results`.
3. **Esperado:** responde con SOLO los alumnos de sus class_groups asignados (filtrado por `teacher_assignments`).
4. Login como `teacher` SIN asignaciones a este assessment → `data: []`.
5. Login como `academic_director` → ve todos los alumnos.

---

## Checklist de aceptación del Sprint

| Historia | Caso(s) | OK |
|---|---|---|
| H4.5 — Excel/CSV de Gradecam/ZipGrade | 12, 13, 14, 15 | ☐ |
| H4.6 — Hojas DIA en bloque | 10, 11 | ☐ |
| H16.3 — Plantillas Gradecam/ZipGrade | 9, 12, 13 | ☐ |
| H16.4 — Parser oficial DIA | 9, 10 | ☐ |
| H5.7 — Escalas configurables | 1–8 | ☐ |
| Seguridad multi-tenant | 17, 8 | ☐ |
| Cálculo de resultados | 18, 19, 20 | ☐ |

---

## Endpoints S3 (referencia rápida)

```
# Answer Sheets
POST   /api/answer-sheets/upload              (multipart)
POST   /api/answer-sheets/preview              { previewToken }
POST   /api/answer-sheets/confirm              AnswerSheetConfirmRequestDto
GET    /api/answer-sheets/jobs/:jobId
GET    /api/answer-sheets/templates
GET    /api/answer-sheets/templates/:format

# Grading Scales
GET    /api/grading-scales
GET    /api/grading-scales/:id
POST   /api/grading-scales                     GradingScaleCreateDto
PATCH  /api/grading-scales/:id                 GradingScaleUpdateDto
DELETE /api/grading-scales/:id
POST   /api/grading-scales/:id/preview         { percentages: number[] }

# Assessment Results
POST   /api/assessments/:assessmentId/results/calculate   { gradingScaleId?, force? }
GET    /api/assessments/:assessmentId/results             ?classGroupId&performanceLevel&page&limit
GET    /api/assessments/:assessmentId/results/:studentId
GET    /api/assessments/:assessmentId/skill-results       ?classGroupId&page&limit
```

---

## Antes de mergear `sprint-3` → `main`

- [ ] Todos los casos manuales arriba marcados ✅
- [ ] `pnpm typecheck` desde la raíz: 0 errores
- [ ] `pnpm --filter @soe/api test`: ≥149 tests passing (los 7 de `privacy.controller` que fallan son preexistentes en main)
- [ ] Lint: `pnpm lint` sin warnings nuevos
- [ ] Verificar que el percentage en `assessment_results` es 0..100 (no 0..1)
- [ ] Verificar que `app.module.ts` registra los 3 módulos nuevos
- [ ] Verificar que `nav-items.ts` muestra "Importar resultados" y "Escalas de notas" con role gating correcto
