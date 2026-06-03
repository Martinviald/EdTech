# Diseño de Base de Datos — EdTech Platform

> **Stack:** PostgreSQL · Drizzle ORM · Next.js serverless
> **Versión:** 1.0 — Mayo 2026
> **Principio rector:** flexibilidad y extensibilidad sobre performance prematura.

---

## Principios de diseño

| #   | Principio                                               | Consecuencia práctica                                                                                                                                      |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Multi-tenant desde el inicio**                        | `org_id` en todo lo sensible. Row-level isolation por colegio.                                                                                             |
| 2   | **Taxonomía Universal desacoplada**                     | OAs, habilidades y contenidos viven en `taxonomy_nodes` (árbol polimórfico). DIA, SIMCE, PAES y Cambridge comparten la misma tabla.                        |
| 3   | **Ítems polimórficos**                                  | Un ítem es un ítem. `type` + `content JSONB` determinan si es alternativa, desarrollo, lectura oral, redacción o listening. Sin tablas separadas por tipo. |
| 4   | **JSONB para lo variable, columnas para lo invariable** | Lo que siempre tiene los mismos campos → columnas. Lo que varía por tipo (contenido de pregunta, configuración de escala, parámetros IRT) → JSONB.         |
| 5   | **Soft deletes en datos de alumnos**                    | `deleted_at` en lugar de `DELETE`. Datos de evaluación son legalmente sensibles.                                                                           |
| 6   | **UUIDs como PKs**                                      | Evita enumeración, facilita merges multi-tenant y exportaciones parciales.                                                                                 |
| 7   | **Versionado de ítems**                                 | `item_versions` guarda el historial completo. Los análisis longitudinales requieren saber exactamente qué se preguntó en cada año.                         |

---

## Mapa de dominios

```
┌─────────────────────────────────────────────────────────────────────┐
│  MULTI-TENANCY          ESTRUCTURA ACADÉMICA         USUARIOS       │
│  organizations          grades                        users          │
│  academic_years         class_groups                  org_memberships│
│                         subjects                                     │
│                         subject_classes                              │
│                         teacher_assignments                          │
├─────────────────────────────────────────────────────────────────────┤
│  ALUMNOS                TAXONOMÍA UNIVERSAL                         │
│  students               taxonomies                                    │
│  student_enrollments    taxonomy_nodes  ◄── árbol polimórfico       │
│                         taxonomy_mappings (cross-curriculum)         │
├─────────────────────────────────────────────────────────────────────┤
│  INSTRUMENTOS           BANCO DE ÍTEMS                              │
│  instruments            items  ◄── polimórfico por `type`          │
│  instrument_sections    item_taxonomy_tags                           │
│  grading_scales         item_versions                                │
│                         rubrics / rubric_criteria / rubric_levels   │
│                         (opciones MC embebidas en items.content)    │
├─────────────────────────────────────────────────────────────────────┤
│  APLICACIÓN             RESPUESTAS                  RESULTADOS      │
│  assessments            responses                   assessment_results│
│  assessment_course_assignments  ai_grading_jobs     skill_results   │
│  assessment_forms                                   (action_plans F4)│
│  import_jobs                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Esquema detallado por dominio

---

### 1. Multi-tenancy

#### Tablas con RLS y `withOrgContext`

El aislamiento por colegio se enforce con **Row Level Security (RLS)** de PostgreSQL en 6 tablas:

- **Con `org_id` directo:** `students`, `assessments`, `import_jobs`.
- **Sin `org_id` propio** (heredan el tenant vía `EXISTS` sobre `assessments`): `responses`, `assessment_results`, `skill_results`.

Las políticas (`*_tenant_isolation`, `ENABLE` + `FORCE ROW LEVEL SECURITY`) **no** viven en el schema Drizzle: están en **`packages/db/sql/rls-policies.sql`** y se re-aplican de forma idempotente en cada `db:migrate` (sobreviven a regeneraciones). Toda query de la API a estas tablas **debe** correr dentro de `withOrgContext(db, orgId, tx => ...)`, que fija `app.current_org_id`; sin contexto, RLS devuelve 0 filas. Detalle completo en **`packages/db/README.md`**.

#### `organizations`

Nodo raíz del tenant. La plataforma, fundaciones y colegios son todos `Organization`.

```
id              uuid        PK
type            enum        'platform' | 'foundation' | 'school'
parent_id       uuid        FK → organizations.id (escuela → fundación)
name            text        NOT NULL
rbd             text        Solo colegios (Rol Base de Datos MINEDUC)
config          jsonb       Configuración per-tenant (escalas default, logo, etc.)
deleted_at      timestamp
created_at      timestamp   NOT NULL DEFAULT now()
updated_at      timestamp   NOT NULL DEFAULT now()
```

**Notas:**

- Un colegio sin fundación tiene `parent_id = NULL`.
- La jerarquía máxima es: `platform → foundation → school`.
- `config` JSONB incluye: `defaultGradingScale`, `branding`, `timezone`, `allowedFeatures`.

#### `academic_years`

Año escolar por organización.

```
id              uuid        PK
org_id          uuid        FK → organizations.id
year            integer     e.g. 2026
start_date      date
end_date        date
is_current      boolean     DEFAULT false
```

---

### 2. Estructura académica

#### `grades`

Niveles educativos (1° básico ... 4° medio). Tabla global de la plataforma, no por colegio.

```
id              uuid        PK
name            text        e.g. "3° Básico"
short_name      text        e.g. "3B"
code            text        UNIQUE  e.g. "3RD_BASIC"
cycle           integer     1 = 1er ciclo, 2 = 2do ciclo, 3 = 3er ciclo (EM)
order           integer     1..12 (para ordenar)
```

#### `class_groups`

Cursos concretos (1°A año 2026 en Colegio X).

```
id              uuid        PK
org_id          uuid        FK → organizations.id
academic_year_id uuid       FK → academic_years.id
grade_id        uuid        FK → grades.id
name            text        e.g. "1°A", "3°B"
```

#### `subjects`

Asignaturas. Global de la plataforma.

```
id              uuid        PK
name            text        e.g. "Lenguaje y Comunicación"
short_name      text        e.g. "Lenguaje"
code            text        UNIQUE  e.g. "LANG", "MATH", "ENG"
mineduc_code    text        Código oficial MINEDUC si existe
```

#### `subject_classes`

Una asignatura siendo dictada en un curso específico.

```
id              uuid        PK
class_group_id  uuid        FK → class_groups.id
subject_id      uuid        FK → subjects.id
academic_year_id uuid       FK → academic_years.id

