# Plan — Etiquetar los ítems de Matemática con su eje temático (Opción B)

> **Fecha:** 2026-07-17
> **Estado:** Propuesta, para ejecutar en un worktree.
> **Objetivo:** que los ítems DIA de Matemática queden etiquetados con su **eje temático**
> (Números y operaciones, Geometría, Medición, Patrones y álgebra, Datos y probabilidades),
> para desbloquear la carga de los 24 informes de Matemática (Fase 6) y que el análisis
> desglose por la dimensión que el propio DIA usa para Matemática.

---

## 1. Por qué

El importador de informes DIA falla el **gate #3** para Matemática con
*"no hay exactamente un nodo de taxonomía con ese nombre etiquetado en los ítems"* (los 5 ejes).

- **No es el bug del `correctKey`** — ese ya está arreglado (rama `fix/importer-instrument-correctkey`);
  con el fix, **Lectura pasa** el gate #3.
- La causa es un **hueco de etiquetado**: los ítems de Matemática en demo están etiquetados por
  **habilidad** (`Representar`, `Resolver problemas`) + `learning_objective` (OA) + `descriptor`,
  pero **no por eje temático**. El Gráfico 2 del informe de Matemática es por **eje temático**.
- Lectura funciona porque ahí el eje del informe (Localizar / Interpretar / Reflexionar) *es* la
  habilidad, que sí es como están etiquetados sus ítems. En Matemática, las dos dimensiones no
  coinciden.

**No hay que crear nodos.** Los 5 ejes ya existen como nodos `axis`, uno por grado
(`CUR-CONTENIDO-MATH-{grado}B-AX-{eje}`), y `oas-oficiales.json` mapea los **146 OA** de
Matemática a su eje (0 sin eje). Los ítems ya tienen su OA. Así que (b) es **derivar** el tag de
eje del OA que el ítem ya trae, y agregarlo.

---

## 2. Hechos verificados (no re-verificar)

| Hecho | Fuente |
|---|---|
| Los 5 nodos de eje temático existen, **por grado** | `packages/db/data/taxonomia-catalogo-v2.json` — códigos `CUR-CONTENIDO-MATH-{1..6}B-AX-{slug}` |
| Los 146 OA de Matemática mapean a su eje, 0 sin eje | `Histórico Pruebas DIA/taxonomia-oficial/oas-oficiales.json` (`oas[].ejeCode`) |
| Cada ítem de Matemática ya está etiquetado con su OA | plan actual — `learning_objective MATH-{grado}B-OA{n}` |
| El etiquetado se siembra desde un plan y es replicable en prod | `packages/db/data/instruments/item-tags-plan.json` → `db:import:item-tags` (`import-item-tags.ts`) |
| `import-item-tags` resuelve cada tag por su `code` → `taxonomy_nodes.code` | reporta `noCode` si algún code no tiene nodo |

**Construcción del código del nodo de eje** (determinística):
`CUR-CONTENIDO-MATH-{gradoDelOA}-AX-{slug}`, donde
- `gradoDelOA` sale del código del OA (`MATH-`**`3B`**`-OA02` → `3B`), y
- `slug` = `ejeCode` de `oas-oficiales` sin el prefijo `MATH-AX-`
  (`MATH-AX-`**`NUMEROS-Y-OPERACIONES`** → `NUMEROS-Y-OPERACIONES`).

Ejemplo: item con OA `MATH-3B-OA02` (eje "Números y operaciones")
→ `CUR-CONTENIDO-MATH-3B-AX-NUMEROS-Y-OPERACIONES` (verificado que existe en el catálogo).

---

## 3. Diseño

- **Fuente durable = el plan de tags del repo.** El fix vive en
  `packages/db/data/instruments/item-tags-plan.json`, no en un `INSERT` suelto en demo. Así un
  re-seed también etiqueta bien, y `db:import:item-tags` lo aplica a demo/prod de forma replicable.
- **Derivación por ítem de Matemática:** de su tag `learning_objective` (OA) →
  grado + eje (`oas-oficiales`) → código del nodo `axis` → nuevo tag
  `{ code, type: 'content', tagType: 'secondary' }` (el `type` real que usa el catálogo para los
  ejes; confirmar en el paso 3 del §4).
- **Idempotente:** no duplicar si el ítem ya tiene el tag de eje.
- **Solo Matemática.** Lectura no se toca (su eje = habilidad ya está tagueado).

---

## 4. Pasos

1. **Worktree.** Crear `feat/matematica-eje-tematico` **desde `fix/importer-instrument-correctkey`**
   (que ya trae el fix del `correctKey`, del que depende que el `correctCount` de Matemática sea
   correcto), en un worktree nuevo. Ver [[feedback-implement-in-worktree]] y
   [[feedback-worktree-commit]].

2. **Script generador** (`packages/db/scripts/` o similar, o un one-shot en el worktree): lee
   `item-tags-plan.json` + `oas-oficiales.json`; para cada entrada cuyo instrumento sea de
   Matemática, toma su OA, deriva el código del nodo de eje (§2) y agrega el tag si no está.
   Reescribe `item-tags-plan.json`. Determinístico y re-ejecutable.

