# Runbook — Promoción `dev → main` y deploy al demo (Feedback v2)

> Qué hacer al promover el sprint **Feedback v2** de `dev` a `main`, qué corre el deploy
> **solo**, y qué acciones **manuales** quedan sobre el ambiente **demo desplegado**.
> Contexto: los 10 tickets del sprint ya están en `dev`; `main` está atrás.

---

## 1. Antes de promover (en `dev`)

- [x] Commitear los sueltos que aún estaban sin trackear: `docs/testing-manual-feedback-v2.md` y este runbook. *(Ojo: hay WIP de carga DIA/seed sin commitear en el checkout — decidir explícitamente qué entra al `dev → main` y qué no.)*
- [ ] CI verde en `dev` (`typecheck` / `lint` / tests).
- [ ] Confirmar migraciones presentes: **`0015_outstanding_naoko`** (dificultad de ítem), **`0016_pretty_warbound`** (colecciones) y **`0017_moaning_arachne`** (`ALTER TYPE item_type ADD VALUE 'multi_select'`). La `0017` **ya está aplicada al demo a mano** (§4.2), así que el deploy la encontrará aplicada y no hará nada — pero tiene que viajar igual, o un ambiente nuevo quedaría sin el valor del enum.
- [ ] Confirmar que `item_collections` / `item_collection_items` **no** requieren política RLS (decisión T2-22: sin RLS, precedente `items`/`instruments`; no guardan PII). `rls-policies.sql` sin cambios.
- [ ] Confirmar que el arreglo de B3 (§4.1) entra completo: `packages/db/src/seed/{e2e-testing,e2e-andes,benchmark-demo,seed-performance-bands}.ts`, el script nuevo `packages/db/src/scripts/backfill-application-period.ts` + su entrada en `packages/db/package.json`, y `inferApplicationPeriodFromName` en `packages/types/src/schemas/instrument.schema.ts`. **No trae migración**: `application_period` ya existe desde `0011`; el arreglo es de datos y de seeds.

## 2. Promoción `dev → main`

- [ ] Abrir PR **`dev → main`**.
- [ ] Merge → dispara `deploy-backend.yml` y `deploy-frontend.yml`.

## 3. Qué corre el deploy AUTOMÁTICAMENTE (no hacer a mano)

`deploy-backend.yml` (push a `main` que toca backend), vía SSM port-forward por el bastión, como admin (`DATABASE_ADMIN_URL` → `soe_admin`):

1. **Migra el RDS** — `db:migrate`: aplica `0015`/`0016`/`0017` y **re-aplica `rls-policies.sql`**.
2. **Backfill del read-model de cohorte** — `db:backfill:cohort-stats`: puebla `assessment_item_stats` / `assessment_skill_stats`. **Resuelve B2**: sin esto, Dimensiones / Mapa de calor / heatmap / skills / informe salen en blanco. Idempotente.
3. **Gatea** el build/push de la imagen a que la migración pase (`needs: migrate`).

→ **No corras migrate ni backfill a mano.** Si migrate falla, la imagen nueva no se publica.

⚠️ **Lo que el deploy NO corre:** `db:retype:items` (§4.2) ni `db:backfill:application-period`
(§4.1). Son scripts de datos y quedan manuales. En el demo actual ya están aplicados; la advertencia
vale para **cualquier ambiente nuevo o re-seedeado**.

📌 **`main` despliega al stage `demo`** (`STAGE: demo` en `deploy-backend.yml`) — no hay un stage
`prod` separado hoy. Cuando lo haya, todo el §4 hay que repetirlo ahí.

## 4. Acciones MANUALES sobre el demo desplegado (lo que el deploy NO cubre)

Tocan **datos** del demo. Se corren contra el **RDS del demo** vía túnel SST — skill **`demo-db-access`**; perfil AWS **`edtech`** (cuenta `604179600768`, verificar con `sts get-caller-identity --profile edtech` antes).

### 4.1 B3 — `application_period` de los instrumentos DIA (filtro "Momento")

El backfill de cohorte **no** setea el momento: vive en `instruments.application_period`, y es
por esa columna que filtra `/resultados` (`dashboards.service.ts` → `resolveScopedAssessmentIds`).
Un instrumento con la columna en NULL **no aparece bajo NINGÚN momento**, aunque el nombre de sus
evaluaciones diga "Diagnóstico".

