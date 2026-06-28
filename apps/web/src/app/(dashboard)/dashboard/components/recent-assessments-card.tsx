import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight, ClipboardList } from 'lucide-react';
import type { AssessmentOption } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';

function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Lista compacta de las últimas evaluaciones con resultados. Cada fila enlaza al
 * informe consolidado de esa evaluación (entrada al flujo de análisis).
 */
export function RecentAssessmentsCard({
  assessments,
  emptyDescription,
}: {
  assessments: AssessmentOption[];
  emptyDescription?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evaluaciones recientes</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {assessments.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={ClipboardList}
              title="Aún no hay evaluaciones con resultados"
              description={
                emptyDescription ??
                'Cuando se importen hojas de respuesta, las evaluaciones aparecerán aquí.'
              }
            />
          </div>
        ) : (
          <ul className="divide-y">
            {assessments.map((a) => {
              const date = formatDate(a.administeredAt);
              const meta = [a.subjectName, a.gradeName].filter(Boolean).join(' · ');
              return (
                <li key={a.assessmentId}>
                  <Link
                    href={`/evaluaciones/${a.assessmentId}` as Route}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.name ?? a.instrumentName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[meta, date, `${a.studentsCount} alumnos`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
