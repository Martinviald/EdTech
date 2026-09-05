# Diseño — Secciones electivas: tronco común + ramas a elección

> Modelar pruebas donde **todos los alumnos responden un bloque común y además eligen uno
> entre varios bloques alternativos**. El caso que lo motiva es la PAES de Ciencias, pero el
> diseño no la nombra: se resuelve con una propiedad de la sección, no con una excepción.
>
> Estado: **propuesta v2 — corregida tras auditoría adversarial**. No implementado.
>
> La v1 fue auditada contra el código y la BDD demo. Encontró **2 bloqueantes**, uno de los
> cuales invalidaba la premisa central. Las correcciones están incorporadas; §7 deja el
> registro de qué cambió y por qué, para que nadie vuelva a proponer la v1.

---

## 1. El problema

### 1.1 Cómo funciona la prueba

La PAES de Ciencias tiene **80 preguntas en dos módulos**:

| Módulo | Preguntas | Quién lo responde |
|---|---|---|
| Común | 1–54 | **Todos**. Cubre Biología, Física y Química. |
| Mención | 55–80 | **Uno solo** de tres: Biología, Física o Química. |

Por ensayo existen **132 preguntas distintas** (54 + 26×3), pero cada alumno responde 80.

No es una rareza de Ciencias. Es el patrón **tronco común + rama electiva**, y aparece en
cualquier evaluación con partes obligatorias y opcionales: un SIMCE con módulo optativo, los
papers a elección de Cambridge, una prueba propia con "elige una de estas dos unidades".

### 1.2 Cómo lo modelamos hoy

Nueve instrumentos: 3 ensayos × 3 menciones, cada uno con sus 80 preguntas. Verificado en
demo — las 54 comunes existen **tres veces**, con tres UUID distintos y el mismo enunciado:

```sql
select left(md5(content->>'stem'),8) h, count(*) copias, count(distinct instrument_id)
  from items ... where position <= 54 group by h having count(*) > 1;
-- 0e4071f2 | 3 | 3
```

### 1.3 Qué se rompe

1. **Estadística de ítem partida en tercios.** Si 80 alumnos responden la común 34, el sistema
   ve tres poblaciones de ~27. `assessment_item_stats` calcula dificultad y discriminación
   sobre cada tercio. Los índices quedan con un tercio del `n`.
2. **No hay comparación entre menciones.** Dos alumnos que respondieron literalmente la misma
   pregunta aparecen contra ítems distintos.
3. **Toda corrección se hace tres veces.** Ocurrió: los arreglos de alternativas rotas de
   septiembre se aplicaron por triplicado en los tres cuadernillos.
4. **Los tags de taxonomía se triplican**, y con ellos los conteos por habilidad.
5. **La ingesta de respuestas está bloqueada.** GradeCam entrega el común y la mención en
   assignments separados; sin un lugar donde poner "qué mención rindió este alumno" no hay
   forma de decidir a cuál de los tres cuadernillos va cada escaneo.

### 1.4 Dos pérdidas silenciosas que aparecieron al revisar

- **La metadata PAES no sobrevive al import.** El exportador arma
  `instrument.paes = {prueba, tanda, mencion, appliedOn, basadoEn}` y el importador solo
  persiste `sourceJson`, `subject` y `grade`. Hoy la mención sólo se deduce del texto del
  nombre del instrumento.
- **Los 9 instrumentos de Ciencias tienen UNA sección** ("Prueba completa"). El corte
  común/mención no está representado en ninguna parte de la base.

---

## 2. Lo que el schema ya ofrece

| Pieza | Estado | Sirve para |
|---|---|---|
| `instrument_sections` | En uso (51 filas en PAES): `name`, `type`, `order`, `max_points` y **`config` JSONB libre** | Es el lugar natural del bloque |
| `assessment_forms` | Existe (`assessment_id`, `name`, `item_order[]`), **sin uso** salvo una lectura en el servicio de impresión | Fue pensado justo para esto (formas A/B del plan OMR, CD-13) |
| `items.position` | Correlativo dentro del instrumento | Se mantiene |

