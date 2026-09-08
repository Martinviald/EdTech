# Plan — Optimizar el backfill de cohort-stats en el deploy de backend

> **Estado:** propuesta. Nada implementado. Rama `docs/optimizar-backfill-cohort-stats`.
> **Alcance:** sólo las dos medidas ya elegidas — (1) gate para no correr el backfill
> en cada deploy, (3) paralelismo acotado dentro del backfill.
> **Fuera de alcance (descartado por el usuario):** correr el backfill dentro de la VPC
> (Lambda/ECS) y el incremental por `computed_at`.

---

## 1. Punto de partida (medido, no re-medir)

`.github/workflows/deploy-backend.yml` dispara con cualquier push a `main` que toque
`apps/api/**`, `packages/db/**`, `packages/types/**`, `pnpm-lock.yaml` o el propio
workflow. Reparto del job `migrate` en los runs `34080022370` (07-sep) y `34248158431`
(08-sep):

| Paso | Tiempo |
|---|---|
| setup del runner (checkout, node, pnpm, build de `@soe/types`, plugin SSM) | ~40 s |
| `db:migrate` (drizzle + re-aplicar `sql/rls-policies.sql`) | **~12 s** |
| `db:backfill:cohort-stats` (242 evaluaciones, ~2,6 s c/u) | **10 min 12 s** |
| build + push de la imagen a ECR (job `build-and-push`) | ~1 min 35 s |

El backfill es el **98% del tiempo de base de datos**. Las migraciones no son el problema.

**La causa es latencia, no cómputo.** El runner está en Azure westus, el RDS en
`us-east-1`, y cada consulta cruza el port-forward SSM contra el bastión. El script
procesa las evaluaciones **en serie**, cada una en su propia transacción corta y con
reintento por reconexión — decisión deliberada para sobrevivir a los cortes del túnel
(ver el comentario de cabecera de `packages/db/src/scripts/backfill-cohort-stats.ts`).
Cada evaluación son ~10 round-trips: cargar `responses`, cargar `skill_results`,
resolver matrícula (`loadEnrollmentByStudent`, hasta 3 consultas), 2 `DELETE` y los
`INSERT` en chunks de 500 (`INSERT_CHUNK` en `packages/db/src/queries/cohort-stats.ts`).

Con ~2,6 s por evaluación y ~10 round-trips, el RTT efectivo ronda los 250 ms: el
proceso está **esperando la red**, no calculando. Por eso el paralelismo acotado sirve
tanto acá y no serviría si el cuello fuera CPU o el RDS.

### Restricciones que el plan no puede romper

- `deploy-backend.yml:24` — el job `migrate` **gatea** el build (`needs: migrate`) a
  propósito: las migraciones son aditivas y deben estar aplicadas antes de que App
  Runner levante la imagen nueva.
- Cabecera del script — *"NO es opcional después de una migración. Desde la Fase 2 los
  lectores ya no derivan de `responses`: leen del read-model; migrar sin correr esto
  deja la analítica en blanco"*. **Cualquier gate tiene que seguir corriendo el backfill
  cuando hay migración nueva.**
- RLS: toda escritura corre dentro de `withOrgContext` (CLAUDE.md §5.2).
- El backfill es idempotente por evaluación (delete + reinsert). Esa propiedad es la
  que habilita tanto el reintento actual como el paralelismo propuesto.

---

## 2. Medida (1) — Gate: no correr el backfill en cada deploy

### 2.1 El riesgo que hay que atacar

El backfill **sólo** hace falta cuando:

- **a)** cambia la semántica del calculador —
  `aggregateItemStats` / `aggregateCohortSkillStats` en
  `packages/types/src/utils/item-stats-calculator.ts`, o
  `recomputeCohortStatsFromResponses` / `loadEnrollmentByStudent` / `replaceCohortStats`
  en `packages/db/src/queries/cohort-stats.ts`; o
- **b)** una migración nueva toca el read-model (columnas de
  `assessment_item_stats` / `assessment_skill_stats`, o las tablas de las que deriva).

El modo de falla a evitar es exactamente uno, y es el peor posible: **alguien cambia el
calculador, el gate no se dispara, y la analítica queda con números viejos sin que nadie
se entere.** No hay error, no hay página en blanco, no hay alerta: los dashboards siguen
mostrando cifras plausibles y equivocadas. Un gate que se pueda "olvidar" no es un gate.

