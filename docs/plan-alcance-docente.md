# Plan de desarrollo — Alcance de datos por docente

> **Estado: ejecutado** en la rama `feat/alcance-docente`. Cada fase quedó en su
> propio commit; las desviaciones respecto de lo planificado están anotadas al
> final, en «Desviaciones de ejecución».
>
> Ejecución del diseño en [`diseno-alcance-docente.md`](./diseno-alcance-docente.md).
> Cinco fases con orden, entregables, archivos y criterio de cierre.
> Cada fase es un commit atómico o una PR propia; ninguna mezcla refactor con
> cambio de comportamiento.

---

## Orden y motivo

| #   | Fase                                       | Por qué va aquí                                                 |
| --- | ------------------------------------------ | --------------------------------------------------------------- |
| 1   | **F2 — Cerrar fugas**                      | Acceso indebido real y en producción. Acotado, sin dependencias |
| 2   | **F3 — Importar planta docente**           | Sin datos no se puede observar ningún comportamiento docente    |
| 3   | **F0 — Consolidar el helper**              | Refactor puro previo al cambio de semántica                     |
| 4   | **F1 — Alcance por asignatura y jefatura** | El corazón del diseño                                           |
| 5   | **F4 — Alcance por rol activo**            | Ajuste transversal, más seguro con F1 ya estabilizada           |

F2 y F3 son independientes entre sí y pueden ir en paralelo. F0 → F1 → F4 son
estrictamente secuenciales.

---

## Fase 2 — Cerrar las fugas de `ai-analysis` y `remedial`

**Problema.** Ambos módulos admiten el rol `teacher` y filtran solo por
`org_id`; `remedial.generate` acepta además un `classGroupId` del DTO sin
validarlo. Un docente puede leer el análisis IA y generar material remedial de
cualquier curso de la organización pasando el id.

**Trabajo**

1. `apps/api/src/ai-analysis/ai-analysis.service.ts` — validar el
   `classGroupId` del análisis contra el alcance en `get` (`:242`) y en el
   lookup por caché (`:206`). Mismo tratamiento en
   `instrument-comparison.controller.ts:86`.
2. `apps/api/src/remedial/remedial.service.ts` — validar en `get` (`:187`),
   filtrar en `list` (`:216`) y rechazar en `generate` (`:108`) todo
   `classGroupId` fuera del alcance. Aplica el principio ya escrito en
   `packages/types/src/schemas/dashboard.schema.ts:14`: el alcance se resuelve
   en el service, no se confía en el query.
3. Specs de aislamiento para ambos módulos (hoy no tienen ninguno).

En esta fase se usa el alcance **actual** (por curso). Cuando F1 cambie la
semántica, ambos módulos la heredan sin tocarlos de nuevo.

**Cierre:** un `teacher` recibe 403/404 —nunca datos— ante un id de curso ajeno,
cubierto por spec.

---

## Fase 3 — Importador de planta docente

**Entrada.** Los tres CSV extraídos del facsímil de planta docente 2026:
`docentes-por-curso-asignatura.csv` (453 filas), `profesores-jefes.csv` (32) y
`roster-docentes.csv` (65 docentes con correo).

**Trabajo**

1. **Etapa de extracción** (`scripts/cscj/`, read-only, patrón de
   `01-extract-roster.cjs`): Excel → JSON normalizado. Incluye la tabla de
   mapeo de ~29 etiquetas de asignatura a los cinco códigos del catálogo, según
   la §6 del diseño. La tabla es un archivo versionado, no literales dispersos.
