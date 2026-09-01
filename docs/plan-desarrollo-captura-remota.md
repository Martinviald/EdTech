# Plan de desarrollo — Captura remota con teléfono (E22-R)

> Plan de ejecución con agentes del handoff QR PC→teléfono diseñado en
> `docs/diseno-captura-remota-movil.md`. Misma metodología que
> `docs/plan-desarrollo-lector-v1.md`: contratos congelados primero, agentes en
> paralelo con propiedad de archivos exacta, gates medibles, integración explícita
> y auditoría adversarial al cierre. **`services/omr/**` no se toca en ningún
> momento**: el gate de calidad CD-11 se consume tal cual.

---

## Prerrequisitos

1. **PR #157 (V1) mergeada** — este trabajo extiende `assessCapture`,
   `CameraCaptureSection` y el modelo de lotes que entran con la V1. Rama nueva
   desde la base que corresponda al momento del merge (regla de oro: commits
   nuevos → rama nueva → PR nueva). Nombre sugerido: `e22-captura-remota`.
2. Decidir el numerado de migración disponible en `packages/db` al arrancar
   (verificar el journal; ya hubo que renumerar una vez).
3. Un túnel HTTPS utilizable para el E2E móvil (cloudflared o ngrok) — no bloquea
   el código, bloquea la verificación manual final.

## Dónde aportan valor los subagentes (y dónde no)

El criterio es el del resto de E22: paralelizar **solo** frentes con propiedad de
archivos disjunta y contratos congelados entre medio; todo lo que es decisión o
integración queda secuencial en el main loop.

| Trabajo | ¿Agente? | Por qué |
|---|---|---|
| Cerrar CR-1..CR-8 + types + migración | No (secuencial) | Son decisiones y un cambio chico encadenado; paralelizar no ahorra nada y arriesga contratos inconsistentes |
| Backend (sesiones + guard + endpoints) | Sí — **B-R1** | Frente autocontenido en `apps/api` + `packages/db`, testeable solo |
| Frontend móvil + refactor transporte | Sí — **F-R1** | Frente autocontenido; el refactor del transporte es la única cirugía compartida y queda de este lado con contrato de props congelado en R0 |
| Frontend PC (QR + live view) | Sí — **F-R2** | Frente autocontenido; consume los DTOs congelados y el `CaptureTransport` como interfaz, no su implementación |
| Integración + guía de testing | No (secuencial) | Cruza los tres frentes; es exactamente lo que no se delega |
| Auditoría adversarial | Sí — **A-R1** | Ojos frescos sin el sesgo del que construyó; ya encontró 3 blockers reales en la V1 |

Tres agentes constructores en una sola fase paralela + un auditor. No más: el
alcance total es ~2 controllers, 1 tabla, 1 guard, 2 vistas y 1 refactor — dividir
más fino agregaría coordinación, no velocidad.

## Reglas de ejecución

Idénticas al plan del MVP/V1 (léelas en `docs/plan-desarrollo-lector-de-marcas.md`):
worktrees desde `main` + bloque SETUP mergeando la rama de trabajo; **un proceso
pesado a la vez** (8 GB de RAM); commit obligatorio al cierre de cada agente; los
tests existentes de la V1 son piso de regresión intocable. Los contratos nuevos se
escriben como enmiendas CD-16+ en `docs/e22-lector-contracts.md` §9 y ningún agente
los reinterpreta.

---

## Fase R0 — Contratos (secuencial, 1 sesión, main loop)

Cierra CR-1..CR-8 (diseño §11) y congela todo lo que los agentes de R1 consumen.

### Entregables

1. `packages/types`: `sheet-capture.schema.ts` nuevo — DTOs de
   `CreateCaptureSessionDto/Response`, `RedeemCaptureDto/Response`,
   `CaptureSessionStatusModel`, DTOs token-scoped (assess/upload-intent/confirm/
   finish) y el tipo `CaptureTransport` compartido (props del refactor F-R1).
   Todos exportados desde `@soe/types`.
2. `packages/db`: tabla `capture_sessions` (+relations, +índice por
   `org_id, status, expires_at`), migración, y **política RLS en
   `packages/db/sql/rls-policies.sql`** (regla §5.2 — es tabla sensible nueva).
