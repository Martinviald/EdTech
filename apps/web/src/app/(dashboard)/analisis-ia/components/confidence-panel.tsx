import { AlertCircle, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ConfidencePanelProps {
  confidence: number;
  caveats: string[];
}

function confidenceTone(confidence: number): 'success' | 'warning' | 'destructive' {
  if (confidence >= 0.7) return 'success';
  if (confidence >= 0.4) return 'warning';
  return 'destructive';
}

/**
 * Autoevaluación del análisis IA: qué tan sólido se considera y con qué límites
 * (H20.7). Sucede al antiguo `ReliabilityPanel`, que mezclaba esto con el KR-20
 * del instrumento; la confiabilidad psicométrica se retiró junto con el resto de
 * la evaluación de calidad (docs/diseno-limpieza-calidad-instrumento.md).
 */
export function ConfidencePanel({ confidence, caveats }: ConfidencePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-5 text-info" aria-hidden />
          Confianza del análisis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge variant={confidenceTone(confidence)}>
          Confianza {Math.round(confidence * 100)}%
        </Badge>

        {caveats.length > 0 ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-warning">
              <AlertCircle className="size-3.5" aria-hidden />
              Límites del análisis
            </p>
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {caveats.map((caveat, i) => (
                <li key={i}>{caveat}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