### 2.2 Alternativas evaluadas

| Opción | Cómo dispara | Modo de falla | Veredicto |
|---|---|---|---|
| **A. Path filter** sobre los archivos del calculador en el workflow | El step del backfill corre sólo si el diff toca esos paths | **Silencioso.** Un cambio semántico en un archivo *no listado* del que el calculador depende (un helper de `@soe/types`, un cambio en el `value` de `responses`) no dispara nada. La lista se desactualiza sola y nadie lo nota. | Insuficiente sola |
| **B. Trailer en el commit** (`Backfill-cohort-stats: yes`) | Quien cambia la semántica lo declara | **Depende de la memoria humana**, que es justo lo que falla. Además el trailer se pierde en un squash-merge. | Descartada |
| **C. Input de `workflow_dispatch`** | Se corre a mano cuando hace falta | Mismo problema que B, más el de que un push normal a `main` nunca lo corre. Útil como **escape hatch**, no como gate. | Complementaria |
| **D. Huella (hash) del calculador guardada en la BDD**, comparada en cada deploy | El deploy calcula la huella del código de agregación y la compara con la última guardada; si difieren, corre el backfill y re-estampa | **También silencioso si la huella cubre menos archivos de los que realmente influyen** — pero, a diferencia de A, la huella se puede derivar del *cierre de imports real* y auditar con un test | **Recomendada** |

### 2.3 Recomendación: huella en la BDD (D), con tres refuerzos

**Mecanismo.** Una tabla nueva de una sola fila, p. ej. `read_model_stamp`
(`packages/db/src/schema/results.ts`, sin `org_id`: es estado del despliegue, no de un
tenant; RLS no aplica porque no tiene datos de tenant, y sólo la escribe `soe_admin`):

```
read_model_stamp
  id                text PK  -- 'cohort_stats'
  calculator_hash   text NOT NULL
  migration_tag     text NOT NULL   -- última entrada de __drizzle_migrations
  backfilled_at     timestamptz NOT NULL
  assessments_count integer NOT NULL
```

En el job `migrate`, después de `db:migrate` y dentro del mismo túnel, corre un script
nuevo `db:check:cohort-stamp` que:

1. calcula `calculator_hash` = SHA-256 sobre el **contenido concatenado del cierre
   transitivo de imports** de `recomputeCohortStatsFromResponses` (resuelto en tiempo de
   ejecución con el grafo de módulos, no con una lista escrita a mano);
2. lee la última entrada aplicada de `__drizzle_migrations` como `migration_tag`;
3. decide `RUN_BACKFILL=true` si **cualquiera** de estas se cumple:
   - la huella difiere de la guardada (cambió la semántica),
   - el `migration_tag` difiere del guardado (hubo migración nueva — cubre el caso b y
     respeta la nota "no es opcional después de una migración"),
   - no hay fila (BDD nueva, restore, stage nuevo),
   - el input `force_backfill` de `workflow_dispatch` viene en `true`;
4. si corrió el backfill con éxito, **re-estampa** la fila. Si el backfill falla, **no**
   se estampa: el próximo deploy lo vuelve a intentar. Nunca queda "marcado como hecho"
   algo que no se hizo.

**Por qué esta y no el path filter.** Comparten la clase de falla (una huella
incompleta se parece a un filtro incompleto), pero la huella tiene tres ventajas que el
filtro no puede tener:

- se deriva del grafo de imports **real**, no de una lista en YAML que nadie mantiene;
- vive en la BDD, así que también dispara cuando la BDD está atrás por razones ajenas al
  commit (restore, stage nuevo, un deploy fallido a mitad, un rollback de código);
- es **auditable**: `read_model_stamp` dice cuándo se pobló por última vez y con qué
  versión del calculador. El path filter no deja rastro.

**Modo de falla declarado, sin maquillaje.** Si alguien cambia la semántica sin tocar
ningún archivo del cierre de imports —por ejemplo, cambiando la forma del JSONB
`responses.value` que el calculador interpreta, o el significado de `isCorrect` río
arriba— la huella no se mueve y la analítica queda vieja **en silencio**. Ese hueco no
se cierra con ningún gate basado en código. Se acota con los tres refuerzos:

- **R1 — test de cierre.** Un test unitario que recalcula el cierre de imports y falla si
  aparece un archivo que la huella no cubre. Convierte "la lista se desactualizó" de
  fallo silencioso en CI rojo.