3. `docs/e22-lector-contracts.md`: sección E22-R con CD-16..CD-23 (mapeo 1:1 de
   CR-1..CR-8), superficie REST de ambos controllers y la tabla de propiedad de
   archivos de R1 (abajo).
4. Verificación de CR-6: prueba puntual de que el proxy genérico reenvía
   `Authorization` sin pisarlo con la cookie (si la pisa, la decisión cambia a
   proxy dedicado ANTES de congelar — es barato ahora y carísimo en R1).

**Gate R0:** typecheck + tests de types/db verdes + migración aplicada en local +
**sign-off humano de CD-16..CD-23** (única pausa de decisión del plan).

---

## Fase R1 — Backend ∥ Móvil ∥ PC (3 agentes en paralelo)

### B-R1 · Backend — sesiones, guard y superficie token-scoped

- **Propiedad:** `apps/api/src/sheet-scanning/capture-session.service.ts` (+spec),
  `capture-session.guard.ts` (+spec), `sheet-capture.controller.ts` (+spec),
  `sheet-capture-sessions.controller.ts` (+spec), registro en
  `sheet-scanning.module.ts`; `packages/types/src/access-policies/` si hace falta
  constante nueva (reusar `SHEET_MANAGEMENT_ROLES` si alcanza).
- **Tickets:** creación de sesión + lote `pending` en una transacción
  `withOrgContext`; secreto random 256 bits → hash sha256, respuesta única con el
  secreto en claro; canje con comparación de tiempo constante, `redeem_count ≤ 3`,
  emisión del capture token (CD-18); `CaptureSessionGuard` (valida firma, scope,
  relee la fila: revocada/expirada ⇒ 401); endpoints token-scoped delegando en
  `SheetScanService.assessCapture` y `FilesService` (el `orgId` sale SIEMPRE de la
  fila de sesión); append transaccional de fileId a `sourceFileIds`; `finish` ⇒
  sesión `closed` + `startProcessing`; `revoke`; barrido de vencidas (CD-23).
- **Criterios:** ≥15 tests nuevos (canje feliz, secreto malo, expirada, revocada,
  4º canje, token de usuario contra el guard, capture token contra rutas normales,
  append concurrente, finish idempotente, aislamiento org); regresión completa de
  sheet-scanning intacta; los specs siguen el patrón del repo (fake `Database`,
  sin DB viva).

### F-R1 · Frontend — vista móvil + refactor del transporte

- **Propiedad:** `apps/web/src/app/movil/hojas/[sessionId]/**` (page, layout
  mínimo, componentes), `apps/web/src/middleware.ts` (excepción del matcher),
  `apps/web/src/app/(dashboard)/hojas/hooks/use-camera-capture.ts` y
  `use-assess-capture.ts` (refactor a `CaptureTransport`),
  `CameraCaptureSection.tsx` (solo la inyección del transporte, cero cambios de
  comportamiento), `lib/capture-transport.ts` (las dos implementaciones).
- **Tickets:** canje al montar leyendo `location.hash` (token en memoria, jamás
  storage); pantalla de contexto ("Lenguaje 3°B — N hojas") + cámara reusada;
  upload+confirm inmediato por foto aceptada; estados de sesión vencida/revocada
  ("pídele un QR nuevo al PC"); botón "Terminar y procesar"; reactivación del
  stream en `visibilitychange` (iOS); textos en español neutro.
- **Criterios:** el flujo autenticado del dashboard queda **byte a byte igual**
  en comportamiento (misma UI, mismo transporte por defecto); typecheck limpio;
  la vista móvil no importa nada de `(dashboard)` salvo lo explícitamente
  compartido.

### F-R2 · Frontend — launcher QR y live view en el PC

- **Propiedad:** `apps/web/src/app/(dashboard)/hojas/escanear/RemoteCaptureSection.tsx`
  (+ integración en `ScanUploadForm.tsx`: tercera opción del toggle),
  `hooks/use-capture-session.ts` (+ query keys), `actions.ts` de sesiones
  (server actions create/revoke), dependencia `qrcode.react`.
