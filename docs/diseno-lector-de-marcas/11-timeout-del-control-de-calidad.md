# 11 — Timeout del control de calidad en la captura móvil

> **Estado:** implementado.
> **Alcance:** `apps/web/src/app/movil/hojas/[sessionId]/`, `apps/web/src/lib/capture-transport.ts`,
> `CaptureTransport` en `packages/types`.
> **Antecedente:** [09](./09-robustez-de-encuadre.md) (por qué existe el control de calidad),
> PR #225 (rediseño del escáner móvil), PR #228 (geometría de las guías).

---

## El problema

El rediseño del escáner móvil desacopló el obturador de las subidas: una hoja aceptada
sube en segundo plano y el botón queda libre de inmediato, que es lo que permite
encadenar lotes de cientos. Como contrapartida, **el control de calidad quedó como lo
único que bloquea el obturador**.

Eso convierte una petición que no responde en una captura muerta. El estado `assessing`
sólo sale de ahí con la respuesta del `assess`, y esa respuesta puede no llegar nunca: no
había ni timeout ni cancelación en ningún punto del camino.

El modo de falla se observó en la primera prueba en teléfono (2026-09-08). Un disparo
quedó en «Evaluando calidad de la hoja 1…» durante **66 segundos**, con el obturador
inerte y sin ninguna acción disponible. Se recuperó sólo porque el `fetch` terminó
abortando por su cuenta — un comportamiento del navegador que no se controla y que en iOS
puede tardar mucho más.

Diagnóstico de ese caso concreto, para no confundir causas:

| Hecho                                                 | Evidencia                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| El cuerpo del `assess` son ~0,6 MB                    | ngrok: `POST /api/capture-proxy/assess`, 0.62 MB           |
| La petición nunca llegó completa a la API             | No hay línea de `POST /api/sheet-capture/assess` en su log |
| El servicio de lectura caído **no** explica la espera | Con OMR abajo el `assess` falla en 25–92 ms (500)          |
| Con OMR arriba, evaluar tarda ~336 ms                 | `POST /api/sheet-capture/assess → 201 (336ms)`             |

O sea: la espera fue de red (el túnel de pruebas), no de procesamiento. Pero la causa
puntual es lo de menos. Lo que el incidente demuestra es que **el visor no tenía defensa
contra una evaluación que no vuelve**, venga la demora de donde venga: wifi del colegio,
servicio de lectura degradado o un intermediario.

## Por qué un temporizador de interfaz no alcanza

La solución evidente —un `setTimeout` que devuelve el visor a `live`— es incorrecta.

La petición seguiría viva. Cuando termine, treinta segundos después y con la hoja
siguiente ya encuadrada, su `onSuccess` va a escribir sobre un estado que ya cambió:
puede subir una foto que el usuario dio por perdida, o pisar el veredicto de una hoja
posterior. Se cambia una captura congelada por una corrupción silenciosa del lote, que es
peor porque nadie la ve.

**La cancelación tiene que ser real.** El timeout aborta la petición con `AbortController`
y la interfaz reacciona al error resultante; no al revés.

Cancelar un `assess` es seguro y no deja estado a medias: la subida al lote sólo arranca
**después** de que la foto se acepta (`upload()` se llama dentro de `onSuccess`). Abortar
antes de eso no puede dejar una hoja huérfana.

## Dos etapas, no un corte único

Un corte corto y duro sería un error de diseño. Una hoja son ~0,6 MB y el enlace de un
colegio es lento de verdad: abortar a los 15 segundos convertiría una subida sana pero
lenta en un rechazo falso, y el usuario repetiría una foto que iba a funcionar.

La regla es la misma del corpus de guías de captura ([09](./09-robustez-de-encuadre.md)):
**no culpar al usuario de algo que no es su culpa.** Una conexión lenta no es un encuadre
malo.

### Etapa 1 — a los 8 segundos: avisar y ofrecer salida

No se aborta nada. El aviso deja de prometer que «toma un segundo» y pasa a decir la
verdad, con un botón de salida:

> **Sigue evaluando la hoja 13…**
> La conexión está lenta. Puedes esperar o cancelar y tomar la foto de nuevo.
>
> `[ Cancelar y volver a disparar ]`

