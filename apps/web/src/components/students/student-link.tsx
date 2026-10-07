import type { ReactNode } from 'react';
import Link from 'next/link';
import { RESULTS_VIEWER_ROLES, canAccess, type UserRole } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Nombre de un alumno que enlaza a su Ficha del estudiante cuando el usuario
 * puede abrirla (`RESULTS_VIEWER_ROLES`); si no, lo muestra como texto plano.
 * Sin hooks: sirve igual en Server y Client Components. Los `roles` llegan por
 * props desde el Server Component que llamó `auth()`. El alcance docente (un
 * profesor sólo ve alumnos de sus cursos) lo aplica la API de la ficha.
 */
export function StudentLink({
  studentId,
  roles,
  children,
  className,
}: {
  studentId: string;
  roles: readonly UserRole[];
  children: ReactNode;
  className?: string;
}) {
  if (!canAccess(roles, RESULTS_VIEWER_ROLES)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      href={ROUTES.estudiante(studentId)}
      className={cn(
        'underline-offset-2 hover:text-primary hover:underline focus-visible:underline',
        className,
      )}
    >
      {children}
    </Link>
  );
}
