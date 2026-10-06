# F2 — Líneas de prueba (`test_tracks`)

Registro de la fase F2 del plan (`docs/plan-desarrollo-tablero-procesos-pruebas.md`): qué quedó
en el schema, los scripts nuevos y lo que las fases siguientes tienen que saber.

## Schema (migración `0035`)

| Objeto | Detalle |
| --- | --- |
| `test_tracks` | `id`, `org_id` (null = oficial), `subject_id` NOT NULL, `code`, `name`, `short_name`, `order`, timestamps. Unicidad: `test_tracks_official_subject_code_uniq (subject_id, code) WHERE org_id IS NULL` y `test_tracks_org_subject_code_uniq (org_id, subject_id, code) WHERE org_id IS NOT NULL` (PG 14, sin `NULLS NOT DISTINCT`). `UNIQUE(id, subject_id)` |
| `instruments.track_id` | FK compuesta `instruments_track_subject_fk (track_id, subject_id) → test_tracks(id, subject_id)` (MATCH SIMPLE: con `track_id` null no se evalúa). CHECK `instruments_track_requires_subject` |
| `instrument_sections.track_id` | FK a `test_tracks(id)`. CHECK `instrument_sections_elective_requires_track` (elective ⇒ track) y `instrument_sections_track_only_elective` (track ⇒ elective). La asignatura del track de sección la valida el importador, no la BDD |
| Relaciones Drizzle | `instruments.track`, `instrumentSections.track`, `testTracks.org`, `testTracks.subject`. Tipos `TestTrack` / `NewTestTrack` |
| RLS | `test_tracks_tenant_isolation` (todo comando, solo filas propias) + `test_tracks_official_read` (solo SELECT de `org_id IS NULL`). La API no puede crear, editar ni borrar líneas oficiales |

Antes de migrar se verificó que `soe_tablero` no tiene secciones `elective` (344 secciones, todas
`core`). En `main` ningún importador ni servicio crea electivas todavía, así que el CHECK nuevo no
debería fallar en demo; aun así, el runbook debe correr antes de migrar:
`select count(*) from instrument_sections where role = 'elective';` (esperado: 0).

## Catálogo y scripts

| Script | Qué hace |
| --- | --- |
| `db:seed:test-tracks [--dry-run]` | Upsert idempotente de `packages/db/data/test-tracks.json` (M1, M2 en MATH; CIE-COMUN, BIO, FIS, QUI en SCI; SPEAKING en ENG). Resuelve la asignatura por `subjects.code`. Nunca borra |
| `db:import:instruments` | `instrument.track` y `sections[].track` (códigos). Resuelve todo antes de escribir y aborta la corrida si un código no existe, es de otra asignatura o es privado en un instrumento oficial |
| `db:backfill:tracks [--commit] [--dir <ruta>]…` | Asigna `instruments.track_id` desde el `track` de los JSON, cruzando por `config.sourceJson`. Dry-run por defecto; no limpia líneas existentes |

Los JSON de M1 (E1–E4) y M2 (E3–E4) declaran su línea. M1/M2 E5 no están en el repo (vienen de
`feat/paes-m1e5-y-roster` y `feat/paes-m2e5-figuras`): el banco les inyecta el track al copiarlos,
y en demo hay que correr el backfill con `--dir` apuntando a esos JSON (con `track`) o sumarlos al
repo. No hay instrumento DIA Speaking en el repo: la línea `SPEAKING` queda en el catálogo sin uso.

## Para F3, F4 y F5

- **Línea efectiva de un ítem:** `coalesce(instrument_sections.track_id, instruments.track_id)`,
  y si es null, la asignatura (`instruments.subject_id`).
- **Comparabilidad:** `ComparabilityInstrumentRef.trackId` es obligatorio. Las claves agregan
  `|track:<id>` solo cuando hay línea; sin línea, la clave es la de siempre.
- **Procesos:** la prueba por defecto del agrupador es `trackOrSubjectTestKey`
  (`track:<id>` o el `subjectId`). Solo mira la línea del instrumento; una sección electiva no
  parte la invariante porque vive dentro del mismo instrumento.
- **Ciencias legacy:** los 9 instrumentos por mención no llevan track. Por tanda siguen siendo
  tres instrumentos SCI para el mismo grado, así que el agrupador los deja ambiguos hasta F3. F3
  debe poner `CIE-COMUN` en el instrumento fusionado y `BIO`/`FIS`/`QUI` en sus secciones
  electivas (el importador ya lo acepta y lo valida).
- **Trayectoria comparable** (`/analytics/comparable-trajectory`): el query sigue siendo
  (tipo, asignatura, grado) y un punto puede juntar M1 y M2 de un mismo año. Separarlas requiere
  un filtro `trackId` en el query; queda fuera de F2.
