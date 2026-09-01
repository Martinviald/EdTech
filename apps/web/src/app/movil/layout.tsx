import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'Captura de hojas',
  robots: { index: false, follow: false },
};

export default function MovilLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background px-4 py-6">
      {children}
      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}
