# E22 — Guía de testing manual del MVP del Lector de Marcas

> Para el test E2E humano de la PR `e22-lector-mvp`. Todo lo automatizable ya corrió:
> 123 tests backend + 78 de visión + tests de types, typecheck limpio en api/web, y el
> **test de ida y vuelta impresión↔lectura** (4 variantes, cero lecturas incorrectas
> confiadas). Esta guía cubre lo que sólo un humano puede validar: el flujo completo con
> papel real y la usabilidad de la cola de revisión.

## Preparación del entorno

```bash
# 1. Migración + RLS (agrega las 6 tablas E22)
pnpm --filter @soe/db db:migrate

# 2. Servicio de visión (terminal aparte)
cd services/omr
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # una vez
.venv/bin/uvicorn app.main:app --port 8090

# 3. API y web como siempre (la API necesita OMR_SERVICE_URL, ya en .env.example;
#    default http://127.0.0.1:8090)
```

Usuario de prueba con rol `school_admin`, `academic_director` o `eval_coordinator`
(`SHEET_MANAGEMENT_ROLES`/`SHEET_REVIEW_ROLES`). El nav muestra **"Hojas de respuesta"**.

Verificación rápida sin login: los endpoints existen y los guards responden —
`curl -s -o /dev/null -w '%{http_code}' localhost:4000/api/sheet-layouts` → `401`.

## Flujo E2E con papel real (el camino feliz)

1. **Diseñar** — `/hojas` → "Diseñar hoja" → elegir un instrumento con ítems de
   alternativas o V/F (los demás tipos aparecen como excluidos con su razón). Revisar el
   preview (fiduciales, QR arriba a la derecha, burbujas) → **Congelar**. Verificar que
   congela con versión y hash, y que volver a derivar/congelar crea versión N+1 (nunca
   edita la anterior).
2. **Imprimir** — elegir curso y reservas (default 2) → crear tirada → **Descargar PDF**.
   Verificar: una hoja por alumno con su nombre + las reservas con línea en blanco; QR
   distinto por hoja/página. **Imprimir en papel real** (probar también con "ajustar a
   página" activado: el sistema lo tolera por diseño — D7).
3. **Rendir** — marcar con lápiz: hojas normales, y a propósito: una doble marca, una
   marca borrada a medias, una hoja con pocas marcas, una en blanco (debe terminar
   rechazada, no leída como todo-en-blanco).
4. **Escanear** — `/hojas` → "Escanear pruebas": elegir la tirada, perfil (escáner o
   celular), subir el PDF del escáner o fotos del celular → procesar. Ver el progreso.
5. **Revisar** — la cola ordena por daño: páginas rechazadas primero (con thumb y
   motivo), identidades sin resolver (reservas → asignar alumno), y marcas dudosas **con
   teclado**: letra = alternativa, `0` = blanco, `→`/Enter = siguiente. **El criterio de
   éxito acá es velocidad**: ¿despachas ~50 marcas en pocos minutos sin tocar el mouse?
6. **Confirmar** — el diálogo muestra los pendientes que quedarán asumidos → confirmar →
   verificar que los resultados aparecen en los dashboards por el camino de siempre
   (idéntico a un CSV de GradeCam).

## Casos de falla que hay que provocar (los que definen el producto)

| Provocación | Comportamiento esperado |
|---|---|
| Editar el instrumento, re-derivar y **congelar una versión nueva**, crear tirada v2, pero escanear hojas impresas de la tirada v1 en un lote de la v2 | **Lote entero `rejected`** con ambos hashes en el motivo. Nada persistido, nada confirmable (G1 — el riesgo nº1 del diseño) |
| Hoja rendida completamente en blanco | Página **rechazada** (`no_separable_marks`), va primera en la cola — jamás registrada como "entregó en blanco" (G3) |
| Foto borrosa / con reflejo | Página rechazada con motivo (`blurry`/`glare`), las demás siguen |
| Apagar el servicio de visión y procesar | Lote `failed` con mensaje reintentable → "Reintentar" **sin volver a subir** |
| Re-subir el mismo archivo (retry o lote nuevo) | Sin duplicados: mismo contenido se salta; contenido nuevo de la misma hoja reemplaza (el anterior queda archivado, nunca borrado — D13) |
| Hoja de reserva rendida | Llega a "Identidades sin resolver" → asignarle alumno → sus marcas ya estaban leídas (G8) |
| Hoja escaneada rotada 90° o de cabeza | Se lee igual (reorientación por QR) |
| Confirmar dos veces a la vez (dos pestañas) | La segunda recibe "El lote ya fue confirmado" |

## Qué mirar en los datos (auditoría §8.3)

- `sheet_scan_marks.value` (lectura de máquina) **nunca cambia**; las correcciones van a
  `reviewed_value` + `reviewed_by_id` + `reviewed_at`.
- Toda marca guarda `fill`/`threshold`/`margin`; las dudosas además su recorte (evidencia D11).
- Un lote confirmado con dudosas sin resolver las registra como decisión del autor del confirm.

## Lo que esta PR NO valida (pendiente O4 — trabajo físico)

El criterio numérico del MVP (≥99% correctas, ≤3% a revisión, **0 incorrectas
confiadas**) se mide contra el **conjunto de oro de 300 hojas reales** que requiere
imprimir, rendir y transcribir a mano (×2 personas). El harness completo quedó listo en
`services/omr/goldset/` (ver su README): transcribir → validar → correr → reporte con
veredicto APRUEBA/NO APRUEBA. Hasta que eso corra, el MVP es *demostrable*, no *validado*.

## Deuda conocida (documentada por auditoría, no bloqueante)

- El proxy genérico del front corrompe binarios → la descarga del PDF usa una server
  action base64 (candidato a `apiGetBinary` compartido).
- `sst.config.ts` no incluye aún el contenedor del servicio de visión (Dockerfile listo
  en `services/omr/`); agregarlo al preparar el deploy a demo.
- Supersede entre lotes: si un re-escaneo en un lote nuevo termina `rejected`, los scans
  del lote anterior que alcanzó a reemplazar quedan `superseded` (recuperable
  re-procesando; caso borde documentado).
- Si `dev` incorpora las migraciones de telemetría de `main` (0021/0022), renumerar la
  migración E22 `0021_fine_onslaught` (ya se hizo una vez en un worktree: journal + snapshot).
