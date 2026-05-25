'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { revokePlatformAdminAction } from './actions';

export function RevokeButton({ userId, email }: { userId: string; email: string }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(`Revocar acceso de plataforma a ${email}?`)) return;
    startTransition(async () => {
      const result = await revokePlatformAdminAction(userId);
      if (result.ok) toast.success('Acceso revocado');
      else toast.error(result.error);
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      aria-label="Revocar"
    >
      <Trash2 className="size-4 text-destructive" />
    </Button>
  );
}
