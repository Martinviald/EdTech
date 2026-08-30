# Plan de desarrollo — Lector de Marcas MVP (E22)

> Plan de ejecución con agentes del MVP diseñado en `docs/diseno-lector-de-marcas/`.
> El diseño define **qué** construir (21 componentes, olas O0–O4); este plan define **cómo
> ejecutarlo con subagentes en paralelo**, fase a fase, con contratos congelados y gates
> medibles entre fases. No re-litiga ninguna decisión D1–D18.

---

## Cómo leer este plan

- **Fase** = una corrida de orquestación con agentes. Cada fase tiene workstreams paralelos,
  un gate de salida y una decisión humana explícita (o ninguna, y se dice).
- Cada workstream declara **propiedad de archivos exacta**. Dos agentes nunca tocan el mismo
  archivo; los archivos compartidos (`app.module.ts`, `nav-items.ts`, `rls-policies.sql`,
  `schemas/index.ts`) se tocan sólo en Fase 0 (cimientos) o Fase 3 (integración).
- La metodología es la de la skill `sprint-parallel` (contratos → agentes en worktrees →
  auditoría → integración → validación E2E), adaptada: aquí los contratos se congelan **una
  sola vez** para todo el MVP (ola O0 del diseño), no por sprint.
- Mapa diseño → ejecución:

| Ola del diseño | Fase de este plan | Modo |
|---|---|---|
| O0 · Contratos + esqueleto | **Fase 0** | Secuencial (1 agente o main loop) |
| O1 · Papel (layout, impresión, diseñador) | **Fase 1** (workstreams A1, A2) | Paralelo |
| O2 · Visión Python | **Fase 1–2** (workstreams B1, B2) | Paralelo con O1 — no depende de él |
| O3 · Orquestación, identidad, cola | **Fase 1** (C1) + **Fase 2** (C2, C3, D1) | Paralelo |
| O4 · Conjunto de oro y medición | **Fase 4** | Humano + harness de agente |
| — Integración, auditoría, E2E | **Fase 3** | Secuencial + auditores paralelos |

La ganancia sobre el plan secuencial del diseño (10–11 semanas / 1 dev) viene de un hecho del
grafo de dependencias: **el servicio de visión (O2) sólo depende de los contratos de O0**, no
del backend de papel. Corre en paralelo desde el día dos. Y la orquestación (O3) se desarrolla
contra un `FakeOmrClient` — el puerto `OmrClient` existe exactamente para eso (C13) — así que
tampoco espera a la visión.

---

## Reglas de ejecución (todas las fases)

### Rama y worktrees

- Rama del épico: **`e22-lector-mvp`**, sale de `dev`, con worktree propio. Todas las fases
  commitean ahí. Merge a `dev` sólo con confirmación del usuario (al final o por fase).
- Los agentes corren con `Agent` + `isolation: "worktree"`. **Sus worktrees nacen de `main`,
  no de `e22-lector-mvp`** (lección S4). Todo prompt de agente empieza, textual, con:

```
SETUP (ejecutar PRIMERO, desde la raíz del repo de tu worktree):
1. git fetch origin && git merge e22-lector-mvp --no-edit   (o git reset --hard e22-lector-mvp si tu árbol está limpio)
   Verifica con `git log --oneline -3` que ves el commit de contratos E22.
2. pnpm install && pnpm --filter @soe/types build && pnpm --filter @soe/db build
3. Sólo entonces: lee docs/e22-lector-contracts.md COMPLETO y los docs de diseño que tu
   workstream indica. Después codea.
```

- Todo prompt termina, textual, con la instrucción de **commit obligatorio** (regla de oro de
  la skill: worktree sin commit = trabajo perdido).

### Recursos de la máquina (8 GB RAM)

La restricción global de "un proceso pesado a la vez" aplica también a los agentes:

- Cada agente corre **un solo** `npx tsc --noEmit` (o `pytest`), **al final** de su trabajo,
  no después de cada archivo.
- El orquestador lanza los agentes en un solo mensaje pero les indica en el prompt: antes de
  su verificación final, `pgrep -fl "tsc|vitest|jest|pytest"` y esperar si hay otro corriendo.
