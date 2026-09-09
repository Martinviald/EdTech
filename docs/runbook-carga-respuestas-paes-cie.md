# Runbook — cargar las respuestas de los ensayos PAES de Ciencias (CIE)

Aplica a los ensayos 1, 3 y 4 de 2026 escaneados en GradeCam. Los ensayos 2 y 5
de Ciencias no existen.

## 1. La decisión de fondo: contra qué instrumentos se carga

La prueba PAES de Ciencias tiene un módulo **común** de 54 preguntas y un módulo
de **mención** de 26 (Biología, Física o Química). Cada alumno rinde un
cuadernillo de 80 preguntas: las 54 comunes más las 26 de su mención.

Hay dos formas de representar eso en la plataforma:

**(A) Nueve instrumentos, uno por (mención × ensayo).** Es lo que ya existe en
la BDD: `PAES CIE mención Biología — Ensayo 1`, etc., de 80 ítems cada uno. Un
alumno de Biología rindió exactamente ese cuadernillo, así que sus respuestas
—las comunes del assignment COMÚN de GradeCam más las de mención del assignment
MENCIÓN— caben directo, sin fusionar nada.

**(B) Un instrumento por ensayo con cuatro secciones** (una `core` de 54 y tres
`elective` de 26), que es para lo que se construyó el modelo de secciones
electivas (`instrument_sections.role/elective_group/elective_key`,
`assessment_forms`, `assessment_form_students`, `resolveElectiveScope`).

**Se eligió (A)**, y (B) queda como migración posterior. Razones medibles:

- (A) está desbloqueado hoy: los 9 instrumentos ya están cargados con sus ítems,
  claves, figuras y tags. No hay que renumerar, ni volver a subir figuras, ni
  completar ítems.
- (B) está bloqueado por dos cosas concretas: las 330 figuras cuya storage key
  codifica la posición del ítem (`.../item_figure/{NN}.png`), que se rompen al
  renumerar; y la fusión, que sólo cierra limpio en el Ensayo 3 (132 ítems) — el
  Ensayo 1 da 130 y el 4 da 127 porque la extracción nunca sacó algunos ítems.
- El cargador de seed **no puede** escribir contra un instrumento con secciones
  electivas: `assertNoElectiveSections` lo aborta, porque le fabricaría a cada
  alumno respuestas por las ramas que no rindió. Ir por (B) hoy obligaría además
  a escribir un cargador nuevo con `assessment_form_students`.

**Qué se pierde con (A)** — hay que tenerlo escrito:

1. Los 54 ítems comunes quedan **triplicados** como ítems distintos en los tres
   instrumentos de un mismo ensayo. La analítica por ítem del módulo común no se
   agrega entre menciones: la pregunta común 12 aparece con tres `n` separados y
   tres dificultades empíricas, en vez de una sola sobre los ~72 alumnos.
2. El % de logro de un alumno mezcla común y mención en un solo número; no hay
   forma de leer "cómo le fue en el común" contra el resto de la cohorte
   completa.
3. Cambiar de mención entre ensayos (pasa con 7 alumnos) se ve como haber
   rendido instrumentos sin relación, no como la misma prueba con otra rama.
4. Comparar dificultad de la mención contra el común dentro de un ensayo exige
   saber de memoria que las posiciones 1-54 son el común.

Cuando (B) se desbloquee, la migración es re-mapear las respuestas ya cargadas
al instrumento fusionado; las respuestas en sí no se pierden.

## 2. Las tres trampas de Ciencias

1. **GradeCam partió cada ensayo en dos assignments**: uno común (54 preguntas,
   una versión) y uno de mención (hoja de 80 posiciones donde sólo se llenan las
   55-80, tres versiones). Las respuestas de un alumno viven en los dos archivos
   y se unen por `student.student_uid`.

2. **La mención sale de `stats.version`**: 1 = Biología, 2 = Física, 3 = Química.
   El conversor lo verifica en cada corrida contra las claves que el propio
   GradeCam guarda en `stats.answers[].cors`: calzan 25/25, 26/26 y 26/26 contra
   la mención asignada y 3-8 de 26 contra las otras dos, en los tres ensayos. Si
   deja de calzar, el script aborta.

