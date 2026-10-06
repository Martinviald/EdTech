# Runbook — Activar el tablero por procesos y pruebas en demo

Este runbook se ejecuta **con el usuario**, después de mergear la PR. Ningún paso es automático. Cada operación de datos se corre primero en dry-run y se revisa su salida antes de agregar `--commit`.

Contexto y decisiones: `docs/diseno-tablero-procesos-pruebas.md`. Detalle de cada fase: `docs/tablero/f1…f5-*.md`.

## 0. Antes de mergear

1. **Versión de Postgres de demo:** las migraciones son compatibles con PG 14. Confirmar la versión real (`select version()`).
2. **Ninguna sección electiva en demo.** La migración `0035` agrega un CHECK que exige línea en las secciones `elective`. Debe dar 0:
   ```sql
   select count(*) from instrument_sections where role = 'elective';
   ```
3. **Ciencias legacy en demo:** anotar los conteos que después debe reproducir la migración.
   ```sql
   -- evaluaciones y respuestas con loadKey paes-2026-cie
   select count(distinct a.id), count(r.id)
   from assessments a left join responses r on r.assessment_id = a.id
   where a.config->>'loadKey' = 'paes-2026-cie';
   ```

## 1. Merge y deploy

El push a `main` corre `deploy-backend.yml`: migraciones `0034` (procesos) y `0035` (líneas), re-aplica `rls-policies.sql` (con políticas nuevas para `measurement_processes` y `test_tracks`) y el backfill de cohort stats.

Ambas migraciones son aditivas. Con `track_id` y `process_id` en `null`, el tablero muestra lo mismo que hoy: las tomas aparecen como "· sin proceso", con los mismos números.

## 2. Operaciones de datos (en orden)

Todas con `DATABASE_ADMIN_URL` de demo, desde `origin/main` ya mergeado.

| #   | Comando                                                       | Qué debe mostrar el dry-run                                                                                                                                                                                              |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm --filter @soe/db db:seed:test-tracks`                   | 7 líneas oficiales: M1, M2, CIE-COMUN, BIO, FIS, QUI, SPEAKING                                                                                                                                                           |
| 2   | `pnpm --filter @soe/db db:backfill:tracks`                    | M1 E1–E4 y M2 E3–E4 (6 instrumentos). M1/M2 E5 no están en `main`: pasar sus JSON con `--dir <carpeta>` desde las ramas `feat/paes-m1e5-y-roster` y `feat/paes-m2e5-figuras` (total esperado: 8)                         |
| 3   | `pnpm --filter @soe/db db:backfill:processes`                 | Un proceso por período DIA (el Monitoreo Intermedio 2026 debe dar **64** evaluaciones). Los PAES salen como ambiguos: es lo esperado                                                                                     |
| 4   | `pnpm --filter @soe/db db:migrate:cie-electivas --org <CSCJ>` | Importa los 3 instrumentos fusionados y re-apunta las respuestas. **El gate interno aborta si el % de algún alumno cambia.** Revisar: alumnos por mención y ensayo, respuestas antes = después, 0 huérfanas, 0 sin forma |
| 5   | `pnpm --filter @soe/db db:backfill:processes:paes`            | Un proceso por tanda (`config.ensayo` 1–5). Las fusionadas de Ciencias ya quedan vinculadas por el paso 4                                                                                                                |
| 6   | Recalcular el read-model de **M1 Ensayo 5**                   | Hoy tiene 3 evaluaciones y 0 filas en `assessment_item_stats`. Revisar primero si tiene respuestas                                                                                                                       |

**Vuelta atrás de Ciencias:** `db:migrate:cie-electivas --org <CSCJ> --rollback` (dry-run), y luego con `--commit`. Devuelve cada respuesta a su evaluación e ítem legacy. Está probada en local: el estado queda idéntico al previo.

**No re-importar** los 9 JSON legacy de Ciencias en demo: el importador borra y recrea por `sourceJson`, y eso borraría sus tags por cascada.

## 3. Verificación en el tablero

- `/resultados/tablero-maestro` abre en la toma más reciente.
- El selector lista "Ensayo PAES 1…5 2026" y "DIA Monitoreo 2026", agrupados por año.
- **Ensayo PAES 3:** Matemáticas aparece como M1 | M2, y Ciencias como Común | Bio | Fís | Quí. Común suma toda la cohorte.
- **DIA:** se ve igual que antes, con una fila de encabezado y colores por nivel.
- Una URL vieja del DIA (`?academicYearId=…&instrumentType=dia&applicationPeriod=…`) redirige a `?processId=`.

## 4. Sincronizar `dev`

En una PR aparte contra `dev`, regenerar las migraciones `0034+` de `dev` sobre la nueva cadena de `main`. No arrastrar los `.sql`.

## 5. Pendientes de datos (fuera de esta PR)

- **Ítems de Ciencias sin respuestas.** E1-BIO #58, E4-BIO #58 y E4-QUI #57/#60/#66 no tienen respuestas, y E1 #45 y E4 #28 comunes las tienen parciales. Se pueden cargar desde GradeCam.
- **Claves de Ciencias para revisar.** Antes de recorregir:
  - CIE-E4-FIS #28: `correctKey` es null; debería ser B.
  - CIE-E1-BIO #23 y #51: no coinciden con GradeCam.
- **Figuras pendientes.** Recortes de alternativas de E1 #45 y figura del modelo atómico de E4-QUI #60.
- **14 ítems fusionados sin tags.**