- `pnpm typecheck` completo del monorepo corre **una vez**, en integración (Fase 3), nunca en
  paralelo con otra cosa.
- El agente Python usa `opencv-python-headless` (no `opencv-python`) y crea su venv una sola vez.

### Calidad no negociable (heredada de CLAUDE.md y las rules)

- Toda query a las 6 tablas nuevas dentro de `withOrgContext(db, orgId, tx => …)` usando `tx`.
- Roles desde `packages/types/src/access-policies/sheet-scanning.ts` — nunca inline.
- Excepciones NestJS estándar; fallos esperados (calidad, hash, identidad) son **estado de
  dominio**, no excepciones, y no van a `reportServerError` (diseño §5.6).
- Tests junto al archivo (`*.spec.ts`), fake `Database` por constructor (patrón
  `heatmap.service.spec.ts`), helpers puros con tests directos (patrón
  `students-import.helpers.spec.ts`). Sin comentarios en el código.
- Frontend: shell primero + `<Suspense>` (rule 07), `canAccess()` en toda página, Models de
  `@soe/types` para tipar respuestas — nunca tipos locales duplicados.

---

## Fase 0 — Contratos y cimientos

**Modo: secuencial.** Es un sprint de infraestructura transversal: exactamente el caso donde
la propia skill dice que el método paralelo no aplica. Lo ejecuta un solo agente (o el main
loop) sobre `e22-lector-mvp`.

### Entregables

1. **Contratos en `packages/types`** — transcribir `03-contratos.md` a código:
   - `src/schemas/omr-layout.ts` (C1) y `src/schemas/omr-scan.ts` (C2), exportados en
     `schemas/index.ts`.
   - `src/utils/layout-hash.ts` (C3): serialización canónica (claves ordenadas recursivamente,
     números a 6 decimales) → SHA-256 → 16 hex. Tests de estabilidad ante reordenamiento.
   - `src/access-policies/sheet-scanning.ts` (C4): `SHEET_MANAGEMENT_ROLES` (diseñar,
     imprimir, escanear) y `SHEET_REVIEW_ROLES` (cola), re-exportadas en el index.
2. **Schema Drizzle + RLS** (C5–C10): `packages/db/src/schema/sheet-scanning.ts` con las 6
   tablas del diseño §3.5, migración generada con `pnpm db:generate`, y las 6 políticas
   añadidas a `packages/db/sql/rls-policies.sql` (D16 — no sólo en la migración).
3. **Puente de contrato TS → Python.** El servicio Python valida `LayoutSpec` y produce
   `ScanResult` sin duplicar los schemas a mano:
   - Dep nueva `zod-to-json-schema` en `packages/types` + script
     `pnpm --filter @soe/types gen:omr-contracts` que emite JSON Schema a
     `services/omr/contracts/{layout-spec,scan-result,read-request}.schema.json`.
   - Payloads de ejemplo en `services/omr/contracts/examples/`: un `LayoutSpec` de 2 páginas
     con ítems compuestos (`19.1`…`19.5`) y su `ScanResult` esperado. Test TS: los ejemplos
     parsean con Zod. Test Python: validan contra el JSON Schema. **Un solo origen de verdad,
     dos validadores.**
   - El `layoutHash` queda **sólo en TS**: lo verifica el backend (C14/C15), nunca el servicio
     de visión, que sólo devuelve el `raw` del QR.
4. **Esqueleto del servicio de visión** en `services/omr/`: FastAPI con `POST /v1/read` que
   valida el request contra el JSON Schema y responde un `ScanResult` sintético válido;
   `Dockerfile`; `pyproject.toml` (uv, pytest, ruff, opencv-python-headless); test de contrato.
5. **Esqueleto del módulo NestJS**: `apps/api/src/sheet-scanning/sheet-scanning.module.ts`
   vacío + `omr-client.types.ts` con el puerto `OmrClient`/`OMR_CLIENT` y un `FakeOmrClient`
   de test. El módulo NO se registra aún en `app.module.ts` (eso es Fase 3).
6. **`docs/e22-lector-contracts.md`** — el documento que todos los agentes leen. Contiene lo
   que el diseño no fija: la superficie REST exacta con response Models, por módulo:

