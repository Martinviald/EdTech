# Diseño — Captura remota con teléfono (E22-R, handoff QR)

> Extensión del lector de marcas (E22): quien gestiona el lote desde un PC puede
> escanear las hojas con la cámara de su teléfono **sin iniciar sesión en el móvil**,
> emparejando ambos dispositivos con un QR que aparece en la pantalla del PC. Las
> fotos pasan por el mismo gate de calidad de CD-11 en el momento de la captura y
> aparecen en vivo en el PC. Este documento cierra el diseño; el plan de ejecución
> vive en `docs/plan-desarrollo-captura-remota.md`. Las decisiones CR-1..CR-8 de la
> §11 se congelan en `docs/e22-lector-contracts.md` (como CD-16+) en la Fase R0.

---

## 1. Problema y objetivo

Hoy la cámara del lector solo existe dentro de la sesión autenticada del navegador
(`CameraCaptureSection`, detrás del radio "Celular" en `/hojas/escanear`). En la
práctica el flujo real de un colegio es: la coordinadora arma el lote en el PC de
la sala de profesores, y la cámara buena está en su teléfono — donde su cuenta SSO
del colegio probablemente no está logueada. Forzar el login en el móvil mata la
fluidez; usar la webcam del PC para fotografiar hojas no es viable.

**Objetivo:** que el paso "PC → teléfono" cueste un solo gesto (escanear un QR), y
que la experiencia en el teléfono sea capturar → veredicto en <1s → siguiente hoja,
mientras el PC muestra el progreso en vivo.

## 2. Flujo ideal

```
PC (autenticado)                              Teléfono (SIN login)
────────────────                              ────────────────────
1. En /hojas/escanear elige la tirada
   y pulsa "Escanear con el teléfono"
2. Backend crea capture_session + lote
   (pending) → devuelve QR
3. Muestra QR + "Esperando teléfono…"  ─scan─▶ 4. Abre /hojas/movil/<sid>#<secreto>
                                                  (vista mínima, sin app shell)
                                               5. Canjea el secreto → token de
                                                  capacidad (scope: este lote)
                                               6. Ve "Lenguaje 3°B — 28 hojas"
                                               7. Captura con la cámara:
                                                  ├─ gate CD-11 por foto (<1s)
                                                  ├─ rechazada → motivo + repetir
                                                  └─ aceptada → sube directo a S3
8. Live view (polling): contador,      ◀─────── cada foto aceptada se agrega al
   identidades leídas (RUT/QR), avisos            lote (sourceFileIds)
9. "Terminar y procesar" (en PC o teléfono)
   → start → /v1/read → cola de revisión
```

## 3. Qué se reutiliza y qué es nuevo

| Pieza | Estado |
|---|---|
| Gate de calidad por foto (`/v1/assess`, CD-11) | **Se reutiliza intacto — `services/omr/**` no se toca en absoluto** |
| Captura, compresión JPEG, fallback sin cámara (`useCameraCapture`, `CameraCaptureSection`) | Se reutiliza con un refactor chico (transporte inyectable, §8) |
| Upload por presigned URL + confirm (`FilesService.createUploadIntent`) | Se reutiliza |
| Modelo de lote (`sheet_scan_batches.sourceFileIds` poblado post-creación) | Se reutiliza — ya tolera agregar archivos de a uno |
| Pipeline de lectura, cola de revisión, confirm | Se reutilizan sin cambios |
| Tabla `capture_sessions` + política RLS | **Nuevo** |
| Token de capacidad + `CaptureSessionGuard` + controller `sheet-capture` | **Nuevo** |
| Ruta pública móvil `/hojas/movil/[sessionId]` | **Nuevo** |
| Launcher QR + live view con polling en el PC | **Nuevo** |

## 4. Modelo de datos — `capture_sessions`

Tabla nueva en `packages/db/src/schema/sheet-scanning.ts` (mismo dominio):

```
capture_sessions
  id            uuid PK defaultRandom
  org_id        uuid NOT NULL            ← multi-tenant, entra a RLS
  print_run_id  uuid NOT NULL FK sheet_print_runs
  batch_id      uuid NOT NULL FK sheet_scan_batches
  created_by    uuid NOT NULL FK users
  status        enum: 'pending' | 'active' | 'closed' | 'revoked' | 'expired'
  secret_hash   text NOT NULL            ← sha256 del secreto del QR; el secreto
                                            en claro jamás se persiste
  redeem_count  integer NOT NULL DEFAULT 0
  expires_at    timestamp NOT NULL       ← creación + 15 min
  created_at / updated_at                ← convención estándar
```

