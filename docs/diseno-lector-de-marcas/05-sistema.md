# 05 · El sistema completo

> Once etapas desde el instrumento en la base de datos hasta el dashboard. Cuatro son
> **compuertas**: pueden detener el flujo y devolverlo a un humano.

---

## 5.1 · Flujo end-to-end

| # | Etapa | Componente | Compuerta |
|---|---|---|---|
| 01 | **Derivar el layout** — el instrumento produce una propuesta de hoja | `SheetLayoutService.deriveDraft` | |
| 02 | **Revisar y congelar** — un humano ajusta y confirma; el spec queda inmutable con su hash | Diseñador + `freeze` | **Sí** — nada se imprime sin esto |
| 03 | **Imprimir la tirada** — PDF por curso, una hoja por alumno más reservas | `SheetPrintService` | |
| 04 | **El colegio rinde y digitaliza** — fuera del sistema; vuelve como PDF o fotos | — | |
| 05 | **Subir el lote** — directo a S3 por presigned URL | `FilesService` (existente) | |
| 06 | **Encolar el trabajo** — el lote pasa a `processing`, el frontend consulta el progreso | `JobDispatcher` (existente) | |
| 07 | **Leer las marcas** — páginas → rectificación → calidad → clasificación | Servicio de visión | **Sí** — una página borrosa se rechaza, no se lee mal |
| 08 | **Resolver identidad y verificar el hash** — QR contra la tirada | `SheetIdentityResolver` | **Sí** — hash distinto = lote rechazado completo |
| 09 | **Cola de revisión** — calidad, identidades, marcas ambiguas por margen | `ScanReviewService` | **Sí** — aquí decide un humano |
| 10 | **Adaptar y confirmar** — `ScanResult` → `ParserResult` → matcher → previsualización | `scan-result.adapter` | |
| 11 | **Persistir y calcular** — `responses` → resultados → dashboards | Camino existente, **sin modificar** | |

```
instrumento
     │
     ▼
[01] derivar layout ──▶ [02] ◆ congelar ──▶ [03] imprimir PDF ──▶ (papel)
                                                                     │
                                                          el colegio rinde
                                                                     │
                                                                     ▼
[11] responses ◀── [10] adaptar ◀── [09] ◆ revisar ◀── [08] ◆ identidad ◀── [07] ◆ leer ◀── [06] job ◀── [05] S3
      │                                                                                                      ▲
      ▼                                                                                                      │
  dashboards                                                                                            (lote subido)

◆ = compuerta: puede devolver el flujo a un humano
```

---

## 5.2 · Máquina de estados del lote

```
pending ──▶ processing ──┬──▶ needs_review ──▶ confirmed
                         │           │
                         │           └──▶ (re-escaneo parcial) ──▶ processing
                         ├──▶ confirmed          (nada que revisar)
                         ├──▶ rejected           (hash de layout distinto — G1)
                         └──▶ failed             (servicio caído, tiempo límite)
```

| Estado | Significa | Acción disponible |
|---|---|---|
| `pending` | Creado, esperando que terminen las subidas a S3 | Cancelar |
| `processing` | El job está corriendo | Ninguna (polling) |
| `needs_review` | Leído, con pendientes humanos | Revisar, confirmar |
| `confirmed` | Adaptado y persistido en `responses` | Ninguna |
| `rejected` | Incompatibilidad de layout | Reimprimir o corregir el instrumento |
| `failed` | Falla de infraestructura | Reintentar **sin volver a subir** |

`failed` y `rejected` son distintos a propósito: `failed` es culpa del sistema y se reintenta;
`rejected` es un problema de datos que ningún reintento arregla.

---

## 5.3 · Límites transaccionales

**Etapas 07–09 (lectura y revisión): por página, no por lote.** Un lote de 40 hojas no puede
mantener una transacción viva mientras corre visión por computadora. Cada página se persiste
en su propio `withOrgContext(db, orgId, tx => …)`, usando `tx` (CLAUDE.md §5.2).

