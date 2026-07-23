'use client';

import { useState } from 'react';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getDisplayMessage } from '@/lib/errors';

const DEFAULT_ERROR_MESSAGE = 'No se pudo completar la operación.';

function onQueryError(error: unknown): void {
  toast.error(getDisplayMessage(error, DEFAULT_ERROR_MESSAGE));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: onQueryError }),
        mutationCache: new MutationCache({ onError: onQueryError }),
      }),
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