- **R2 — backfill completo programado.** Un `schedule` semanal (domingo de madrugada) que
  corre el backfill completo, sin gate. Cuesta 10 min de runner por semana y **auto-cura
  cualquier hueco en ≤7 días**, incluidos los que ningún gate detecta. Es el seguro
  barato que hace aceptable el resto del diseño.
- **R3 — smoke check en todo deploy.** Siempre, corra o no el backfill, una consulta de
  ~1 s que verifica que `assessment_item_stats` no está vacía y que su
  `assessments_count` distinto coincide con el estampado. Si el read-model quedó en
  blanco, el deploy **falla** en vez de publicar una analítica muda. Este check es lo que
  reemplaza la garantía que hoy daba correr el backfill siempre.

**Escape hatch (C, complementaria).** Input `force_backfill: boolean` en
`workflow_dispatch`, para forzarlo a mano sin tocar código.

### 2.4 Impacto

Deploy típico (sin cambio de calculador ni migración): `migrate` baja de ~11 min a
**~1 min** (setup 40 s + migrate 12 s + stamp/smoke ~5 s). El build ya no espera 10 min.

---

## 3. Medida (3) — Paralelismo acotado dentro del backfill

### 3.1 Por qué es seguro

Cada evaluación ya es su propia transacción idempotente y **no comparte estado con las
demás**: `replaceCohortStats` hace `DELETE`+`INSERT` filtrando por `assessment_id`, así
que dos workers sobre evaluaciones distintas nunca tocan las mismas filas. No hay orden
que preservar. La resiliencia no se pierde: si una evaluación falla, se reintenta esa
sola, igual que hoy.

### 3.2 El punto delicado: el holder de conexión compartido

Hoy hay **un solo holder** (`const holder = { db: makeDb() }`) y `withDbRetry`, ante un
corte, hace `holder.db = makeDb()` — reemplaza el cliente **para todos**. En serie eso es
inofensivo. Con 6-8 workers en vuelo introduce dos problemas:

- **Reconexión en estampida:** si el túnel corta, los 8 workers detectan el corte y los 8
  llaman a `makeDb()`. Se crean 8 pools, 7 quedan huérfanos con sus sockets abiertos.
- **Cambio de cliente bajo los pies:** un worker que reconecta le cambia `holder.db` a
  otro que ya tenía una transacción viva en el cliente anterior.

**Diseño propuesto — holder compartido con reconexión guardada por generación.** Se
mantiene *un* pool (es lo que quiere postgres.js: el pool ya multiplexa conexiones, y el
port-forward SSM acepta varias conexiones TCP simultáneas), y se cambia sólo el
protocolo de reconexión:

```
holder = { db, gen: 0 }          // gen = número de generación del cliente

withDbRetry(op, label):
  snapshot = holder.gen
  intento sobre holder.db
  si falla con error transitorio y quedan intentos:
     await reconnect(snapshot)   // serializado
     reintentar

reconnect(snapshot):
  si holder.gen !== snapshot: return   // otro worker ya reconectó; reusar su cliente
  si hay una reconexión en curso: await esa promesa
  cerrar el cliente viejo (db.$client.end({ timeout: 5 })), abrir uno nuevo, holder.gen++
```

Propiedades: **una sola reconexión por corte** (los otros 7 workers esperan la misma
promesa y se cuelgan del cliente nuevo), **sin pools huérfanos**, y ningún worker cambia
el cliente que otro está usando en una transacción viva — el que estaba a mitad de
transacción ya falló con el mismo corte y va a reintentar contra la generación nueva.

**Pool.** `createDbClient` usa `max: 10`. Con 8 workers concurrentes, cada uno con una
transacción (= 1 conexión tomada), quedan 2 de margen; alcanza, pero justo. Se agrega un
parámetro opcional `maxConnections` a `createDbClient` (default 10, sin cambio para el
resto del proyecto) y el backfill pide `concurrencia + 2`. **No** se toca el default
global.

**Forma del loop.** Se reemplazan los dos `for` anidados por:

1. una fase de **listado** (secuencial, barata: una consulta por org) que arma una cola
   plana de `{ orgId, assessmentId, name }`;