### ⚠️ La premisa que la v1 dio por buena, y que es FALSA

La v1 afirmaba: *"`maxScore` se calcula desde las respuestas del alumno, así que un
instrumento de 132 ítems no infla su denominador"*. Eso es cierto **del calculador** y falso
**del pipeline**, porque la ingesta decide qué respuestas existen:

```ts
// answer-sheets.service.ts:345
// Crear una response por ítem del instrumento (incluye los items que
// el alumno no contestó: rawScore = 0).
for (const item of instrumentItems) {
```

`loadInstrumentItems` trae **todos** los ítems con ese `instrument_id`. Un ítem sin marcar
pasa por la estrategia de MCQ y sale `isCorrect: false, rawScore: 0` — no `null`, así que
tampoco lo filtra el `rows.filter(r => r.isCorrect !== null)` del calculador.

**Consecuencia con el diseño propuesto:** un alumno de Biología recibiría 52 respuestas
fantasma incorrectas (las de Física y Química). Su porcentaje pasaría a ser `correctas/132`
en vez de `/80`: **todos caerían ~39 puntos, a la banda más baja**. Y cada ítem electivo
registraría `responseCount = 80` con `correctCount ≈ 26`, hundiendo su dificultad a un tercio.

El mismo patrón está en los importadores masivos (`import-dia-responses.ts:234`,
`import-paes-2026-responses.ts:639`); este último además **aborta** si las posiciones de la
planilla no calzan exactamente con las del instrumento.

**Por eso la asignación alumno↔forma no es opcional ni posterior: es precondición.** Ver §5.

### Lo que sí está sólido (verificado en el código)

| Pieza | Estado |
|---|---|
| `persist-results.ts` / `grade-calculator.ts` | Suman `maxScore` de las filas del propio alumno. No enumeran el instrumento. ✅ |
| `skill_results` por alumno | Response-driven. ✅ |
| Dificultad por ítem (`scoreSum/maxSum`) | El denominador son quienes respondieron ese ítem. La ganancia estadística de §1.3.1 es real. ✅ |
| `ai-analysis`, vista 360, panorama | Parten de `responses` con `innerJoin`. ✅ |
| Multipágina del lector | `pageIndex` automático; 132 ítems → 2 páginas. ✅ |
| Marca→ítem por `printedNumber` | Sobrevive al re-import. ✅ |

---

## 3. Diseño propuesto

> **Un instrumento por ensayo, con secciones tipadas por rol, y la elección del alumno como
> dato de la aplicación.**

### 3.1 Un instrumento por ensayo, con 132 ítems y cuatro secciones

```
Ciencias — Ensayo 3
├── "Módulo común"      order 1  ·  54 ítems  ·  role: core
├── "Mención Biología"  order 2  ·  26 ítems  ·  role: elective
├── "Mención Física"    order 3  ·  26 ítems  ·  role: elective
└── "Mención Química"   order 4  ·  26 ítems  ·  role: elective
```

Las 54 comunes existen **una sola vez**. Desaparecen los problemas 1 a 4 de §1.3.

De 9 instrumentos se pasa a **3**. De 712 ítems, a 396.

### 3.2 El rol va en COLUMNAS TIPADAS

```sql
alter table instrument_sections
  add column role section_role not null default 'core',   -- enum: core | elective
  add column elective_group text,                          -- null si role = core
  add column elective_key   text;                          -- null si role = core
```

```
"Módulo común"       role=core
"Mención Biología"   role=elective  elective_group='mencion-ciencias'  elective_key='BIO'
"Mención Física"     role=elective  elective_group='mencion-ciencias'  elective_key='FIS'
"Mención Química"    role=elective  elective_group='mencion-ciencias'  elective_key='QUI'
```

**Esto es lo que lo hace reutilizable y no hardcodeado.** El código nunca dice "Ciencias" ni
"Biología". La regla queda en abstracto:

> Un alumno responde **todas** las secciones `core`, más **exactamente una** sección de cada
> `elective_group` presente en el instrumento.