| Verbo + ruta | Request | Response Model |
|---|---|---|
| `POST /sheet-layouts/derive` | `{ instrumentId }` | `LayoutDraftModel` (spec + `excludedItems[]`) |
| `POST /sheet-layouts` (freeze) | `{ spec }` | `{ layoutId, version, layoutHash }` |
| `GET /sheet-layouts/:id` · `GET /sheet-layouts?instrumentId=` | — | `SheetLayoutModel` / lista paginada |
| `POST /sheet-print-runs` | `{ layoutId, classGroupId, assessmentId, spareCount }` | `PrintRunModel` |
| `GET /sheet-print-runs/:id/pdf` | — | `application/pdf` |
| `POST /sheet-scan-batches` | `{ printRunId, captureProfile, sources[] }` | `{ batchId, uploadIntents[] }` |
| `POST /sheet-scan-batches/:id/start` | — | `202` |
| `GET /sheet-scan-batches/:id` | — | `BatchStatusModel` (polling; incluye contadores §5.6) |
| `GET /sheet-scan-batches/:id/review` | — | `ReviewQueueModel` (orden por daño, §C16) |
| `PATCH /sheet-scan-marks/:id` | `{ reviewedValue }` | `MarkModel` |
| `PATCH /sheet-scans/:id/identity` | `{ studentId }` | `ScanModel` |
| `PATCH /sheet-scans/:id/discard` | `{ reason }` | `ScanModel` |
| `POST /sheet-scan-batches/:id/confirm` | — | `ConfirmResultModel` |

   (Nombres finales y shapes completos se fijan en la Fase 0 misma; esta tabla es el borrador
   de partida.) El doc incluye además: convenciones, archivos compartidos que NO tocar,
   propiedad de archivos por workstream (las tablas de las Fases 1–2 de este plan), y el
   bloque SETUP.

### Decisiones técnicas que esta fase cierra (con recomendación)

| Decisión | Recomendación | Por qué |
|---|---|---|
| Tooling Python | `uv` + `pytest` + `ruff`, versiones pinneadas | Instalación rápida, sin deps de sistema |
| Rasterizar PDF en Python | `pypdfium2` | Wheel puro, sin poppler |
| Decodificar QR en Python | `zxing-cpp` (wheel); probar `cv2.QRCodeDetector` como alternativa sin dep extra | pyzbar exige zbar del sistema |
| Generar QR en el PDF (TS) | `qrcode` npm → PNG embebido con `pdf-lib` | pdf-lib no dibuja QR |
| PDF en backend | `pdf-lib` (D-dependencias del diseño) | Ya decidido en el diseño |
| JSON Schema desde Zod | `zod-to-json-schema` | Un origen de verdad para dos lenguajes |

### Gate de salida F0 (mecánico + 1 decisión humana)

- `pnpm typecheck` y tests de `@soe/types` / `@soe/db` verdes; migración aplica en local;
  políticas RLS presentes en `rls-policies.sql`.
- `docker build` + `docker run` del servicio y `curl POST /v1/read` con el ejemplo → `200`
  con `ScanResult` válido.
- **Decisión humana: congelar.** El usuario revisa `e22-lector-contracts.md` y los schemas.
  Después de este punto, cambiar un contrato es una excepción explícita que reabre la fase,
  no un ajuste silencioso. (Es la contramedida a "los peores bugs quedan ENTRE tareas".)

**Estimación: 1 sesión de orquestación.**

---

## Fase 1 — Papel ∥ Visión ∥ Adaptadores (4 agentes en paralelo)

Todos parten de los contratos congelados. Ninguno toca archivos de otro.

### A1 · Backend de papel — layout e impresión

- **Propiedad:** `apps/api/src/sheet-scanning/sheet-layout.service.ts`, `sheet-layout.helpers.ts`,
  `sheet-print.service.ts`, `sheet-layouts.controller.ts`, `sheet-print-runs.controller.ts`,
  `dto/` propios, specs junto a cada archivo. Dep nueva: `pdf-lib`, `qrcode` (en `apps/api`).
