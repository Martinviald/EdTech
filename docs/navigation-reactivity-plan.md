# Plan — Reactividad al navegar (`apps/web`)

> Continúa [`loading-states-plan.md`](./loading-states-plan.md). Piloto = `/resultados` (streaming +
> filtros sin tintineo, ya hecho). Ahora se propaga la reactividad de navegación a todo el proyecto.

## Diagnóstico (medido)

- **73 páginas, 13 con `loading.tsx` propio** → 60 rutas usan el `loading.tsx` genérico del grupo
  (título + 3 cards) al navegar; no calza con la vista. Se siente como espera aunque no bloquee.
- **4 hubs renderizan sus tabs por-página** (sin `layout.tsx`): `resultados` (6), `organizacion` (2),
  `banco-items` (2), `configuracion` (4). Al cambiar de tab, el header + tabs se **desmontan/remontan**
  → parece recarga completa. Solo `evaluaciones` tiene `layout.tsx` (tabs persisten).

## Dos palancas

### Palanca 1 — `loading.tsx` por arquetipo (broad, bajo riesgo)
Agregar un `loading.tsx` que **calce** con cada ruta que no tenga uno. Reutiliza
`@/components/shared` (`FilterBarSkeleton`, `KpiGridSkeleton`, `CardSkeleton`, `TableSkeleton`) o
compone desde `@/components/ui/skeleton`. Solo crea `loading.tsx` — NO toca `page.tsx`. Saltar
páginas que solo redirigen (p. ej. `configuracion/page.tsx`).

**Aceptación:** cada ruta navegable muestra un skeleton que se parece a su destino, al instante.

### Palanca 2 — `layout.tsx` compartido en hubs de tabs (surgical)
Para que las tabs **persistan** al cambiar de tab (como el hub de evaluación), mover las tabs a un
`layout.tsx`. **Restricción:** cada hub tiene subrutas NO-tab que no deben llevar las tabs
(`resultados/detalle`, `resultados/informe`; `organizacion/configurar`; `banco-items/[instrumentId]`,
`nuevo`; `configuracion/escalas/[id]`, `nueva`). → usar un **route group** `(hub)/` que agrupe solo
las tab-pages + su `layout.tsx`, dejando las subrutas NO-tab fuera del grupo (las URLs no cambian).

Esto es delicado (mover carpetas a un route group) → se hace con cuidado, hub por hub, empezando por
`resultados` como referencia. NO se paraleliza a ciegas.

## Ejecución

1. **Palanca 1 (ahora, subagentes por sección):** sweep de `loading.tsx`. Paralelizable, disjunto.
2. **Palanca 2 (después, con cuidado):** route-group + `layout.tsx` por hub. Empezar por `resultados`
   (referencia), luego evaluar `organizacion`/`banco-items`/`configuracion`.

## Fuera de alcance / notas
- Streaming (Suspense por sección) ya está en las vistas multi-query. Las de una query se cubren con
  `loading.tsx` (Palanca 1) — suficiente.
- No mover fetching a cliente (RSC-first se mantiene).
