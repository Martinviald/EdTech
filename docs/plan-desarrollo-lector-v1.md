# Plan de desarrollo — Lector de Marcas v1 (E22, sobre el MVP)

> Plan de ejecución con agentes de la **v1 productiva** del lector de marcas, sobre el MVP
> entregado en la PR #156. Los 7 incrementos vienen de `docs/diseno-lector-de-marcas/06-plan-mvp-v1.md`
> (§v1 productiva): **ninguno toca el pipeline** — todos entran por un punto de extensión
> que el MVP dejó abierto (D3, D4, D6, D8, D10, D11, D18). Misma metodología que
> `docs/plan-desarrollo-lector-de-marcas.md`: contratos congelados primero, agentes en
> paralelo con propiedad de archivos exacta, gates medibles, integración explícita.

---

## Prerrequisitos (antes de la Fase V0)

1. **PR #156 mergeada a `dev`** tras el E2E manual del usuario (guía:
   `docs/Sprints/E22-MVP-testing-guide.md`). La v1 se construye sobre `dev` con el MVP adentro.
2. **Rama nueva `e22-lector-v1` desde `dev`** — la PR del MVP está cerrada para trabajo
   nuevo una vez mergeada (regla de oro del repo: commits nuevos → rama nueva → PR nueva).
3. Si `dev` incorporó las migraciones de telemetría de `main`: renumerar
   `0021_fine_onslaught` ANTES de generar migraciones nuevas (ya se hizo una vez en un
   worktree: journal + snapshot encadenado).
4. **O4 (conjunto de oro físico) corre en paralelo, no bloquea el código** — pero la v1
   NO se declara productiva sin las 3 cifras aprobadas, y el incremento de calibración
   (V1·B1) consume su evidencia. El harness ya está en `services/omr/goldset/`.

## Los 7 incrementos y su fase

| Incremento (diseño §v1) | Entra por | Fase | Workstream |
|---|---|---|---|
| Campos numéricos en grilla | D10 · registrar `DigitGridReader` | V1 | P1 + F2 |
| Hoja genérica con RUT | D4 · `RutBubbleResolver` | V1 | P1 + B1 |
| Umbral calibrado por organización | D8 + D11 · evidencia acumulada | V1 | B1 |
| Captura desde el navegador | D3 · gate de calidad ANTES de aceptar la foto | V1 | P1 + F1 |
| Respuestas de desarrollo (LLM) | D10 · `CropRegionReader` + módulo `llm` | V2 | P1 + B2 |
| Formas múltiples (A/B) | D6 · layout versionado + `assessment_forms` | V2 | B3 + F2 |
| Endurecimiento operativo | — (retención D18, métricas, límites, deploy) | V2 | B4 |

Reuso verificado en el repo: `apps/api/src/llm/` (providers + `LlmAgentService`),
`assessment_forms` en `packages/db/src/schema/assessments.ts`, `responses.ai_score/human_score/final_score`
y `ai_grading_jobs` en `responses.ts`, `normalizeRut` en `@soe/types`.

## Reglas de ejecución

Idénticas al plan del MVP (léelas ahí): worktrees de agentes nacen de `main` → bloque
SETUP textual (mergeando **`e22-lector-v1`**); un proceso pesado a la vez (8 GB);
commit obligatorio; contratos en `docs/e22-lector-contracts.md` — la v1 los **extiende**
con enmiendas CD-8+ , jamás rompe los del MVP (el servicio y el backend del MVP deben
seguir pasando TODOS sus tests sin tocar: 123 backend + 84 pytest son el piso de regresión).

---

## Fase V0 — Contratos v1 (secuencial, 1 sesión)

Extiende los contratos congelados. Un solo agente (o main loop) sobre `e22-lector-v1`.

### Decisiones que esta fase cierra (con recomendación)

