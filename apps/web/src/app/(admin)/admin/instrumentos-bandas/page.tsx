import Link from 'next/link';
import type { InstrumentModel } from '@soe/types';
import { apiGet } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

type InstrumentsListResponse = {
  data: InstrumentModel[];
  total: number;
  page: number;
  limit: number;
};

/**
 * Configuración de niveles/umbrales de logro por instrumento (área plataforma).
 * El `(admin)/layout.tsx` ya exige `isPlatformAdmin`. Las bandas son globales:
 * aplican a todas las organizaciones que usan el instrumento.
 */
export default async function InstrumentBandsListPage() {
  // Solo instrumentos del sistema (oficiales): sus niveles/umbrales son globales
  // y compartidos por todas las orgs. Los instrumentos propios de un colegio no
  // son configurables aquí (el endpoint también los rechaza).
  const instruments = await apiGet<InstrumentsListResponse>(
    '/instruments?isOfficial=true&limit=200',
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Niveles de logro por instrumento</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Define los niveles de clasificación (ej. DIA I / II / III) y sus umbrales de corte para
          cada instrumento. Son globales: aplican a todas las organizaciones que usan el
          instrumento y se reflejan en la sección de resultados al recalcular la evaluación.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instrumento</TableHead>
                  <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">Año</TableHead>
                  <TableHead className="hidden md:table-cell">Versión</TableHead>
                  <TableHead className="text-right">Niveles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instruments.data.map((ins) => (
                  <TableRow key={ins.id}>
                    <TableCell className="font-medium">{ins.name}</TableCell>
                    <TableCell className="hidden sm:table-cell uppercase text-xs text-muted-foreground">
                      {ins.type}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{ins.year ?? '—'}</TableCell>
                    <TableCell className="hidden md:table-cell">{ins.version ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/instrumentos-bandas/${ins.id}`}>Configurar</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