UNIQUE(class_group_id, subject_id, academic_year_id)
```

#### `teacher_assignments`

Qué profesor dicta qué asignatura en qué curso.

```
id              uuid        PK
user_id         uuid        FK → users.id
subject_class_id uuid       FK → subject_classes.id
role            enum        'primary' | 'secondary'

UNIQUE(user_id, subject_class_id)
```

---

### 3. Usuarios y roles

#### `users`

Autenticación via SSO (Google / Microsoft). Sin contraseña propia.

```
id              uuid        PK
email           text        UNIQUE NOT NULL
name            text        NOT NULL
avatar_url      text
provider        enum        'google' | 'microsoft'
provider_id     text        External SSO ID
last_login_at   timestamp
created_at      timestamp   NOT NULL DEFAULT now()
deleted_at      timestamp
```

#### `org_memberships`

Un usuario puede tener roles distintos en distintas organizaciones, y también
**múltiples roles dentro de la misma organización**. El UNIQUE compuesto es
sobre `(user_id, org_id, role)` — no sobre `(user_id, org_id)`.

```
id              uuid        PK
user_id         uuid        FK → users.id (nullable para invitaciones pendientes)
org_id          uuid        FK → organizations.id
role            enum        'platform_admin' | 'foundation_director' | 'school_admin'
                            | 'academic_director' | 'cycle_director' | 'dept_head'
                            | 'coordinator' | 'teacher' | 'homeroom_teacher'
                            | 'eval_coordinator' | 'guardian'
scope           jsonb       Restricciones adicionales: qué cursos/asignaturas ve
is_active       boolean     DEFAULT true
email           text        Solo presente cuando user_id IS NULL (invitación pendiente)
invited_by_user_id  uuid    FK → users.id
invited_at      timestamp
created_at      timestamp   NOT NULL DEFAULT now()

