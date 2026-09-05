import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../client';
import { instrumentSections } from '../schema/instruments';
import { items } from '../schema/items';
import { assessmentFormStudents, assessmentForms } from '../schema/assessments';
import { pickSectionsForStudent } from '@soe/types';

/**
 * Qué ítems de un instrumento le corresponden a un alumno.
 *
 * ── El problema que resuelve ──────────────────────────────────────────────────
 * Los tres escritores de respuestas (la ingesta de hojas y los dos importadores de
 * seed) crean UNA RESPUESTA POR CADA ÍTEM DEL INSTRUMENTO, con 0 para los que el
 * alumno no contestó. Eso es correcto mientras todos rindan la prueba entera, y se
 * vuelve un bug silencioso apenas hay secciones electivas: a un alumno de la mención
 * Biología se le fabricarían respuestas incorrectas por las 52 preguntas de Física y
 * Química, hundiendo su porcentaje de `correctas/80` a `correctas/132`.
 *
 * ── El contrato ──────────────────────────────────────────────────────────────
 * `null` significa "todos los ítems del instrumento": es el camino de siempre y
 * mantiene el comportamiento bit a bit para los instrumentos sin electivas, que hoy
 * son todos. Sólo cuando el instrumento declara alguna sección `elective` se acota.
 *
 * Un alumno SIN forma asignada en un instrumento CON electivas devuelve
 * `{ itemIds: null, missingForm: true }`: no se inventa una mención por defecto ni se
 * le corrige la prueba entera. Quien llame decide (la ingesta lo manda a revisión).
 */
export type ElectiveScope = {
  /** Ítems que le tocan al alumno. `null` = todos los del instrumento. */
  itemIds: string[] | null;
  /** El instrumento tiene secciones electivas. */
  hasElectives: boolean;
  /** Hay electivas pero el alumno no tiene forma asignada: no se puede corregir. */
  missingForm: boolean;
};

const ALL_ITEMS: ElectiveScope = { itemIds: null, hasElectives: false, missingForm: false };

/** Secciones del instrumento con su rol. Barata y cacheable por instrumento. */
export async function loadSectionRoles(db: Database, instrumentId: string) {
  return db
    .select({
      id: instrumentSections.id,
      role: instrumentSections.role,
      electiveGroup: instrumentSections.electiveGroup,
      electiveKey: instrumentSections.electiveKey,
    })
    .from(instrumentSections)
    .where(eq(instrumentSections.instrumentId, instrumentId));
}

/**
 * Resuelve el alcance de un alumno. `assessmentId` es opcional: sin él no hay forma que
 * buscar y el resultado es "todos los ítems" salvo que el instrumento tenga electivas.
 */
export async function resolveElectiveScope(
  db: Database,
  params: { instrumentId: string; studentId?: string | null; assessmentId?: string | null },
): Promise<ElectiveScope> {
  const secciones = await loadSectionRoles(db, params.instrumentId);

  // La decisión de QUÉ secciones le tocan al alumno vive en una función pura en
  // `@soe/types` (`pickSectionsForStudent`), probada aparte. Acá sólo se buscan los datos.
  const forma =
    params.studentId && params.assessmentId
      ? (
          await db
            .select({ sectionIds: assessmentForms.sectionIds })
            .from(assessmentFormStudents)
            .innerJoin(
              assessmentForms,
              eq(assessmentForms.id, assessmentFormStudents.assessmentFormId),
            )
            .where(
              and(
                eq(assessmentFormStudents.studentId, params.studentId),
                eq(assessmentForms.assessmentId, params.assessmentId),
              ),
            )
        )[0]?.sectionIds
      : null;

  const decision = pickSectionsForStudent(
    secciones.map((s) => ({
      id: s.id,
      name: '',
      role: s.role,
      electiveGroup: s.electiveGroup,
      electiveKey: s.electiveKey,
    })),
    forma,
  );

  if (!decision.hasElectives) return ALL_ITEMS;
  if (decision.missingForm || !decision.sectionIds) {
    return { itemIds: null, hasElectives: true, missingForm: true };
  }

  const filas = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.instrumentId, params.instrumentId),
        inArray(items.sectionId, decision.sectionIds),
        isNull(items.deletedAt),
      ),
    );

  return { itemIds: filas.map((f) => f.id), hasElectives: true, missingForm: false };
}
