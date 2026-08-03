# Runbook — Promoción `dev → main` y deploy al demo (Feedback v2)

> Qué hacer al promover el sprint **Feedback v2** de `dev` a `main`, qué corre el deploy
> **solo**, y qué acciones **manuales** quedan sobre el ambiente **demo desplegado**.
> Contexto: los 10 tickets del sprint ya están en `dev`; `main` está atrás.

---

## 1. Antes de promover (en `dev`)

- [ ] Commitear los sueltos que aún están sin trackear: `docs/testing-manual-feedback-v2.md` y este runbook. *(Ojo: hay WIP de carga DIA/seed sin commitear en el checkout — decidir explícitamente qué entra al `dev → main` y qué no.)*
- [ ] CI verde en `dev` (`typecheck` / `lint` / tests).
- [ ] Confirmar migraciones del sprint presentes: **`0015_outstanding_naoko`** (dificultad de ítem) y **`0016_pretty_warbound`** (colecciones).
- [ ] Confirmar que `item_collections` / `item_collection_items` **no** requieren política RLS (decisión T2-22: sin RLS, precedente `items`/`instruments`; no guardan PII). `rls-policies.sql` sin cambios.
- [ ] Confirmar que el arreglo de B3 (§4.1) entra completo: `packages/db/src/seed/{e2e-testing,e2e-andes,benchmark-demo,seed-performance-bands}.ts`, el script nuevo `packages/db/src/scripts/backfill-application-period.ts` + su entrada en `packages/db/package.json`, y `inferApplicationPeriodFromName` en `packages/types/src/schemas/instrument.schema.ts`. **No trae migración**: `application_period` ya existe desde `0011`; el arreglo es de datos y de seeds.

## 2. Promoción `dev → main`

- [ ] Abrir PR **`dev → main`**.
- [ ] Merge → dispara `deploy-backend.yml` y `deploy-frontend.yml`.

## 3. Qué corre el deploy AUTOMÁTICAMENTE (no hacer a mano)

`deploy-backend.yml` (push a `main` que toca backend), vía SSM port-forward por el bastión, como admin (`DATABASE_ADMIN_URL` → `soe_admin`):

1. **Migra el RDS** — `db:migrate`: aplica `0015`/`0016` y **re-aplica `rls-policies.sql`**.
2. **Backfill del read-model de cohorte** — `db:backfill:cohort-stats`: puebla `assessment_item_stats` / `assessment_skill_stats`. **Resuelve B2**: sin esto, Dimensiones / Mapa de calor / heatmap / skills / informe salen en blanco. Idempotente.
3. **Gatea** el build/push de la imagen a que la migración pase (`needs: migrate`).

→ **No corras migrate ni backfill a mano.** Si migrate falla, la imagen nueva no se publica.

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
- [ ] **Matemática del seed demo (`…501`, "DIA Matemática 2° Básico") — UPDATE dirigido.** Su nombre
      no dice el momento, así que el backfill lo deja en NULL a propósito. Sus 3 evaluaciones son
      todas Diagnóstico → es inequívoco:
  ```sql
  UPDATE instruments SET application_period='diagnostico'
  WHERE id='e2e00000-0000-0000-0000-000000000501' AND type='dia';
  ```
- [ ] **Lectura del seed demo (`…500`) — sigue sin tener un UPDATE correcto.** Es **un** instrumento
      reusado entre Diagnóstico + Intermedia + Final: no existe un momento único que setearle. Hay
      que **decidir** entre dos caminos (ninguno es automático):

  | Opción | Qué implica | Riesgo |
  |---|---|---|
  | **(a) Dejarlo como está** | Lectura + cualquier momento sigue vacío en el demo | Ninguno. Limitación conocida, no bug de código |
  | **(b) Re-correr el seed E2E contra el demo** | Recrea los 9 instrumentos por momento y sus evaluaciones, ya correctos | ⚠️ **Destructivo**: el seed borra su namespace `e2e00000-…` **y** los assessments que alguien haya creado subiendo CSVs contra esos instrumentos. Contradice §6 ("no re-seedear el demo") |

  Si el demo no tiene cargas manuales sobre los instrumentos E2E, (b) deja el demo consistente con
  el seed nuevo. Si las tiene o hay dudas, (a). **Decidir explícitamente antes del deploy.**