**Novedad respecto de la versión anterior de este runbook:** la mitad *de código* de B3 ya está
resuelta — los seeds crean **un instrumento por (asignatura × año × momento)** con la columna
seteada, y existe un script de backfill. Lo que queda es aplicar el arreglo a los **datos del demo
ya desplegado**, que el deploy no re-seedea.

- [ ] **Verificar** primero en el demo:
  ```sql
  select id, name, year, application_period from instruments where type='dia' order by application_period nulls first, name;
  ```
- [ ] **Correr el backfill** (nuevo, idempotente, sólo toca filas en NULL). Deduce el momento del
      **nombre**; lo que no puede clasificar lo deja en NULL y lo lista:
  ```bash
  DATABASE_ADMIN_URL=<url-del-túnel> pnpm --filter @soe/db db:backfill:application-period --dry-run
  DATABASE_ADMIN_URL=<url-del-túnel> pnpm --filter @soe/db db:backfill:application-period
  ```
  Cubre los instrumentos DIA reales importados (`… 2025 — Diagnóstico/Intermedio/Cierre`), que ya
  traen el momento en el nombre.
- [x] **Los 4 instrumentos que el backfill no puede clasificar** — resueltos con
      `db:fix:application-period` (**ya aplicado al demo el 2026-08-02**, ver el estado abajo).

  ⚠️ **Corrección importante:** una versión anterior de este runbook mandaba un `UPDATE` sobre
  `e2e00000-…-501`. **En el demo NO existe ni un instrumento del namespace `e2e00000`**: se sembró
  con `e2e-andes.ts` (namespace **`a3e00000`**), no con `e2e-testing.ts`. Ese `UPDATE` habría
  tocado 0 filas y parecido exitoso.

  | Instrumento | Evals | Caso |
  |---|---|---|
  | `a3e…500` DIA Lectura 2° Básico | 7, en 3 momentos | El único que requería split |
  | `a3e…501` DIA Matemática 2° Básico | 3, todas Diagnóstico | Momento inequívoco |
  | `b3c…101` / `b3c…102` (benchmarking) | 0 | Sin ítems ni evaluaciones |

  ```bash
  DATABASE_ADMIN_URL=<url-del-túnel> pnpm --filter @soe/db db:fix:application-period --dry-run
  DATABASE_ADMIN_URL=<url-del-túnel> pnpm --filter @soe/db db:fix:application-period
  ```

  **No es destructivo: cero `DELETE`.** `a3e…500` conserva sus 10 ítems y se queda con el momento
  mayoritario (Diagnóstico, 4 de 7 evaluaciones); se crean 2 instrumentos nuevos (Intermedio,
  Cierre) con copia de los ítems, sus tags y las bandas del original; y se re-apuntan las 3
  evaluaciones restantes con sus **440 responses** y **30 `assessment_item_stats`**. Idempotente
  (UUID determinísticos y cada paso comprueba si ya está hecho).

⚠️ **Orden importa:** correr el backfill **antes** de `db:seed:performance-bands`. El seed de bandas
ahora deriva el momento de la columna (y sólo cae al nombre si está en NULL), y el Diagnóstico
siembra **2** bandas mientras Monitoreo/Cierre siembran **3** — un Diagnóstico sin momento y con
nombre ambiguo recibiría 3 bandas.

⚠️ **`db:seed:performance-bands` SÓLO cubre instrumentos globales (`org_id IS NULL`).** Los 4 de
arriba son **de la org**, así que el seed no los toca: sus bandas se administran por
`PUT /instruments/:id/performance-bands`. Una primera versión de `db:fix:application-period`
soft-deleteó 3 bandas de `a3e…500` esperando que el seed las resembrara — no ocurrió y quedó sin
bandas (scoring al enum legacy 40/70/85). Ya corregido en el script, que además **restaura** las
bandas soft-deleteadas si detecta ese estado.

✅ **El seed ya no repite el problema** (`e2e-testing.ts`, `e2e-andes.ts`, `benchmark-demo.ts`): un
demo **fresco** nace con los momentos correctos. El seed **no** se re-corre en cada deploy → por eso
el backfill + los UPDATE dirigidos son lo que arregla el demo **actual**.

#### 4.1bis — `assessments.config.period` deprecado como fuente de verdad

Había **dos** fuentes del momento, con vocabularios distintos: la columna del instrumento y
`assessments.config.period` (texto libre), que era la que usaba el informe oficial de
establecimiento. En la BDD local convivían `final`/`cierre` e `intermedia`/`intermedio` para la
misma evaluación.

Ahora **todos los lectores derivan de `instruments.application_period`**:

