import type {
  ComparableUnitSummary,
  GenerationalHighlight,
} from '../schemas/comparable-overview.schema';

/**
 * Deriva el movimiento por generación a partir de las unidades comparables ya
 * resueltas: agrupa por (asignatura × nivel) las que tienen baseline `previous_year` y
 * pondera por alumnos.
 *
 * Es una función PURA y vive en `packages/types` a propósito: no necesita tocar la base
 * —toda la información ya viaja en `units`— y así la misma regla se puede probar sola y
 * reutilizar desde la web si algún día conviene calcularla en el cliente.
 *
 * Sólo entra el baseline `previous_year`: es el único que compara generaciones
 * (distintos alumnos, mismo nivel, mismo instrumento). `previous_period` compara al
 * MISMO grupo consigo mismo a lo largo del año — es progresión, no generación, y
 * mezclarlos daría un número que no se puede nombrar.
 */
export function deriveGenerationalHighlights(
  units: readonly ComparableUnitSummary[],
): GenerationalHighlight[] {
  type Acc = {
    gradeId: string | null;
    gradeName: string | null;
    subjectId: string | null;
    subjectName: string | null;
    applicationPeriods: Set<string>;
    year: number | null;
    baselineYear: number | null;
    weighted: number;
    baselineWeighted: number;
    weight: number;
    students: number;
    instrumentIds: string[];
  };

  const byCell = new Map<string, Acc>();

  for (const unit of units) {
    if (unit.baseline?.kind !== 'previous_year') continue;
    if (unit.averageAchievement == null || unit.baseline.achievement == null) continue;
    if (unit.studentsAssessed === 0) continue;

    const key = `${unit.gradeId ?? '-'}|${unit.subjectId ?? '-'}`;
    let acc = byCell.get(key);
    if (!acc) {
      acc = {
        gradeId: unit.gradeId,
        gradeName: unit.gradeName,
        subjectId: unit.subjectId,
        subjectName: unit.subjectName,
        applicationPeriods: new Set(),
        year: unit.year,
        baselineYear: unit.year == null ? null : unit.year - 1,
        weighted: 0,
        baselineWeighted: 0,
        weight: 0,
        students: 0,
        instrumentIds: [],
      };
      byCell.set(key, acc);
    }

    if (unit.applicationPeriod) acc.applicationPeriods.add(unit.applicationPeriod);
    acc.weighted += unit.averageAchievement * unit.studentsAssessed;
    acc.baselineWeighted += unit.baseline.achievement * unit.studentsAssessed;
    acc.weight += unit.studentsAssessed;
    acc.students += unit.studentsAssessed;
    acc.instrumentIds.push(unit.instrumentId);
    if (unit.year != null && (acc.year == null || unit.year > acc.year)) {
      acc.year = unit.year;
      acc.baselineYear = unit.year - 1;
    }
  }

  return Array.from(byCell.values())
    .map((acc) => {
      const achievement = acc.weight > 0 ? acc.weighted / acc.weight : null;
      const baselineAchievement = acc.weight > 0 ? acc.baselineWeighted / acc.weight : null;
      const deltaPp =
        achievement == null || baselineAchievement == null
          ? null
          : Number((achievement - baselineAchievement).toFixed(1));
      const periods = Array.from(acc.applicationPeriods);
      return {
        gradeId: acc.gradeId,
        gradeName: acc.gradeName,
        subjectId: acc.subjectId,
        subjectName: acc.subjectName,
        applicationPeriod: (periods.length === 1
          ? periods[0]
          : null) as GenerationalHighlight['applicationPeriod'],
        year: acc.year,
        baselineYear: acc.baselineYear,
        achievement,
        baselineAchievement,
        deltaPp,
        studentsAssessed: acc.students,
        instrumentIds: acc.instrumentIds,
      };
    })
    .sort((a, b) => (a.deltaPp ?? 0) - (b.deltaPp ?? 0));
}