Un instrumento sin secciones `elective` se comporta como hoy: `role` tiene default `core`, así
que la migración es **inerte** para los otros 20 PAES y para todo el DIA.

#### Por qué columna y no `config` JSONB (corrección de la v1)

La v1 lo puso en `config` citando `CLAUDE.md` §5.4 — y esa misma regla dice lo contrario:
**columnas tipadas para lo que se filtra en SQL**. El rol *se filtra en SQL*: "dame las
secciones core de este instrumento" es la query base de la ingesta, del layout y del scoring.

Además:

- `config` es `jsonb().$type<Record<string, unknown>>()`, o sea un `any` con forma de objeto.
  Un Zod en `packages/types` valida en escritura y no protege ninguna lectura.
- Con columna se puede poner un índice y un `CHECK` (`role='elective' ⇒ elective_group not null`).
  La v1 delegaba esa invariante al Service, que es donde CLAUDE.md dice que **no** debe vivir
  una restricción de integridad.
- Costo de migrar: **cero**. `instrument_sections.config` está vacío en toda la base.

El rol es ortogonal a `section_type` (`multiple_choice`, `listening`…), que describe la
naturaleza y no la obligatoriedad. Son dos columnas, no un producto cartesiano de un enum.

### 3.3 Qué eligió cada alumno

Una **forma** es una combinación concreta de secciones: común + una mención. Tres por ensayo.
`assessment_forms` ya existe (`assessment_id`, `name`, `item_order[]`).

```sql
alter table assessment_forms
  add column org_id uuid not null references organizations(id),  -- hoy NO lo tiene
  add column section_ids uuid[];                                  -- de qué secciones se compone

create table assessment_form_students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  assessment_form_id uuid not null references assessment_forms(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_at timestamp not null default now(),
  unique (assessment_form_id, student_id)
);
```

⚠️ **RLS (omisión de la v1).** `assessment_form_students` liga un `student_id` con su electivo:
es dato personal (Ley 19.628). Necesita política en `packages/db/sql/rls-policies.sql`, y por
eso lleva `org_id` propio — **no se puede heredar por join, porque `assessment_forms` tampoco
tiene `org_id` hoy**. Ese hueco preexistente se tapa en la misma migración.

⚠️ **`responses.form_id` ya existe** (`responses.ts:24`, 0 filas en uso). No reemplaza a la
tabla nueva —la elección tiene que existir *antes* de la primera respuesta, para imprimir la
hoja— pero sí es donde queda estampada la forma de cada respuesta ya cargada. Se usan las dos:
la tabla es la matrícula al electivo, `responses.form_id` es la evidencia por respuesta.

⚠️ **`assessment_forms.item_order` es un campo muerto.** Nadie lo lee (el único uso de la tabla
es validar pertenencia en el servicio de impresión). La v1 decía "se mantiene para el orden de
impresión" como si estuviera en uso. O se implementa o se deja documentado como no usado.

**Alternativa descartada:** una columna `form_id` en `assessment_results`. La elección existe
antes del resultado, y `assessment_results` se borra y recrea al recalcular.

### 3.4 Qué cambia en cada consumidor (corregido)

| Consumidor | v1 decía | Realidad verificada |
|---|---|---|
| **Ingesta de respuestas** | "resuelve la mención por la forma" | ⚠️ **Cambio de fondo.** Debe iterar los ítems **de las secciones de la forma**, no `items WHERE instrument_id`. Sin esto se fabrican respuestas fantasma (§2). |
| **Puntaje por alumno** | "ninguno" | ✅ Correcto — *dado* el cambio de la ingesta. |
| **`assessment_item_stats.responseCount`** | "ninguno" | ✅ Correcto, es por ítem. |
| **`assessment_item_stats.studentCount`** | "ninguno" | ⚠️ **Se rompe.** Es el N de la cohorte del curso y su docstring dice *"es constante entre los ítems de un mismo curso"*. Reportaría 80 para un ítem que respondieron 26. Consumidores: `cohort-item-stats.helper.ts:62,122`, `item-analysis.service.ts:920,929`. **Hay que llevarlo al grano (curso, ítem).** |
| **`deriveSkillStatsFromItemStats`** | no mencionado | ⚠️ Hace `max(studentCount)`: un nodo de taxonomía presente en el común y en una mención mezcla dos poblaciones de tamaño distinto en una sola tasa. |
| **Read-model de cohorte** | "ninguno" | ✅ Espeja el `GROUP BY` de `responses`. |
| **Layout del lector** | "ya soportado" | ⚠️ **No existe.** Ver §3.5. |
| **Taxonomía** | "dejan de triplicarse" | ✅ — pero ⚠️ ver §4 sobre el matching por posición. |
| **`performance_bands`** | "no cambia" | ✅ Se resuelven por instrumento y sobre % de logro. |

