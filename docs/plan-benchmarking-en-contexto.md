# Plan de desarrollo — Benchmarking en contexto

> **Qué es esto:** el plan para construir lo que define
> [`diseno-benchmarking-en-contexto.md`](./diseno-benchmarking-en-contexto.md): tickets por fase,
> archivos que toca cada uno, dependencias, criterios de aceptación, cómo se verifica y en qué orden se
> entrega. Las referencias `§N` apuntan al documento de diseño.
>
> **Fecha:** 2026-10-05 · **Estado:** 📋 plan propuesto, sin código.

---

## 1. Cómo se entrega

### 1.1 Rama, PR y commits

- **Una sola PR contra `dev`** (`feat/benchmarking-en-contexto`), con **un commit por fase** (fases 0
  a 4, §3–§7). El CI verifica la PR en cada push, así que cada fase se sube y se valida en CI antes de
  empezar la siguiente.
- La rama sale de `origin/dev` en su propio worktree.
- **Promoción a `main` aparte:** después se prepara la promoción completa `dev → main`, que es la que
  despliega a demo. Este plan no la incluye, pero deja anotado lo que esa promoción tiene que cuidar
  (§1.3).

### 1.2 Verificación

- **Durante el desarrollo (en la PR a `dev`):** CI de GitHub (typecheck, lint y tests de los jobs API,
  DB, Types y Web). En local sólo corren specs puntuales de un archivo; la máquina no aguanta las suites
  completas. Las consultas de control de cada fase que leen demo (p. ej. qué instrumentos comparten
  CSCJ y San Agustín) sirven para armar los casos de los specs con números reales.
- **Después de la promoción a `main`:** las listas "en demo" de cada fase (§3–§7) se recorren una vez
  desplegado, con un usuario directivo de CSCJ y otro de San Agustín.

### 1.3 Lo que la promoción `dev → main` tiene que cuidar

- **Migraciones divergentes.** Las migraciones de esta feature (`band_counts` en la fase 0, la tabla
  por ítem en la fase 3) nacen en la cadena de `dev`. La cadena
  canónica es la de `main` porque es la que despliega: al promover, se adopta la cadena de `main` y se
  **regenera** con `pnpm db:generate` (ver `feedback-sync-dev-main-migraciones`). Revisar que la
  migración regenerada sólo toque lo de esta feature.
