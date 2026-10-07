import { compareSeverity } from '../comparability';
import type { ComparableUnitSummary, UnitSeverity } from '../schemas/comparable-overview.schema';
import type { PerformanceBandDistributionBucket } from '../schemas/dashboard.schema';
import type {
  ProcessCoverageCell,
  ProcessCoverageCellStatus,
  ProcessCoverageResponse,
} from '../schemas/measurement-process.schema';
import type { PerformanceBandView } from '../schemas/performance-band.schema';

/**
 * Fracción de las clasificaciones esperadas bajo la cual no se muestra el
 * titular por nivel y en su lugar se muestra el estado de carga.
 *
 * Un proceso a medio cargar produce un titular engañosamente optimista: las
 * celdas que faltan son justo las que lo moverían. En la base de desarrollo el
 * Cierre tiene el 34 % cargado y su 18,4 % en el nivel más bajo es MÁS BAJO que
 * el del Diagnóstico completo (23,9 %), y eso no es una mejora.
 *
 * 0,6 separa esos tres procesos como se quiere; no está medido contra uso real.
 */
export const PROCESS_HEADLINE_COVERAGE_FLOOR = 0.6;

export type ProcessLadderBucket = {
  key: string;
  label: string;
  order: number;
  color: string | null;
  classifications: number;
  percentage: number;
};

/** Unidades que comparten estructura ordinal de bandas (borde L1). */
export type ProcessLadderRollup = {
  ladderKey: string;
  bands: PerformanceBandView[];
  buckets: ProcessLadderBucket[];
  classifications: number;
  units: number;
  lowestBandShare: number | null;
};

export type ProcessMatrixAxis = { id: string; name: string; order: number };

/**
 * Los conteos por banda de una celda, para UNA escalera (borde L1).
 *
 * `classifications` es el denominador honesto de esta escalera dentro de la
 * celda: la suma de sus propios conteos, no el total de la celda. Las unidades
 * sin bandas aportan a `ProcessMatrixCell.classifications` y no a esto.
 */
export type ProcessCellLadder = {
  ladderKey: string;
  bands: PerformanceBandView[];
  buckets: ProcessLadderBucket[];
  classifications: number;
};

export type ProcessMatrixCell = {
  gradeId: string | null;
  subjectId: string | null;
  unitKeys: string[];
  assessmentIds: string[];
  severity: UnitSeverity | null;
  /**
   * El share MÁXIMO de las unidades de la celda, no el de la celda.
   *
   * Se conserva porque es lo que ordena y alerta desde antes, pero no se puede
   * mostrar junto a `classifications`: ése es la SUMA de todas las unidades, y
   * la yuxtaposición afirma un denominador compartido que no existe. Para
   * mostrar, usa `lowestBand`.
   */
  lowestBandShare: number | null;
  classifications: number;
  coverage: ProcessCoverageCellStatus | null;
  /** Conteos por banda de la celda, agrupados por escalera. */
  ladders: ProcessCellLadder[];
  /**
   * La concentración en la banda más baja de la celda, con su propio
   * denominador. `null` cuando la celda mezcla escaleras distintas: alinear sus
   * ordinales a la fuerza es lo que D2 prohíbe, y entonces no hay un número.
   */
  lowestBand: { classifications: number; of: number; share: number } | null;
};

export type ProcessSubjectRollup = {
  subjectId: string | null;
  subjectName: string | null;
  units: number;
  classifications: number;
  bySeverity: Record<UnitSeverity, number>;
  unclassifiedUnits: number;
  worstUnitKey: string | null;
  worstLowestBandShare: number | null;
};

export type ProcessResultsRollup = {
  ladders: ProcessLadderRollup[];
  matrix: {
    grades: ProcessMatrixAxis[];
    subjects: ProcessMatrixAxis[];
    cells: ProcessMatrixCell[];
  };
  bySubject: ProcessSubjectRollup[];
  unclassified: { units: number; classifications: number };
  totals: {
    classifications: number;
    expectedClassifications: number | null;
    unitsWithMeasuredCut: number | null;
    units: number;
  };
};

