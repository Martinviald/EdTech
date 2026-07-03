# Especificación de integración de datos — Comiuniti → [Plataforma SOE]

> Documento técnico para definir los endpoints/estructura de datos que necesitamos consumir
> desde Comiuniti para la configuración inicial y sincronización periódica de los colegios.

---

## 1. Objetivo y modelo de sincronización

Queremos **poblar y mantener actualizada** la configuración base de los colegios (cursos,
alumnos, docentes, directivos, apoderados y sus relaciones) consumiendo directamente la API
de Comiuniti, en lugar de pedirle planillas al colegio. Esto reduce la fricción de entrada
y mantiene la data fresca.

**Frecuencia de consulta:** periódica (estimado **mensual**). En cada corrida tomamos una
"foto" del estado actual y la reconciliamos contra nuestra base (alta de nuevos, baja de
retirados, actualización de correos/cursos). Por eso el diseño prioriza dos cosas:

1. **IDs estables.** Cada registro debe traer un identificador propio de Comiuniti que
   **no cambie nunca** (`source_id`). Es lo que nos permite hacer *upsert* idempotente y
   detectar que "el alumno X cambió de curso" en vez de crear un duplicado.
2. **Estado explícito.** No inferimos bajas por ausencia. Cada matrícula/persona trae un
   campo de estado (`vigente` / `retirado` / etc.) para que la baja sea un dato, no un
   silencio.

**Formato:** JSON sobre REST, una "foto" completa por establecimiento en cada corrida.
Las claves de los ejemplos son sugerencias; lo importante es que **el campo exista y sea
consistente**, no su nombre exacto.

---

## 2. Principios de diseño de la estructura (importante)

- **Normalizado y plano, no anidado.** Preferimos listas planas de cada entidad enlazadas
  por IDs (estilo tablas relacionales) antes que objetos anidados. Razón: un alumno tiene
  varios apoderados y un apoderado puede tener varios pupilos (relación muchos-a-muchos);
  anidar duplica datos y complica la sincronización. Ver §3.
- **RUT como clave natural de personas.** Además del `source_id`, incluir siempre el RUT
  (con dígito verificador) de alumnos, apoderados y funcionarios. Es nuestra clave natural
  de respaldo y la que usan los colegios.
- **Catálogos controlados.** Para nivel/grado, asignatura, género, dependencia y cargo/rol,
  usamos valores cerrados (ver §5). Pueden mandar su propio código siempre que nos den la
  tabla de equivalencia, o adoptar directamente nuestros códigos.
- **Eficiencia (opcional pero deseable):** soportar un parámetro `?modificados_desde=<fecha>`
  y/o un campo `updated_at` por registro, para poder pedir solo lo que cambió en corridas
  futuras. No es bloqueante para empezar: una foto completa mensual nos sirve.

---

## 3. Entidades requeridas

Listadas por prioridad. Cada una correspondería idealmente a un endpoint
(`GET /establecimientos/{id}/<entidad>`), o a secciones de una única respuesta consolidada
(`GET /establecimientos/{id}/snapshot`). Cualquiera de las dos formas nos sirve.

### 3.1 Establecimiento  *(obligatorio)*

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `source_id` | string | ✓ | ID interno Comiuniti, estable |
| `rbd` | string | ✓ | Rol Base de Datos MINEDUC (clave natural del colegio) |
| `nombre` | string | ✓ | Nombre oficial del establecimiento |
| `comuna` | string | ✓ | |
| `region` | string | ✓ | |
| `dependencia` | enum | ○ | Ver §5.4 |

### 3.2 Año académico / período  *(obligatorio)*

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `año` | int | ✓ | Ej. `2026` |
| `vigente` | bool | ✓ | `true` para el año en curso |

> Necesitamos saber a qué año pertenecen los cursos y matrículas. Si Comiuniti maneja
> semestres/períodos, basta con el año.

### 3.3 Cursos  *(obligatorio)*  → nuestra tabla `class_groups`

Un "curso" = una sección concreta de un nivel. Ej.: *3° Básico A*.

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `source_id` | string | ✓ | ID estable del curso |
| `año` | int | ✓ | Año académico del curso |
| `nivel_codigo` | enum | ✓ | Nivel/grado. Ver catálogo §5.1 |
| `letra` | string | ○ | "A", "B"… (si aplica) |
| `nombre` | string | ✓ | Nombre legible: "3°A", "4° Medio B" |
| `profesor_jefe_source_id` | string | ○ | FK al funcionario que es profesor jefe (§3.6) |

