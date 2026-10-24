import { redirect } from 'next/navigation';
import { canAccess, SHEET_REVIEW_ROLES } from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { WrittenAnswersReview } from '@/components/answer-reading/WrittenAnswersReview';

export const dynamic = 'force-dynamic';

export default async function EvaluacionRespuestasEscritasPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_REVIEW_ROLES)) redirect(ROUTES.dashboard);

  const { assessmentId } = await params;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Respuestas escritas a mano que los lectores no pudieron decidir solos. En modo lectura
        decides qué escribió el alumno, sin ver la clave; en modo corrección decides si una
        respuesta clara es correcta. Mientras no se revisen quedan pendientes de corrección, nunca
        como 0.
      </p>
      <WrittenAnswersReview scope={{ assessmentId }} />
    </div>
  );
}