- **Lee:** diseño C11, C12, §3.1, §3.2; contrato REST.
- **Tickets:**
  - [ ] T1 `sheet-layout.helpers.ts`: derivación pura ítems → `LayoutDraft` (columnas de N
        burbujas, filtro por tipos soportados, `excludedItems` explícito). Tests directos.
  - [ ] T2 `SheetLayoutService`: `deriveDraft` / `freeze` (valida los 7 invariantes de §3.1,
        `BadRequestException` con el invariante violado) / `getFrozen`. Versionado: editar =
        fila nueva `version + 1`, nunca update.
  - [ ] T3 `SheetPrintService.createRun`: crea `sheet_print_runs` + una `printed_sheets` por
        alumno del curso + `spareCount` reservas (`studentId` null, G8), transaccional en
        `withOrgContext`.
  - [ ] T4 `SheetPrintService.renderPdf`: fiduciales, marcas de sincronía, burbujas con letra,
        QR `academos:v1:<sheetId>:<hash>:<page>:<pages>` (corrección M), nombre y curso arriba.
        **Coordenadas: sólo del spec — el servicio expone su "draw plan" (coordenadas absolutas
        calculadas por hoja) para el test de ida y vuelta.**
  - [ ] T5 Controllers + guards (`SHEET_MANAGEMENT_ROLES`) + tests (≥8 por service).
- **Criterios de aceptación:** invariantes §3.1 con test cada uno; PDF de una tirada de curso
  con reservas se genera sin error; draw plan ↔ spec verificado por test (centro de cada
  burbuja dentro de tolerancia); RLS/`withOrgContext` en toda query; `tsc --noEmit` limpio.

### A2 · Frontend de papel — diseñador y tirada

- **Propiedad:** `apps/web/src/app/(dashboard)/hojas/[instrumentId]/disenar/**`,
  `apps/web/src/app/(dashboard)/hojas/[layoutId]/imprimir/**` (páginas, componentes locales,
  `actions.ts`, `loading.tsx`). NO toca `nav-items.ts`.
- **Lee:** diseño §4.1 (vistas), archetypes rules 03/07; contrato REST.
- **Tickets:**
  - [ ] T1 Diseñador: preview del `LayoutDraft` (SVG/canvas de la hoja con burbujas según el
        spec — misma matemática de coordenadas 0–1), lista de `excludedItems` visible, acción
        congelar con confirmación (es irreversible).
  - [ ] T2 Tirada: elegir curso + `spareCount`, crear run, descargar PDF, historial de tiradas.
  - [ ] T3 Gates de rol + estados de carga (shell + Suspense) + toasts patrón 01.
- **Criterios:** tipa con Models del contrato; Server Components por defecto; funciona contra
  el backend de A1 (mismo contrato, sin coordinación directa); `tsc --noEmit` limpio.

### B1 · Servicio de visión — pipeline completo

El workstream más largo y de mayor riesgo técnico: arranca primero, en paralelo total.

- **Propiedad:** `services/omr/**` (todo el directorio salvo `contracts/`, que es generado).
- **Lee:** diseño C18–C21, D2, D7, D8, §3.3, §3.4.
- **Tickets:**
  - [ ] T1 Generador sintético de fixtures: dibuja una hoja desde un `LayoutSpec` (fiduciales,
        burbujas, QR) y la perturba: rotación ±5°, perspectiva, blur, sombra diagonal, ruido,
        escala. Cada fixture con su `ScanResult` esperado. **Es la base de test de todo el
        pipeline y del gate F1.**
  - [ ] T2 `PageSource` (D3): `PdfPageSource` (pypdfium2, DPI fijo) + `ImagePageSource`
        (orientación EXIF).
  - [ ] T3 `Rectifier` (C19): detección de fiduciales de esquina + homografía. <4 fiduciales ⇒
        `FiducialFailure`, nunca lectura sin rectificar.
  - [ ] T4 `QualityGate` (C20): laplaciano, glare, fiduciales, recorte, separabilidad; umbrales
        desde `CaptureProfile` (datos, no código).
  - [ ] T5 `MarkClassifier` (C21): fill por burbuja, Otsu sobre los fills de la página, banda
        `margin < 0.25` ⇒ `ambiguous`, ≥2 sobre umbral ⇒ `multiple`, sin 2 grupos separables ⇒
        **página rechazada** (`no_separable_marks`), jamás leída como todo en blanco.
  - [ ] T6 `BubbleGroupReader` + registro `READERS` (D10), lectura de QR, ensamblado del
        `ScanResult`, recortes de evidencia subidos a las presigned URLs del request (D11).
  - [ ] T7 Endpoint `/v1/read` completo: descarga por URL firmada, códigos 422/502/504 del
        contrato, tiempo límite por página.
