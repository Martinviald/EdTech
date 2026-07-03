import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, CalendarDays, GraduationCap, Users } from 'lucide-react';
import type { AssessmentOption } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ─────────────────────────────────────────────────────────────────────────────
// Lista de evaluaciones (H6 / hub de evaluación). Cada tarjeta es el punto de
// entrada al hub `/evaluaciones/[assessmentId]`. Reemplaza conceptualmente el
// dropdown enterrado dentro de Resultados: la evaluación es el objeto navegable.
// Server Component: solo presentación + enlaces.
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function AssessmentList({ assessments }: { assessments: AssessmentOption[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {assessments.map((a) => {
        const title = a.name ?? a.instrumentName;
        const date = formatDate(a.administeredAt);
        const meta = [a.subjectName, a.gradeName].filter(Boolean).join(' · ');
        return (
          <Link
            key={a.assessmentId}
            href={`/evaluaciones/${a.assessmentId}` as Route}
            className="group rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="h-full transition-colors group-hover:border-primary">
              <CardContent className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold leading-tight">{title}</h2>
                  <ArrowRight
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden
                  />
                </div>

                <p className="text-sm text-muted-foreground">{a.instrumentName}</p>

                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {meta ? (
                    <span className="inline-flex items-center gap-1">
                      <GraduationCap className="size-3.5" aria-hidden />
                      {meta}
                    </span>
                  ) : null}
                  {date ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3.5" aria-hidden />
                      {date}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden />
                    {a.studentsCount} alumnos
                  </span>
                  {a.instrumentType ? (
                    <Badge variant="secondary" className="uppercase">
                      {a.instrumentType}
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
