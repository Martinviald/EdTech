# E22 — Guía de testing manual de la V1 del Lector de Marcas

> Para el test E2E humano de la PR `e22-lector-v1`. Se construye SOBRE el MVP (PR #156) —
> la guía del MVP (`E22-MVP-testing-guide.md`) sigue vigente para el camino base; esta
> cubre lo nuevo de la v1. Todo lo automatizable ya corrió: **136 tests de visión** (catálogo
> sucio de grillas/RUT/cámara incluido), **1236 tests backend**, 294 de types, typecheck
> limpio en api/web, y el **round-trip v1 completo** (11 variantes: QR, RUT+dígitos+crop,
> rotaciones, doble marca ⇒ ambiguous, assess — cero lecturas incorrectas confiadas).
> Además: 2 auditorías adversariales (backend + frontend) con 3 blockers y 7 mayores
> encontrados y corregidos con test de regresión cada uno.

## Qué trae la v1 (sobre el MVP)

| Incremento | Cómo se usa |
|---|---|
| Hoja genérica con RUT (CD-10) | Diseñar → "Identificación de la hoja: Genérica con RUT" → la hoja imprime grilla RUT + "Nombre: ___" + QR de esquina; el alumno marca su RUT; el sistema lo valida (DV) y matchea EXACTO contra el curso |
| Campos numéricos `digit_grid` (CD-8) | Grilla de dígitos por pregunta; un dígito dudoso ⇒ el campo ENTERO a revisión, jamás un número inventado |
| Captura desde el navegador (CD-11) | Escanear → perfil "Celular" → tab "Cámara": cada foto pasa el gate de calidad ANTES de aceptarse (retake inmediato con motivo) |
| Calibración por org (CD-12) | `PATCH /organizations/me/omr-calibration` (`ambiguityMargin` 0.05–0.5); margen más alto = más dudas a revisión |
| Corrección de desarrollo por LLM (CD-9) | Al confirmar un lote con campos `crop_region`, cada recorte va a `ai_grading_jobs` → escribe `ai_score` (jamás `final_score` — §8.3) |
| Formas A/B (CD-13) | Un layout por forma; la tirada elige forma; G1 rechaza lotes cruzados por hash |
| Endurecimiento | Retención de imágenes 180 días (`pnpm --filter @soe/api retention:sheet-scans`, `--dry-run` disponible), métricas (`GET /sheet-scan-metrics`), contenedor OMR en SST con token compartido, `apiGetBinary` |

## Preparación del entorno

```bash
# 1. Migraciones (0021 del MVP + 0022 de formas)
pnpm --filter @soe/db db:migrate

# 2. Servicio de visión (terminal aparte) — sin OMR_SERVICE_TOKEN en dev queda abierto
cd services/omr
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # una vez
.venv/bin/uvicorn app.main:app --port 8090

# 3. API y web como siempre (OMR_SERVICE_URL ya en .env.example)
```

## Flujo E2E — modo 1: QR por alumno (regresión del MVP)

Repite el camino feliz de `E22-MVP-testing-guide.md` (diseñar → congelar → imprimir →
rendir → escanear → revisar → confirmar). Nada debió cambiar.

## Flujo E2E — modo 2: hoja genérica con RUT (lo nuevo grande)

1. **Diseñar** — elegir "Genérica con RUT" en el selector de identificación. El preview
   muestra la grilla RUT (8 columnas + DV con K), "Nombre: ___" y el QR en la esquina.
   Congelar.
2. **Imprimir** — la tirada crea N copias idénticas (roster + reservas), todas sin alumno
   asignado. Verificar el PDF: grilla RUT + instrucciones + QR de esquina distinto por copia.
3. **Rendir** — marcar RUTs reales de alumnos del curso (y a propósito: un RUT con DV
   incorrecto, un RUT que no está en el curso, una grilla RUT en blanco).
4. **Escanear y revisar** — los RUT válidos y del curso llegan con alumno resuelto; los
   otros tres casos van a "Identidades sin resolver" (cola manual con evidencia) — JAMÁS
   un match difuso silencioso.
5. **Confirmar** — los resueltos entran a resultados por el camino de siempre.

## Flujo E2E — modo 3: captura con cámara (celular)

1. Escanear → elegir tirada → perfil "Celular" → tab "Cámara" (pedir permiso).
2. Capturar una hoja bien iluminada ⇒ "Foto aceptada" + a qué hoja/alumno corresponde.
3. Capturar una borrosa / con reflejo / sin la hoja completa ⇒ rechazo INMEDIATO con el
   motivo en español y botón "Repetir foto" — la foto NO entra al lote.
4. Capturar la misma hoja dos veces ⇒ advertencia de duplicado (no bloquea).
5. **Cambiar la tirada o la fuente con fotos capturadas ⇒ las fotos se descartan con
   aviso** (fueron gateadas contra otra tirada/perfil — comportamiento deliberado).
6. Procesar el lote normal. Probar también en un navegador sin cámara: aparece el
   fallback de subida con el mismo gate por foto.

## Casos de falla que hay que provocar (los que definen la v1)

| Provocación | Comportamiento esperado |
|---|---|
| Escanear hojas RUT de la versión/forma vieja en un lote nuevo | **Lote entero `rejected`** con ambos hashes — G1 corre también en modo RUT (lee el QR de esquina) |
| Hoja genérica escaneada de cabeza | Se lee igual (reorientación probada por el QR de esquina) |
| Hoja genérica con el QR de esquina tapado/roto | Página **rechazada** (sin QR no hay prueba de orientación ni copia física — jamás leer burbujas con correspondencia dudosa) |
| Re-escanear la misma hoja genérica con una foto nueva | Supersede de la anterior (D13) — nunca dos verdades activas del mismo alumno |
| Digit_grid con doble marca en un dígito | El campo ENTERO llega `ambiguous` a la cola — nunca un número con un dígito inventado |
| `PATCH omr-calibration` con `ambiguityMargin: 0.9` | 400 con mensaje en español (rango 0.05–0.5) |
| Confirmar dos veces / re-confirmar tras corrección humana de desarrollo | El `final_score` puesto por un humano NO se pisa |

## Qué mirar en los datos

- `sheet_scan_marks.value` sigue intacto siempre; correcciones en `reviewed_value` (§8.3).
- `responses.ai_score` poblado por los jobs de desarrollo; `final_score`/`human_score`
  intactos (la IA propone).
- `ai_grading_jobs`: estado, costo (`cost_usd`), justificación del LLM por recorte.
- `GET /sheet-scan-metrics`: la métrica clave es `firmReadingOverrides` — correcciones
  humanas que contradicen lecturas firmes (mide al lector; debería ser ~0).

## Limitaciones conocidas (documentadas, no bugs)

- **La derivación automática aún no emite `digit_grid`/`crop_region`** — no existe un tipo
  de ítem numérico en `ITEM_TYPES` y los ítems de desarrollo requieren un layouter de
  espacio propio. Todo el resto del camino (contrato, invariantes de freeze, impresor,
  preview, lector, corrección LLM) está listo y validado por el round-trip; activar el
  flujo desde la UI = mapear tipos de ítem → campos en `deriveLayoutDraft`.
- **No hay UI de aprobación humana de `ai_score`** (no existía flujo de corrección de
  desarrollo en el repo): el puntaje IA queda en `responses.ai_score` esperando esa UI.
- `minSeparability` de la calibración se persiste como knob reservado (no viaja al
  servicio en v1).
- `assess-capture` no tiene rate-limit propio (cada foto = 1 llamada al servicio).
- Jobs de ai_grading en `failed` no tienen camino de reproceso automático.
- Contenedor OMR en `sst.config.ts` listo para deploy (con `X-OMR-Token` compartido),
  **no deployado**; App Runner público — VpcIngress es el ideal futuro.
- O4 (conjunto de oro físico de 300 hojas) sigue pendiente: la v1 es *demostrable*;
  *productiva* requiere las 3 cifras del goldset (harness listo en `services/omr/goldset/`).
