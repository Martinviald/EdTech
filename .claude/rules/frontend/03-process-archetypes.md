# Page/View Archetypes (`apps/web`)

> Named recurring page shapes, so a new feature page starts from the closest existing pattern
> instead of reinventing layout. These are **observed from real pages**, not prescribed from
> scratch — where the codebase is inconsistent, this file says so and points at the migration plan
> phase that will (eventually) consolidate it, rather than pretending a clean convention exists.
> For component-level lookups (which `Badge` variant, which `Dialog` import) see
> `02-ui-conventions.md`. For the token/layer rules governing everything below, see `AGENTS.md`.

Five shapes recur. The first three are consistent (same shell every time); the wizard shape is
consistent in spirit but not code (no shared container); the "settings page" shape is a
self-consistent *deviation* from the other four — flagged, not endorsed.

---

## 1. List/table page

**Shell:** `PageContainer` → `PageHeader` (title + description + `actions` slot for
create/import buttons) → a client `*Table` component (fetches nothing itself — gets data as
props from the Server Component page).

**Real example:** `apps/web/src/app/(dashboard)/equipo/page.tsx` (full file, trimmed):

```tsx
export default async function EquipoPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, STAFF_MANAGEMENT_ROLES)) redirect('/dashboard');

  const members = await apiGet<MemberModel[]>('/organizations/me/members');

  return (
    <PageContainer>
      <PageHeader
        title="Equipo"
        description="Invita docentes y coordinadores a tu colegio…"
        actions={
          <>
            <BulkImportDialog />
            <AddMemberDialog />
          </>
        }
      />
      <MembersTable members={members} currentUserId={session.user.id} />
    </PageContainer>
  );
}
```

