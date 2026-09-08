# Runbook — Migrar Ciencias a un instrumento por ensayo

> Operación de datos sobre la BDD demo. El código que la habilita va en la misma PR; **esto
> no se ejecuta solo**. Léelo entero antes de correr el primer comando.

## Qué hace

Reemplaza los **9 instrumentos** de Ciencias (3 ensayos × 3 menciones, con las 54 comunes
duplicadas 3 veces) por **3 instrumentos** de ~130 ítems con cuatro secciones cada uno:
un módulo común (`role=core`) y tres menciones (`role=elective`).

## Precondiciones

| # | Qué | Cómo se verifica |
|---|---|---|
| 1 | La migración `0028` (+ `0029` del lector) aplicada | `pnpm --filter @soe/db db:migrate` |
| 2 | Los 9 instrumentos **sin respuestas ni assessments** colgando | La consulta de §Verificación previa |
| 3 | El matching de tags migrado a `printedNumber` | Ver la etapa 4 del plan |
| 4 | Decidido qué se hace con las 330 figuras | Ver §Figuras |
| 5 | Las divergencias de E1 y E4 resueltas | Ver §Divergencias |

## Verificación previa (no destructiva)

```sql
select
  (select count(*) from responses r join items it on it.id=r.item_id
     join instruments i on i.id=it.instrument_id where i.config->>'sourceJson' like 'CIE-%') responses,
  (select count(*) from assessments a join instruments i on i.id=a.instrument_id
     where i.config->>'sourceJson' like 'CIE-%') assessments,
  (select count(*) from sheet_layouts sl join instruments i on i.id=sl.instrument_id
     where i.config->>'sourceJson' like 'CIE-%') layouts,
  (select count(*) from item_taxonomy_tags t join items it on it.id=t.item_id
     join instruments i on i.id=it.instrument_id where i.config->>'sourceJson' like 'CIE-%') tags;
```

Al 2026-09-05: `0 | 0 | 0 | 1399`. **Si `responses` o `assessments` no son 0, PARA**: la
migración renumera ítems y dejaría resultados apuntando a preguntas equivocadas.

## Divergencias de E1 y E4

`fusionar_cie.py` (en `ensayos-paes/`) ya reporta cuáles son. Al 2026-09-05:

| Ensayo | Fusión | Avisos |
|---|---|---|
| E3 | 132 ítems · 54 + 26×3 | ninguno — limpio |
| E1 | 130 ítems | Biología trae 25 de mención (extracción incompleta: el cuadernillo dio 78 ítems, no 80) |
| E4 | 127 ítems | Biología 25 y Química 23 |

⚠️ **No son preguntas que falten en la prueba: son ítems que la extracción no logró sacar.**
Antes de migrar hay que completarlos contra el PDF, o aceptar explícitamente que el
instrumento queda incompleto y dejarlo anotado.

En E1 hay además 3 comunes que no calzan entre cuadernillos **porque están en otra posición**
(la misma pregunta es la 26 en Biología y la 8 en Física). El fusionador las empareja por
enunciado con `mapear_comun_cie.py`, validado 53/53 contra la Tabla de especificaciones de la
tanda 1, que es la única que trae las tres columnas `N°B`/`N°F`/`N°Q`.

## Figuras

⚠️ La storage key es `item/global/{slug}/item_figure/{NN}.png` y **`NN` es la posición del
ítem** (verificado en 330 de 330). Al fusionar, las posiciones se renumeran: **cambian las dos
mitades de la key**, no sólo el slug.

Dos caminos:

1. **Re-subir** las 330 con el slug y la posición nuevos. Mecánico, barato, y repite el
   acoplamiento.
2. **Desacoplar** la key de la posición (usar `printedNumber` + sección, o un id estable). Es
   la corrección de fondo; cuesta más y evita que el próximo renumerado vuelva a romperlas.

Recomendado: **(2)**. La deuda ya mordió una vez.

## Pasos

```bash
# 1. Fusionar los 3 cuadernillos de cada ensayo (en ensayos-paes/)
./.venv/bin/python fusionar_cie.py E1
./.venv/bin/python fusionar_cie.py E3
./.venv/bin/python fusionar_cie.py E4
#    Revisar los avisos: cero sorpresas antes de seguir.

# 2. Exportar al formato del importador y dejar SOLO los 3 fusionados en un dir aparte
#    (no re-importar los otros 20 instrumentos: borraría sus tags por CASCADE).

# 3. Borrar los 9 antiguos — sólo si la verificación previa dio 0 responses/assessments.

# 4. Importar los 3 nuevos
INSTRUMENTS_DATA_DIR=<dir con los 3> pnpm --filter @soe/db exec tsx src/seed/import-instruments.ts

# 5. Re-aplicar tags (con el matching por printedNumber de la etapa 4)
ITEM_TAGS_PLAN=<plan> pnpm --filter @soe/db exec tsx src/seed/import-item-tags.ts

# 6. Figuras, según lo decidido arriba.
```

## Verificación posterior

```sql
-- 3 instrumentos, 4 secciones cada uno, roles correctos
select i.name, s.role, s.elective_key, count(it.id)
  from instruments i join instrument_sections s on s.instrument_id = i.id
  left join items it on it.section_id = s.id
 where i.config->>'sourceJson' like 'CIE-%' group by 1,2,3 order by 1,2,3;

-- ninguna común duplicada
select left(md5(it.content->>'stem'),8) h, count(*)
  from items it join instruments i on i.id=it.instrument_id
 where i.config->>'sourceJson' like 'CIE-%' group by 1 having count(*)>1;
-- esperado: 0 filas

-- las figuras resuelven a un objeto que existe en S3 (en los dos sentidos)
```

## Vuelta atrás

No hay rollback automático. La red de seguridad es que **los 9 instrumentos no tienen
respuestas**: si algo sale mal, se re-importan desde los JSON de
`packages/db/data/instruments-paes/CIE/`, que siguen versionados en el repo.
