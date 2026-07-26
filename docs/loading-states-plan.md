# Plan — Loading states, streaming y optimistic updates (`apps/web`)

> Decisiones (2026-07-20): **(1)** loading = **Suspense nativo RSC** (no mover a cliente);
> **(2)** optimistic = **`useOptimistic` (React 19) + Server Actions**; **(3)** partir con un
> **piloto en una vista multi-query**. No cambia el grano RSC-first (regla
> `.claude/rules/frontend/06-client-data-fetching.md`): TanStack Query sigue solo para polling.

---

## 1. Diagnóstico (medido)

- **Empty states: resueltos** (`EmptyState`, ~36 usos). Fuera de alcance.
- **Loading bloqueante:** las vistas son RSC que hacen `await Promise.all([...])` de todas las queries
  **antes** de renderizar JSX (39 páginas `force-dynamic`). **0 `<Suspense>`.** Solo 2 `loading.tsx`,
  el del grupo es genérico (título + 3 cards) y no calza con la vista destino. → al navegar, skeleton
  genérico durante todo el fetch y luego "salto".
- **Optimistic: 0.** Mutaciones = `useTransition + toast + router.refresh()` (re-fetch de toda la ruta).

---

## 2. Arquitectura objetivo

### 2.1 Shell instantáneo + Suspense por sección
La página **no** `await`ea datos (solo `auth()`/params para el gate). El shell (`PageHeader`, tabs,
filtros) renderiza al instante; cada bloque de datos vive en un **componente async propio** envuelto
en `<Suspense fallback={<SkeletonX/>}>`. React renderiza los hermanos en paralelo y **cada uno
streamea cuando su query resuelve** (progressive loading nativo).

```tsx
// page.tsx (NO await de datos)
export default async function Page({ searchParams }) {
  const session = await auth();               // solo gate
  if (!canAccess(...)) redirect('/dashboard');
  const filters = parseFilters(await searchParams);
  return (
    <PageContainer>
      <PageHeader title="…" />
      <Suspense fallback={<FilterBarSkeleton />}><FiltersSection filters={filters} /></Suspense>
      <Suspense fallback={<KpiGridSkeleton />}><KpisSection filters={filters} /></Suspense>
      <Suspense fallback={<CardSkeleton />}><AlertsSection filters={filters} /></Suspense>
    </PageContainer>
  );
}
// cada *Section es async y hace su propio apiGet
```

- **Fetch compartido → `React.cache()`.** Si varias secciones dependen del mismo endpoint (p. ej.
  `overview`), se envuelve el fetch en `cache()` (ya se usa en `getCurrentOrg`, regla `05-performance`)
  para que el request se **deduplique** por-request pese a llamarse desde varias secciones.
- **Error por sección:** cada `Suspense` puede acompañarse de un `error.tsx`/boundary o `try/catch`
  para que un fallo de UNA query no tire toda la página (defense-in-depth; hoy un throw en la página
  cae al `error.tsx` global).

### 2.2 Librería de skeletons por arquetipo
Desde el primitivo `ui/skeleton.tsx`, construir componentes en `shared/skeletons/` que **calcen** con
los 5 arquetipos (`03-process-archetypes.md`):
- `ListSkeleton` / `TableSkeleton` (filas repetidas)
- `KpiGridSkeleton` (grid de StatCards / MetricsGroup)
- `FilterBarSkeleton`
- `DashboardSkeleton` (header + kpis + card)
- `DetailSkeleton` (hub con tabs)

Se reutilizan tanto en `loading.tsx` (fallback de navegación) como en los `<Suspense>` por sección.

### 2.3 `loading.tsx` por arquetipo
Reemplazar el genérico por `loading.tsx` que rendericen el skeleton del arquetipo correspondiente,
colocados por ruta/segmento (lista, dashboard, detalle). Da el fallback **instantáneo** al navegar,
antes incluso del streaming interno.

### 2.4 Optimistic con `useOptimistic` + Server Actions
Para mutaciones interactivas: `useOptimistic` aplica el cambio en UI al instante; el Server Action
persiste y **revalida puntual** (`revalidatePath`/`revalidateTag`) en vez de `router.refresh()`
completo. El `toast`/rollback se mantiene si la action falla.

