# Sprint 2 — Guía de Testing E2E Manual

> Guía paso a paso para verificar cada historia de usuario del Sprint 2. Requiere el backend (`pnpm --filter @soe/api dev`) y frontend (`pnpm --filter @soe/web dev`) corriendo localmente, con al menos un colegio, un currículum y alumnos cargados (seed de S1).

---

## Pre-requisitos

1. Base de datos con seed de S0/S1 aplicado (colegio, cursos, alumnos, currículum MINEDUC)
2. Variable `ANTHROPIC_API_KEY` configurada en `.env` (para H3.11)
3. Usuario autenticado con rol `school_admin` o `academic_director`
4. Navegador abierto en `http://localhost:3000`

---

## H3.3 — Banco de Ítems con metadata

**Objetivo:** Un administrador puede crear, listar, editar y eliminar instrumentos e ítems con metadata completa (OA, habilidad, IRT).

### Test 1: Crear instrumento

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Navegar a `/banco-items` | Página de listado vacía con mensaje "No hay instrumentos" |
| 2 | Click en "Nuevo instrumento" | Formulario de creación con campos: nombre, tipo, año, versión |
| 3 | Llenar: nombre="Prueba Diagnóstico Lectura", tipo="DIA", año=2025 | Campos se llenan correctamente |
| 4 | Agregar sección: nombre="Selección múltiple", tipo="multiple_choice" | Sección aparece en la lista |
| 5 | Click "Crear instrumento" | Redirect a la página de detalle del instrumento creado |
| 6 | Verificar en `/banco-items` | El instrumento aparece en la grilla con badge "DIA" y status "Borrador" |

### Test 2: Crear ítems dentro del instrumento

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Desde la página de detalle del instrumento, verificar tabla vacía | Mensaje "No hay ítems" |
| 2 | `POST /api/items` con body: `{ instrumentId: "<id>", sectionId: "<sectionId>", position: 1, type: "multiple_choice", content: { stem: "¿Cuál es la idea principal?", alternatives: [{ key: "A", text: "opción 1", isCorrect: false }, { key: "B", text: "opción 2", isCorrect: true }, { key: "C", text: "opción 3", isCorrect: false }, { key: "D", text: "opción 4", isCorrect: false }] }, scoringConfig: { points: 1 }, irtParams: { a: 1.2, b: -0.5 }, status: "published", source: "official" }` | 201 Created con el ítem completo |
| 3 | Refrescar la página de detalle | El ítem aparece en la tabla: posición 1, tipo "multiple_choice", status "published" |

### Test 3: Agregar taxonomy tags a un ítem

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | `POST /api/items/<itemId>/tags` con `{ nodeId: "<oaNodeId>", tagType: "primary" }` | 201 Created con el tag |
| 2 | `GET /api/items/<itemId>` | Response incluye `tags: [{ nodeId, tagType: "primary", taggedBy: "human", node: { name, type } }]` |
| 3 | Refrescar detalle del instrumento | El ítem muestra un badge de color con el nombre del OA |

### Test 4: Listar con filtros

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | `GET /api/instruments?type=dia` | Solo instrumentos tipo DIA |
| 2 | `GET /api/instruments?status=draft` | Solo borradores |
| 3 | `GET /api/items?instrumentId=<id>&status=published` | Solo ítems publicados de ese instrumento |
| 4 | `GET /api/items?page=1&limit=5` | Response con `{ data: [...], total: N, page: 1, limit: 5 }` |

### Test 5: Soft delete

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | `DELETE /api/items/<itemId>` | 204 No Content |
| 2 | `GET /api/items/<itemId>` | 404 Not Found |
| 3 | Query directa a DB: `SELECT * FROM items WHERE id = '<itemId>'` | Row existe con `deleted_at IS NOT NULL` |
| 4 | `GET /api/items?instrumentId=<id>` | El ítem eliminado NO aparece en la lista |

### Test 6: Multi-tenancy

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Con usuario de colegio A, crear instrumento | Se crea con `org_id` del colegio A |
| 2 | Con usuario de colegio B, `GET /api/instruments` | El instrumento de colegio A NO aparece |
| 3 | Con usuario de colegio B, `GET /api/instruments/<idColegioA>` | 404 o 403 |