### 3.5 El lector de marcas: lo que realmente falta

La v1 despachaba esto con *"ya soportado (`pageIndex`)"*. Lo único cierto de esa frase es el
multipágina. El layout **es por instrumento y no sabe de formas**:

- `sheet_layouts.instrument_id` es `NOT NULL` y el unique es `(org_id, instrument_id, version)`.
  **No hay `form_id`.** (`assessment_form_id` sí existe, pero un nivel abajo, en
  `sheet_print_runs` — la tirada sabe de formas, el layout no.)
- `loadDerivableItems` hace `where(eq(items.instrumentId, …))`: todos los ítems, sin filtro.
- El **invariante 4** de `collectInvariantViolations` exige **biyección exacta** entre el layout
  y los ítems corregibles del instrumento. Con un subconjunto electivo, **el freeze falla hoy**.

Trabajo real (etapa D):

1. `sheet_layouts` gana `assessment_form_id` y `instrument_id` se relaja; rehacer el unique.
2. `LayoutSpec` gana `formId` — y hay que decidir si entra al `layoutHash`. ⚠️ Cambiar el hash
   **invalida todo layout ya congelado**.
3. Parametrizar `loadDerivableItems` y el invariante 4 por forma.
4. Ajustar `SheetPrintService.requireRunForm`, que hoy valida `form.instrumentId === layout.instrumentId`.

## 4. Migración

### 4.1 El borrado de los 9 es limpio — verificado

| | |
|---|---|
| `responses` · `assessments` · `sheet_layouts` · `performance_bands` · `benchmark_aggregates` · `files` | **0** ✅ |
| `items` | 712 |
| `item_taxonomy_tags` | **1.399** (de los 2.658 PAES totales) |
| ítems con `imageRef` | **330** |

### 4.2 ⚠️ El común NO está alineado por posición entre cuadernillos

La v1 verificó **un** hash y generalizó. La realidad:

| Ensayo | Comunes BIO/FIS/QUI | Hashes distintos | En los 3 | En 2 | En 1 |
|---|---|---|---|---|---|
| E1 | 53 / 54 / 54 | 55 | 52 | 2 | 1 |
| E3 | 54 / 54 / 54 | 54 | **54** | 0 | 0 |
| E4 | 53 / 54 / 53 | 54 | 53 | 0 | 1 |

Al inspeccionar las divergencias, **no son preguntas distintas: es la misma pregunta en otra
posición**. En E1, "Una persona de 60 kg desciende en ascensor…" está en la posición **26** en
Biología y Química y en la **8** en Física.

Eso explica de dónde salen las columnas `N°B`/`N°F`/`N°Q` de la Tabla de especificaciones de
la Tanda 1 — y por qué en T3/T4 las dejaron en blanco: ahí el orden sí coincide.

**Consecuencia de diseño: `position` no es la identidad del ítem.** La deduplicación no puede
hacerse por posición. El puente correcto es el que ya existe:

- la Tabla de especificaciones cuando trae las tres columnas (T1), y
- `mapear_comun_cie.py`, que empareja por texto de enunciado y ya se validó contra T1
  con **53/53 exacto**.

Los totales reales son **131 (E1)** y **~128 (E4)**, no 132. Las divergencias de texto de los
casos "en 2" y "en 1" hay que resolverlas a mano contra los PDF antes de re-extraer: hay que
elegir la versión canónica.

