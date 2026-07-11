import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// F2 S3 — IA Remedial (RAG). Contratos compartidos del módulo `remedial`
// (apps/api/src/remedial/, ruta base /api/remedial) y la UI /material-remedial.
//
// Principio rector (CLAUDE.md §8.3): la IA PROPONE, el humano APRUEBA. El material
// se genera async (status pending→processing→ready), entra en BORRADOR (`ready`) y
// un humano lo aprueba (`approved`) o descarta (`discarded`). El "retrieval" del RAG
// es recuperación curricular ESTRUCTURADA (CurriculumRetriever sobre taxonomy_nodes,
// sin embeddings). NUNCA se envía PII al LLM: la agrupación de alumnos (group_plan)
// es determinista en backend; la IA solo etiqueta el grupo en abstracto.
// ─────────────────────────────────────────────────────────────────────────────

export const remedialMaterialTypeSchema = z.enum(['guide', 'practice_set', 'group_plan']);
export type RemedialMaterialType = z.infer<typeof remedialMaterialTypeSchema>;

export const remedialStatusSchema = z.enum([
  'pending',
  'processing',
  'ready', // generado, pendiente de revisión humana
  'failed',
  'approved',
  'discarded',
]);
export type RemedialStatus = z.infer<typeof remedialStatusSchema>;

// ── Contenido por tipo (polimórfico; validado tras la respuesta del modelo) ──

/** Guía de reenseñanza para el profesor (H9.2). */
export const remedialGuideContentSchema = z.object({
  objective: z.string(), // qué reenseñar, alineado al OA de la brecha
  rootCauseSummary: z.string(), // por qué ocurre la brecha (desde el diagnóstico)
  strategy: z.string(), // estrategia pedagógica de reenseñanza
  classActivities: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        durationMin: z.number().int().nullable(),
      }),
    )
    .min(1),
  materials: z.array(z.string()), // recursos sugeridos
  successCriteria: z.array(z.string()), // cómo saber que se superó la brecha
});
export type RemedialGuideContent = z.infer<typeof remedialGuideContentSchema>;

/** Referencia a un ítem de práctica generado (vive en la tabla `items` como draft). */
export const remedialPracticeItemRefSchema = z.object({
  itemId: z.string().uuid(), // item creado con source='ai_generated', status='draft'
  position: z.number().int(),
  stem: z.string(), // copia para preview rápido en el banco de material
});
export type RemedialPracticeItemRef = z.infer<typeof remedialPracticeItemRefSchema>;

/** Set de ítems de práctica generados sobre la habilidad débil (H9.3). */
export const remedialPracticeContentSchema = z.object({
  skillFocus: z.string(),
  itemCount: z.number().int(),
  items: z.array(remedialPracticeItemRefSchema),
  notes: z.string().nullable(),
});
export type RemedialPracticeContent = z.infer<typeof remedialPracticeContentSchema>;

/** Un paso de la secuencia remedial sugerida. */
export const remedialPlanStepSchema = z.object({
  order: z.number().int(),
  title: z.string(),
  description: z.string(),
  linkedNodeId: z.string().nullable(), // OA/habilidad relacionada al paso
});
export type RemedialPlanStep = z.infer<typeof remedialPlanStepSchema>;

/** Plan remedial por grupo de alumnos (H9.4). Sin PII: solo conteo + etiqueta abstracta. */
export const remedialPlanContentSchema = z.object({
  groupLabel: z.string(), // etiqueta abstracta del grupo (sin nombres)
  studentCount: z.number().int(), // determinista (backend)
  sharedGap: z.string(), // la brecha compartida que define el grupo
  sequence: z.array(remedialPlanStepSchema).min(1),
  estimatedSessions: z.number().int().nullable(),
});
export type RemedialPlanContent = z.infer<typeof remedialPlanContentSchema>;

/** Unión discriminada del contenido de un material remedial (por `type`). */
export const remedialContentSchema = z.union([
  remedialGuideContentSchema,
  remedialPracticeContentSchema,
  remedialPlanContentSchema,
]);
export type RemedialContent = z.infer<typeof remedialContentSchema>;

