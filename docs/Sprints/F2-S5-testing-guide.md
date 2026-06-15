# Guía de Testing — Sprint F2-S5 (Integración, monetización y hardening)

> Cubre H18.1 (gating tier pago) y H19.25 (observabilidad IA). H18.2 (validación
> pedagógica) queda **diferida** hasta disponer de `GEMINI_API_KEY`.
>
> **Prerequisitos:** `DATABASE_URL` + `pnpm db:migrate` aplicado, seed con al menos
> una org (colegio) y un usuario `school_admin` + un `teacher`. Para ver datos de
> costo en H19.25 se necesita haber generado al menos un análisis IA o material
> remedial (requiere `GEMINI_API_KEY`); sin ellos el panel muestra ceros (válido).

---

## Verificación estática (sin DB)

```bash
pnpm typecheck                     # 7/7 limpio
pnpm --filter @soe/api test -- feature.guard        # 8/8
pnpm --filter @soe/api test -- ai-observability     # 12/12
```

Smoke de arranque (con `.env`):
```bash
cd apps/api && API_PORT=4096 pnpm dev
curl -s -o /dev/null -w '%{http_code}' http://localhost:4096/api/health             # 200
curl -s -o /dev/null -w '%{http_code}' http://localhost:4096/api/ai-observability/summary   # 401
curl -s -o /dev/null -w '%{http_code}' http://localhost:4096/api/organizations/me/features  # 401
```

---

## H18.1 — Gating de tier pago

### Backend
1. **Por default todo habilitado (piloto):** con una org sin `config.allowedFeatures`, autentícate
   como `school_admin` y llama `GET /api/ai-analysis/:id`, `/api/remedial`, `/api/benchmarking/instruments`.
   → responden normal (no 403). `GET /api/organizations/me/features` devuelve los 3 features y `aiBudgetUsd: null`.
2. **Deshabilitar una feature:** como `platform_admin`,
   `PATCH /api/organizations/:orgId/features` con `{ "allowedFeatures": ["ai_analysis"], "aiBudgetUsd": 50 }`.
   - `GET /organizations/:orgId/features` → `allowedFeatures: ["ai_analysis"]`, `aiBudgetUsd: 50`.
   - Como `school_admin` de esa org: `GET /api/remedial` → **403** ("no está habilitada en el plan").
   - `GET /api/ai-analysis/:id` → sigue permitido (200/404).
   - `GET /api/benchmarking/instruments` → **403**.
3. **platform_admin se exime:** un `platform_admin` accede a las 3 aunque la org no las tenga.
4. **Sin orgId:** un usuario sin org asociada (y no platform_admin) → **403** en cualquier ruta gateada.
5. **Gestión restringida:** `PATCH /organizations/:orgId/features` como `school_admin` (no platform_admin) → **403**.
6. **Merge no destructivo:** tras el PATCH, verifica en DB que otras claves de `organizations.config`
   (si existían) se conservan.

### Frontend
7. Con la feature deshabilitada, navega a `/material-remedial` (o `/benchmarking`): se muestra el
   **aviso de upgrade** (candado + "no está incluida en tu plan"), no el contenido.
8. Con la feature habilitada, la página carga normal.
9. Casos de error: si `GET /organizations/me/features` falla (API caída), la UI **no bloquea**
   (default a habilitado); el backend sigue siendo la barrera real.

---

## H19.25 — Observabilidad de costo/latencia IA

1. **Acceso:** `/observabilidad-ia` visible y accesible para `platform_admin`/`school_admin`/`academic_director`.
   Un `teacher` → redirect a `/dashboard` (no es viewer).
2. **Summary:** `GET /api/ai-observability/summary` (autenticado) →
   - `totals` con count, totalCostUsd, tokens in/out, avgLatencyMs (null si no hay completados), failedCount.
   - `bySource` (ai_analysis / remedial), `byType`, `byModel` con sus montos.
3. **Rango de fechas:** `?from=2026-05-01&to=2026-05-31` acota la agregación.
4. **Budget:** define `aiBudgetUsd` vía H18.1. `GET /api/ai-observability/budget`:
   - sin gasto → `alertLevel: "ok"`, `pctUsed` bajo.
   - gasto entre 80-100% del tope → `"warning"`. Sobre 100% → `"over"`.
   - sin tope (`aiBudgetUsd: null`) → `pctUsed: null`, `alertLevel: "ok"`.
5. **Timeseries:** `GET /api/ai-observability/timeseries` → puntos por día con costo y count.
6. **Aislamiento multi-tenant:** los montos corresponden SÓLO a la org del token (RLS via `withOrgContext`).
   Verifica que un admin de la org A no ve costo de la org B.
7. **Panel UI:** tarjetas de totales, barra de presupuesto coloreada por `alertLevel`, tablas de
   desglose y la serie temporal como barras. Montos en USD (`Intl.NumberFormat`).

---

## Pendiente (no bloquea el cierre de S5)

- **H18.2 — Validación pedagógica:** requiere `GEMINI_API_KEY`. Generar muestras reales de análisis
  e IA remedial, revisar calidad, ajustar `promptVersion`/few-shot. Usar el panel de H19.25 para
  controlar costo durante la validación.
- **E2E con datos seedeados:** flujo completo dato→insight→remedial→benchmark con un seed multi-colegio
  y la key IA. Hoy validado por typecheck + unit tests + smoke de arranque.
- Suites `privacy/*` (16 tests): fallan sólo por falta de `DATABASE_URL` en el entorno de test (pre-existente).
