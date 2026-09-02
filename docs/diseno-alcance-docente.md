# Diseño — Alcance de datos por docente

> Estado: propuesta. Define qué datos ve cada rol del cuerpo docente y cómo se
> resuelve ese alcance en el backend. Reemplaza la regla implícita actual
> ("profesor ve sus cursos completos") por un modelo de pares curso × asignatura
> con una excepción explícita para la jefatura de curso.

---

## 1. Problema

La plataforma ya distingue entre un directivo (ve toda la organización) y un
profesor (ve solo lo suyo), pero "lo suyo" está mal definido en la
implementación:

1. **El alcance ignora la asignatura.** `resolveClassGroupScope`
   (`apps/api/src/common/helpers/class-group-scope.helper.ts:52`) recorre
   `teacher_assignments → subject_classes → class_groups` y proyecta únicamente
   `classGroupId`, descartando `subject_id`. El profesor de Matemática de 2°A ve
   hoy los resultados de Lenguaje, Ciencias e Historia del mismo curso.
2. **La jefatura de curso no existe como concepto de alcance.** El rol
   `homeroom_teacher` se comporta igual que `teacher`, pese a que su necesidad
   es la opuesta: mirada transversal de un curso.
3. **Dos módulos no aplican alcance alguno.** `ai-analysis` y `remedial`
   admiten el rol `teacher` y filtran solo por `org_id`.
4. **El alcance se calcula por unión de roles.** Un usuario `teacher` +
   `dept_head` obtiene `scopeAll = true` aunque su rol activo sea profesor, con
   lo que el selector de rol no cambia lo que ve.
5. **No hay datos.** No existe seed de `teacher_assignments`; en la demo CSCJ no
   hay ninguna asignación docente cargada, así que todo profesor ve
   "Sin cursos asignados".

Este documento resuelve 1, 2 y 4; el punto 3 es una corrección puntual y el 5 se
cubre con un importador. El plan de ejecución vive en
[`plan-alcance-docente.md`](./plan-alcance-docente.md).

---

## 2. Modelo de datos existente

No requiere migración. La cadena ya soporta la granularidad necesaria:

```
users
  └── teacher_assignments        (user_id, subject_class_id, role)
        └── subject_classes      (class_group_id, subject_id, academic_year_id)
              ├── subjects       (code: LANG | MATH | SCI | HIST | ENG)
              └── class_groups   (org_id, grade_id, academic_year_id, name)
                    └── grades
```

La unidad de asignación es `subject_classes`, es decir el trío
**(curso, asignatura, año)**. Un profesor que dicta dos asignaturas en un curso
tiene dos filas en `teacher_assignments`.

**Cómo se ata una evaluación a curso y asignatura.** `assessments` no tiene
`class_group_id` ni `subject_id`; el par se reconstruye cruzando dos ramas:

- **Curso:** `assessments.id → assessment_course_assignments.class_group_id`
  (tabla puente; una evaluación puede cubrir varios cursos).
- **Asignatura:** `assessments.instrument_id → instruments.subject_id`.

Esto es determinante para el diseño: el filtro por asignatura no es una columna
más en el `WHERE`, exige cruzar ambas ramas. Se encapsula una sola vez en el
helper de alcance y ningún servicio lo reimplementa.

---

## 3. Regla de alcance

El alcance de un usuario deja de ser un conjunto de `classGroupId` y pasa a ser
un conjunto de **pares `(classGroupId, subjectId)`**, más un conjunto aparte de
cursos de jefatura.

| Rol                                                                                                                                         | Alcance de datos                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `platform_admin` y roles directivos (`school_admin`, `academic_director`, `cycle_director`, `dept_head`, `coordinator`, `eval_coordinator`) | Toda la organización (`scopeAll`)                                                                                            |
| `teacher`                                                                                                                                   | Solo los pares (curso, asignatura) de sus `teacher_assignments`                                                              |
| `homeroom_teacher`                                                                                                                          | **Todos los datos de los cursos donde es jefe**, en todas las asignaturas, más sus propios pares como profesor de asignatura |

### 3.1 Por qué la jefatura ve el curso completo

Es una decisión de producto, no una concesión técnica:

- El profesor jefe responde por el curso como unidad. Su pregunta es "¿cómo va
  7°A?", no "¿cómo va 7°A en Matemática?".