### 3.4 Alumnos  *(obligatorio)*  → nuestra tabla `students`

Datos **identitarios** de la persona (no cambian con el curso).

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `source_id` | string | ✓ | ID estable del alumno |
| `rut` | string | ✓ | Con dígito verificador, ej. `21.345.678-9` |
| `nombres` | string | ✓ | |
| `apellido_paterno` | string | ✓ | |
| `apellido_materno` | string | ○ | |
| `fecha_nacimiento` | date | ○ | `YYYY-MM-DD` |
| `genero` | enum | ○ | Ver §5.3 |
| `email` | string | ○ | Si el colegio lo maneja (no se usa en F1, útil a futuro) |

### 3.5 Matrículas  *(obligatorio)*  → nuestra tabla `student_enrollments`

La relación **alumno ↔ curso ↔ año** + su **estado**. Es el corazón de la sincronización
mensual: de acá detectamos altas y bajas.

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `alumno_source_id` | string | ✓ | FK al alumno (§3.4) |
| `curso_source_id` | string | ✓ | FK al curso (§3.3) |
| `año` | int | ✓ | Año académico |
| `estado` | enum | ✓ | `vigente` \| `retirado` \| `trasladado` \| `egresado`. Ver §5.5 |
| `fecha_matricula` | date | ○ | |
| `fecha_retiro` | date | ○ | Obligatoria si `estado` ≠ `vigente` |

> **Clave para la sincronización:** queremos que la respuesta incluya **también los alumnos
> retirados del año en curso** (con `estado = retirado` y `fecha_retiro`), no que simplemente
> desaparezcan de la lista. Así la baja es explícita y no la inferimos por ausencia.

### 3.6 Funcionarios (docentes y directivos)  *(obligatorio)*  → `users` + `org_memberships`

Profesores, jefes de UTP, directores, coordinadores, etc.

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `source_id` | string | ✓ | ID estable del funcionario |
| `rut` | string | ✓ | |
| `nombres` | string | ✓ | |
| `apellido_paterno` | string | ✓ | |
| `apellido_materno` | string | ○ | |
| `email` | string | ✓ | **Crítico.** Es la clave de login SSO (Google/Microsoft). Debe ser el correo institucional real |
| `cargo` | enum/string | ✓ | Cargo/rol. Mapear a §5.2 |
| `vigente` | bool | ✓ | Para dar de baja accesos de quienes ya no trabajan |

> El `email` es nuestra llave de acceso a la plataforma: validar que sea el correo con el que
> el funcionario inicia sesión (Google Workspace / Microsoft 365 del colegio).

### 3.7 Asignaciones docentes  *(deseable)*  → nuestra tabla `teacher_assignments`

Qué profesor hace qué asignatura en qué curso. Nos permite que cada profesor vea solo sus
cursos. Si Comiuniti no maneja el detalle por asignatura, basta con la jefatura de curso
(`profesor_jefe_source_id` en §3.3).

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `funcionario_source_id` | string | ✓ | FK al funcionario (§3.6) |
| `curso_source_id` | string | ✓ | FK al curso (§3.3) |
| `asignatura_codigo` | enum | ✓ | Ver catálogo §5.6 |
| `tipo` | enum | ○ | `titular` \| `co_docente` (default `titular`) |

### 3.8 Apoderados  *(a futuro — incluir si está disponible)*

Aún no los usamos (sirven para notificaciones por correo a futuro), pero si Comiuniti los
tiene, pedirlos desde ya nos evita una segunda integración. Relación **muchos-a-muchos** con
alumnos: por eso va como entidad propia + tabla de vínculo.

**Apoderado (persona):**

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `source_id` | string | ✓ | ID estable del apoderado |
| `rut` | string | ○ | |
| `nombres` | string | ✓ | |
| `apellido_paterno` | string | ✓ | |
| `apellido_materno` | string | ○ | |
| `email` | string | ✓ | Canal de notificación |
| `telefono` | string | ○ | Formato E.164 si es posible (`+569…`) |

**Vínculo apoderado ↔ alumno:**

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `apoderado_source_id` | string | ✓ | FK apoderado |
| `alumno_source_id` | string | ✓ | FK alumno |
| `parentesco` | string | ○ | "madre", "padre", "abuela"… |
| `es_principal` | bool | ○ | Apoderado titular vs. suplente |

---

## 4. Ejemplo de respuesta (snapshot consolidado)

