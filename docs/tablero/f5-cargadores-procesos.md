# F5 — Los cargadores escriben el proceso

Registro de la fase F5 del plan (`docs/plan-desarrollo-tablero-procesos-pruebas.md`).

## Qué quedó

| Pieza                                                           | Archivo                                                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Destino del proceso y división por invariante (puro, con tests) | `packages/db/src/lib/load-process-linking.ts` + `.spec.ts`                                                                             |
| Vinculación en la transacción del cargador                      | `linkLoadedAssessmentsToProcesses` en `packages/db/src/queries/process-linking.ts`                                                     |
| Query de candidatos compartida con `db:backfill:processes:paes` | `loadProcessCandidateRows` (mismo archivo)                                                                                             |
| Nombres compartidos con los backfills                           | `buildConfigProcessName` y `buildPeriodProcessName` en `packages/db/src/lib/config-process-grouping.ts`; también `deriveExpectedScope` |

- **PAES** (`import-paes-2026-responses.ts`): cada evaluación nueva va a "Ensayo PAES
  `<config.ensayo>` `<año>`". Es el mismo slug que crea `db:backfill:processes:paes`.
- **DIA** (`import-dia-2026-responses.ts`): va a "DIA `<momento>` `<año>`", el mismo slug que
  crea `db:backfill:processes`.
- **Ciencias** (`db:migrate:cie-electivas`): al final de la migración, las evaluaciones
  fusionadas sin proceso se vinculan a su tanda por `config.ensayo`.
- El proceso se reusa por slug (vigente, de la org) o se crea con `status: closed`, la ventana de
  fechas de lo cargado y `expectedScope` derivado. Si reusa un proceso de alcance derivado,
  recalcula el alcance y amplía la ventana.
- **Invariante:** antes de vincular se calcula `findProcessInvariantViolations` con
  `trackOrSubjectTestKey` sobre lo ya vinculado más lo nuevo. Una evaluación cuyo (grado,
  prueba) quedaría con dos instrumentos no se vincula, se reporta y cae en la toma legacy. Las
  demás del mismo lote sí se vinculan.
- Las 26 evaluaciones de Ciencias legacy (tres instrumentos SCI sin línea por grado) quedan sin
  proceso al cargarse. La fusionada (`CIE-COMUN`) sí entra en su tanda.

## Banco

- **`crear-bd-pruebas.sh` sin flags:** los cargadores ya dejan creados los 6 procesos (DIA
  Monitoreo 2026 y Ensayo PAES 1–5 2026). `golden:master-board:check` ahora también marca los
  procesos como borrados dentro de su transacción, que revierte, y da 0 diferencias.
- **`--completo`:** `db:backfill:processes` y `db:backfill:processes:paes` terminan en 0 creados
  y 0 vinculados. La migración de Ciencias vincula sus 9 fusionadas: 3 por tanda en E1, E3 y E4.