3. **En el Ensayo 1 los tres cuadernillos imprimen las mismas 54 preguntas
   comunes en orden distinto** (Biología y Física coinciden en sólo 17 de 54
   posiciones) y la hoja de respuestas del común es una sola. O sea: la posición
   7 del cuadernillo de Física NO es la burbuja 7 de la hoja. La numeración de la
   hoja es la del cuadernillo de Biología. El conversor remapea el común por
   enunciado: busca cada ítem común en el instrumento de Biología del mismo
   ensayo y usa esa posición como burbuja. En los ensayos 3 y 4 los cuadernillos
   ya vienen en el mismo orden y el remapeo es la identidad.

   Sin el remapeo, las claves del banco calzan con la hoja 19/54 en Física y
   25/54 en Química del Ensayo 1. Con el remapeo, 50-51 de 52-53 en los tres.

## 3. Pasos

```bash
# 0) Túnel a la demo (compartido; si está arriba, NO lo reinicies)
nc -z -w 5 10.0.12.143 5432

PW=$(aws secretsmanager get-secret-value --profile edtech --region us-east-1 \
  --secret-id edtech-demo-DbProxySecret-ksefwadx --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")
export PGPASSWORD="$PW"
export DATABASE_ADMIN_URL="postgresql://soe_admin:${PW}@10.0.12.143:5432/soe?sslmode=require"

# 1) Exportar el mapa de ítems (id, posición, clave y enunciado por instrumento)
psql "postgresql://soe_admin@10.0.12.143:5432/soe?sslmode=require" -At -F$'\t' -c "
select i.id, i.name, it.position,
 coalesce((select string_agg(a->>'key','') from jsonb_array_elements(it.content->'alternatives') a
           where (a->>'isCorrect')::bool),''),
 regexp_replace(coalesce(it.content->>'stem',''), E'[\n\t\r]+', ' ', 'g')
from instruments i join items it on it.instrument_id = i.id
where i.name like 'PAES CIE menci%' and i.deleted_at is null
order by i.name, it.position;" > /tmp/cie_mapa.tsv

# 2) Construir el artefacto (corre los gates y aborta si alguno falla)
python3 scripts/paes-2026/cie_a_artefacto.py \
  --dir /Users/macbook/Desktop/EdTech/plataforma-dia-toolkit/data/gc_paes_2026 \
  --mapa /tmp/cie_mapa.tsv --out /tmp/artefacto-cie.json

# 3) Dry-run y luego commit
pnpm --filter @soe/db exec tsx src/seed/import-paes-2026-responses.ts \
  --loadKey=paes-2026-cie --input=/tmp/artefacto-cie.json
pnpm --filter @soe/db exec tsx src/seed/import-paes-2026-responses.ts \
  --loadKey=paes-2026-cie --input=/tmp/artefacto-cie.json --commit
```

El cargador es `import-paes-2026-responses.ts` **sin cambios**: el artefacto de
Ciencias respeta el mismo contrato que el de las otras asignaturas.

## 4. Verificación independiente (hazla siempre)

El gate que de verdad importa no es el conteo de filas, sino que nuestra
corrección coincida ítem a ítem con la de GradeCam. Compara, por alumno y ensayo,
`respuesta == clave del banco` contra `ans == cors` de GradeCam, dejando fuera
los ítems que no existen en el instrumento y aquellos donde banco y GradeCam
declaran claves distintas. El resultado esperado es **delta 0 en el 100% de los
alumnos**.

Al verificar en SQL, filtra **siempre y explícitamente** por
`assessments.org_id`: `soe_admin` es `rds_superuser` y **bypassa RLS**, así que
`withOrgContext` no acota nada y un conteo "por org" te devuelve el total global.

## 5. Lo que queda abierto

- **Dos claves del módulo común del Ensayo 1 en conflicto** entre el banco y
  GradeCam: burbuja 23 (banco `D`, GradeCam `E`) y burbuja 51 (banco `A`,
  GradeCam `D`). Se cargó con la clave del banco. Afecta a los tres instrumentos
  del Ensayo 1 por igual. Definir cuál manda y, si cambia, re-puntuar con
  `rescore-assessment.ts` (**no** re-ingestar: cambia los UUID de las
  respuestas).
- **Ítems que la extracción nunca sacó** y por eso no reciben respuesta: 2 en
  Biología E1, 2 en Biología E4, 4 en Química E4, y el ítem 28 de Física E4 que
  está cargado pero sin clave.
- **Fusión a un instrumento por ensayo con secciones electivas** (camino B):
  bloqueada por las figuras ancladas a la posición y por la extracción
  incompleta de E1 y E4.
