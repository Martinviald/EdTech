# Runbook — Activar el tablero por procesos y pruebas en demo

Este runbook se ejecuta **con el usuario**, después de mergear la PR. Ningún paso es automático. Cada operación de datos se corre primero en dry-run y se revisa su salida antes de agregar `--commit`.

Contexto y decisiones: `docs/diseno-tablero-procesos-pruebas.md`. Detalle de cada fase: `docs/tablero/f1…f5-*.md`.

## 0. Antes de mergear

1. **Versión de Postgres de demo:** las migraciones son compatibles con PG 14. Confirmar la versión real (`select version()`).
2. **Ninguna sección electiva en demo — correr ANTES de mergear.** El push a `main` migra de inmediato, y la migración **`0040`** agrega el CHECK `instrument_sections_elective_requires_track` (sin `NOT VALID`, así que valida las filas que ya existen): exige línea en toda sección `elective`. Debe dar 0:

   ```sql
   select count(*) from instrument_sections where role = 'elective';
   ```

   Si no da 0, asigna línea a esas secciones con `db:backfill:tracks --set <instrumentId>=<CODE>` (§0.4) antes de mergear.

   **Qué pasa si se mergea igual** (medido en local, no es teoría): Drizzle corre todas las migraciones pendientes en **una sola transacción**, así que el CHECK revienta y se revierte la tanda completa — `0034` a `0040` incluidas. La base queda intacta en `0033`, y como `build-and-push` declara `needs: migrate`, **no se publica imagen nueva**: la app sigue sirviendo con la versión anterior. O sea, un deploy fallido y reintentable, sin inconsistencia ni ventana de downtime. Lo que sí queda desalineado mientras tanto es el código de `main` (en 0040) contra el schema de demo (en 0033), así que el job diario `refresh-benchmark.yml` fallará hasta que la migración entre.

3. **Ciencias legacy en demo:** anotar los conteos que después debe reproducir la migración.
   ```sql
   -- evaluaciones y respuestas con loadKey paes-2026-cie
   select count(distinct a.id), count(r.id)
   from assessments a left join responses r on r.assessment_id = a.id
   where a.config->>'loadKey' = 'paes-2026-cie';
   ```
4. **Pares hermanos sin línea.** Celdas (año, período, grado del curso, asignatura) con más de un instrumento distinto y `track_id` null. Al agrupar por período, cada una de estas celdas queda sin proceso (el resto del período sí se asigna). El caso típico es DIA Speaking junto a DIA Inglés del mismo grado:
   ```sql
   select ay.year as anio, i.type as tipo, i.application_period as periodo,
          g.short_name as grado, s.short_name as asignatura,
          count(distinct i.id) as instrumentos,
          string_agg(distinct i.name || ' = ' || i.id, E'\n') as candidatos_a_set
   from assessments a
   join instruments i on i.id = a.instrument_id and i.deleted_at is null
   join assessment_course_assignments aca on aca.assessment_id = a.id
   join class_groups cg on cg.id = aca.class_group_id
   join academic_years ay on ay.id = cg.academic_year_id
   join grades g on g.id = cg.grade_id
   left join subjects s on s.id = i.subject_id
   where i.track_id is null and i.application_period is not null
   group by a.org_id, ay.year, i.type, i.application_period, g.short_name, g."order", s.short_name
   having count(distinct i.id) > 1
   order by ay.year, i.type, i.application_period, g."order", s.short_name;
   ```
   Si el par es legítimo (dos pruebas distintas de la misma asignatura), asígnale línea al instrumento que no tiene JSON en el repo con `--set` en el paso 2 de §2 (repetible, dry-run por defecto; valida que la línea sea de la asignatura del instrumento y que un instrumento oficial use una línea oficial):
   ```bash
   pnpm --filter @soe/db db:backfill:tracks --set <instrumentId>=SPEAKING [--set <otroId>=<CODE>] [--commit]
   ```
5. **Instrumentos DIA sin bandas efectivas.** Instrumentos DIA con evaluaciones que no tienen bandas propias ni de una versión anterior de su familia. En el tablero, sus celdas se verán sin color, solo con el %:
   ```sql
   select i.year as anio, i.application_period as periodo, i.name as instrumento, i.id,
          count(distinct a.id) as evaluaciones
   from instruments i
   join assessments a on a.instrument_id = i.id
   where i.type = 'dia' and i.deleted_at is null
     and not exists (
       select 1 from performance_bands pb
       where pb.instrument_id = i.id and pb.deleted_at is null)
     and not exists (
       select 1 from instruments prev
       join performance_bands pb on pb.instrument_id = prev.id and pb.deleted_at is null
       where prev.deleted_at is null and prev.type = i.type
         and prev.subject_id is not distinct from i.subject_id
         and prev.grade_id is not distinct from i.grade_id
         and prev.application_period is not distinct from i.application_period
         and prev.track_id is not distinct from i.track_id
         and prev.year < i.year)
   group by i.id, i.year, i.application_period, i.name
   order by i.year, i.application_period, i.name;
   ```

