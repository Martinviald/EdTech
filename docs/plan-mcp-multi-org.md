# Plan de desarrollo — Org activa (multi-org) en el MCP analítico

> Companion de [`propuesta-mcp-analitico.md`](./propuesta-mcp-analitico.md) y
> [`plan-desarrollo-mcp-analitico.md`](./plan-desarrollo-mcp-analitico.md). Extiende el MCP (ya
> desplegado, F0–F7) para que un usuario **multi-org** pueda operar sobre distintas organizaciones
> desde el mismo connector, con una **org activa persistida** por usuario (patrón consistente con el
> `switch-org` de la app web), sin romper el diseño stateless del transporte. **Branch base sugerido:
> `mcp-multi-org`** (desde `main`).

## Decisión de diseño (cerrada)

**Org activa persistida por usuario**, no `org_id` por llamada. Razones:
- Consistente con el producto: la app ya tiene org/rol activo (`POST /auth/switch-org`).
- Mejor UX conversacional: "cambiate a CSCJ" y todas las tools siguen esa org.
- No choca con el stateless del MCP: la org activa vive en **nuestra DB** (estado de aplicación,
  igual que roles/membresías), no en estado de sesión del protocolo. El servidor sigue reconstruyendo
  el principal desde el token en cada request.

**Resguardo obligatorio contra el "estado oculto" (crítico porque mandamos datos reales de colegios
—incl. PII de CSCJ— a un LLM):** cada respuesta de tool **declara sobre qué org corrió**
(`orgContext: {orgId, orgName}`). Así la org activa nunca es silenciosa; Claude y el humano siempre
ven el tenant.

**Fuera de alcance (v1):** override `org_id` por llamada (queda como extensión opcional, G4).

## Puntos de reuso (ya existen, no reinventar)

- `AuthService.switchActiveOrg(user, orgId)` — valida que el usuario sea miembro (`user.orgs`) y
  recalcula roles vía `getActiveMembershipsForEmailAndOrg(db, email, orgId)`
  (`apps/api/src/auth/auth.service.ts:325`). **Los roles son por-org** → cambiar de org recalcula
  roles + features + qué tools ves.
- `getActiveMembershipsForEmailAndOrg(db, email, orgId)` (`@soe/db`) — memberships + organization de
  UNA org. Es el helper para resolver/validar la org activa.
- `listActiveOrgsWithMembershipsByEmail(db, email)` (`@soe/db`) — todas las orgs activas del usuario
  → alimenta `list_my_orgs`.
- `McpPrincipalResolver` (`apps/api/src/mcp/auth/mcp-principal.resolver.ts`) — hoy resuelve la org
  **por defecto** (`validateUser` → `pickDefaultActiveOrg`) + `resolveFeatures(orgId)`. Es el único
  punto que cambia para leer la org activa.
- El **token de WorkOS es identity-only** (solo `email`): **no se toca la auth ni WorkOS**. Todo el
  multi-org se resuelve server-side desde la DB.

## Modelo de datos

Tabla nueva `mcp_user_active_org` (`packages/db/src/schema/mcp.ts`, junto a `mcp_access_logs`):

| Columna | Tipo | Notas |
|---|---|---|
| `userId` | `uuid` PK, FK `users(id)` on delete cascade | una org activa por usuario (canal MCP) |
| `orgId` | `uuid` NOT NULL, FK `organizations(id)` on delete cascade | la org activa elegida |
| `createdAt` / `updatedAt` | `timestamp` default now() | |

- **Sin RLS**: es estado de usuario (su propia preferencia), no dato de tenant. Se lee/escribe SIEMPRE
  filtrando por el `userId` autenticado (que sale del token validado, nunca del input) → sin riesgo de
  leak cross-tenant. Mismo criterio que `users` (que tampoco tiene RLS).
- **Grant**: el rol runtime `soe_app` necesita `SELECT/INSERT/UPDATE/DELETE` sobre la tabla nueva
  (lo aplica `db:provision-roles` / los grants del deploy; verificar que la tabla nueva quede cubierta).
- **Defensa en profundidad**: aunque la fila persista un `orgId`, la resolución RE-VALIDA la membresía
  en cada request (ver G2). Si al usuario le revocaron el acceso a esa org, se cae al default.

---

## Secuenciación

```
G1 (persistencia + list_my_orgs + whoami) ── G2 (set_active_org) ── G3 (orgContext en respuestas)
                                                                        └── G4 (opcional: override por llamada)
```

| Fase | Título | Toca DB | Riesgo | Depende de |
|---|---|---|---|---|
| G1 | Persistencia + resolución de org activa + `list_my_orgs` + `whoami` extendido | Sí | Bajo | — |
| G2 | Tool `set_active_org` (switch real, recalcula roles/features) | No | Medio | G1 |
| G3 | `orgContext` en cada respuesta de tool (resguardo anti-estado-oculto) | No | Bajo | G1 |
| G4 | (opc.) override `org_id` por llamada | No | Bajo | G2 |

