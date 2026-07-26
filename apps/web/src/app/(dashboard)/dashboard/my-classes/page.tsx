import Link from 'next/link';
import { ArrowRight, BookOpen, Upload } from 'lucide-react';
import { redirect } from 'next/navigation';
import { canAccess, IMPORT_ROLES } from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { listClassGroupsForUser } from '@/lib/teacherAssignmentsApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared';

export default async function MyClassesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);

  const rows = await listClassGroupsForUser(session.user.orgId);

  // Agrupa por curso para no repetir el encabezado en cada asignatura.
  const grouped = new Map<
    string,
    {
      classGroupId: string;
      className: string;
      gradeShortName: string;
      academicYear: number;
      subjects: Array<{
        subjectClassId: string;
        subjectName: string;
        subjectShortName: string;
        role: string | null;
      }>;
    }
  >();

  for (const r of rows) {
    if (!grouped.has(r.classGroupId)) {
      grouped.set(r.classGroupId, {
        classGroupId: r.classGroupId,
        className: r.className,
        gradeShortName: r.gradeShortName,
        academicYear: r.academicYear,
        subjects: [],
      });
    }
    if (r.subjectClassId && r.subjectName) {
      grouped.get(r.classGroupId)!.subjects.push({
        subjectClassId: r.subjectClassId,
        subjectName: r.subjectName,
        subjectShortName: r.subjectShortName ?? r.subjectName,
        role: r.assignmentRole,
      });
    }
  }

  const cards = [...grouped.values()];
  const canImport = canAccess(session.user.roles, IMPORT_ROLES);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {canImport ? (
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.importarAlumnos}>
              <Upload className="mr-2 size-4" aria-hidden />
              Importar alumnos
            </Link>
          </Button>
        ) : null}
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin cursos asignados"
          description="Aún no tienes asignaciones académicas. Contacta a tu director o coordinador para que te asigne carga."
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border">
          {cards.map((c) => (
            <Link
              key={c.classGroupId}
              href={ROUTES.myClass(c.classGroupId)}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-medium leading-tight group-hover:text-primary">
                    {c.gradeShortName} · {c.className}
                  </h2>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Año {c.academicYear}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {c.subjects.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Sin asignaturas asignadas</span>
                  ) : (
                    c.subjects.map((s) => (
                      <Badge
                        key={s.subjectClassId}
                        variant={
                          s.role === 'primary'
                            ? 'default'
                            : s.role === 'assistant'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="font-normal"
                      >
                        {s.subjectShortName}
                        {s.role === 'primary'
                          ? ' · Titular'
                          : s.role === 'assistant'
                            ? ' · Asistente'
                            : ''}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