UNIQUE(user_id, org_id, role)
```

**Multi-rol y sesión:** al hacer login, `listActiveMembershipsByEmail` recupera
todos los memberships activos del usuario en su org. El JWT se puebla con:
- `roles: UserRole[]` — array de todos los roles del usuario.
- `activeRole: UserRole` — el elegido (default = mayor jerarquía según `ROLE_HIERARCHY`).
- Los guards autorizan por **unión** de `roles[]` (si alguno califica, pasa).
- `POST /auth/switch-role` permite cambiar `activeRole` sin re-login.

**Notas sobre `scope` JSONB:**

```json
{
  "gradeIds": ["uuid-1", "uuid-2"],
  "subjectIds": ["uuid-3"],
  "classGroupIds": ["uuid-4", "uuid-5"]
}
```

Un `NULL` en cualquier campo significa "todos". Cada membership tiene su propio
scope, lo que permite asignar visibilidades distintas por rol.

---

### 4. Alumnos

#### `students`

Perfil del alumno. Separado de `users` porque no todos los alumnos tienen cuenta (básica sin digital).

```
id              uuid        PK
org_id          uuid        FK → organizations.id
user_id         uuid        FK → users.id  NULLABLE (si tiene acceso digital)
rut             text        NOT NULL  (formato: 12345678-9)
first_name      text        NOT NULL
last_name       text        NOT NULL
birth_date      date
gender          enum        'M' | 'F' | 'X' | 'unspecified'
profile         jsonb       Datos sensibles: contexto familiar, NEE, observaciones
deleted_at      timestamp

INDEX(org_id)
INDEX(rut)
```

**Notas sobre `profile` JSONB:**

```json
{
  "nee": ["dislexia"],
  "careerInterest": "Ingeniería",
  "targetUniversity": "PUC",
  "sensitiveNotes": "..." // Solo accesible por roles autorizados
}
```

#### `student_enrollments`

Matrícula por curso y año. Un alumno puede cambiar de colegio, repetir año, etc.

```
id              uuid        PK
student_id      uuid        FK → students.id
class_group_id  uuid        FK → class_groups.id
academic_year_id uuid       FK → academic_years.id
status          enum        'active' | 'transferred' | 'graduated' | 'withdrawn'
enrolled_at     date
withdrawn_at    date        NULLABLE

UNIQUE(student_id, academic_year_id)  -- un alumno, un curso por año
```

---

### 5. Taxonomía Universal ← PIEZA CENTRAL

Diseñada para soportar en la misma estructura:

- **MINEDUC**: OAs por asignatura, nivel y eje (Lectura, Escritura, Comunicación Oral)
- **DIA**: Habilidades específicas de Diagnóstico Integral de Aprendizajes
- **SIMCE**: Dominios y niveles de desempeño
- **PAES**: Competencias (Lectora, M1, M2, Ciencias, Historia)
- **Cambridge**: Papers, skills y criterios (Reading, Writing, Listening, Speaking)
- **Custom**: Cualquier taxonomía que defina la plataforma o el colegio

#### `taxonomies`

El "sistema de clasificación" raíz.

```
id              uuid        PK
name            text        e.g. "MINEDUC 2024", "Cambridge FCE", "PAES 2025"
type            enum        'mineduc' | 'simce' | 'paes' | 'dia' | 'cambridge'
                            | 'aptus' | 'desafio' | 'custom'
language        text        DEFAULT 'es'
version         text        e.g. "2024"
is_official     boolean     DEFAULT false  (true = administrado por plataforma)
org_id          uuid        FK → organizations.id  NULLABLE (NULL = plataforma global)
metadata        jsonb       Info adicional del curriculum
```

#### `taxonomy_nodes`

Árbol jerárquico y polimórfico. Un nodo puede ser dominio, subdominio, OA, habilidad, contenido, tipo de texto, nivel de desempeño, etc.

```
id              uuid        PK
taxonomy_id   uuid        FK → taxonomies.id
parent_id       uuid        FK → taxonomy_nodes.id  NULLABLE (nodos raíz)
type            enum        'domain' | 'subdomain' | 'axis' | 'learning_objective'
                            | 'skill' | 'content' | 'text_type' | 'performance_level'
                            | 'descriptor' | 'criterion' | 'paper'
