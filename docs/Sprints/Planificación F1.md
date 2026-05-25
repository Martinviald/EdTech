# Planificación F1 — Sprints detallados

> **Fase 1 — "Caballo de Troya": Ingesta DIA + Dashboards**
> Período objetivo: S1 2026 · 6 sprints × 2 semanas = 12 semanas
> Equipo: 2 desarrolladores full-stack
>
> **Principio rector:** cada historia de F1 se diseña para ser extensible a F2-F5. No hay código "provisional". El modelo de datos, el motor de evaluación y los dashboards que construimos aquí son los mismos que sostendrán SIMCE, PAES y Cambridge más adelante.

---

## Vista resumen

| Sprint | Semanas | Objetivo                                   | Historias                                              | Progreso         |
| ------ | ------- | ------------------------------------------ | ------------------------------------------------------ | ---------------- |
| S0     | 1-2     | Cimientos: stack, modelo de datos, auth    | H19.11, H19.12, H1.7, H17.1, H19.4, H19.5, H19.10    | 6/7 ✅ (H19.5 ⏳) |
| S1     | 3-4     | Onboarding del colegio                     | H1.1, H1.2, H1.3, H1.4, H17.2, H17.3, H19.2          | 7/7 ✅            |
| S2     | 5-6     | Banco de ítems + pautas DIA                | H3.3, H3.10, H3.11, H3.12, H5.8                       | 0/5              |
| S3     | 7-8     | Ingesta y corrección DIA                   | H4.5, H4.6, H5.7, H16.3, H16.4                        | 0/5              |
| S4     | 9-10    | Dashboards core (directivo y profesor)     | H6.1, H6.2, H6.3, H6.4, H6.5, H6.6, H6.7, H6.8, H6.9| 0/9              |
| S5     | 11-12   | Dashboards avanzados + flujo demo completo | H6.10, H6.11, H6.12, H6.18, H19.1                     | 0/5              |

**Flujo demo F1 completo al final del Sprint 5:**
Subir hojas DIA → corrección automática → dashboard habilidades → click en pregunta → distractores → comparar con diagnóstico anterior → exportar Excel/PDF

---

## Sprint 0 — Cimientos arquitectónicos _(Semanas 1-2)_

**Objetivo:** repositorio listo, stack configurado, modelo de datos base y autenticación. Sin esto, nada más puede empezar.

**Por qué va primero:** la Taxonomía Universal (H19.11) es la decisión de diseño más crítica de todo el proyecto. Si se hace mal aquí, F2-F5 requieren migraciones dolorosas. Vale la pena tomarse el tiempo extra para hacerla bien.

| ID         | Historia                                                                                                            | Complejidad | Estado | Notas                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H19.11** | Taxonomía Universal en Drizzle: OAs, habilidades, contenidos MINEDUC con soporte futuro para SIMCE, PAES, Cambridge | ★★★★★       | ✅      | Tablas `curricula`, `taxonomy_nodes`, `taxonomy_mappings` en `packages/db/src/schema/curriculum.ts` con relaciones polimórficas y RLS.             |
| **H19.12** | Infraestructura serverless Next.js: repo, CI/CD, entornos dev/staging/prod                                          | ★★★         | ✅      | Monorepo Turborepo + pnpm: `apps/api` (NestJS), `apps/web` (Next.js 15), `packages/db` (Drizzle), `packages/types`.                              |
| **H1.7**   | Autenticación con Google / Microsoft (SSO)                                                                          | ★★★         | ✅      | NextAuth v5 con Google + Microsoft Entra ID + mock provider. Guards JWT, multi-rol con `roles[]` + `activeRole` + switch-role endpoint.            |
| **H17.1**  | UX simple: design system base (colores, tipografía, componentes core)                                               | ★★          | ✅      | shadcn/ui en `apps/web/src/components/ui/`. Sidebar colapsable, Topbar, MobileSidebar, UserNav con RoleSwitcher.                                  |
| **H19.10** | Manual de marca implementado en la plataforma (coherencia visual)                                                   | ★★          | ✅      | Tokens CSS light/dark en `globals.css`, config en `tailwind.config.ts`. Inter como fuente base.                                                   |
| **H19.4**  | Estructura de privacidad: modelo de datos con aislamiento por colegio (tenant isolation)                            | ★★★         | ✅      | `withOrgContext`, `SensitiveDataGuard` (Ley 19.628), `RolesGuard` por unión, org_id obligatorio en queries. Tests en `privacy.service.spec.ts`.   |
| **H19.5**  | Backups automáticos y plan de recuperación                                                                          | ★★          | ⏳      | Pendiente. No hay scripts de pg_dump ni configuración de backups en el repo.                                                                      |

