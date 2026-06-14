import { TrendingUp, TrendingDown } from 'lucide-react';
import type { ItemPracticeCard, ItemDiagnosisCard } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns';
import { formatMetric, causeLabel } from './format';

function MetricChips({
  difficulty,
  discrimination,
}: {
  difficulty: number | null;
  discrimination?: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline">p {formatMetric(difficulty)}</Badge>
      {discrimination !== undefined ? (
        <Badge variant="outline">D {formatMetric(discrimination)}</Badge>
      ) : null}
    </div>
  );
}

/** Top 5 ítems de alto desempeño: qué replicar (H20.3). */
export function TopItemsCard({ items }: { items: ItemPracticeCard[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-5 text-success" aria-hidden />
          Ítems destacados (Top 5)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Sin ítems destacados" />
        ) : (
          items.map((item) => (
            <div key={item.position} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="success">Pregunta {item.position}</Badge>
                  {item.skillName ? (
                    <span className="text-sm font-medium text-foreground">
                      {item.skillName}
                    </span>
                  ) : null}
                </div>
                <MetricChips
                  difficulty={item.difficulty}
                  discrimination={item.discrimination}
                />
              </div>
              {item.whatWorked.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Qué funcionó
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                    {item.whatWorked.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3 rounded-md bg-muted/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Práctica replicable
                </p>
                <p className="mt-1 text-sm text-foreground">{item.replicableAction}</p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Bottom 5 ítems de bajo desempeño: causa raíz + plan (H20.3). */
export function BottomItemsCard({ items }: { items: ItemDiagnosisCard[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="size-5 text-destructive" aria-hidden />
          Ítems críticos (Bottom 5)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Sin ítems críticos" />
        ) : (
          items.map((item) => (
            <div key={item.position} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">Pregunta {item.position}</Badge>
                  {item.skillName ? (
                    <span className="text-sm font-medium text-foreground">
                      {item.skillName}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <MetricChips difficulty={item.difficulty} />
                  <Badge variant="warning">{causeLabel(item.likelyCause)}</Badge>
                </div>
              </div>
              {item.misconception ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Misconcepción: </span>
                  {item.misconception}
                </p>
              ) : null}
              <div className="mt-3 rounded-md bg-muted/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Plan de acción
                </p>
                <ol className="mt-1 list-inside list-decimal space-y-0.5 text-sm text-foreground">
                  {item.actionPlan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