code            text        e.g. "OA1", "LC-HAB-01", "B2", "FCE-W-CONTENT"
name            text        NOT NULL
description     text
grade_id        uuid        FK → grades.id  NULLABLE (algunos nodos son cross-grade)
subject_id      uuid        FK → subjects.id  NULLABLE
order           integer
depth           integer     Calculado: 0=raíz, 1=dominio, 2=subdominio...
metadata        jsonb       Datos tipo-específicos

INDEX(taxonomy_id)
INDEX(parent_id)
INDEX(taxonomy_id, grade_id, subject_id)
```

**Ejemplos de árbol MINEDUC Lenguaje 3° básico:**

```
[domain]      Lenguaje y Comunicación
  [axis]      Lectura
    [OA]      OA1: Leer textos que combinen palabras con pictogramas...
      [desc]  Localiza información explícita
      [desc]  Infiere el significado de palabras
    [OA]      OA2: Leer habitualmente y de manera independiente...
  [axis]      Escritura
    [OA]      OA11: Escribir frecuentemente...
  [text_type] Texto narrativo
  [text_type] Texto informativo
```

**Ejemplos de árbol Cambridge FCE:**

```
[paper]       Reading and Use of English
  [skill]     Vocabulary
  [skill]     Grammar
[paper]       Writing
  [criterion] Content
  [criterion] Communicative Achievement
  [criterion] Organisation
  [criterion] Language
[paper]       Listening
[paper]       Speaking
  [criterion] Grammar and Vocabulary
  [criterion] Discourse Management
  [criterion] Pronunciation
  [criterion] Interactive Communication
```

#### `taxonomy_mappings`

Equivalencias entre nodos de distintos taxonomies. Permite cruzar SIMCE con MINEDUC.

```
id              uuid        PK
source_node_id  uuid        FK → taxonomy_nodes.id
target_node_id  uuid        FK → taxonomy_nodes.id
mapping_type    enum        'equivalent' | 'subset' | 'related'
confidence      decimal     0.0 - 1.0
notes           text

UNIQUE(source_node_id, target_node_id)
```

---

### 6. Instrumentos

#### `instruments`

La definición de una prueba (no una aplicación específica).

```
id              uuid        PK
org_id          uuid        FK → organizations.id  NULLABLE (NULL = plataforma global)
taxonomy_id   uuid        FK → taxonomies.id
name            text        e.g. "DIA Lectura 1° Básico 2025"
short_name      text
type            enum        'dia' | 'simce' | 'paes' | 'cambridge_mock' | 'aptus'
                            | 'desafio' | 'pal' | 'custom'
subject_id      uuid        FK → subjects.id  NULLABLE
grade_id        uuid        FK → grades.id  NULLABLE
year            integer
version         text        e.g. "v1", "Form A"
is_official     boolean     DEFAULT false
status          enum        'draft' | 'published' | 'archived'
grading_scale_id uuid       FK → grading_scales.id  NULLABLE
config          jsonb       Configuración específica del instrumento
created_by_id   uuid        FK → users.id
deleted_at      timestamp
created_at      timestamp   NOT NULL DEFAULT now()
```

**`config` JSONB incluye:**

```json
{
  "totalPoints": 45,
  "sections": 3,
  "timeLimit": 90,
  "allowMultipleForms": true,
  "officialSource": "agencia_calidad",
  "officialYear": 2025
}
```

#### `instrument_sections`

Secciones de un instrumento (ej: Sección A, Sección Lectora, Writing Task 1).

```
id              uuid        PK
instrument_id   uuid        FK → instruments.id
name            text        e.g. "Comprensión Lectora", "Writing Task 1"
type            enum        'multiple_choice' | 'open_ended' | 'oral_reading'
                            | 'oral_expression' | 'writing' | 'listening'
                            | 'matching' | 'mixed'
order           integer
max_points      decimal
time_limit_min  integer     NULLABLE
instructions    text
config          jsonb       Configuración específica de sección
```

#### `grading_scales`

Escalas de conversión puntaje → nota. Configurable por colegio.

```
id              uuid        PK
org_id          uuid        FK → organizations.id  NULLABLE (NULL = default plataforma)
name            text        e.g. "Escala Chilena Estándar"
type            enum        'linear_chilean' | 'percentage' | 'paes_scaled'
                            | 'irt_based' | 'custom'
