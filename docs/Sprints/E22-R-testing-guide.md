# E22-R — Guía de testing manual: captura remota con teléfono

> Cómo probar el handoff QR PC→teléfono de punta a punta. Requiere un teléfono
> físico y un túnel HTTPS (la cámara del navegador móvil no funciona sin HTTPS).
> Diseño: `docs/diseno-captura-remota-movil.md`. Contratos: `docs/e22-lector-contracts.md` §11.

## 0. Setup del túnel HTTPS (una vez)

`getUserMedia` exige contexto seguro. `localhost` lo es para el PC, pero el
teléfono entra por la IP de tu Mac y eso NO es contexto seguro ⇒ sin túnel, la
cámara del teléfono no abre.

1. Instala cloudflared (no requiere cuenta para túneles efímeros):
   ```bash
   brew install cloudflared
   ```
2. Levanta el stack local como siempre (API + web + servicio OMR).
3. Abre el túnel hacia el frontend:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Anota la URL `https://<aleatorio>.trycloudflare.com`.
4. **Gotcha de NextAuth:** vas a operar el PC también por la URL del túnel (el
   QR codifica el origin de la página que lo muestra). Si el login por el túnel
   da problemas de cookies, agrega la URL del túnel a `AUTH_TRUSTED_ORIGINS` /
   `AUTH_URL` según tu `.env` local, o usa el PC por `localhost` y reescribe a
   mano el host de la URL del QR en el teléfono (el path y el fragment no
   cambian). El secreto viaja en el fragment: reescribir el host no lo pierde.
5. El teléfono debe poder resolver la URL del túnel (datos móviles sirven; no
   hace falta la misma red).

## 1. Flujo feliz completo

| Paso | Dónde | Qué hacer | Qué esperar |
|---|---|---|---|
| 1 | PC | `/hojas/escanear` → elegir tirada → fuente **Celular** → **Con el teléfono** | Aparece el QR + "Esperando el teléfono…" |
| 2 | Teléfono | Escanear el QR con la app de cámara | Se abre `/movil/hojas/<id>` sin pedir login; muestra curso + instrumento + contador |
| 3 | PC | — | El QR se oculta; live view "0 de N hojas capturadas" |
| 4 | Teléfono | Capturar una hoja bien iluminada | "Evaluando calidad…" <1s → aceptada, toast con identidad, contador sube |
| 5 | PC | Esperar ≤3s | El contador sube y aparece el badge con la identidad leída |
| 6 | Teléfono | Repetir con 2-3 hojas más | Contadores sincronizados en ambos lados |
| 7 | Cualquiera | "Terminar y procesar" | Teléfono: pantalla final. PC: redirección a la cola de revisión del lote |
| 8 | PC | Revisar y confirmar el lote como siempre | El flujo aguas abajo es idéntico al de un lote subido por archivos |

## 2. Tabla de provocaciones de falla

| # | Provocación | Resultado esperado |
|---|---|---|
| 1 | Escanear el QR 15+ min después de generarlo | El móvil muestra "código vencido, pide uno nuevo"; el PC pasa a `expired` con botón para regenerar |
| 2 | Abrir el link del QR en 4 dispositivos/pestañas distintas | Los 3 primeros canjean; el 4º recibe rechazo claro |
| 3 | PC: "Regenerar código" con un teléfono ya activo | El teléfono viejo queda fuera (401 → estado terminal con mensaje); el QR nuevo empareja una sesión nueva con lote nuevo |
| 4 | PC: "Cancelar" (revocar) a mitad de captura | El teléfono muestra sesión revocada al siguiente intento; las fotos ya subidas quedan en el lote `pending` visible en "Lotes recientes" |
| 5 | Foto borrosa / con reflejo / hoja recortada | Rechazo instantáneo con el motivo específico + "Repetir foto"; NO suma al contador ni sube a S3 |
| 6 | Foto de una hoja de OTRA tirada | El gate la rechaza (QR/identidad no corresponde) o la marca sin identidad; jamás entra con identidad falsa |
| 7 | Apagar la pantalla del teléfono 30s y volver | La cámara se reactiva sola (visibilitychange); la sesión sigue viva si no venció |
| 8 | Teléfono se queda sin batería a mitad | El PC sigue viendo las capturas ya subidas; puede "Terminar y procesar" desde el PC sin el teléfono |
| 9 | Denegar el permiso de cámara en el móvil | Fallback a "Tomar foto" con la app de cámara del sistema; el gate corre igual por foto |
| 10 | Capturar la misma hoja dos veces | Advertencia de duplicado (misma semántica que el modo cámara del dashboard); al procesar, el pipeline D13 supersede |
| 11 | Editar a mano el token / usar un JWT de usuario contra `/api/capture-proxy/*` | 401 siempre: las superficies son disjuntas |
| 12 | Pegar la URL del QR SIN el fragment (`#...`) | La vista móvil explica que el código está incompleto y pide re-escanear |
| 13 | Dos teléfonos escaneando a la vez (canjes 1 y 2) | Ambos suben; el contador del PC suma de los dos; sin colisiones |
| 14 | "Terminar" dos veces seguidas (doble tap) | Idempotente: un solo procesamiento |

## 3. Qué revisar en la base y en los logs

- `capture_sessions.secret_hash` es un sha256 — **nunca** debe aparecer el
  secreto en claro en DB ni en logs del server (el fragment no llega al server).
- El lote de la sesión: `sheet_scan_batches.source_file_ids` crece foto a foto;
  `capture_sessions.captures` acumula la evidencia del live view.
- Tras `finish`: sesión `closed`, lote `processing` → `needs_review`, y el
  conteo de páginas coincide con las fotos aceptadas.

## 4. Limitaciones conocidas (declaradas)

- El live view es polling cada 2,5 s — no es instantáneo y está bien.
- El TTL de 15 min no se extiende desde el teléfono (v2 si el E2E muestra que
  queda corto para cursos grandes).
- La identidad mostrada en el live view del PC es la que reportó el gate del
  teléfono (informativa); la resolución que vale es la del procesamiento del
  lote.
