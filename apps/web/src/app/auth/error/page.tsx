import Link from 'next/link';

type SearchParams = Promise<{ error?: string }>;

const MESSAGES: Record<string, { title: string; body: string }> = {
  EmailNotWhitelisted: {
    title: 'Acceso no autorizado',
    body: 'Tu correo no está registrado en la plataforma. Por favor, contacta al administrador de tu colegio.',
  },
  AccessDenied: {
    title: 'Acceso no autorizado',
    body: 'Tu correo no está registrado en la plataforma. Por favor, contacta al administrador de tu colegio.',
  },
  Configuration: {
    title: 'Error de configuración',
    body: 'Hay un problema con la configuración de autenticación. Contacta al equipo de soporte.',
  },
};

const DEFAULT_MESSAGE = {
  title: 'No pudimos iniciarte sesión',
  body: 'Ocurrió un error al procesar tu autenticación. Inténtalo de nuevo en unos momentos.',
};

export default async function AuthErrorPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const msg = error ? (MESSAGES[error] ?? DEFAULT_MESSAGE) : DEFAULT_MESSAGE;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">{msg.title}</h1>
        <p className="mt-3 text-sm text-foreground/70">{msg.body}</p>
        <Link
          href={{ pathname: '/login' }}
          className="mt-6 inline-block rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Volver al login
        </Link>
      </div>
    </main>
  );
}
