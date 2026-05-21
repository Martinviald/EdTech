'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={mounted ? `Cambiar a tema ${next === 'dark' ? 'oscuro' : 'claro'}` : 'Cambiar tema'}
      onClick={() => setTheme(next)}
    >
      {mounted && isDark ? (
        <Sun className="size-5" aria-hidden />
      ) : (
        <Moon className="size-5" aria-hidden />
      )}
    </Button>
  );
}
