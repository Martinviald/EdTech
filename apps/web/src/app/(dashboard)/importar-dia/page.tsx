import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canAccess, ITEM_BANK_ROLES } from '@soe/types';
import { apiGet } from '@/lib/api';
import type { OrgSubjectClass } from '@/lib/teacherAssignmentsApi';
import type { CatalogOptions } from './steps/UploadStep';
import { DiaImportWizard } from './DiaImportWizard';

export default async function ImportarDiaPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect('/dashboard');

  const orgId = session.user.orgId;

  const [taxonomies, subjectClasses] = await Promise.all([
    apiGet<CatalogOptions['taxonomies']>('/taxonomies'),
    apiGet<OrgSubjectClass[]>(`/organizations/${orgId}/subject-classes`),
  ]);

  const subjectsMap = new Map<string, CatalogOptions['subjects'][number]>();
  const gradesMap = new Map<string, CatalogOptions['grades'][number]>();
  for (const sc of subjectClasses) {
    if (!subjectsMap.has(sc.subject.id)) {
      subjectsMap.set(sc.subject.id, sc.subject);
    }
    if (!gradesMap.has(sc.classGroup.id)) {
      gradesMap.set(sc.classGroup.id, {
        id: sc.classGroup.id,
        name: `${sc.classGroup.gradeShortName} · ${sc.classGroup.name}`,
        shortName: sc.classGroup.gradeShortName,
        gradeOrder: sc.classGroup.gradeOrder,
      });
    }
  }

  const subjects = [...subjectsMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const grades = [...gradesMap.values()].sort((a, b) => a.gradeOrder - b.gradeOrder || a.name.localeCompare(b.name));

  const catalogOptions: CatalogOptions = { taxonomies, subjects, grades };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar pauta DIA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube el archivo JSON con la pauta oficial DIA. El sistema parseará los ítems,
          los asociará a la taxonomía y creará el instrumento automáticamente.
        </p>
      </div>
      <DiaImportWizard catalogOptions={catalogOptions} />
    </div>
  );
}
