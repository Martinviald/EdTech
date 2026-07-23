# Registro de decisiones — Ejecución autónoma Feedback v2

> Decisiones tomadas durante la ejecución autónoma del plan (`docs/plan-iteracion-feedback-v2.md`),
> para **revisión posterior** del equipo. El testing E2E manual se hará al final.
> Rama: `sprint-feedback-v2` (worktree `~/Desktop/EdTech/sprint-feedback-v2`), un commit por ticket.

---

## Decisiones globales de ejecución

- **Worktree + commits:** todo en `sprint-feedback-v2` (desde `dev`). 1 commit atómico por ticket, con `typecheck` + `lint` verdes antes de cada commit. Mensajes en español + trailer `Co-Authored-By`.
- **Prettier:** solo `npx prettier --write` sobre archivos con cambios sustanciales. En cambios mínimos (p. ej. una palabra) se respeta el estilo existente y NO se corre prettier, para evitar reformateos de archivo completo (el repo no está prettier-clean; `pnpm format` está prohibido — reformatea ~398 archivos). Los primitivos shadcn no se reestructuran.
- **Migraciones de BD:** se **generan** (`pnpm db:generate`) y commitean, pero **no se aplican** (no hay DB en este entorno); la validación queda para el E2E manual. Toda tabla nueva sensible por colegio agrega su política a `packages/db/sql/rls-policies.sql` (§5.2) y corre queries dentro de `withOrgContext`.
- **Features de F2 adelantadas** por prioridad del usuario (Estudio IA, vista 360, dificultad, listas de ítems): se construye el código completo (schema + backend + UI) y se verifican los chequeos estáticos; el comportamiento en runtime se valida en el E2E final.
- **Dudas abiertas del plan (§7):** donde una duda bloquea, se toma la opción recomendada por los lineamientos y se registra aquí para revisión.

---

## Ola 1 — implementada (commits `92a34a9`…`39cfaa5`)

- **T2-03 (idioma):** solo se tradujeron las 2 fugas reales de inglés en la UI (`"Close"→"Cerrar"` en `dialog`/`sheet`). **No** se tocaron los prompts "español de Chile": es una elección deliberada y **testeada** (`assistant.constants.spec.ts` asegura `/español de Chile/i`) y correcta para F1 (colegios chilenos). La duda #5 (Chile vs. LatAm neutro) queda **abierta** para tu decisión.
- **T2-04 (calidad de ítem):** "desactivar por ahora" se implementó como (a) ocultar el bloque de veredicto IA "Calidad del ítem" en `item-insight-dialog`, y (b) quitar la pestaña "Calidad" del hub de evaluación. La ruta/página/componentes quedan en el código para reactivar. *Alternativa no elegida:* conservar la pestaña solo con KR-20 (confiabilidad del instrumento) y ocultar solo las banderas por ítem.

---

## Ola 2 — decisiones al ejecutar

- **T2-09 (sacar del sidebar):** se quita del sidebar solo **"Análisis IA"** (su top-level ya es un redirect al hub → seguro). **"Material Remedial"** se quitará cuando exista **"Estudio de material"** (T2-19); **"Comparar instrumentos"** cuando tenga hogar en el hub (se coordina con T2-10). Se evita dejar features sin punto de entrada.
- **T2-25 (banco → /banco-contenido):** se eligen **tabs por subruta** (`/banco-contenido` + `/banco-contenido/explorar`) en lugar de `?tab=items|instrumentos` literal, siguiendo `07-navigation-reactivity` (streaming + `loading.tsx` por tab, code-split). El tab activo **igual persiste en la URL** (es la ruta) y es compartible, cumpliendo el objetivo del feedback. *Revisar si se prefiere el `?tab=` literal.*
- **T2-08 (degradar Mis cursos + colapsables) — implementado:** "Mis cursos" se movió al FINAL del grupo "Análisis" (no se pudo mover a "Administración" porque ese grupo es solo admins y los profesores perderían el acceso). Los grupos del sidebar ahora son **colapsables** (`SidebarNav.tsx`, persistido en `localStorage: soe:sidebar-groups-collapsed`, por defecto todos expandidos). `MobileSidebar` se dejó sin colapso por grupo (es un drawer). Commit `06ab6f6`.
- **T2-07 (Mis cursos a filas) — implementado:** lista densa (`divide-y rounded-lg border`) siguiendo el patrón de `assessment-list.tsx`; las asignaturas se muestran como badges en línea con el rol (Titular/Asistente). Commit `e7c042e`.
- **⚠️ Hallazgo importante:** `dev` avanzó durante la sesión (tip `8310a84`). Varias suposiciones del plan (basadas en el dev anterior) están desactualizadas: p. ej. el banco YA está consolidado como "Banco de contenido" (hub con tabs por subruta), `nav-items` usa `ROUTES.*` + `children` (flyouts), y la infraestructura de navegación (PageTabs, useOptimisticRoute) ya existe. Se re-mapea el estado actual antes de cada cluster; algunos tickets pueden estar parcial/totalmente hechos.

## Ola 3 — decisiones al ejecutar
- (pendiente)

## Ola 4 — decisiones al ejecutar
- (pendiente)

## Ola 5 — decisiones al ejecutar
- (pendiente)