- Las vistas centradas en el alumno (vista 360, panorama del estudiante, señales)
  pierden sentido recortadas a una asignatura: mostrar solo la mitad del perfil
  de un alumno a quien debe orientarlo es peor que no mostrar nada.
- Es la práctica del colegio: la jefatura ya concentra la conversación con
  apoderados y el consejo de curso.

El acceso del jefe de curso es **transversal en asignaturas pero acotado a sus
cursos**: sigue sin ver otros cursos de la organización.

### 3.2 Composición de roles

Un usuario acumula alcance por unión de sus asignaciones, nunca por sustitución.
Quien es jefe de 7°A y además profesor de Matemática de 8°B ve: 7°A completo, y
de 8°B solo Matemática.

### 3.3 Rol activo frente a unión de roles

Se separan dos preguntas que hoy están mezcladas:

- **¿Puede entrar a este endpoint?** → `RolesGuard`, por **unión** de
  `user.roles`. Se mantiene tal cual: un usuario no pierde el acceso a una
  pantalla por tener otro rol activo.
- **¿Qué filas ve?** → alcance, calculado desde **`activeRole`**.

Con esto el selector de rol pasa a significar algo: un usuario
`teacher` + `dept_head` con rol activo `teacher` ve sus cursos; cambia a
`dept_head` y ve la organización. Hoy la vista "Mis cursos"
(`class-groups.service.ts:38`) ya decide por `activeRole` y era la única
excepción documentada; con este cambio deja de ser una excepción y pasa a ser la
regla general.

Caso a cuidar: un rol directivo puro no tiene `teacher_assignments`. Con rol
activo directivo mantiene `scopeAll = true`; el comportamiento solo cambia para
usuarios con roles mixtos.

---

## 4. Contrato del helper de alcance

Punto único de verdad, en `apps/api/src/common/helpers/class-group-scope.helper.ts`.
Hoy existen cuatro copias privadas de la misma función (`assessment-results`,
`item-analysis`, `assessment-report`, `report-support`) que deben eliminarse
antes de cambiar la semántica: modificar la regla en cinco lugares es la forma
más probable de introducir una fuga.

```ts
type TeacherScope =
  | { scopeAll: true }
  | {
      scopeAll: false;
      /** Pares (curso, asignatura) donde el usuario dicta. */
      pairs: Array<{ classGroupId: string; subjectId: string }>;
      /** Cursos donde el usuario es profesor jefe: acceso transversal. */
      homeroomClassGroupIds: string[];
      /** Unión de ambos. Para queries que aún no distinguen asignatura. */
      classGroupIds: string[];
    };
```

Predicados derivados, también en el helper:

- `isAssessmentInScope(scope, assessment)` — verdadero si algún curso de
  `assessment_course_assignments` está en `homeroomClassGroupIds`, o si existe un
  par que combine uno de esos cursos con `instruments.subject_id`.
- `isStudentVisibleInScope(scope, student)` — el alumno está matriculado en un
  curso del alcance. Se conserva la semántica actual: la visibilidad de la
  **persona** es por curso, no por asignatura. Un profesor de Matemática de 2°A
  puede ver que Pedro existe y es su alumno; lo que no ve son sus resultados de
  Lenguaje.

`classGroupIds` se mantiene por compatibilidad durante la migración de los
servicios, pero es un alcance más amplio que el real: todo servicio que siga
usándolo queda marcado como pendiente.

---

## 5. Superficies afectadas

**Con alcance por curso hoy, migran a alcance por asignatura:**
`assessment-results`, `item-analysis`, `dashboards`, `heatmap`, `master-board`,
`comparable-trajectory`, `official-reports` (curso y alumno), `assessment-report`
y los tools MCP que delegan en ellos.

**Centradas en el alumno, aplican la regla de jefatura:**
`student-panorama`, `student-comparisons`, `student-signals`. Para
`homeroom_teacher` son transversales; para `teacher` se recortan a sus
asignaturas.

**Sin alcance hoy, deben incorporarlo:** `ai-analysis` (`:242` get, `:206`
lookup por caché, `instrument-comparison`) y `remedial` (`:187` get, `:216`
list, `:108` generate — este último acepta un `classGroupId` del DTO sin
validarlo contra el alcance).