min_grade       decimal     DEFAULT 1.0
max_grade       decimal     DEFAULT 7.0
passing_grade   decimal     DEFAULT 4.0
passing_threshold decimal   DEFAULT 0.60  (60% de exigencia)
config          jsonb       Para escalas no lineales (PAES 100-1000, etc.)
```

**`config` para escala PAES:**

```json
{
  "minScore": 100,
  "maxScore": 1000,
  "conversionTable": [
    { "rawPoints": 0, "scaledScore": 100 },
    { "rawPoints": 15, "scaledScore": 250 },
    { "rawPoints": 65, "scaledScore": 1000 }
  ]
}
```

---

### 7. Banco de Ítems

#### `items`

Entidad central polimórfica. El `type` determina el schema del `content` JSONB.

```
id              uuid        PK
org_id          uuid        FK → organizations.id  NULLABLE (NULL = banco global)
instrument_id   uuid        FK → instruments.id  NULLABLE (puede ser standalone)
section_id      uuid        FK → instrument_sections.id  NULLABLE
position        integer     Orden dentro de la sección
type            enum        'multiple_choice' | 'true_false' | 'open_ended'
                            | 'oral_reading' | 'oral_expression' | 'writing'
                            | 'listening' | 'matching' | 'ordering' | 'gap_fill'
content         jsonb       Contenido del ítem (varía por tipo, ver abajo)
scoring_config  jsonb       Puntuación: points, partial_credit, etc.
irt_params      jsonb       {a: discrimination, b: difficulty, c: guessing} IRT 2PL/3PL
status          enum        'draft' | 'review' | 'published' | 'deprecated'
version         integer     DEFAULT 1
source          enum        'official' | 'ai_generated' | 'custom' | 'imported'
created_by_id   uuid        FK → users.id
deleted_at      timestamp
created_at      timestamp   NOT NULL DEFAULT now()

INDEX(org_id)
INDEX(instrument_id)
INDEX(section_id, position)
INDEX(type, status)
```

**Ejemplos de `content` JSONB por tipo:**

`multiple_choice`:

```json
{
  "stem": "¿Cuál es la idea principal del texto?",
  "imageUrl": null,
  "options": [
    { "label": "A", "text": "Los animales migran...", "isCorrect": false },
    { "label": "B", "text": "El agua es fundamental...", "isCorrect": true },
    { "label": "C", "text": "Los bosques se talan...", "isCorrect": false },
    { "label": "D", "text": "Los ríos nacen...", "isCorrect": false }
  ],
  "correctLabel": "B",
  "distractorNotes": {
    "A": "Confunde tema secundario con idea principal",
    "C": "Relacionado pero no es la idea central"
  }
}
```

`oral_reading`:

```json
{
  "textToRead": "El sol salió...",
  "wordCount": 120,
  "expectedWordsPerMinute": 90,
  "evaluationDimensions": ["fluency", "speed", "errors", "intonation"]
}
```

`open_ended`:

```json
{
  "stem": "Explica con tus palabras por qué...",
  "imageUrl": null,
  "maxWords": 200,
  "rubricId": "uuid-rubric"
}
```

`writing`:

```json
{
  "prompt": "Escribe un texto narrativo sobre...",
  "textType": "narrative",
  "minWords": 150,
  "maxWords": 300,
  "rubricId": "uuid-rubric"
}
```

`listening` (Cambridge):

```json
{
  "audioUrl": "s3://bucket/audio/fce-part1.mp3",
  "audioDurationSec": 180,
  "transcript": "...",
  "playCount": 2,
  "subType": "multiple_choice"
}
```

#### `item_taxonomy_tags`

Etiquetado de ítems con nodos de la taxonomía (OA, habilidad, contenido, tipo de texto).

```
id              uuid        PK
item_id         uuid        FK → items.id
node_id         uuid        FK → taxonomy_nodes.id
tag_type        enum        'primary' | 'secondary'
confidence      decimal     0.0 - 1.0 (1.0 = humano, <1.0 = sugerido por IA)
tagged_by       enum        'human' | 'ai'
tagged_at       timestamp   NOT NULL DEFAULT now()

