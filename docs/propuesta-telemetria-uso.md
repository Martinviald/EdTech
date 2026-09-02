# Telemetría de Uso de la Plataforma

> Sistema de analítica de **producto**: registrar qué módulos, vistas y
> funcionalidades usa cada usuario para distinguir lo que aporta valor de lo que
> no. Diseñado como base extensible (§8.2 CLAUDE.md): agregar un evento nuevo no
> toca el schema de la DB ni la ingesta, sólo el registro tipado de eventos.

## 1. Qué NO es

No es auditoría de cumplimiento. La trazabilidad legal de operaciones sensibles
(anonimización, exportaciones de PII, Ley 19.628) sigue en **`audit_logs`** vía
`PrivacyService`. La telemetría es una responsabilidad distinta (SRP) y vive en
su propia tabla `telemetry_events`. **No se guarda PII** (nunca nombres, RUT,
contenido de alumnos): sólo qué se usó, por qué org/rol, y cuándo.

## 2. Piezas

| Capa | Ubicación | Rol |
|---|---|---|
| **Registro de eventos** | `packages/types/src/schemas/telemetry.schema.ts` | Fuente única de verdad de la taxonomía. Una entrada por evento (categoría + schema Zod de `properties`). Da seguridad de tipos en compilación **y** validación en runtime. |
| **Política de acceso** | `packages/types/src/access-policies/telemetry.ts` | `TELEMETRY_VIEWER_ROLES` — quién ve la analítica agregada (admins + directivos). |
| **Tabla** | `packages/db/src/schema/telemetry-events.ts` + RLS en `sql/rls-policies.sql` | Polimórfica: `event_name` (text, no enum) + `properties`/`context` JSONB. Aislada por `org_id` (RLS). |
| **Ingesta** | `apps/api/src/telemetry/` | `POST /telemetry/events` (lote), valida contra el registro, escribe async con buffer. |
| **Captura pasiva** | `TelemetryInterceptor` (APP_INTERCEPTOR) | Cada request autenticada → evento `api.request` (endpoint, latencia, status). Gateable + muestreo. |
| **Captura MCP** | `AnalyticsToolsFacade.execute()` | Cada invocación de tool del servidor MCP analítico → evento `mcp.tool_invoked` (`tool`, `channel`, `ok`, `durationMs`). El `/mcp` HTTP se excluye del interceptor (es un único POST JSON-RPC que lleva muchas tools); el evento se emite a nivel de tool, donde se conoce el nombre. Cubre ambos canales: `mcp-external` (cliente MCP) e `in-app` (asistente IA). |
| **Consumo** | `GET /telemetry/usage` | Agregación: eventos por evento/categoría/rol/día, con usuarios únicos. |
| **Cliente web** | `apps/web/src/lib/telemetry/` | `TelemetryProvider` + `useTelemetry().track()` tipado + `PageViewTracker` automático. |

## 3. Flujo de datos

```
Web (useTelemetry().track / PageViewTracker)
  → buffer en memoria (flush por intervalo / tamaño / pagehide con sendBeacon)
  → POST /api/proxy/telemetry/events  (proxy adjunta Bearer)
  → TelemetryController.ingest → TelemetryService.ingestFromClient
     (valida contra el registro; org/user salen del JWT, NUNCA del body)
  → TelemetryWriterService (buffer + batch insert por org dentro de withOrgContext)
  → telemetry_events

Backend (interceptor / servicios de dominio)
  → TelemetryService.trackServer(actor, name, props)  [tipado]
  → TelemetryWriterService → telemetry_events
```

El writer agrupa el lote por `org_id` y hace un insert por grupo dentro de
`withOrgContext(orgId, ...)` (RLS). El flush ocurre por tamaño, por intervalo y en
`onModuleDestroy`. La telemetría es **best-effort**: un fallo se loguea y se
descarta, nunca rompe el flujo de usuario ni bloquea el response.

**Contexto de `api.request` (dispositivo/origen).** El interceptor enriquece cada
`api.request` con `context.userAgent` + `context.ip` (de `x-forwarded-for` / `request.ip`),
tomados **server-side de la request real** — nunca del cliente. Sirven para distinguir el
origen de una llamada (navegador vs script vs bot) y detectar **acceso directo a la API**
que no pasa por la web (que además genera `page.viewed` y llamadas de bootstrap como
`/organizations/me`). No se enriquecen los eventos de cliente (`page.viewed`, etc.): esos
llegan por el proxy de Next, así que la UA/IP que vería el backend sería la del proxy, no la
del navegador. UA/IP son metadatos operativos de origen (como `audit_logs`), no contenido de
usuario.

## 4. Cómo agregar un evento nuevo (sin migración)

1. Agregá una entrada a `telemetryEventDefinitions` en `telemetry.schema.ts`:

   ```ts
   'remedial.generated': {
     category: 'ai',
     properties: z.object({ materialId: z.string().uuid(), skillCount: z.number().int().nonnegative() }),
   },
   ```

2. Emitilo:
   - **Frontend** (Client Component): `const { track } = useTelemetry(); track('remedial.generated', { materialId, skillCount })`.
   - **Backend** (servicio de dominio): inyectá `TelemetryService` y llamá
     `this.telemetry.trackServer(actor, 'remedial.generated', { ... })`. `actor` es
     `{ orgId, userId, role }` (típicamente del `JwtPayload`). Requiere importar
     `TelemetryModule` en el módulo del dominio.

Nombres desconocidos o `properties` inválidas fallan en compilación (frontend/
backend) y se descartan en runtime (ingesta desde el cliente) — nunca se
persiste basura ni se rompe nada.

## 5. Configuración (env, opcional)

| Variable | Default | Efecto |
|---|---|---|
| `TELEMETRY_ENABLED` | `true` | `false` apaga el interceptor pasivo (`api.request`). |
| `TELEMETRY_API_SAMPLE_RATE` | `1` | Muestreo de `api.request` (`0`–`1`). |
| `TELEMETRY_BUFFER_SIZE` | `200` | Tamaño de buffer del writer antes de forzar flush. |
| `TELEMETRY_FLUSH_MS` | `5000` | Intervalo de flush del writer (ms). |

## 6. Estado / próximos pasos

- **Hecho (fundación + patrón):** tabla + RLS + registro tipado + ingesta con
  buffer + interceptor pasivo + provider web + page views automáticos +
  endpoints de agregación. Instrumentados como plantilla: `page.viewed` (auto),
  `api.request` (auto), `export.generated` (`ExportButton`), `session.role_switched`
  (`RoleSwitcher`).
- **Pendiente (siguiente iteración):** vista admin de consumo (`/telemetria`),
  que hoy se sirve por API (`GET /telemetry/usage`) a la espera de datos reales;
  instrumentación fina del resto de features; retención/particionado cuando el
  volumen lo justifique; migración del writer a BullMQ+Redis (F3+) sin tocar a
  los emisores (mismo puerto, como `JobDispatcher`).
```
