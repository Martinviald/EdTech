import type { NetworkSchoolRow } from '@soe/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BENCHMARK_BAND_ORDER,
  BENCHMARK_BAND_LABELS,
  BENCHMARK_BAND_BAR_CLASS,
  bandPercentage,
  bandDistributionTotal,
  formatAchievement,
} from './band-presentation';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Tabla identificada de la red/sostenedor (modo `network`). Lista los
// colegios de la red con su % de logro y distribución por banda, resaltando la
// fila del propio colegio (`isYou`). Se ordena alfabéticamente (NO por puntaje):
// sin rankings públicos 1-N. Server Component.
// ─────────────────────────────────────────────────────────────────────────────

function MiniBands({ row }: { row: NetworkSchoolRow }) {
  const total = bandDistributionTotal(row.bandDistribution);
  return (
    <div
      className="flex h-3 w-32 overflow-hidden rounded-full bg-muted"
      aria-label="Distribución por banda"
    >
      {total === 0
        ? null
        : BENCHMARK_BAND_ORDER.map((key) => {
            const pct = bandPercentage(row.bandDistribution, key);
            if (pct <= 0) return null;
            return (
              <div
                key={key}
                className={cn('h-full', BENCHMARK_BAND_BAR_CLASS[key])}
                style={{ width: `${pct}%` }}
                title={`${BENCHMARK_BAND_LABELS[key]}: ${pct.toFixed(1)}%`}
              />
            );
          })}
    </div>
  );
}

export function NetworkTable({ schools }: { schools: NetworkSchoolRow[] }) {
  const sorted = [...schools].sort((a, b) =>
    a.orgName.localeCompare(b.orgName, 'es'),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Colegios de tu red / sostenedor</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Colegio</TableHead>
                <TableHead className="min-w-[100px] text-center">% logro</TableHead>
                <TableHead className="min-w-[90px] text-center">Alumnos</TableHead>
                <TableHead className="min-w-[160px]">Distribución</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow
                  key={row.orgId}
                  className={cn(row.isYou && 'bg-primary/5 font-medium')}
                >
                  <TableCell className="align-middle">
                    <span className="inline-flex items-center gap-2">
                      {row.orgName}
                      {row.isYou ? (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                          Tu colegio
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {formatAchievement(row.avgAchievement)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {row.studentCount}
                  </TableCell>
                  <TableCell>
                    <MiniBands row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Listado alfabético, sin ranking. Comparación interna por acuerdo del
          sostenedor.
        </p>
      </CardContent>
    </Card>
  );
}