**Quedan org-wide a propósito:** banco de ítems e instrumentos (contenido, no
datos de alumnos), documentos (tienen su propio modelo de visibilidad), perfil de
organización, y las líneas de referencia de nivel/colegio dentro de vistas ya
acotadas (`item-analysis.service.ts:329, 524, 951`), que son agregados sin datos
personales.

---

## 6. Alcance de asignaturas para la carga inicial

El catálogo `subjects` tiene cinco códigos: `LANG`, `MATH`, `SCI`, `HIST`,
`ENG`. La planta docente del colegio maneja unas 30 etiquetas de asignatura.

**Decisión: no se amplía el catálogo.** Solo se importan las asignaturas con
evaluaciones en la plataforma; el resto de la planta (Arte, Música, Ed. Física,
Religión, Orientación, Tecnología, Filosofía, electivos no troncales) no genera
`teacher_assignments`.

Agrupaciones aplicadas al mapear:

| Código | Etiquetas de la planta                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LANG` | Lenguaje, Taller de Literatura, SIMCE LEN, Lectura y Escritura Especializada, Escritura y Oralidad, Participación y Argumentación en Democracia                                       |
| `MATH` | Matemáticas, SIMCE MAT, Límites y Derivadas, Probabilidades y Estadísticas                                                                                                            |
| `SCI`  | Ciencias, Biología, Química, Física, Ciencias para la Ciudadanía, Taller de Ciencias, Biología Celular y Molecular, Biología de los Ecosistemas, PAES Ciencias                        |
| `HIST` | Historia, Taller de Historia, PAES Historia, Educación Ciudadana, Comprensión Histórica del Presente, Economía y Sociedad, Geografía y Desafíos Socio-ambientales, Filosofía Política |
| `ENG`  | Inglés                                                                                                                                                                                |

Sobre la planta 2026 del colegio esto cubre **243 de 453 filas** de docencia y
**47 de 65 docentes**. Los 18 restantes existen como usuarios, pero sin datos que
mostrar.

Seis profesores jefes quedan sin asignatura evaluada: Pre-Kínder A/B, Kínder A/B
(no hay evaluaciones en ese ciclo), 7°A y IV°B. **La regla de jefatura los
cubre igual**: el acceso del jefe de curso se deriva del rol
`homeroom_teacher` sobre el curso, no de tener `subject_classes` propios.

---

## 7. Riesgos

| Riesgo                                                                                                                                     | Mitigación                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El alcance vive solo en la capa de aplicación: no hay RLS por profesor, así que un endpoint nuevo que olvide el helper filtra solo por org | Punto único de verdad + tests de aislamiento por servicio. RLS por docente queda documentada como extensión futura (exige propagar `user_id` al contexto de sesión, como `app.current_org_id`) |
| Cuatro copias del helper divergen                                                                                                          | Consolidar **antes** de cambiar la semántica                                                                                                                                                   |
| Restringir por asignatura oculta datos que un docente hoy usa                                                                              | La regla de jefatura preserva la mirada transversal donde importa; el resto es corrección de una fuga, no pérdida de función                                                                   |
| Correos personales en la planta docente                                                                                                    | La carga inicial admite `org_memberships` con `user_id NULL` (invitación pendiente); conviene migrar a correos institucionales antes de invitar                                                |
| Cursos con dos profesores jefes (1°A y 1°B en la planta 2026)                                                                              | El modelo lo admite: dos memberships `homeroom_teacher` sobre el mismo curso                                                                                                                   |

---

## 8. Criterios de aceptación

1. Un `teacher` de Matemática de 2°A no obtiene datos de Lenguaje de 2°A por
   ninguna vía: dashboards, resultados, análisis de ítems, heatmap, tablero
   maestro, informes, análisis IA, material remedial ni tools MCP.
2. Un `homeroom_teacher` de 7°A obtiene todas las asignaturas de 7°A y ningún
   dato de otro curso.
3. Un usuario `teacher` + `dept_head` con rol activo `teacher` ve solo su
   alcance docente; al cambiar a `dept_head` ve la organización.
4. `ai-analysis` y `remedial` rechazan un `classGroupId` fuera del alcance.
5. La planta docente del colegio queda cargada y "Mis cursos" muestra los cursos
   y asignaturas correctos para los 47 docentes mapeados.