- **Tickets:** crear sesión al activar el modo (tirada elegida obligatoria, mismo
  callout que la cámara actual); QR + expiración visible + "Regenerar" (revoca y
  crea) + "Cancelar"; polling 2500 ms (patrón `useRemedialStatus`); estados
  pending/active/closed con contador y badges de identidades; al cerrar,
  redirección a `SCAN_ROUTES.revisar(batchId)`; "Terminar y procesar" desde el PC.
- **Criterios:** ≥6 tests de la lógica de estados del hook; sin `useEffect` de
  fetch manual (TanStack Query); toggle actual de archivos/cámara intacto.

**Gate R1 (mecánico):** merge de los 3 + typecheck api/web/types + jest completo +
regresión V1 intacta + smoke: crear sesión por curl, canjear, assess con fixture,
upload, finish ⇒ lote procesando.

---

## Fase R2 — Integración, E2E y auditoría (secuencial + 1 auditor)

1. **Integración (main loop):** cablear puntas sueltas entre los 3 frentes,
   resolver diferencias de interpretación contra los contratos (los contratos
   ganan), pulir textos.
2. **Guía de testing manual** `docs/Sprints/E22-R-testing-guide.md`: setup del
   túnel HTTPS paso a paso (cloudflared), tabla de provocaciones (QR vencido, QR
   reusado 4 veces, revocar a mitad de captura, teléfono sin batería a mitad,
   foto borrosa/reflejo/recortada, 2 teléfonos a la vez, bloquear pantalla iOS),
   y el flujo feliz completo PC→teléfono→cola de revisión.
3. **A-R1 · Auditoría adversarial (1 agente):** foco en la superficie nueva de
   auth — ¿puede un capture token tocar otro lote/otra org? ¿el secreto queda en
   algún log? ¿el guard relee el estado o confía en el `exp`? ¿qué pasa con un
   append después de `finish`? ¿race entre revoke y upload en vuelo? Cada hallazgo
   real ⇒ fix + test de regresión antes del cierre.
4. **E2E manual del usuario** con la guía (requiere teléfono físico + túnel).

**Gate R2:** hallazgos de auditoría resueltos + E2E manual aprobado ⇒ PR lista.

---

## Resumen

| Fase | Agentes | Gate | Decisión humana |
|---|---|---|---|
| R0 Contratos | 0 (main loop) | typecheck + tests + migración | **Sign-off CD-16..CD-23** |
| R1 Construcción | 3 en paralelo (B-R1, F-R1, F-R2) | merge + regresión + smoke curl | — |
| R2 Cierre | main loop + 1 auditor (A-R1) | auditoría resuelta + E2E manual | Aprobar E2E |

## Riesgos específicos

- **El proxy y el header `Authorization` (CR-6):** si el proxy genérico pisa el
  header con la cookie de sesión, F-R1 queda bloqueado. Por eso se verifica en R0,
  antes de congelar — es el único acople técnico no confirmado del diseño.
- **HTTPS en desarrollo:** sin túnel no hay E2E móvil real. Mitigación: la guía lo
  resuelve en R2 y el smoke de R1 no lo necesita (curl contra la API).
- **Deriva del refactor de transporte:** F-R1 toca un componente que el flujo
  autenticado usa hoy. Mitigación: el contrato `CaptureTransport` se congela en R0
  y el criterio de F-R1 exige comportamiento idéntico en el dashboard.
- **Regenerar QR con capturas ya subidas:** revocar + crear sesión nueva crea
  también lote nuevo; las capturas viejas quedan en el lote anterior (`pending`).
  Es el comportamiento diseñado (nada se pierde), pero la guía de testing debe
  cubrirlo para que no sorprenda.

## Cómo se lanza

1. Mergear la PR #157 y crear `e22-captura-remota`.
2. Correr la Fase R0 en el main loop y pedir el sign-off de CD-16..CD-23.
3. Lanzar B-R1, F-R1 y F-R2 en paralelo (worktrees, bloque SETUP, propiedad de
   archivos de arriba).
4. Gate R1, luego R2 con el auditor, luego el E2E manual con el teléfono.