const COVERAGE_RANK: Record<ProcessCoverageCellStatus, number> = {
  missing: 0,
  scheduled: 1,
  partial: 2,
  complete: 3,
};

function ladderKeyOf(bands: readonly PerformanceBandView[]): string {
  return bands
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((b) => `${b.order}:${b.key}`)
    .join('|');
}

function emptySeverityCount(): Record<UnitSeverity, number> {
  return { high: 0, medium: 0, low: 0 };
}

function worseCoverage(
  a: ProcessCoverageCellStatus | null,
  b: ProcessCoverageCellStatus,
): ProcessCoverageCellStatus {
  if (a === null) return b;
  return COVERAGE_RANK[b] < COVERAGE_RANK[a] ? b : a;
}

function foldBuckets(
  into: Map<string, ProcessLadderBucket>,
  distribution: readonly PerformanceBandDistributionBucket[],
): void {
  for (const bucket of distribution) {
    const found = into.get(bucket.key);
    if (found) {
      found.classifications += bucket.count;
      continue;
    }
    into.set(bucket.key, {
      key: bucket.key,
      label: bucket.label,
      order: bucket.order,
      color: bucket.color,
      classifications: bucket.count,
      percentage: 0,
    });
  }
}

/**
 * Pliega las unidades comparables de un proceso en conteos de clasificaciones.
 *
 * La regla es una: **se suman clasificaciones, no se promedian puntajes**. El
 * puntaje vive en la escala de su instrumento y promediarlo entre pruebas de
 * distinta dificultad no produce un número interpretable (#1C). La banda sí es
 * comparable: el corte difiere entre pruebas precisamente para que la etiqueta
 * no difiera, así que sumar veredictos es contar personas.
 *
 * Los cuatro bordes que la sostienen están implementados acá:
 *
 * - **L1** sólo se suman en una misma barra las unidades con estructura ordinal
 *   de bandas idéntica. Dos escaleras distintas producen dos barras, nunca una
 *   con los ordinales alineados a la fuerza.
 * - **L2** la unidad contada es la clasificación, no el alumno: quien rindió
 *   cuatro asignaturas aporta cuatro. El conteo de alumnos distintos es otro
 *   número y vive en el modelo del proceso.
 * - **L3** no se emite ningún delta de proceso contra proceso; la comparación
 *   legítima es por celda y ya la resuelve el `baseline` de cada unidad.
 * - **L4** `unitsWithMeasuredCut` cuenta sólo las unidades cuyo corte se declaró
 *   medido. Sin esa declaración no afirma nada: `null`.
 */