| ID | Decisión | Recomendación |
|---|---|---|
| **CD-8** | Geometría de `digit_grid` en `LayoutSpec` | `omrBubbleSchema` gana `group: z.number().int().nullable()` (= índice del dígito, 0 = más significativo); un campo `digit_grid` tiene `digitCount` implícito en el máximo `group`+1, burbujas con `value` '0'–'9' por dígito. El **valor del campo** = concatenación de los dígitos leídos (cada grupo es un mini bubble_group `single`). Un grupo sin marca clara ⇒ el campo entero `ambiguous` (jamás un número con un dígito inventado) |
| **CD-9** | Semántica de `crop_region` en `MarkReading` | `state: 'marked'`, `value: null`, `cropJpegBase64` SIEMPRE presente (es la respuesta). `fill/threshold/margin` en 0/0.5/1 fijos (no aplican). El adaptador NO lo mapea a `answers`: el confirm crea la respuesta de desarrollo por el camino `ai_grading_jobs` (V2·B2) |
| **CD-10** | Identidad `rut_bubbles` | La región identity contiene una `digit_grid` de RUT (cuerpo + DV como grupo final con '0'–'9'+'K'). `identity.raw` = dígitos concatenados leídos (`"12345678K"`), `confidence` = mínimo margin de los grupos, normalizado. El backend (`RutBubbleResolver`) valida DV con `normalizeRut` y busca en el roster — el servicio sigue sin interpretar |
| **CD-11** | Gate de calidad para cámara | Endpoint nuevo del servicio `POST /v1/assess` (subset de read: rectificación + QualityGate + QR, SIN clasificar, <1s) y endpoint backend `POST /sheet-scan-batches/assess-capture` que recibe la foto chica (base64/multipart, límite 4 MB), la reenvía al servicio y responde `PageQuality` + identidad. El navegador nunca habla directo con el servicio |
| **CD-12** | Calibración por organización | Sin migración: `organizations.config` (JSONB existente) gana `omrCalibration?: { ambiguityMargin?: number; minSeparability?: number }` validado por Zod en types. Se inyecta al servicio POR REQUEST: `captureProfileSchema` gana `ambiguityMargin: z.number().min(0.05).max(0.5).nullable()` — datos, no código (D2). El clasificador usa el del request o su default 0.25 |
| **CD-13** | Formas A/B | Un layout POR FORMA (el versionado D6 ya lo permite: `sheet_layouts.version` + hash distinto viaja en el QR). `sheet_print_runs` gana `assessment_form_id` nullable (FK a `assessment_forms`, migración chica); una tirada = una forma; el lote hereda la forma de su tirada y el hash-check G1 del MVP ya rechaza hojas de la forma equivocada sin código nuevo |
| **CD-14** | Retención de imágenes (D18) | `files` con `owner_type IN ('sheet_scan','sheet_scan_mark')` y `created_at > 180 días` → borrado S3 + soft-delete, vía script `pnpm --filter @soe/api retention:sheet-scans` (tsx) documentado para cron externo. Configurable por org en `config.omrRetentionDays` (default 180). El resultado corregido nunca se toca |

### Entregables

1. `packages/types`: enmiendas a `omr-layout.schema.ts` (CD-8 `group`, CD-12 `ambiguityMargin`),
   `omr-scan.schema.ts` (sin cambios de shape salvo doc CD-9/CD-10), `sheet-scanning.schema.ts`
   (DTOs nuevos: assess-capture, formas en `CreatePrintRunDto`, calibración en org settings),
   schema Zod de `omrCalibration`. **Compatibilidad: todos los campos nuevos nullable/optional
   — los specs congelados del MVP siguen validando.**
2. `packages/db`: migración `sheet_print_runs.assessment_form_id` (+ índice). Nada más.
3. Regenerar JSON Schemas (`gen:omr-contracts`) + ejemplos nuevos (digit_grid, rut_bubbles)
   validados por jest y pytest.
4. `docs/e22-lector-contracts.md`: sección v1 con CD-8..CD-14, superficie REST nueva
   (`POST /sheet-scan-batches/assess-capture`, `GET/PATCH /organizations/me/omr-calibration`),
   y las tablas de propiedad de archivos de V1/V2 (abajo).
5. `layoutHash`: verificar que los specs v1 (con `group`) hashean estable — test.

**Gate V0:** typecheck + tests types/db + pytest de contrato verdes; **sign-off humano de
las enmiendas** (única pausa de decisión de la fase).

---

## Fase V1 — Lectores ∥ Identidad genérica ∥ Cámara ∥ Calibración (4 agentes)

### P1 · Python — lectores nuevos y assess

- **Propiedad:** `services/omr/**` (contratos generados intocables).
- **Tickets:** `DigitGridReader` registrado en `READERS` (CD-8: por grupo un mini-cluster
  single; campo ambiguous si CUALQUIER grupo duda — jamás un dígito inventado);
  `CropRegionReader` (CD-9: recorte JPEG de la región, siempre); lectura de grilla RUT en
  la región identity cuando `identity.mode === 'rut_bubbles'` (CD-10);
  `POST /v1/assess` (CD-11: rectificar + calidad + QR, sin clasificar, presupuesto <1s);
  `ambiguityMargin` del CaptureProfile reemplaza la constante (CD-12) con default 0.25;
  fixtures sintéticos nuevos: grillas numéricas (limpia, dígito doble, dígito vacío,
  columna corrida), RUT con DV, crop region. Extender `synthetic.py` y el goldset-ready.
