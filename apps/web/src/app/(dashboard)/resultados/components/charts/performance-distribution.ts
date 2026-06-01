// Re-export desde el único punto de verdad de presentación de niveles
// (`../performance-level`) para evitar duplicar etiquetas/orden/colores y
// garantizar que un mismo nivel se vea igual en snapshots (FE-A) y charts (FE-B).
// `PERFORMANCE_LEVEL_COLOR` mantiene su nombre (lo consumen los charts) pero
// ahora apunta a la paleta concreta compartida (red/amber/emerald/blue).
export {
  PERFORMANCE_LEVEL_ORDER,
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_CHART_COLOR as PERFORMANCE_LEVEL_COLOR,
} from '../performance-level';