- `report-support.service.ts` (`loadAssessmentMeta`) → `period`/`periodLabel` salen de la columna;
  `config.period` queda **sólo como fallback** para filas cuyo instrumento tenga la columna en NULL.
- `establishment-report.service.ts` → filtra por `instruments.application_period`.
- `GET /api/reports/establishment?period=` pasó de string libre a **enum**
  (`diagnostico|intermedio|cierre`). No estaba expuesto en la UI (sólo por querystring), pero un
  enlace externo con `?period=Intermedio` ahora recibe 400 en vez de devolver vacío en silencio.
- El **importador de informes oficiales** rechaza cargar un informe de un momento contra el
  instrumento de otro (`ConflictException`). Antes nada lo impedía: ahí nacía la divergencia.
- `periodLabel` ahora usa las etiquetas del DIA → un Cierre se rotula **"Cierre"** y un intermedio
  **"Monitoreo"**, no `Final`/`Intermedia` capitalizados.

⚠️ **Depende del backfill de §4.1.** Mientras un instrumento tenga la columna en NULL, sus informes
caen al fallback legacy y el filtro por momento del informe de establecimiento no lo encuentra.
Correr §4.1 **antes** de confiar en los informes oficiales del demo.

Los importadores siguen **escribiendo** `config.period`, pero como procedencia del archivo origen
(junto a `sourceFile`/`rbd`), no como dato autoritativo.

### 4.2 Tipos de ítem mal cargados — re-tipar in-place

> ✅ **Pareados + V/F: YA APLICADO AL DEMO.** 31 ítems re-tipados (30 el 2026-08-02 + Historia 5°
> pos 9 el 2026-08-03), tags intactos, 0 pendientes.
>
> ✅ **Multi-selección: YA APLICADO AL DEMO (2026-08-03).** 11 ítems re-tipados. Se aplicó primero
> la migración `0017` (`ALTER TYPE item_type ADD VALUE 'multi_select'`) — **ese orden es
> obligatorio**: hasta que el valor exista en el enum, el UPDATE no puede escribirlo. Era la única
> migración pendiente en el demo, así que `db:migrate` aplicó exactamente ese `ALTER TYPE` y
> re-aplicó las políticas RLS (19 tablas).
>
> Script único para los tres grupos: `pnpm --filter @soe/db db:retype:items [--apply]`
> (idempotente, dry-run por defecto). **El deploy NO lo corre**: hay que ejecutarlo a mano en
> cualquier ambiente cargado con datos previos a #94, y siempre DESPUÉS de que la `0017` esté
> aplicada. Hoy `main` despliega al mismo demo donde ya se aplicó, así que la promoción no requiere
> ninguna acción extra por este punto.

Código: **PR #89** (`matching` + numeración impresa), **#90** (UI de V/F), **#92** (Historia 5°) y
**#94** (`multi_select` + guard de import), todos en `dev`.
`matching` y `true_false` ya existían en el enum; `multi_select` **sí trajo migración** (`0017`).
Fuera de eso, lo que hay que
arreglar son **datos ya cargados con el tipo equivocado**, porque el importador no tenía cómo
producirlos bien cuando corrió la carga de la tanda 2026 (`a9974ce`).

**Inventario verificado contra el demo el 2026-08-02** (túnel SST, `soe_admin`). Los números son
mayores que los de la versión anterior de este runbook, que se estimaron sólo desde Ciencias 8°:

| Qué | Cuántos | Dónde | Está cargado como | Debe quedar | Síntoma hoy |
|---|---|---|---|---|---|
| Términos pareados | **5** en 4 instrumentos | Ciencias 5° pos **3**; Ciencias 6° pos **22** (impreso 15); Ciencias 8° pos **7** y **39** (impreso 28); Historia 6° pos **16** | `open_ended` + `responseFormat: match_pairs` | `matching` | Caen en corrección manual → **quedan sin puntaje** |
| Verdadero/Falso | **25** en 3 instrumentos | Ciencias 5° ×11 (impresos 4.1-4.4, 5.1-5.3, 7.1-7.4); Ciencias 8° ×9 (15.1-15.4, 23.1-23.5); Historia 7° ×5 (19-23) | `multiple_choice` con `A. Verdadero`/`B. Falso` | `true_false` | El escaneo responde `V`/`F` y se compara contra la LETRA → **puntúan 0 siempre** |

