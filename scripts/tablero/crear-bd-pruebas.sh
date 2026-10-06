#!/usr/bin/env bash
# Recrea desde cero la BDD local de pruebas del tablero (soe_tablero) con el código de la
# rama y solo fuentes locales. Sin AWS: ningún paso sube a S3 ni se conecta a demo.
#
# Uso:  scripts/tablero/crear-bd-pruebas.sh [--completo]
#   Sin flags deja el estado F0 del golden: Ciencias en 9 instrumentos por mención (modelo
#   legacy) y solo M1/M2 con línea. Los cargadores ya vinculan cada evaluación a su proceso
#   (DIA por período, PAES por tanda); las 26 de Ciencias legacy quedan sin proceso porque
#   rompen la invariante. `pnpm --filter @soe/api golden:master-board:check` neutraliza
#   líneas y procesos dentro de su transacción.
#   --completo además migra Ciencias a secciones electivas (la migración vincula las
#   fusionadas a su tanda) y corre los backfills de procesos, que deberían quedar en 0.
# Variables opcionales:
#   PG_ADMIN_USER  superusuario local (por defecto, el usuario del sistema)
#   REPOSITORIO    checkout con la nómina y los artefactos DIA (por defecto ../repositorio)
#   TOOLKIT        plataforma-dia-toolkit con los escaneos GradeCam PAES
#   CIE_CONVERTER  conversor de Ciencias (por defecto, el del worktree wt-paes-cie)
#
# Los logs de los cargadores (traen nombres de alumnos) quedan en scripts/tablero/out/,
# que está ignorado por git. Nada de eso se commitea.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EDTECH="$(dirname "$ROOT")"
DB_NAME="soe_tablero"
PG_ADMIN_USER="${PG_ADMIN_USER:-$(whoami)}"
REPOSITORIO="${REPOSITORIO:-$EDTECH/repositorio}"
TOOLKIT="${TOOLKIT:-$EDTECH/plataforma-dia-toolkit}"
CIE_CONVERTER="${CIE_CONVERTER:-$EDTECH/wt-paes-cie/scripts/paes-2026/cie_a_artefacto.py}"
OUT="$ROOT/scripts/tablero/out"
DB_PKG="$ROOT/packages/db"
CSCJ_ORG_ID="c5c10000-0000-0000-0000-000000000001"
DIA_ARTIFACT="$REPOSITORIO/scripts/cscj/dia-2026/out/dia-2026-respuestas.json"
M1_E5_REF="origin/feat/paes-m1e5-y-roster:packages/db/data/instruments-paes/M1/M1-E5-con-pauta.json"
M2_E5_REF="origin/feat/paes-m2e5-figuras:packages/db/data/instruments-paes/M2/M2-E5-con-pauta.json"

export DATABASE_ADMIN_URL="postgresql://${PG_ADMIN_USER}@localhost:5432/${DB_NAME}"
export DATABASE_URL="postgresql://soe_app@localhost:5432/${DB_NAME}"
export NODE_ENV=production
unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN S3_BUCKET UPLOADS_BUCKET || true

paso() { printf '\n== %s\n' "$*"; }
en_db() { (cd "$DB_PKG" && "$@"); }
psql_admin() { psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q "$@"; }
resumen() { grep -E "TOTAL|COMMIT|Import:|celdas cargables|ERR" "$1" || true; }

for fuente in "$REPOSITORIO/scripts/cscj/out/roster-active.json" \
  "$REPOSITORIO/scripts/cscj/out/roster-iv-2026.json" "$DIA_ARTIFACT" \
  "$TOOLKIT/data/gc_paes_2026" "$TOOLKIT/scripts/paes_2026_a_artefacto.py" "$CIE_CONVERTER"; do
  [ -e "$fuente" ] || { echo "Falta la fuente local: $fuente" >&2; exit 1; }
done

mkdir -p "$OUT/logs"

paso "0. BDD ${DB_NAME} desde cero"
dropdb -h localhost -U "$PG_ADMIN_USER" --if-exists "$DB_NAME"
createdb -h localhost -U "$PG_ADMIN_USER" "$DB_NAME"
psql_admin -f "$ROOT/scripts/tablero/grants-soe-app.sql"

if [ ! -f "$ROOT/packages/types/dist/index.js" ]; then
  paso "0b. Compilar @soe/types (los cargadores lo importan desde dist)"
  (cd "$ROOT" && pnpm --filter @soe/types build >/dev/null)
fi

paso "1. Migraciones + RLS"
en_db pnpm -s db:migrate > "$OUT/logs/migrate.txt" 2>&1
tail -1 "$OUT/logs/migrate.txt"

paso "2. Seed base (grados, asignaturas, taxonomía, instrumentos DIA 2025, bandas, orgs demo)"
en_db pnpm -s db:seed > "$OUT/logs/seed.txt" 2>&1
tail -1 "$OUT/logs/seed.txt"

