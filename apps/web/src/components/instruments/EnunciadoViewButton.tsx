import { ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Botón "Ver enunciado": abre el PDF del enunciado en una PESTAÑA NUEVA, para
 * poder consultarlo junto a la vista de resultados al mismo tiempo.
 *
 * Enlaza al handler `/instrumentos/:id/enunciado`, que genera una URL prefirmada
 * FRESCA en el momento del click y redirige a ella. Así el enlace nunca está
 * vencido aunque la página lleve mucho rato abierta (la URL de S3 es de corta
 * vida). El navegador muestra el PDF con su visor nativo (Content-Disposition
 * inline); si no hay almacenamiento configurado, el handler cae a la descarga.
 *
 * Sólo debe renderizarse cuando el instrumento tiene un enunciado (la existencia
 * se comprueba en el sitio que lo usa). Componente compartido: banco de ítems,
 * backoffice de instrumentos oficiales y el hub de una evaluación.
 */
export function EnunciadoViewButton({ instrumentId }: { instrumentId: string }) {
  return (
    <a
      href={`/instrumentos/${instrumentId}/enunciado`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Button variant="outline" size="sm" className="gap-2">
        <FileText className="size-4" aria-hidden />
        Ver enunciado
        <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">(se abre en una pestaña nueva)</span>
      </Button>
    </a>
  );
}