**División de trabajo sugerida:**

- Dev 1: H19.11 + H19.4 (modelo de datos y arquitectura de datos)
- Dev 2: H19.12 + H1.7 + H17.1 + H19.10 + H19.5 (infra y stack frontend)

**Criterio de salida del sprint:** un desarrollador puede hacer login con SSO, ver una pantalla en blanco con el design system aplicado, y la base de datos tiene las tablas de Taxonomía Universal correctamente migradas.

---

## Sprint 1 — Onboarding del colegio _(Semanas 3-4)_

**Objetivo:** un administrador puede dar de alta un colegio, importar alumnos y crear cuentas de usuarios con sus roles.

**Por qué va segundo:** si no hay colegio + alumnos + roles cargados, no hay nada que evaluar. Este sprint habilita todos los siguientes.

| ID        | Historia                                                                              | Complejidad | Estado | Notas                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1.1**  | Alta de colegio: nombre, RBD, ciclos, niveles, cursos, asignaturas, comuna            | ★★★         | ✅      | `organizations.controller.ts` con CRUD + setup wizard en `organizacion/configurar/`. Año académico, class groups, subject classes.                                         |
| **H1.2**  | Importar nómina de alumnos por curso (CSV + validación de RUT)                        | ★★★         | ✅      | `students-import.service.ts` con preview/commit. Validación RUT (`normalizeRut`). Frontend en `/importar` con `student-import-flow.tsx`.                                   |
| **H1.3**  | Crear cuentas de profesores y directivos con roles                                    | ★★          | ✅      | `staff.service.ts` con invite/bulk-invite/revoke. Multi-rol soportado (UNIQUE por terna). Frontend en `/equipo` con AddMemberDialog y BulkImportDialog.                   |
| **H1.4**  | Asignar profesor a cursos y asignaturas                                               | ★★          | ✅      | `teacher-assignments.service.ts` con CRUD. Frontend en `organizacion/asignaciones/` con CreateAssignmentDialog y AssignmentsTable.                                         |
| **H17.2** | Gestión del currículum MINEDUC (OAs por asignatura y nivel)                           | ★★★         | ✅      | Seed MINEDUC como taxonomía universal (`mineduc-taxonomy.ts` + `mineduc-2024.json`). Panel de gestión en `/curriculum`.                                                    |
| **H17.3** | Gestión de taxonomías (habilidades, contenidos, tipos de texto, niveles de desempeño) | ★★          | ✅      | `curricula.controller.ts` + `nodes.controller.ts` con CRUD completo + tree builder. Frontend en `/curriculum/[curriculumId]` con TreeView interactivo.                     |
| **H19.2** | Responsive: funciona en móvil, tablet y desktop                                       | ★★          | ✅      | `MobileSidebar.tsx` con Sheet, sidebar `hidden md:flex`, padding responsive en Topbar. Aplicado en todos los layouts.                                                      |

**División de trabajo sugerida:**

- Dev 1: H1.1 + H1.2 + H1.4 (entidades del colegio y alumnos)
- Dev 2: H1.3 + H17.2 + H17.3 + H19.2 (roles, currículum y responsive)

**Criterio de salida:** un admin puede crear un colegio, importar un CSV con 500 alumnos y ver el currículum MINEDUC de Lenguaje 3° básico cargado en la plataforma.

---

## Sprint 2 — Banco de ítems + Pautas DIA _(Semanas 5-6)_

**Objetivo:** la plataforma conoce las preguntas DIA, sus respuestas correctas y sus etiquetas de habilidad/OA. Es el motor de corrección del Sprint 3.

**Por qué va aquí:** el banco de ítems y las pautas oficiales DIA son el "cerebro" que hace posible la corrección automática. Sin esto, el Sprint 3 no puede procesar nada.