### 4.3 ⚠️ Las 330 figuras se rompen por posición Y por slug

La v1 sólo flagueó el slug. Verificado: el `NN` de la storage key **es la posición del ítem**,
en 330 de 330 casos (`item/global/paes-cie-qui-e3-2026/item_figure/26.png` ↔ `position 26`).

Al fusionar tres cuadernillos las posiciones se renumeran por fuerza, así que **cambian las dos
mitades de la key**. Mantener el slug viejo "por compatibilidad" no resuelve nada.

Dos salidas, y la segunda es la corrección de fondo:

1. Re-subir las 330 con la key nueva (barato, mecánico, pero repite el acoplamiento).
2. **Desacoplar `imageRef` de la posición** — hoy la key codifica un dato mutable. Es la deuda
   real que este cambio destapa.

### 4.4 ⚠️ `import-item-tags.ts` empareja por posición

La clave es `(config->>'sourceJson', items.position)`. Si las posiciones se renumeran, los tags
se aplican **al ítem equivocado y el script no lo detecta**: sólo cuenta `noItem` cuando la
posición no existe. Hay que migrar el matching a `(sourceJson, printedNumber)` o
`(sección, position)` **antes** de renumerar nada.

### 4.5 `assertSafeToRecreate` no es la red de seguridad que la v1 creía

Bloquea sólo por `tags` y `responses`, y `--force` lo saltea entero. **No mira `sheet_layouts`,
`sheet_print_runs`, `assessments`, `files` ni `assessment_item_stats`.** Para Ciencias hoy da
igual (§4.1), pero no hay que apoyarse en él.

### 4.6 El importador descarta `config`, `max_points` y `org_id` de sección

`import-instruments.ts` sólo persiste `name`, `type`, `order`, `instructions` y los campos de
pasaje. El tipo `Section` ni declara los otros. Por eso `instrument.paes` "no se pierde":
**nunca se lee**. La etapa A incluye enseñarle al importador a persistir el rol.

---

## 5. Alcance por etapas — CORREGIDO

⚠️ La v1 decía *"A y B se pueden hacer sin C"*. **Es la afirmación más peligrosa del documento:
produce datos falsos sin ningún error.** El orden real es:

| # | Etapa | Entrega | Por qué va aquí |
|---|---|---|---|
| **1** | **C·1 Ingesta por forma** | La ingesta itera los ítems de las secciones de la forma del alumno | Precondición de todo: sin esto, cualquier carga sobre un instrumento con electivas produce respuestas fantasma |
| **2** | **A** Rol en columnas + Zod + importador | Modelo correcto, inerte para lo existente | Base del resto |
| **3** | **C·2** `assessment_form_students` + RLS + resolución de forma | Se puede asignar la mención de cada alumno | Necesita A |
| **4** | **B·0** Migrar el matching de tags a `printedNumber` | Evita mis-tagging silencioso | **Antes** de renumerar |
| **5** | **B·1** Resolver las divergencias de E1/E4 contra los PDF | Versión canónica de cada común | Antes de re-extraer |
| **6** | **B·2** Re-extraer e importar Ciencias como 3 instrumentos + re-subir figuras | Deduplicación real | Necesita B·0 y B·1 |
| **7** | **C·3** `studentCount` al grano (curso, ítem) | Estadística de cohorte correcta | Antes de exponer analítica de Ciencias |
| **8** | **D** Layout por forma (§3.5) | Hoja de 80 campos | Independiente del resto |

**Lo que desbloquea la carga de los ~430 escaneos pendientes es 1→6.** D es para el lector.

---

## 6. Preguntas abiertas y huecos de producto

1. **Alumno sin forma asignada.** Hoy caería en el bug de §2. Con la ingesta corregida quedaría
   sin ninguna respuesta. Ninguna de las dos sirve: hay que decidir si se rechaza la carga, si
   queda en una cola, o si se infiere. **Sin decisión no se implementa C.**
2. **Alumno que responde sólo el común.** `isComplete = rows.every(r => r.isCorrect !== null)`
   lo marcaría **completo** con 54 de 80. Hace falta chequear completitud **contra la forma**.
   Es un modo de falla nuevo que el modelo actual no tiene.