```json
{
  "establecimiento": {
    "source_id": "COM-COL-00123",
    "rbd": "12345",
    "nombre": "Colegio San José",
    "comuna": "Providencia",
    "region": "Metropolitana",
    "dependencia": "particular_subvencionado"
  },
  "años_academicos": [
    { "año": 2026, "vigente": true }
  ],
  "cursos": [
    {
      "source_id": "COM-CUR-7781",
      "año": 2026,
      "nivel_codigo": "3RD_BASIC",
      "letra": "A",
      "nombre": "3°A",
      "profesor_jefe_source_id": "COM-FUN-5501"
    }
  ],
  "alumnos": [
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
  "matriculas": [
    {
      "alumno_source_id": "COM-ALU-99001",
      "curso_source_id": "COM-CUR-7781",
      "año": 2026,
      "estado": "vigente",
      "fecha_matricula": "2026-03-01",
      "fecha_retiro": null
    }
  ],
  "funcionarios": [
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
  ],
  "asignaciones_docentes": [
    {
      "funcionario_source_id": "COM-FUN-5501",
      "curso_source_id": "COM-CUR-7781",
      "asignatura_codigo": "LANG",
      "tipo": "titular"
    }
  ],
  "apoderados": [
    {
      "source_id": "COM-APO-3120",
      "rut": "18.777.888-K",
      "nombres": "Andrea",
      "apellido_paterno": "Rojas",
      "apellido_materno": "Lillo",
      "email": "andrea.rojas@gmail.com",
      "telefono": "+56998765432"
    }
  ],
  "apoderados_alumnos": [
    {
      "apoderado_source_id": "COM-APO-3120",
      "alumno_source_id": "COM-ALU-99001",
      "parentesco": "madre",
      "es_principal": true
    }
  ]
}
```

---

## 5. Catálogos controlados (valores permitidos)

### 5.1 `nivel_codigo` (nivel/grado)

| Código | Nivel |
|---|---|
| `1RD_BASIC` … `8TH_BASIC` | 1° a 8° Básico |
| `1ST_MEDIO` … `4TH_MEDIO` | 1° a 4° Medio |

(`1RD_BASIC`, `2ND_BASIC`, `3RD_BASIC`, `4TH_BASIC`, `5TH_BASIC`, `6TH_BASIC`, `7TH_BASIC`,
`8TH_BASIC`, `1ST_MEDIO`, `2ND_MEDIO`, `3RD_MEDIO`, `4TH_MEDIO`.) Si prefieren mandar
"3° Básico" en texto, lo aceptamos con una tabla de equivalencia.

### 5.2 `cargo` → rol en la plataforma

Mapeo sugerido. Si Comiuniti usa otros nombres de cargo, nos basta la equivalencia.

| Cargo Comiuniti (ejemplo) | Rol plataforma |
|---|---|
| Director/a | `school_admin` |
| Jefe/a UTP, Director/a Académico | `academic_director` |
| Coordinador/a de ciclo | `cycle_director` |
| Jefe/a de departamento | `dept_head` |
| Coordinador/a de evaluación | `eval_coordinator` |
| Profesor/a jefe | `homeroom_teacher` |
| Profesor/a de asignatura | `teacher` |

### 5.3 `genero`

`M` | `F` | `X` | `unspecified` (o vacío → lo tomamos como `unspecified`).

### 5.4 `dependencia`

`municipal` | `particular_pagado` | `particular_subvencionado` | `delegada`.

### 5.5 `estado` (matrícula)

`vigente` | `retirado` | `trasladado` | `egresado`.

### 5.6 `asignatura_codigo`

| Código | Asignatura |
|---|---|
| `LANG` | Lenguaje y Comunicación |
| `MATH` | Matemáticas |
| `SCI` | Ciencias Naturales |
| `HIST` | Historia, Geografía y Cs. Sociales |
| `ENG` | Inglés |

> Para el arranque (DIA) solo necesitamos `LANG` y `MATH`, pero la estructura debería
> soportar todas.

---

## 6. Resumen de lo mínimo para arrancar

Si hay que priorizar, el set **mínimo viable** para la primera integración es:

1. Establecimiento (§3.1)
2. Año académico vigente (§3.2)
3. Cursos (§3.3)
4. Alumnos (§3.4)
5. Matrículas con estado (§3.5)
6. Funcionarios con email y cargo (§3.6)

Lo **deseable** (mejora la experiencia, no bloquea): asignaciones docentes (§3.7).
Lo **a futuro** (pedir si ya existe): apoderados (§3.8).

**Lo no negociable en cualquier caso:** `source_id` estable en cada registro, RUT en las
personas, email institucional en los funcionarios, y `estado` explícito en las matrículas.