| ID        | Historia                                                                                    | Complejidad | Notas                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H3.12** | Ingerir y mantener pautas oficiales DIA (claves de respuesta + mapeo OA/habilidad por ítem) | ★★★★        | **Crítico para el flujo demo.** Parsear el formato de la Agencia de Calidad. Modelar `EvaluationInstrument` → `Item` → `CorrectAnswer` + `ItemTag` (OA, habilidad, contenido). |
| **H3.3**  | Banco de ítems con metadata: OA, habilidad, contenido, nivel, tipo, parámetros IRT básicos  | ★★★         | Usar IRT 2PL para F1 (dificultad + discriminación). El 3er parámetro (adivinación) puede esperar a F3.                                                                         |
| **H3.10** | Versionado de pruebas (trazabilidad de qué versión rindió cada curso)                       | ★★          | Tabla `EvaluationVersion`. Permite análisis longitudinal en F2+.                                                                                                               |
| **H3.11** | Etiquetar cada pregunta con OA/habilidad/contenido; sugerido por IA al subir                | ★★★         | LLM para sugerir tags al admin. El admin confirma. Importante para reducir carga operativa.                                                                                    |
| **H5.8**  | Subir tabla de especificaciones desde Excel y vincularla a preguntas                        | ★★          | Parser de Excel genérico. Mapeo columna → campo de la tabla de specs.                                                                                                          |

**División de trabajo sugerida:**

- Dev 1: H3.12 + H3.10 (pautas DIA y versionado — backend crítico)
- Dev 2: H3.3 + H3.11 + H5.8 (banco de ítems y herramientas de etiquetado)

**Criterio de salida:** la pauta DIA 2025 está cargada en la plataforma con todas sus preguntas, respuestas correctas y etiquetas OA/habilidad. Se puede consultar "¿qué habilidad evalúa la pregunta 12 del DIA Lectura 2° básico?"

---

## Sprint 3 — Ingesta y corrección DIA _(Semanas 7-8)_

**Objetivo:** un profesor sube las hojas de respuesta DIA de su curso y, en minutos, tiene los resultados de cada alumno calculados y almacenados.

**Por qué es el sprint más importante:** este es el "Caballo de Troya". Es el dolor que tiene el colegio HOY (subir alumno por alumno, tabulación manual). Resolver esto ya justifica la plataforma.

| ID        | Historia                                                                                 | Complejidad | Notas                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H4.6**  | Subir hojas de respuesta DIA en bloque (por curso, no alumno por alumno)                 | ★★★★        | UI de carga de archivo + procesamiento en background. Puede ser CSV exportado de Gradecam por ahora (el escaneo en video viene en F3). Mostrar progress bar. |
| **H4.5**  | Subir desde Excel/CSV resultados escaneados con otro sistema (Gradecam, ZipGrade)        | ★★★         | Mismo parser que H4.6. Mapeo flexible de columnas. Preview antes de confirmar la carga.                                                                      |
| **H16.3** | Importar resultados de Gradecam / ZipGrade (integración de transición)                   | ★★          | Puede ser el mismo flujo que H4.5 con un template de Excel documentado.                                                                                      |
| **H16.4** | Importar resultados oficiales DIA (archivo Agencia de Calidad cuando esté disponible)    | ★★★         | Parser del formato oficial. Puede no estar disponible aún; tener el parser listo para cuando llegue.                                                         |
| **H5.7**  | Convertir puntaje a nota según escala configurable por colegio (60% exigencia, base 4.0) | ★★          | Configuración por colegio de la escala de conversión. Fórmula estándar + casos especiales.                                                                   |

**División de trabajo sugerida:**

- Dev 1: H4.6 + H5.7 (motor de procesamiento y cálculo de notas)
- Dev 2: H4.5 + H16.3 + H16.4 (parsers de importación)

**Criterio de salida:** un profesor sube el CSV de respuestas DIA de su curso (45 alumnos), la plataforma procesa contra la pauta oficial, calcula el % de logro por alumno × pregunta × habilidad y convierte a nota. Todo en menos de 2 minutos.

---

