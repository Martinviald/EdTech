import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'Captura de hojas',
  robots: { index: false, follow: false },
};

const TOAST_OFFSET = { bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' };

export default function MovilLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background px-4 pb-4 pt-6">
      {children}
      <Toaster
        position="bottom-center"
        richColors
        closeButton
        offset={TOAST_OFFSET}
        mobileOffset={TOAST_OFFSET}
      />
    </div>
  );
}