---

## H3.10 — Versionado de pruebas

**Objetivo:** Al editar un ítem, se crea automáticamente un snapshot de la versión anterior.

### Test 1: Version bumping automático

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Crear un ítem con `content: { stem: "Versión 1" }` | Ítem creado con `version: 1` |
| 2 | `PATCH /api/items/<id>` con `{ content: { stem: "Versión 2" } }` | Response con `version: 2` |
| 3 | `GET /api/items/<id>/versions` | Array con 1 entrada: `{ version: 1, content: { stem: "Versión 1" }, changeNote: null }` |
| 4 | `PATCH /api/items/<id>` con `{ content: { stem: "Versión 3" } }` | Response con `version: 3` |
| 5 | `GET /api/items/<id>/versions` | Array con 2 entradas (versiones 1 y 2) |

### Test 2: Historial preserva datos completos

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Crear ítem con `irtParams: { a: 1.0, b: 0.5 }` | Creado |
| 2 | `PATCH /api/items/<id>` con `{ irtParams: { a: 1.5, b: -0.3 } }` | Actualizado |
| 3 | `GET /api/items/<id>/versions` | Versión anterior tiene `irtParams: { a: 1.0, b: 0.5 }` preservado |

---

## H3.12 — Ingerir pautas oficiales DIA

**Objetivo:** Subir la pauta DIA (claves + mapeo a habilidades) y crear automáticamente instrumento + ítems + tags.

### Test 1: Preview sin guardar

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Navegar a `/importar-dia` | Wizard con paso 1: subir archivo + formulario metadata |
| 2 | Subir `packages/db/data/dia-2025-lectura-2basico.json` | Archivo aceptado, se muestra el nombre |
| 3 | Llenar metadata: nombre, año=2025, seleccionar currículum y asignatura Lenguaje | Campos completados |
| 4 | Click "Previsualizar" | Paso 2: tabla con 20 ítems mostrando posición, clave correcta, habilidad |
| 5 | Verificar warnings | Si alguna habilidad no matchea con taxonomy, se muestra en amarillo |
| 6 | Verificar en DB: `SELECT count(*) FROM instruments WHERE type='dia'` | Cero — no se guardó nada |

### Test 2: Confirm crea todo atómicamente

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Desde el paso 2 del wizard, click "Confirmar importación" | Paso 3: mensaje de éxito con link al instrumento |
| 2 | Verificar instrumento: `GET /api/instruments?type=dia` | Nuevo instrumento "DIA Lectura 2° Básico 2025" con `isOfficial: true` |
| 3 | `GET /api/items?instrumentId=<nuevoId>` | 20 ítems tipo "multiple_choice", todos con `source: "official"` |
| 4 | Verificar tags: `GET /api/items/<primerItemId>` | Tiene tags con habilidades DIA (Localizar, Interpretar, etc.) |
| 5 | Verificar contenido: primer ítem tiene `content.alternatives` con 4 opciones y una marcada `isCorrect: true` | Correcto |

### Test 3: Seed data Matemática

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Repetir flujo con `dia-2025-matematica-4basico.json` | 25 ítems creados |
| 2 | Verificar habilidades: "Resolver problemas", "Representar", "Argumentar y comunicar", "Modelar" | Tags creados correctamente |

### Test 4: Error handling

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Subir un JSON inválido (texto aleatorio) | Error claro: "Formato de archivo inválido" |
| 2 | Subir JSON con `items: []` (array vacío) | Error: "No hay ítems para importar" |
| 3 | Subir pauta con habilidad inexistente "XYZ" | Preview muestra warning para ese ítem, no bloquea los demás |

---

## H3.11 — Etiquetado IA de preguntas

**Objetivo:** La IA sugiere tags para ítems basándose en su contenido, y el admin confirma/rechaza.

### Pre-requisito

- `ANTHROPIC_API_KEY` configurada en `.env`
- Al menos 1 instrumento con ítems cargados (usar resultado de H3.12)
- Al menos 1 currículum con taxonomy nodes (seed MINEDUC)

