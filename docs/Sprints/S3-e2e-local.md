# Sprint 3 — Test E2E en local (recorrido completo)

> Recorrido secuencial **happy-path** para validar de punta a punta todas las features del
> Sprint 3 en una máquina local, en una sola corrida. Pensado para hacerse de arriba a abajo
> en ~20 min. Para casos borde, seguridad y validaciones ver
> [`S3-testing-guide.md`](./S3-testing-guide.md) (20 casos). Para contexto de qué se construyó
> ver [`../sprint3-resumen.md`](../sprint3-resumen.md).

**Features cubiertas:** escalas de notas (H5.7) · importación de respuestas
(H4.5, H4.6, H16.3, H16.4) · cálculo y lectura de resultados.

**Rama:** `dev` o `sprint-3` (las features S3 NO están en `main`).

---

## 0. Preparar el entorno

```bash
# Posicionarse en la rama con S3
git checkout dev          # o sprint-3

# Instalar dependencias (incluye @google/genai del módulo LLM)
pnpm install

# Variables de entorno (raíz del repo)
cp .env.example .env      # si aún no existe
#   - DATABASE_URL apuntando a tu Postgres local
#   - AUTH_MODE=mock  → login con dropdown de usuarios del seed (no requiere SSO)
```

> **Tip:** con `AUTH_MODE=mock` puedes cambiar de usuario/rol desde un dropdown sin SSO real.
> Es la forma más rápida de probar el role-gating de los pasos siguientes.

### Base de datos con datos de los sprints previos

```bash
# Crear/migrar el schema F1 (incluye responses, results, assessments, grading_scales)
pnpm --filter @soe/db db:migrate     # o db:push en local

# Seed: org demo, usuarios por rol, alumnos con RUT, currículo/taxonomía,
#       e instrumento DIA con ítems (pre-requisito de S2)
pnpm --filter @soe/db seed
```

Pre-requisitos que deja el seed (necesarios para S3):
- ✅ Año académico activo
- ✅ Alumnos cargados con RUTs reales
- ✅ Instrumento **DIA Lectura 2° Básico** con sus 20 ítems y pauta

### Levantar la app

```bash
# Opción A: todo junto desde la raíz
pnpm dev

# Opción B: por separado
cd apps/api && pnpm dev     # API  → http://localhost:4000/api
cd apps/web && pnpm dev     # Web  → http://localhost:3000
```

> ⚠️ La API en producción/local corre el build de `dist/`. Si editaste `src/`, reinicia
> `pnpm dev` (watch) o recompila para que los cambios de S3 tomen efecto.

**Login:** abrir `http://localhost:3000`, entrar como **`academic_director`** o
**`school_admin`** (acceso completo a escalas + importación + resultados).

---

## Flujo 1 — Escala de notas (H5.7)

> Define cómo se convierte el % de logro a nota 1.0–7.0. Hazlo primero: el cálculo de
> resultados del Flujo 3 usará una escala.

1. Sidebar → **Escalas de notas** (`/configuracion/escalas`).
2. **Verás** el listado de escalas (al menos una global precargada, badge "Global").
3. Click **"Nueva escala"**:
   - Nombre: `Escala DIA 60%`
   - Tipo: `linear_chilean`
   - minGrade `1.0` · maxGrade `7.0` · passingGrade `4.0` · exigencia `60%`
   - Guardar.
4. **Esperado:** redirige al detalle; aparece en la lista con badge "Mi colegio".
5. En el detalle → sección **Previsualizar conversión** → "Calcular".
   - **Esperado:** `0% → 1.0 (Reprobado)`, `60% → 4.0 (Aprobado)`, `100% → 7.0 (Aprobado)`.

✅ **Checkpoint:** la escala existe y la conversión %→nota se ve coherente.

---

## Flujo 2 — Importar respuestas de alumnos (H4.6 / H16.4)

> Sube la hoja de respuestas del DIA y crea el assessment + las respuestas.

1. Sidebar → **Importar resultados** (`/importar-resultados`).
2. **Verás** 4 formatos: **DIA Oficial · Gradecam · ZipGrade · CSV Genérico**.
3. Click **"Usar este formato"** en **DIA Oficial**.
4. En `/importar-resultados/cargar`:
   - Seleccionar el instrumento **DIA Lectura 2° Básico** (del seed).
   - Adjuntar `packages/db/data/answer-sheets-sample/dia-2025-lectura-2basico-respuestas.csv`.
   - Nombre del assessment: `DIA Lectura — corrida E2E`.
   - Submit.
5. **Esperado** → página de **preview** (`/importar-resultados/preview?token=...`):
   - Resumen: `totalRows`, `matchedStudents`, `unmatchedStudents`, `rowsWithErrors`,
     `itemsInInstrument`, `itemsCovered`.
   - Tabla de filas con badge **matched / no-matched** y errores por fila si los hay.
