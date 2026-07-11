# Guía E2E — Testear el sprint "Iteración Feedback v1" en localhost

Guía concisa para probar todos los cambios del sprint en tu máquina. Rama: **`dev`** (ya tiene todo integrado).

---

## 1. Requisitos

- **PostgreSQL local** corriendo, con la base `soe_dev` y **dos roles**:
  - `soe_app` **sin `BYPASSRLS`** → lo usa la API (RLS activo). `DATABASE_URL`.
  - un rol privilegiado → migrate/seed. `DATABASE_ADMIN_URL`.
- Node + **pnpm 10.x**.
- **`.env`** en la raíz (base: `apps/api/.env.example`). Mínimo para E2E:
  ```
  DATABASE_URL=postgresql://soe_app:...@localhost:5432/soe_dev
  DATABASE_ADMIN_URL=postgresql://<admin>:...@localhost:5432/soe_dev
  AUTH_MODE=mock            # login local sin SSO
  AUTH_SECRET=cualquier-string
  NEXTAUTH_SECRET=cualquier-string
  NEXTAUTH_URL=http://localhost:3000
  API_PORT=4000
  API_URL=http://localhost:4000
  INTERNAL_API_SECRET=cualquier-string
  ```
  Opcionales **por feature**:
  - `GEMINI_API_KEY=...` → necesario para **TKT-19** (asistente edita ítems) y **TKT-23** (diagnóstico IA).
  - Config S3 (`STORAGE_S3_BUCKET`, `AWS_*`) → para **TKT-15** (subir PDF). Sin ella, el endpoint responde **503** y el resto funciona.

---

## 2. Setup

```bash
pnpm install
pnpm --filter @soe/types build && pnpm --filter @soe/db build
pnpm --filter @soe/db db:migrate     # aplica 0008 + 0009 y re-aplica RLS
pnpm --filter @soe/db db:seed:dev    # org demo + taxonomía + instrumentos + tags + resultados
```
(`db:migrate` y `db:seed:dev` usan `DATABASE_ADMIN_URL`.)

---

## 3. Levantar y loguear

```bash
pnpm --filter @soe/api dev    # → http://localhost:4000
pnpm --filter @soe/web dev    # → http://localhost:3000
```
Abre **http://localhost:3000/login** y elige un usuario mock:
- **`admin.demo@colegiodemo.cl`** (directivo, ve toda la org) — para la mayoría de las pruebas.
- **`profesor.demo@colegiodemo.cl`** (profesor, solo sus cursos) — para verificar scoping/RLS.

---

## 4. Checklist E2E por cambio

### Terminología y panel (Ola 1) — *Panorama pedagógico → una evaluación con resultados → Detalle por pregunta*
- [ ] **TKT-01** — dice "**% de logro**" (nunca "acierto") en panel, tooltip del tablero e informe.
- [ ] **TKT-02** — la tarjeta dice "**Asistencia**" (no "Cobertura").
- [ ] **TKT-03** — los nodos muestran "**Lenguaje**" y "**OA-{n}**", no "LANG-…".
- [ ] **TKT-05** — **no** aparecen "Descriptores" en el panel de pregunta (sí siguen en el banco de ítems).
- [ ] **TKT-06** — **no** hay badge "secundario" en los nodos.
- [ ] **TKT-07** — botón "**Agrandar**" ensancha el panel lateral de la pregunta.
- [ ] **TKT-18** — el menú y el título dicen "**Panorama pedagógico**".
- [ ] **TKT-08** — banco de instrumentos y evaluaciones se ven como **listas** (no tarjetas).

### Analytics / interacción
- [ ] **TKT-04** — abre un instrumento **sin escala** configurada → **no** aparece "Nota de corte" ni 4.0 (sí aparece en uno con escala).
- [ ] **TKT-09** — en el tablero, click en cabecera de pregunta/columna ordena; hay "Restablecer orden".
- [ ] **TKT-11** — en "Logro por dimensión", el dropdown cambia entre habilidad/contenido/OA/eje.
- [ ] **TKT-10** — click en una habilidad abre un modal con sus preguntas → abre el detalle.
- [ ] **TKT-12** — el filtro multi-tag acota las preguntas (lógica OR).
- [ ] **TKT-22** — bajo el tablero aparece la fila "**% Logro colegio**" por pregunta.
- [ ] **TKT-21** — `/resultados/comparacion` muestra métricas con **delta vs periodo anterior**.

### Banco / instrumentos
- [ ] **TKT-14** — `/banco-items/explorar` → selector **propio/global/todos** + filtro multi-tag; lista cross-instrumento.
- [ ] **TKT-15** — en el detalle de instrumento, subir **PDF de enunciado** (requiere S3; sin él, 503 con mensaje claro; ver/eliminar).
- [ ] **TKT-16** — botón "Tabla de especificaciones" abre la **vista de revisión** (ítems × tags) + "Cargar tabla" abre el wizard.

### Remedial
- [ ] **TKT-17** — en un material remedial: toggle **Profesor/Estudiante**; editar guía / práctica / plan y guardar; botón **imprimir** (impresión limpia, sin el shell del dashboard).

### Informes DIA
- [ ] **TKT-24** — en una evaluación → pestaña "**Informe oficial**" (6 secciones: portada, resultado general, ejes, especificaciones, estudiantes, conclusiones).
- [ ] **TKT-25** — menú "**Informe establecimiento**" → Tablas 1.1–1.9 (niveles por grado×asignatura, comparación por sexo, conteos).
- [ ] **TKT-26** — desde el informe de curso, click en un alumno → **informe individual** (imprimible).

### Apéndice A (IA — requieren `GEMINI_API_KEY`)
- [ ] **TKT-19** — detalle de ítem → sección "**Edición asistida por IA**": pedir propuesta → aparece **diff** (actual vs propuesto) → **Aprobar** aplica al ítem, **Rechazar** descarta. El ítem **solo cambia al aprobar** (§8.3).
- [ ] **TKT-23** — `/comparar-instrumentos` → elegir **2 evaluaciones comparables** (mismo tipo/grado/asignatura) → generar → **diagnóstico IA** con disclaimer de hipótesis. Es **async** (loader + polling).

---

## 5. Notas

- **RLS:** si una vista sale vacía, verifica que `DATABASE_URL` use `soe_app` (sin `BYPASSRLS`) y que el usuario logueado tenga datos sembrados en su org. La API imprime un warning al arrancar si detecta una conexión que bypassa RLS.
- **Migraciones del sprint:** `0008_integracion_sprint_feedback_v1` crea `instrument_attachments`; `0009_spooky_maddog` crea `item_edit_proposals` (+ su política RLS). Ambas se aplican con `db:migrate`.
- **Scoping profesor:** logueado como `profesor.demo`, verifica que **solo** ve sus cursos y que los informes de establecimiento **no** le aparecen en el menú.
- **No construible por dependencia (no testeable aún):** TKT-13 (picker de textos remediales ausente), TKT-20 y la fila/columna "muestra de colegios" de 21/22 (sin pool multi-colegio).
- **Tests `privacy/*`:** las 2 suites que fallan sin DB son de integración (requieren Postgres real); son ambientales, no del sprint.
