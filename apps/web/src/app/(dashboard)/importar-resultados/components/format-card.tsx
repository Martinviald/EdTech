import Link from 'next/link';
import type { Route } from 'next';
import { Download, ArrowRight } from 'lucide-react';
import type { AnswerSheetTemplate } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FormatCardProps {
  template: AnswerSheetTemplate;
}

export function FormatCard({ template }: FormatCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-base">{template.label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{template.description}</p>

        {template.requiredColumns.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Columnas requeridas
            </p>
            <div className="flex flex-wrap gap-1">
              {template.requiredColumns.map((col) => (
                <code
                  key={col}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs"
                >
                  {col}
                </code>
              ))}
            </div>
          </div>
        )}

        {template.optionalColumns.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Columnas opcionales
            </p>
            <div className="flex flex-wrap gap-1">
              {template.optionalColumns.map((col) => (
                <code
                  key={col}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs"
                >
                  {col}
                </code>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row">
          {template.sampleCsvUrl && (
            <Button asChild variant="outline" size="sm" className="flex-1">
              <a href={template.sampleCsvUrl} download>
                <Download className="mr-2 h-4 w-4" />
                Descargar plantilla
              </a>
            </Button>
          )}
          <Button asChild size="sm" className="flex-1">
            <Link
              href={`/importar-resultados/cargar?format=${template.format}` as Route}
            >
              Usar este formato
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
