# Rediseño de la navegación

Diseño cerrado el 2026-10-06; ajustado el 2026-10-07 por los acuerdos entre sesiones de
`coordinacion/acuerdos.md`. Copia versionada del documento de diseño
(https://claude.ai/code/artifact/4fad6d66-186f-4f29-b4c0-00a83ee35185). Es la fuente que leen
los subagentes de implementación y de auditoría.

El sidebar del `school_admin` baja de 14 a 10 ítems. Cuatro vistas dejan de ser destinos
sueltos y se abren desde donde el usuario ya tiene el contexto: Comparar, Remedial, Informe del
establecimiento y Mis cursos. Además, el informe del establecimiento mezcla resultados que no son
comparables, así que se rehace por proceso de medición.

## 1. Sidebar final

| Grupo (`id`)                       | Ítems                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| _(sin título)_                     | Inicio                                                                  |
| Evaluaciones (`evaluaciones`)      | Procesos de medición · Evaluaciones · Hojas de respuesta                |
| Análisis (`analisis`)              | Panorama pedagógico · Ficha del estudiante · Comparación entre colegios |
| Material y contenido (`contenido`) | Banco de contenido · Materiales                                         |
| _(sin título)_ (`administracion`)  | Administración                                                          |

| Antes                    | Después                    | Dónde                                                                                                     |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Vista 360 del estudiante | Ficha del estudiante       | Sidebar y título de la vista                                                                              |
| Benchmarking             | Comparación entre colegios | Sidebar y título de la vista                                                                              |
| Comparar instrumentos    | Comparar evaluaciones      | Título de la vista (la ruta `/comparar-instrumentos` y los parámetros `baseId`/`comparisonId` no cambian) |
| Alumnos                  | Nómina de alumnos          | Hub de Administración                                                                                     |

## 2. Decisiones

| Vista                       | Decisión                                                                                                                           | Nuevo punto de entrada                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Comparar evaluaciones       | Sale del sidebar. Al elegir las dos evaluaciones se muestra la comparación de resultados; el análisis IA queda detrás de un botón. | Menú de acciones (⋮) del detalle de la evaluación y tab Trayectoria de Panorama  |
| Material Remedial           | Sale del sidebar. Se lista dentro de Materiales, con su origen y su estado.                                                        | Materiales. La generación sigue en Análisis IA y en el tab de la evaluación      |
| Informe del establecimiento | Sale del sidebar. Se calcula por proceso de medición, no por año.                                                                  | Detalle del proceso, y una acción en Panorama cuando hay un proceso seleccionado |
| Ficha del estudiante        | Se renombra. Todo nombre de alumno en la app enlaza a ella.                                                                        | Sidebar y nombres de alumno                                                      |
| Comparación entre colegios  | Se queda en el sidebar y se renombra.                                                                                              | Sidebar                                                                          |
| Telemetría de uso           | Pasa al hub de Administración.                                                                                                     | Hub de Administración                                                            |
| Mis cursos                  | Sale del sidebar.                                                                                                                  | Tarjeta "Mis cursos" de Inicio (vista de profesor)                               |
| Nómina de alumnos           | Se renombra en el hub, aunque siga en _próximamente_.                                                                              | Hub de Administración                                                            |

Todas las rutas se conservan; solo cambia cómo se llega a ellas.

## 3. Comparar evaluaciones

**Puntos de entrada.**

- Menú ⋮, arriba a la derecha en `/evaluaciones/[id]`, con la opción "Comparar con otra
  evaluación". Abre el comparador con esa evaluación como base. Si no hay ninguna comparable, la
  opción aparece deshabilitada y explica por qué.
- El menú ⋮ también reúne "Ver enunciado" y "Tabla de especificaciones". "Ask AI" sigue visible
  fuera del menú.
- Trayectoria: al elegir dos puntos, la acción "Comparar" abre el comparador con ambos
  preseleccionados. Si un punto agrega varias evaluaciones, la acción abre solo con la base.

**Qué se compara.** Se mantiene la regla actual: dos evaluaciones son comparables si su
instrumento tiene el mismo tipo, grado y asignatura. Se comparan aplicaciones, no instrumentos.

**Medidas inmediatas, sin IA.**

| Medida                             | Cómo                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Distribución por nivel (principal) | Cada alumno con las bandas de **su** instrumento: `resolveEffectiveBandsForInstruments` + `hydrateBandForStudent`.                                                                                                                                                                                                                                                                   |
| Movimiento entre niveles           | Matriz de transiciones sobre la cohorte pareada.                                                                                                                                                                                                                                                                                                                                     |
| % de logro (secundario)            | `achievementPct` de `@soe/types`: Σpuntaje / Σmáximo, **nunca** `avg(percentage)`. Para toda la cohorte se usa `assessment_item_stats.score_sum/max_sum` filtrado por los `class_group_id` en alcance; para la cohorte pareada, `assessment_results.total_score/max_score`. Lleva un aviso fijo: "Instrumentos distintos; la diferencia puede deberse a la dificultad de la prueba". |
| Logro por eje o habilidad          | Solo para los nodos de taxonomía evaluados en ambas evaluaciones.                                                                                                                                                                                                                                                                                                                    |
| N                                  | Se muestran el N evaluado y el N pareado, y el N de cada medida por separado. Por defecto la cohorte es la pareada; se puede cambiar a "todos".                                                                                                                                                                                                                                      |

Las evaluaciones `aggregate_only`, cargadas desde informes oficiales, tienen estadísticas por
ítem y filas en `assessment_results` con la banda de cada alumno, pero con `total_score` y
`max_score` nulos. Tienen % de grupo y bandas pareables, pero no % por alumno.

Si la cohorte pareada queda vacía, la vista lo dice y compara las cohortes completas.

**Comparar con IA.** Un botón lanza el diagnóstico existente, que lee el instrumento y sus ítems.

**Acceso.**

| Parte                     | Roles                                                                                     | Flag          |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| Comparación de resultados | `COMPARE_RESULTS_VIEWER_ROLES` (= `RESULTS_VIEWER_ROLES`); el profesor solo ve sus cursos | —             |
| Comparar con IA           | `AI_ANALYSIS_GENERATOR_ROLES`                                                             | `ai_analysis` |

## 4. Informe del establecimiento

**Problemas del cálculo actual** (`apps/api/src/official-reports/establishment-report.service.ts`):

1. Mezcla tipos de instrumento: solo filtra por año y, opcionalmente, por `period`.
2. Mezcla momentos: `period` no está en la UI.
3. Deduplica por alumno × asignatura × grado quedándose con la primera fila de una consulta sin
   `ORDER BY`, así que la fila que cuenta es arbitraria.
4. Si las bandas difieren entre instrumentos, cae al `performance_level` heredado (cortes
   50/70/85).
5. Compara por sexo el % de logro de pruebas distintas.

**Rediseño: un informe por proceso de medición.**

- **Alcance:** solo las evaluaciones con `assessments.process_id = processId`, de un proceso de la
  org que no esté borrado.
- **Un instrumento por grado × asignatura.** Las evaluaciones de ese instrumento (normalmente una por curso) se
  agregan en una columna. Si la celda mezcla instrumentos distintos, va sin números, con la marca
  `multipleInstruments` y la lista de evaluaciones.
- **Niveles:** solo las bandas de cada instrumento. Si un instrumento no tiene bandas, la celda
  lleva `bandsMissing`. Nunca se usan los cortes heredados.
- **Cobertura:** evaluados / esperados por grado. El denominador sale de `expected_scope` o, si
  este no da conteos, de la matrícula de los cursos en alcance.
- **Por sexo:** dentro de cada celda, que ya tiene un solo instrumento. **Excepción acordada:**
  `femaleAvg` y `maleAvg` siguen siendo medias de los % individuales, porque son el estadístico
  del t de Welch. Si el informe llegara a mostrar un % de grupo, se calcula con `achievementPct`.
- **Disponibilidad:** solo en procesos cuyos instrumentos tienen bandas.
- **Puntos de entrada:**
  - Tab "Informe del establecimiento" en `/procesos/[processId]`, con
    `ESTABLISHMENT_REPORT_ROLES`.
  - Acción en Panorama, habilitada solo con un proceso seleccionado.
  - `/establecimiento/informe-oficial` muestra un selector de procesos cuando no recibe
    `processId`.

## 5. Materiales unificado

Materiales pasa a ser el único listado. Los remediales se muestran ahí, pero siguen siendo su
propia entidad (`remedial_materials`), con su ciclo de aprobación IA → humano.

- Etiqueta de origen en cada fila: _Generado por IA · Remedial_, _Desde instrumento_, _Copia de
  documento_ o _En blanco_.
- Estado de los remediales (_Por revisar_, _Aprobado_) y filtro "Por revisar".
- Un remedial que ya tiene documento se muestra una sola vez. "Abrir en editor" reutiliza el
  documento existente.
- Los remediales se listan solo con `REMEDIAL_VIEWER_ROLES` y el flag `remedial`.
- `/material-remedial` redirige a `/materiales?origin=remedial`, **salvo** con
  `?nodeId=&generate=1`, que sigue siendo el flujo de generación.

## 6. Ficha del estudiante

- Se llama "Ficha del estudiante" en el sidebar y en el título de la vista.
- `StudentLink` enlaza el nombre a la ficha si el usuario tiene `RESULTS_VIEWER_ROLES`; si no, lo
  muestra como texto. Se aplica en el detalle de curso, el informe del curso, la tabla de señales
  y las tablas de resultados.
- Solo se enlaza si la API de la ficha respeta el alcance docente.

## 7. Vistas menores

- **Comparación entre colegios:** solo se renombra.
- **Telemetría:** opción del hub con `TELEMETRY_VIEWER_ROLES`, y su ruta en `ADMIN_HUB_PATHS`.
- **Mis cursos:** sale del sidebar. Se elimina `ALL_STAFF_ROLES`.
- **Nómina de alumnos:** renombre en el hub.

## 8. Cambios de acceso intencionales

Son los únicos cambios de acceso permitidos; el auditor no los reporta como hallazgos.

1. Mis cursos sale del sidebar; la ruta y la tarjeta de Inicio se conservan.
2. Telemetría pasa del sidebar al hub, con los mismos roles.
3. Comparar, Material Remedial e Informe del establecimiento cambian su punto de entrada.
4. La comparación sin IA se abre a `RESULTS_VIEWER_ROLES` (antes exigía
   `AI_ANALYSIS_GENERATOR_ROLES` + flag `ai_analysis`). La parte IA conserva su guard.
5. `foundation_director` ve "Administración" con solo Telemetría.
6. El informe del establecimiento cambia su query de año/momento a `processId`.
7. Mis cursos queda sin entrada visible para quienes no tienen rol activo de profesor: la tarjeta de
   Inicio solo aparece en la vista de profesor. La ruta sigue existiendo.
8. La comparación con IA usa la misma regla que la comparación sin IA (`areInstrumentsComparable`),
   que además distingue la rama electiva: ya no compara, por ejemplo, M1 con M2.
9. El diagnóstico IA se lanza desde la comparación, que respeta el alcance del rol activo. Un usuario
   profesor + coordinador con rol activo de profesor lo lanza sobre sus cursos; cambia de rol para
   verlo sobre toda la organización.

## 9. Fuera de alcance

- Convertir el remedial en un tipo de documento.
- Que Mi Colegio enlace al detalle de cada curso.
- Ajustes específicos para `foundation_director`.
- La integración en contexto de la comparación entre colegios.
- El Área Socioemocional del informe.

## 10. Coordinación con otras sesiones

Ver `coordinacion/acuerdos.md`, fuera del repo.

- Esta rama es dueña de `establishment-report.service.ts`, `official-report-establishment.schema.ts`,
  `nav-items.ts`, `access-policies/results-dashboards.ts` y la página `/benchmarking`.
- `comparability.ts` y `packages/types/src/index.ts` solo admiten agregados.
- `resultados/page.tsx` es compartido: aquí solo se toca el encabezado.
- `/procesos/[processId]/page.tsx` es de otra sesión; aquí solo se toca `layout.tsx`.
- `achievement.ts` llega por la PR #283 (rama `feat/achievement-tally`), que es la base de esta
  rama hasta que se mergee.
