# Lector de Marcas — Diseño del módulo

> Épico E22. Hojas de respuesta propias: configuración del layout, impresión en papel,
> lectura óptica de marcas (OMR) y corrección. Sustituye la dependencia de GradeCam en el
> camino crítico del colegio.
>
> **Estado:** diseño cerrado, sin implementar. Fase objetivo: F3 (épico independiente).

---

## El encuadre

No se construye un clon de GradeCam. El módulo `answer-sheets` ya resuelve **todo lo que
ocurre después del escaneo**:

| Pieza existente | Qué resuelve |
|---|---|
| `apps/api/src/answer-sheets/lib/parsers/*` | 4 parsers que convergen a un `ParserResult` |
| `.../lib/student-matcher.ts` | Emparejamiento contra el roster |
| `.../lib/composite-answers.ts` | Etiqueta impresa → posición de ítem, sub-ítems compuestos |
| `.../assessment-results/lib/persist-results.ts` | Escritura de `responses` + cálculo de resultados |
| `packages/types/src/utils/item-scoring.ts` | Algoritmo de corrección |
| `apps/api/src/files/` | Subida a S3 por presigned URL |
| `apps/api/src/llm/` | Gemini y Claude ya cableados (para v1) |
| `apps/api/src/jobs/` | Puerto `JobDispatcher` para trabajo asíncrono |

El módulo nuevo tiene **una sola obligación**: convertir una imagen en un `ParserResult`.
Todo lo demás es reuso. Eso convierte un proyecto inviable en un componente acotado con una
interfaz de una función.

## Veredicto

**Viable. Complejidad media. No es investigación.** El reconocimiento óptico de marcas es
ingeniería resuelta hace décadas. El riesgo real no está en el algoritmo sino en tres lugares:

1. La variabilidad física del papel (impresión, escaneo, iluminación).
2. La ausencia de un conjunto de verdad para medir precisión.
3. El acoplamiento entre la hoja impresa y un instrumento que puede editarse después de imprimir.

| Métrica | Valor |
|---|---|
| Componentes nuevos | 21 |
| Tablas nuevas | 6 |
| Servicios desplegables nuevos | 1 (visión, Python) |
| Reuso del camino aguas abajo | 100% |
| MVP | 6–8 semanas |
| v1 productiva | 14–17 semanas |

## Los cuatro puntos que gobiernan todo el diseño

1. **El riesgo número uno no es el OCR, es el instrumento editado después de imprimir.**
   Corrige todo corrido un lugar, en silencio, para el curso completo. Ver [D6](01-decisiones.md#d6)
   y [G1](02-gaps.md#g1).
2. **"En blanco" y "no escaneado" son cosas distintas** y hoy el pipeline las colapsa.
   Ver [G3](02-gaps.md#g3).
3. **El umbral de marca es relativo por hoja, nunca absoluto.** Ver [D8](01-decisiones.md#d8)
   y [C21](04-componentes.md#c21).
4. **El criterio del MVP son tres cifras**, y la que importa es "cero marcas incorrectas
   decididas con confianza alta". Ver [plan](06-plan-mvp-v1.md#criterio-de-aceptación).

## Índice

| Doc | Contenido |
|---|---|
| [01-decisiones.md](01-decisiones.md) | D1–D18: decisiones cerradas, su razón y qué dejan abierto |
| [02-gaps.md](02-gaps.md) | G1–G8: huecos detectados al bajar al diseño, con su resolución |
| [03-contratos.md](03-contratos.md) | `LayoutSpec`, `ScanResult`, contrato HTTP del servicio de visión, esquema Drizzle |
| [04-componentes.md](04-componentes.md) | Inventario C1–C21 y diseño individual de cada uno |
| [05-sistema.md](05-sistema.md) | Flujo end-to-end, límites transaccionales, multi-tenancy, modos de falla |
| [06-plan-mvp-v1.md](06-plan-mvp-v1.md) | Olas del MVP con criterio medible, incrementos de v1, riesgos vivos |
| [07-identidad-qr-robusta.md](07-identidad-qr-robusta.md) | Diagnóstico cerrado del QR (aliasing de remuestreo) y estrategia: payload corto, ECC Q, desacoplar roles |
| [08-plan-identidad-qr-robusta.md](08-plan-identidad-qr-robusta.md) | Plan por fases de la estrategia 07, con gates medibles |
| [09-robustez-de-encuadre.md](09-robustez-de-encuadre.md) | Pendiente: el tope de distancia de los fiduciales asume que la hoja llena el encuadre; 5 de 7 fotos reales fallan |

## Orden de lectura para implementar

1. `01-decisiones.md` completo — nada se re-litiga durante la implementación.
2. `03-contratos.md` — **se congela antes de escribir cualquier otro código** (ola O0).
3. `04-componentes.md` para la pieza que toque.
4. `05-sistema.md` antes de integrar dos componentes entre sí.

## Fuentes

- Código existente: `apps/api/src/answer-sheets/`, `packages/types/src/utils/`.
- Formato GradeCam: `dia-ingesta/docs/referencia/FORMATO-GRADECAM.md`. Su catálogo de
  suciedad real (doble burbuja, formato no canónico, dígito verificador inválido) validado
  contra ~2.700 escaneos de producción es la base de los casos de prueba del clasificador.
- Contrato del proyecto: `CLAUDE.md` §4 (SOLID/DRY/capas), §5.2 (RLS), §8.3 (IA propone,
  humano aprueba), §11 (seguridad), §12 (asíncrono).
