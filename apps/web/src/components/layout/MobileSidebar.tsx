'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import type { UserRole } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SidebarNav } from './SidebarNav';

interface MobileSidebarProps {
  role: UserRole;
}

export function MobileSidebar({ role }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menú de navegación"
          className="md:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Menú principal</SheetTitle>
          <SheetDescription>Navegación principal de la plataforma</SheetDescription>
        </SheetHeader>
        <SidebarNav role={role} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
