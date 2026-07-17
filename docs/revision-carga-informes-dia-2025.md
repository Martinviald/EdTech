# Revisión — carga de informes DIA 2025 a demo

> Registro de las correcciones aplicadas durante la carga histórica (Fase 6) y de lo que
> quedó pendiente. **Todos los ítems corregidos deben revisarse contra el cuadernillo/enunciado
> oficial** antes de considerarlos definitivos. Fecha: 2026-07-17. Rama: `feat/matematica-eje-tematico`.

## Estado de la carga

| Asignatura | Cargados | Fuera |
|---|---|---|
| Matemática | **22/24** | 6° Intermedio A y B (ver §3) |
| Lenguaje (Lectura) | **16/16** | — (8 Intermedio excluidos por §9.3, ya granular) |

Total: **38 cohortes** en `assessment_item_stats`/`assessment_skill_stats` (`source='imported'`), sin huérfanos.

## 1. Pautas de instrumento corregidas — REVISAR

El gate #3 del importador detectó dos pautas mal aplicadas (la alternativa marcada como correcta
era **la más elegida por los alumnos**, no la correcta real). Confirmadas 3 formas: informe DIA de
ambos cursos (A/B) + el contenido del ítem. Corregidas en la **fuente** (`packages/db/data/instruments/matematicas/…`,
commit `4e0f8a5`) y en **demo** (UPDATE de `items.content`).

| Instrumento | Ítem | Pauta vieja | Pauta nueva | Verificación |
|---|---|---|---|---|
| DIA Matemática 4° Intermedio 2025 | **P25** (Datos y prob.) | A (=3) | **D (=9)** | "¿Cuántos se lavan los dientes 4 o más veces?" = (2+1) cepillos × 3 = 9 = D |
| DIA Matemática 6° Intermedio 2025 | **P10** (Patrones) | B (=4) | **A (=2)** | "4y = 8" → y = 2 = A |

## 2. Valor de extracción corregido — REVISAR

Dos informes traían un valor de eje mal leído de su gráfico (raster). El valor real (confirmado por
OCR del PDF y/o por la Tabla 1 del propio informe) fue corregido en el JSON extraído
(`Histórico Pruebas DIA/Resultados/extraccion/…`).

| Informe | Eje | Valor JSON viejo | Valor real | Verificación |
|---|---|---|---|---|
| Matemática 5°A Intermedio | Geometría | 16.98 | **76.98** | Mis-lectura 7→1; OCR del Gráfico 2 del PDF confirma 76.98 (= derivado de Tabla 1). |
| Lectura 4°A Diagnóstico | Localizar | 18.86 | **78.86** | El **Gráfico 1 del informe imprime 18.86 pero su propia Tabla 1 da 78.86** (typo del informe oficial DIA, dígito 7→1). Los 6 ítems de Localizar tienen pauta correcta y promedian 78.86. |

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
