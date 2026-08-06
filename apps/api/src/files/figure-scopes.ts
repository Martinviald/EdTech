export const FIGURE_SCOPES = {
  item: { ownerType: 'item', purpose: 'item_figure' },
  alternative: { ownerType: 'item', purpose: 'alt_figure' },
  section: { ownerType: 'section', purpose: 'section_figure' },
} as const;

export type FigureScope = keyof typeof FIGURE_SCOPES;