3. **% de logro por sección.** No existe hoy: `performance_bands` y `resolve-effective-bands`
   resuelven por instrumento, y nada agrega por `section_id`. Si se quiere "logro en el común"
   vs "logro en la mención", es trabajo aparte.
4. **Cambio de mención entre ensayos.** El unique propuesto es por forma, así que técnicamente
   se permite; falta definir qué pasa con las respuestas ya cargadas bajo la anterior.
5. **Comparabilidad — acotar la promesa.** Fusionar resuelve la comparación **sólo de las 54
   comunes**. En las menciones, dos alumnos siguen rindiendo pruebas distintas y **no hay
   equating en ninguna parte del código**. Clasificar con las mismas `performance_bands` a un
   alumno de Física y uno de Química asume una equivalencia de dificultad que nadie midió.
6. **De dónde sale la elección de cada alumno.** No existe en ninguna fuente: GradeCam no la
   trae. Inferirla de las respuestas da señal real pero **24% ambiguo** — sirve de verificación,
   no de fuente. Hace falta la matrícula del electivo.
7. **`imageRef` acoplado a la posición** (§4.3): ¿re-subir o desacoplar?

---

## 7. Alternativas evaluadas

### (a) Instrumento aparte para el común + 3 de mención, relacionados

Deduplica igual y **evita el problema de raíz**: cada instrumento se rinde entero, así que la
ingesta, `studentCount`, el layout y las bandas funcionan sin tocar nada. No necesita el
cambio de la ingesta (§2), ni `studentCount` por ítem, ni layout por forma.

Costo: el % de logro del alumno queda partido en dos instrumentos y hay que sumarlo en una capa
nueva; y la relación pasa a ser entre instrumentos, así que `assessment_forms` no basta.

**Es genuinamente competitiva si el objetivo prioritario es desbloquear la carga de los ~430
escaneos.** Se descarta porque parte el resultado del alumno en dos —que es precisamente lo que
el usuario ve— y porque deja el modelo sin una noción de "prueba con partes opcionales", que es
lo que se quiere reutilizar. Pero si el calendario aprieta, es el plan B honesto.

### (b) `item_id` canónico con alias

Mantener los 9 instrumentos y apuntar las 3 copias de cada común a un ítem canónico. Resuelve
la estadística partida y la corrección por triplicado sin tocar la ingesta. Introduce dos
identidades de ítem en un schema que asume una, y contradice el modelo polimórfico.
**Descartada.**

---

## 8. Registro de la auditoría (qué cambió de la v1)

| # | Hallazgo | Severidad | Dónde se corrigió |
|---|---|---|---|
| B1 | La ingesta crea una response por ítem del instrumento ⇒ respuestas fantasma y −39 puntos | Bloqueante | §2, §3.4, §5 (C·1 pasa a ser etapa 1) |
| B2 | El común no está alineado por posición entre cuadernillos (E1) | Bloqueante | §4.2 |
| M2 | Las figuras se rompen por posición además de por slug | Mayor | §4.3 |
| M3 | `studentCount` asume que todos responden todo | Mayor | §3.4, §5 (etapa 7) |
| M4 | El layout es por instrumento; el freeze falla hoy | Mayor | §3.5 |
| M5 | El importador descarta `config` de sección; `assertSafeToRecreate` no cubre lo que se creía | Mayor | §4.5, §4.6 |
| M6 | `import-item-tags` empareja por posición ⇒ mis-tagging silencioso | Mayor | §4.4 |
| m7 | RLS de la tabla nueva; `assessment_forms` sin `org_id` | Menor | §3.3 |
| m8 | `responses.form_id` ya existe; `item_order` está muerto | Menor | §3.3 |
| m9 | Huecos de producto (sin forma, completitud, % por sección, cambio de mención, comparabilidad) | Menor | §6 |
| — | El rol debe ir en columna tipada, no en `config` | — | §3.2 |
| — | Cifras corregidas: 1.399 tags propios (no 2.528), 330 figuras | — | §4.1 |