- **Criterios:** suite sintética verde incluyendo los casos que rompen el método (página en
  blanco → rechazo; doble marca → `multiple`; marca a medio borrar → `ambiguous`); el
  `QualityGate` corre dentro del servicio y su veredicto viaja en la respuesta; el servicio
  no conoce `orgId` ni toca DB (§5.4); `pytest` + `ruff` verdes.

### C1 · Adaptador e identidad

- **Propiedad:** `apps/api/src/sheet-scanning/scan-result.adapter.ts` + spec,
  `apps/api/src/sheet-scanning/identity/**` (interfaz, `QrIdentityResolver`,
  `ManualIdentityResolver`, specs).
- **Lee:** diseño C15, C17, §3.6, G2, G8.
- **Tickets:**
  - [ ] T1 `scan-result.adapter.ts`: función pura `toParserResult` con la tabla de conversión
        §3.6 exacta (clave = `printedNumber`, `reviewedValue ?? value`, errores `ambiguous_mark`).
        Tests con objetos literales — el mejor ratio riesgo/esfuerzo del módulo.
  - [ ] T2 Interfaz `SheetIdentityResolver` + `IdentityCandidate` (candidato + confianza,
        nunca identidad cerrada).
  - [ ] T3 `QrIdentityResolver` con la tabla de chequeos de C15: prefijo, pertenencia a la org,
        **verificación de `layoutHash` → señal de rechazo de lote** (la consume C2), `pageIndex`
        válido, hoja de reserva → cola manual. Fake `Database` por constructor.
  - [ ] T4 `ManualIdentityResolver` (reservas y QR ilegible).
- **Criterios:** el adaptador reproduce byte a byte el `ParserResult` que esperan
  `student-matcher.ts` y `composite-answers.ts` (test con un caso de sub-ítems `19.1`…`19.5`);
  ningún resolver lanza excepción por identidad no resuelta — devuelve candidato con
  `needsHumanConfirmation`.

### Gate de salida F1 (mecánico)

- Los 4 agentes commitearon; auditoría ligera de contratos (¿los shapes coinciden?); merge de
  los 4 a `e22-lector-mvp`; `pnpm typecheck` + tests TS + `pytest` verdes en la rama.
- Demo parcial: un PDF real de una tirada descargable desde la UI; el servicio Python lee sus
  fixtures sintéticos con `ScanResult` correcto.

**Estimación: 1–2 sesiones (B1 marca el largo del camino).**

---

## Fase 2 — Orquestación ∥ Cola ∥ Hardening (4 agentes en paralelo)

### C2 · `SheetScanService` + `OmrClient` HTTP + endpoints de lote

- **Propiedad:** `sheet-scan.service.ts`, `omr-http.client.ts`, `sheet-scan-batches.controller.ts`,
  dto y specs propios.
- **Lee:** diseño C13, C14, §5.2 (máquina de estados), §5.3 (transaccional por página), D12, D13.
- **Tickets:**
  - [ ] T1 `createBatch`: valida tirada, crea batch `pending`, emite upload intents vía módulo
        `files` (`owner_type='sheet_scan'`, D15).
  - [ ] T2 `HttpOmrClient`: presigned URLs de lectura y de escritura de recortes, timeout por
        página, un reintento ante 502; implementa el puerto de Fase 0.
  - [ ] T3 El job (vía `JobDispatcher` existente): los 5 pasos de C14 en orden. Hash distinto ⇒
        lote entero `rejected` con motivo exacto (G1) — nunca corrección parcial. Idempotencia
        D13 (`superseded`, nunca borrado). **Persistencia por página** en su propio
        `withOrgContext`, no por lote.
  - [ ] T4 Máquina de estados §5.2 completa, incluido `failed` reintentable sin re-subir, y
        página faltante en multipágina = escaneo incompleto explícito, jamás blanks (G3).
  - [ ] T5 `getBatch` para polling con los contadores de §5.6.