3. **Verificar en frío** (sin BD):
   - 100% de los ítems de Matemática reciben exactamente **un** tag de eje.
   - Todos los códigos construidos **existen** en `taxonomia-catalogo-v2.json` (0 códigos huérfanos).
   - Confirmar el **`type` del nodo de eje** en el catálogo (`axis` vs `content`) y usar ese valor
     en el tag. ⚠️ Verificar que ese tipo **no** esté en `RESULT_HIDDEN_NODE_TYPES` de `@soe/types`
     (si lo estuviera, el eje no aparecería en el desglose de resultados aunque el gate lo valide).

4. **Aplicar a demo** (túnel `sst tunnel --stage demo`, ver skill [[demo-db-access]]):
   `DATABASE_ADMIN_URL=… pnpm --filter @soe/db db:import:item-tags`. Confirmar "Todos los codes
   resolvieron a un nodo ✅".

5. **Re-correr el dry-run del importador** (`apps/api/scripts/cargar-informes-dia.ts`, sin
   `--confirm`) contra demo → **Matemática pasa el gate #3**. El túnel se cae en corridas largas
   (~26 informes → `CONNECT_TIMEOUT`): correr en lotes o con reconexión.

6. **Cargar** (con `--confirm`) los 24 de Matemática + los 16 de Lectura. Verificar en demo:
   `assessment_item_stats`/`assessment_skill_stats` poblados, y el desglose por eje temático de
   Matemática visible.

7. **PR**: `item-tags-plan.json` actualizado + el script generador → `dev`, y de ahí a `main` junto
   con el fix del `correctKey`. (La aplicación a demo del paso 4 no necesita deploy — es dato en la
   BD; pero el commit del plan es lo que hace durable el etiquetado.)

---

## 5. Criterios de aceptación

- Gate #3 de Matemática **pasa** (derivado por eje ≈ reportado, tolerancia 0.01 pp). Esto valida de
  paso la pauta (`correctKey`) y el `scoring_config`, no solo el etiquetado.
- El desglose por **eje temático** de Matemática aparece en `assessment_skill_stats` y en el
  dashboard de habilidades.
- **Ningún número de Lectura se mueve** (no se toca su etiquetado).
- `import-item-tags` sobre una BD fresca (o re-seed) etiqueta Matemática con el eje sin pasos manuales.

---

## 6. Consideración abierta — dimensión mixta

Tras (b), los ítems de Matemática quedan con **dos** dimensiones de tag: habilidad
(`Representar`/`Resolver`) **y** eje temático. El read-model deriva el desglose de *todos* los tags,
así que el desglose de Matemática mostraría ambas dimensiones mezcladas (Representar, Resolver,
Números y operaciones, Geometría…). No hay doble conteo dentro de una dimensión (cada ítem suma una
vez por nodo), pero sí conviven dos ejes de lectura.

Opciones (decidir por separado, **no** bloquea la carga):
- **Aceptar** — es más información; el dashboard puede agrupar por tipo de nodo.
- **Que el dashboard filtre/agrupe** el desglose por tipo de nodo (habilidad vs eje).
- **Priorizar eje temático** sobre habilidad para Matemática en el read-model/importador — es más
  cambio de código y toca la simetría con Lectura.

Lectura no tiene este cruce (su único eje relevante es la habilidad).

---

## 7. Riesgos

- **Código de nodo mal construido** (grado/slug) → el tag no resuelve. Mitigado por la verificación
  en frío del paso 3 (`import-item-tags` además reporta `noCode`).
- **Nombres duplicados entre grados** en el gate: `evaluateAxes` exige *exactamente un* nodo por
  nombre entre los ítems del instrumento. Como cada instrumento es de un solo grado y taggeamos con
  el nodo del grado correcto, "Números y operaciones" resuelve a un único nodo. Verificar en el paso 5.
- **El tipo de nodo del eje está oculto en resultados** (`RESULT_HIDDEN_NODE_TYPES`) → pasa el gate
  pero no se ve en el desglose. Verificación en el paso 3.
- **Túnel inestable** en corridas largas → lotes.

---

## 8. Relación con el resto

- **Depende del fix del `correctKey`** (`fix/importer-instrument-correctkey`, ya commiteado, tests
  72/72): sin él, el `correctCount` MC de Matemática sería 0 y el gate #3 fallaría por esa otra
  causa. Ambos van juntos a `dev`→`main`.
- **Descarta la opción (c)** (refinar el gate para que un eje no-validable sea warning): (b) deja el
  dato como debería estar (los ítems de Matemática *pertenecen* a un eje temático) y da el desglose
  por eje temático que el propio DIA usa, en vez de solo saltarse la validación.
- **La carga histórica** (los 40 informes) usa el script standalone `cargar-informes-dia.ts`, que
  corre el importador con el código local (con el fix). El deploy del fix a la API es para que la
  UI/API sea correcta a futuro, no para esta carga.