---

## Fase G1 — Persistencia + resolución de org activa + visibilidad

**Objetivo:** el resolver lee la **org activa persistida** (con fallback a la por defecto), y el
usuario puede **ver** sus orgs y cuál está activa. Todavía sin tool de switch → la activa es la por
defecto, pero ya visible y persistible.

### DB + types
- [ ] `packages/db/src/schema/mcp.ts` — tabla `mcp_user_active_org` (arriba) + relations + tipos
      `$inferSelect/Insert`. Export desde el index de schema.
- [ ] `pnpm db:generate` → migración; revisar. `pnpm db:migrate` local. Verificar grant a `soe_app`.
- [ ] `packages/types` — schema Zod de respuesta de `list_my_orgs` (`mcpOrgSummarySchema`:
      `{ orgId, name, roles: UserRole[], isActive }`).

### API
- [ ] `McpPrincipalResolver.resolve(email)` — nueva lógica:
  1. `validateUser(email)` (default org + `orgs`).
  2. Leer `mcp_user_active_org` por `userId`.
  3. Si hay org activa **distinta** de la default → `getActiveMembershipsForEmailAndOrg(email, activeOrgId)`;
     si válida, usar ESA org (roles de esa org); si no (revocada/stale), **fallback a default** (y
     opcionalmente limpiar la fila).
  4. `features = resolveFeatures(orgId)` para la org resuelta.
  Método privado `resolveOrgContext(...)` para no inflar `resolve`.
- [ ] `McpPrincipalResolver.listMyOrgs(email)` — `listActiveOrgsWithMembershipsByEmail` → mapea a
      `mcpOrgSummarySchema[]`, marcando `isActive` según la org resuelta.
- [ ] `apps/api/src/mcp/tools/list-my-orgs.tool.ts` — `@AnalyticsTool`, `requiredRoles: USER_ROLES`,
      `piiLevel: 'aggregate'`; delega en `resolver.listMyOrgs(principal.email)`.
- [ ] `apps/api/src/mcp/tools/whoami.tool.ts` — extender output con `activeOrg: {orgId, orgName}` (ya
      tiene orgId/orgName en el principal) y `orgCount`.
- [ ] Registrar `ListMyOrgsTool` en `McpModule`.

### Tests
- [ ] `mcp-principal.resolver.spec.ts` — org activa válida ⇒ usa esa org + sus roles; activa revocada
      ⇒ fallback a default; sin fila ⇒ default. (DB fake por-test, patrón existente.)
- [ ] `list-my-orgs.tool.spec.ts` — delega y marca `isActive`.

**Puerta de calidad + PR:** `pnpm typecheck && pnpm lint && pnpm --filter api test && pnpm --filter
@soe/db db:migrate`. PR: `feat(mcp): org activa persistida + list_my_orgs + whoami con org activa`.

**Aceptación:** `whoami` muestra la org activa; `list_my_orgs` lista las orgs del usuario con roles;
el resolver respeta una org activa persistida (aunque todavía no haya cómo cambiarla).

---

## Fase G2 — Tool `set_active_org` (el switch)

**Objetivo:** el usuario cambia la org activa desde Claude; a partir de ahí todas las tools operan
sobre esa org, con roles/features recalculados.

### API
- [ ] `McpPrincipalResolver.setActiveOrg(userId, email, orgId)` — valida membresía con
      `getActiveMembershipsForEmailAndOrg(email, orgId)` (403 si no es miembro), **upsert** en
      `mcp_user_active_org` (`onConflictDoUpdate` por `userId`), y devuelve `{ orgId, orgName, roles }`
      de la org nueva.
- [ ] `apps/api/src/mcp/tools/set-active-org.tool.ts` — `@AnalyticsTool`, input `{ orgId: uuid }`,
      `requiredRoles: USER_ROLES`, `piiLevel: 'aggregate'`. Delega en `resolver.setActiveOrg`. La
      descripción le aclara al modelo que **afecta a todas las llamadas siguientes**.
- [ ] Registrar en `McpModule`.

### Tests
- [ ] `set-active-org.tool.spec.ts` / resolver spec — miembro ⇒ upsert + devuelve roles de esa org;
      no-miembro ⇒ `ForbiddenException`; idempotencia del upsert.

**Puerta de calidad + PR:** típica. PR: `feat(mcp): tool set_active_org (cambio de org activa)`.

**Aceptación:** tras `set_active_org(<CSCJ>)`, `whoami` y las tools de datos reportan y operan sobre
CSCJ con los roles del usuario EN CSCJ; un `set_active_org` a una org donde no es miembro da 403.

