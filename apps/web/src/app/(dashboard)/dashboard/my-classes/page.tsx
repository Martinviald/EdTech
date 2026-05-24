import { BookOpen } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { listClassGroupsForUser } from '@/lib/teacherAssignmentsApi';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';

export default async function MyClassesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mis cursos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cursos y asignaturas que tienes asignadas en el año académico vigente.
        </p>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin cursos asignados"
          description="Aún no tienes asignaciones académicas. Contacta a tu director o coordinador para que te asigne carga."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Card key={c.classGroupId}>
              <CardHeader>
                <CardTitle className="text-base">
                  {c.gradeShortName} · {c.className}
                </CardTitle>
                <p className="text-xs text-muted-foreground">Año {c.academicYear}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {c.subjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin asignaturas asignadas.</p>
                ) : (
                  c.subjects.map((s) => (
                    <div
                      key={s.subjectClassId}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{s.subjectName}</span>
                      <Badge variant={s.role === 'primary' ? 'default' : 'secondary'}>
                        {s.role === 'primary' ? 'Titular' : 'Asistente'}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
