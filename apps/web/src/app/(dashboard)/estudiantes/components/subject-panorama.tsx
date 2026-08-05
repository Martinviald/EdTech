'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { ArrowRight } from 'lucide-react';
import type { StudentPanoramaSubject } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';
import { SeriesTrack } from './series-track';

export function SubjectPanorama({
  studentId,
  subjects,
  activeSubjectId,
}: {
  studentId: string;
  subjects: StudentPanoramaSubject[];
  activeSubjectId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const focus = (subjectId: string | null) => {
    if (subjectId === null) return;
    const params = new URLSearchParams(searchParams.toString());
    if (activeSubjectId === subjectId) params.delete('subjectId');
    else params.set('subjectId', subjectId);
    const qs = params.toString();
    startTransition(() => {
      router.push(`/estudiantes/${studentId}${qs ? `?${qs}` : ''}` as Route);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {subjects.map((subject) => {
        const isActive = subject.subjectId !== null && subject.subjectId === activeSubjectId;
        return (
          <Card
            key={subject.subjectId ?? 'sin-asignatura'}
            className={isActive ? 'ring-1 ring-primary' : undefined}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-base">
                  {subject.subjectName ?? 'Sin asignatura'}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {subject.assessmentsCount}{' '}
                  {subject.assessmentsCount === 1 ? 'evaluación' : 'evaluaciones'}
                </p>
              </div>
              {subject.latest ? (
                <PerformanceBadge
                  level={subject.latest.performanceLevel}
                  band={subject.latest.performanceBand}
                />
              ) : null}
            </CardHeader>

            <CardContent className="space-y-3">
              {subject.achievement !== null ? (
                <p className="text-2xl font-semibold tabular-nums">
                  {formatAchievement(subject.achievement)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{subject.comparability.reason}</p>
              )}

              {subject.series.length > 0 ? (
                <div className="space-y-3">
                  {subject.series.map((series) => (
                    <SeriesTrack key={`${series.kind}-${series.key}`} series={series} />
                  ))}
                </div>
              ) : null}

              {subject.subjectId !== null ? (
                <button
                  type="button"
                  onClick={() => focus(subject.subjectId)}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline disabled:opacity-60"
                >
                  {isActive ? 'Quitar el foco' : 'Ver sólo esta asignatura'}
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
              ) : null}

              {subject.comparability.instrumentIds.length > 1 ? (
                <Badge variant="outline" className="text-2xs">
                  {subject.comparability.instrumentIds.length} instrumentos
                </Badge>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
