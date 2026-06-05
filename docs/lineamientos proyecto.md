# EdTech B2B: Master Book y Fundaciones del Proyecto

- **Versión:** 1.0
- **Fecha:** Mayo 2026
- **Propósito:** Definir los lineamientos estratégicos, arquitectónicos, de producto y de negocio que rigen el desarrollo y escalabilidad del Sistema Operativo Educativo K-12.

---

## 1. Manifiesto y Estrategia de Negocio

### 1.1. El Problema Sistémico

El sistema educativo actual opera a ciegas y con fricción extrema. Los directivos toman decisiones sobre datos desactualizados (silos en Excel), y los profesores queman el 40% de su tiempo en tareas operativas (tabulación, corrección manual, planificación), lo que genera una sub-evaluación crónica: se mide poco porque medir es caro. El resultado son vacíos de aprendizaje no detectados a tiempo.

### 1.2. La Estrategia Comercial: "El Caballo de Troya" (PLG)

Nuestra estrategia de crecimiento B2B es **Product-Led Growth (PLG)**.

- **Adquisición:** Reducimos el Costo de Adquisición de Clientes (CAC) a casi $0 resolviendo un dolor agudo de forma gratuita: la ingesta de la prueba ministerial DIA. Entramos por la sala de profesores.
- **Activación:** Entregamos valor inmediato (Dashboards e Inteligencia Pedagógica en segundos).
- **Upsell:** Monetizamos vendiendo Benchmarking Institucional, Material Remedial generado con IA, y planes de corrección automatizada (AI Grading).

### 1.3. La Ventaja Defensiva (Lock-in Institucional)

Construiremos una dependencia basada en valor:

- **Data Gravity:** Historial psicométrico de los alumnos a lo largo de los años.
- **Workflow Integration:** El profesor planifica, evalúa y corrige en nuestra plataforma.
- **Network Effect:** Benchmarking anónimo (solo funciona si están en nuestra red).

---

## 2. Los 4 Pilares del Producto (Core)

1. **LMS Institucional y Marketplace:** Banco de contenido (pruebas, guías, planificaciones) alineado a Bases Curriculares.
2. **Gestión Académica (SIS):** Administración multi-tenant de sedes, cursos, alumnos, notas y asistencia.
3. **Analítica Avanzada y Benchmarking:** Motor de datos que procesa y compara resultados entre distintas generaciones y otros colegios de perfil similar (anonimizado).
4. **AI-Powered Grading (Premium):** Módulo asíncrono impulsado por Vision IA para corrección de pruebas estandarizadas y de desarrollo manuscritas basadas en rúbricas dinámicas.

---

## 3. Arquitectura y Stack Tecnológico (Zero Legacy)

Se ha seleccionado un stack full-TypeScript para maximizar la velocidad de desarrollo, el tipado de punta a punta (_End-to-End Type Safety_) y la facilidad de colaboración.

### 3.1. Stack de Desarrollo

- **Frontend:** Next.js 14+ (App Router), React, Tailwind CSS, Zustand (Estado ligero), shadcn/ui.
- **Backend:** NestJS (Estructura modular y escalable empresarial).
- **Estructura del Proyecto:** Monorepo (`pnpm workspace` / Turborepo) compartiendo interfaces, DTOs y validaciones (Zod).

### 3.2. Base de Datos

- **Motor Principal:** PostgreSQL.
- **ORM:** Drizzle ORM (Elegido sobre Prisma/TypeORM por su control SQL nativo, ligereza en entornos serverless y soporte nativo JSONB).
- **Multi-tenancy:** Implementación estricta de RLS (_Row Level Security_) para garantizar el aislamiento de datos por colegio. Las políticas viven en `packages/db/sql/rls-policies.sql` (no en el schema Drizzle) y se re-aplican en cada `db:migrate`, por lo que no se pierden al regenerar migraciones. Toda query de la API a tablas con RLS corre dentro de `withOrgContext`. Ver `packages/db/README.md`.

### 3.3. IA, Ingesta e Infraestructura

- **AI Engine:** Gemini 2.0 Flash (usando capacidades Multimodales/Visión y _Structured Outputs_ / JSON Schema).
- **Inferencia Documental:** Arquitectura de _Zonal Extraction_ (marcas fiduciarias/Códigos QR) con OpenCV/librerías NodeJS para recortar respuestas antes de enviarlas al LLM.
- **Procesamiento Asíncrono:** BullMQ (Redis) / AWS SQS. El motor de IA nunca bloquea el _event-loop_ transaccional.
- **Despliegue (Infra):** Entorno Cloud en AWS gestionado vía SST (Serverless Stack). S3 para almacenamiento binario (imágenes/PDFs vía _Presigned URLs_).

