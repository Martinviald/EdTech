# Revisión — carga de informes DIA 2025 a demo

> Registro de las correcciones aplicadas durante la carga histórica (Fase 6) y de lo que
> quedó pendiente. **Todos los ítems corregidos deben revisarse contra el cuadernillo/enunciado
> oficial** antes de considerarlos definitivos. Fecha: 2026-07-17. Rama: `feat/matematica-eje-tematico`.

## Estado de la carga

| Asignatura         | Cargados  | Fuera                                            |
| ------------------ | --------- | ------------------------------------------------ |
| Matemática         | **22/24** | 6° Intermedio A y B (ver §3)                     |
| Lenguaje (Lectura) | **16/16** | — (8 Intermedio excluidos por §9.3, ya granular) |

Total: **38 cohortes** en `assessment_item_stats`/`assessment_skill_stats` (`source='imported'`), sin huérfanos.

## 1. Pautas de instrumento corregidas — REVISAR

El gate #3 del importador detectó dos pautas mal aplicadas (la alternativa marcada como correcta
era **la más elegida por los alumnos**, no la correcta real). Confirmadas 3 formas: informe DIA de
ambos cursos (A/B) + el contenido del ítem. Corregidas en la **fuente** (`packages/db/data/instruments/matematicas/…`,
commit `4e0f8a5`) y en **demo** (UPDATE de `items.content`).

| Instrumento                       | Ítem                    | Pauta vieja | Pauta nueva | Verificación                                                                |
| --------------------------------- | ----------------------- | ----------- | ----------- | --------------------------------------------------------------------------- |
| DIA Matemática 4° Intermedio 2025 | **P25** (Datos y prob.) | A (=3)      | **D (=9)**  | "¿Cuántos se lavan los dientes 4 o más veces?" = (2+1) cepillos × 3 = 9 = D |
| DIA Matemática 6° Intermedio 2025 | **P10** (Patrones)      | B (=4)      | **A (=2)**  | "4y = 8" → y = 2 = A                                                        |

## 2. Valor de extracción corregido — REVISAR

Dos informes traían un valor de eje mal leído de su gráfico (raster). El valor real (confirmado por
OCR del PDF y/o por la Tabla 1 del propio informe) fue corregido en el JSON extraído
(`Histórico Pruebas DIA/Resultados/extraccion/…`).

| Informe                   | Eje       | Valor JSON viejo | Valor real | Verificación                                                                                                                                                                             |
| ------------------------- | --------- | ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matemática 5°A Intermedio | Geometría | 16.98            | **76.98**  | Mis-lectura 7→1; OCR del Gráfico 2 del PDF confirma 76.98 (= derivado de Tabla 1).                                                                                                       |
| Lectura 4°A Diagnóstico   | Localizar | 18.86            | **78.86**  | El **Gráfico 1 del informe imprime 18.86 pero su propia Tabla 1 da 78.86** (typo del informe oficial DIA, dígito 7→1). Los 6 ítems de Localizar tienen pauta correcta y promedian 78.86. |

## 3. PENDIENTE — 6° Matemática Intermedio (A y B) NO cargados

Geometría queda **0.3–0.5 pp** fuera de la tolerancia del gate (0.01 pp), aun con la pauta de P10
corregida. Investigado a fondo:

- Extracción **fiel al PDF** (OCR confirma Geometría 38.54 en 6A, 40.63 en 6B).
- Pautas correctas (los demás ejes reproducen exacto; P10 ya corregido).
- El ítem de desarrollo **P18** está extraído exacto (RC/RPC/RI = PDF).

**Causa raíz:** el Gráfico 2 de DIA (raster, calculado desde datos por-alumno) **no iguala su propia
Tabla 1** por el **crédito parcial del ítem de desarrollo P18** — irreproducible a 0.01 pp sin los
datos por-alumno, que un informe agregado no tiene. **No es un error nuestro** (ni de pauta, ni de
extracción, ni de etiquetado).

**Decisión (usuario, 2026-07-17):** dejar 6° Intermedio A y B **fuera** por ahora, sin relajar el
gate. Opción futura evaluada y descartada por ahora: una tolerancia mayor **solo** para ejes que
contienen un ítem de desarrollo (reconstrucción lossy desde agregados), que no toca los ejes MC.

## 4. Deuda técnica destapada (no arreglada acá)

- **Importador no idempotente en `assessments`:** `confirm` sin `assessmentId` crea una assessment
  nueva cada vez (`resolveAssessment` solo reusa si se le pasa el id; el preview lo deja null).
  Re-confirmar el mismo informe → assessment duplicada + cohorte huérfana. Se limpiaron 3 (Lenguaje 3°)
  surgidas de un reintento. Arreglar reusando por (instrument, classGroup, period) antes de exponer la
  recarga en UI. `import_jobs` tampoco dedup (log de auditoría).

## 5. Backfill de distribución por nivel — PASO MANUAL POST-DEPLOY

La distribución por nivel (Gráfico 1 del informe → `assessment_level_stats`) **no** estaba en las
cohortes cargadas en §1–2: se importaron cuando la extracción dejaba `levelDistribution` vacío. Al
re-extraer los informes, **24 de los 48 JSON** traen ahora `levelDistribution` poblado (los 16
Diagnóstico + 8 de cierre/intermedio siguen sin nivel y se saltan en silencio).

