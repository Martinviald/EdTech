'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  ItemModel,
  CurriculumModel,
  AiTagSuggestion,
  CreateItemTagDto,
} from '@soe/types';
import { requestAiTagging, confirmTags } from '../../actions';

/** Local type that associates an AiTagSuggestion with its parent itemId */
type FlatSuggestion = AiTagSuggestion & { itemId: string };

type Step = 'select' | 'curriculum' | 'review' | 'done';

function getContentPreview(content: Record<string, unknown>): string {
  if (typeof content.stem === 'string') return content.stem;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.prompt === 'string') return content.prompt;
  if (typeof content.question === 'string') return content.question;
  return '(Sin contenido)';
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-500';
  if (confidence >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'Alta';
  if (confidence >= 0.5) return 'Media';
  return 'Baja';
}

type Props = {
  instrumentId: string;
  items: ItemModel[];
  curricula: CurriculumModel[];
};

export function AiTaggingWizard({ instrumentId, items, curricula }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('select');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [curriculumId, setCurriculumId] = useState('');
  const [suggestions, setSuggestions] = useState<FlatSuggestion[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleItem = useCallback((itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedItemIds((prev) => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map((i) => i.id));
    });
  }, [items]);

  const toggleAccepted = useCallback((key: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  async function handleRequestTagging() {
    if (!curriculumId || selectedItemIds.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestAiTagging({
        itemIds: Array.from(selectedItemIds),
        curriculumId,
      });
      // Flatten the grouped suggestions (Record<itemId, AiTagSuggestion[]>) into FlatSuggestion[]
      const flat: FlatSuggestion[] = [];
      for (const [itemId, itemSuggestions] of Object.entries(result.suggestions)) {
        for (const s of itemSuggestions) {
          flat.push({ ...s, itemId });
        }
      }
      setSuggestions(flat);
      // Pre-accept high-confidence suggestions
      const highConf = new Set<string>();
      for (const s of flat) {
        if (s.confidence >= 0.8) {
          highConf.add(`${s.itemId}:${s.nodeId}`);
        }
      }
      setAccepted(highConf);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al solicitar etiquetado IA.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    const tags: CreateItemTagDto[] = suggestions
      .filter((s) => accepted.has(`${s.itemId}:${s.nodeId}`))
      .map((s) => ({
        itemId: s.itemId,
        nodeId: s.nodeId,
        tagType: 'primary' as const,
        confidence: s.confidence,
        taggedBy: 'ai' as const,
      }));

    if (tags.length === 0) {
      setError('No hay sugerencias aceptadas para confirmar.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await confirmTags({ tags });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al confirmar tags.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <p className="text-lg font-medium">Tags confirmados exitosamente</p>
          <p className="text-sm text-muted-foreground">
            Los items seleccionados han sido etiquetados.
          </p>
          <Button onClick={() => router.push(`/banco-items/${instrumentId}` as Route)}>
            Volver al instrumento
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        <span
          className={cn(
            'rounded-full px-3 py-1',
            step === 'select' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          1. Seleccionar items
        </span>
        <span className="text-muted-foreground">&rarr;</span>
        <span
          className={cn(
            'rounded-full px-3 py-1',
            step === 'curriculum' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          2. Elegir curriculo
        </span>
        <span className="text-muted-foreground">&rarr;</span>
        <span
          className={cn(
            'rounded-full px-3 py-1',
            step === 'review' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          3. Revisar sugerencias
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Step 1: Select items */}
      {step === 'select' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seleccionar items para etiquetar</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay items en este instrumento.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">
                          <input
                            type="checkbox"
                            checked={selectedItemIds.size === items.length && items.length > 0}
                            onChange={toggleAll}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </TableHead>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead className="w-[140px]">Tipo</TableHead>
                        <TableHead>Contenido</TableHead>
                        <TableHead className="w-[80px]">Tags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedItemIds.has(item.id)}
                              onChange={() => toggleItem(item.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{item.position + 1}</TableCell>
                          <TableCell className="text-xs">{item.type}</TableCell>
                          <TableCell className="max-w-[300px] truncate text-sm">
                            {getContentPreview(item.content)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.tags?.length ?? 0}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {selectedItemIds.size} de {items.length} seleccionados
                  </p>
                  <Button
                    disabled={selectedItemIds.size === 0}
                    onClick={() => setStep('curriculum')}
                  >
                    Siguiente
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select curriculum */}
      {step === 'curriculum' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Elegir curriculo de referencia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              La IA usara la taxonomia de este curriculo para sugerir tags a los{' '}
              {selectedItemIds.size} items seleccionados.
            </p>
            <div className="max-w-sm space-y-2">
              <Select value={curriculumId} onValueChange={setCurriculumId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar curriculo" />
                </SelectTrigger>
                <SelectContent>
                  {curricula.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('select')}>
                Atras
              </Button>
              <Button
                disabled={!curriculumId || loading}
                onClick={handleRequestTagging}
              >
                {loading ? 'Solicitando sugerencias...' : 'Obtener sugerencias IA'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review suggestions */}
      {step === 'review' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revisar sugerencias de IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                La IA no genero sugerencias para los items seleccionados.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {suggestions.length} sugerencias generadas. Las de alta confianza estan
                  pre-aceptadas. Revisa y confirma.
                </p>
                <div className="space-y-3">
                  {suggestions.map((suggestion) => {
                    const key = `${suggestion.itemId}:${suggestion.nodeId}`;
                    const isAccepted = accepted.has(key);
                    const item = items.find((i) => i.id === suggestion.itemId);
                    return (
                      <div
                        key={key}
                        className={cn(
                          'rounded-md border p-3 transition-colors',
                          isAccepted ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-gray-200 dark:border-gray-800',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">
                                Item #{item ? item.position + 1 : '?'}
                              </span>
                              <span className="text-xs text-muted-foreground">&rarr;</span>
                              <span className="text-sm font-medium">
                                {suggestion.nodeName}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                                {suggestion.nodeType}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    'h-full rounded-full transition-all',
                                    confidenceColor(suggestion.confidence),
                                  )}
                                  style={{ width: `${suggestion.confidence * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {Math.round(suggestion.confidence * 100)}% ({confidenceLabel(suggestion.confidence)})
                              </span>
                            </div>
                            {suggestion.reasoning && (
                              <p className="text-xs text-muted-foreground italic">
                                {suggestion.reasoning}
                              </p>
                            )}
                          </div>
                          <Button
                            variant={isAccepted ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => toggleAccepted(key)}
                          >
                            {isAccepted ? 'Aceptado' : 'Rechazado'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    {accepted.size} de {suggestions.length} sugerencias aceptadas
                  </p>
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setStep('curriculum')}>
                      Atras
                    </Button>
                    <Button disabled={loading || accepted.size === 0} onClick={handleConfirm}>
                      {loading ? 'Confirmando...' : 'Confirmar tags'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
