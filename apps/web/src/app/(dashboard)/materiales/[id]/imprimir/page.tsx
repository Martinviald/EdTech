import Image from 'next/image';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  canAccess,
  DOCUMENT_VIEWER_ROLES,
  type DocumentModel,
  type OrgBrandingResponse,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/shared';
import { DocumentRenderer } from '@/components/document-editor/document-renderer';
import type { DocumentAudience } from '@/components/document-editor/block-registry';
import { PrintButton } from './print-button';

const EMPTY_BRANDING: OrgBrandingResponse = { orgId: '', branding: {}, logoUrl: null };

/**
 * Export v1 del Editor de Materiales (propuesta §10): renderer standalone con
 * cabecera/pie brandeados + print-CSS (`.print-region`), disparado por
 * `window.print()`. `?version=teacher|student` gobierna la audiencia del render
 * (con/sin pauta). En F2 Playwright apunta a esta misma ruta para PDF server-side.
 */
export default async function MaterialImprimirPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DOCUMENT_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { id } = await params;
  const { version } = await searchParams;
  const audience: DocumentAudience = version === 'student' ? 'student' : 'teacher';

  const [doc, brandingResponse, org] = await Promise.all([
    apiGet<DocumentModel>(`/documents/${id}`).catch(() => null),
    apiGet<OrgBrandingResponse>('/organizations/me/branding').catch(() => EMPTY_BRANDING),
    apiGet<{ name: string }>('/organizations/me').catch(() => null),
  ]);
  if (!doc) notFound();

  const { branding, logoUrl } = brandingResponse;
  const displayName = branding.displayName ?? org?.name ?? null;

  return (
    <PageContainer>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={ROUTES.material(id)}>
            <ArrowLeft className="size-4" aria-hidden />
            Volver al editor
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            <Button asChild variant={audience === 'teacher' ? 'secondary' : 'ghost'} size="sm">
              <Link href={`${ROUTES.materialImprimir(id)}?version=teacher` as Route}>Profesor</Link>
            </Button>
            <Button asChild variant={audience === 'student' ? 'secondary' : 'ghost'} size="sm">
              <Link href={`${ROUTES.materialImprimir(id)}?version=student` as Route}>Alumno</Link>
            </Button>
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="print-region mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 sm:p-12">
        <header
          className="mb-8 border-b-2 border-border pb-4"
          // El color primario del branding es un hex arbitrario por tenant (dato
          // dinámico, no un token de diseño): sólo puede aplicarse inline.
          style={branding.primaryColor ? { borderColor: branding.primaryColor } : undefined}
        >
          <div className="flex items-center justify-between gap-4">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={displayName ? `Logo de ${displayName}` : 'Logo del colegio'}
                width={112}
                height={56}
                unoptimized
                className="h-14 w-auto object-contain"
              />
            ) : null}
            {displayName ? (
              <p className="text-lg font-semibold text-foreground">{displayName}</p>
            ) : null}
          </div>
          {branding.headerText ? (
            <p className="mt-2 text-sm text-muted-foreground">{branding.headerText}</p>
          ) : null}
        </header>

        <h1 className="text-2xl font-semibold text-foreground">{doc.title}</h1>
        {audience === 'teacher' ? (
          <p className="mt-1 text-sm text-muted-foreground">Versión profesor</p>
        ) : null}

        <div className="mt-6">
          <DocumentRenderer content={doc.content} audience={audience} />
        </div>

        {branding.footerText ? (
          <footer className="mt-10 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            {branding.footerText}
          </footer>
        ) : null}
      </div>
    </PageContainer>
  );
}