UNIQUE(item_id, node_id)
INDEX(node_id)
```

#### `item_versions`

Historial completo de cambios en ítems. Esencial para análisis longitudinal.

```
id              uuid        PK
item_id         uuid        FK → items.id
version         integer     NOT NULL
content         jsonb       Snapshot del content en esta versión
irt_params      jsonb       Snapshot de parámetros IRT
changed_by_id   uuid        FK → users.id
change_note     text
created_at      timestamp   NOT NULL DEFAULT now()

UNIQUE(item_id, version)
```

#### `rubrics`

Rúbricas para corrección de ítems de desarrollo, escritura y oralidad.

```
id              uuid        PK
org_id          uuid        FK → organizations.id  NULLABLE
name            text        NOT NULL
type            enum        'analytic' | 'holistic'
subject_id      uuid        FK → subjects.id  NULLABLE
created_by_id   uuid        FK → users.id
is_shared       boolean     DEFAULT false (si la comparte con otros profes del colegio)
deleted_at      timestamp
created_at      timestamp   NOT NULL DEFAULT now()
```

#### `rubric_criteria`

Criterios de una rúbrica (ej: "Vocabulario", "Coherencia", "Content").

```
id              uuid        PK
rubric_id       uuid        FK → rubrics.id
name            text        NOT NULL  e.g. "Vocabulario", "Coherencia del texto"
description     text
max_points      decimal     NOT NULL
order           integer
taxonomy_node_id uuid       FK → taxonomy_nodes.id  NULLABLE (liga al currículo)
```

#### `rubric_levels`

Niveles de cada criterio (qué significa cada puntaje).

```
id              uuid        PK
criterion_id    uuid        FK → rubric_criteria.id
score           decimal     NOT NULL  e.g. 0, 1, 2, 3
descriptor      text        NOT NULL  Descripción de qué implica este puntaje
examples        text[]      Ejemplos de respuesta en este nivel

UNIQUE(criterion_id, score)
```

---

### 8. Aplicación de Evaluaciones

#### `assessments`

Una aplicación concreta de un instrumento a uno o más cursos.

```
id              uuid        PK
org_id          uuid        FK → organizations.id
instrument_id   uuid        FK → instruments.id
name            text        Override del nombre del instrumento para esta aplicación
administered_by_id uuid     FK → users.id
mode            enum        'paper' | 'digital' | 'oral' | 'mixed'
status          enum        'scheduled' | 'in_progress' | 'processing' | 'completed' | 'cancelled'
scheduled_for   timestamp
administered_at timestamp
config          jsonb       Overrides de configuración (escala, tiempo, etc.)
notes           text
created_at      timestamp   NOT NULL DEFAULT now()

INDEX(org_id, status)
INDEX(instrument_id)
```

#### `assessment_course_assignments`

Qué cursos rinden esta evaluación.

```
assessment_id   uuid        FK → assessments.id
class_group_id  uuid        FK → class_groups.id
PRIMARY KEY(assessment_id, class_group_id)
```

#### `assessment_forms`

Formas A/B/C de la misma evaluación (para evitar copia).

```
id              uuid        PK
assessment_id   uuid        FK → assessments.id
name            text        e.g. "Forma A", "Form B"
item_order      uuid[]      IDs de ítems en orden (puede variar por forma)
```

#### `import_jobs`

Jobs de importación asíncrona (CSV de Gradecam, archivo oficial DIA, etc.).

```
id              uuid        PK
org_id          uuid        FK → organizations.id
assessment_id   uuid        FK → assessments.id  NULLABLE
type            enum        'answer_sheet_csv' | 'dia_official' | 'gradecam_csv'
                            | 'zipgrade_csv' | 'aptus' | 'student_roster'
status          enum        'pending' | 'processing' | 'completed' | 'failed' | 'partial'
file_url        text        NOT NULL  (S3 / storage URL)
mapping_config  jsonb       Cómo mapear columnas del CSV a campos del sistema
result          jsonb       Resumen: rows_processed, errors, warnings
error_log       jsonb[]     Lista de errores con fila y descripción
created_by_id   uuid        FK → users.id
created_at      timestamp   NOT NULL DEFAULT now()
completed_at    timestamp

