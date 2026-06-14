import type { RemedialPracticeContent } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Render de solo lectura de un set de ítems de práctica (H9.3). Preview por `stem`. */
export function PracticeView({ content }: { content: RemedialPracticeContent }) {
  const items = [...content.items].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Habilidad focalizada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-foreground">
          <p>{content.skillFocus}</p>
          <p className="text-muted-foreground">{content.itemCount} ítems generados</p>
          {content.notes ? (
            <p className="text-muted-foreground">{content.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ítems de práctica (borrador)</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ítems en este set.</p>
          ) : (
            <ol className="space-y-3">
              {items.map((item) => (
                <li key={item.itemId} className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {item.position}
                    </span>
                    <p className="text-sm text-foreground">{item.stem}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Los ítems se publican en el banco al aprobar este material.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