- **Criterios:** tests con `FakeOmrClient` cubriendo: lote feliz, hash rechazado, página con
  `quality.ok=false`, re-escaneo idempotente, caída del servicio a mitad de lote (recuperable).
  Fallos esperados = estado de dominio; sólo el `catch` del job llama a `reportServerError`
  con `{ batchId, orgId, userId }`.

### C3 · `ScanReviewService` + confirmación

- **Propiedad:** `scan-review.service.ts`, `scan-review.controller.ts`, dto y specs propios.
- **Lee:** diseño C16, G6, §3.6; regla 05-rbac.
- **Tickets:**
  - [ ] T1 `getQueue`: orden por daño — calidad primero (el profesor aún tiene las hojas),
        identidades después, marcas por `margin` ascendente.
  - [ ] T2 `resolveMark` / `assignIdentity` / `discardScan`: escriben `reviewedValue` /
        reasignación auditada con autor — `value` de la máquina jamás se sobrescribe (§8.3).
  - [ ] T3 `confirmBatch`: adapter (C1) → `student-matcher` → `persistAssessmentResults`
        existentes, **sin modificarlos** (D9). Confirmar con ambiguas pendientes está permitido
        y queda registrado como decisión humana con autor.
  - [ ] T4 Guards: `SHEET_REVIEW_ROLES` + `SensitiveDataGuard` (la vista muestra el nombre del
        alumno).
- **Criterios:** desde la confirmación, el flujo es idéntico al de un CSV de GradeCam — test
  que verifica que `responses` y resultados aparecen por el camino existente sin tocar nada
  aguas abajo.

### D1 · Frontend de escaneo — subida y cola de revisión

- **Propiedad:** `apps/web/src/app/(dashboard)/hojas/escanear/**`,
  `apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/**`.
- **Lee:** diseño C16 (interacción), §5.2; rules 01 (toasts), 06 (TanStack Query para polling),
  07 (reactividad).
- **Tickets:**
  - [ ] T1 Subida: seleccionar tirada + perfil de captura, subir a S3 por presigned URL,
        iniciar y seguir el lote con `useQuery` + `refetchInterval` condicional al estado
        (patrón `use-remedial-status`).
  - [ ] T2 Cola de revisión: **recorte a la izquierda, alternativas a la derecha, resolución
        con una tecla** (teclas de alternativa, blanco, saltar). Secciones en orden de daño.
        Cincuenta marcas dudosas en pocos minutos o el módulo muere — es la vista que decide
        el producto.
  - [ ] T3 Estados terminales: `rejected` con el motivo exacto y qué hacer (reimprimir /
        corregir instrumento); `failed` con reintento sin re-subir.
  - [ ] T4 Confirmar lote con resumen de pendientes asumidos.
- **Criterios:** navegable por teclado; polling se detiene en estados terminales; sin tipos
  locales que dupliquen Models.

### B2 · Hardening del clasificador

- **Propiedad:** `services/omr/**` (continúa sobre lo de B1 — mismo workstream, sin conflicto
  con TS).
- **Tickets:**
  - [ ] T1 Ampliar fixtures con el catálogo sucio real de `FORMATO-GRADECAM.md` (~2.700
        escaneos de producción documentados): doble burbuja, borrones, hoja arrugada, sombra
        diagonal, subexposición.
  - [ ] T2 Afinar `CaptureProfile` de escáner vs celular (datos, no código).
  - [ ] T3 Métricas internas por página (distribución de fills, separación de grupos) en la
        respuesta de debug, para diagnosticar O4.
- **Criterios:** cero regresiones en la suite de B1; cada fixture nuevo con su etiqueta esperada.

### Gate de salida F2 (mecánico)

Merge de los 4; typecheck + tests + pytest verdes; smoke local: crear lote con imágenes
sintéticas de B1 contra el servicio real en Docker → lote llega a `needs_review` → se
resuelven marcas → `confirmed` → los resultados aparecen vía el camino existente.

**Estimación: 1–2 sesiones.**

---

## Fase 3 — Integración, auditoría y E2E

**Modo: secuencial en el main loop + 2 auditores paralelos (read-only, sin worktree).**