- **Criterios:** los 84 tests del MVP intactos; ≥15 tests nuevos; el principio rector
  se mantiene (ante la duda, dudar); ruff limpio.

### B1 · Backend — hoja genérica con RUT + calibración

- **Propiedad:** `identity/rut-bubble.resolver.ts` (+spec), `sheet-layout.helpers.ts`/
  `sheet-layout.service.ts` (extender derivación: modo de identidad de la tirada),
  `sheet-print.service.ts`/`sheet-print.helpers.ts` (hoja genérica: tirada sin alumnos —
  N copias idénticas con QR de tirada sin `printedSheetId` de alumno; dibujo de la grilla
  RUT), `omr-calibration.*` (service+controller chico para `GET/PATCH /organizations/me/omr-calibration`
  con `LLM_SETTINGS_ROLES`-style guard — decidir constante en V0), `sheet-scan.service.ts`
  (inyectar calibración de la org al `captureProfile` del request).
- **Tickets clave:** `RutBubbleResolver` (parsea `identity.raw` CD-10, `normalizeRut`,
  match EXACTO contra roster del curso de la tirada → candidato con confianza; sin match
  o DV inválido → cola manual; JAMÁS matching difuso silencioso — la lección del roster DIA);
  hoja genérica imprime "Nombre: ____" + instrucciones de marcado de RUT;
  el `SheetIdentityResolver` se elige por `identity.mode` del spec (registro, no if-chain).
- **Criterios:** MVP con QR intacto (regresión completa); ≥12 tests nuevos.

### F1 · Frontend — captura desde el navegador

- **Propiedad:** `hojas/escanear/**` (extender), `hojas/hooks/**` nuevos.
- **Tickets:** modo "Cámara" en la subida: `getUserMedia` con overlay de encuadre,
  al capturar → `assess-capture` → **el veredicto de calidad se muestra ANTES de aceptar
  la foto** (D3: retake inmediato con el motivo en español; aceptada → entra al lote como
  imagen normal). Fallback a `<input capture>` en navegadores sin getUserMedia. Contador
  de hojas capturadas vs esperadas (la identidad del assess ya dice qué hoja es).
- **Criterios:** flujo subida-archivos del MVP intacto; funciona en mobile (es SU caso de uso).

### F2 · Frontend — diseñador numérico + formas

- **Propiedad:** `hojas/[id]/disenar/**`, `hojas/[id]/imprimir/**`, `hojas/components/SheetPreview.tsx`.
- **Tickets:** el diseñador incluye ítems numéricos como `digit_grid` (CD-8) y los muestra
  en el preview (grilla de dígitos); selector de modo de identidad de la hoja (QR por
  alumno / genérica con RUT); selector de forma A/B en la tirada (CD-13) si la evaluación
  tiene formas; preview de la grilla RUT.
- **Criterios:** preview sigue siendo espejo exacto del spec (CD-5); tsc limpio.

**Gate V1 (mecánico):** merge de los 4 + regresión completa (tests MVP + nuevos) +
**round-trip extendido**: variante con digit_grid y con grilla RUT (el impresor rellena
dígitos con sus coordenadas, el lector los recupera — cero dígitos incorrectos confiados).

---

## Fase V2 — Desarrollo LLM ∥ Formas ∥ Endurecimiento (4 agentes)

### P2 · Python — hardening de los lectores nuevos

Catálogo sucio de grillas: dígito remarcado, dos marcas en una columna, RUT con DV
inconsistente (se lee igual — validar es del backend), grilla desalineada ±2px, fotos de
cámara reales del gate CD-11. Cero regresiones.

### B2 · Backend — respuestas de desarrollo por LLM

- **Propiedad:** `sheet-scanning/development-grading.service.ts` (+spec) y lo que el
  contrato V0 defina; NO toca el módulo `llm` ni `responses` (los consume).
- **Tickets:** al confirmar un lote cuyo layout tiene `crop_region`: por cada recorte,
  crear el registro de desarrollo por el camino existente de `ai_grading_jobs` → prompt
  con la rúbrica del ítem (investigar cómo `items` guarda rúbricas y cómo el módulo `llm`
  se invoca — patrón `LlmAgentService`) → escribe `ai_score` **jamás** `final_score`
  (§8.3: la IA propone); el flujo humano de aprobación reusa la UI existente de corrección
  de desarrollo si existe (investigar `answer-sheets`/`assessment-results`; si no existe,
  reportar y acotar a: ai_score visible en la vista de corrección actual).
- **Criterios:** asíncrono vía JobDispatcher; costo acotado (un llamado por recorte, batch
  con límite); evidencia D11 (el recorte ya está en `files`).