✅ **No hace falta re-ingesta.** Verificado: **0 `responses` y 0 `assessments`** sobre cualquier
instrumento 2026 (las 9016 responses del demo son de instrumentos 2025 / seeds). Nadie ingestó hojas
contra esta tanda, así que el re-tipado toca sólo `items` y no arrastra resultados.
⚠️ Si esto cambia (alguien ingesta antes de la migración), sí habría que re-ingestar: `results/calculate`
**sólo re-agrega**, lee `responses.isCorrect/rawScore` y NO re-puntúa contra el ítem.

- [x] ⚠️ **NUNCA re-importar el instrumento para arreglarlos.** `import-instruments` borra y recrea:
      regenera los UUID y arrastra `item_taxonomy_tags` por `ON DELETE CASCADE`. Los instrumentos
      2026 tienen **~4.900 tags** encima (99-162 por instrumento). Se hace **`UPDATE` in-place**,
      matcheando por `instruments.config->>'sourceJson'` + `items.position`.
      *(Las tablas `responses` / `assessment_item_stats` / `item_collection_items` NO tienen
      `onDelete` → ahí el DELETE falla y revierte. El daño silencioso es sólo a los tags.)*
- [x] Correr el script de migración contra el demo vía túnel SST (skill `demo-db-access`, perfil
      `edtech`). Por cada ítem escribe `type`, `content` y `scoringConfig` en una transacción,
      validando el `content` con `validateItemContent()` **antes** del UPDATE, y falla ruidoso si no
      ubica exactamente un ítem por target.
- [x] ⚠️ **Corregir `points` de los pareados en el mismo UPDATE.** Hoy los 5 están en `points: 1`;
      deben quedar en el nº de pares (**4, 4, 4, 4** y **3** para Historia 6°). Sin eso el crédito
      parcial no sirve de nada: el ítem seguiría valiendo 1 punto.
- [x] Los pares NO hay que sacarlos de los JSON de extracción: `a9974ce` los dejó preservados en
      `items.scoring_config->'matchPairs'` / `->'matchColumns'` en los 5 ítems. La migración los lee
      de ahí. *(Quedan como residuo tras migrar; el `content` pasa a ser la fuente de verdad.)*
- [x] Verificar después *(hecho: 5 matching con points 4/4/4/4/3 y lado respondible correcto por instrumento; 25 true_false con `correctAnswer` booleano y 0 con `alternatives`; tags intactos)*:
      ```sql
      -- 5 filas matching, con points = nº de pares (4,4,4,4,3)
      select ins.name, it.position, it.type, it.scoring_config->>'points' as points
      from items it join instruments ins on ins.id = it.instrument_id
      where it.type='matching' and it.deleted_at is null order by ins.name, it.position;

      -- 25 filas true_false, ninguna con `alternatives` en el content
      select count(*) filter (where content ? 'alternatives') as con_alternatives,
             count(*) as total
      from items where type='true_false' and deleted_at is null;
      ```

