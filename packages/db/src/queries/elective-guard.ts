import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { instrumentSections } from '../schema/instruments';

/**
 * Aborta si el instrumento tiene secciones electivas.
 *
 * Los importadores de seed crean el assessment ellos mismos y cargan por curso completo:
 * no tienen —ni pueden tener— la asignación alumno↔forma en el momento de escribir. Si
 * corrieran igual, le fabricarían a cada alumno respuestas incorrectas por las ramas que
 * no rindió, y el resultado sería un porcentaje falso SIN ningún error.
 *
 * Por eso fallan en seco en vez de adivinar. La carga de un instrumento con electivas va
 * por el camino de la ingesta de hojas, que sí resuelve la forma de cada alumno
 * (`resolveElectiveScope`), o por un cargador que reciba las formas explícitamente.
 */
export async function assertNoElectiveSections(
  db: Database,
  instrumentId: string,
  contexto: string,
): Promise<void> {
  const electivas = await db
    .select({ id: instrumentSections.id, key: instrumentSections.electiveKey })
    .from(instrumentSections)
    .where(eq(instrumentSections.instrumentId, instrumentId));
  const cuantas = electivas.filter((s) => s.key !== null).length;
  if (cuantas === 0) return;
  throw new Error(
    `${contexto}: el instrumento tiene ${cuantas} sección(es) electiva(s). Este cargador ` +
      'escribe una respuesta por CADA ítem del instrumento, así que le inventaría respuestas ' +
      'incorrectas por las ramas que el alumno no rindió. Usa el camino que resuelve la forma ' +
      'de cada alumno (ver resolveElectiveScope / assessment_form_students).',
  );
}