2. **Importador** (`packages/db/src/seed/import-planta-docente.ts`), siguiendo
   `seed-subject-classes.ts`: flags `--org --year --commit`, dry-run por
   defecto, `withOrgContext`, `onConflictDoNothing`.
   1. Resolver el curso con `parseCursoLabel`
      (`packages/types/src/utils/curso-parser.ts:24`): "2° Básico A" →
      `grades.code` + `class_groups.name` (solo la letra de sección).
   2. Resolver al docente por correo contra `users`; si no existe, crear
      `org_memberships` con `user_id NULL` (invitación pendiente, soportado en
      `packages/db/src/schema/users.ts:20`).
   3. Crear los `subject_classes` faltantes del año.
   4. Insertar `teacher_assignments`; la unique `(user_id, subject_class_id)` da
      idempotencia natural.
   5. Insertar los memberships `homeroom_teacher` de las 32 jefaturas. Admite
      dos jefes por curso (1°A y 1°B lo tienen).
   6. Registrar la corrida en `import_jobs`, como `import-cscj-roster.ts`.
3. **Reporte de dry-run**: `subject_classes` a crear, asignaciones a insertar,
   jefaturas, y dos listas separadas — **descartes esperados por política** (las
   ~210 filas de asignaturas no evaluadas) y **filas sin mapear** (error real).
   Mezclarlas hace que el reporte grite en cada corrida y deje de leerse.

**Cierre:** dry-run sin filas en la lista de error; corrida con `--commit`
idempotente (segunda ejecución = 0 inserciones); "Mis cursos" muestra cursos y
asignaturas para los 47 docentes mapeados.

---

## Fase 0 — Consolidar el helper de alcance

**Problema.** Existen cinco implementaciones de la misma lógica: el helper
canónico y cuatro copias privadas en `assessment-results.service.ts:574`,
`item-analysis.service.ts:1413`, `assessment-report.service.ts:1313` y
`report-support.service.ts`.

**Trabajo**

1. Eliminar las cuatro copias; todas pasan a llamar a
   `common/helpers/class-group-scope.helper.ts`.
2. Crear `class-group-scope.helper.spec.ts` — el punto único de aislamiento de
   la plataforma **no tiene tests propios**.
3. Verificar los ~25 call sites.

**Cierre:** `pnpm typecheck` y `pnpm lint` limpios; los specs de aislamiento
existentes (`assessment-results`, `item-analysis`, `dashboards`, `heatmap`,
`student-signals`, `student-comparisons`, `report-support`,
`comparable-trajectory`) pasan **sin modificación**. Si alguno hay que tocarlo,
el refactor cambió comportamiento y hay que revisarlo.

---

## Fase 1 — Alcance por asignatura y jefatura de curso

**Trabajo**

1. **Helper** — `resolveClassGroupScope` devuelve el `TeacherScope` del diseño
   (§4): `pairs`, `homeroomClassGroupIds` y `classGroupIds` de compatibilidad.
   La query ya hace el join a `subject_classes`; deja de descartar `subject_id`.
   Los cursos de jefatura salen de los `org_memberships` con rol
   `homeroom_teacher`.
2. **Predicado de evaluación** — `isAssessmentInScope`, que cruza
   `assessment_course_assignments` con `instruments.subject_id`. Vive en el
   helper; ningún servicio lo reimplementa.
3. **Migración de servicios**, de menor a mayor superficie, un commit por
   servicio:
   `assessment-results` → `item-analysis` → `dashboards` → `heatmap` →
   `master-board` → `comparable-trajectory` → `official-reports` →
   `assessment-report`.
4. **Vistas del alumno** — `student-panorama`, `student-comparisons`,
   `student-signals` aplican la regla de jefatura: transversales para
   `homeroom_teacher`, recortadas a las asignaturas propias para `teacher`.
   `isStudentVisibleInScope` conserva su semántica: la visibilidad de la persona
   es por curso.
5. **MCP** — verificar que los cinco tools heredan el alcance de los servicios
   ya migrados, con un test end-to-end de principal `teacher` (hoy solo hay test
   de visibilidad de tools por rol en `tool-registry.spec.ts:105`).

**Cierre por servicio:** un spec que verifique que un profesor de `MATH` en 2°A
no obtiene datos de `LANG` del mismo curso, y que un `homeroom_teacher` de 7°A sí
obtiene todas las asignaturas de 7°A. Es el test que hoy no existe en ninguna
parte. La fase no se cierra mientras quede un servicio usando `classGroupIds`.

---

## Fase 4 — Alcance según rol activo

**Trabajo**