## 1. Merge y deploy

El push a `main` corre `deploy-backend.yml`: **siete** migraciones, re-aplica `rls-policies.sql` y corre el gate+backfill de cohort stats y el refresco del read-model de benchmarking.

| Migración                                       | Qué trae                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `0034_public_nitro` · `0035_breezy_king_bedlam` | Procesos de medición (`measurement_processes`, `assessments.process_id`) y ajustes                                |
| `0036_decisions`                                | Motor de decisiones: `decision_settings`, `decision_calls`                                                        |
| `0037_gray_kat_farrell`                         | `performance_bands.source` (⚠️ nace `'unknown'` en todas las bandas ya cargadas; nadie la lee todavía)            |
| `0038_handy_pretty_boy`                         | Cuatro índices que sirven las políticas RLS indexables                                                            |
| `0039_green_king_cobra`                         | Read-model `benchmark_item_aggregates` y `benchmark_aggregates.band_counts`                                       |
| `0040_greedy_serpent_society`                   | `test_tracks`, `track_id` en instrumentos y secciones, índice único de slug activo, y los tres CHECK de electivas |

Las políticas RLS nuevas cubren `measurement_processes`, `test_tracks` (dos: aislamiento por tenant + lectura del catálogo oficial), `decision_settings` y `decision_calls`.

Las siete son aditivas. Con `track_id` y `process_id` en `null`, el tablero muestra lo mismo que hoy: las tomas aparecen como "· sin proceso", con los mismos números.

## 2. Operaciones de datos (en orden)

Todas con `DATABASE_ADMIN_URL` de demo, desde `origin/main` ya mergeado. Los cuatro scripts **verifican el rol al arrancar y abortan** si la conexión está sujeta a RLS: con `DATABASE_URL` (rol `soe_app`) no veían ni escribían las filas de otras orgs y reportaban éxito sin haber hecho nada.

⚠️ **El orden es 1 → 2 → 4 → 5 → 3 → 6** (Ciencias, luego PAES, luego DIA). Ejecutado así contra demo el 2026-10-06; las dos desviaciones respecto del orden de la tabla tienen razones distintas:

**Ciencias (4) antes que los PAES (5).** Mientras las menciones de Ciencias son instrumentos separados (BIO/FIS/QUI), la celda (grado, prueba Ciencias) tiene tres instrumentos y viola la invariante del paso 5: los Ensayos 1, 3 y 4 quedan SIN proceso y sólo se crea el del Ensayo 2. Corriendo `cie-electivas` primero, los tres se fusionan en uno con secciones electivas y el paso 5 crea los 5 procesos sin un solo conflicto.

**PAES (5) antes que los DIA (3).** El paso 3 no excluye las evaluaciones con `config.ensayo`, así que las PAES que el paso 5 no alcanzó a agrupar se las queda un proceso "Ensayo PAES 2026" genérico y sin momento; después el paso 5 ya no las ve, porque filtra por `process_id is null`. Revertirlo pide `UPDATE assessments SET process_id = NULL` a mano más borrar el proceso espurio. **Esto se observó de verdad** en el dry-run del paso 3: proponía ese proceso genérico con las 6 evaluaciones de los Ensayo 5. Corriendo el 5 primero, el 3 las encuentra ya vinculadas y no las toca.

⚠️ **Los Ensayo 5 llegan sin `config.ensayo`.** Se cargaron desde ramas aparte y sus evaluaciones no traen el campo por el que agrupa el paso 5, así que quedan fuera de todo proceso PAES y son justamente las que el paso 3 captura mal. Antes del paso 5, comprobar que ninguna PAES quedó sin él:

```sql
select i.name, count(*)
from assessments a join instruments i on i.id = a.instrument_id
where i.type = 'paes' and a.config->'ensayo' is null and i.deleted_at is null
group by i.name;
```

Si aparecen, marcarlas con su tanda (el campo es un **number**, no un string) y recién entonces correr el paso 5:

```sql
update assessments a set config = coalesce(a.config,'{}'::jsonb) || '{"ensayo": 5}'::jsonb, updated_at = now()
from instruments i
where i.id = a.instrument_id and i.name like 'PAES M% — Ensayo 5 (Tanda 5)%' and a.config->'ensayo' is null;
```

