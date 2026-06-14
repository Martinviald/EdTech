// ─────────────────────────────────────────────────────────────────────────────
// Panel de calidad de instrumento (H20.9). Server Component: consume el
// `InstrumentQualityResponse` (determinista) ya cargado por la página. Muestra
// KR-20 + interpretación y una tabla de ítems con sus banderas (chips de color
// con tokens Tailwind) y sugerencias de corrección.
// ─────────────────────────────────────────────────────────────────────────────

import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { InstrumentQualityResponse } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FLAG_LABELS,
  flagTone,
  fmtMetric,
  fmtPctInt,
} from './quality-format';

export function QualityPanel({
  quality,
}: {
  quality: InstrumentQualityResponse;
}) {
  const { reliability, items, flaggedCount } = quality;
  const kr20Ok = reliability.kr20 !== null && reliability.kr20 >= 0.7;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {kr20Ok ? (
            <ShieldCheck className="size-5 text-success" aria-hidden />
          ) : (
            <ShieldAlert className="size-5 text-warning" aria-hidden />
          )}
          Calidad del instrumento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Confiabilidad: KR-20 + interpretación. */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={kr20Ok ? 'success' : 'warning'}>
              KR-20 {fmtMetric(reliability.kr20)}
            </Badge>
            <Badge variant="outline">
              {reliability.itemsAnalyzed} ítems · {reliability.studentsAnalyzed}{' '}
              alumnos
            </Badge>
            {flaggedCount > 0 ? (
              <Badge variant="warning">{flaggedCount} ítems con alertas</Badge>
            ) : (
              <Badge variant="success">Sin alertas de ítem</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {reliability.interpretation}
          </p>
        </div>

        {/* Tabla de ítems con banderas y sugerencias. */}
        {items.length === 0 ? (
          <EmptyState
            title="Sin ítems para analizar"
            description="No hay preguntas con respuestas suficientes para evaluar la calidad."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">N°</TableHead>
                  <TableHead>Habilidad / contenido</TableHead>
                  <TableHead className="w-16 text-center">Clave</TableHead>
                  <TableHead className="w-24 text-right">Dificultad</TableHead>
                  <TableHead className="w-24 text-right">Discrim.</TableHead>
                  <TableHead className="w-24 text-right">P. biserial</TableHead>
                  <TableHead>Alertas y sugerencias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.itemId}>
                    <TableCell className="font-medium">{item.position}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.skillName ?? item.contentName ?? '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.correctKey ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtPctInt(item.difficulty)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtMetric(item.discrimination)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtMetric(item.pointBiserial)}
                    </TableCell>
                    <TableCell>
                      {item.flags.length === 0 ? (
                        <span className="text-sm text-success">Sin alertas</span>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap gap-1.5">
                            {item.flags.map((flag) => (
                              <Badge key={flag} variant={flagTone(flag)}>
                                {FLAG_LABELS[flag]}
                              </Badge>
                            ))}
                          </div>
                          {item.suggestions.length > 0 ? (
                            <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                              {item.suggestions.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