## Sprint 4 — Dashboards core _(Semanas 9-10)_

**Objetivo:** directivos y profesores tienen un panel completo de resultados con filtros, comparaciones históricas y clasificación por nivel de desempeño.

**Por qué aquí:** con los datos ya procesados en Sprint 3, este sprint construye la capa de visualización sobre ellos. Es el valor visible para el cliente.

| ID       | Historia                                                                        | Complejidad | Notas                                                                                                              |
| -------- | ------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| **H6.1** | Panel de resultados para directivo                                              | ★★★         | Vista de aterrizaje post-login directivo. Cards resumen: últimas evaluaciones, alertas, % logro global.            |
| **H6.2** | Filtros: asignatura, nivel, curso, alumno, período                              | ★★★         | Filtros aplicados a toda la vista. State en URL para compartir/bookmarkear.                                        |
| **H6.3** | Comparación de generaciones en un mismo nivel (año actual vs años anteriores)   | ★★★         | Serie de tiempo. Requiere que haya datos de al menos 2 períodos (puede mostrarse vacío el primer año).             |
| **H6.4** | Clasificar alumnos por nivel de desempeño (insuficiente / elemental / adecuado) | ★★          | Thresholds configurables por prueba/colegio. Vista de tabla con colores.                                           |
| **H6.5** | Métricas de desempeño por habilidad (no solo por prueba)                        | ★★★         | Agrupación de ítems por habilidad → % logro agregado. La Taxonomía Universal de H19.11 habilita esto directamente. |
| **H6.6** | Progresión de resultados a lo largo del año                                     | ★★★         | Gráfico de línea temporal. Por alumno, por curso, por habilidad.                                                   |
| **H6.7** | Resultados de evaluaciones para el profesor (solo sus cursos)                   | ★★          | Mismo componente que H6.1 pero filtrado por el scope del profesor.                                                 |
| **H6.8** | Métricas y KPIs del profesor                                                    | ★★          | % logro promedio del curso, alumnos críticos, evolución.                                                           |
| **H6.9** | Reportes descargables básicos (PDF/Excel) de los resultados actuales            | ★★          | Usar la misma lógica de export que H6.18 del Sprint 5. Puede ser un simple "exportar vista actual".                |

**División de trabajo sugerida:**

- Dev 1: H6.1 + H6.2 + H6.3 + H6.6 (filtros y comparativas — lógica de datos compleja)
- Dev 2: H6.4 + H6.5 + H6.7 + H6.8 + H6.9 (clasificación, habilidades y reportes)

**Criterio de salida:** un subdirector puede abrir el panel, filtrar por "Lenguaje 3° básico", ver el % de logro por habilidad del DIA 2025 comparado con 2024, y ver cuántos alumnos están en nivel insuficiente.

---

## Sprint 5 — Dashboards avanzados + Flujo demo completo _(Semanas 11-12)_

**Objetivo:** completar las visualizaciones de mayor impacto en la demo y pulir el flujo de 5 minutos que convence al directivo.

**Por qué al final:** estas son las historias de mayor "wow factor" en la demo. Deben estar sólidas y sin bugs antes de salir a vender.

| ID        | Historia                                                                                                 | Complejidad | Notas                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H6.10** | Mapa de calor de % de logro por habilidad y asignatura                                                   | ★★★         | Tabla heatmap. Color por rango de logro. Lo que más le gusta a Vicente (referencia SEPA). Alto impacto visual en demo.                                                            |
| **H6.11** | % de logro por alumno × pregunta × curso × habilidad × contenido (granularidad Gradecam++)               | ★★★★        | Tabla cruzada con drill-down. Más compleja de construir pero es el diferenciador vs Gradecam.                                                                                     |
| **H6.12** | Click en una pregunta → enunciado + alternativas + distribución de respuestas + análisis de distractores | ★★★         | Modal/panel lateral. Muestra cuántos alumnos eligieron cada alternativa. Requiere que las preguntas estén cargadas en el banco.                                                   |
| **H6.18** | Exportar a Excel/PDF cualquier vista con los filtros aplicados                                           | ★★★         | Export genérico que funciona en todos los dashboards. Compatible con flujos actuales del colegio.                                                                                 |
| **H19.1** | Plataforma flexible: soporte para cualquier tipo de asignatura, prueba, tipo de pregunta, métrica        | ★★          | No es una feature nueva: es una validación arquitectónica. Revisar que ninguna decisión de F1 esté hardcodeada para DIA. Documentar los puntos de extensión para SIMCE/PAES (F3). |