---

## 3. Piloto — Panorama pedagógico (`/resultados`)

Vista más pesada y de uso frecuente. Hoy: `await Promise.all([overview, options])` + `teacherKpis`
condicional, luego KPIs + DistributionBar + Alerts + RecentAssessments + TeacherKpis (todo bloquea).

**Conversión:**
1. `getDashboardOverview(query)` y `getDashboardFilters(query)` envueltos en `React.cache()`.
2. `page.tsx` deja de `await`ear datos; renderiza el shell + secciones en `<Suspense>`:
   - `<Suspense fallback={<FilterBarSkeleton/>}>` → `FiltersSection` (usa `getDashboardFilters`).
   - `<Suspense fallback={<KpiGridSkeleton/>}>` → `KpisSection` (usa `getDashboardOverview`).
   - `<Suspense fallback={<CardSkeleton/>}>` → `DistributionBar` + `AlertsSection` + `RecentAssessments`
     (comparten `overview` deduplicado por `cache()`; se pueden agrupar en 1–2 boundaries).
   - `teacherKpis` en su propio `<Suspense>` (query condicional independiente).
3. `loading.tsx` de `resultados/` con `DashboardSkeleton`.
4. **Optimistic (1 caso):** elegir una mutación de la sección (p. ej. marcar/descartar una alerta, o un
   toggle de filtro guardado) y convertirla a `useOptimistic` + Server Action con `revalidatePath`.
   *(Si no hay una mutación clara en esta vista, el piloto de optimistic se hace en otra — ver §5.)*

**Aceptación del piloto:**
- Al navegar a `/resultados`: shell + filtros aparecen **inmediatamente**; KPIs y secciones streamean
  con su skeleton, la más rápida primero (verificable ralentizando una query en dev).
- Sin `Promise.all` bloqueante en `page.tsx`; `next build` sin regresión; error de una sección no tira
  la página.

---

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| Más requests (una query por sección vs Promise.all) | `React.cache()` deduplica el endpoint compartido por-request; los independientes ya iban en paralelo |
| `searchParams` + Suspense: la key del boundary debe cambiar con los filtros para re-mostrar skeleton | Pasar `key={query}` al `<Suspense>` o a la sección para reiniciar el fallback al cambiar filtros |
| Un throw en una sección tira toda la página | `error boundary`/`try-catch` por sección; hoy cae al `error.tsx` global |
| `force-dynamic` sigue re-fetcheando en cada nav | Es inherente al dato (RLS/per-request); el streaming NO lo cachea pero **elimina el bloqueo** (shell instantáneo) — que es el problema percibido |
| `useOptimistic` con revalidación puntual mal scopeada deja UI desincronizada | Empezar por 1 mutación acotada; `revalidatePath` del path afectado, no refresh global |

---

## 5. Rollout (después de validar el piloto)

1. **Skeletons por arquetipo** en `shared/skeletons/` (base reutilizable).
2. **`loading.tsx` por segmento** para los arquetipos (lista/tabla/dashboard/detalle).
3. **Suspense por sección** en las otras vistas multi-query (dashboard landing, hub de evaluación,
   benchmarking, banco-items). Paralelizable por feature con subagentes, mismo patrón del piloto.
4. **Optimistic** en las interacciones que más lo pidan: agregar/quitar fila (equipo, asignaciones),
   toggles (estado de ítem, publicar/archivar), edición inline. Una por una, `useOptimistic` + action.
5. **Doc:** extender `06-client-data-fetching.md` con "streaming RSC por sección" y el patrón de
   skeleton, para que sea el estándar.

---

## 6. Qué NO se hace

- No se mueve el fetching a cliente (TanStack Query se queda solo para polling).
- No se cachea el dato per-request de las vistas `force-dynamic` (es RLS-scoped) — el objetivo es
  **eliminar el bloqueo**, no evitar el fetch.
- No se tocan los empty states (ya resueltos).