export function deriveProcessRollup(
  units: readonly ComparableUnitSummary[],
  coverage: ProcessCoverageResponse | null,
): ProcessResultsRollup {
  const ladders = new Map<
    string,
    { bands: PerformanceBandView[]; buckets: Map<string, ProcessLadderBucket>; units: number }
  >();
  const unclassified = { units: 0, classifications: 0 };
  let classifications = 0;
  let declaredCuts = 0;
  let anyCutDeclared = false;

  for (const unit of units) {
    classifications += unit.studentsAssessed;

    for (const band of unit.bands ?? []) {
      if (band.source === undefined || band.source === 'unknown') continue;
      anyCutDeclared = true;
      break;
    }
    if ((unit.bands ?? []).some((b) => b.source === 'measured')) declaredCuts += 1;

    if (!unit.bands || unit.bands.length === 0 || !unit.bandDistribution) {
      unclassified.units += 1;
      unclassified.classifications += unit.studentsAssessed;
      continue;
    }

    const key = ladderKeyOf(unit.bands);
    let ladder = ladders.get(key);
    if (!ladder) {
      ladder = {
        bands: unit.bands.slice().sort((a, b) => a.order - b.order),
        buckets: new Map(),
        units: 0,
      };
      ladders.set(key, ladder);
    }
    ladder.units += 1;
    foldBuckets(ladder.buckets, unit.bandDistribution);
  }

  const ladderRollups: ProcessLadderRollup[] = Array.from(ladders.entries())
    .map(([ladderKey, ladder]) => {
      const buckets = Array.from(ladder.buckets.values()).sort((a, b) => a.order - b.order);
      const total = buckets.reduce((acc, b) => acc + b.classifications, 0);
      for (const bucket of buckets) {
        bucket.percentage = total > 0 ? (bucket.classifications / total) * 100 : 0;
      }
      return {
        ladderKey,
        bands: ladder.bands,
        buckets,
        classifications: total,
        units: ladder.units,
        lowestBandShare: total > 0 && buckets[0] ? buckets[0].percentage : null,
      };
    })
    .sort((a, b) => b.classifications - a.classifications);

  const gradeAxis = new Map<string, ProcessMatrixAxis>();
  const subjectAxis = new Map<string, ProcessMatrixAxis>();
  const cells = new Map<string, ProcessMatrixCell>();
  const cellLadders = new Map<
    string,
    Map<string, { bands: PerformanceBandView[]; buckets: Map<string, ProcessLadderBucket> }>
  >();
  const cellKey = (gradeId: string | null, subjectId: string | null) =>
    `${gradeId ?? '-'}::${subjectId ?? '-'}`;

  for (const cell of coverage?.cells ?? []) {
    if (!gradeAxis.has(cell.gradeId)) {
      gradeAxis.set(cell.gradeId, {
        id: cell.gradeId,
        name: cell.gradeShortName,
        order: cell.gradeOrder,
      });
    }
    if (!subjectAxis.has(cell.subjectId)) {
      subjectAxis.set(cell.subjectId, { id: cell.subjectId, name: cell.subjectName, order: 0 });
    }
    const key = cellKey(cell.gradeId, cell.subjectId);
    const found = cells.get(key);
    if (found) {
      found.coverage = worseCoverage(found.coverage, cell.status);
      if (cell.assessmentId) found.assessmentIds.push(cell.assessmentId);
      continue;
    }
    cells.set(key, {
      gradeId: cell.gradeId,
      subjectId: cell.subjectId,
      unitKeys: [],
      assessmentIds: cell.assessmentId ? [cell.assessmentId] : [],
      severity: null,
      lowestBandShare: null,
      classifications: 0,
      coverage: cell.status,
      ladders: [],
      lowestBand: null,
    });
  }

  for (const unit of units) {
    if (unit.gradeId && !gradeAxis.has(unit.gradeId)) {
      gradeAxis.set(unit.gradeId, {
        id: unit.gradeId,
        name: unit.gradeName ?? '—',
        order: Number.MAX_SAFE_INTEGER,
      });
    }
    if (unit.subjectId && !subjectAxis.has(unit.subjectId)) {
      subjectAxis.set(unit.subjectId, {
        id: unit.subjectId,
        name: unit.subjectName ?? '—',
        order: 0,
      });
    }
    const key = cellKey(unit.gradeId, unit.subjectId);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        gradeId: unit.gradeId,
        subjectId: unit.subjectId,
        unitKeys: [],
        assessmentIds: [],
        severity: null,
        lowestBandShare: null,
        classifications: 0,
        coverage: null,
        ladders: [],
        lowestBand: null,
      };
      cells.set(key, cell);
    }
    cell.unitKeys.push(unit.key);
    for (const id of unit.assessmentIds) {
      if (!cell.assessmentIds.includes(id)) cell.assessmentIds.push(id);
    }
    cell.classifications += unit.studentsAssessed;
    cell.coverage = null;
    if (compareSeverity(unit.severity, cell.severity) < 0) cell.severity = unit.severity;
    if (
      unit.lowestBandShare != null &&
      (cell.lowestBandShare == null || unit.lowestBandShare > cell.lowestBandShare)
    ) {
      cell.lowestBandShare = unit.lowestBandShare;
    }

    // Los conteos por banda de la celda, por escalera. Misma regla que la barra
    // del titular (L1): sólo se suman unidades con la misma estructura ordinal.
    if (unit.bands && unit.bands.length > 0 && unit.bandDistribution) {
      let ladderMap = cellLadders.get(key);
      if (!ladderMap) {
        ladderMap = new Map();
        cellLadders.set(key, ladderMap);
      }
      const ladderKey = ladderKeyOf(unit.bands);
      let ladder = ladderMap.get(ladderKey);
      if (!ladder) {
        ladder = {
          bands: unit.bands.slice().sort((a, b) => a.order - b.order),
          buckets: new Map(),
        };
        ladderMap.set(ladderKey, ladder);
      }
      foldBuckets(ladder.buckets, unit.bandDistribution);
    }
  }

  for (const [key, ladderMap] of cellLadders) {
    const cell = cells.get(key);
    if (!cell) continue;

    cell.ladders = Array.from(ladderMap.entries())
      .map(([ladderKey, ladder]) => {
        const buckets = Array.from(ladder.buckets.values()).sort((a, b) => a.order - b.order);
        const total = buckets.reduce((acc, b) => acc + b.classifications, 0);
        for (const bucket of buckets) {
          bucket.percentage = total > 0 ? (bucket.classifications / total) * 100 : 0;
        }
        return { ladderKey, bands: ladder.bands, buckets, classifications: total };
      })
      .sort((a, b) => b.classifications - a.classifications);

    // Con más de una escalera no hay un número: sumar ordinales de escaleras
    // distintas es exactamente lo que D2 prohíbe.
    const only = cell.ladders.length === 1 ? cell.ladders[0] : null;
    const lowest = only?.buckets[0];
    cell.lowestBand =
      only && lowest && only.classifications > 0
        ? {
            classifications: lowest.classifications,
            of: only.classifications,
            share: (lowest.classifications / only.classifications) * 100,
          }
        : null;
  }

  const bySubject = new Map<string, ProcessSubjectRollup>();
  for (const unit of units) {
    const id = unit.subjectId ?? '-';
    let row = bySubject.get(id);
    if (!row) {
      row = {
        subjectId: unit.subjectId,
        subjectName: unit.subjectName,
        units: 0,
        classifications: 0,
        bySeverity: emptySeverityCount(),
        unclassifiedUnits: 0,
        worstUnitKey: null,
        worstLowestBandShare: null,
      };
      bySubject.set(id, row);
    }
    row.units += 1;
    row.classifications += unit.studentsAssessed;
    if (unit.severity) row.bySeverity[unit.severity] += 1;
    else row.unclassifiedUnits += 1;
    if (
      unit.lowestBandShare != null &&
      (row.worstLowestBandShare == null || unit.lowestBandShare > row.worstLowestBandShare)
    ) {
      row.worstLowestBandShare = unit.lowestBandShare;
      row.worstUnitKey = unit.key;
    }
  }

  return {
    ladders: ladderRollups,
    matrix: {
      grades: Array.from(gradeAxis.values()).sort((a, b) => a.order - b.order),
      subjects: Array.from(subjectAxis.values()).sort((a, b) => a.name.localeCompare(b.name)),
      cells: Array.from(cells.values()),
    },
    bySubject: Array.from(bySubject.values()).sort((a, b) =>
      (a.subjectName ?? '').localeCompare(b.subjectName ?? ''),
    ),
    unclassified,
    totals: {
      classifications,
      expectedClassifications: expectedClassificationsOf(coverage?.cells),
      unitsWithMeasuredCut: anyCutDeclared ? declaredCuts : null,
      units: units.length,
    },
  };
}

function expectedClassificationsOf(
  cells: readonly ProcessCoverageCell[] | undefined,
): number | null {
  if (!cells || cells.length === 0) return null;
  return cells.reduce((acc, cell) => acc + cell.studentsExpected, 0);
}

/**
 * ¿Hay suficiente cargado para que el titular por nivel signifique algo?
 *
 * Sin denominador esperado no se puede decidir, y entonces no se gatea: callar
 * un número por no saber cuánto falta sería peor que mostrarlo con su conteo.
 */
export function isHeadlineTrustworthy(totals: ProcessResultsRollup['totals']): boolean {
  if (totals.expectedClassifications == null || totals.expectedClassifications === 0) return true;
  return totals.classifications / totals.expectedClassifications >= PROCESS_HEADLINE_COVERAGE_FLOOR;
}
