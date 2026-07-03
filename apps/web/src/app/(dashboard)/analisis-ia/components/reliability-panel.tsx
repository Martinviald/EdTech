import { ShieldCheck, AlertCircle } from 'lucide-react';
import type { AssessmentInsightsOutput } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMetric } from './format';

interface ReliabilityPanelProps {
  reliability: AssessmentInsightsOutput['reliability'];
  confidence: number;
  caveats: string[];
}

function confidenceTone(confidence: number): 'success' | 'warning' | 'destructive' {
  if (confidence >= 0.7) return 'success';
  if (confidence >= 0.4) return 'warning';
  return 'destructive';
}

/** Confiabilidad (KR-20), confianza del análisis y caveats (H20.7). */
export function ReliabilityPanel({
  reliability,
  confidence,
  caveats,
}: ReliabilityPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-info" aria-hidden />
          Confiabilidad del análisis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">KR-20 {formatMetric(reliability.kr20)}</Badge>
          <Badge variant={confidenceTone(confidence)}>
            Confianza {Math.round(confidence * 100)}%
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{reliability.interpretation}</p>

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