| #   | Comando                                                                                 | Qué debe mostrar el dry-run                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm --filter @soe/db db:seed:test-tracks` (agrega `--commit` para escribir)           | 7 líneas oficiales: M1, M2, CIE-COMUN, BIO, FIS, QUI, SPEAKING                                                                                                                                                                                                                                                         |
| 2   | `pnpm --filter @soe/db db:backfill:tracks`                                              | M1 E1–E4 y M2 E3–E4 (6 instrumentos). M1/M2 E5 no están en `main`: pasar sus JSON con `--dir <carpeta>` desde las ramas `feat/paes-m1e5-y-roster` y `feat/paes-m2e5-figuras` (total esperado: 8). Los pares hermanos de §0.4 se asignan con `--set <instrumentId>=<CODE>`                                              |
| 3   | `pnpm --filter @soe/db db:backfill:processes --org <CSCJ>`                              | Un proceso por período DIA (el Monitoreo Intermedio 2026 debe dar **64** evaluaciones). Un par hermano sin línea ya NO bloquea el período completo: el proceso se crea con el resto y solo esa celda queda sin proceso (toma "sin proceso"), listada como conflicto. Los PAES salen todos en conflicto: es lo esperado |
| 4   | `pnpm --filter @soe/db db:migrate:cie-electivas --org <CSCJ>`                           | Importa los 3 instrumentos fusionados y re-apunta las respuestas. **El gate interno aborta si el % de algún alumno cambia.** Revisar: alumnos por mención y ensayo, respuestas antes = después, 0 huérfanas, 0 sin forma                                                                                               |
| 5   | `pnpm --filter @soe/db db:backfill:processes:paes --org <CSCJ>` (**corre antes del 3**) | Un proceso por tanda (`config.ensayo` 1–5). Las fusionadas de Ciencias ya quedan vinculadas por el paso 4                                                                                                                                                                                                              |
| 6   | Recalcular el read-model de **M1 Ensayo 5**                                             | Hoy tiene 3 evaluaciones y 0 filas en `assessment_item_stats`. Revisar primero si tiene respuestas                                                                                                                                                                                                                     |

**Vuelta atrás de Ciencias:** `db:migrate:cie-electivas --org <CSCJ> --rollback` (dry-run), y luego con `--commit`. Devuelve cada respuesta a su evaluación e ítem legacy. Está probada en local: el estado queda idéntico al previo.

**No re-importar** los 9 JSON legacy de Ciencias en demo: el importador borra y recrea por `sourceJson`, y eso borraría sus tags por cascada.

## 3. Verificación en el tablero

- `/resultados/tablero-maestro` abre en la toma más reciente con resultados.
- El selector lista "Ensayo PAES 1…5 2026" y "DIA Monitoreo 2026", agrupados por año.
- **Ensayo PAES 3:** Matemáticas aparece como M1 | M2, y Ciencias como Común | Bio | Fís | Quí. Común suma toda la cohorte.
- **DIA:** mismos números que antes; colores por las bandas del instrumento (los instrumentos sin bandas muestran solo %, ver §0.5).
- `/resultados`, `/resultados/mapa-calor`, `/resultados/dimensiones`, `/resultados/clasificacion` y `/evaluaciones` abren por defecto en el proceso más reciente con resultados (comportamiento portado de #262): verificar que eso sea lo esperado tras crear los procesos PAES.
- Una URL vieja del DIA (`?academicYearId=…&instrumentType=dia&applicationPeriod=…`) redirige a `?processId=`.

## 4. Sincronizar `dev`

**Ya no aplica.** Esta sección se escribió asumiendo que la PR #275 entraba primero a `main` y que después había que regenerar las migraciones de `dev` sobre la cadena nueva. El camino que se tomó fue el inverso: el tablero entró a `dev` por el backport #276 (renumerado a `0040`) y a `main` llega dentro de la promoción única #247. La cadena de `dev` **es** la de `main` extendida en línea recta, así que no hay nada que regenerar ni que sincronizar después del merge.

## 5. Pendientes de datos (fuera de esta PR)

- **Ítems de Ciencias sin respuestas.** E1-BIO #58, E4-BIO #58 y E4-QUI #57/#60/#66 no tienen respuestas, y E1 #45 y E4 #28 comunes las tienen parciales. Se pueden cargar desde GradeCam.
- **Claves de Ciencias para revisar.** Antes de recorregir:
  - CIE-E4-FIS #28: `correctKey` es null; debería ser B.
  - CIE-E1-BIO #23 y #51: no coinciden con GradeCam.
- **Figuras pendientes.** Recortes de alternativas de E1 #45 y figura del modelo atómico de E4-QUI #60.
- **14 ítems fusionados sin tags.**
