# PAES M2 2026 — tabla de especificaciones y tags de taxonomía

Los dos ensayos de Competencia Matemática 2 aplicados en IV° medio 2026 estaban
cargados con sus 55 ítems cada uno pero **sin un solo tag de taxonomía**: daban
puntaje y ninguna lectura por habilidad. Este documento deja registrado de dónde
salió el dato y qué se cargó.

| Instrumento | `sourceJson` | Aplicación | Ítems |
|---|---|---|---|
| PAES M2 — Ensayo 3 (Tanda 3) | `M2-E3-con-pauta.json` | 29-05-2026 ("Mayo") | 55 |
| PAES M2 — Ensayo 4 (Tanda 4) | `M2-E4-con-pauta.json` | 05-08-2026 ("Agosto") | 55 |

La correspondencia "Mayo/Agosto" ↔ tandas 3 y 4 está confirmada contra la pestaña
`Ensayos 2026` de la planilla índice de resultados, que fecha cada ensayo.

## Fuente

Pestaña `M2` de las planillas **Tablas de especificaciones IV° medio** del Drive
del colegio, una por tanda:

- Tanda 3: `1_eeBI5haWj7MDaaPNFJkJhZqVCw_dD_RW0ZZQKweKvE`
- Tanda 4: `1JxecJf5W9TtYJ9i5tVN3PHJnU_B7aJVPKdhRK5H6SUo`

⚠️ **La API de Sheets devuelve esa pestaña vacía.** `values` responde 0 filas para
`M2` (y para `M1`), aunque la pestaña tiene 55 filas de datos. Hay que exportar el
`.xlsx` (`gdrive get`) y leerlo del archivo. Si alguien concluye "no hay tabla de
M2" mirando solo la API, está mirando un falso negativo.

Cada fila trae: número impreso, clave, habilidad y eje temático.

## Pipeline

```sh
cd ensayos-paes
python3 tabla_espec_m2.py <xlsx tanda 3> <xlsx tanda 4>   # → extraccion/M2/m2-tabla-especificaciones.json
python3 taxonomia_paes.py                                  # → extraccion/paes-taxonomia-catalogo.json
python3 plan_tags_m2.py                                    # → extraccion/paes-m2-item-tags-plan.json
```

Y en la BDD (aditivo, en este orden):

```sh
DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db exec tsx src/seed/seed-paes-taxonomy.ts
DATABASE_ADMIN_URL=<url> ITEM_TAGS_PLAN=$PWD/packages/db/data/instruments-paes/paes-m2-item-tags-plan.json \
  pnpm --filter @soe/db exec tsx src/seed/import-item-tags.ts
```

`ITEM_TAGS_PLAN` carga el plan de M2 aislado. El plan grande
(`paes-item-tags-plan.json`) **no** se regenera: sus entradas se resuelven por
`position` y volver a emitirlas con `printedNumber` cambiaría la vía de
resolución de los otros 20 instrumentos ya etiquetados. Por eso `plan_tags_m2.py`
vive aparte de `plan_tags.py`.

## Nodos creados

8 nodos nuevos bajo `PAES.M2`, con el mismo vocabulario que M1 pero como nodos
propios (la misma etiqueta mide otra cosa en otra prueba, y el dashboard agrupa
por nodo):

- Habilidades: `PAES.M2.HAB.{RESOLVER,MODELAR,REPRESENTAR,ARGUMENTAR}`
- Ejes: `PAES.M2.EJE.{NUMEROS,ALGEBRA,GEOMETRIA,PROBABILIDAD}`

Las variantes crudas observadas ("Número"/"Números", "Álgebra y Funciones"/
"Álgebra y funciones") quedan declaradas en `taxonomia_paes.py`. Una etiqueta
nueva revienta en vez de caer a un nodo genérico.

## Verificación

**Clave como fuente independiente.** La tabla trae la clave de cada pregunta, que
no se usó para etiquetar. Contrastada contra la clave vigente en la BDD (que vino
de GradeCam): **109 de 110 coinciden**. La única diferencia es E4 #22, que la
tabla marca `Eliminada` y que en la BDD ya vale 0 puntos — es decir, coinciden
también en ese caso.

**Cobertura.** 110 de 110 ítems quedaron con habilidad y con eje. Ninguno se
rellenó con un valor por defecto.

**Totales propios de la planilla.** Para la tanda 3 la propia hoja cuenta
20/13/8/14 por habilidad (total 55) y 18/10/10 por eje; la carga reproduce esos
números. El `COUNTIF` de "Número" de la hoja marca 0 porque busca el singular
mientras la columna dice "Números": las 17 preguntas de ese eje sí existen
(17+18+10+10 = 55). Es un error de la fórmula de la planilla, no del dato.

## Ítems piloto

La leyenda de la hoja es "Pintar preguntas piloto": el piloto se marca pintando
la fila de verde, sin ninguna marca textual. Marcadas así hay 5 en la tanda 3
(#2, #9, #11, #23, #37) y 1 en la tanda 4 (#22, la `Eliminada`).

En la BDD solo E4 #22 vale 0 puntos; los 5 de la tanda 3 puntúan 1 como el resto.
O sea la marca verde de la tanda 3 **no** coincide con lo que se cargó como
piloto desde GradeCam. Queda reportado, no corregido: cambiar el puntaje de esos
5 ítems alteraría resultados ya calculados y necesita decisión del colegio.

Todos los ítems se etiquetan, pilotos incluidos: la tabla declara su habilidad y
su eje, y un ítem que no puntúa no altera ningún resultado por el hecho de estar
descrito.
