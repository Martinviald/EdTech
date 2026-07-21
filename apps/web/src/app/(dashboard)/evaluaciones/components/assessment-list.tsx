import Link from 'next/link';
import { ArrowRight, CalendarDays, GraduationCap, Users } from 'lucide-react';
import type { AssessmentOption } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { ROUTES } from '@/lib/routes';

// ─────────────────────────────────────────────────────────────────────────────
// Lista de evaluaciones (H6 / hub de evaluación). Cada fila es el punto de
// entrada al hub `/evaluaciones/[assessmentId]`. Formato de lista densa (TKT-08,
// antes grid de "calugas") para escanear y comparar muchas evaluaciones de un
// vistazo. Server Component: solo presentación + enlaces.
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
    <div className="divide-y overflow-hidden rounded-lg border">
      {assessments.map((a) => {
        const title = a.name ?? a.instrumentName;
        const date = formatDate(a.administeredAt);
        const meta = [a.subjectName, a.gradeName].filter(Boolean).join(' · ');
        return (
          <Link
            key={a.assessmentId}
            href={ROUTES.evaluacion(a.assessmentId)}
            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-medium leading-tight group-hover:text-primary">
                  {title}
                </h2>
                {a.instrumentType ? (
                  <Badge variant="secondary" className="shrink-0 uppercase">
                    {a.instrumentType}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="truncate">{a.instrumentName}</span>
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
              </div>
            </div>
            <ArrowRight
              className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
              aria-hidden
            />
          </Link>
        );
      })}
    </div>
  );
}
