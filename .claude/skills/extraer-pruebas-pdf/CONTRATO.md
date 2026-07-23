# Contrato JSON de extracción — Pruebas DIA (Lenguaje y Matemáticas)

> Un archivo `.json` por PDF. Es un **formato intermedio** (no es aún el `insert` a la BDD).
> Es un **superset** del formato existente `packages/db/data/dia-2025-*.json` que ya consume
> `dia-parser.ts`, con dos extensiones: (1) **secciones** que envuelven los ítems y
> (2) **texto/pasaje a nivel de sección** (para la migración de `instrument_sections`).
>
> Lo que SÍ se extrae del cuadernillo: `stem`, `alternatives`, `position`, textos y figuras.
> Lo que NO está en el cuadernillo y queda `null` para cargarse después: `correctKey`
> (pauta), `skill` / `oa` / `contentAxis` (tabla de especificaciones).

## Estructura

```jsonc
{
  "schemaVersion": "1.0",
  "source": {
    "file": "5º lenguaje diagnóstico 2025.pdf",   // nombre exacto del PDF origen
    "subjectFolder": "Lenguaje"                    // "Lenguaje" | "Matematicas"
  },

  "instrument": {                                  // mismos campos que dia-parser.ts
    "name": "DIA Lenguaje 5° Básico 2025 — Diagnóstico",
    "subject": "Lenguaje y Comunicación",          // texto legible
    "subjectCode": "LANG",                         // resoluble a subjects.code: LANG | MATH
    "grade": "5° Básico",
    "gradeCode": "5TH_BASIC",                      // 3RD_BASIC|4TH_BASIC|5TH_BASIC|6TH_BASIC
    "year": 2025,
    "applicationPeriod": "diagnostico",            // diagnostico | intermedio | cierre
    "type": "dia",
    "isOfficial": true,
    "source": "imported"
  },

  "sections": [
    {
      "order": 1,
      "name": "Texto 1: «El gato aventurero»",     // título de sección/lectura
      "type": "multiple_choice",                   // section_type enum
      "instructions": "Lee el texto y responde las preguntas 1 a 5.",
      "passage": {                                 // null si la sección no tiene texto base
        "title": "El gato aventurero",
        "text": "Había una vez un gato...",        // transcripción COMPLETA y fiel del texto
        "format": "plain",                         // plain | markdown
        "attachments": []                          // figuras del texto (ver §figuras)
      },
      "items": [
        {
          "position": 1,                           // correlativo GLOBAL dentro del instrumento
          "type": "multiple_choice",               // item_type enum
          "stem": "¿Qué hacía el gato en la historia?",
          "alternatives": [
            { "key": "A", "text": "Dormía" },
            { "key": "B", "text": "Jugaba" },
            { "key": "C", "text": "Comía" },
            { "key": "D", "text": "Corría" }
          ],
          "correctKey": null,                      // PENDIENTE (pauta) — siempre null en extracción
          "skill": null,                           // PENDIENTE (tabla especificaciones)
          "oa": null,                              // PENDIENTE
          "contentAxis": null,                     // PENDIENTE
          "hasFigure": false,                      // true si el ítem trae imagen/gráfico/tabla
          "figureNote": null                       // descripción breve de la figura si hasFigure
        }
      ]
    }
  ],

  "extraction": {
    "itemCount": 20,                               // total de ítems extraídos (control)
    "warnings": [],                                // strings: ambigüedades, páginas ilegibles…
    "needsHumanReview": false                      // true si algo quedó dudoso
  }
}
```

## Reglas duras (las valida el script de validación)

1. `position` es **correlativo global** del instrumento (1..N), único, sin saltos. No reinicia por sección.
2. Cada ítem `multiple_choice` tiene **≥2 alternativas** con `key` único en mayúscula (A, B, C, D, …).
3. `correctKey`, `skill`, `oa`, `contentAxis` van **siempre `null`** en esta fase (se cargan después).
4. `instrument.subjectCode` ∈ {`LANG`, `MATH`}; `gradeCode` ∈ {`3RD_BASIC`,`4TH_BASIC`,`5TH_BASIC`,`6TH_BASIC`}; `applicationPeriod` ∈ {`diagnostico`,`intermedio`,`cierre`}. Todo se **deriva del nombre del archivo** (determinístico), no se "adivina".
5. `extraction.itemCount` == número real de ítems en `sections[].items`.
6. Matemáticas: normalmente **una sola sección** `multiple_choice` sin `passage`. Lenguaje: **una sección por texto de lectura**, cada una con su `passage`.

## Casos especiales (descubiertos en el piloto de matemáticas)

El DIA de matemáticas tiene 3 tipos de pregunta según sus instrucciones: **alternativas**,
**completación** (anotar en recuadro) y **desarrollo**. Para representarlos sin perder
información y manteniendo `type` dentro del enum de la BDD, cada ítem lleva además:

- **`responseFormat`**: `"choice"` | `"fill_in"` | `"develop"`.
  - `choice` → `type: "multiple_choice"`.
  - `fill_in` (completación / "Resuelve: …="; respuesta numérica corta) → `type: "open_ended"`
    por ahora; en import se promueve a `gap_fill` (auto-corregible) al cargar la pauta.
  - `develop` (la pregunta de desarrollo; ej. Sí/No + fundamentar) → `type: "open_ended"`.

- **Alternativas que son imágenes** (ej. "¿en qué recta numérica…?" donde cada opción A–D es
  una figura): la alternativa lleva `"isImage": true` y su `text` es una **descripción** de la
  figura. Además el ítem va con `hasFigure: true` y `needsHumanReview: true`.

```jsonc
"alternatives": [
  { "key": "A", "text": "Recta 0–1; flecha a ~3/10 del tramo.", "isImage": true },
  { "key": "B", "text": "Recta 0–10; flecha a ~2 del tramo.",   "isImage": true }
]
```

> Regla: si el enunciado **o** las alternativas dependen de una figura para poder responderse,
> `needsHumanReview: true` y se listan esas posiciones en `warnings`. La imagen se recorta y
> sube a S3 (`imageUrl`) en un paso posterior; la extracción solo la describe.

## Figuras (matemáticas y algunos textos)

- Las imágenes/gráficos NO se suben a S3 en esta fase. Se marca `hasFigure: true` y se describe en `figureNote` (ej. `"Gráfico de barras con ventas por mes"`). El recorte/subida de la imagen y el set de `imageUrl` es un paso posterior.
- Si el enunciado depende de la figura, transcribir en `stem` todo el texto legible y describir la figura en `figureNote`.

## Transcripción fiel

- Respetar tildes, símbolos matemáticos y saltos de párrafo del texto de lectura.
- No corregir, resumir ni parafrasear. Transcripción literal.
- Fórmulas matemáticas: transcribir en texto plano legible (ej. `3/4 + 1/2`, `x² + 2x`).
