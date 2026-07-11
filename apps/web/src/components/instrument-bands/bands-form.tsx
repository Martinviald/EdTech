'use client';

import { useRef, useState, useTransition } from 'react';
import { Plus, Trash2, MoveHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import type { PerformanceBandResponseModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { recalculateInstrumentBandsAction, upsertInstrumentBandsAction } from './actions';

// Paleta de niveles de la plataforma (los mismos colores de la distribución de
// resultados: PERFORMANCE_LEVEL_CHART_COLOR): rojo → ámbar → esmeralda → azul,
// de menor a mayor logro. Se usa como propuesta automática de color; el usuario
// puede sobrescribir cada nivel.
const RAMP: readonly [number, number, number][] = [
  [239, 68, 68], // red-500      · Insuficiente
  [245, 158, 11], // amber-500   · Elemental
  [16, 185, 129], // emerald-500 · Adecuado
  [59, 130, 246], // blue-500    · Avanzado
];

// Presets discretos para pocos niveles, para que reproduzcan exactamente la
// paleta de la plataforma (4 niveles = igual a la distribución de resultados;
// 3 niveles = rojo/ámbar/verde, como DIA I/II/III). Para 5-6 niveles se
// interpola sobre la rampa.
const PALETTE_BY_N: Record<number, readonly string[]> = {
  2: ['#ef4444', '#10b981'],
  3: ['#ef4444', '#f59e0b', '#10b981'],
  4: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'],
};

function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(seg));
  const f = seg - i;
  const c = [0, 1, 2].map((k) =>
    Math.round(RAMP[i]![k]! + (RAMP[i + 1]![k]! - RAMP[i]![k]!) * f),
  );
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Color propuesto para el nivel `i` de un set de `n` niveles. */
function autoColor(i: number, n: number): string {
  const preset = PALETTE_BY_N[n];
  if (preset) return preset[i]!;
  return rampColor(n <= 1 ? 0 : i / (n - 1));
}

type Level = { label: string; color: string; colorAuto: boolean };

const MIN_GAP = 0.02; // separación mínima entre cortes (2%)
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => Math.round(x * 100);

function initState(initial: PerformanceBandResponseModel[]): { levels: Level[]; cuts: number[] } {
  if (initial.length >= 1) {
    const sorted = [...initial].sort((a, b) => a.order - b.order);
    return {
      levels: sorted.map((b) => ({ label: b.label, color: b.color ?? '', colorAuto: !b.color })),
      cuts: sorted.slice(0, -1).map((b) => Number(b.maxThreshold)),
    };
  }
  // Default: 3 niveles con cortes 40% / 70% y colores automáticos.
  return {
    levels: [
      { label: 'Nivel I', color: '', colorAuto: true },
      { label: 'Nivel II', color: '', colorAuto: true },
      { label: 'Nivel III', color: '', colorAuto: true },
    ],
    cuts: [0.4, 0.7],
  };
}

export function BandsForm({
  instrumentId,
  initial,
}: {
  instrumentId: string;
  initial: PerformanceBandResponseModel[];
}) {
  const init = initState(initial);
  const [levels, setLevels] = useState<Level[]>(init.levels);
  const [cuts, setCuts] = useState<number[]>(init.cuts);
  const [saving, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ j: number; rect: DOMRect } | null>(null);

  const n = levels.length;
  const boundsOf = (i: number): [number, number] => [
    i === 0 ? 0 : cuts[i - 1]!,
    i === n - 1 ? 1 : cuts[i]!,
  ];
  const colorAt = (i: number): string =>
    levels[i]!.colorAuto ? autoColor(i, n) : levels[i]!.color;

  // ── mutaciones de cortes ──────────────────────────────────────────────────
  function setCut(j: number, val: number) {
    setCuts((prev) => {
      const next = [...prev];
      const lo = (j === 0 ? 0 : next[j - 1]!) + MIN_GAP;
      const hi = (j === next.length - 1 ? 1 : next[j + 1]!) - MIN_GAP;
      next[j] = Math.max(lo, Math.min(hi, round2(val)));
      return next;
    });
  }

  // ── drag de los tiradores (pointer capture sobre el propio tirador) ────────
  function onHandleDown(e: React.PointerEvent, j: number) {
    if (!barRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { j, rect: barRef.current.getBoundingClientRect() };
  }
  function onHandleMove(e: React.PointerEvent, j: number) {
    const d = dragRef.current;
    if (!d || d.j !== j) return;
    setCut(j, (e.clientX - d.rect.left) / d.rect.width);
  }
  function onHandleUp(e: React.PointerEvent) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }
  function onHandleKey(e: React.KeyboardEvent, j: number) {
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setCut(j, cuts[j]! - step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setCut(j, cuts[j]! + step);
    }
  }

  // ── agregar / quitar niveles ──────────────────────────────────────────────
  function addLevel() {
    if (n >= 6) {
      toast.error('Máximo 6 niveles.');
      return;
    }
    // Divide en dos el segmento más ancho.
    let widest = 0;
    let wmax = -1;
    for (let i = 0; i < n; i++) {
      const [lo, hi] = boundsOf(i);
      if (hi - lo > wmax) {
        wmax = hi - lo;
        widest = i;
      }
    }
    const [lo, hi] = boundsOf(widest);
    const mid = round2((lo + hi) / 2);
    setCuts((prev) => [...prev, mid].sort((a, b) => a - b));
    setLevels((prev) => {
      const next = [...prev];
      next.splice(widest + 1, 0, { label: 'Nuevo nivel', color: '', colorAuto: true });
      return next;
    });
  }
  function removeLevel(i: number) {
    if (n <= 2) return;
    const cutIdx = i < cuts.length ? i : i - 1;
    setCuts((prev) => prev.filter((_, k) => k !== cutIdx));
    setLevels((prev) => prev.filter((_, k) => k !== i));
  }

  function patchLevel(i: number, p: Partial<Level>) {
    setLevels((prev) => prev.map((lv, k) => (k === i ? { ...lv, ...p } : lv)));
  }

  // ── guardar (con confirmación + recálculo) ────────────────────────────────
  function requestSave() {
    if (levels.some((l) => !l.label.trim())) {
      toast.error('Cada nivel necesita una etiqueta.');
      return;
    }
    setConfirmOpen(true);
  }

  function confirmSave() {
    startTransition(async () => {
      try {
        await upsertInstrumentBandsAction(instrumentId, {
          // La clave se autogenera por posición; el usuario no la maneja.
          bands: levels.map((lv, i) => {
            const [lo, hi] = boundsOf(i);
            return {
              key: `nivel_${i + 1}`,
              label: lv.label.trim(),
              order: i,
              minThreshold: round2(lo),
              maxThreshold: round2(hi),
              color: colorAt(i),
            };
          }),
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudieron guardar los niveles.');
        return;
      }

      // Guardado OK → gatillar el recálculo de todos los colegios que rindieron.
      try {
        const r = await recalculateInstrumentBandsAction(instrumentId);
        setConfirmOpen(false);
        toast.success(
          `Niveles guardados. Se recalcularon ${r.assessmentsRecalculated} evaluación(es) en ` +
            `${r.orgsAffected} colegio(s).`,
        );
      } catch {
        setConfirmOpen(false);
        toast.warning(
          'Niveles guardados, pero el recálculo falló. Puedes reintentar guardando de nuevo.',
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Vista previa arrastrable ── */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vista previa · arrastra para ajustar los umbrales
        </p>

        <div className="pt-6">
          <div
            ref={barRef}
            className="relative flex h-14 select-none rounded-lg border bg-muted"
            style={{ touchAction: 'none' }}
          >
            {levels.map((lv, i) => {
              const [lo, hi] = boundsOf(i);
              const w = hi - lo;
              return (
                <div
                  key={i}
                  className={cn(
                    'flex h-full items-center justify-center overflow-hidden',
                    i === 0 && 'rounded-l-md',
                    i === n - 1 && 'rounded-r-md',
                  )}
                  style={{ width: `${w * 100}%`, backgroundColor: colorAt(i) }}
                >
                  {w > 0.1 && (
                    <span
                      className="truncate px-2 text-xs font-semibold text-white"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
                    >
                      {lv.label}
                    </span>
                  )}
                </div>
              );
            })}

            {cuts.map((c, j) => (
              <div
                key={j}
                role="slider"
                tabIndex={0}
                aria-label={`Corte entre ${levels[j]?.label ?? ''} y ${levels[j + 1]?.label ?? ''}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct(c)}
                onPointerDown={(e) => onHandleDown(e, j)}
                onPointerMove={(e) => onHandleMove(e, j)}
                onPointerUp={onHandleUp}
                onKeyDown={(e) => onHandleKey(e, j)}
                className="group absolute top-[-6px] flex h-[68px] w-6 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded outline-none focus-visible:z-10"
                style={{ left: `${c * 100}%` }}
              >
                <span className="pointer-events-none absolute -top-6 rounded bg-foreground px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {pct(c)}%
                </span>
                <span className="h-full w-1 rounded bg-background shadow ring-1 ring-border group-focus-visible:ring-2 group-focus-visible:ring-ring" />
              </div>
            ))}
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MoveHorizontal className="h-3.5 w-3.5 shrink-0" />
          Arrastra los tiradores (o enfócalos y usa ← →) para cambiar los cortes, o escribe el % a
          mano en cada nivel. El primer nivel parte en 0% y el último llega a 100%.
        </p>
      </div>

      {/* ── Lista de niveles ── */}
      <ul className="space-y-2.5">
        {levels.map((lv, i) => {
          const [lo, hi] = boundsOf(i);
          const isLast = i === n - 1;
          return (
            <li
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 sm:flex-nowrap"
            >
              {/* swatch de color */}
              <label
                className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-inset ring-border"
                style={{ backgroundColor: colorAt(i) }}
                title="Color del nivel"
              >
                <input
                  type="color"
                  value={colorAt(i)}
                  onChange={(e) => patchLevel(i, { color: e.target.value, colorAuto: false })}
                  disabled={saving}
                  className="absolute inset-[-4px] h-[calc(100%+8px)] w-[calc(100%+8px)] cursor-pointer opacity-0"
                  aria-label="Color del nivel"
                />
                {lv.colorAuto && (
                  <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-foreground px-1 text-[8px] leading-tight text-background">
                    auto
                  </span>
                )}
              </label>

              {/* etiqueta editable */}
              <Input
                value={lv.label}
                placeholder="Nombre del nivel"
                onChange={(e) => patchLevel(i, { label: e.target.value })}
                disabled={saving}
                aria-label="Etiqueta del nivel"
                className="min-w-0 flex-1 font-medium"
              />

              {/* rango: desde (fijo) → hasta (editable a mano; el último = 100%) */}
              <div className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                <span className="tabular-nums">{pct(lo)}%</span>
                <span aria-hidden>→</span>
                {isLast ? (
                  <span className="tabular-nums font-medium text-foreground">100%</span>
                ) : (
                  <span className="flex items-center gap-0.5">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={pct(hi)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v)) setCut(i, v / 100);
                      }}
                      disabled={saving}
                      aria-label={`Umbral superior de ${lv.label || 'nivel'}`}
                      className="h-8 w-16 tabular-nums"
                    />
                    <span>%</span>
                  </span>
                )}
              </div>

              {/* eliminar */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeLevel(i)}
                disabled={saving || n <= 2}
                aria-label="Eliminar nivel"
                className="shrink-0 text-muted-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ul>

      {/* ── Acciones ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={addLevel} disabled={saving || n >= 6}>
          <Plus className="mr-1.5 h-4 w-4" />
          Agregar nivel
        </Button>
        <Button type="button" onClick={requestSave} disabled={saving}>
          Guardar niveles
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !saving && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Guardar y recalcular resultados</AlertDialogTitle>
            <AlertDialogDescription>
              Se guardarán los niveles de este instrumento y se recalcularán los resultados de
              todas las evaluaciones que lo hayan usado, en todos los colegios. Los gráficos de
              resultados pasarán a reflejar estos cortes. La operación puede tardar unos segundos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmSave();
              }}
              disabled={saving}
            >
              {saving ? 'Guardando…' : 'Guardar y recalcular'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