INDEX(org_id, status)
INDEX(assessment_id)
```

---

### 9. Respuestas

#### `responses`

La respuesta de un alumno a un ítem específico.

```
id              uuid        PK
assessment_id   uuid        FK → assessments.id
form_id         uuid        FK → assessment_forms.id  NULLABLE
student_id      uuid        FK → students.id
item_id         uuid        FK → items.id
value           jsonb       La respuesta en sí (varía por tipo, ver abajo)
is_correct      boolean     NULLABLE (null hasta corregir)
raw_score       decimal     NULLABLE
max_score       decimal     NOT NULL
ai_score        jsonb       {score, confidence, justification, model, promptVersion}
human_score     jsonb       {score, override_reason, scored_by_id}
final_score     decimal     NULLABLE  (resuelto: ai vs human)
scored_by       enum        NULLABLE 'auto' | 'ai' | 'human'
scored_at       timestamp
created_at      timestamp   NOT NULL DEFAULT now()

UNIQUE(assessment_id, student_id, item_id)
INDEX(assessment_id, student_id)
INDEX(student_id)
```

**Ejemplos de `value` JSONB:**

`multiple_choice`: `{"selectedLabel": "B"}`

`oral_reading`:

```json
{
  "audioUrl": "s3://bucket/recordings/student123-item45.mp3",
  "durationSec": 68,
  "wordsPerMinute": 89,
  "errorCount": 3
}
```

`open_ended` / `writing`:

```json
{
  "text": "El texto habla sobre...",
  "imageUrl": null,
  "wordCount": 145
}
```

#### `ai_grading_jobs`

Jobs de corrección asíncrona con IA (para desarrollo, escritura, oralidad).

```
id              uuid        PK
response_id     uuid        FK → responses.id
type            enum        'open_ended' | 'oral_reading' | 'oral_expression' | 'writing'
status          enum        'pending' | 'processing' | 'completed' | 'failed'
model           text        e.g. "claude-sonnet-4-6"
prompt_version  text        Para trazabilidad
input           jsonb       Payload enviado al modelo
output          jsonb       Respuesta del modelo
score           decimal     NULLABLE
confidence      decimal     NULLABLE
justification   text        NULLABLE
cost_usd        decimal     Para monitoreo de costos
created_at      timestamp   NOT NULL DEFAULT now()
completed_at    timestamp

INDEX(response_id)
INDEX(status)
```

---

### 10. Resultados y métricas

#### `assessment_results`

Resultado consolidado de un alumno en una evaluación.

```
id              uuid        PK
assessment_id   uuid        FK → assessments.id
student_id      uuid        FK → students.id
total_score     decimal
max_score       decimal
percentage      decimal     Calculado: total_score / max_score
grade           decimal     NULLABLE (convertida según escala)
performance_level enum      'insufficient' | 'elementary' | 'adequate' | 'advanced'
                            NULLABLE hasta que se defina el corte
is_complete     boolean     DEFAULT false (todas las respuestas procesadas)
completed_at    timestamp
created_at      timestamp   NOT NULL DEFAULT now()

UNIQUE(assessment_id, student_id)
INDEX(assessment_id)
INDEX(student_id)
```

#### `skill_results`

Resultado desagregado por nodo de taxonomía (OA, habilidad, contenido).
**Esta es la tabla que alimenta todos los dashboards.**

```
id              uuid        PK
assessment_id   uuid        FK → assessments.id
student_id      uuid        FK → students.id
node_id         uuid        FK → taxonomy_nodes.id
correct_count   integer     NOT NULL DEFAULT 0
total_count     integer     NOT NULL DEFAULT 0
percentage      decimal     Calculado
performance_level enum      NULLABLE