`MembersTable` (`.../equipo/MembersTable.tsx`) is the row-actions pattern: `Table` +
`DropdownMenu` per row + `AlertDialog` for the destructive action (revoke), `StatusBadge`/`EmptyState`
from `patterns/`. Same shell in `banco-items/page.tsx`, `evaluaciones/page.tsx`,
`configuracion/escalas/EscalasTable`-adjacent pages (see §5 for why that one page's *header*
deviates even though its table doesn't).

**Auth gate:** `auth()` → redirect to `/login` if no session, then `canAccess(session.user.roles, <ROLE_SET>)`
→ redirect to `/dashboard` if not permitted. This exact two-line gate opens almost every gated
page in the app — see `04-roles-and-permissions.md`.

---

## 2. Dashboard/overview page (filters + KPI cards + charts/tables)

**Shell:** `PageContainer` → `PageHeader` → optional sub-nav (`ResultadosNav`) → a filter bar
(`*FilterBar`, reads/writes `searchParams`) → a KPI grid of cards → one or more `Card`-wrapped
sections (chart, table, or `EmptyState`).

**Real example:** `apps/web/src/app/(dashboard)/resultados/page.tsx` (trimmed):

```tsx
export default async function ResultadosOverviewPage({ searchParams }: { ... }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const filters = parseDashboardFilters(await searchParams);
  const [overview, options] = await Promise.all([
    apiGet<DashboardOverviewResponse>(`/dashboards/overview${buildDashboardQuery(filters)}`),
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${buildDashboardQuery(filters)}`),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Panorama pedagógico" description={...} />
      <ResultadosNav />
      <DashboardFilterBar options={options} value={filters} basePath="/resultados" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="% Logro global" value={formatAchievement(overview.globalAchievement)} icon={BarChart3} />
        {/* …3 more SummaryCard */}
      </div>
      <DistributionBar distribution={overview.performanceDistribution} />
      <AlertsSection alerts={overview.alerts} />
      <RecentAssessments assessments={overview.recentAssessments} />
    </PageContainer>
  );
}
```

Note: `SummaryCard` here is a **route-local** component (`resultados/components/summary-card.tsx`),
not the shared `MetricComparison` from `patterns/` — the audit (H6, H9) flags this as one of the
duplicated "stat card" implementations slated for consolidation into a shared `StatCard`
(migration plan `2-T2`). If you're building a new KPI grid, prefer `MetricComparison` from
`components/patterns` when it fits (it supports delta chips out of the box); only follow
`SummaryCard`'s local pattern if you're extending that specific page.

Data-fetch pattern: filters parsed from `searchParams` → `Promise.all` for independent `apiGet`
calls → conditional extra fetch (`teacherKpis`) only when the first response says it's needed.

---

## 3. Tabbed hub / detail page

**Shell:** a route-group `layout.tsx` does the one shared fetch + auth gate + `PageHeader`, then
renders a tab nav whose visible tabs are filtered per-tab by role, then `{children}` — each tab is
its own `page.tsx` under a subfolder, fetching only its own tab's data.

**Real example:** `apps/web/src/app/(dashboard)/evaluaciones/[assessmentId]/layout.tsx` (trimmed):

```tsx
export default async function EvaluacionLayout({ children, params }: { children: ReactNode; params: Promise<{ assessmentId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;
  let report: AssessmentReportResponse | null = null;
  try {
    report = await apiGet<AssessmentReportResponse>(`/analytics/assessment-report?assessmentId=${assessmentId}`);
  } catch {
    notFound();
  }
  if (!report) notFound();

  const roles = session.user.roles;
  const base = `/evaluaciones/${assessmentId}`;
  const tabs: HubTab[] = [
    { href: base, label: 'Resumen', exact: true },
    ...(canAccess(roles, ANALYTICS_VIEWER_ROLES) ? [{ href: `${base}/resultados`, label: 'Resultados' }] : []),
    // …more role-gated tabs
  ];

  return (
    <PageContainer>
      <PageHeader title={title} description={description} actions={<>...</>} />
      <AssessmentTabsNav tabs={tabs} />
      {children}
    </PageContainer>
  );
}
```

Use this shape (not a single mega-`page.tsx`) whenever a record has several role-gated sub-views
that share one expensive fetch (here: the assessment report meta) — the `apiGet` failure path also
demonstrates the right idiom for "not found or no access" on a *record* (as opposed to a list
page's blanket `redirect`): `try { ... } catch { notFound(); }`.

**This is the canonical "record detail" shape — but it's not the only one in the codebase.**
`apps/web/src/app/(dashboard)/banco-items/[instrumentId]/InstrumentDetailView.tsx` is a
non-tabbed record detail view that hand-rolls its own breadcrumb + `<h1>` instead of using
`PageHeader`, and defines a local `STATUS_COLORS` map with raw `bg-green-100`/`bg-yellow-100`
classes instead of `StatusBadge` (§"Achievement-level colors" gap, `02-ui-conventions.md`). If you
extend that page, prefer migrating its header to `PageHeader` over copying its current shape.

---

## 4. Create/import wizard

**Shell:** a top-level client component owns `useState<Step>` + `useTransition`, renders
`Stepper` from `patterns/` for the progress indicator, then conditionally renders one
step-component per state value. Each step calls a Server Action and advances on success.

**Real example:** `apps/web/src/app/(dashboard)/importar/instrumento/DiaImportWizard.tsx` (trimmed):

```tsx
type Step = 'upload' | 'preview' | 'confirm';
const WIZARD_STEPS = [
  { id: 'upload', label: 'Cargar archivo' },
  { id: 'preview', label: 'Previsualizar' },
  { id: 'confirm', label: 'Confirmar' },
];
const STEP_INDEX: Record<Step, number> = { upload: 0, preview: 1, confirm: 2 };

export function DiaImportWizard({ catalogOptions }: DiaImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isPending, startTransition] = useTransition();
  // ...

  const handleUpload = (data, meta) => {
    startTransition(async () => {
      const result = await previewDiaImport(data, meta);
      if (!result.ok) { toast.error(result.message); return; }
      setPreviewResult(result.data);
      setStep('preview');
    });
  };

  return (
    <div className="space-y-6">
      <Stepper steps={WIZARD_STEPS} currentStep={STEP_INDEX[step]} />
      {step === 'upload' && <UploadStep onSubmit={handleUpload} isPending={isPending} catalogOptions={catalogOptions} />}
      {step === 'preview' && previewResult && <PreviewStep preview={previewResult} onConfirm={handleConfirm} onCancel={handleReset} isPending={isPending} />}
      {step === 'confirm' && confirmResult && <ConfirmStep result={confirmResult} onReset={handleReset} />}
    </div>
  );
}
```

**Honest gap:** there is no shared `Wizard`/`WizardContainer` component — `Stepper` is only the
visual indicator. Each of the three real wizards (`DiaImportWizard`, `banco-items/.../SpecTableWizard.tsx`,
`organizacion/configurar/SetupWizard.tsx`) reimplements its own `useState<Step>` + `STEP_INDEX` +
conditional-render block independently (Audit H6: "Wizards" duplicated ×3). If you're building a
4th wizard, follow this shape (it's the de facto convention) but don't expect a shared container to
extend — extracting one is unscheduled (not in the current migration plan phases, unlike
`FormDialog`/`FilterBar`/`PendingButton`/`StatCard` which are explicitly slated in `2-T2`).

---

## 5. Settings/config page — a consistent but non-canonical deviation

**Shell:** hand-rolled `<div className="space-y-6">` + a manually built breadcrumb (`Link` +
`span` separators) + a manually built `<h1 className="text-2xl font-semibold">` + description
`<p>`, instead of `PageContainer`/`PageHeader`.

**Real example:** `apps/web/src/app/(dashboard)/configuracion/escalas/page.tsx` and
`apps/web/src/app/(dashboard)/configuracion/modelos-ia/page.tsx` both do this identically:

```tsx
return (
  <div className="space-y-6">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link href={'/configuracion' as Route} className="hover:text-foreground">Configuración</Link>
      <span>/</span>
      <span>Escalas de notas</span>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Escalas de notas</h1>
        <p className="text-muted-foreground mt-1 text-sm">…</p>
      </div>
      <Button asChild><Link href={'/configuracion/escalas/nueva' as Route}><Plus className="mr-2 size-4" />Nueva escala</Link></Button>
    </div>
    <EscalasTable scales={scaleList} />
  </div>
);
```

This is functionally equivalent to `PageHeader`'s `breadcrumb` + `title` + `description` +
`actions` props (`PageHeader` was literally built to replace "the pattern that today is rewritten
inline in every dashboard/admin view" per its own docstring) — but these two `configuracion/*`
pages predate that consolidation, or were missed by it. **Don't copy this shape for new settings
pages.** Use archetype #1's `PageHeader` with its `breadcrumb` slot instead:

```tsx
<PageHeader
  breadcrumb={<nav className="flex items-center gap-2 text-sm text-muted-foreground">...</nav>}
  title="Escalas de notas"
  description="…"
  actions={<Button asChild><Link href="...">Nueva escala</Link></Button>}
/>
```

If you're touching `configuracion/escalas/page.tsx` or `configuracion/modelos-ia/page.tsx` for an
unrelated change, migrating the header to `PageHeader` is a reasonable drive-by fix — it's the
same kind of per-feature cleanup the migration plan's Fase 3 already does for color tokens, just
not separately ticketed for this specific duplication.
