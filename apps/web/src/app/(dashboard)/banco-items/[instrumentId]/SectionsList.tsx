'use client';

import { useState, type JSX } from 'react';
import { BookOpen } from 'lucide-react';
import type { InstrumentSectionModel } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import {
  PassageDialog,
  hasPassageContent,
  type PassageAttachment,
  type PassageData,
} from '@/components/passage-dialog';

// Lista de "Secciones" del detalle de instrumento. Cada sección con texto de
// lectura o multimedia es clickeable y abre el modal con su passage. Las que no
// tienen contenido (ej. secciones de matemática sin texto base) quedan estáticas.

function toPassage(section: InstrumentSectionModel): PassageData {
  return {
    sectionName: section.name,
    passageTitle: section.passageTitle,
    passageText: section.passageText,
    passageFormat: section.passageFormat,
    attachments: (section.attachments ?? []).map<PassageAttachment>((a) => ({
      kind: a.kind,
      url: a.url,
      fileName: a.fileName,
      mimeType: a.mimeType,
      note: a.note,
    })),
  };
}

export function SectionsList({
  sections,
}: {
  sections: InstrumentSectionModel[];
}): JSX.Element {
  const [active, setActive] = useState<InstrumentSectionModel | null>(null);

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const clickable = hasPassageContent(section);
          return (
            <Card
              key={section.id}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? `Ver texto de la sección ${section.name}` : undefined}
              className={
                clickable
                  ? 'cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  : undefined
              }
              onClick={clickable ? () => setActive(section) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActive(section);
                      }
                    }
                  : undefined
              }
            >
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{section.name}</span>
                  {section.maxPoints ? (
                    <span className="text-xs text-muted-foreground">
                      {section.maxPoints} pts
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{section.type}</p>
                  {clickable ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <BookOpen className="size-3" aria-hidden />
                      Ver texto
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PassageDialog
        open={active !== null}
        onOpenChange={(o) => {
          if (!o) setActive(null);
        }}
        passage={active ? toPassage(active) : null}
      />
    </>
  );
}
