import type { MasterBoardAcademicYear, MasterBoardTake } from '@soe/types';

export type TakeGroup = {
  academicYearId: string;
  label: string;
  takes: MasterBoardTake[];
};

/**
 * Agrupa las tomas por año académico para el selector. Los años quedan en el orden en que
 * aparecen (la API ordena las tomas de la más reciente a la más antigua) y, dentro de cada
 * año, las tomas de proceso van primero y las legacy ("sin proceso") al final.
 */
export function groupTakesByYear(
  takes: MasterBoardTake[],
  academicYears: MasterBoardAcademicYear[],
): TakeGroup[] {
  const yearLabels = new Map(academicYears.map((year) => [year.id, year.label]));
  const groups = new Map<string, TakeGroup>();
  for (const take of takes) {
    let group = groups.get(take.academicYearId);
    if (!group) {
      group = {
        academicYearId: take.academicYearId,
        label: yearLabels.get(take.academicYearId) ?? 'Año sin nombre',
        takes: [],
      };
      groups.set(take.academicYearId, group);
    }
    group.takes.push(take);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    takes: [
      ...group.takes.filter((take) => take.processId !== null),
      ...group.takes.filter((take) => take.processId === null),
    ],
  }));
}

const DAY_MONTH = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function formatIsoDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  return DAY_MONTH.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** Ventana de aplicación de la toma, ej. "12 mar – 14 mar". `null` si no hay fechas. */
export function formatTakeWindow(
  take: Pick<MasterBoardTake, 'administeredFrom' | 'administeredTo'>,
): string | null {
  const from = take.administeredFrom ? formatIsoDate(take.administeredFrom) : null;
  const to = take.administeredTo ? formatIsoDate(take.administeredTo) : null;
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from ?? to;
}

export function assessmentCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'evaluación' : 'evaluaciones'}`;
}
