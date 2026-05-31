# Sprint 4 — Guía de testing (Dashboards core)

Rama: `sprint-4` (salida de `dev`). Historias: **H6.1–H6.9**.

## Cómo levantar

```bash
pnpm install
pnpm --filter @soe/types build && pnpm --filter @soe/db build
# API (puerto 4000)
cd apps/api && pnpm build && node dist/main.js     # o: pnpm dev
# Web (puerto 3000)
cd apps/web && pnpm dev
```

Requisitos: PostgreSQL arriba con seed (alumnos, cursos, instrumento DIA, respuestas cargadas y **resultados calculados** — correr el `POST /assessments/:id/results/calculate` de S3 si aún no hay `assessment_results`/`skill_results`).

> Sin datos procesados, los dashboards muestran estados vacíos (correcto). Para ver números, primero importar respuestas (S3) y calcular resultados.

---

## Smoke test automatizado (ya verificado en integración)

- `GET /api/health` → 200.
- Los 7 endpoints nuevos sin token → **401** (existen y el guard funciona):
  `/api/dashboards/{overview,filters,performance,skills,teacher-kpis}`,
  `/api/analytics/{generational,progression}`.
- Las 5 rutas `/resultados*` sin sesión → **307** redirect a `/login`.

---

## Tests E2E manuales por historia

### H6.1 — Panel de resultados para directivo
1. Login como `school_admin`/`academic_director`. Ir a **Resultados** (sidebar).
2. Verificar las cards: % logro global, alumnos evaluados, nº de evaluaciones, alertas.
3. Verificar la lista de **últimas evaluaciones** (≤5) y la barra de distribución por nivel.
- Esperado: datos de toda la org. Si no hay resultados → estado vacío.

### H6.2 — Filtros (asignatura, nivel, curso, alumno, período)
1. En cualquier vista de Resultados, aplicar un filtro (ej. asignatura + nivel).
2. Confirmar que la URL cambia (querystring) y que los datos se recalculan.
3. Copiar la URL en otra pestaña → el filtro se conserva (bookmarkeable).

### H6.3 — Comparación de generaciones
1. Ir a **Resultados → Comparación**. Seleccionar un nivel (`gradeId`).
2. Si hay ≥2 años con datos: ver gráfico de % logro por año + distribución por año.
3. Con un solo período: mensaje "Sin comparación disponible" (no error).
- Verificar que `passingRate` respeta la escala de notas del instrumento (no fija 4.0).

### H6.4 — Clasificación por nivel de desempeño
1. Ir a **Resultados → Clasificación**.
2. Ver la distribución (insuficiente/elemental/adecuado/avanzado) y la tabla paginada de alumnos con badge de color por nivel.
3. Filtrar por nivel (ej. solo "insuficiente") y paginar.
- Los umbrales provienen de la grading scale aplicable (config), con fallback 0.4/0.7/0.85.

### H6.5 — Métricas por habilidad
1. Ir a **Resultados → Habilidades**.
2. Ver el % logro agregado por habilidad (nodo de taxonomía) con barra de color y nivel.

### H6.6 — Progresión a lo largo del año
1. Ir a **Resultados → Progresión**. Elegir scope: alumno / curso / habilidad.
2. Ver la serie temporal (line chart) de % logro por evaluación, ordenada por fecha.

### H6.7 — Resultados para el profesor (solo sus cursos)
1. Login como `teacher`/`homeroom_teacher` con `teacher_assignments`.
2. Ir a **Resultados**: la vista muestra `scope: teacher` y SOLO datos de sus cursos.
3. Verificar que **últimas evaluaciones** NO lista evaluaciones de cursos ajenos.
4. Un profesor sin asignaciones → estado vacío (no error, no fuga de datos).

### H6.8 — KPIs del profesor
1. Como profesor, en el overview ver la tabla "Mis cursos": por curso → nº alumnos, % logro promedio, % aprobación, alumnos críticos (nivel insuficiente), nº evaluaciones.

### H6.9 — Reportes descargables (Excel/PDF)
1. En Comparación o Progresión con datos, click **Exportar vista**.
2. Descargar Excel (xlsx) y PDF: deben contener los datos ya cargados + título y filtros aplicados.
3. El export NO hace re-fetch (serializa lo visible).

---

## Casos de error / borde a probar
- Usuario sin rol de dashboards (`guardian`) → redirect a `/dashboard`.
- Filtros con IDs inexistentes → respuesta vacía, sin 500.
- `analytics/progression` sin el id requerido para el scope → 400 (validación Zod del `.refine`).
- Multi-tenancy: un usuario de otra org no ve datos ajenos (todas las queries filtran `org_id` del token).

## Checklist de aceptación
- [ ] Las 9 historias verificadas con datos reales de un colegio seed.
- [ ] Profesor sólo ve sus cursos en TODAS las vistas (overview, clasificación, habilidades, progresión).
- [ ] Colores de nivel consistentes entre snapshots (barras) y charts.
- [ ] Export Excel + PDF funcionan con filtros aplicados.

## Deuda técnica conocida (no bloqueante para F1)
- `dashboards.getTeacherKpis`: 2 queries por curso (N+1) — aceptable para decenas de cursos; agregar en SQL si crece.
- `dashboards.getPerformance`: pagina en memoria tras promediar por alumno — aceptable para volumen de un colegio.
- Helper de scoping (`getAccessibleClassGroupIds`) replicado en `assessment-results`, `dashboards`, `analytics` — candidato a extraer a un util compartido en F2.