- `status` pasa a `active` en el primer canje exitoso (el PC lo ve por polling y
  cambia "Esperando teléfono…" → live view).
- **RLS:** política nueva en `packages/db/sql/rls-policies.sql` (regla §5.2 de
  CLAUDE.md: tabla sensible nueva ⇒ política en ese archivo, no en la migración).
  Todas las queries van dentro de `withOrgContext`.
- El lote asociado se crea junto con la sesión, en estado `pending`, con
  `sourceFileIds: []` — reusa el insert de `createBatch` sin sources (CR-4).

## 5. Autenticación del teléfono — token de capacidad

Es el problema central del diseño. El teléfono **no** pasa por SSO ni por el
`AuthGuard` JWT. Tampoco se marcan rutas existentes como `@Public()`: se crea una
superficie propia, mínima y acotada.

1. **El QR** codifica `https://<app>/hojas/movil/<sessionId>#<secreto>`. El secreto
   (256 bits aleatorios, base64url) viaja en el *fragment* — no llega al servidor
   en la URL, no queda en logs de acceso ni en `Referer`.
2. **Canje:** la vista móvil hace `POST /sheet-capture/redeem { sessionId, secret }`
   (ruta `@Public()` a nivel `AuthGuard`). El backend compara `sha256(secret)` con
   `secret_hash` usando comparación de tiempo constante, verifica `expires_at` y
   `status ∈ {pending, active}`, incrementa `redeem_count` (máx. 3 — permite un
   segundo teléfono o una recarga de página, no una fuga masiva) y responde un
   **capture token**: JWT firmado con el secreto de la app, claims
   `{ sessionId, orgId, printRunId, batchId, scope: 'sheet-capture', exp = expires_at }`.
3. **`CaptureSessionGuard`** (nuevo, en `apps/api/src/sheet-scanning/`): valida el
   token del header `Authorization: Bearer`, exige `scope === 'sheet-capture'`,
   relee la fila de la sesión (estado no revocado/expirado) y deja
   `{ orgId, batchId, printRunId, sessionId }` en la request. Ninguna otra claim
   se acepta; un JWT de usuario normal no pasa este guard y viceversa.

**Blast radius si el QR se filtra:** agregar fotos a UN lote de UNA tirada, durante
≤15 minutos, revocable desde el PC con un clic. No lee datos de alumnos, no ve
otros lotes, no cruza orgs.

## 6. Superficie REST

Controller nuevo `sheet-capture.controller.ts` (todas las rutas `@Public()` frente
al `AuthGuard` global; las de captura protegidas por `CaptureSessionGuard`):

| Ruta | Guard | Qué hace |
|---|---|---|
| `POST /sheet-capture/redeem` | ninguno (el secreto ES la credencial) | Canjea secreto → capture token + metadatos de contexto (curso, instrumento, hojas esperadas) |
| `GET /sheet-capture/session` | CaptureSessionGuard | Estado de la sesión para el teléfono (sigue viva, capturas acumuladas) |
| `POST /sheet-capture/assess` | CaptureSessionGuard | Mismo body que `assess-capture` sin `printRunId` (sale del token); delega en `SheetScanService.assessCapture` |
| `POST /sheet-capture/upload-intent` | CaptureSessionGuard | Crea intent presigned (`ownerType: 'sheet_scan'`, `ownerId: batchId`) y agrega el fileId a `sourceFileIds` del lote |
| `POST /sheet-capture/files/:id/confirm` | CaptureSessionGuard | Confirma el archivo subido (delegando en `FilesService`, validando que el file pertenece al lote de la sesión) |
| `POST /sheet-capture/finish` | CaptureSessionGuard | Cierra la sesión y dispara `startProcessing` del lote |

Y en la superficie autenticada existente (`sheet-scan-batches` o controller propio
`sheet-capture-sessions`, decide R0 — recomendación: controller propio autenticado):