- **Primer refresh.** El deploy de backend corre `db:refresh:benchmark` (desde #271), así que
  `band_counts` queda poblado en el mismo deploy. Verificarlo antes de mirar la UI.

### 1.4 Paralelización

Si se usa el método de sprint en paralelo, la frontera es la **fase** y, dentro de ella, el
**backend / frontend**. Los contratos de `@soe/types` de cada fase se fijan y se commitean **antes** de
lanzar agentes, porque los errores de integración aparecen justo en lo que dos agentes interpretan
distinto. En el grafo de §8 está qué puede ir en paralelo. Los commits de los agentes se integran en
la rama de la PR y se aplastan en el commit de su fase.

---

## 2. Decisiones tomadas

Resueltas el 2026-10-05 (§2 y §12 del diseño).

| Decisión | Resolución | Afecta |
| --- | --- | --- |
| P6 · Participación en la muestra | Se acuerda por contrato con cada colegio. Sin cambios de código. | — |
| P7 · Quién es muestra | Sólo los colegios reales (CSCJ y San Agustín). Los datos sintéticos se quedan en instrumentos propios; las 2 evaluaciones de prueba sobre instrumentos DIA reales ya se borraron de demo. Sin cambios de código. | — |
| D1 · La muestra incluye al propio colegio | Sí | 0.4 |
| D2 · Todos ven la muestra global, incluso con opt-out | Sí | 0.4 |
| D3 · "≈ muestra" bajo 0,5 pp | Sí, a calibrar | 1.2 |
| D4 · Profesores sin contraste | Sí, por ahora | 1.1, 1.7 |
| D5 · La global es la referencia principal y la red va en el tooltip | Sí | 0.4, 1.2 |
| D6 · Alerta absoluta con muestra similar | Severidad igual; se agrega el rótulo "Resultado similar en la muestra" | 2.5, 3.4 |
| D7 · Alertas con posición y magnitud | Sí, a calibrar | 1.7, 2.5 |
| D8 · k vuelve a 3 | Al entrar un tercer colegio; fuera de esta feature | — |

---

## 3. Fase 0 — Base

**Commit:** `feat(benchmarking): muestra por instrumento y benchmarking abierto a todos`
**Resultado:** el backend expone la muestra por instrumento en los niveles del instrumento, y el
benchmarking deja de ser de pago. Todavía no hay UI nueva.

| # | Ticket | Archivos | Tamaño |
| --- | --- | --- | --- |
| 0.1 | Contratos de la muestra | `packages/types/src/schemas/benchmark.schema.ts` | S |
| 0.2 | Cálculos puros de la muestra | `packages/types/src/utils/benchmark-sample.ts` (+ spec) | M |
| 0.3 | `band_counts` en el read-model | `packages/db/src/schema/benchmark.ts`, migración, `queries/benchmark-aggregates.ts` (+ spec) | M |
| 0.4 | `BenchmarkSamplesService` | `apps/api/src/benchmarking/benchmark-samples.service.ts` (+ spec) | L |
| 0.5 | Endpoint `GET /benchmarking/samples` | `benchmarking.controller.ts`, `benchmarking.module.ts` | S |
| 0.6 | Quitar el gating de pago | `benchmarking.controller.ts`, `apps/web/.../benchmarking/page.tsx` | S |
| 0.7 | Refresh por org tras la ingesta | `assessment-results.service.ts`, `answer-sheets.service.ts`, `official-report-import.service.ts` | M |

**0.1 — Contratos.** Agrega `benchmarkBandCountSchema`, `sampleSkillStatSchema`,
`instrumentSampleSchema`, `yourSamplePositionSchema`, `instrumentSampleEntrySchema`,
`instrumentSamplesResponseSchema` e `instrumentSamplesQuerySchema` (§8.2 del diseño, con `p10`). El
query acepta `instrumentIds` como lista separada por comas (`z.preprocess` + `.min(1).max(50)` de
UUIDs). Contrato **completo desde ya**, incluidos `p10` y los percentiles por nodo que usan las
alertas de las fases 1 y 2, para no cambiarlo a mitad de camino.

**0.2 — Cálculos puros.** Funciones sin DB, compartidas por la API y, si hace falta, la web:
`weightedMean(rows)`, `percentileOf(sorted, p)`, `percentileRank(values, value)` (se mueven desde
`benchmarking.service.ts`, que las tiene privadas), `classifyTypicalZone(value, p25, p75)`,
`sumBandCounts(rows)`. Spec con casos de 0, 1, 2 y N colegios.

**0.3 — `band_counts`.**
- Columna `band_counts jsonb` tipada con `.$type<BenchmarkBandCount[]>()`. La migración se genera con
  `pnpm --filter @soe/db db:generate` sobre la cadena de `dev` y se revisa a mano: sólo debe agregar
  la columna. Se regenera en la promoción a `main` (§1.3).
- El refresh cuenta por `band.key` (con `label` y `order`) además de la proyección legacy, que se
  mantiene para la página actual hasta la fase 4. Las filas band-only (`percentage` NULL) cuentan por
  su `performance_band_id` persistido; sin banda no suman a `band_counts`.
- **Aceptación:** tests en `benchmark-aggregates.spec.ts` para un instrumento DIA de 3 bandas
  (I/II/III con sus claves), para uno sin bandas (`band_counts = []`) y para filas band-only.

**0.4 — `BenchmarkSamplesService`.** `getSamples(user, instrumentIds)`:
- Una sola query a `benchmark_aggregates` con `instrument_id IN (…)`. Agrupa por instrumento con
  `Map` (sin `.find()` por fila; regla `04-collection-complexity`).
- **Global:** excluye `opt_out_global_pool`. Aplica k (`BENCHMARK_K_MIN_SCHOOLS`,
  `BENCHMARK_N_MIN_STUDENTS`); si no cumple, `global: null`. Calcula el promedio ponderado por
  alumnos, p10/p25/mediana/p75 sobre los promedios **por colegio**, la suma de `band_counts` y
  `perSkill` (promedio ponderado + p10/p25 por nodo).
- **Red:** la deriva como hoy (`parentId` cuyo padre es `foundation`); sin k.
- **Tu colegio:** percentil y `typicalZone` contra la global.
- `refreshedAt` = el máximo de las filas.
- Las funciones de 0.2 se importan; la lógica de un solo uso queda como métodos privados.
- **Aceptación:** spec con `makeDb` que cubre: sin otros colegios, cohorte bajo k, colegio con
  opt-out, red, bandas sumadas por clave, y el caso de 2 colegios de demo.

**0.5 — Endpoint.**
- `@Get('samples')` con `@Roles(...BENCHMARKING_VIEWER_ROLES)`; valida con
  `instrumentSamplesQuerySchema`.
- Escribe **una** fila en `benchmark_access_logs` por request (`mode: 'global'`,
  `filters.instrumentIds`).
- Va antes de `@Get('comparison')` en el controller para que no lo capture otra ruta.

**0.6 — Sin gating.**
- Se quitan `FeatureGuard` y `@RequireFeature('benchmarking')` del controller, y
  `isFeatureEnabled('benchmarking')` de la página.
- `'benchmarking'` se queda en `FEATURE_KEYS` (lo referencian specs y config).
- El item del menú ya filtra sólo por rol.
- Se actualiza el spec de `FeatureGuard` sólo si alguno asume este controller.

**0.7 — Refresh tras la ingesta.**
- Después de que la transacción de resultados **confirma** (fuera de ella), los tres caminos de
  ingesta llaman a `refreshBenchmarkAggregates(this.db, { orgId })` **sin esperar**: con `.catch()`
  que reporta con `reportServerError` y nunca falla la ingesta.
- Para CSCJ son ~116 instrumentos y unos segundos; por eso no se espera (CLAUDE.md §12).
- **Aceptación:** spec que verifica que un error del refresh no rompe la respuesta de la ingesta.

**Verificación** (CI en la PR; lo de demo, después de la promoción):
- [ ] CI verde.
- [ ] Tras el deploy, `band_counts` poblado en demo:
  `select count(*) filter (where jsonb_array_length(band_counts) > 0) from benchmark_aggregates`
  ≈ filas de instrumentos con bandas.
- [ ] En Lectura 6° Intermedio, `band_counts` de San Agustín da 0/9/9 (Nivel I/II/III, igual a la
  vista de resultados).
- [ ] `GET /benchmarking/samples` con un token directivo devuelve la global de los 11 instrumentos
  compartidos y `global: null` en los 3 sólo de San Agustín.
- [ ] Un usuario de un colegio sin `allowedFeatures` entra a `/benchmarking`.

---

## 4. Fase 1 — Contrastes principales y alertas de unidad y curso

**Commit:** `feat(benchmarking): contraste con la muestra en resultados y panorama`
**Resultado:** el directivo ve el contraste en las dos vistas que más usa y recibe alertas cuando el
colegio o un curso quedan bajo la muestra.

| # | Ticket | Archivos | Tamaño |
| --- | --- | --- | --- |
| 1.1 | Carga de muestras en la web | `apps/web/src/lib/benchmark-samples.ts` | S |
| 1.2 | `SampleTooltip` y `SampleDeltaChip` | `apps/web/src/components/shared/` + `/styleguide` | M |
| 1.3 | Muestra en `DistributionBar` | `resultados/components/distribution-bar.tsx` | M |
| 1.4 | Evaluación: Resumen y Resultados | `evaluaciones/[assessmentId]/page.tsx`, `resultados/page.tsx`, `resultados/informe/report-body.tsx` | M |
| 1.5 | Panorama: columna "vs muestra" | `resultados/page.tsx`, `resultados/components/comparable-units-table.tsx` | S |
| 1.6 | Trayectoria: delta "vs muestra" | `resultados/trayectoria/page.tsx` | S |
| 1.7 | Alertas `below_sample` y `class_below_sample` | `packages/types` (alertas), `comparable-alerts.service.ts`, `dashboards.module.ts`, `benchmarking.module.ts`, `dashboards.controller.ts`, banda de alertas | L |
| 1.8 | Telemetría | registro en `packages/types` (`telemetry.schema.ts`), componentes de 1.2 | S |

**1.1 — Carga.**
- `getInstrumentSamples(instrumentIds)` es `server-only`, va envuelto en `React.cache()` y devuelve un
  `Map<instrumentId, InstrumentSampleEntry>`.
- Ante error devuelve un mapa vacío y reporta con `reportServerError`: la vista nunca falla por la
  muestra.
- Lo llama sólo quien pasó `canAccess(roles, BENCHMARKING_VIEWER_ROLES)`.

**1.2 — Componentes.** Según §7.1–§7.2 del diseño.
- El tono sale de `typicalZone` (`StatusBadge`: warning / neutral / success), no del signo.
- Tokens de diseño, sin colores crudos.
- Ambos se agregan a `/styleguide`.
- El "Ver comparación" lleva a `/benchmarking?instrumentId=…&mode=global`.

**1.3 — `DistributionBar`.**
- Prop opcional `sample?: { bandCounts; label }`. Dibuja la barra fina bajo la del colegio,
  emparejando por `bandKey` con las `bands` de la vista.
- Si las claves no coinciden (instrumento sin bandas o set distinto), no dibuja la muestra.

**1.4 — Evaluación.**
- La página resuelve el `instrumentId` del assessment y, dentro de un `<Suspense fallback={null}>`,
  un hijo async pide la muestra y renderiza el chip junto al `StatCard`, la barra de la muestra y la
  columna "vs muestra" de `CourseComparison`.
- Si llega filtrado por `classGroupId`, el chip compara el curso (§8.5).
- La vista no espera a la muestra (`07-navigation-reactivity`).

**1.5 — Panorama.**
- Una sola llamada con los `instrumentId` de todas las filas de `ComparableUnitsTable`.
- Columna con `SampleDeltaChip` por fila, vacía cuando no hay muestra.

**1.6 — Trayectoria.** `MetricDelta` "vs muestra" en `MetricComparison`, sólo si el alcance es un
instrumento (`comparability.instrumentIds.length === 1`).

**1.7 — Alertas de unidad y curso (§9).**
- **Contratos:**
  - `below_sample` y `class_below_sample` en `DASHBOARD_ALERT_TYPES`.
  - `DashboardAlert.basis` (`absolute | internal | cohort`) y `DashboardAlert.cohort`. Las alertas
    existentes rellenan `basis` y llevan `cohort: null`.
  - `ALERT_THRESHOLDS.cohort` con `belowSamplePp: { medium: 5, high: 10 }`.
- **Servicio:**
  - `BenchmarkingModule` exporta `BenchmarkSamplesService` y `DashboardsModule` lo importa.
  - `ComparableAlertsService.deriveAlerts` recibe `samples` (o `null`) y suma
    `cohortAlerts(units, samples)`: funciones puras sobre `unit.averageAchievement`,
    `unit.byClassGroup` y la global.
  - Exige posición y magnitud a la vez (§9.4).
- **Acceso:** `ComparableOverviewService` pide las muestras sólo si
  `canAccess(user.roles, BENCHMARKING_VIEWER_ROLES)`. Aplica tanto a `/comparable-overview` como a
  `/comparable-overview/alerts`.
- **UI:** la banda de alertas muestra la etiqueta "vs muestra" y el `SampleTooltip` cuando
  `basis === 'cohort'`.
- **Aceptación:** spec con unidades y muestras construidas a mano:
  - bajo la zona típica pero con Δ chico → no alerta;
  - bajo p10 con Δ grande → `high`;
  - 2 colegios;
  - sin muestra → nada;
  - profesor → nada.

**1.8 — Telemetría.** Dos eventos en el registro tipado:
- `benchmark.sample_tooltip_opened`, con `{ view, instrumentId }`.
- `benchmark.sample_detail_clicked`.

Sirven para medir lo que define §11 del diseño.

**Verificación** (CI en la PR; lo de demo, después de la promoción):
- [ ] CI verde.
- [ ] Con un directivo de San Agustín, en Lectura 6° Intermedio: el chip, el tooltip con
  "2 colegios · 103 alumnos" y la barra de la muestra coinciden con
  `GET /benchmarking/samples`.
- [ ] Con un profesor no aparece ningún contraste, y el request de muestras no sale (revisar la
  pestaña de red).
- [ ] La banda de alertas de `/resultados` muestra las alertas "vs muestra" que correspondan con los
  datos reales. Contrastarlas con una consulta SQL de los Δ.
- [ ] Las vistas cargan igual de rápido con la muestra que sin ella: el resultado se pinta antes que
  el chip.

---

## 5. Fase 2 — Habilidades, informes y alertas de eje

**Commit:** `feat(benchmarking): contraste por habilidad, informes y alertas de eje`

| # | Ticket | Archivos | Tamaño |
| --- | --- | --- | --- |
| 2.1 | Marca de muestra en `SkillsBreakdown` | `resultados/components/skills-breakdown.tsx` | M |
| 2.2 | Informe de curso | `components/official-reports/course-report.tsx` | S |
| 2.3 | Clasificación y Dimensiones | `resultados/clasificacion/page.tsx`, `resultados/dimensiones/page.tsx` | S |
| 2.4 | Informe del establecimiento | API: `establishment-report.service.ts` + `official-report-establishment.schema.ts` (`instrumentId` por columna de grado); web: `establishment-report.tsx` | M |
| 2.5 | Alertas de eje y de nivel inferior + enriquecimiento | `comparable-alerts.service.ts`, contratos de alertas | L |

**2.1:**
- Marca vertical en la barra de cada nodo con el % de la muestra (`perSkill` por `nodeId`) y el Δ en
  el tooltip.
- Nodos sin dato en la muestra no llevan marca.

**2.2:** línea "Muestra: X %" bajo el resultado general y distribución de la muestra en el tooltip del
donut.

**2.3:** igual que 1.3 y 2.1, sólo cuando `comparability.aggregatable` y hay un solo instrumento.

**2.4:**
- `EstablishmentGradeColumn` gana `instrumentId` (`null` si el grado mezcla instrumentos).
- La tabla de bandas suma una fila "Muestra" por grado.
- Cuando la columna mezcla instrumentos (p. ej. "Todos los momentos"), no hay fila de muestra.

**2.5:**
- `skill_below_sample` (posición contra el p25/p10 del nodo y Δ ≥ 12/20 pp).
- `band_concentration_above_sample` (≥ 10/20 pp sobre la muestra).
- **Enriquecimiento de las absolutas (§9.5):** `cohort` con el valor de la muestra; cuando |Δ| < 5 pp,
  rótulo "Resultado similar en la muestra" sin cambiar la severidad (D6). Campo nuevo
  `cohort.similarToSample: boolean` en el contrato de alertas, para que la banda pinte el rótulo.
- **Fusión** en `dedupeAndRank`: misma unidad y contexto con absoluta y relativa → una alerta con las
  dos razones y la severidad mayor. La clave de fusión es `unitKey:contextKind:contextId`, sin `type`.
- **Aceptación:** spec por tipo, por fusión y por el rótulo de muestra similar (con severidad intacta).

**Verificación** (CI en la PR; lo de demo, después de la promoción):
- [ ] CI verde.
- [ ] Revisión visual en las cuatro vistas con datos reales.
- [ ] En el informe del establecimiento con "Todos los momentos" no aparece la fila de muestra.
- [ ] Las alertas de eje en CSCJ y San Agustín cuadran con una consulta de `perSkill`.

---

## 6. Fase 3 — Ítems

**Commit:** `feat(benchmarking): muestra por ítem`

| # | Ticket | Archivos | Tamaño |
| --- | --- | --- | --- |
| 3.1 | Read-model por ítem | `packages/db/src/schema/benchmark.ts` (`benchmark_item_aggregates`), migración, `queries/benchmark-aggregates.ts` | M |
| 3.2 | Muestra por ítem en la API | `benchmark-samples.service.ts`, endpoint `GET /benchmarking/samples/items?instrumentId=` | M |
| 3.3 | Columna "% muestra" en `SpecTable` | `components/official-reports/course-report.tsx` | S |
| 3.4 | Alerta `item_below_sample` + rótulo "Resultado similar en la muestra" en `item_gap` | `comparable-alerts.service.ts` | M |

**3.1:**
- Tabla `benchmark_item_aggregates (org_id, instrument_id, item_id, correct_count, total_count,
  refreshed_at)`, **sin RLS** y con el mismo comentario de excepción que `benchmark_aggregates`. Sin
  PII.
- La llena el refresh desde `assessment_item_stats` (el read-model de cohorte), sumando por org × ítem.
- Upsert por `(org_id, item_id)`.

**3.2:** endpoint aparte porque el listado de ítems es grande y sólo lo pide el informe de curso.
Mismo k que la muestra de instrumento.

**Verificación** (CI en la PR; lo de demo, después de la promoción):
- [ ] Para 3 ítems de Lectura 6°, el % de acierto de la muestra coincide con
  `assessment_item_stats` de los dos colegios sumados a mano.

---

## 7. Fase 4 — Vista de detalle

**Commit:** `refactor(benchmarking): la vista de detalle usa la muestra por instrumento`

| # | Ticket | Tamaño |
| --- | --- | --- |
| 4.1 | `/benchmarking` consume `InstrumentSample` y `band_counts`; `band-presentation.ts` pasa a los niveles del instrumento. | M |
| 4.2 | Quitar `band_distribution` del refresh, del contrato y de `BenchmarkComparisonResponse`. La **columna** queda en la base, marcada como obsoleta y sin escrituras: el backend anterior todavía la lee mientras dura el deploy (migración antes de publicar la imagen nueva). El `DROP COLUMN` va en una release posterior (expand/contract). | S |

**Verificación:** `git grep bandDistribution` sólo devuelve usos de las vistas de resultados, que no
son del benchmarking.

---

## 8. Dependencias

```
0.1 contratos ──┬─► 0.2 cálculos ──► 0.4 service ──► 0.5 endpoint ──┐
                └─► 0.3 band_counts ─────────────┘                  │
0.6 sin gating (independiente)                                      │
0.7 refresh tras ingesta (depende de nada nuevo)                    │
                                                                    ▼
            ┌──────────── Fase 1 ─────────────────────────────────────────┐
            │ 1.1 carga ─► 1.2 componentes ─┬─► 1.4 evaluación             │
            │                1.3 barra ─────┘   1.5 panorama · 1.6 tray.   │
            │ 1.7 alertas (backend en paralelo con 1.1–1.6; UI al final)   │
            └──────────────────────────────────────────────────────────────┘
                                                                    ▼
                       Fase 2 (2.1–2.4 frontend ∥ 2.5 backend)
                                                                    ▼
                       Fase 3 (3.1 ─► 3.2 ─► 3.3 ∥ 3.4)  ─►  Fase 4
```

**En paralelo (agentes):**
- **Fase 0:** con 0.1 commiteado, un agente toma DB (0.2, 0.3) y otro API (0.4, 0.5). 0.6 y 0.7 los
  toma el integrador.
- **Fase 1:** un agente frontend (1.1–1.6 y 1.8) y un agente backend (1.7 sin UI). La UI de la banda de
  alertas va en la integración.
- **Semánticas que se fijan antes de despachar:**
  - qué es la muestra (D1, D2);
  - la regla de posición y magnitud;
  - el emparejamiento por `bandKey`;
  - que el chip de un curso compara el curso contra la muestra del instrumento.

## 9. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Las migraciones de esta feature chocan con la cadena de `main` en la promoción. | Se regeneran sobre la cadena de `main` al promover, no se arrastran (§1.3). |
| Con 2 colegios, p25/p75 permiten despejar el promedio exacto del otro colegio. | Aceptado: hoy los dos son de la misma red. k vuelve a 3 al entrar un tercer colegio (D8). |
| Un escaneo de prueba sobre un instrumento DIA real mete un colegio ficticio en la muestra. | Ya pasó una vez (Andes Centro, borrado el 2026-10-05). Las pruebas de escaneo se hacen sólo sobre los fixtures `TEST` (prefijo `7e57`). Si vuelve a pasar, se borra la evaluación; la muestra se corrige en el siguiente refresh. |
| La muestra queda desfasada respecto del número en vivo del colegio. | Refresh tras la ingesta (0.7), diario y en el deploy. El tooltip muestra "actualizado". |
| El refresh tras la ingesta compite con la carga en colegios grandes. | No se espera y corre fuera de la transacción. Si pesa, se acota al instrumento ingerido (`refreshBenchmarkAggregates(db, { orgId, instrumentIds })`). |
| Fuga cross-tenant por el endpoint nuevo. | En global, nunca se devuelven filas por colegio, sólo agregados. Red identificada sólo dentro de la red. Spec explícito de que una org fuera de la red no recibe `network`. |
| Ruido de alertas. | Regla de posición y magnitud, k, y fusión con las absolutas. Calibrar umbrales con ~10 colegios (D7). |
| El badge de un instrumento sin bandas no empareja. | Sin `bandKey` comunes no se dibuja la muestra en la barra; el chip de % de logro sí aparece. |

## 10. Definición de terminado

**Por fase** (antes de su commit en la PR):
- [ ] CI verde en la PR a `dev`.
- [ ] Sin comentarios en `apps/api` (`.claude/rules/backend/02-no-comments.md`).
- [ ] Todo el copy nuevo en español neutro, con tuteo.

**De la feature** (después de la promoción `dev → main`):
- [ ] Deploy de backend y frontend exitoso en demo, con las migraciones regeneradas sobre `main`.
- [ ] Listas "en demo" de las fases 0 a 4 cumplidas con los datos reales de CSCJ y San Agustín.
- [ ] Memoria del proyecto actualizada (`project-benchmarking-read-model`).
