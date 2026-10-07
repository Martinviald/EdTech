import { deriveProcessRollup, type FilterOption } from '@soe/types';
import { coverageSummaryOf, processCoverageApplies } from '@/components/procesos/band-view';
import { ProcessLevelHeadline } from '@/components/procesos/process-level-headline';
import { ProcessResultsMatrix } from '@/components/procesos/process-results-matrix';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { getProcessCoverage } from '../../procesos/data';
import { getComparableOverview } from '../data';

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
 * banda. Lo único nuevo es `/coverage`, y sólo cuando hay proceso activo sin
 * filtros que lo recorten.
 *
 * Ver la enmienda §14 de docs/diseno-resultados-del-proceso.md.
 */
export async function ProcessResultsSection({
  processId,
  scopedQuery,
  grades,
  narrowedByFilters,
}: {
  processId: string;
  scopedQuery: string;
  /** Catálogo de grados del panorama, ya ordenado por `grades.order`. */
  grades: readonly FilterOption[];
  narrowedByFilters: boolean;
}) {
  const comparable = await getComparableOverview(scopedQuery).catch(() => null);
  if (!comparable || comparable.units.length === 0) return null;

  // El denominador de `/coverage` es el del proceso COMPLETO: no acepta filtros ni
  // recorta por alcance docente. Cruzarlo con un numerador ya recortado hunde el
  // cociente bajo el piso del titular y marca "sin niveles" las celdas de lo
  // filtrado. Así que se pide sólo cuando el numerador cubre lo mismo.
  const orgScoped = comparable.scope === 'org';
  const coverageApplies = processCoverageApplies({ orgScoped, narrowedByFilters });
  const fetched = coverageApplies
    ? await getProcessCoverage(processId).then(
        (coverage) => ({ ok: true, coverage }),
        () => ({ ok: false, coverage: null }),
      )
    : { ok: true, coverage: null };

  const rollup = deriveProcessRollup(
    comparable.units,
    fetched.coverage,
    new Map(grades.map((grade, index) => [grade.id, index])),
  );
  if (rollup.totals.classifications === 0) return null;

  return (
    <>
      {!fetched.ok && (
        <AlertCallout tone="warning" title="No se pudo leer la cobertura del proceso">
          El titular va sin denominador: no se sabe cuántas celdas faltan por cargar, así que no se
          puede saber si lo que muestra es el resultado del proceso o sólo de lo que ya se cargó.
          Vuelve a intentar en un momento.
        </AlertCallout>
      )}
      <ProcessLevelHeadline
        rollup={rollup}
        coverageSummary={coverageSummaryOf(fetched.coverage, orgScoped)}
      />
      <ProcessResultsMatrix
        rollup={rollup}
        coverage={fetched.coverage}
        processId={processId}
        baseQuery={scopedQuery}
      />
    </>
  );
}
