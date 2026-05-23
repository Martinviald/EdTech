import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { schema } from '@soe/db';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { SetupWizard } from './SetupWizard';

export default async function ConfigurarColegioPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const { orgId, role } = session.user;

  if (!['school_admin', 'platform_admin'].includes(role)) {
    redirect('/dashboard');
  }

  const [org, grades, subjects] = await Promise.all([
    db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1)
      .then((rows) => rows[0]),
    db.select().from(schema.grades).orderBy(schema.grades.order),
    db.select().from(schema.subjects).orderBy(schema.subjects.name),
  ]);

  if (!org) redirect('/dashboard');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurar colegio</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Completa la información de tu institución para el año académico {new Date().getFullYear()}.
        </p>
      </div>
      <SetupWizard org={org} grades={grades} subjects={subjects} />
    </div>
  );
}