---

## 4. Definiciones Arquitectónicas Críticas

### 4.1. Taxonomía Universal Agnóstica

El sistema NUNCA dependerá de estructuras rígidas como "Pregunta 1 Lenguaje". El modelo de datos abstrae el concepto de evaluación:

- **Instrumento:** (Ej: Prueba DIA, SIMCE, Cambridge).
- **Ítems/Rúbricas:** Definición de puntajes y tipo de pregunta.
- **Matriz de Especificaciones (OAs):** Entidades de Ejes Temáticos y Habilidades.

### 4.2. Arquitectura CQRS (Command Query Responsibility Segregation)

Dado que la analítica y el benchmarking demandan consultas pesadas, se separará la escritura de la lectura:

- **Write (Comandos):** Ingesta de notas normalizada en PostgreSQL.
- **Read (Consultas):** Los datos se proyectan hacia Vistas Materializadas (o eventualmente ClickHouse/DuckDB) para renderizar los dashboards en milisegundos sin degradar la operación transaccional.

### 4.3. RAG (Retrieval-Augmented Generation) para Generación de Contenido

Para evitar alucinaciones en la IA Remedial:

1. Las bases curriculares del MINEDUC se vectorizan usando `pgvector` en PostgreSQL.
2. Ante un bajo desempeño, el backend hace una búsqueda semántica del Objetivo de Aprendizaje (OA).
3. Se inyecta el OA como contexto en el prompt de Gemini para que genere material pedagógicamente válido.

---

## 5. Roadmap Estratégico (Resumen)

- **Fase 1 (H1 2026) - El "Caballo de Troya":** Ingesta OMR sin fricción de prueba DIA Lenguaje y Dashboards.
- **Fase 2 (Mitad 2026) - Monetización Inicial:** Benchmarking institucional e IA Remedial (RAG).
- **Fase 3 (H2 2026) - Expansión:** Módulos SIMCE, PAES e I+D para simulacros Cambridge.
- **Fase 4 (2027) - Ecosistema Propietario:** Marketplace de contenido, LMS clase a clase, Tracker Curricular y AI Grading Total (Zonal OCR).
- **Fase 5 (Post 2027) - Escalamiento:** Full Curriculum (Todas las asignaturas 1°B a 4°M) y Modelos Predictivos.

---

## 6. Unit Economics y Dimensionamiento

- **Modelo de Negocios:** SaaS B2B Enterprise (Planes Escalonados).
- **ARPA Esperado:** ~$1.500.000 CLP mensuales por colegio.
- **SAM (Chile):** ~8.500 colegios -> ~$150 Millones USD ARR.
- **SOM Objetivo (24-36 meses):** 5% de mercado (425 colegios) -> ~$7.5 Millones USD ARR.
- **LTV/CAC:** Estimación superior a 5:1 basada en retención a largo plazo (Data Gravity).

---

## 7. Visión a Largo Plazo (The Data Moat)

La acumulación de la trayectoria longitudinal de millones de alumnos permitirá abrir nuevas líneas de negocio (Big Data Educativo):

- **Scoring Predictivo de Éxito Universitario:** B2B con Ed. Superior para perfilamiento de riesgo de deserción y _Admissions_.
- **Oráculo de Políticas Públicas (B2G):** Dashboards predictivos de crisis académica para gobiernos y SLEPs (SIMCE en tiempo real).
- **I+D Curricular (Data Licensing):** Venta de métricas de eficacia de contenido a editoriales.
- **Modelos de Riesgo M&A:** Evaluación financiera-académica de colegios para fondos de Private Equity o Sostenedores Corporativos.
- **Tutor IA Evolutivo:** Modelos entrenados mediante Reinforcement Learning basados en el éxito empírico de evaluaciones estandarizadas, no solo texto de internet.

---

## 8. Cultura de Ingeniería y Trabajo

- **Sparring Partners:** Fomento del debate técnico basado en datos, arquitecturas sólidas (SOLID, DRY, Clean Architecture) y cero Egos.
- **Ownership End-to-End:** Los desarrolladores son dueños del ciclo de vida (desde la historia de usuario, pasando por DB, API y UI). No hay micromanagement.
- **Product Mindset:** Las decisiones técnicas deben justificar su Retorno de Inversión (ROI) para el negocio. La prioridad siempre es la entrega de valor al cliente (eficiencia operativa para profesores, visibilidad para directores).
- **Skin in the Game:** Compromiso absoluto con la estabilidad del sistema, reaccionando como fundadores ante las crisis (caídas de DB en periodos de evaluación masiva).
