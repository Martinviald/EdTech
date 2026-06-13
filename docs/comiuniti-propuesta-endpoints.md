# Propuesta de endpoints — API Comiuniti

Propuesta de estructura de datos, endpoints, parámetros y respuestas para la integración.

**Convenciones generales**

- Formato: JSON sobre REST.
- `source_id`: identificador propio de Comiuniti, **estable en el tiempo** (no debe cambiar
  entre consultas). Presente en cada entidad.
- Fechas en formato `YYYY-MM-DD`. RUT con dígito verificador (ej. `21.345.678-9`).
- Paginación (donde aplique): respuesta con `{ "data": [...], "total": <int>, "page": <int>, "page_size": <int> }`.
- Parámetro opcional `modificados_desde` (`YYYY-MM-DD`): si se envía, retornar solo los
  registros creados o modificados desde esa fecha.

---

## 1. `GET /establecimientos`

Lista de establecimientos disponibles.

**Parámetros (query)**

| Parámetro | Tipo | Req. | Descripción |
|---|---|---|---|
| `rbd` | string | ○ | Filtra por RBD MINEDUC |

**Respuesta**

```json
{
  "data": [
    {
      "source_id": "COM-COL-00123",
      "rbd": "12345",
      "nombre": "Colegio San José",
      "comuna": "Providencia",
      "region": "Metropolitana",
      "dependencia": "particular_subvencionado"
    }
  ],
  "total": 1
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `source_id` | string | ID estable del establecimiento |
| `rbd` | string | Rol Base de Datos MINEDUC |
| `nombre` | string | Nombre oficial |
| `comuna` | string | |
| `region` | string | |
| `dependencia` | enum | `municipal` \| `particular_pagado` \| `particular_subvencionado` \| `delegada` |

---

## 2. `GET /establecimientos/{source_id}/años-academicos`

Años académicos del establecimiento.

**Parámetros (path)**

| Parámetro | Tipo | Req. | Descripción |
|---|---|---|---|
| `source_id` | string | ✓ | ID del establecimiento |

**Respuesta**

```json
{
  "data": [
    { "año": 2026, "vigente": true },
    { "año": 2025, "vigente": false }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `año` | int | Ej. `2026` |
| `vigente` | bool | `true` para el año en curso |

---

## 3. `GET /establecimientos/{source_id}/cursos`

Cursos (secciones) del establecimiento.

**Parámetros**

| Parámetro | Ubicación | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `source_id` | path | string | ✓ | ID del establecimiento |
| `año` | query | int | ○ | Filtra por año académico (default: año vigente) |

**Respuesta**

```json
{
  "data": [
    {
      "source_id": "COM-CUR-7781",
      "año": 2026,
      "nivel_codigo": "3RD_BASIC",
      "letra": "A",
      "nombre": "3°A",
      "profesor_jefe_source_id": "COM-FUN-5501"
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `source_id` | string | ID estable del curso |
| `año` | int | Año académico |
| `nivel_codigo` | enum | Nivel/grado. Ver catálogo §9.1 |
| `letra` | string \| null | "A", "B"… si aplica |
| `nombre` | string | Nombre legible: "3°A", "4° Medio B" |
| `profesor_jefe_source_id` | string \| null | FK al funcionario profesor jefe (§7) |

---

## 4. `GET /establecimientos/{source_id}/alumnos`

Datos identitarios de los alumnos (no cambian con el curso).

**Parámetros**

| Parámetro | Ubicación | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `source_id` | path | string | ✓ | ID del establecimiento |
| `modificados_desde` | query | date | ○ | Solo alumnos modificados desde esa fecha |
| `page` | query | int | ○ | Página (default 1) |
| `page_size` | query | int | ○ | Tamaño de página (default 100) |

**Respuesta**

```json
{
  "data": [
    {
      "source_id": "COM-ALU-99001",
      "rut": "21.345.678-9",
      "nombres": "Martina Paz",
      "apellido_paterno": "González",
      "apellido_materno": "Rojas",
      "fecha_nacimiento": "2017-04-12",
      "genero": "F",
      "email": null
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 100
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `source_id` | string | ID estable del alumno |
| `rut` | string | Con dígito verificador |
| `nombres` | string | |
| `apellido_paterno` | string | |
| `apellido_materno` | string \| null | |
| `fecha_nacimiento` | date \| null | |
| `genero` | enum | `M` \| `F` | |
| `email` | string \| null | Si el colegio lo maneja |

---

## 5. `GET /establecimientos/{source_id}/matriculas`

Relación alumno ↔ curso ↔ año, con estado. Incluye **también los retirados** del año
consultado (con `estado` ≠ `vigente`), no solo los vigentes.

**Parámetros**

| Parámetro | Ubicación | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `source_id` | path | string | ✓ | ID del establecimiento |
| `año` | query | int | ○ | Año académico (default: año vigente) |
| `estado` | query | enum | ○ | Filtra por estado de matrícula |
| `modificados_desde` | query | date | ○ | Solo matrículas modificadas desde esa fecha |

**Respuesta**

```json
{
  "data": [
    {
      "alumno_source_id": "COM-ALU-99001",
      "curso_source_id": "COM-CUR-7781",
      "año": 2026,
      "estado": "vigente",
      "fecha_matricula": "2026-03-01",
      "fecha_retiro": null
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `alumno_source_id` | string | FK al alumno (§4) |
| `curso_source_id` | string | FK al curso (§3) |
| `año` | int | Año académico |
| `estado` | enum | `vigente` \| `retirado` \| `trasladado` \| `egresado` |
| `fecha_matricula` | date \| null | |
| `fecha_retiro` | date \| null | Presente si `estado` ≠ `vigente` |

---

## 6. `GET /establecimientos/{source_id}/funcionarios`

Docentes y directivos.

**Parámetros**

| Parámetro | Ubicación | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `source_id` | path | string | ✓ | ID del establecimiento |
| `vigente` | query | bool | ○ | Filtra por vigencia |
| `modificados_desde` | query | date | ○ | Solo funcionarios modificados desde esa fecha |

**Respuesta**

```json
{
  "data": [
    {
      "source_id": "COM-FUN-5501",
      "rut": "15.222.333-4",
      "nombres": "Claudia",
      "apellido_paterno": "Pérez",
      "apellido_materno": "Soto",
      "email": "cperez@colegiosanjose.cl",
      "cargo": "homeroom_teacher",
      "vigente": true
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `source_id` | string | ID estable del funcionario |
| `rut` | string | |
| `nombres` | string | |
| `apellido_paterno` | string | |
| `apellido_materno` | string \| null | |
| `email` | string | Correo institucional (login SSO) |
| `cargo` | enum/string | Ver catálogo §9.2 |
| `vigente` | bool | |

---

## 7. `GET /establecimientos/{source_id}/asignaciones-docentes`

Qué funcionario dicta qué asignatura en qué curso.

**Parámetros**

| Parámetro | Ubicación | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `source_id` | path | string | ✓ | ID del establecimiento |
| `año` | query | int | ○ | Año académico (default: año vigente) |

**Respuesta**

```json
{
  "data": [
    {
      "funcionario_source_id": "COM-FUN-5501",
      "curso_source_id": "COM-CUR-7781",
      "asignatura_codigo": "LANG",
      "tipo": "titular"
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `funcionario_source_id` | string | FK al funcionario (§6) |
| `curso_source_id` | string | FK al curso (§3) |
| `asignatura_codigo` | enum | Ver catálogo §9.3 |
| `tipo` | enum | `titular` \| `co_docente` (default `titular`) |

---

## 8. `GET /establecimientos/{source_id}/apoderados`

Apoderados y su vínculo con los alumnos (relación muchos-a-muchos).

**Parámetros**

| Parámetro | Ubicación | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `source_id` | path | string | ✓ | ID del establecimiento |
| `modificados_desde` | query | date | ○ | Solo apoderados modificados desde esa fecha |

**Respuesta**

```json
{
  "data": [
    {
      "source_id": "COM-APO-3120",
      "rut": "18.777.888-K",
      "nombres": "Andrea",
      "apellido_paterno": "Rojas",
      "apellido_materno": "Lillo",
      "email": "andrea.rojas@gmail.com",
      "telefono": "+56998765432",
      "pupilos": [
        {
          "alumno_source_id": "COM-ALU-99001",
          "parentesco": "madre",
          "es_principal": true
        }
      ]
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `source_id` | string | ID estable del apoderado |
| `rut` | string \| null | |
| `nombres` | string | |
| `apellido_paterno` | string | |
| `apellido_materno` | string \| null | |
| `email` | string | Canal de notificación |
| `telefono` | string \| null | Formato E.164 si es posible (`+569…`) |
| `pupilos` | array | Vínculos con alumnos |
| `pupilos[].alumno_source_id` | string | FK al alumno (§4) |
| `pupilos[].parentesco` | string \| null | "madre", "padre", "abuela"… |
| `pupilos[].es_principal` | bool \| null | Apoderado titular vs. suplente |

---

## 9. Catálogos (valores permitidos)

### 9.1 `nivel_codigo`

| Código | Nivel |
|---|---|
| `1RD_BASIC`, `2ND_BASIC`, `3RD_BASIC`, `4TH_BASIC` | 1° a 4° Básico |
| `5TH_BASIC`, `6TH_BASIC`, `7TH_BASIC`, `8TH_BASIC` | 5° a 8° Básico |
| `1ST_MEDIO`, `2ND_MEDIO`, `3RD_MEDIO`, `4TH_MEDIO` | 1° a 4° Medio |

> Si prefieren enviar el nivel en texto ("3° Básico"), lo aceptamos con una tabla de equivalencia.

### 9.2 `cargo`

| Cargo (ejemplo) | Código sugerido |
|---|---|
| Director/a | `school_admin` |
| Jefe/a UTP / Director/a Académico | `academic_director` |
| Coordinador/a de ciclo | `cycle_director` |
| Jefe/a de departamento | `dept_head` |
| Coordinador/a de evaluación | `eval_coordinator` |
| Profesor/a jefe | `homeroom_teacher` |
| Profesor/a de asignatura | `teacher` |

> Si Comiuniti usa otros nombres de cargo, basta con enviarlos como texto y entregarnos la equivalencia.

### 9.3 `asignatura_codigo`

| Código | Asignatura |
|---|---|
| `LANG` | Lenguaje y Comunicación |
| `MATH` | Matemáticas |
| `SCI` | Ciencias Naturales |
| `HIST` | Historia, Geografía y Cs. Sociales |
| `ENG` | Inglés |

### 9.4 `genero`

`M` | `F` | `X` | `unspecified`

### 9.5 `dependencia`

`municipal` | `particular_pagado` | `particular_subvencionado` | `delegada`

### 9.6 `estado` (matrícula)

`vigente` | `retirado` | `trasladado` | `egresado`