### B3 · Backend — formas A/B

- **Propiedad:** `sheet-print.service.ts` (extensión formas), `sheet-scan.service.ts`
  (validar forma de la tirada), spec updates.
- **Tickets:** tirada con `assessmentFormId` (CD-13) → el layout de esa forma; el confirm
  entrega al camino answer-sheets el assessment+forma correctos (investigar cómo el import
  actual maneja formas). G1 ya rechaza hojas de otra forma (hash distinto) — test explícito.

### B4 · Endurecimiento operativo

- **Propiedad:** `scripts/` del api (retención CD-14), `sst.config.ts` (**contenedor del
  servicio OMR** — patrón del backend existente, Dockerfile listo), `.env.example`,
  `apps/web/src/lib/` (promover `apiGetBinary` y retirar la descarga base64 del PDF),
  límites de tamaño de lote (ya hay `max(60)` — revisar límites de páginas por PDF),
  endpoint de métricas del módulo (§5.6 del diseño: marcas por estado, rechazos por
  motivo, correcciones que contradicen lecturas firmes — LA métrica) para el dashboard
  de plataforma.
- Incluye la renumeración de migración si quedó pendiente del prerrequisito 3.

**Gate V2 (mecánico):** regresión total + smoke del flujo de desarrollo (recorte → ai_score
con LLM mockeado) + formas A/B end-to-end sintético.

---

## Fase V3 — Integración, auditoría y cierre (secuencial + 2 auditores)

1. Cableado de módulos/nav/rutas nuevas (sólo acá se tocan compartidos).
2. **Round-trip v1 completo**: hoja con alternativas + digit_grid + crop_region + RUT,
   4 variantes de captura — cero incorrectas confiadas (incluye dígitos).
3. Auditoría backend + frontend (mismos checklists + específicos: ¿un dígito dudoso jamás
   produce un número confiado?, ¿ai_score nunca pisa final_score?, ¿la hoja genérica no
   rompe D13 (idempotencia sin printedSheetId por alumno)?, ¿assess-capture no filtra
   datos entre orgs?).
4. E2E de 11 etapas con los 3 modos: QR por alumno, genérica RUT, formas A/B.
5. Guía `docs/Sprints/E22-V1-testing-guide.md` + PR `e22-lector-v1` → `dev`.

---

## Resumen

| Fase | Agentes | Gate | Decisión humana |
|---|---|---|---|
| V0 Contratos v1 | 1 (secuencial) | typecheck + schemas + ejemplos ×2 validadores | **Congelar CD-8..CD-14** |
| V1 Lectores/Identidad/Cámara/Calibración | P1, B1, F1, F2 | regresión + round-trip con dígitos/RUT | — |
| V2 LLM/Formas/Endurecimiento | P2, B2, B3, B4 | regresión + smoke LLM + formas sintético | — |
| V3 Integración | main + 2 auditores | round-trip v1 + E2E 3 modos + auditoría | UX + merge/PR |

**Estimación: 4–6 sesiones de orquestación** (el diseño estimaba 11–12 semanas/dev).
O4 físico corre en paralelo y es condición para declarar la v1 *productiva*.

## Riesgos específicos de la v1

| Riesgo | Mitigación |
|---|---|
| Un dígito mal leído produce un NÚMERO plausible (peor que una letra: 45≠46 es invisible) | CD-8: cualquier grupo dudoso ⇒ campo entero ambiguous; round-trip de dígitos con cero-confiadas; catálogo sucio de grillas en P2 |
| Matching por RUT reintroduce los errores históricos del roster DIA | `RutBubbleResolver` sólo match EXACTO post-`normalizeRut`; todo lo demás a cola manual con evidencia |
| El costo LLM por recorte se dispara | B2: job asíncrono con límite por lote, un llamado por recorte, `ai_grading_jobs` ya trackea costo/estado |
| La cámara promete más de lo que la foto da | CD-11: el gate de calidad corre ANTES de aceptar cada foto — el retake es inmediato, no un lote fallido después |
| Extender contratos rompe el MVP | Todos los campos nuevos nullable/optional; los 123+84 tests del MVP son piso de regresión en TODOS los gates |
| Dos numeraciones de migración (telemetría en main) | Prerrequisito 3 + B4 lo cierra |

## Cómo se lanza

Igual que el MVP: *"Ejecutá la Fase V·N de `docs/plan-desarrollo-lector-v1.md`"*. V0 espera
tu sign-off de enmiendas; V1→V2 encadenan solas; V3 termina en PR. **No se arranca V0 hasta
que la PR #156 esté mergeada a `dev`** (o me indiques explícitamente construir sobre la rama
del MVP sin esperar el merge).