1. **Cableado de archivos compartidos** (sólo aquí se tocan): registrar
   `SheetScanningModule` en `app.module.ts`; rutas `/hojas` en `nav-items.ts` con roles de
   `access-policies`; `sst.config.ts` con el contenedor ECR del servicio de visión (patrón del
   backend existente); variables `.env.example` (`OMR_SERVICE_URL`, timeout).
2. **El test de ida y vuelta impresión ↔ lectura** — el gate de oro contra la deriva entre los
   tres consumidores del spec (riesgo #5 del diseño). Guion automatizado:
   - `SheetPrintService` genera el PDF real de una tirada de prueba.
   - Un script rellena burbujas según una pauta conocida dibujando en el **espacio del PDF con
     las coordenadas absolutas del draw plan del impresor** (no las del lector).
   - El PDF rellenado se rasteriza y entra por `POST /v1/read` del servicio real.
   - El `ScanResult` debe recuperar la pauta exacta vía fiduciales + homografía — dos
     implementaciones independientes de la misma geometría verificándose mutuamente.
   - Variantes: rotado, escalado 90% ("ajustar a página" — D7), foto simulada.
   Verde = impresor y lector calzan. Corre en CI si el runner soporta Python; si no, script
   documentado y obligatorio en el gate.
3. **Auditoría** (2 agentes paralelos): checklists estándar de la skill (contratos, shapes,
   multi-tenancy, roles, N+1, tests, paginación / type-safety, guards, server-vs-client…)
   más los checks específicos del módulo:
   - ¿Toda query a las 6 tablas corre en `withOrgContext` con `tx`?
   - ¿El camino del hash distinto rechaza el **lote completo** y ningún dato parcial persiste?
   - ¿`blank` y "no escaneado" siguen separados de punta a punta (G3)? ¿Una página faltante
     puede llegar a `responses` como blanco? (debe ser imposible)
   - ¿`value` de máquina jamás se sobrescribe (§8.3)? ¿Toda corrección tiene autor?
   - ¿El servicio Python quedó sin conocimiento de tenants ni DB (§5.4)?
   - ¿Los fallos esperados evitan `reportServerError` y los inesperados lo llaman con contexto?
4. **Fixes de auditoría** (directos si son simples; con el usuario si son de diseño).
5. **Validación E2E** con los tres procesos arriba (api + web + omr en Docker): flujo completo
   de las 11 etapas de §5.1 con datos de seed, incluidos los modos de falla G1 (hash), G3
   (página faltante) y G8 (hoja de reserva → asignación manual).
6. **Guía de testing manual**: `docs/Sprints/E22-MVP-testing-guide.md`.

### Gate de salida F3 (mecánico + decisión humana)

- Ida y vuelta verde en sus 4 variantes; E2E de 11 etapas verde; `pnpm typecheck`, `pnpm lint`,
  tests, `pytest` verdes.
- **Decisión humana:** smoke test manual de la cola de revisión (velocidad y teclas — el
  criterio es UX, no funcional) y decisión de merge de `e22-lector-mvp` a `dev`.

**Estimación: 1–2 sesiones.**

---

## Fase 4 — Conjunto de oro y medición (O4)

La única fase donde el trabajo crítico **no lo pueden hacer agentes**: imprimir en impresoras
reales, rendir/simular hojas con lápiz, escanear y fotografiar, transcribir a mano con doble
verificación. Sin esto el MVP es una demo (G5).

### Trabajo de agentes (1 sesión, en paralelo con el trabajo físico)

- **Harness de medición** en `services/omr/goldset/`:
  - Formato del conjunto: un directorio por hoja — imagen(es) + `truth.json` (transcripción +
    metadatos de corte: escáner/celular/condición) + el `LayoutSpec` usado.
  - Validador de `truth.json` (completitud contra el spec, doble transcripción coincidente).
  - Runner: corre las 300 hojas por el servicio, cruza contra la verdad y publica las tres
    cifras del criterio en un reporte versionado:

| Métrica | Umbral |
|---|---|
| Marcas leídas correctamente | ≥ 99,0 % |
| Marcas enviadas a revisión | ≤ 3 % |
| **Incorrectas decididas con confianza alta** | **0** |

  - Desglose por corte (escáner / celular bueno / celular malo / sucias deliberadas) y por
    `rejectReason`, para distinguir "el colegio escanea mal" de "el lector falla".
- **Herramienta de transcripción**: CLI o página mínima que muestre la hoja y capture la
  transcripción dos veces — para que las ~300 transcripciones no se hagan en un Excel a mano.

### Trabajo humano (el usuario coordina)

Composición del diseño: 100 escáner ADF + 100 celular bueno + 50 celular malo + 50 sucias
deliberadas. Cada hoja transcrita por dos personas.

### Cierre del MVP

- Si las tres cifras pasan → MVP validado; publicar el reporte junto al diseño.
- Si la tercera cifra falla (>0 errores confiados) → **no aprueba aunque la precisión sea
  99,5%**: el clasificador no sabe cuándo no sabe. Vuelve a B2 (banda, umbral, calibración
  del 0.25 — que el diseño declara hipótesis) e itera con la evidencia D11 acumulada.
- Retro del épico + decisión de arranque de v1 (los 7 incrementos ya tienen su punto de
  extensión abierto; ninguno toca el pipeline).

---

## Resumen de fases y gates

| Fase | Agentes | Paralelo con | Gate mecánico | Decisión humana |
|---|---|---|---|---|
| F0 Cimientos | 1 (secuencial) | — | typecheck, servicio responde, RLS presente | **Congelar contratos** |
| F1 Papel ∥ Visión | A1, A2, B1, C1 | — | tests 4 workstreams + merge + PDF demo + fixtures sintéticos | — |
| F2 Orquestación | C2, C3, D1, B2 | — | smoke lote sintético end-to-end | — |
| F3 Integración | main + 2 auditores | — | ida-y-vuelta ×4, E2E 11 etapas, auditoría | UX de la cola + merge a `dev` |
| F4 Oro | 1 (harness) | trabajo físico humano | las 3 cifras publicadas | Veredicto del criterio |

**Estimación total: 5–8 sesiones de orquestación + el tiempo físico de F4.** (El diseño estimaba
6–8 semanas de un dev para el MVP demostrable; F0–F3 con agentes comprime la parte de código a
~1–2 semanas calendario; F4 sigue mandando el ritmo del papel.)

## Cómo se lanza cada fase (operación autónoma)

Cada fase es una instrucción al orquestador en este workspace (o uno nuevo por fase):

> "Ejecutá la Fase N de `docs/plan-desarrollo-lector-de-marcas.md`."

El orquestador: verifica el gate de la fase anterior sobre `e22-lector-mvp` → lanza los
agentes de la fase en un solo mensaje (worktrees aislados, prompts con SETUP + tickets +
criterios + commit obligatorio, respetando la regla de un proceso pesado a la vez) → espera →
audita → mergea a `e22-lector-mvp` → corre el gate → reporta y se detiene **sólo** en las
decisiones humanas marcadas. Las fases con decisión humana (F0, F3, F4) terminan en un reporte
y una pregunta concreta; las demás pueden encadenarse.

## Riesgos de ejecución (además de los del diseño §06)

| Riesgo | Mitigación en este plan |
|---|---|
| Deriva TS ↔ Python del contrato | JSON Schema **generado** desde Zod + ejemplos validados en ambos lados (F0.3); prohibido escribir schemas Python a mano |
| Dos agentes en `sheet-scanning/` chocan | Propiedad de archivos explícita por workstream en el doc de contratos; module wiring sólo en F3 |
| Worktrees de agentes nacen de `main` | Bloque SETUP textual al inicio de cada prompt |
| 4 typechecks paralelos en 8 GB | Un `tsc`/`pytest` por agente, al final, con `pgrep` previo; typecheck global sólo en integración |
| El impresor y el lector calzan en sintético pero no en papel | El gate F3 cubre geometría; F4 cubre física. No se declara MVP sin F4 |
| B1 se atasca (el workstream difícil) | Arranca en F1 y continúa en F2 (B2); el resto del sistema avanza contra `FakeOmrClient` sin esperarlo |
| Agente no commitea | Instrucción textual obligatoria (regla de oro de la skill) |
