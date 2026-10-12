export type Predicate =
  | { readonly __pred: 'eq' | 'ne' | 'gte' | 'lte'; readonly col: unknown; readonly val: unknown }
  | { readonly __pred: 'isNull' | 'isNotNull'; readonly col: unknown }
  | { readonly __pred: 'in'; readonly col: unknown; readonly vals: readonly unknown[] }
  | { readonly __pred: 'and' | 'or'; readonly conds: ReadonlyArray<Predicate | undefined> };

export interface OrderSpec {
  readonly __order: 'asc' | 'desc';
  readonly col: unknown;
}

export const DRIZZLE_PREDICATES = {
  eq: (col: unknown, val: unknown): Predicate => ({ __pred: 'eq', col, val }),
  ne: (col: unknown, val: unknown): Predicate => ({ __pred: 'ne', col, val }),
  gte: (col: unknown, val: unknown): Predicate => ({ __pred: 'gte', col, val }),
  lte: (col: unknown, val: unknown): Predicate => ({ __pred: 'lte', col, val }),
  isNull: (col: unknown): Predicate => ({ __pred: 'isNull', col }),
  isNotNull: (col: unknown): Predicate => ({ __pred: 'isNotNull', col }),
  inArray: (col: unknown, vals: readonly unknown[]): Predicate => ({ __pred: 'in', col, vals }),
  and: (...conds: Array<Predicate | undefined>): Predicate => ({ __pred: 'and', conds }),
  or: (...conds: Array<Predicate | undefined>): Predicate => ({ __pred: 'or', conds }),
  desc: (col: unknown): OrderSpec => ({ __order: 'desc', col }),
  asc: (col: unknown): OrderSpec => ({ __order: 'asc', col }),
};