**División de trabajo sugerida:**

- Dev 1: H6.11 + H6.18 (tablas complejas y exports)
- Dev 2: H6.10 + H6.12 + H19.1 (mapa de calor, análisis de distractores y validación arquitectónica)

**Criterio de salida / Demo de F1:**

1. Admin da de alta el colegio y sube nómina de alumnos (2 min)
2. Encargado sube CSV con respuestas DIA del curso completo (1 min)
3. Sistema procesa y genera resultados → dashboard habilidades específicas (H6.10, H6.11)
4. Director hace click en una pregunta y ve distribución de distractores (H6.12)
5. Director compara con diagnóstico del año anterior (H6.3, H6.6)
6. Director exporta el reporte en PDF (H6.18)

Todo el flujo: 5 minutos.

---

## Historias F1 no incluidas en estos sprints

Las siguientes historias de F1 son importantes pero no bloquean el flujo demo. Se pueden abordar en paralelo cuando haya capacidad, o en un Sprint 5-bis antes de lanzar:

| ID              | Historia                                     | Razón para diferir                                                                           |
| --------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| H19.4           | Cumplimiento normativo completo (Ley 19.628) | Los fundamentos van en S0; la documentación formal puede ir antes del lanzamiento comercial. |
| H17.2 extendida | Currículum completo todas las asignaturas    | En S1 se carga Lenguaje y Matemáticas. El resto puede agregarse iterativamente.              |

---

## Dependencias críticas entre sprints

```
S0 (fundaciones)
  └── S1 (onboarding) — necesita auth y modelo de datos
        └── S2 (banco de ítems) — necesita alumnos y cursos cargados
              └── S3 (ingesta DIA) — necesita pautas cargadas (H3.12)
                    └── S4 (dashboards core) — necesita datos procesados
                          └── S5 (dashboards avanzados + demo) — necesita dashboards base
```

No hay paralelismo entre sprints porque cada uno depende del anterior. Dentro de cada sprint sí hay paralelismo entre Dev 1 y Dev 2.

---

## Decisiones técnicas a resolver antes de arrancar

Estas 4 decisiones bloquean o afectan el arranque:

| Decisión                                                                              | Impacto                                                                         | Plazo       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| **Modelo IRT F1**: ¿2PL (dificultad + discriminación) o 3PL (+ adivinación)?          | Estructura de la tabla `Item`. Recomendación: 2PL en F1.                        | Antes de S2 |
| **Formato import DIA**: ¿archivo oficial Agencia de Calidad o CSV manual del colegio? | Define H4.6 y H16.4. Si no hay archivo oficial aún, empezar con CSV manual.     | Antes de S3 |
| **Escala de conversión de notas**: ¿configurable por colegio o fija?                  | Define H5.7. Recomendación: configurable desde el inicio.                       | Antes de S3 |
| **Proveedor de LLM para etiquetado IA**: ¿Claude API o GPT-4o?                        | Afecta H3.11. Recomendación: Claude API con prompt caching para reducir costos. | Antes de S2 |

---

## Qué NO entra en F1 (y por qué)

Para mantener el foco, estas capacidades quedan explícitamente fuera de F1:

- **Escaneo con cámara en tiempo real (H4.2):** complejidad de visión IA → F3
- **Corrección de preguntas de desarrollo con IA (H5.2):** requiere rúbricas → F4
- **Benchmarking inter-colegios (E7):** requiere masa crítica de colegios → F2
- **Predicción ML SIMCE/PAES (E8):** requiere datos históricos suficientes → F3
- **Generación de contenido IA (E9):** upsell → F2
- **Portal apoderados (E11):** no bloquea el flujo de venta inicial → F3
- **LMS y planificación curricular (E2):** lock-in de largo plazo → F4

---

_Documento generado: 2026-05-16 · Actualizar al final de cada sprint con lo completado, lo diferido y las decisiones tomadas._
