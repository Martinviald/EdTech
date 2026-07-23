---
name: extraer-pruebas-pdf
description: >-
  Extrae preguntas de PDFs de pruebas estandarizadas (DIA, SIMCE, PAES, ensayos) a JSON
  estructurado listo para cargar como instruments + instrument_sections + items. Usar cuando
  el usuario tenga una carpeta de PDFs de pruebas y quiera convertirlos al formato de la BDD.
  Orquesta agentes Task en lotes (1 PDF por agente) con validación determinística entre lotes.
---

# Extracción de pruebas PDF → JSON (instruments + items)

Convierte cuadernillos de pruebas (DIA y similares) a JSON que mapea al modelo polimórfico
`instruments → instrument_sections → items` del proyecto. Separa **extracción** (IA, paralela,
falible) de **carga** (determinística, validada). Los agentes NUNCA escriben en la BDD ni inventan UUIDs.

Archivos de esta skill (en su mismo directorio):
- `CONTRATO.md` — formato JSON v1.0 (el contrato que produce cada agente).
- `PROMPT_AGENTE.md` — prompt completo y reusable para cada agente de extracción.
- `validate.py` — validador determinístico de los JSON contra el contrato.

## Cuándo usar
El usuario tiene PDFs de pruebas (un set por carpeta) y quiere extraer sus preguntas a JSON
para ingestarlas. Funciona mejor con PDFs **born-digital** (con capa de texto); para escaneos
puros la fidelidad baja (todo sale de OCR de imagen).

## Decisiones de diseño (fijas, del proyecto)
- El JSON es un **superset** del formato `apps/api/src/dia-ingestion` (`dia-parser.ts`): mismos
  campos de `instrument` + items, más **secciones** y **texto/pasaje a nivel de sección**.
- `correctKey`/`skill`/`oa`/`contentAxis` quedan **`null`**: la pauta y la tabla de
  especificaciones se cargan en una fase posterior, no desde el cuadernillo.
- Texto compartido de comprensión lectora → a nivel de `instrument_section` (`sections[].passage`).
- Códigos resolubles después: `subjectCode` (`LANG`/`MATH`…), `gradeCode` (`3RD_BASIC`…),
  `applicationPeriod` (`diagnostico`/`intermedio`/`cierre`). Se derivan del **nombre del archivo**.

## Prerequisito
poppler instalado: `brew install poppler`. El Read tool NO abre PDF directo, por eso se usan
los binarios `/opt/homebrew/bin/pdftotext` (texto verbatim) y `/opt/homebrew/bin/pdftoppm` (PNG).
Técnica clave: **texto verbatim por `pdftotext`** (fuente de verdad) + **imágenes solo para
estructura/figuras**. Verifica con `which pdftotext pdftoppm` y ofrece instalar si falta.

## Procedimiento

### 0. Setup
1. Confirma con el usuario la **carpeta raíz** (`BASE`) y qué subcarpetas/asignaturas entran en
   alcance. Reorganiza si hace falta (mover fuera de alcance a `_Otras/`).
2. Crea `BASE/extraccion/{<subcarpetas>}/` para las salidas.
3. Copia a `BASE/extraccion/` los archivos de la skill: `CONTRATO.md` y `validate.py`. Copia
   también `PROMPT_AGENTE.md` (los agentes lo leerán).
4. Verifica poppler.

### 1. Pilotos (SIEMPRE antes de paralelizar)
Extrae tú mismo **1 PDF por cada tipo distinto** (p.ej. uno de lenguaje y uno de matemáticas):
renderiza, lee, arma el JSON según `CONTRATO.md`, corre `validate.py`. Esto valida el flujo y
**afina el contrato** ante casos nuevos (tipos mixtos, alternativas-imagen, completación, etc.).
Estos JSON quedan como **plantillas de referencia** para los agentes.

### 2. Lotes de agentes Task (trazabilidad + supervisión)
Lanza **lotes de ~8 agentes** en paralelo (un Agent `general-purpose` por PDF), en UN solo
mensaje con múltiples tool calls. Cada prompt es corto y apunta al prompt completo:

```
Lee BASE/extraccion/PROMPT_AGENTE.md y sigue esas instrucciones al pie de la letra.
Parámetros: BASE=…, PDF=…, OUT=…, SUBJECT_FOLDER=…, GRADE_CODE=…, GRADE_LABEL=…,
PERIOD=…, YEAR=…, SLUG=<único>.
```
Deriva `GRADE_CODE`/`PERIOD`/`YEAR`/asignatura del **nombre del archivo** (determinístico).

### 3. Validación entre lotes
Después de cada lote corre `python3 BASE/extraccion/validate.py` (valida todos los JSON).
Revisa errores y `needsHumanReview`. No avances al siguiente lote con errores sin resolver.
Limpia los render: `rm -rf BASE/.render/*`.

### 4. Cierre
Al terminar todos los lotes: validación final + estadísticas (instrumentos, ítems totales,
desglose por `responseFormat`, ítems con figura/alternativas-imagen, cuántos needsHumanReview).

## Fases posteriores (fuera de esta skill, documentar como pendientes)
- Migración de `instrument_sections` para texto/archivos asociados (si aún no existe).
- Script de import a BDD: resolver `subjectCode`/`gradeCode`→IDs, crear instrumento+secciones+ítems
  dentro de `withOrgContext`, resolver `skill`/`oa`→`taxonomy_nodes`.
- Carga de pauta (`correctKey` por posición → `isCorrect`) y tabla de especificaciones.
- Captura/subida a S3 de figuras y alternativas-imagen (`imageUrl`).

## Notas de calidad aprendidas
- DIA de 3º/4º usa 3 alternativas (A–C); ≥2 es válido.
- Ítems "marca todas las correctas" → `multiple_choice` con keys numéricas, flaggear en warnings.
- Ítems híbridos "Sí/No + fundamenta" → `open_ended` (`responseFormat:"develop"`).
- Matemáticas: completación/"Resuelve: …=" → `open_ended` (`responseFormat:"fill_in"`);
  alternativas que son figuras → `alternatives[].isImage:true` + `needsHumanReview:true`.
- Si el enunciado o las alternativas dependen de una figura para responderse → `needsHumanReview:true`.
