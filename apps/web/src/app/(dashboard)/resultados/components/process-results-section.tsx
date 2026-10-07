import { deriveProcessRollup } from '@soe/types';
import { coverageSummaryOf } from '@/components/procesos/band-view';
import { ProcessLevelHeadline } from '@/components/procesos/process-level-headline';
import { ProcessResultsMatrix } from '@/components/procesos/process-results-matrix';
import { getProcessCoverage } from '../../procesos/data';
import { getComparableOverview, getDashboardFilters } from '../data';

/**
 * La síntesis por conteo y la matriz del proceso activo, dentro del panorama.
 *
 * Vive acá y no en la ficha del proceso porque es análisis, y el análisis tiene
 * los filtros, la tabla de unidades y las pestañas al lado. Lo que D4 exige —que
 * el denominador viaje con la síntesis— lo cumple la banda de previsualización,
 * que está justo arriba con su barra de cobertura.
 *
 * No agrega queries de resultados: `getComparableOverview` está cacheado por
 * request, así que esta llamada se deduplica con la del panorama y la de la
 * banda. Lo único nuevo es `/coverage`, y sólo cuando hay proceso activo.
 *
 * Ver la enmienda §14 de docs/diseno-resultados-del-proceso.md.
 */
export async function ProcessResultsSection({
  processId,
  scopedQuery,
}: {
  processId: string;
  scopedQuery: string;
}) {
  const comparable = await getComparableOverview(scopedQuery).catch(() => null);
  if (!comparable || comparable.units.length === 0) return null;

  // Misma regla que la ficha del proceso: el denominador de `/coverage` es el del
  // colegio entero, así que con alcance docente no se entrega. Un profesor no
  // puede ver celdas de cursos que no son suyos ni un cociente contra ellas.
  const orgScoped = comparable.scope === 'org';
  const coverage = orgScoped ? await getProcessCoverage(processId).catch(() => null) : null;

  const rollup = deriveProcessRollup(comparable.units, coverage, await gradeOrderOf(scopedQuery));
  if (rollup.totals.classifications === 0) return null;

  return (
    <>
      <ProcessLevelHeadline
        rollup={rollup}
        coverageSummary={coverageSummaryOf(rollup, coverage, orgScoped)}
      />
      <ProcessResultsMatrix rollup={rollup} coverage={coverage} processId={processId} />
    </>
  );
}

/**
 * El orden pedagógico de los grados, por `gradeId`.
 *
 * `ComparableUnitSummary` no trae el orden del grado, así que sin esto las filas
 * de la matriz salen en el orden de severidad de las unidades. El índice de
 * `options.grades` sí es el orden: esa query ordena por `grades.order` y el Map
 * que la agrupa conserva la inserción (`dashboards.service.ts:327-335`).
 */
async function gradeOrderOf(scopedQuery: string): Promise<ReadonlyMap<string, number>> {
  const options = await getDashboardFilters(scopedQuery).catch(() => null);
  return new Map((options?.grades ?? []).map((grade, index) => [grade.id, index]));
}
