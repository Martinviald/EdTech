# Plan de desarrollo: los cinco hallazgos de usabilidad del lector de marcas

**Fecha:** 2026-09-24
**Base:** `origin/main` en `b5a069f` (es lo desplegado; los tres deploys del 2026-09-15 salieron de ahí).
**Entrada:** `docs/diseno-lector-de-marcas/12-diagnostico-uso-real.md` (rama `docs/diagnostico-omr-uso-real`, PR #250).
**Alcance:** convertir los hallazgos 1 a 5 del diagnóstico en etapas ejecutables. El hallazgo 6
(filtro de instrumento en `listAssessments`) **no está en este plan**: lo toma otra persona.

**Contexto que fija la prioridad:** el ensayo PAES M2 — Ensayo 5 se corrigió completo (17 alumnos,
935 marcas, 0 sin puntuar). **Ninguno de los cinco invalida un resultado.** Los cinco son
usabilidad y presentación. No hay urgencia de producción; hay urgencia de que la próxima corrida
no cueste el mismo trabajo manual.

---

## 1. Correcciones y precisiones al diagnóstico

El diagnóstico es sólido: verifiqué sus causas contra el código de `b5a069f` y **todas se
sostienen**. Tres cosas hay que corregir o completar antes de planificar, y una cuarta la confirmo
tras haber estado a punto de contradecirla.

### 1.1 El hallazgo 1 tiene un hueco: `source_file_id` puede ser un PDF de varias páginas

El diagnóstico propone exponer `source_file_id` como URL prefirmada y apuntarle un `<img>`. Eso
funciona para una parte de los lotes y **falla en silencio para la otra**.

`source_file_id` no es la imagen de la página: es **el archivo que se subió**. Los tipos aceptados
están en `apps/api/src/sheet-scanning/sheet-scan.service.ts:65-67`:

```ts
'application/pdf',
'image/jpeg',
'image/png',
```

y `buildReadRequest` (`sheet-scan.service.ts:670-673`) ramifica exactamente por eso:

```ts
const source =
  sourceFile.mimeType === 'application/pdf'
    ? { kind: 'pdf' as const, pdfUrl: url, imageUrls: null }
    : { kind: 'images' as const, pdfUrl: null, imageUrls: [url] };
```

Es decir: el camino de escáner de escritorio sube **un PDF con todas las hojas** y las N páginas
del lote comparten el mismo `source_file_id`, distinguiéndose por `source_page_index`
(`packages/db/src/schema/sheet-scanning.ts:191`). El camino de captura móvil sube un JPEG por
página. Un `<img src={sourceUrl}>` sirve para el segundo y muestra una imagen rota para el
primero, sin error ni log — el mismo patrón de falla que el diagnóstico critica en otros puntos.

**Consecuencia para el plan:** la etapa del hallazgo 1 tiene que ramificar por `mimeType`, y el
DTO tiene que llevar `sourceMimeType` y `sourcePageIndex`, no sólo la URL.

### 1.2 La miniatura, aunque exista, probablemente no alcanza para leer un nombre a mano

`PAGE_THUMB_WIDTH_PX = 400` (`services/omr/app/pipeline.py:103`). Es el ancho de la **página
completa**. El propio diálogo de la web lo dice en su texto (`ReviewQueue.tsx:221-223`):

> La imagen guardada es una miniatura de la captura: alcanza para ver si hay marcas en la hoja,
> no para leer letra chica.

Un nombre manuscrito en un bloque que ocupa un tercio del ancho queda en ~130 px. Por eso la
solución del hallazgo 1 **no puede ser sólo "genera la miniatura también en este caso"**: hay que
llegar al archivo original cuando es una imagen, y el texto del diálogo tiene que dejar de mentir
cuando lo que se muestra no es la miniatura.

### 1.3 `ScanPreviewDialog` no se puede reusar tal cual en `IdentityRow`

El diagnóstico dice "darle a `IdentityRow` el mismo `ScanPreviewDialog` que ya tiene `ScanRow`".
Dos obstáculos concretos que hay que resolver en la etapa, no descubrir durante ella:

1. **El diálogo se auto-anula cuando no hay miniatura** — `ReviewQueue.tsx:191`:
   ```tsx
   if (!scan.thumbUrl) return <ScanThumb scan={scan} />;
   ```
   Con `thumb_file_id` NULL (que es justo el caso de la hoja de reserva) el diálogo se degrada al
   thumb pelado. Cambiar `IdentityRow` sin tocar esta línea **no cambia nada en pantalla**.
2. **`onDiscardRequested` es obligatorio** (`ReviewQueue.tsx:182,187`) y el pie del diálogo pinta
   un botón destructivo "Descartar página". `IdentityRow` hoy no tiene flujo de descarte
   (`DiscardScanDialog` sólo se monta desde `ScanRow`, `ReviewQueue.tsx:163-168`). Hay que
   decidir: o se vuelve opcional y se oculta el botón, o `IdentityRow` monta también el descarte.
   **Recomiendo volverlo opcional**: en la cola de identidades la acción esperada es asignar al
   alumno, y ofrecer "descartar" al lado del selector invita al error.

### 1.4 El hallazgo 3 sí conviene que traiga una migración — de índice, no de columna

Suscribo la decisión: **no** agregar `status`/`closed_at` a `sheet_print_runs`. Pero el
diagnóstico cierra con "**Ninguna migración** — la señal es derivable", y eso es cierto para la
_columna_ y falso para el _costo_.

`sheet_scan_batches` **no tiene ningún índice**: su `pgTable` se declara sin el callback de
índices (`packages/db/src/schema/sheet-scanning.ts:149-170`), y la migración que la crea
(`packages/db/drizzle/migrations/0024_vengeful_norrin_radd.sql:40-55`) no emite ninguno. La FK
sobre `print_run_id` no crea índice en PostgreSQL. Hoy la guarda de `updateRun` hace un seq scan
por cada llamada y no se nota porque es una fila cada tanto; convertir ese predicado en algo que
se evalúa para cada tirada de la lista lo pone en un camino caliente.

**Recomiendo incluir en la etapa un índice** `(org_id, print_run_id, status)` sobre
`sheet_scan_batches`. Es aditivo, reversible y no cambia el modelo de datos — no contradice la
decisión de no agregar estado.

### 1.5 Lo que verifiqué y **confirma** al diagnóstico: el `pageSize` del hallazgo 4

Estuve a punto de reportar que `/instruments?page=1&pageSize=100` devolvía 20 y no 100. **No es
así, y conviene dejar escrito por qué**, porque el repo tiene una trampa ahí.

Hay **dos** `listInstrumentsQuerySchema` distintos:

| Archivo                                               | Paginación                                               | ¿Lo usa el endpoint?                                                            |
| ----------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/api/src/instruments/dto/instrument.dto.ts:83`   | `paginationSchema.extend(...)` → `page` + **`pageSize`** | **Sí** — es el que importa el controller (`instruments.controller.ts:19-27,58`) |
| `packages/types/src/schemas/instrument.schema.ts:247` | `page` + **`limit`**                                     | No, para este endpoint                                                          |

El controller parsea con el local, así que `pageSize=100` **se respeta** y el comentario de
`hojas/lib/instruments.ts:10-11` es correcto. El diagnóstico acierta: se traen los 100
instrumentos **más viejos** (`orderBy(instruments.createdAt)` sin `desc()`,
`instruments.service.ts:96`) y el instrumento nuevo queda fuera.

(La duplicación en sí es una violación de DRY de CLAUDE.md §4.2 y tiene víctimas fuera de este
plan: ver §10.)

### 1.6 El hallazgo 4 tiene una segunda mitad que un join no arregla

El diagnóstico dice que el join a `instruments` "arregla las cuatro pantallas juntas". Arregla
**dos** de las cuatro, porque las otras dos no parten de una tirada:

| Pantalla                                | Fuente del id             | ¿La arregla el join a `PrintRunModel`?                     |
| --------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `hojas/escanear/page.tsx:92`            | `PrintRunModel`           | Sí                                                         |
| `hojas/page.tsx:182` (tabla de tiradas) | `PrintRunModel`           | Sí                                                         |
| `hojas/page.tsx:120` (tabla de layouts) | `SheetLayoutSummaryModel` | **No** — hace falta el mismo join en el listado de layouts |
| `hojas/[id]/imprimir/page.tsx:85`       | `SheetLayoutSummaryModel` | **No** — ídem                                              |

Y hay un quinto consumidor que **no es una etiqueta sino un selector**: `DesignSheetDialog` se
alimenta de la misma lista truncada (`hojas/page.tsx:74-82`). Un join no le sirve: necesita
_listar_ instrumentos. Si 4b es cierto, **el instrumento del M2 no debería poder elegirse para
diseñar una hoja** — es la predicción falsable del diagnóstico, y sigue abierta (§8).

---

## 2. Restricción transversal: qué puede verificar el CI y qué no

Esto condiciona el diseño de cada etapa, así que va antes que las etapas.

`.github/workflows/checks.yml` define cinco jobs, que corren en cada PR vía `ci.yml`:

| Job     | Qué corre                                                                 |
| ------- | ------------------------------------------------------------------------- |
| `web`   | `typecheck` · `lint` · `lint:ds` (guard del Design System) · `next build` |
| `types` | `typecheck` · **`pnpm --filter @soe/types test`**                         |
| `db`    | `typecheck` · tests puros                                                 |
| `api`   | `typecheck` · `lint` · **`jest`** (excluye `src/privacy/`)                |
| `omr`   | `ruff check` · **`pytest`**                                               |

**`apps/web` no tiene corredor de tests.** No hay script `test` en su `package.json` y hay **cero**
archivos `*.test.*` / `*.spec.*` bajo `apps/web/src`. No es un olvido: la bitácora de la fase 5 ya
lo dejó por escrito (`11-pendientes-registro-bitacora.md:127-129`).

De ahí salen dos reglas para este plan:

1. **Todo lo que sea comportamiento va empujado hacia `packages/types` o `apps/api`**, que sí
   tienen tests en CI. Un default, un predicado o una elección de imagen escritos como función
   pura en `@soe/types` quedan cubiertos; escritos dentro de un `.tsx` no los cubre nada.
2. **Todo cambio visual exige mirar la pantalla.** El CI sólo puede decir que compila. Cada etapa
   lleva abajo una lista explícita de "qué mirar", porque es la única red que hay.

**Regla de la casa:** las suites no se corren en esta máquina (8 GB). Se verifican en el CI.

---

## 3. Etapa 1 — El spinner gira (hallazgo 5)

**Por qué va primero:** es la de menor riesgo y menor superficie, no depende de nada y deja el
aviso creíble mientras las demás etapas se revisan.

### Cambio

`AlertCallout` fija el `className` del ícono y no deja pasarle uno
(`apps/web/src/components/shared/AlertCallout.tsx:55`):

```tsx
<Icon className={cn('mt-0.5 size-5 shrink-0', styles.icon)} aria-hidden />
```

Agregar a `AlertCalloutProps` (`:26-33`) una prop **opcional** `iconClassName?: string` y
componerla en ese `cn(...)`. Después, en `ProcessingStep`
(`.../revisar/ReviewWizard.tsx:396`), pasar `iconClassName="animate-spin"`.

Preferir `iconClassName` sobre un `spin?: boolean`: la convención del repo es aplicar
`animate-spin` en el sitio de uso — el vecino inmediato lo hace así (`ReviewWizard.tsx:383`).

### Archivos

- `apps/web/src/components/shared/AlertCallout.tsx`
- `apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/ReviewWizard.tsx`

### Qué podría romper

- **`AlertCallout` se usa 81 veces en 39 archivos.** Por eso la prop tiene que ser **opcional y
  sin default**: así ningún call site cambia de aspecto. Si en vez de eso se le pusiera
  `animate-spin` por defecto para el tono `info`, girarían decenas de avisos que no son de
  progreso.
- **No tocar el orden del `cn()`**: `iconClassName` va al final para poder sobrescribir, pero
  `size-5` y `shrink-0` deben seguir aplicándose o el ícono se deforma en los 81 usos.
- **Accesibilidad:** el contenedor ya es `role="status"` (`:52`). No agregar otro rol ni un
  `aria-live` nuevo, o los lectores de pantalla anuncian el aviso dos veces.
- **Riesgo de regresión visual: bajo.** Es aditivo puro.

### Verificación

| Dónde                 | Qué prueba                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| CI (`web`)            | Que `iconClassName` tipa y que los 81 usos siguen compilando; `lint:ds` no se ve afectado (no hay clases de escala).                         |
| **Ojo (obligatorio)** | Subir un lote y quedarse en el paso "El lector está procesando el lote": el ícono tiene que **girar**. Es lo único que el CI no puede decir. |

**Retroceso:** revertir el commit. No toca datos ni contratos.

---

## 4. Etapa 2 — El Sí/No queda encendido por defecto (hallazgo 2)

**Decisión tomada:** la funcionalidad queda **activa por defecto** y el toggle existente pasa a
servir para **desactivarla**.

**Precisión del diagnóstico confirmada:** la causa es 2a y sólo 2a. El usuario verificó en la BDD
que `config->'review'` está vacío y que de las 935 marcas, las 5 dudosas eran todas `band` y **las
5 traían `suggestedValue`**. Eso descarta 2b para esta corrida: con el interruptor encendido,
las 5 habrían mostrado el Sí/No.

### 4.1 El punto de inversión es uno solo

`isQuickConfirmEnabled` (`packages/types/src/schemas/feature.schema.ts:89-94`) es el **único**
lugar donde el default se resuelve en el backend; lo consume `scan-review.service.ts:247` al armar
`ReviewQueueModel.settings`. Cambiar ahí `=== true` por `!== false` cubre todo el camino al wizard.

Hay que decidir explícitamente el caso `!parsed.success` (hoy devuelve `false`): con el default
invertido, un `config.review` corrupto debería seguir dando **encendido**, para que un JSONB mal
formado no apague la función en silencio.

### 4.2 Qué pasa con las organizaciones que ya tienen `config.review` guardado

Es lo delicado de esta etapa. Hay cuatro estados posibles en la BDD y dos de ellos son
indistinguibles entre sí:

| Estado                                         | Cómo se llega                                                                                                   | Con `!== false`          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **A.** No existe la clave `review`             | La org nunca abrió la pantalla. `organizations.config` nace `{}` (`packages/db/src/schema/organizations.ts:14`) | **Encendido** ✔ deseado  |
| **B.** `review` existe sin `quickConfirm`      | PATCH que sólo tocó `autoAnnulMinConfidence`                                                                    | **Encendido** ✔ deseado  |
| **C1.** `quickConfirm: false` **a propósito**  | Alguien apagó el toggle deliberadamente                                                                         | Apagado ✔ deseado        |
| **C2.** `quickConfirm: false` **por arrastre** | Guardó la pantalla por otra razón y el form mandó `false` sin que nadie lo eligiera                             | Apagado ✘ **no deseado** |

**C2 existe y no es hipotético.** El formulario **siempre manda los dos campos**, haya tocado el
usuario el toggle o no (`review-settings-form.tsx:35-48`): arma el DTO con
`{ quickConfirm, autoAnnulMinConfidence }` y lo envía completo. Y su estado inicial es
`useState(initial.review.quickConfirm === true)` (`:27`), o sea **apagado** cuando la clave falta.
Resultado: cualquier org que haya entrado a configurar la nula automática se llevó un
`quickConfirm: false` que nadie eligió.

**El argumento que resuelve el empate:** la función se entregó apagada y **nadie la encendió
nunca** — la bitácora registra encenderla como un paso manual pendiente
(`11-pendientes-registro-bitacora.md:147-153`) y no hay seed, migración ni script que escriba
`config.review` en ningún lado (verificado: cero coincidencias en `packages/db/src/seed/`,
`scripts/` y los `.sql`). **Nadie puede haber apagado a propósito algo que nunca estuvo
encendido.** Por lo tanto, a día de hoy, todo `quickConfirm: false` en la BDD es C2, no C1.

**Plan para los datos, en este orden:**

1. **Una limpieza de una sola vez** que elimine la clave `quickConfirm` de `config.review` donde
   valga `false`, dejando intacto el resto del JSONB:
   ```sql
   update organizations
   set config = jsonb_set(config, '{review}', (config->'review') - 'quickConfirm')
   where config->'review' ? 'quickConfirm'
     and (config->'review'->>'quickConfirm') = 'false';
   ```
   Así los C2 vuelven al estado B y quedan encendidos, y a partir de ahí un `false` sólo puede
   significar C1.
2. **Recién después**, desplegar el código con el default invertido.

Si la limpieza no se corre, el resultado no es una corrupción: esas orgs quedan apagadas y hay que
encenderlas a mano, que es exactamente el trabajo manual que este plan viene a eliminar.

⚠️ **Antes de correr el `update`, hay que ver cuántas filas toca** (§8). Si la respuesta es "cero
o una", vale la pena discutir si conviene correrlo o simplemente encender esa org a mano.

⚠️ El `update` corre contra organizaciones reales: va con `select` previo del mismo `where`, y
dentro de una transacción.

### 4.3 El cambio que hay que hacer sí o sí, o la pantalla se vuelve una trampa

**Invertir sólo el helper y dejar el formulario como está es peor que no hacer nada.** El form
seguiría inicializando el toggle en apagado cuando la clave falta (`:27`) y seguiría mandando los
dos campos siempre: **la primera persona que entre a esa pantalla y guarde cualquier cosa apagaría
el Sí/No para su org sin saberlo**, y esta vez de forma indistinguible de una decisión real.

Por eso el cambio del formulario (`=== true` → `!== false`, misma semántica que el helper) no es
cosmético: es parte del arreglo.

### 4.4 Cambio recomendado de fondo: un solo resolvedor

Hoy el default vive duplicado: en `isQuickConfirmEnabled` (backend) y en el `useState` del form
(web). Son dos sitios que pueden desincronizarse — de hecho es lo que produce C2.

Recomiendo exportar desde `@soe/types` un `resolveReviewSettings(config): { quickConfirm: boolean;
autoAnnulMinConfidence: number | null }` y usarlo en ambos lados; `GET
/organizations/me/review-settings` pasaría a devolver los valores **resueltos** en vez del objeto
crudo (`OrgReviewSettingsResponse`, `sheet-scanning.schema.ts:460-463`). Es donde el default
queda cubierto por los tests de `@soe/types`, que **sí corren en CI**.

### Archivos

- `packages/types/src/schemas/feature.schema.ts` (helper + el comentario de `:34-39`, que hoy dice
  "Apagado por defecto en el primer ciclo")
- `packages/types/src/schemas/sheet-scanning.schema.ts` (si se adopta la respuesta resuelta)
- `apps/api/src/sheet-scanning/review-settings.service.ts` (idem)
- `apps/web/src/app/(dashboard)/configuracion/revision-hojas/review-settings-form.tsx` (`:27` y los
  textos de `:72-79`: la etiqueta pasa a describir un apagado)
- `apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/ReviewWizard.tsx:143` (`?? false` →
  `?? true`)
- `apps/web/src/app/(dashboard)/hojas/lotes/[batchId]/revisar/MarkReviewPanel.tsx:51-53` (comentario)
- `docs/diseno-lector-de-marcas/11-pendientes-registro-bitacora.md:109-157` (la bitácora describe
  el comportamiento contrario; queda desactualizada si no se toca)

### Qué podría romper

- **Tests que afirman el default viejo, por nombre.** El más explícito es
  `apps/api/src/sheet-scanning/scan-review.service.spec.ts:365-380`, que se titula _"settings.quickConfirm
  sale de organizations.config.review y está apagado por defecto"_ y afirma `quickConfirm: false`
  sin config. También `packages/types/src/schemas/review-settings.schema.spec.ts:13-50`,
  `review-settings.service.spec.ts:53-147` y `review-settings.controller.spec.ts:61-84`. **Son el
  criterio de aceptación, no un estorbo**: hay que invertir su expectativa y renombrarlos.
- **Cambio de comportamiento visible para toda organización en estado A o B**: la cola de revisión
  pasa a pedir "¿Es la B? Sí/No" donde antes mostraba la rejilla. Es lo pedido, pero es un cambio
  de UX sin aviso: conviene decirlo en el mensaje de la PR.
- **Ojo con `ReviewWizard.tsx:143`**: el `?? true` aplica sólo al instante en que `queue` es
  `undefined` (cargando). No afecta al valor real.
- **No hay carrera nueva**, pero sí una preexistente: `review-settings.service.ts:36-42` hace
  read-modify-write del `config` completo en JS (no `jsonb_set`). Dos guardados simultáneos se
  pisan. No lo introduce esta etapa y no hace falta arreglarlo acá, pero la limpieza SQL del §4.2
  no debe correr mientras alguien esté guardando esa pantalla.

### Verificación

| Dónde                   | Qué prueba                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI (`types`)            | Tests del helper invertido: ausente → `true`, `{}` → `true`, `false` → `false`, `true` → `true`, config corrupto → `true`. **Acá vive la garantía real de esta etapa.**                                                                                  |
| CI (`api`)              | `scan-review.service.spec.ts` y los tres specs de review-settings con la expectativa invertida.                                                                                                                                                          |
| CI (`web`)              | Sólo compilación.                                                                                                                                                                                                                                        |
| **Ojo**                 | (a) Abrir `/configuracion/revision-hojas` con una org **sin** la clave: el toggle tiene que verse **encendido**. (b) Apagarlo, guardar, recargar: sigue apagado. (c) Revisar un lote con marcas `ambiguous` con sugerencia: aparece "¿Es la B? Sí / No". |
| **Señal de producción** | `GET /sheet-scan-metrics` ya expone `suggestions` (`marksWithSuggestion`, `reviewed`, `confirmed`, `rejected`, `sheet-scanning.schema.ts:503`). Tras la próxima corrida, `confirmed > 0` confirma que el camino rápido se está usando de verdad.         |

**Retroceso:** revertir el código deja a todos apagados salvo quien tenga `true` explícito. La
limpieza SQL **no es reversible** (borra una clave que valía `false`); por eso va con `select`
previo y transacción, y por eso importa saber primero cuántas filas toca.

---

## 5. Etapa 3 — El nombre del instrumento siempre viaja (hallazgo 4)

**Decisión tomada:** arreglarlo en el código para que **siempre** se muestre el nombre.
**Restricción:** subir el `pageSize` no es opción (topado en 100) y traer todos los instrumentos al
cliente escala mal. La solución es del lado del servidor.

**Va antes que la etapa 4** porque ambas tocan los mismos archivos y las mismas pruebas (§9.1), y
porque, como observa el diagnóstico, con los nombres visibles buena parte de la molestia del
hallazgo 3 se va sola.

### 5.1 El join (resuelve 2 de las 4 pantallas)

En `selectRuns` (`apps/api/src/sheet-scanning/sheet-print.service.ts:632-666`) agregar
`.leftJoin(instruments, eq(instruments.id, sheetLayouts.instrumentId))` y
`instrumentName: instruments.name`. Es literalmente el join que `renderPdf` ya escribe en el mismo
archivo (`:500`), y `instruments` ya está importado (`:16`).

Después, el campo tiene que propagarse por **tres** sitios, no uno:

| Sitio                                  | Línea      | Por qué                                                          |
| -------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `RunRow`                               | `:47-63`   | el tipo de fila                                                  |
| `toModel`                              | `:668-685` | el mapper de `getRun` y `list`                                   |
| **el `return` literal de `createRun`** | `:196-211` | **construye el `PrintRunModel` a mano, sin pasar por `toModel`** |

Olvidar el tercero es el error probable: el nombre saldría bien en toda la app y faltaría sólo en
la respuesta inmediata a crear una tirada.

En `PrintRunModel` (`packages/types/src/schemas/sheet-scanning.schema.ts:268-283`) el campo va como
**`instrumentName?: string | null`**. Opcional es aditivo: los 6 archivos web que consumen el
model lo reciben del API y ninguno lo construye a mano, así que nada se rompe.

Nota: con `leftJoin` el tipo es `string | null` aunque `instruments.name` sea `NOT NULL`. **No
filtrar por `deleted_at`** en el ON: una tirada histórica de un instrumento borrado debe seguir
mostrando su nombre.

Luego, en la web, **eliminar el cruce en memoria**: `escanear/page.tsx:79,92` y
`hojas/page.tsx:181-183` pasan a leer `run.instrumentName`, y ambas dejan de necesitar
`listInstrumentsForSheets()` para esa columna.

### 5.2 Las otras dos pantallas (layouts)

`hojas/page.tsx:120` y `hojas/[id]/imprimir/page.tsx:85` resuelven el nombre desde
`SheetLayoutSummaryModel`, que tampoco lo trae
(`sheet-scanning.schema.ts`, el tipo no tiene `instrumentName`). Mismo tratamiento: join a
`instruments` en el listado de layouts y campo opcional en el summary.

Se puede dejar para una segunda vuelta, pero entonces la etapa **no cumple "siempre se muestra el
nombre"**: quedan dos pantallas con el string. Recomiendo hacerlo en la misma etapa: es el mismo
patrón dos veces.

### 5.3 El selector "Diseñar hoja" — lo que el join no arregla

`DesignSheetDialog` (`hojas/page.tsx:74-82`) necesita **listar** instrumentos para elegir uno. Un
join no aplica. Y el techo de 100 es inamovible por schema.

La causa real de que el instrumento nuevo no aparezca no es el tamaño de la página sino **el
orden**: `instruments.service.ts:96` ordena por `createdAt` **ascendente**, o sea que la página 1
son los 100 más viejos. Lo que uno quiere diseñar es siempre lo recién cargado.

**Recomendación:** agregar un parámetro opcional de orden al DTO **activo**
(`apps/api/src/instruments/dto/instrument.dto.ts:83`) —por ejemplo `sort=recent`— y que
`listInstrumentsForSheets` lo pida. Aditivo y sin efecto sobre los demás consumidores.

**No cambiar el `orderBy` por defecto a `desc()`**: ese listado lo consumen el banco de contenido y
dos pantallas de admin, y darles vuelta el orden sin pedirlo es una regresión silenciosa en la
paginación de todas ellas.

Sigue habiendo un techo (101 instrumentos recientes y vuelve el problema). La solución definitiva
es un parámetro de búsqueda con typeahead; **queda anotada, no la implemento acá** — con el orden
invertido el caso real desaparece por mucho tiempo.

### Archivos

- `apps/api/src/sheet-scanning/sheet-print.service.ts` (`selectRuns`, `RunRow`, `toModel`, `createRun`,
  y el listado de layouts)
- `apps/api/src/instruments/dto/instrument.dto.ts` y `apps/api/src/instruments/instruments.service.ts` (orden)
- `packages/types/src/schemas/sheet-scanning.schema.ts` (`PrintRunModel`, `SheetLayoutSummaryModel`)
- `apps/web/.../hojas/escanear/page.tsx`, `apps/web/.../hojas/page.tsx`,
  `apps/web/.../hojas/[id]/imprimir/page.tsx`, `apps/web/.../hojas/lib/instruments.ts`

### Qué podría romper

- **`sheet-print.service.spec.ts:434-448` congela el shape con `toEqual`.** `MODEL_FIELDS` /
  `RUN_ROW` / `EXPECTED_MODEL` alimentan `expect(model).toEqual(EXPECTED_MODEL)` (`:452`): un campo
  nuevo **rompe el test** hasta que se agrega a los tres objetos. Es el aviso correcto y hay
  precedente exacto de cómo se hizo antes: el `it` de CD-13 (`:561`) agregó `assessmentFormId` al
  model de la misma forma.
- **El mock `makeDb` (`:17-102`) devuelve resultados por orden de llamada a `.select()`.** Agregar
  un join **no** cambia el número de llamadas, así que esta etapa está a salvo; la etapa 4 no.
- **Doble fuente de nombre durante la transición:** si se agrega el campo al backend pero alguna
  pantalla sigue leyendo el `Map`, conviven dos nombres. Borrar los cuatro usos del fallback en la
  misma PR.
- **`listInstrumentsForSheets` queda con menos consumidores.** Si una pantalla deja de llamarla,
  revisar que no quede el import muerto (lo caza `lint`).
- **Regresión de rendimiento: nula.** Un `leftJoin` más sobre `instruments.id` (PK).

### Verificación

| Dónde      | Qué prueba                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI (`api`) | `sheet-print.service.spec.ts` con `instrumentName` en `RUN_ROW`/`EXPECTED_MODEL`; un caso nuevo con `instrumentName: null` (instrumento borrado) para fijar que no rompe.                                                                     |
| CI (`web`) | `typecheck` caza cualquier pantalla que siga leyendo el campo viejo; `next build` valida las server components.                                                                                                                               |
| **Ojo**    | (a) `/hojas/escanear`: las tres tiradas del M2 muestran el nombre real. (b) `/hojas`: tablas de layouts y de tiradas, ídem. (c) `/hojas/[id]/imprimir`: cabecera. (d) Abrir "Diseñar hoja" y confirmar que el instrumento del M2 **aparece**. |

**Retroceso:** revertir. Campo opcional, sin migración, sin datos tocados.

---

## 6. Etapa 4 — Las tiradas corregidas se etiquetan, se ordenan y se pliegan (hallazgo 3)

**Decisión tomada (acordada con el diagnóstico):** **no** agregar columna de estado —es derivable y
dos fuentes de verdad se desincronizan— y **no** ocultarlas, porque re-escanear es legítimo y el
modelo ya lo soporta (`sheet_scans` es idempotente por `(printed_sheet_id, page_index,
image_hash)` y las repeticiones quedan `superseded`). Etiquetar, ordenar y plegar.

**Depende de la etapa 3**: mismos archivos, mismo test, mismo componente.

### 6.1 El predicado ya existe

"Esta tirada ya fue corregida" = _existe un `sheet_scan_batches` con `print_run_id = run.id` y
`status = 'confirmed'`_. El backend ya confía en eso para bloquear una operación destructiva en
`updateRun` (`sheet-print.service.ts:280-298`). Lo que falta es surtirlo a la lista.

### 6.2 Una query agregada, no un EXISTS por fila

Con los ids de la página ya en mano, **una sola** query extra:

```sql
select print_run_id, bool_or(status = 'confirmed') as has_confirmed
from sheet_scan_batches
where org_id = :orgId and print_run_id = any(:ids)
group by print_run_id
```

Es 1 query por listado, no N. Dentro de `withOrgContext` (`sheet_scan_batches` tiene RLS:
`packages/db/sql/rls-policies.sql:323-324,348-349`).

**Con el índice del §1.4.** Sin él es un seq scan de la tabla entera por listado.

En `PrintRunModel`, un campo opcional `hasConfirmedBatch?: boolean`. Vale la pena evaluar sumar
`scannedSheets` para poder decir "3 de 17 hojas", pero eso sale de `sheet_scans` y encarece la
etapa; **recomiendo dejarlo fuera de esta vuelta** y quedarse con la bandera.

### 6.3 La UI

- **Etiqueta:** un `StatusBadge` "Corregida". `PrintRunOptionLabel`
  (`ScanUploadForm.tsx:606-624`) ya tiene el precedente visual de advertencia por tirada (el
  `text-warning` de "Sin evaluación asociada", `:615`): el badge encaja en esa misma zona.
- **Orden y plegado:** el `<SelectContent>` de `ScanUploadForm.tsx:370-377` es **plano**, sin
  `SelectGroup`/`SelectLabel`. Introducir dos grupos ("Pendientes de corregir" / "Ya corregidas")
  con el segundo detrás de un desplegable cerrado por defecto.
- **Ordenar en la web, no en SQL.** La página ya recibe las ≤100 tiradas; ordenar en memoria evita
  meter el agregado en el `ORDER BY` y no rompe la paginación. Ceiling conocido: si alguna vez hay
  más de 100 tiradas, el orden es el de la página, no el global. A los volúmenes actuales es
  inocuo y hay que dejarlo anotado.

### Archivos

- `packages/db/src/schema/sheet-scanning.ts` + una migración de índice
- `apps/api/src/sheet-scanning/sheet-print.service.ts` (`list`, `getRun`, `toModel`, `createRun`)
- `packages/types/src/schemas/sheet-scanning.schema.ts` (`PrintRunModel`)
- `apps/web/.../hojas/escanear/ScanUploadForm.tsx` y `.../hojas/escanear/page.tsx`
- `apps/web/.../hojas/page.tsx` (tabla de tiradas)

### Qué podría romper

- **⚠️ El riesgo principal: los tests de `updateRun` que cuentan llamadas a `.select()`.** El mock
  `makeDb` (`sheet-print.service.spec.ts:17-102`) resuelve resultados **por índice de llamada**.
  Hay cuatro tests que afirman que _no_ se consultan lotes confirmados —`:352`
  ("es idempotente…"), `:387`, `:822`— y `updateRun` termina llamando a `getRun` (`:335`). Si
  `getRun` gana una query, **esos tests se caen o, peor, pasan leyendo el resultado equivocado**.
  Mitigación: que `getRun` **no** traiga el agregado (la bandera sólo la necesita el listado), o
  extender el harness. **Recomiendo lo primero**: `hasConfirmedBatch` sólo en `list`, y que en
  `getRun` quede `undefined`. Es más barato y no toca los tests frágiles.
- **`makeDb` no soporta `.groupBy()`** (`QueryChain`, `:17-26`). La query agregada obliga a
  extender el harness. Es mecánico, pero hay que contarlo en la estimación.
- **`createRun` construye el model a mano** (`:196-211`): una tirada recién creada no tiene lotes,
  así que `hasConfirmedBatch: false` es correcto ahí, pero hay que escribirlo.
- **Regresión de UX si el plegado es agresivo:** si una tirada quedó `needs_review` (no
  `confirmed`), **debe seguir apareciendo arriba como pendiente**. El predicado ya lo hace bien;
  el riesgo es que la UI agrupe por "tiene lotes" en vez de por "tiene lote confirmado".
- **⚠️ Migraciones:** `main` y `dev` tienen cadenas divergentes y ya hubo dos choques por dos ramas
  creando el mismo `000N`. Al generar el índice: `pnpm db:generate`, y si el número choca,
  conservar la meta de `dev`, borrar el `.sql` propio y **regenerar** — no arrastrar.

### Verificación

| Dónde      | Qué prueba                                                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI (`api`) | Un test de `list` que afirme `hasConfirmedBatch: true` para una tirada con lote `confirmed` y `false` con lote `needs_review`. Y que los cuatro tests de `updateRun` **sigan verdes sin tocarlos** (si hay que tocarlos, es la señal de que el agregado se coló en `getRun`). |
| CI (`db`)  | `typecheck`; la migración se aplica en el deploy, no en el CI.                                                                                                                                                                                                                |
| **Ojo**    | (a) `/hojas/escanear`: las tres tiradas del M2 aparecen bajo "Ya corregidas", plegadas. (b) El desplegable se puede abrir y **la tirada sigue siendo seleccionable** (re-escanear no se bloquea). (c) Una tirada sin escanear sigue arriba, sin badge.                        |

**Retroceso:** revertir el código. El índice puede quedarse (es inocuo) o borrarse aparte.

---

## 7. Etapa 5 — La hoja de reserva se identifica viendo la hoja (hallazgo 1)

**Decisión tomada:** que la imagen viaje en el DTO y se muestre en la UI, **con opción de verla en
pantalla grande** para poder leer el nombre escrito a mano.

**Verificado en la BDD por el usuario:** `thumb_file_id` vacío y **`source_file_id` sí poblado**.
Es la etapa más grande de las cinco y la que más se beneficia de ir última.

### 7.1 Backend: exponer el original, no sólo la miniatura

`ReviewScanModel` (`packages/types/src/schemas/sheet-scanning.schema.ts:358-375`) sólo tiene
`thumbUrl`. Agregar:

- `sourceUrl: string | null`
- `sourceMimeType: string | null`
- `sourcePageIndex: number | null`

Los tres últimos son los que permiten ramificar PDF vs. imagen (§1.1). La maquinaria ya está:
`buildFileUrlIndex` (`scan-review.service.ts:881-897`) es genérica sobre cualquier lista de
`fileIds`, filtra por `files.orgId` y emite la URL prefirmada `inline`. Sólo hay que sumar
`sourceFileId` a `ScanQueueRow` (`:106-120`) y al índice.

**⚠️ Hay cuatro sitios que construyen `thumbUrl`, no uno.** Olvidar alguno deja la imagen
faltando en un sub-camino concreto:

| Sitio                 | Línea  | Camino                         |
| --------------------- | ------ | ------------------------------ |
| `assignIdentity`      | `:424` | respuesta al asignar el alumno |
| `discardScan`         | `:470` | respuesta al descartar         |
| `selectBatchScans`    | `:748` | la cola completa               |
| `selectScanForReview` | `:817` | una página suelta              |

y el mapper común `toReviewScanModel` (`:918-934`).

### 7.2 Frontend: el diálogo elige la mejor imagen disponible

En `ReviewQueue.tsx`:

1. **`ScanPreviewDialog:191`** deja de anularse con `!scan.thumbUrl` y pasa a anularse sólo si
   **no hay ninguna** imagen. El disparador sigue mostrando el thumb si existe.
2. **La imagen grande** (`:214-218`) usa `sourceUrl` cuando `sourceMimeType` empieza con `image/`;
   si no, cae al `thumbUrl`.
3. **Cuando el original es un PDF**, no meterlo en un `<img>`: ofrecer un enlace "Abrir la hoja
   original" a `sourceUrl#page=N` (con `sourcePageIndex + 1`) y dejar el thumb inline.
4. **El texto de `:220-223` es condicional.** Hoy afirma que la imagen "es una miniatura […] no
   para leer letra chica": con el original a la vista esa frase es falsa y desalienta justo la
   acción que queremos.
5. **`IdentityRow:454`** cambia `<ScanThumb scan={scan} />` por el diálogo, con
   `onDiscardRequested` vuelto **opcional** (§1.3) y sin botón de descarte.
6. **La `CardDescription` de la sección** (`:403-405`) dice "Asigna el alumno mirando la
   miniatura": actualizar.

### 7.3 Complemento opcional en el motor — va en PR aparte

`needs_thumb` (`services/omr/app/pipeline.py:272`) es
`not quality["ok"] or identity["raw"] is None`. **El motor no puede saber que es una hoja de
reserva**: el QR es legible y la calidad es OK. No hay condición que agregar que distinga ese caso.

La única opción real es **emitir siempre la miniatura**. Cuesta un JPEG de 400 px por página
(decenas de KB) y elimina de raíz la clase de bug "no hay ninguna evidencia de esta página" —
incluyendo los lotes subidos como PDF, donde el original no se puede mostrar inline.

**Recomiendo hacerlo, pero en su propia PR**, porque despliega otro servicio (`deploy-omr.yml`,
App Runner) con su propio ciclo, y porque la etapa 5 tiene que funcionar sin él (los lotes viejos
ya tienen `thumb_file_id` NULL y ninguna miniatura nueva los va a rescatar).

### Archivos

- `packages/types/src/schemas/sheet-scanning.schema.ts` (`ReviewScanModel`)
- `apps/api/src/sheet-scanning/scan-review.service.ts` (`ScanQueueRow`, las 4 construcciones, el mapper)
- `apps/web/.../hojas/lotes/[batchId]/revisar/ReviewQueue.tsx`
- (PR aparte) `services/omr/app/pipeline.py`

### Qué podría romper

- **Fuga de datos entre tenants: es el riesgo serio de esta etapa.** La URL prefirmada apunta al
  archivo **completo del lote**, no a una página. `buildFileUrlIndex` ya filtra por
  `files.orgId = orgId`, así que el aislamiento se mantiene — **pero hay que dejarlo cubierto por
  un test**, porque acá se pasa de exponer un recorte de una página a exponer el archivo original
  entero.
- **Un usuario que abre el PDF ve las hojas de todos los alumnos del lote**, no sólo la suya. Es
  la misma org y el mismo lote que esa persona ya está revisando, así que no es una fuga; pero es
  un cambio de exposición que conviene nombrar en la PR (y una razón más para preferir la
  miniatura por página cuando exista).
- **Peso de la imagen.** El original puede ser un JPEG de varios MB o un PDF de 17 páginas. El
  diálogo no debe precargarlo: cargar la imagen grande **al abrir**, no al pintar la fila, o la
  cola con 17 identidades sin resolver se vuelve lentísima.
- **Los cuatro sitios del §7.1**: el olvido típico deja el original en la cola y ausente tras
  asignar una identidad.
- **`ReviewScanModel` es un `type` plano, no un schema Zod**: no hay validación en runtime que
  avise si el backend deja de mandar un campo. Por eso los campos van **opcionales** y la UI tolera
  `null` en los tres.
- **Regresión en las filas que hoy funcionan:** `ScanRow` (hojas en blanco e ilegibles) usa el
  mismo diálogo. Cambiar la elección de imagen las afecta también — deseable, pero hay que
  mirarlas.

### Verificación

| Dónde        | Qué prueba                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI (`api`)   | `scan-review.service.spec.ts`: que `sourceUrl` salga poblado en los cuatro caminos, y un caso con `sourceFileId` de **otra org** que devuelva `null` (el test de aislamiento).                                                                                                                                                             |
| CI (`types`) | Si la elección de imagen se extrae a un helper puro (`pickScanImage(scan)`), queda cubierta acá. **Recomendado**, por §2.                                                                                                                                                                                                                  |
| CI (`omr`)   | Sólo si se toca `pipeline.py`: `pytest` cubre el goldset.                                                                                                                                                                                                                                                                                  |
| **Ojo**      | (a) Un lote **con hoja de reserva** subido como **JPEG**: la fila muestra imagen y el diálogo abre el original legible. (b) El mismo caso subido como **PDF**: aparece el enlace a la hoja original, no una imagen rota. (c) Hojas en blanco e ilegibles siguen viéndose bien. (d) Asignar el alumno y confirmar que la fila se actualiza. |

**Retroceso:** revertir. Campos opcionales, sin migración, sin datos tocados.

---

## 8. Lo que necesito de la BDD antes de ejecutar

El túnel lo administra el usuario. Sólo **una** consulta es bloqueante.

**Bloqueante — etapa 2, antes de la limpieza del §4.2.** Cuántas organizaciones tienen un
`quickConfirm: false` que habría que limpiar:

```sql
select id, name, config->'review' as review
from organizations
where config->'review' ? 'quickConfirm'
  and (config->'review'->>'quickConfirm') = 'false';
```

Si devuelve 0 filas, la limpieza sobra y la etapa 2 es sólo código. Si devuelve pocas, se puede
decidir encenderlas a mano en vez de correr el `update`.

**No bloqueante — etapa 3.** Cierra la predicción falsable del diagnóstico y **se responde sin
SQL**: abrir el desplegable "Diseñar hoja" en `/hojas` y ver si el instrumento del M2 aparece. Si
**sí** aparece, 4b queda descartado y hay que buscar otra causa antes de tocar el orden (aunque el
join del §5.1 arregla las etiquetas igual).

**No bloqueante — etapa 5.** Saber si el lote del M2 se subió como PDF o como JPEG decide cuál de
las dos ramas del §7.2 es la que se ejercita primero:

```sql
select f.mime_type, count(*)
from sheet_scans s join files f on f.id = s.source_file_id
where s.batch_id = '<batchId>'
group by 1;
```

---

## 9. Dependencias, paralelismo y agrupación en PRs

### 9.1 Dependencias

```
Etapa 1 (spinner) ─────────────────────────┐
Etapa 2 (quickConfirm) ────────────────────┤
Etapa 3 (nombre) ──► Etapa 4 (corregidas) ─┤──► listo
Etapa 5 (hoja de reserva) ─────────────────┘
```

- **Etapa 4 depende de la etapa 3.** No es una dependencia lógica sino de archivos: ambas tocan
  `selectRuns`, `RunRow`, `toModel`, el `return` de `createRun`, `PrintRunModel`,
  `sheet-print.service.spec.ts` (`MODEL_FIELDS`/`RUN_ROW`/`EXPECTED_MODEL`), `ScanUploadForm.tsx`
  y `escanear/page.tsx`. En paralelo se pisan en cada uno de esos puntos.
- **Las etapas 1, 2, 3 y 5 son mutuamente independientes**: conjuntos de archivos disjuntos.
- **Ninguna toca `listAssessments` ni `item-analysis`** (el hallazgo 6, que lleva otra persona).

### 9.2 Recomendación: **cuatro PRs**, no cinco y no una

| PR              | Etapas                           | Por qué agrupadas así                                                                                                                                                            |
| --------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**           | 1 (spinner)                      | Dos archivos, riesgo nulo, se revisa en cinco minutos. Ship inmediato: deja de verse roto mientras el resto se revisa.                                                           |
| **B**           | 2 (quickConfirm)                 | **Es la única que toca datos de organizaciones reales.** Tiene que poder revisarse —y revertirse— sin arrastrar nada. Su PR es donde vive la discusión de la limpieza del §4.2.  |
| **C**           | 3 → 4 (nombre, luego corregidas) | Mismos archivos y mismas pruebas: separarlas produce conflictos garantizados. Van como **dos commits** en una PR, en ese orden, para que la revisión pueda leerlas por separado. |
| **D**           | 5 (hoja de reserva)              | Cambio de superficie de exposición (URL al archivo original) + aislamiento entre tenants: merece su propia revisión.                                                             |
| _(E, opcional)_ | motor: miniatura siempre         | Despliega **otro servicio** (`deploy-omr.yml`). Nunca en la misma PR que cambios de Node.                                                                                        |

**Por qué no una sola PR.** Las cinco tienen perfiles de riesgo y de retroceso incompatibles: la 2
se revierte con una decisión sobre datos, la 1 con un `git revert`, la 5 con una revisión de
seguridad. Mezclarlas obliga a revertir las cinco para deshacer una, y vuelve la revisión inútil:
nadie mira con el mismo cuidado un `animate-spin` y un cambio de default que afecta a todas las
organizaciones. Además tocan **tres pipelines de deploy distintos** (frontend SST, backend App
Runner, OMR App Runner).

**Por qué no cinco.** Separar 3 y 4 sólo produce trabajo de conflictos sin ganar nada en revisión.

### 9.3 Orden de ejecución sugerido

1. **A** (spinner) — inmediata.
2. **C** (nombre → corregidas) — es la que más alivia la próxima corrida.
3. **B** (quickConfirm) — en cuanto se responda la consulta bloqueante del §8.
4. **D** (hoja de reserva) — la más grande.
5. **E** (motor) — cuando D esté mergeada.

A, B y D pueden ir en paralelo si hay varias manos; C es la única con orden interno.

---

## 10. Observaciones colaterales (fuera del alcance de este plan)

No las implemento acá; las dejo anotadas porque salieron de leer este código.

- **Dos `listInstrumentsQuerySchema` (§1.5).** El de `packages/types` usa `limit` y el de
  `apps/api/.../dto/` usa `pageSize`; sólo el segundo está activo. Eso ya tiene víctimas:
  `banco-contenido/(hub)/explorar/data.ts:35` y `admin/instrumentos-bandas/page.tsx:42` piden
  `?limit=200` y **reciben 20**, porque `limit` es una clave desconocida que Zod descarta y
  `pageSize` cae a su default. Es la tercera aparición del patrón que el hallazgo 6 describe, y la
  ironía es que `common.schema.ts:26-28` documenta este mismo bug **ya ocurrido una vez**. Amerita
  la auditoría de una pasada que propone el diagnóstico.
- **`sheet_scan_batches` sin ningún índice** (§1.4). Más allá de esta etapa, la tabla crece con
  cada lote y hoy todo acceso que no sea por PK es seq scan.
- **`review-settings.service.ts` hace read-modify-write del `config`** completo en JS. Dos
  guardados concurrentes de pantallas distintas de configuración se pisan entre sí.
- **`apps/web` sin tests** (§2). Contradice CLAUDE.md §10.2 ("los componentes de UI críticos
  tienen tests con React Testing Library"). Las cinco etapas conviven con eso empujando la lógica
  a `@soe/types`, pero es deuda estructural: los dashboards y la cola de revisión no tienen red.

---

## 11. Resumen

| Etapa | Hallazgo                   | PR           | Depende de | Riesgo                             | CI puede probarlo    | Hay que mirarlo      |
| ----- | -------------------------- | ------------ | ---------- | ---------------------------------- | -------------------- | -------------------- |
| 1     | 5 · spinner                | A            | —          | Nulo                               | Compila              | **Sí** (que gire)    |
| 2     | 2 · Sí/No por defecto      | B            | —          | **Medio** (datos de orgs reales)   | Sí (`types` + `api`) | Sí (toggle y cola)   |
| 3     | 4 · nombre del instrumento | C (commit 1) | —          | Bajo                               | Sí (`api`)           | Sí (4 pantallas)     |
| 4     | 3 · tiradas corregidas     | C (commit 2) | Etapa 3    | Medio (tests frágiles + migración) | Sí (`api`)           | Sí (orden y plegado) |
| 5     | 1 · imagen de la hoja      | D            | —          | **Medio** (exposición de archivos) | Sí (`api`)           | **Sí** (PDF y JPEG)  |
| —     | motor: miniatura siempre   | E            | Etapa 5    | Bajo                               | Sí (`omr`)           | No                   |

**Lo único bloqueante para empezar** es la consulta del §8 para la etapa 2. Las etapas 1, 3, 4 y 5
se pueden ejecutar hoy.