Consecuencia aceptada: un lote puede quedar parcialmente leído si el proceso muere. Es
recuperable porque D13 hace la lectura idempotente — reprocesar el lote no duplica nada.

**Etapa 11 (persistencia de resultados): transaccional.** Ya lo es hoy en
`persistAssessmentResults`. No se modifica.

---

## 5.4 · Multi-tenancy

Las seis tablas llevan `org_id NOT NULL` y política en `packages/db/sql/rls-policies.sql`
([D16](01-decisiones.md#d16)).

**El servicio de visión no conoce el `orgId` y no debe conocerlo.** Recibe URLs firmadas de
vida corta (15 minutos) emitidas por la API, que ya validó el tenant.

> **El aislamiento nunca depende de un servicio externo.** Si el servicio de visión se
> compromete, lo que un atacante obtiene es acceso a las imágenes cuyas URLs firmadas están
> vivas en ese momento — no acceso a la base de datos ni a otros tenants.

Recordatorio operativo: la API conecta con `soe_app` (sin `BYPASSRLS`). `soe_admin` bypassa
RLS y sólo se usa para migrar y sembrar.

---

## 5.5 · Modos de falla

| Falla | Detección | Comportamiento |
|---|---|---|
| Servicio de visión caído | Tiempo límite en `OmrClient` | Lote a `failed` con motivo. Reintentable sin volver a subir |
| Página borrosa o mal encuadrada | `QualityGate` | Página rechazada individualmente. Las demás siguen. Va **primera** en la cola |
| **Instrumento editado tras imprimir** | Hash del QR | **Lote rechazado completo** con el motivo exacto. Nunca corrección parcial corrida |
| QR ilegible | `QrIdentityResolver` | Escaneo sin identidad, va a la cola. Sus marcas se leen igual |
| Página faltante en instrumento multipágina | `pageCount` del QR | Escaneo incompleto explícito. **No se persiste como respuestas en blanco** (G3) |
| Re-escaneo del mismo alumno | Idempotencia D13 | Reemplaza; el anterior queda archivado, nunca borrado |
| Hoja de reserva sin identidad | `studentId` nulo | Va a la cola para asignación manual (G8) |
| Página sin ninguna marca | `MarkClassifier` sin separación | Página rechazada por calidad, no leída como todo en blanco |

### Los dos que importan más

**1. El hash de layout distinto.** Es el único que rechaza el lote entero. Cualquier
alternativa —corregir lo que calza, degradar elegantemente, avisar y seguir— produce datos
plausibles pero incorrectos para un curso completo. Fallar ruidoso es la única opción segura.

**2. La página sin marcas.** Es contraintuitivo rechazar una página que "se leyó bien", pero
el algoritmo de umbral relativo no tiene nada que separar y produciría basura con apariencia de
dato. El proyecto ya pagó este error con GradeCam.

---

## 5.6 · Observabilidad

Sigue `.claude/rules/backend/06-error-handling-observability.md`:

- Los fallos esperados (calidad, hash, identidad) son estado de dominio, **no** excepciones, y
  **no** van a `reportServerError`. Se persisten en `failureReason` y en el estado del escaneo.
- Los fallos inesperados del job (servicio caído, error de parseo) llaman a `reportServerError`
  desde el `catch` del job, con `{ batchId, orgId, userId }`.

**Métricas que el módulo debe exponer desde el día uno**, porque son las que dicen si funciona:

| Métrica | Por qué |
|---|---|
| Marcas por estado, por lote | Si `ambiguous` sube, el umbral se descalibró |
| Páginas rechazadas por `rejectReason` | Distingue "el colegio escanea mal" de "el lector falla" |
| Tiempo de la cola de revisión | Si crece, el producto se está abandonando |
| Correcciones humanas que **contradicen** una lectura firme | **La métrica más importante**: es el error que el sistema no sabía que tenía |
