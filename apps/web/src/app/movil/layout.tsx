import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'Captura de hojas',
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

const TOAST_OFFSET = { bottom: 'calc(env(safe-area-inset-bottom) + 7.5rem)' };

/**
 * La captura móvil ocupa el viewport completo y no hace scroll: la cámara tiene
 * que quedar visible mientras se disparan decenas de hojas seguidas. Por eso este
 * layout no impone ancho máximo ni padding — cada vista se encarga de su chrome.
 */
export default function MovilLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[rgb(2_6_23)] text-[hsl(var(--neutral-0))]">
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