1. `class-group-scope.helper.ts:59` — `scopeAll` se decide por `activeRole`, no
   por la unión de `user.roles`.
2. Documentar en el helper la separación de responsabilidades: `RolesGuard`
   autoriza por unión (quién entra), el alcance filtra por rol activo (qué ve).
   Es exactamente la sutileza que alguien "corrige" más adelante si no está
   escrita.
3. Revisar los ~25 call sites bajo la nueva regla.
4. Frontend: `apps/web/src/app/(dashboard)/resultados/mapa-calor/page.tsx:49`
   usa la unión mientras `dashboard/page.tsx:40` usa `activeRole`. Unificar en
   `activeRole`.
5. `class-groups.service.ts:38` deja de ser la excepción documentada y pasa a
   seguir la regla general.

**Cierre:** un usuario `teacher` + `dept_head` ve solo su alcance docente con rol
activo `teacher`, y la organización completa al cambiar a `dept_head`; un
directivo puro no cambia de comportamiento.

---

## Fuera de alcance

- **RLS por profesor.** Requiere propagar `user_id` al contexto de sesión de
  Postgres, como `app.current_org_id`. Queda documentada como extensión; el
  aislamiento sigue siendo aplicativo.
- **Ampliar el catálogo `subjects`.** Decisión tomada: solo las cinco
  asignaturas evaluadas.
- **`SensitiveDataGuard` en más endpoints.** Hoy solo se aplica en los cuatro de
  `scan-review`. Es un hueco distinto, con su propio análisis.
- **Portal de apoderados** (rol `guardian`): F3 del roadmap.

---

## Verificación transversal

Antes de cada PR: `pnpm typecheck`, `pnpm lint` y
`npx prettier --write <archivos propios>` (nunca `pnpm format`, que reformatea
cientos de archivos ajenos).

Prueba manual de cierre, sobre la demo con la planta cargada: entrar como un
profesor de una sola asignatura, como un profesor jefe y como un usuario de rol
mixto, y confirmar los tres alcances contra los criterios de aceptación del
diseño.

---

## Desviaciones de ejecución

Lo que cambió respecto del plan, y por qué.

1. **Dónde vive la jefatura de curso.** El plan daba por hecho que el rol
   `homeroom_teacher` bastaba para derivar el acceso transversal. No bastaba: el
   rol no identifica el curso. Se resolvió con
   `org_memberships.scope.classGroupIds` (§3.1.1 del diseño), sin migración. El
   importador escribe ese scope y lo actualiza en cada corrida, para que una
   jefatura del año pasado no quede vigente.

2. **`import_jobs` no registra la corrida del importador.** El enum
   `import_job_type` no tiene un valor para planta docente y agregarlo exige una
   migración. Se omitió el registro antes que reusar un tipo que miente
   (`student_roster`). Queda pendiente si se quiere trazabilidad de la carga.

3. **Electivos de III°/IV° fuera del alcance.** 33 filas de la planta usan
   `elect` o `TALLER` como sección: son grupos que cruzan las secciones del
   nivel y no tienen `class_group`, así que no pueden modelarse como
   `subject_class`. Se clasifican como descarte estructural esperado. Por eso el
   total final es de 200 asignaciones y 44 docentes, no las 243/47 estimadas al
   leer el Excel.

4. **`resolvePassingGrade` no recibe el alcance.** Resuelve la escala de
   calificación aplicable, no datos de alumnos; se dejó sin acotar a propósito.

5. **Dos specs preexistentes se tocaron en la Fase 1**, no en la 0:
   `report-support.service.spec.ts` (el tipo del alcance creció con campos
   requeridos) y `student-comparisons.service.spec.ts` (su fixture de matrícula
   debía traer `classGroupId` para el filtro por asignatura). Son ajustes de
   fixture a la semántica nueva, no cambios de aserción.

6. **Los scripts de la Fase 3 quedaron dentro del commit de la Fase 0.** El
   `git add -A` los arrastró por ser archivos nuevos. No afecta al contenido,
   pero rompe la correspondencia una-fase-un-commit.