2. un **pool de N workers** que consumen esa cola; cada tarea sigue siendo
   `withDbRetry(… withOrgContext(db, orgId, tx => backfillAssessment(tx, id)))`, idéntica
   a hoy.

`withOrgContext` fija `app.current_org_id` con `set_config(..., true)`
(*transaction-scoped*), así que es seguro con varias transacciones en paralelo sobre el
mismo pool: cada una tiene su propio contexto y ninguna ve el de otra. **Esto es
requisito, no detalle:** si el contexto fuera de sesión, el paralelismo mezclaría tenants.

**Concurrencia.** Flag `--concurrency <n>` (default **6**), con override por env
`BACKFILL_CONCURRENCY` para poder bajarla desde el workflow sin tocar código. 6 y no 8
como default porque el margen de pool y de sockets del túnel se mantiene cómodo; el plan
incluye medir 6 vs 8 antes de fijarlo (Etapa E).

**Errores.** Hoy un error no transitorio mata el proceso. Con workers: el primer error no
transitorio deja de tomar tareas nuevas, se espera a que las tareas en vuelo terminen (no
se abortan a mitad: cortar una transacción a la mitad no aporta nada y ensucia el log), y
se sale con código 1 reportando qué evaluaciones quedaron sin procesar. **El proceso nunca
debe salir 0 con evaluaciones pendientes** — eso estamparía un read-model incompleto como
bueno.

**Logs.** Con 6 workers las líneas se intercalan. Cada línea lleva ya el `assessmentId`,
así que sigue siendo rastreable; se agrega un contador `[n/total]` y el resumen final se
mantiene idéntico (incluido el agregado de `orphanResponses`, que no cambia de semántica).

### 3.3 Impacto esperado

Trabajo dominado por latencia y sin contención entre tareas ⇒ el speed-up debería
acercarse a lineal hasta que aparezca otro cuello (el túnel SSM o el RDS). Estimación
conservadora **4-5×**: de 10 min 12 s a **~2-2,5 min**. Combinado con la medida (1), el
deploy que *sí* necesita backfill baja de ~11 min a ~3,5 min, y el que no, a ~1 min.

---

## 4. Etapas, con criterio de verificación

Cada etapa es un commit verificable por separado. Las etapas A-C y D-F son independientes
entre sí y se pueden hacer en cualquier orden; **F va última**.

### Etapa A — Paralelismo en el script (sin tocar el workflow)

Reescribir el loop de `backfill-cohort-stats.ts` como cola plana + pool de workers,
agregar `--concurrency` / `BACKFILL_CONCURRENCY`, y el manejo de errores descrito en §3.2.
Sin tocar `withDbRetry` todavía.

**Verificación:**
- `pnpm --filter @soe/db db:backfill:cohort-stats --dry-run` lista las mismas
  evaluaciones que hoy (mismo conteo, mismo conjunto de IDs).
- Contra la BDD **local**: snapshot de `assessment_item_stats` + `assessment_skill_stats`
  antes y después (`ORDER BY assessment_id, class_group_id, item_id`, ignorando
  `computed_at`); el diff debe ser **vacío**. Es la prueba de que el paralelismo no cambió
  ningún número.
- Correr con `--concurrency 1` produce exactamente el mismo resultado y el mismo resumen
  final que la versión actual.

### Etapa B — Reconexión guardada por generación

Cambiar `withDbRetry` al protocolo de §3.2 y agregar `maxConnections` a `createDbClient`.

**Verificación:**
- Test de unidad del holder: simular un error transitorio en 8 operaciones concurrentes y
  comprobar que `makeDb` se llamó **una sola vez** y que `gen` avanzó en 1.
- Prueba real contra la demo por el túnel: correr el backfill completo y **matar el
  port-forward SSM a mitad**. Debe reconectar una sola vez, terminar sin pérdida y dejar
  el mismo estado que una corrida sin cortes (mismo diff vacío que en A).
- `grep` de pools huérfanos: el proceso termina sin conexiones colgadas (`pg_stat_activity`
  vuelve a la línea base tras el `exit`).

### Etapa C — Medición de la concurrencia

Correr contra la demo, por el túnel, con `--concurrency` en 1, 4, 6, 8 y 12; anotar
tiempo total y errores transitorios de cada corrida.

**Verificación:** una tabla en este documento con los cinco tiempos. Se fija como default
el mayor valor que **no** aumente los reintentos transitorios respecto de 1. Si 8 o 12
disparan reintentos, se queda en el escalón anterior.