**MULTI-SELECCIÓN — resuelta en código (#94), pendiente en los datos del demo.** Son **11 ítems en
7 instrumentos**, incluidos **Lectura 3°** y **Matemática 6°** (este último con **4** alternativas
correctas). Están cargados como `multiple_choice` con varias `isCorrect`, y la estrategia MCQ toma
sólo la primera, así que puntúan **al revés**: quien marca la respuesta completa saca 0 y quien
marca una sola saca 1.

Se modelaron como **tipo propio `multi_select`** (no `correctKeys` sobre `multiple_choice`): el
`type` tiene que seguir determinando la semántica, que es justo lo que falló en los tres bugs de
#89. Puntaje **todo-o-nada por defecto**, verificado contra el escaneo real, con crédito parcial
disponible por configuración.

- [x] Aplicar la migración **`0017`** al demo (el enum tiene que tener el valor antes del UPDATE).
- [x] Correr `db:retype:items --apply` — el script cubre los 11.
- [x] Verificar: `select count(*) from items where type='multi_select' and deleted_at is null;` → **11**.

✅ **Contraste contra GradeCam en Ciencias 8° 8A, corriendo las estrategias sobre el contenido ya
migrado en la BDD del demo: 44/44 alumnos, cero ítems con diferencia.** Venía de 31/44.

Estado final de tipos en la tanda 2026 del demo: 1156 `multiple_choice`, 138 `open_ended`,
25 `true_false`, 11 `multi_select`, 6 `matching`. Los ~5.000 tags intactos.

| Instrumento | Posiciones (impreso) |
|---|---|
| Ciencias 5° | 34 (26) |
| Ciencias 7° | 2 |
| Ciencias 8° | 8, 27 (20), 40 (29) |
| Historia 5° | 2, 8 |
| Historia 6° | 19 |
| Historia 7° | 9 |
| Lectura 3° Intermedio | 7 |
| Matemática 6° Intermedio | 29 *(4 correctas)* |

✅ **Historia 5° pos 9** (6º pareado) — **resuelto y aplicado** (PR #92). Se corrigió el JSON del
instrumento derivando columnas y pares del propio enunciado y de la tupla `fillAnswer`; un
re-import futuro ya lo carga bien solo. Nota histórica: le faltaba el dato en las dos capas de
extracción (ni `matchColumns` en el cuadernillo ni `matchPairs` en la ficha), y a diferencia de los
otros 5 tampoco tiene `matchPairs` en `scoring_config`.

📌 **Dos hallazgos menores del levantamiento, no bloqueantes para el deploy:**

1. **Puntaje máximo de los ítems de rúbrica.** El ítem 22 de Historia 5° vale **2 puntos** según
   GradeCam (es de desarrollo, `type: rubric`) y en la BDD está en `points: 1`. No afecta el % de
   logro automático —los de desarrollo quedan pendientes de corrección humana y se excluyen del
   denominador— pero el puntaje máximo del instrumento queda corto. **No se barrió el resto del
   corpus** buscando el mismo desfase.
2. **Los JSON de la carpeta de extracción de Historia 5° siguen sin `matchPairs`.** El arreglo del
   ítem 9 (#92) se hizo sobre el JSON **del repo**, que es el que consume el importador. Si alguien
   re-corre el merge del pipeline sobre ese instrumento, regenera el con-pauta viejo y **pisa el
   arreglo**. La solución de fondo es re-correr `parse_ficha.py` en la carpeta de extracción.

📌 **Nota de operación, no bloqueante:** `soe_admin` **no queda sujeto a RLS** pese a que las 9
tablas tienen `FORCE ROW LEVEL SECURITY` y el rol no declara `BYPASSRLS` (verificado: con un
`app.current_org_id` inventado igual devuelve los 1385 alumnos de las 3 orgs). Para los scripts de
migración eso es lo que se necesita; pero **el aislamiento multi-tenant no se puede validar con este
rol** — hay que probarlo con `soe_app`. Contradice lo que dice la skill `demo-db-access` §5.

### 4.3 (Opcional) T2-21 — dificultad de ítems

La columna `difficulty` arranca **toda en NULL** → el badge y el filtro de dificultad no muestran nada en el demo. Si se quiere exhibir la feature:
- [ ] Setear `difficulty` en algunos ítems del demo (`UPDATE items SET difficulty='easy'|'medium'|'hard' WHERE …` o `PATCH /items/:id`), y/o dejarlo en el seed.

## 5. Verificación post-deploy (en el demo)

Recorrer con `docs/testing-manual-feedback-v2.md`. Mínimo imprescindible:

- [ ] **Dimensiones** y **Mapa de calor** muestran datos → confirma que el backfill corrió (paso 3.2).
- [ ] `/resultados` con **DIA + Momento Diagnóstico** en **Matemáticas** → muestra datos → confirma 4.1.
- [ ] `/resultados` con **DIA + Momento Monitoreo** → muestra los DIA Intermedio 2025 importados
      (Lectura/Matemática 3°-6°). Antes de 4.1 salía vacío para **todos** los momentos.
- [ ] Que no quede ningún instrumento sin momento salvo los que se decidió dejar así:
      ```sql
      select id, name from instruments where type='dia' and application_period is null and deleted_at is null;
      ```
- [ ] `/banco-contenido` carga y `/banco-items` **redirige**.
- [ ] **Colecciones:** crear lista → "Crear evaluación".
- [ ] **Vista 360 del estudiante** (`/estudiantes`).
- [ ] **Términos pareados**: en `/banco-contenido`, abrir Ciencias 8° ítem 7 → el panel muestra las
      **dos columnas con los pares correctos y los distractores marcados**, no un ítem vacío. En la
      matriz por alumno, un acierto parcial se ve como **`2/4`**, no "incorrecto".
- [ ] **Verdadero/Falso**: abrir Ciencias 8° pos 19 (impreso 15.1) → el panel muestra **V/F con la
      correcta marcada**, no el cartel "no tiene alternativas". En el análisis de la pregunta hay
      **distribución y clave correcta** (antes salían vacías).
- [ ] **Multi-selección**: abrir Ciencias 8° pos 40 (impreso 29) → badge **"Multi-selección"** y
      **3 alternativas marcadas como correctas**. En el análisis, los porcentajes por opción
      **suman más de 100 a propósito** (cada alumno marca varias): es "% que marcó esta opción".
- [ ] Que no quede ningún ítem mal tipado — ambos conteos deben dar **0**:
      ```sql
      select count(*) filter (where type='multiple_choice' and jsonb_array_length(content->'alternatives')=2
               and content->'alternatives' @> '[{"text":"Verdadero"}]') as vf_pendientes,
             count(*) filter (where type='multiple_choice'
               and (select count(*) from jsonb_array_elements(content->'alternatives') e
                    where (e->>'isCorrect')::boolean) > 1) as multi_pendientes
      from items where deleted_at is null;
      ```

## 6. Riesgos / notas

- **Migraciones irreversibles** en demo/prod. `0015`/`0016`/`0017` son **aditivas** (enum + columna + 2 tablas + un valor de enum) → bajo riesgo. `ALTER TYPE … ADD VALUE` corre dentro de transacción desde PG 12; el demo es **17.9**.
- **Re-importar un instrumento ya cargado borra sus tags EN SILENCIO** (`ON DELETE CASCADE`): la tanda 2026 tiene ~5.000. Desde #94 hay un **guard** que aborta y exige `--force`. Para cambiar ítems ya cargados el camino es `db:retype:items` (UPDATE in-place), nunca `db:import:instruments`.
- **`item_collections` sin RLS** por decisión (aislamiento por `org_id` + `withOrgContext`). Si a futuro guardan algo sensible, agregar su política a `rls-policies.sql` (§5.2 CLAUDE.md).
- **Backfill idempotente** (delete + reinsert por assessment) → re-correrlo no mueve números publicados; no recalcula `assessment_results`/`skill_results`.
- **No re-seedear** el demo con datos existentes (destructivo). Para el demo vivo, usar **UPDATEs dirigidos**, no el seed. Única excepción a evaluar: §4.1 opción (b), que es una decisión consciente con su costo declarado.
- **Los UUID y nombres de los instrumentos del seed E2E cambiaron.** Un demo re-seedeado ya no tiene `e2e…500`/`e2e…501` sino 9 instrumentos `e2e…500`–`e2e…508` (uno por asignatura × año × momento), y los ítems se movieron al rango `e2e…1001+`. Cualquier script, query guardada o doc que apunte a esos IDs (este runbook incluido, §4.1) vale **sólo** para el demo actual, no para uno fresco.
- **El seed E2E estaba roto de antes y no se sabía:** `performance_bands.instrument_id` no tiene `ON DELETE CASCADE`, así que una vez sembradas las bandas DIA, la siguiente corrida del seed fallaba por FK al borrar sus instrumentos. Ya corregido (el seed borra las bandas de su namespace antes). Relevante si se elige §4.1 (b).

---

## Resumen de estado (al día de hoy)

| Item | Estado | Acción en demo |
|---|---|---|
| Sprint Feedback v2 (10 tickets) | en `dev`, falta `dev → main` | promover (paso 2) |
| B1 — filtro Momento en dashboards | ✅ en `dev` (commit `ea462b8`) | viaja con `dev → main` |
| B2 — read-model de cohorte | backfill **automático** en deploy | ninguna (lo corre el workflow) |
| B3 — `application_period` DIA (código) | ✅ seeds corregidos (1 instrumento por asignatura × año × momento) + script `db:backfill:application-period` | viaja con `dev → main` |
| B3 — `application_period` DIA (datos del demo) | ⚠️ pendiente | **backfill + UPDATE dirigido** (4.1); Lectura `…500` requiere **decisión** (a)/(b) |
| Términos pareados + V/F (PR #89, #90, #92) | ✅ en `dev` | ✅ **APLICADO**: 31 ítems re-tipados en demo (4.2). Sin re-ingesta: 0 responses sobre 2026. Script versionado en #91 |
| Multi-selección (**11 ítems, 7 instrumentos**) | ✅ tipo `multi_select` en `dev` (#94) | ✅ **APLICADO** en demo: migración `0017` + `db:retype:items`. Ciencias 8° 8A pasó de 31/44 a **44/44** contra GradeCam |
| Historia 5° pos 9 (6º pareado) | ✅ resuelto (#92) | ✅ **APLICADO** en demo |
| Guard de `import-instruments` | ✅ en `dev` (#94) | ninguna — evita que un re-import borre los ~5.000 tags de la tanda 2026 |
| T2-21 dificultad (datos demo) | columna NULL | opcional (4.3) |
