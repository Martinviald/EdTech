# Corte real — fotos de hojas impresas con verdad conocida

Es el juez del registro de burbujas (ver `goldset/README-registro.md`). Son hojas impresas
por el impresor real, rellenadas a lápiz y fotografiadas con teléfono. La verdad **no** sale
de leer la foto: la persona que rellena deja escrita la clave antes de fotografiar
(`truthSource: "construction"`, una transcripción con `by` = quien rellenó).

## Qué hay y de dónde viene

`real-phone/` — layout `4621f0d4…` (22 preguntas, 4 alternativas, identidad QR):

| hoja | hoja física | origen | verdad |
|---|---|---|---|
| `bruno-1619`, `bruno-1626` | Bruno (9B7B-B101) | `IMG_1619.JPG`, `IMG_1626.JPG` | construcción; q12 doble marca real (B y C) |
| `carla-1620`, `carla-1625` | Carla (53FF-698D) | `IMG_1620.JPG`, `IMG_1625.JPG` | construcción; 1620 la rechaza el motor por encuadre (`cropped`) |
| `diego-1621`, `diego-1624` | Diego (FC95-F3FE) | `IMG_1621.JPG`, `IMG_1624.JPG` | construcción; la misma hoja con y sin el problema de registro |
| `ana-1622`, `ana-1623` | Ana (C014-6453) | `IMG_1622.JPG`, `IMG_1623.JPG` | construcción; 13 marcas, el resto en blanco |
| `demo-1`, `demo-2` | lote demo `5a6d5cd9` | `captura-1.jpg`, `captura-2.jpg` | **adjudicación** (revisor sobre 30 ambiguas + motor en 14 confiadas); provisional |

Las fotos originales están en `analisis-omr-marcas/datos/fotos-con-verdad/` y
`analisis-omr-marcas/datos/imgs/` (fuera del repo). `physicalSheet` en `truth.json` agrupa
las capturas de una misma hoja física: el arnés mide con eso la estabilidad entre capturas.

## Traer las fotos

```bash
cd services/omr
.venv/bin/python -m goldset.import_real \
  "…/analisis-omr-marcas/datos/fotos-con-verdad" "…/analisis-omr-marcas/datos/imgs"
.venv/bin/python -m goldset.validate goldset/real
.venv/bin/python -m goldset.run goldset/real
.venv/bin/python -m tools.measure_registration goldset/real
```

## Cómo agregar hojas (protocolo)

1. Imprimir con el impresor real; rellenar a lápiz; **escribir la clave** (pregunta → letra,
   `null` si en blanco, `"BC"` si doble) antes de fotografiar.
2. Fotografiar la **misma hoja varias veces** variando ángulo, distancia, luz (ventana,
   lámpara, flash), papel curvado. Cada foto es una hoja del corte; todas comparten
   `physicalSheet`.
3. Incluir a propósito: lápiz claro real (HB/2H), rellenos parciales, borrones, dobles marcas,
   hojas en blanco, alguna foto con brillo sobre el grafito.
4. Una carpeta por foto con `truth.json` (`truthSource`, `physicalSheet`, `sourceFile`,
   `transcriptions`) y la foto fuera de git; `python -m goldset.validate goldset/real` antes
   de medir.