/** Valida el `content` según el `type` del material (capa de aplicación). */
export function validateRemedialContent(
  type: RemedialMaterialType,
  content: unknown,
): RemedialContent {
  switch (type) {
    case 'guide':
      return remedialGuideContentSchema.parse(content);
    case 'practice_set':
      return remedialPracticeContentSchema.parse(content);
    case 'group_plan':
      return remedialPlanContentSchema.parse(content);
  }
}

// ── Audiencia del material: profesor (todo) vs estudiante (sin info docente) ──
//
// TKT-17 (b): "misma generación, dos renders". La versión ESTUDIANTE muestra el
// mismo contenido generado pero ocultando la información dirigida al profesor
// (diagnóstico de la brecha, estrategia pedagógica, notas docentes, criterios de
// evaluación, referencias curriculares). NO se genera dos veces ni se persiste dos
// copias: se DERIVA de forma determinista el render de estudiante desde el content
// aprobado/editado. Este proyector es la ÚNICA fuente de verdad de qué es
// "solo-profesor" por tipo de material.
export const remedialAudienceSchema = z.enum(['teacher', 'student']);
export type RemedialAudience = z.infer<typeof remedialAudienceSchema>;

/** Guía para el estudiante: objetivo + actividades + materiales. Oculta el
 * diagnóstico de la brecha (`rootCauseSummary`), la estrategia pedagógica
 * (`strategy`) y los criterios de logro (`successCriteria`) — todo solo-profesor. */
export const remedialGuideStudentContentSchema = z.object({
  objective: z.string(),
  classActivities: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        durationMin: z.number().int().nullable(),
      }),
    )
    .min(1),
  materials: z.array(z.string()),
});
export type RemedialGuideStudentContent = z.infer<
  typeof remedialGuideStudentContentSchema
>;

/** Set de práctica para el estudiante: los ítems sin las notas docentes
 * (`notes`). El ocultamiento de respuestas/pautas de cada ítem es responsabilidad
 * del render/export de `items` (viven en la tabla `items`). */
export const remedialPracticeStudentContentSchema = z.object({
  skillFocus: z.string(),
  itemCount: z.number().int(),
  items: z.array(remedialPracticeItemRefSchema),
});
export type RemedialPracticeStudentContent = z.infer<
  typeof remedialPracticeStudentContentSchema
>;

/** Plan de grupo para el estudiante: la secuencia de trabajo sin la brecha
 * compartida (`sharedGap`), el conteo/etiqueta de agrupación ni las referencias
 * curriculares por paso (`linkedNodeId`) — todo solo-profesor. */
export const remedialPlanStudentContentSchema = z.object({
  groupLabel: z.string(),
  sequence: z
    .array(
      z.object({
        order: z.number().int(),
        title: z.string(),
        description: z.string(),
      }),
    )
    .min(1),
});
export type RemedialPlanStudentContent = z.infer<
  typeof remedialPlanStudentContentSchema
>;

/** Unión del contenido "versión estudiante" (por `type`). */
export const remedialStudentContentSchema = z.union([
  remedialGuideStudentContentSchema,
  remedialPracticeStudentContentSchema,
  remedialPlanStudentContentSchema,
]);
export type RemedialStudentContent = z.infer<typeof remedialStudentContentSchema>;

/**
 * Deriva la versión ESTUDIANTE del contenido de un material remedial, ocultando
 * la información dirigida al profesor. Determinista, sin IA. Recibe el content
 * EFECTIVO (edición humana si existe, si no la salida IA).
 */
export function toRemedialStudentContent(
  type: RemedialMaterialType,
  content: RemedialContent,
): RemedialStudentContent {
  switch (type) {
    case 'guide': {
      const c = content as RemedialGuideContent;
      return {
        objective: c.objective,
        classActivities: c.classActivities.map((a) => ({
          title: a.title,
          description: a.description,
          durationMin: a.durationMin,
        })),
        materials: c.materials,
      };
    }
    case 'practice_set': {
      const c = content as RemedialPracticeContent;
      return {
        skillFocus: c.skillFocus,
        itemCount: c.itemCount,
        items: c.items,
      };
    }
    case 'group_plan': {
      const c = content as RemedialPlanContent;
      return {
        groupLabel: c.groupLabel,
        sequence: c.sequence.map((s) => ({
          order: s.order,
          title: s.title,
          description: s.description,
        })),
      };
    }
  }
}