### Test 1: Obtener sugerencias IA

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Navegar a `/banco-items/<instrumentId>/etiquetar` | Página con lista de ítems y checkboxes |
| 2 | Seleccionar 3 ítems (checkboxes) | 3 ítems marcados |
| 3 | Seleccionar currículum MINEDUC del dropdown | Currículum seleccionado |
| 4 | Click "Obtener sugerencias de IA" | Loading spinner, luego aparecen sugerencias |
| 5 | Verificar sugerencias | Cada ítem tiene 1-3 nodos sugeridos con: nombre, tipo, confidence (0.5-1.0), reasoning |
| 6 | Verificar confidence visual | Barras verdes (>0.8), amarillas (0.5-0.8) |

### Test 2: Confirmar/rechazar sugerencias

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Aceptar 2 sugerencias, rechazar 1 | Toggles cambian de estado |
| 2 | Click "Confirmar selección" | Mensaje de éxito: "2 tags aplicados, 1 rechazado" |
| 3 | Volver al detalle del instrumento | Los 2 ítems confirmados muestran nuevos tags con badge |
| 4 | `GET /api/items/<itemId>` (uno confirmado) | Tag con `taggedBy: "ai"`, `confidence` del AI |

### Test 3: IA no disponible

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Remover `ANTHROPIC_API_KEY` del `.env` y reiniciar API | API arranca sin error |
| 2 | Intentar "Obtener sugerencias de IA" | Error 503: "Servicio de IA no disponible" |
| 3 | La plataforma sigue funcionando normalmente para todo lo demás | Sin impacto |

### Test 4: AI nunca escribe sin confirmación

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Solicitar sugerencias para 5 ítems | Sugerencias aparecen |
| 2 | Cerrar la página sin confirmar | Ningún cambio en DB |
| 3 | `SELECT * FROM item_taxonomy_tags WHERE tagged_by = 'ai'` | Cero rows nuevas (o solo las confirmadas anteriormente) |

---

## H5.8 — Subir tabla de especificaciones desde Excel

**Objetivo:** Subir un Excel con la tabla de specs de una prueba y vincular preguntas a habilidades/OAs.

### Pre-requisito

- Un instrumento con ítems ya cargados (por ejemplo de H3.12)
- Un archivo Excel (.xlsx) o CSV con columnas como: "Pregunta", "Habilidad", "OA", "Eje de contenido"

### Crear archivo de test

Crear un CSV `test-spec-table.csv`:
```csv
Pregunta,Habilidad,OA,Eje de contenido,Respuesta correcta
1,Localizar información explícita,OA3,Comprensión de lectura,B
2,Interpretar y relacionar,OA4,Comprensión de lectura,A
3,Reflexionar sobre el texto,OA5,Escritura,D
4,Localizar información explícita,OA3,Comprensión de lectura,C
5,Interpretar y relacionar,OA4,Comprensión de lectura,B
```

### Test 1: Upload y preview

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Navegar a `/banco-items/<instrumentId>/spec-table` | Wizard de upload |
| 2 | Arrastrar `test-spec-table.csv` al dropzone | Archivo aceptado, nombre mostrado |
| 3 | Click "Analizar archivo" | Paso 2: muestra columnas detectadas: "Pregunta", "Habilidad", "OA", "Eje de contenido", "Respuesta correcta" |
| 4 | Verificar preview | Primeras 5 filas en tabla |

### Test 2: Mapeo de columnas

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | En "Posición / Pregunta #" seleccionar "Pregunta" | Mapeado |
| 2 | En "Habilidad" seleccionar "Habilidad" | Mapeado |
| 3 | En "OA" seleccionar "OA" | Mapeado |
| 4 | En "Contenido" seleccionar "Eje de contenido" | Mapeado |
| 5 | Preview de la tabla con el mapeo aplicado | Las columnas muestran los valores correctos |

### Test 3: Vincular y resultado

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Click "Vincular" | Processing, luego resultado |
| 2 | Resultado muestra: "N ítems vinculados" | Ej: "4 ítems vinculados, 1 warning" |
| 3 | Si hay habilidad no encontrada en taxonomy, aparece en warnings | Warning visible y entendible |
| 4 | Volver al detalle del instrumento | Los ítems ahora muestran tags nuevos |
| 5 | `GET /api/items/<itemId>` (uno vinculado) | Tags con `taggedBy: "human"` |