paso "3. Nómina CSCJ 2025"
mkdir -p "$ROOT/scripts/cscj/out"
cp "$REPOSITORIO/scripts/cscj/out/roster-active.json" "$ROOT/scripts/cscj/out/roster-active.json"
en_db pnpm exec tsx src/seed/import-cscj-roster.ts --commit > "$OUT/logs/roster-2025.txt" 2>&1
grep -E "insertados|class_groups" "$OUT/logs/roster-2025.txt"

paso "4. Año 2026: promoción de la nómina 2025 + IV° medio desde la nómina 2026"
python3 - "$REPOSITORIO/scripts/cscj/out/roster-iv-2026.json" "$OUT/roster-iv-2026.csv" <<'PY'
import csv, json, sys
registros = json.load(open(sys.argv[1], encoding="utf-8"))["records"]
with open(sys.argv[2], "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["rut", "first_name", "last_name", "gender", "birth_date", "grade_code", "section"])
    for r in registros:
        w.writerow([r["rut"], r["firstName"], r["lastName"], r["gender"], r["birthDate"] or "", r["gradeCode"], r["section"]])
PY
psql_admin -f "$ROOT/scripts/tablero/anio-2026.sql" < "$OUT/roster-iv-2026.csv"

paso "5. Taxonomía PAES + nodos aditivos"
en_db pnpm exec tsx src/seed/seed-paes-taxonomy.ts > "$OUT/logs/taxonomia-paes.txt" 2>&1
en_db pnpm exec tsx src/seed/add-taxonomy-nodes.ts > "$OUT/logs/taxonomia-nodos.txt" 2>&1
tail -1 "$OUT/logs/taxonomia-paes.txt"

paso "5b. Catálogo oficial de líneas de prueba (M1, M2, Ciencias, Speaking)"
en_db pnpm -s db:seed:test-tracks > "$OUT/logs/test-tracks.txt" 2>&1
grep -E "insertadas|sin cambios" "$OUT/logs/test-tracks.txt"

paso "6. Instrumentos DIA 2026 + PAES 2026 (22 del repo + M1/M2 Ensayo 5 de sus ramas)"
for dir in instruments-2026 instruments-2026-hist-cien instruments-2026-historia instruments-2026-ingles; do
  en_db env INSTRUMENTS_DATA_DIR="data/$dir" pnpm -s db:import:instruments > "$OUT/logs/instr-$dir.txt" 2>&1
  resumen "$OUT/logs/instr-$dir.txt"
done
rm -rf "$OUT/instruments-paes"
for asig in CIE CL HIS M1 M2; do
  mkdir -p "$OUT/instruments-paes/$asig"
  cp "$DB_PKG/data/instruments-paes/$asig/"*-con-pauta.json "$OUT/instruments-paes/$asig/"
done
git -C "$ROOT" show "$M1_E5_REF" > "$OUT/instruments-paes/M1/M1-E5-con-pauta.json"
git -C "$ROOT" show "$M2_E5_REF" > "$OUT/instruments-paes/M2/M2-E5-con-pauta.json"
for linea in M1 M2; do
  python3 - "$OUT/instruments-paes/$linea/$linea-E5-con-pauta.json" "$linea" <<'PY'
import json, sys
ruta, linea = sys.argv[1], sys.argv[2]
documento = json.load(open(ruta, encoding="utf-8"))
documento["instrument"]["track"] = linea
json.dump(documento, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
done
en_db env INSTRUMENTS_DATA_DIR="$OUT/instruments-paes" pnpm -s db:import:instruments > "$OUT/logs/instr-paes.txt" 2>&1
resumen "$OUT/logs/instr-paes.txt"

paso "7. Tags de ítems"
for plan in instruments-paes/paes-item-tags-plan.json instruments-paes/paes-m2-item-tags-plan.json \
  instruments-2026-hist-cien/item-tags-plan-2026-hist-cien.json instruments-2026-ingles/item-tags-plan-2026-ingles.json; do
  en_db env ITEM_TAGS_PLAN="data/$plan" pnpm -s db:import:item-tags > "$OUT/logs/tags-$(basename "$plan" .json).txt" 2>&1
done

paso "8. Bandas de desempeño de los instrumentos DIA"
en_db pnpm -s db:seed:performance-bands > "$OUT/logs/bandas.txt" 2>&1
grep "Performance bands" "$OUT/logs/bandas.txt"

paso "9. Respuestas PAES (GradeCam real: E1-E4; Ensayo 5 sintético)"
(cd "$TOOLKIT" && python3 scripts/paes_2026_a_artefacto.py --out "$OUT/artefacto-paes.json" > "$OUT/logs/conv-paes.txt")
(cd "$TOOLKIT" && python3 scripts/paes_2026_a_artefacto.py --m2 --out "$OUT/artefacto-paes-m2.json" > "$OUT/logs/conv-paes-m2.txt")
python3 "$ROOT/scripts/tablero/remapear-instrumentos.py" "$OUT/artefacto-paes.json" "$DATABASE_ADMIN_URL"
python3 "$ROOT/scripts/tablero/remapear-instrumentos.py" "$OUT/artefacto-paes-m2.json" "$DATABASE_ADMIN_URL"
for artefacto in artefacto-paes artefacto-paes-m2; do
  en_db pnpm exec tsx src/seed/import-paes-2026-responses.ts --loadKey=paes-2026-ensayos \
    --input="$OUT/$artefacto.json" --commit > "$OUT/logs/carga-$artefacto.txt" 2>&1
  resumen "$OUT/logs/carga-$artefacto.txt"
done

psql "$DATABASE_ADMIN_URL" -At -F $'\t' -c "
select i.id, i.name, it.position,
 coalesce((select string_agg(a->>'key','') from jsonb_array_elements(it.content->'alternatives') a
           where (a->>'isCorrect')::bool),''),
 regexp_replace(coalesce(it.content->>'stem',''), E'[\n\t\r]+', ' ', 'g')
from instruments i join items it on it.instrument_id = i.id
where i.name like 'PAES CIE menci%' and i.deleted_at is null
order by i.name, it.position;" > "$OUT/cie_mapa.tsv"
python3 "$CIE_CONVERTER" --dir "$TOOLKIT/data/gc_paes_2026" --mapa "$OUT/cie_mapa.tsv" \
  --out "$OUT/artefacto-cie.json" > "$OUT/logs/conv-cie.txt" 2>&1
en_db pnpm exec tsx src/seed/import-paes-2026-responses.ts --loadKey=paes-2026-cie \
  --input="$OUT/artefacto-cie.json" --commit > "$OUT/logs/carga-cie.txt" 2>&1
resumen "$OUT/logs/carga-cie.txt"

python3 "$ROOT/scripts/tablero/sintetico-paes-e5.py" "$DATABASE_ADMIN_URL" "$OUT/artefacto-paes-e5-sintetico.json"
python3 "$ROOT/scripts/tablero/remapear-instrumentos.py" "$OUT/artefacto-paes-e5-sintetico.json" "$DATABASE_ADMIN_URL"
en_db pnpm exec tsx src/seed/import-paes-2026-responses.ts --loadKey=paes-2026-e5-sintetico \
  --input="$OUT/artefacto-paes-e5-sintetico.json" --commit > "$OUT/logs/carga-e5.txt" 2>&1
resumen "$OUT/logs/carga-e5.txt"

paso "10. Respuestas DIA 2026 Monitoreo Intermedio (celdas con instrumento local)"
python3 "$ROOT/scripts/tablero/celdas-dia-cargables.py" "$DIA_ARTIFACT" "$DATABASE_ADMIN_URL" \
  "$OUT/celdas-dia.txt" 2> "$OUT/logs/celdas-dia-omitidas.txt"
en_db pnpm exec tsx src/seed/import-dia-2026-responses.ts --loadKey=dia-2026-intermedio \
  --input="$DIA_ARTIFACT" --onlyFile="$OUT/celdas-dia.txt" --administeredAt=2026-08-04 \
  --commit > "$OUT/logs/carga-dia.txt" 2>&1
resumen "$OUT/logs/carga-dia.txt"

paso "11. Read-model de cohorte (backfill completo)"
en_db pnpm -s db:backfill:cohort-stats --concurrency 2 > "$OUT/logs/backfill.txt" 2>&1
grep "listo" "$OUT/logs/backfill.txt"

psql_admin -f "$ROOT/scripts/tablero/grants-soe-app.sql"

if [ "${1:-}" = "--completo" ]; then
  paso "12. Procesos DIA por período"
  en_db pnpm -s db:backfill:processes --commit > "$OUT/logs/procesos-dia.txt" 2>&1
  grep -E "Creados|vinculadas" "$OUT/logs/procesos-dia.txt" || true
  paso "13. Ciencias a secciones electivas"
  en_db pnpm -s db:migrate:cie-electivas --org "$CSCJ_ORG_ID" --commit > "$OUT/logs/cie-electivas.txt" 2>&1
  grep -E "gate|COMMIT" "$OUT/logs/cie-electivas.txt"
  paso "14. Procesos PAES por tanda (config.ensayo)"
  en_db pnpm -s db:backfill:processes:paes --org "$CSCJ_ORG_ID" --commit > "$OUT/logs/procesos-paes.txt" 2>&1
  grep -E "Ensayo|Creados" "$OUT/logs/procesos-paes.txt"
fi

paso "Banco listo"
psql "$DATABASE_ADMIN_URL" -c "
select i.type, coalesce(i.application_period::text, '-') as periodo,
       coalesce(a.config->>'ensayo', '-') as tanda, s.code as asignatura,
       count(distinct a.id) as evaluaciones, count(distinct i.id) as instrumentos
from assessments a
join instruments i on i.id = a.instrument_id
join subjects s on s.id = i.subject_id
where a.org_id = '${CSCJ_ORG_ID}'
group by 1, 2, 3, 4 order by 1, 2, 3, 4;"
psql "$DATABASE_ADMIN_URL" -At -c "select 'assessment_item_stats: ' || count(*) from assessment_item_stats;"
echo "Golden:  (cd packages/db && pnpm golden:master-board)"
echo "Fixture: (cd packages/db && pnpm fixture:process-candidates)"