| Ruta | Roles | Qué hace |
|---|---|---|
| `POST /sheet-capture-sessions` | `SHEET_MANAGEMENT_ROLES` | Crea sesión + lote; responde `{ sessionId, secret, expiresAt, qrUrl }` (única vez que el secreto viaja) |
| `GET /sheet-capture-sessions/:id` | `SHEET_MANAGEMENT_ROLES` | Estado para el live view del PC: status, capturas (count + identidades leídas), lote |
| `POST /sheet-capture-sessions/:id/revoke` | `SHEET_MANAGEMENT_ROLES` | Revoca (el guard del teléfono empieza a responder 401) |

El teléfono **nunca** habla con el servicio de visión directamente (invariante del
MVP): todo pasa por la API, que ya inyecta calibración de la org y el token OMR.

## 7. Frontend PC — launcher y live view

En `ScanUploadForm`, cuando `source === 'phone'`, el toggle actual
"Subir fotos / Cámara" gana una tercera opción **"Con el teléfono"**:

1. Al activarla (con tirada elegida), llama `POST /sheet-capture-sessions` y
   muestra el QR (`qrcode.react`, componente client) + botones "Regenerar" y
   "Cancelar".
2. Un hook `useCaptureSession(sessionId)` — TanStack Query con `refetchInterval`
   2500 ms, mismo patrón que `useRemedialStatus` (regla `06-client-data-fetching.md`),
   query key factory colocada en `app/(dashboard)/hojas/hooks/` — pollea el estado:
   - `pending` → "Esperando el teléfono… escanea el QR".
   - `active` → live view: `N de M hojas capturadas` + badges de identidades
     leídas (mismo componente de badges que usa `CameraCaptureSection` hoy).
   - `closed` → redirige a la cola de revisión del lote (`SCAN_ROUTES.revisar`).
3. "Terminar y procesar" también existe en el PC (llama `revoke` + `start` vía la
   superficie autenticada) por si el teléfono se quedó sin batería a mitad.

Sin WebSockets ni SSE en esta fase: polling es el patrón establecido en F1 y el
intervalo de 2,5 s es imperceptible para este caso de uso.

## 8. Frontend móvil — ruta pública y transporte

**Ruta:** `apps/web/src/app/movil/hojas/[sessionId]/page.tsx` — fuera de
`(dashboard)` (sin sidebar, sin sesión). Requiere agregar `movil` a las
excepciones del `matcher` en `apps/web/src/middleware.ts` (hoy: `login`, `auth`,
`api`, `styleguide`).

**Vista:** client component mínimo. Al montar, lee el fragment (`location.hash`),
canjea el secreto, guarda el capture token **en memoria** (no localStorage: la
sesión dura 15 min y el token no debe sobrevivir al tab) y muestra el contexto
("Lenguaje 3°B — 28 hojas") + la cámara.

**Refactor de reuso (la única cirugía sobre código existente):** hoy
`useAssessCapture` y el flujo de upload llaman `api-client.ts`, que va al proxy
con cookie de sesión. Para reusar `CameraCaptureSection` en ambos mundos, sus
dependencias de red se extraen a un **transporte inyectable**:

```ts
type CaptureTransport = {
  assess(imageBase64: string): Promise<AssessCaptureResponse>;
  createUploadIntent(meta: SourceMeta): Promise<ScanUploadIntent>;
  confirmFile(fileId: string, sizeBytes: number): Promise<void>;
};
```

- Implementación autenticada: la actual (proxy + cookie) — el flujo del dashboard
  no cambia de comportamiento.
- Implementación de sesión: golpea `/sheet-capture/*` con el capture token en el
  header, vía el proxy genérico (`/api/proxy/...` reenvía headers) o fetch directo
  a la API pública — decide R0 (recomendación: proxy, para no exponer la URL de
  la API ni pelear con CORS).

La máquina de estados live/assessing/rejected, el encuadre, el fallback
`<input capture>` y las etiquetas de rechazo (`REJECT_REASON_LABELS`) se heredan
sin tocar. En el móvil, cada foto aceptada además ejecuta upload+confirm
inmediatamente (no espera un submit final como en el PC): así el PC la ve al
próximo poll y el teléfono puede morirse sin perder nada.

## 9. Cierre de sesión → lote

- "Terminar" (teléfono o PC) ⇒ sesión `closed` + `startProcessing(batchId)`. De
  ahí en adelante es el flujo estándar: `/v1/read`, `needs_review`, revisión,
  confirm.