El script `apps/api/scripts/backfill-level-stats.ts` escribe **solo** ese read-model contra los
assessments `aggregate_only` que **ya existen**, sin re-importar (así se esquiva el bug de
idempotencia del importador descrito en §4, que crearía assessments duplicados). Reusa la MISMA
resolución que la carga original (`cargar-informes-dia.ts`): instrumento por (subject+grade+period,
oficial `org_id NULL`) y class group por `courseLabel`; luego matchea el assessment existente vía
`assessment_course_assignments` y hace delete+reinsert idempotente por `(assessmentId, classGroupId)`
con `source='imported'`. Si no encuentra el assessment, hay ambigüedad, o los niveles no matchean las
bandas del instrumento → **warn y skip** (no crea nada).

⚠️ Los JSON re-extraídos viven **fuera del repo** (`Histórico Pruebas DIA/Resultados/extraccion/`),
así que esto **NO va a CI**: es un paso manual que se corre a mano contra demo (con el túnel arriba,
ver skill `demo-db-access`), igual que la carga original.

Comando (relativo a `apps/api`; DRY-RUN por defecto — no escribe, muestra por informe el assessment
resuelto, los conteos por banda `label=count` y `total/N`):

```bash
# Dry-run
DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
  pnpm --filter @soe/api exec tsx scripts/backfill-level-stats.ts \
  "../../Histórico Pruebas DIA/Resultados/extraccion"

# Persistir (agregar --confirm)
DATABASE_ADMIN_URL="..." \
  pnpm --filter @soe/api exec tsx scripts/backfill-level-stats.ts \
  "../../Histórico Pruebas DIA/Resultados/extraccion" --confirm
```

**Cobertura esperada:** de las 24 cohortes con nivel, **~24 tienen nivel escribible**; quedan hasta
**8 pendientes de revisión manual** de la re-extracción (5 por conflicto de romano en OCR —"II" vs
"III"— y 3 por una tajada del Gráfico 1 demasiado chica que no se leyó). Las cohortes de Lenguaje
Intermedio no tienen assessment `aggregate_only` (se excluyeron en la carga por §9.3, ya granular):
el script las reporta como skip, es esperado.

## 6. Backfill de NÓMINA POR ALUMNO (nivel) — PASO MANUAL POST-DEPLOY

La nómina por alumno (nombre + nivel de la **Figura 1** del informe → `assessment_results`, una fila
`metricType='band'` por alumno) es un backfill **manual post-deploy**, hermano del de §5. Solo aplica
a los informes de **Monitoreo**: son los únicos cuya figura de niveles se extrajo al campo
`students[]` (`{ listNumber, name, level }`). **Diagnóstico y Cierre NO traen `students[]`** y el
script los salta en silencio (de los 48 JSON, **16 de Monitoreo** traen nómina).

El script `apps/api/scripts/backfill-student-levels.ts` escribe **solo** esas filas contra los
assessments `aggregate_only` que **ya existen** (misma resolución instrument/classGroup/period que
§5 y el mismo `withOrgContext`), sin re-importar — así esquiva el bug de idempotencia del importador
(§4). Por cada fila del informe matchea el nombre contra la nómina real del curso
(`student_enrollments` activos) y, si resuelve el nivel a una banda del instrumento, escribe con
`percentage=null` (el informe da el nivel, no el % del alumno). Idempotente por
`(assessmentId, studentId)` con `onConflictDoUpdate`, idéntico al importador.

⚠️ El `name` de la figura es un **prefijo OCR truncado** (el gráfico corta el nombre en su borde
izquierdo). El match acepta dos caminos: **auto** (matcher difuso, `confidence >= 0.85 && !ambiguous`)
y **prefijo** (un único alumno de la nómina cuya forma "APELLIDOS NOMBRE" normalizada _empieza con_ el
prefijo OCR). El script los reporta por separado. Los que **no cruzan, son ambiguos, o su nivel no
resuelve a una banda no se escriben**: quedan para revisión manual y se cuentan en el resumen (sin
imprimir nombres — es PII; a lo sumo 1-2 ejemplos anonimizados por `listNumber`).

⚠️ Igual que §5, los JSON viven **fuera del repo** y esto **NO va a CI**: se corre a mano contra demo
con el túnel arriba (skill `demo-db-access`).

Comando (relativo a `apps/api`; DRY-RUN por defecto — muestra por cohorte: assessment resuelto,
conteos auto/prefijo/ambiguo/no-encontrado/sin-banda/conflicto, escribibles y tasa de match):

```bash
# Dry-run
DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
  pnpm --filter @soe/api exec tsx scripts/backfill-student-levels.ts \
  "../../Histórico Pruebas DIA/Resultados/extraccion"

# Persistir (agregar --confirm)
DATABASE_ADMIN_URL="..." \
  pnpm --filter @soe/api exec tsx scripts/backfill-student-levels.ts \
  "../../Histórico Pruebas DIA/Resultados/extraccion" --confirm
```

Los alumnos **no matcheados quedan para revisión manual**: se asignan a mano (por ahora, vía el flujo
`upload → preview → confirm` del importador con el `studentMatches` humano, o corrigiendo el prefijo
en el JSON re-extraído y volviendo a correr el backfill).