---

## Fase G3 — `orgContext` en cada respuesta (resguardo anti-estado-oculto)

**Objetivo:** que la org sobre la que corre cada tool sea **siempre explícita** en la respuesta —
elimina el riesgo de "quedó activa otra org" al mandar datos a un LLM.

### API
- [ ] `apps/api/src/mcp/adapter/mcp.controller.ts` — en el handler de `tools/call`, envolver el
      resultado con `orgContext: { orgId, orgName }` del `principal` (una sola vez, sin tocar cada
      tool): agregarlo a `structuredContent` **y** prefijar una línea legible en el `content` de texto
      (ej. `Organización: <orgName> (<orgId>)`). Excluir tools no-org (`whoami`, `list_my_orgs`,
      `set_active_org`) o incluirlo igual (inocuo).
- [ ] Actualizar `mcp.controller.spec.ts` — `tools/call` incluye `orgContext`.

**Puerta de calidad + PR:** típica. PR: `feat(mcp): cada respuesta de tool declara su organización`.

**Aceptación:** toda respuesta de tool de datos incluye `orgContext`; el modelo (y el humano) siempre
ve el tenant sobre el que se ejecutó.

---

## Fase G4 (opcional) — Override `org_id` por llamada

**Objetivo:** consultas puntuales sobre otra org sin cambiar la activa (lo mejor de ambos mundos).

- [ ] `org_id` opcional en el input de las tools org-scoped; si viene, el facade re-resuelve el
      principal para esa org (misma validación de membresía) solo para esa llamada, sin persistir.
- [ ] Documentar la precedencia: `org_id` de la llamada > org activa > org por defecto.

No hacerlo en v1; queda como extensión si aparece la necesidad.

---

## Seguridad y consideraciones

- **`userId` siempre del token validado** (nunca del input). La fila `mcp_user_active_org` se lee/escribe
  por ese `userId`.
- **Membresía validada dos veces**: al setear (G2) y al resolver por request (G1) → seguro ante
  revocación de acceso.
- **Global por usuario**: la org activa es una sola por usuario, **compartida entre clientes**
  (Claude + ChatGPT + conversaciones). Cambiarla en uno afecta a los otros. Es comportamiento conocido;
  el `orgContext` de G3 lo hace no-sorprendente. (Aislamiento por-cliente exigiría sesiones stateful del
  MCP; fuera de alcance.)
- **PII**: cambiar a una org con roster real (CSCJ) hace que las tools agregadas calculen sobre datos
  reales. Sigue siendo agregado (sin nombres/RUTs), coherente con la política del MVP.
- **platform_admin — queda como está (decisión cerrada)**: no es "miembro" de orgs puntuales, así que
  `getActiveMembershipsForEmailAndOrg` lo rechazaría; y sin org no tiene features → hoy no puede usar
  el MCP de todas formas. **No se le agrega un path especial de multi-org.** `set_active_org` sobre
  cualquier org le dará 403 (no-miembro), consistente con el resto. Si en el futuro un platform_admin
  necesita operar el MCP, será una iniciativa aparte, no parte de este plan.
- **Auditoría**: `set_active_org` queda en `mcp_access_logs` como cualquier tool. Considerar loguear
  explícitamente el cambio de org (org anterior → nueva).

## Checklist transversal (por fase)

- [ ] `userId`/`orgId` del principal (token), nunca del input de la tool.
- [ ] Toda query a tabla RLS corre en `withOrgContext` con la org **resuelta** (la activa).
- [ ] Roles vía constantes de `access-policies` + helpers; recalculados por org al cambiar.
- [ ] Open/closed: tools nuevas se autoregistran (`@AnalyticsTool`), cero ediciones al registry/adapter.
- [ ] Toda tool declara `piiLevel` (`aggregate`).
- [ ] Sin comentarios en código; structured output con Zod de `@soe/types`.
- [ ] Tests junto al archivo; commit conventional en español por fase; PR con `create-pr`.

## Decisiones cerradas (2026-08-17)

1. **platform_admin**: **queda como está** — no tiene acceso a orgs, así que no puede usar el MCP; no
   se le agrega ningún path especial de multi-org. `set_active_org` le da 403 como a cualquier
   no-miembro. (Detalle en "Seguridad y consideraciones".)
2. **Persistencia**: **tabla dedicada `mcp_user_active_org`** (no columna en `users`) — separa el
   estado del canal MCP del modelo de usuario. Es el modelo de datos ya descrito arriba.
3. **G4 (override `org_id` por llamada)**: **extensión futura**, fuera del alcance de esta iniciativa.
   Se implementan G1–G3; G4 queda documentado por si aparece la necesidad.

**Diseño cerrado. Alcance a implementar: G1 → G2 → G3. Pendiente: arrancar a instrucción del usuario.**