- Sesión que expira o se revoca **con capturas ya subidas**: el lote queda
  `pending` con sus archivos — visible en "Lotes recientes" del PC, donde se puede
  iniciar el procesamiento manualmente. No se pierde trabajo.
- Sesión expirada **sin capturas**: un barrido (mismo script de retención de
  CD-14 o el propio `redeem`/`GET` al encontrarla vencida) marca `expired` y el
  lote vacío se elimina para no ensuciar el listado.

## 10. Seguridad (resumen operativo)

- Secreto de 256 bits, un solo viaje (respuesta de creación → QR → fragment);
  persistido solo como hash; comparación de tiempo constante.
- TTL 15 min, `redeem_count ≤ 3`, revocación inmediata desde el PC, regeneración
  de QR = revocar + crear sesión nueva.
- El capture token no es un JWT de usuario: scope propio, guard propio, sin roles,
  sin acceso a ningún otro recurso. `orgId` sale de la fila de la sesión — jamás
  del cliente (CLAUDE.md §11).
- Toda query dentro de `withOrgContext`; `capture_sessions` con política RLS.
- Sin PII en el QR ni en la URL. El contexto (curso/instrumento) se obtiene tras
  el canje, por el canal autenticado por token.
- Las fotos entran al pipeline con la retención de 180 días de CD-14, sin reglas
  nuevas.

## 11. Decisiones a congelar en R0 (CR-1..CR-8)

| ID | Decisión | Recomendación |
|---|---|---|
| **CR-1** | Schema `capture_sessions` | El de §4, con enum de status y política RLS en `rls-policies.sql` |
| **CR-2** | Canje y multi-dispositivo | Secreto en fragment, canje ilimitado en ventana pero `redeem_count ≤ 3`; cada canje emite token propio (permite 2 teléfonos o recarga de página) |
| **CR-3** | Formato del capture token | JWT firmado con el secreto existente de la app, claims de §5.2, `exp = expires_at` de la sesión; guard nuevo `CaptureSessionGuard` en el módulo sheet-scanning |
| **CR-4** | Momento de creación del lote | Junto con la sesión (`pending`, `sourceFileIds: []`); capturas se agregan de a una (append transaccional); cierre = `startProcessing` existente |
| **CR-5** | Ruta móvil y middleware | `/movil/hojas/[sessionId]` fuera de `(dashboard)`; excepción en el matcher; token en memoria, jamás en storage |
| **CR-6** | Transporte del móvil | Proxy genérico `/api/proxy` reenviando `Authorization` del capture token (verificar que el proxy no lo pise con la cookie; si la pisa, ruta de proxy dedicada) |
| **CR-7** | Sync del PC | Polling TanStack Query 2500 ms sobre `GET /sheet-capture-sessions/:id`; SSE explícitamente fuera de alcance |
| **CR-8** | Expiración y limpieza | TTL 15 min fijo (sin extensión en v1); barrido de sesiones vencidas + lotes vacíos; lote con capturas sobrevive como `pending` |

## 12. Fuera de alcance (declarado, no olvidado)

- SSE/WebSockets para el live view (el polling alcanza; SSE tiene patrón listo en
  `assistant` si algún día se necesita).
- App nativa o PWA instalable.
- Extender el TTL desde el teléfono ("seguir escaneando") — v2 si el E2E muestra
  que 15 min quedan cortos para cursos grandes.
- Aprobación explícita de emparejamiento desde el PC ("¿es este tu teléfono?") —
  el TTL corto + revocación cubren el riesgo en v1.

## 13. Gotchas conocidos

- **`getUserMedia` exige HTTPS** en el teléfono (no es localhost). Para el E2E de
  desarrollo hace falta un túnel (cloudflared/ngrok) o cert local; la guía de
  testing de R2 lo documenta paso a paso.
- El QR se renderiza client-side (`qrcode.react`); no enviar el secreto a ningún
  servicio externo de generación de QR.
- iOS Safari pausa `getUserMedia` al bloquear la pantalla: la vista móvil debe
  reactivar el stream en `visibilitychange` (el hook actual ya expone `start()`).
- El proxy genérico agrega la cookie de sesión: verificar orden de headers para
  que el capture token gane cuando está presente (CR-6).