6. Click **"Confirmar importación"**.
7. **Esperado** → `/importar-resultados/jobs/{jobId}` con status `completed` (o `partial`):
   - Resumen: `responsesCreated`, `studentsProcessed`, `rowsSkipped`.

✅ **Checkpoint:** el job termina `completed`; se crearon respuestas para los alumnos del CSV.

> **Variante rápida (otros formatos):** repetir con `gradecam-sample.csv` y `zipgrade-sample.csv`
> seleccionando el formato correspondiente. El flujo preview→confirm es idéntico.

---

## Flujo 3 — Resultados calculados (integración importación ↔ cálculo)

> Al confirmar la importación, el backend calcula automáticamente resultados por alumno y
> por habilidad. Aquí se verifica.

### 3a. Verificación por API

Con el `assessmentId` del Flujo 2 (aparece en la URL del job o en la respuesta):

```bash
# Resultados por alumno
curl -s "http://localhost:4000/api/assessments/<assessmentId>/results" \
  -H "Authorization: Bearer <tu-JWT>" | jq

# Resultados por habilidad (nodo taxonómico)
curl -s "http://localhost:4000/api/assessments/<assessmentId>/skill-results" \
  -H "Authorization: Bearer <tu-JWT>" | jq
```

**Esperado:**
- Cada alumno trae `percentage` en **0..100** (no 0..1), `grade` en **1.0..7.0** según la escala,
  y `performanceLevel` ∈ {`insufficient`, `elementary`, `adequate`, `advanced`}.
- `skill-results`: una fila por `(alumno × habilidad)` con `correctCount` / `totalCount`.

> **Obtener el JWT en `AUTH_MODE=mock`:** copiar la cookie de sesión desde DevTools, o usar
> el endpoint de sesión que ya consume el frontend. En SSO real, el JWT viene del login.

### 3b. Verificación por base de datos

```sql
SELECT student_id, percentage, grade, performance_level
FROM assessment_results WHERE assessment_id = '<assessmentId>';

SELECT student_id, node_id, correct_count, total_count
FROM skill_results WHERE assessment_id = '<assessmentId>' LIMIT 10;
```

### 3c. Recalcular (idempotencia)

```bash
curl -s -X POST "http://localhost:4000/api/assessments/<assessmentId>/results/calculate" \
  -H "Authorization: Bearer <tu-JWT>" -H "Content-Type: application/json" \
  -d '{"force": true}' | jq
```

**Esperado:** `{ resultsCreated, resultsUpdated, skillResultsCreated, studentsProcessed }`;
los resultados se reemplazan en una transacción (sin duplicar).

✅ **Checkpoint:** los resultados existen, el `percentage` es 0..100 y la `grade` respeta la escala del Flujo 1.

---

## Flujo 4 — Role-gating (rápido, opcional)

Con `AUTH_MODE=mock`, cambiar de usuario y reintentar:

| Rol | Escalas (`/configuracion/escalas`) | Importar (`/importar-resultados`) | Resultados |
|---|---|---|---|
| `academic_director` / `school_admin` | ✅ ver y crear | ✅ | ✅ todos los alumnos |
| `eval_coordinator` | ✅ ver | ✅ | ✅ |
| `teacher` (asignado al curso) | ❌ redirige a `/dashboard` | ❌ | ✅ solo sus cursos |
| `teacher` (sin asignación) | ❌ | ❌ | `data: []` |

✅ **Checkpoint:** un `teacher` no entra a escalas/importación y solo ve resultados de sus cursos.

---

## Checklist E2E

- [ ] **Setup:** seed corrido, API+web arriba, login OK
- [ ] **Flujo 1:** escala creada + preview de conversión correcto
- [ ] **Flujo 2:** import DIA → preview → job `completed`
- [ ] **Flujo 2 (variante):** Gradecam y/o ZipGrade importan igual
- [ ] **Flujo 3:** `assessment_results` con `percentage` 0..100 y `grade` 1.0..7.0
- [ ] **Flujo 3:** `skill_results` poblado por habilidad
- [ ] **Flujo 3c:** recálculo idempotente OK
- [ ] **Flujo 4:** role-gating correcto (teacher acotado)
- [ ] **Sanidad:** `pnpm typecheck` y `pnpm lint` sin errores

---

## Si algo falla

| Síntoma | Causa probable | Acción |
|---|---|---|
| 404 al confirmar import | API corriendo desde `dist/` viejo | Reiniciar `pnpm dev` / recompilar API |
| `unmatchedStudents` alto | RUTs del CSV no coinciden con el seed | Usar RUTs reales de la org o el CSV de muestra |
| `grade` sale null/rara | No hay escala aplicable | Crear escala (Flujo 1) y recalcular (3c) |
| `percentage` en 0..1 | Build viejo (bug ya corregido) | Recompilar API |
| No aparece "Importar resultados" en el menú | Rol sin permiso o build web viejo | Loguear con rol adecuado / reiniciar web |