// ── Model de respuesta (lo que el frontend tipa) ──

export const remedialMaterialModelSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  type: remedialMaterialTypeSchema,
  status: remedialStatusSchema,
  nodeId: z.string().uuid().nullable(),
  nodeName: z.string().nullable(), // joineado para mostrar
  assessmentId: z.string().uuid().nullable(),
  classGroupId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  // Salida IA original (evidencia inmutable tras `markReady`). §8.3: la IA propone.
  // forma varía por `type`; se valida con `validateRemedialContent` cuando status='ready'/'approved'.
  content: remedialContentSchema.nullable(),
  // Override humano (edición). §8.3: el humano ajusta sin borrar la evidencia IA.
  // El frontend renderiza el content EFECTIVO: `editedContent ?? content`.
  editedContent: remedialContentSchema.nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  costUsd: z.string().nullable(),
  error: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  reviewedById: z.string().uuid().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
});
export type RemedialMaterialModel = z.infer<typeof remedialMaterialModelSchema>;

export const remedialListResponseSchema = z.object({
  data: z.array(remedialMaterialModelSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type RemedialListResponse = z.infer<typeof remedialListResponseSchema>;

/**
 * Versión ESTUDIANTE de un material (TKT-17 b). Mismo material, render sin la
 * información solo-profesor. Derivado del content efectivo con
 * `toRemedialStudentContent`. `content` es null si el material aún no tiene salida
 * (status distinto de ready/approved).
 */
export const remedialStudentMaterialModelSchema = z.object({
  id: z.string().uuid(),
  type: remedialMaterialTypeSchema,
  status: remedialStatusSchema,
  nodeId: z.string().uuid().nullable(),
  nodeName: z.string().nullable(),
  title: z.string().nullable(),
  content: remedialStudentContentSchema.nullable(),
});
export type RemedialStudentMaterialModel = z.infer<
  typeof remedialStudentMaterialModelSchema
>;

// ── DTOs de entrada ──

/** Gatilla la generación de un material remedial desde una brecha (nodeId). */
export const generateRemedialSchema = z.object({
  type: remedialMaterialTypeSchema,
  nodeId: z.string().uuid(), // la brecha / OA a remediar
  assessmentId: z.string().uuid().optional(), // evaluación de origen
  classGroupId: z.string().uuid().optional(), // requerido para group_plan (cohorte)
  sourceAnalysisId: z.string().uuid().optional(), // análisis IA de origen (trazabilidad)
  itemCount: z.number().int().min(1).max(20).optional(), // solo practice_set (default en el service)
  force: z.boolean().default(false), // ignora la caché por input_hash
});
export type GenerateRemedialDto = z.infer<typeof generateRemedialSchema>;

/** Filtros del banco de material remedial. */
export const remedialListQuerySchema = z.object({
  type: remedialMaterialTypeSchema.optional(),
  status: remedialStatusSchema.optional(),
  nodeId: z.string().uuid().optional(),
  assessmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type RemedialListQueryDto = z.infer<typeof remedialListQuerySchema>;

/**
 * Revisión humana (H9.5): aprobar o descartar. Al aprobar se puede enviar el
 * `content` editado por el humano (override) — la IA propone, el humano ajusta y
 * aprueba. Aprobar un practice_set publica sus ítems (status='published').
 */
export const reviewRemedialSchema = z.object({
  action: z.enum(['approve', 'discard']),
  content: remedialContentSchema.optional(), // contenido editado (solo en approve)
});
export type ReviewRemedialDto = z.infer<typeof reviewRemedialSchema>;

/**
 * Edición humana del material remedial ANTES de aprobar (TKT-17 c). Aplica a
 * TODOS los tipos (guide | practice_set | group_plan), no solo la guía. El content
 * se valida por `type` con `validateRemedialContent`. §8.3: se persiste en
 * `editedContent` (override), la salida IA (`content`) queda intacta como evidencia.
 * Solo editable mientras el material está en borrador (`ready`).
 */
export const updateRemedialSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: remedialContentSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: 'Debe enviar al menos `title` o `content` para editar.',
  });
export type UpdateRemedialDto = z.infer<typeof updateRemedialSchema>;