La decisión es del usuario, no del temporizador. Quien está frente al montón de hojas sabe
si le conviene esperar o reintentar; el código no.

### Etapa 2 — a los 45 segundos: abortar solo

A esa altura el obturador lleva demasiado tiempo muerto y esperar más no aporta
información. Se aborta y el visor vuelve a vivo con un veredicto propio:

> **No se pudo evaluar la foto**
> La conexión tardó demasiado y la hoja no entró al lote. Revisa la señal y vuelve a
> disparar.

Es un estado distinto de `rejected`: la foto **no fue rechazada** por el control de
calidad, no se llegó a evaluar. Mezclarlos le diría al usuario que su encuadre estuvo mal
cuando el problema fue la red.

Los dos caminos —cancelar y agotar el tiempo— terminan en `live`, así que no aparece
ninguna rama de estado que haya que mantener aparte.

## Máquina de estados

```
                    ┌──────────────────────────── éxito, aceptada ──────┐
                    │                                                   ▼
  live ──disparo──► assessing ──8 s──► assessing (slow) ──45 s──► assess-timeout
   ▲                    │                     │                          │
   │                    │                     └── cancelar ──┐           │
   │                    ├── rechazada ──► rejected           │           │
   │                    └── en blanco ──► blank-confirm      │           │
   └──────────────── siguiente disparo ─────────────────────┴───────────┘
```

`assess-timeout` y `rejected` no bloquean el obturador: se disparan encima. Sólo
`assessing` lo bloquea, y ahora tiene techo.

## Contrato

`CaptureTransport.assess` gana un segundo parámetro **opcional**:

```ts
assess(imageBase64: string, signal?: AbortSignal): Promise<AssessCaptureResponse>;
```

Opcional a propósito: el escáner de escritorio no cancela evaluaciones y no tiene por qué
cambiar. Las dos implementaciones del transporte y el `CameraCaptureSection` compartido
siguen compilando; sólo la del teléfono reenvía el `signal` al `fetch`.

`captureProxyPost` distingue el aborto de una caída de red:

```ts
if (err instanceof DOMException && err.name === 'AbortError') throw err;
throw new ApiConnectionError();
```

Sin eso, cancelar mostraría un error de conexión que no ocurrió.

El hook `useAssessCapture` pasa a recibir sus variables como objeto
(`{ imageBase64, signal? }`) para poder acarrear el `signal` por react-query.

## Decisiones y descartes

| Decisión                                        | Por qué                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cancelar de verdad, no sólo cambiar la interfaz | Una petición zombi escribe sobre estado ajeno                                                  |
| 8 s para avisar                                 | Bajo el umbral de «esto se colgó», sobre el tiempo normal (~0,3 s de evaluación más la subida) |
| 45 s para abortar                               | Deja subir 0,6 MB por un enlace malo sin dejar el obturador muerto un minuto                   |
| Estado propio, no `rejected`                    | No decirle al usuario que encuadró mal cuando falló la red                                     |
| No conservar la foto abortada                   | La hoja sigue sobre la mesa; repetir es más barato que gestionar una cola de reintentos        |
| `signal` opcional en el contrato                | No arrastrar al escáner de escritorio a un cambio que no necesita                              |

## Lo que queda pendiente

**Separar subida de procesamiento.** Hoy el `assess` va por `fetch`, que no reporta
progreso de subida, así que el aviso de lentitud es una conjetura: no se sabe si la demora
es de red o del lector. Con `XMLHttpRequest` —como ya hace `putToStorage` para S3— se
podría mostrar «subiendo la foto: 60%» y arrancar el temporizador de proceso recién
cuando el cuerpo terminó de viajar. En el incidente de la primera prueba eso habría dicho
de inmediato que la demora era del enlace.

Se deja fuera por ahora: toca el transporte compartido y el valor está en el diagnóstico,
no en desbloquear al usuario, que es lo que este cambio resuelve.

**Reintento automático.** Descartado por ahora. Un reintento sobre un enlace saturado
duplica el tráfico justo cuando escasea, y el usuario tiene la hoja en la mano: volver a
disparar es más rápido y más predecible que una cola invisible.