UNIQUE(assessment_id, student_id, node_id)
INDEX(assessment_id, node_id)
INDEX(student_id, node_id)
```

**Nota:** Esta tabla se materializa/recalcula al cerrar una evaluación. En F2 se implementará como vista materializada de PostgreSQL (H19.13) para el benchmarking.

---

### 11. Jobs de importación y procesamiento

Ver sección 8 — `import_jobs` cubre todos los flujos de ingesta de F1.

En F4 se agrega:

- `ocr_scan_jobs` — procesamiento de hojas escaneadas con visión IA (SQS + Workers)

---

## Decisiones técnicas clave

### ¿Por qué JSONB en `items.content` en vez de tablas separadas?

**Alternativa rechazada:** tablas `multiple_choice_items`, `open_ended_items`, `oral_reading_items`.

**Problema:** cada nuevo tipo de ítem (Cambridge Speaking, PAL, cálculo mental) requiere una migración de schema. El banco de ítems es el lugar donde más tipos nuevos aparecerán en F3-F5.

**Decisión:** `type` enum + `content JSONB`. El enum garantiza que los tipos conocidos sean válidos. El JSONB permite evolucionar el contenido de cada tipo sin migraciones. Validación de schema en la capa de aplicación (Zod).

### ¿Por qué `taxonomy_nodes` en lugar de tablas separadas por currículo?

**Alternativa rechazada:** `mineduc_oas`, `simce_skills`, `paes_competencies`, `cambridge_skills`.

**Problema:** los dashboards necesitan agregar y cruzar datos entre instrumentos ("el alumno tiene 60% en OA5 MINEDUC y 45% en la habilidad equivalente del SIMCE"). Con tablas separadas, ese join es una pesadilla.

**Decisión:** árbol polimórfico. El `type` del nodo indica qué clase de objeto es. `taxonomy_mappings` conecta nodos equivalentes entre taxonomies.

### ¿Por qué `responses` tiene `ai_score` y `human_score` separados?

Principio de diseño del producto: **la IA propone, el humano aprueba**. Nunca se sobreescribe la evidencia de lo que generó la IA ni el override humano. El `final_score` es el que se usa para calcular resultados.

### ¿Por qué `skill_results` es una tabla materializada y no calculada on-the-fly?

Los dashboards (H6.10, H6.11) muestran % de logro por alumno × habilidad × curso × instrumento. Calcularlo en tiempo real sobre `responses` con joins a `item_taxonomy_tags` es O(n×m). Para F1 (datos DIA de un colegio) es aceptable on-demand. Para F2 (benchmarking entre colegios) necesita la vista materializada de H19.13.

---

## Implementación por fases

### F1 — Sprint 0-3 (Mínimo para demo)

Tablas necesarias en orden de implementación:

```
S0: organizations, academic_years, grades, subjects
    users, org_memberships
    taxonomies, taxonomy_nodes  ← MINEDUC seed data

S1: class_groups, subject_classes, teacher_assignments
    students, student_enrollments

S2: instruments, instrument_sections, grading_scales
    items, item_taxonomy_tags
    (item_versions opcional en F1, se activa en F3)

S3: assessments, assessment_course_assignments, assessment_forms
    import_jobs
    responses

S4-S5: assessment_results, skill_results
       (vistas + dashboards)
```

### F2 — Benchmarking

```
+ Materializar skill_results como vista materializada PostgreSQL
+ taxonomy_mappings (para cruzar SIMCE con MINEDUC)
```

### F3 — SIMCE/PAES/Cambridge

```
+ rubrics, rubric_criteria, rubric_levels
+ item_versions (activar versionado)
+ ai_grading_jobs (para escritura y oralidad)
```

### F4 — OS Académico

```
+ planning_units (LMS: planificación clase a clase)
+ action_plans, action_plan_items (plan de reforzamiento)
+ guardian_profiles (portal apoderados)
+ ocr_scan_jobs (visión IA: SQS + Workers)
```

### F5 — Escalamiento

```
+ Migrar skill_results histórico a ClickHouse/Snowflake
+ Particionamiento de responses por org_id y año
```

---

## Seed data requerida en F1

Para que el sistema funcione desde el primer día, se necesita cargar:

1. **`grades`** — 12 niveles (1° básico → 4° medio)
2. **`subjects`** — Lenguaje, Matemáticas (F1), resto en F3
3. **`taxonomies`** — "MINEDUC 2024", "DIA 2025"
4. **`taxonomy_nodes`** — OAs de Lenguaje y Matemáticas 1°-8° básico (DIA scope)
5. **`instruments`** — Pautas oficiales DIA 2025 por asignatura y nivel
6. **`grading_scales`** — Escala chilena estándar (60% exigencia, 1.0-7.0)

---

_Documento generado: 2026-05-16 · Revisar antes de implementar F3 (SIMCE/PAES) y F4 (LMS)_