### Test 4: Archivo inválido

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Subir un archivo .pdf | Error: "El archivo debe ser .xlsx o .csv" |
| 2 | Subir un archivo >5MB | Error: "El archivo excede el tamaño máximo" |
| 3 | Subir un CSV vacío (solo headers) | Error o warning: "No hay datos para procesar" |

### Test 5: Fuzzy matching

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | En el CSV, escribir "localizar información" (sin mayúscula, sin "explícita") | Match parcial con "Localizar información explícita" o warning |
| 2 | Escribir el código "OA3" en la columna OA | Match por código del nodo |
| 3 | Escribir "RESOLVER PROBLEMAS" (todo mayúsculas) | Match case-insensitive |

---

## Tests de Regresión (Cross-cutting)

### Autenticación y roles

| Test | Acción | Resultado esperado |
|------|--------|-------------------|
| Sin sesión | Navegar a `/banco-items` sin login | Redirect a `/login` |
| Rol teacher | Login como teacher, ir a `/banco-items` | Puede VER instrumentos e ítems |
| Rol teacher | Intentar crear instrumento | Botón "Nuevo" NO visible |
| Rol teacher | `POST /api/instruments` directo | 403 Forbidden |
| Rol eval_coordinator | Login como eval_coordinator | Puede crear, editar, etiquetar |

### Responsive

| Test | Viewport | Resultado esperado |
|------|----------|-------------------|
| Banco items | Mobile (375px) | Cards en 1 columna, filtros colapsados |
| Banco items | Tablet (768px) | Cards en 2 columnas |
| Banco items | Desktop (1280px) | Cards en 3 columnas |
| Wizard DIA | Mobile | Steps apilados, botones full-width |
| Tabla de ítems | Mobile | Scroll horizontal en tabla |

### Performance

| Test | Criterio |
|------|----------|
| Listar 100 instrumentos | Respuesta < 500ms con paginación |
| Crear 50 ítems (H3.12 confirm) | Transacción completa < 3s |
| AI tagging de 10 ítems | Respuesta < 30s (depende de Claude API) |
| Parsear Excel 500 filas | Respuesta < 2s |

---

## Checklist de Aceptación por Historia

### H3.3 — Banco de ítems ✓
- [ ] CRUD completo de instrumentos (crear, leer, editar, eliminar)
- [ ] CRUD completo de ítems con metadata (OA, habilidad, IRT 2PL)
- [ ] Taxonomy tags se asignan y visualizan correctamente
- [ ] Paginación funciona en listados
- [ ] Soft delete preserva datos
- [ ] Multi-tenancy aísla datos entre colegios

### H3.10 — Versionado ✓
- [ ] Al actualizar un ítem, se crea snapshot automático en `item_versions`
- [ ] El historial preserva content + irtParams completos
- [ ] `GET /items/:id/versions` retorna el historial ordenado

### H3.11 — Etiquetado IA ✓
- [ ] Se pueden seleccionar ítems y solicitar sugerencias
- [ ] Claude API retorna sugerencias con confidence y reasoning
- [ ] Admin puede aceptar/rechazar individualmente
- [ ] Solo las confirmadas se guardan en DB con `taggedBy: 'ai'`
- [ ] Sin API key, la plataforma no se rompe (503 graceful)

### H3.12 — Ingesta DIA ✓
- [ ] Se puede subir pauta DIA (JSON)
- [ ] Preview muestra ítems parseados + warnings
- [ ] Confirm crea instrumento + sección + ítems + tags atómicamente
- [ ] Datos seed son realistas (habilidades DIA reales)
- [ ] Errores parciales no bloquean el resto

### H5.8 — Tabla de especificaciones ✓
- [ ] Se puede subir Excel (.xlsx) y CSV
- [ ] Preview detecta columnas correctamente
- [ ] Mapeo de columnas es intuitivo
- [ ] Vinculación matchea por código y nombre (case-insensitive)
- [ ] Warnings claros para rows que no matchean

---

_Documento generado: 2026-05-26 · Sprint 2 EdTech_