⚠️ **Orden importa:** correr el backfill **antes** de `db:seed:performance-bands`. El seed de bandas
ahora deriva el momento de la columna (y sólo cae al nombre si está en NULL), y el Diagnóstico
siembra **2** bandas mientras Monitoreo/Cierre siembran **3** — un Diagnóstico sin momento y con
nombre ambiguo recibiría 3 bandas.

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

### 4.2 Términos pareados y V/F — re-tipar los ítems ya cargados

> ✅ **YA APLICADO AL DEMO (2026-08-02).** 30 ítems re-tipados, tags intactos, 0 pendientes.
> El script quedó versionado (PR #91): `pnpm --filter @soe/db db:retype:items [--apply]`.
> **Hay que volver a correrlo en cualquier ambiente que se cargue con datos previos a #89**
> (por ejemplo prod tras la promoción) — es idempotente y corre en dry-run por defecto.

Código: **PR #89** (`matching` + numeración impresa) y **PR #90** (UI de V/F), ambos en `dev`.
No hay migración de schema: `matching` y `true_false` ya existían en el enum. Lo que hay que
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

⚠️ **Queda fuera y hay que decidirlo aparte — MULTI-SELECCIÓN.** No son 3 ítems de Ciencias 8° como
decía la versión anterior: son **11 ítems en 7 instrumentos**, incluidos **Lectura 3°** y
**Matemática 6°** (este último con **4** alternativas correctas). Son `multiple_choice` con varias
`isCorrect`; la estrategia MCQ toma sólo la primera, así que puntúan **al revés**: quien marca la
respuesta completa saca 0 y quien marca una sola saca 1. El PR #89 **no** los toca — necesitan su
propia decisión de tipo (¿`multi_select` nuevo? ¿`correctKeys`? ¿crédito parcial o todo-o-nada?).
Ver §7bis de `docs/plan-desarrollo-items-terminos-pareados.md`.
Contraste contra los puntajes de GradeCam en Ciencias 8° 8A: **31/44** alumnos hoy; 44/44 al cerrarlo.

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

⚠️ **Historia 5° pos 9** es un 6º ítem pareado, cargado como `open_ended`/`fill_in` y hoy sin
corregir. **No** se migra en esta tanda: le falta el dato estructurado en las dos capas de
extracción (ni `matchColumns` en el cuadernillo ni `matchPairs` en la ficha), y a diferencia de los
otros 5 tampoco tiene `matchPairs` en `scoring_config`.

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
- [ ] **Términos pareados** (si entró #89): en `/banco-contenido`, abrir Ciencias 8° ítem 7 → el
      panel muestra las **dos columnas con los pares correctos y los distractores marcados**, no un
      ítem vacío. En la matriz por alumno, un acierto parcial se ve como **`2/4`**, no "incorrecto".

## 6. Riesgos / notas

- **Migraciones irreversibles** en demo/prod. `0015`/`0016` son **aditivas** (enum + columna + 2 tablas) → bajo riesgo.
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
| Términos pareados + V/F (PR #89, #90) | ✅ en `dev` | ✅ **APLICADO**: 30 ítems re-tipados en demo (4.2). Sin re-ingesta: 0 responses sobre 2026. Script versionado en #91 |
| Multi-selección (**11 ítems, 7 instrumentos**) | ❌ sin decidir el tipo | fuera de #89 — decidir antes de confiar en los puntajes de Ciencias, Historia, Lectura 3° y Mate 6° |
| Historia 5° pos 9 (6º pareado) | ❌ falta el dato en la extracción | no migrar en esta tanda (4.2) |
| T2-21 dificultad (datos demo) | columna NULL | opcional (4.3) |