### Etapa D — Tabla `read_model_stamp` + script de huella

Migración de la tabla (`pnpm db:generate`, revisar el SQL antes de aplicar; CLAUDE.md
§5.5) y script `db:check:cohort-stamp` que calcula la huella, la compara, y emite
`RUN_BACKFILL` por `$GITHUB_OUTPUT`. Incluye el test **R1** (cierre de imports).

**Verificación:**
- En local: primera corrida sin fila ⇒ `RUN_BACKFILL=true`; segunda corrida sin cambios
  ⇒ `false`; tocar una línea de `item-stats-calculator.ts` ⇒ `true` de nuevo.
- Aplicar una migración cualquiera ⇒ `true` aunque la huella no se haya movido.
- El test R1 falla si se agrega un import nuevo al calculador y no se regenera la lista.

### Etapa E — Gate en el workflow

En `deploy-backend.yml`: correr `db:check:cohort-stamp` tras `db:migrate`, ejecutar el
backfill sólo si `RUN_BACKFILL=true`, re-estampar **sólo si el backfill salió 0**, y
correr **siempre** el smoke check (R3). Agregar el input `force_backfill` a
`workflow_dispatch`. `needs: migrate` en `build-and-push` **no se toca**.

**Verificación (en runs reales, no razonada):**
- Push que toca sólo `apps/api` ⇒ el log dice "read-model al día, se omite el backfill";
  el job `migrate` termina en **≤1,5 min**; el smoke check pasa; los dashboards de la demo
  siguen mostrando los mismos números que antes del deploy.
- Push que toca el calculador ⇒ el backfill **sí** corre y el estampado se actualiza.
- `workflow_dispatch` con `force_backfill=true` ⇒ corre aunque nada haya cambiado.
- Simular fallo: hacer fallar el backfill a propósito ⇒ el job falla, la fila **no** se
  re-estampa, y `build-and-push` no publica imagen.

### Etapa F — Backfill completo programado (R2)

Workflow nuevo (o `schedule` en el existente con un input que fuerce el backfill) que
corre el backfill completo, semanal, sin gate.

**Verificación:** una corrida programada exitosa que deja el mismo estado que la última
manual (diff vacío) y actualiza `backfilled_at`.

---

## 5. Riesgos residuales, dichos de frente

1. **La huella no cubre todo lo que influye.** Un cambio semántico río arriba del
   calculador (la forma de `responses.value`, el significado de `isCorrect`) no mueve la
   huella. Mitigado —no eliminado— por R1 (test de cierre) y R2 (backfill semanal, que
   cura en ≤7 días). Es el precio consciente de no correr 10 minutos en cada deploy.
2. **El paralelismo puede saturar el túnel SSM.** Por eso la Etapa C mide antes de fijar
   el default, y el criterio de aceptación es "sin aumento de reintentos transitorios",
   no sólo "más rápido".
3. **Ventana entre migración e imagen nueva.** No cambia: el backfill sigue corriendo
   dentro del job `migrate`, antes de `build-and-push`, cuando corresponde correrlo.
4. **La tabla de estampado es estado global de despliegue.** Si dos deploys corrieran a
   la vez podrían pisarse; hoy no pasa porque el `concurrency: sst-deploy-*` del workflow
   los serializa. Si eso cambiara, el estampado necesitaría un lock.

---

## 6. Apéndice — hallazgo suelto, fuera de este plan

Entre deploys, `assessment_item_stats` acumula **~1.105 filas de más** (8.282 tras un
backfill completo vs 9.387 medidas antes) sobre las mismas 237 evaluaciones. Apunta a una
diferencia entre el escritor incremental (`apps/api/src/assessment-results/lib/persist-results.ts`)
y el recálculo completo del backfill. Es anterior a este trabajo y nadie lo investigó.

**Por qué importa acá:** hoy el backfill de cada deploy **enmascara** esa deriva —la
corrige sin que nadie la vea. Al dejar de correrlo en cada deploy, la deriva deja de
limpiarse sola y se va a hacer visible. No bloquea este plan (R2 la limpia cada semana),
pero conviene investigarla en paralelo: si el escritor incremental produce filas que el
recálculo no, hay una discrepancia de semántica entre los dos escritores del read-model,
que es exactamente la clase de bug que la Fase 2 vino a matar.
