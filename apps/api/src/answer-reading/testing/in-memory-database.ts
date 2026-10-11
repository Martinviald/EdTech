import { randomUUID } from 'node:crypto';
import { getTableColumns, SQL, type Table } from 'drizzle-orm';
import type { Database } from '@soe/db';
import type { OrderSpec, Predicate } from './drizzle-predicates';

type Row = Record<string, unknown>;
type Projection = Record<string, unknown> | undefined;

interface SelectState {
  table: Table | null;
  predicate: Predicate | undefined;
  orders: OrderSpec[];
  limit: number | null;
}

export class InMemoryDatabase {
  private readonly store = new Map<Table, Row[]>();
  private readonly keysByTable = new Map<Table, Map<unknown, string>>();
  private readonly uniqueKeys = new Map<Table, Array<readonly string[]>>();

  seed(table: Table, rows: Row[]): void {
    this.rowsOf(table).push(...rows.map((row) => this.withDefaults(table, row)));
  }

  rows<T = Row>(table: Table): T[] {
    return this.rowsOf(table) as T[];
  }

  asDatabase(): Database {
    const db: Record<string, unknown> = {
      select: (projection?: Record<string, unknown>) => this.selectBuilder(projection),
      insert: (table: Table) => this.insertBuilder(table),
      update: (table: Table) => this.updateBuilder(table),
      execute: async () => [],
      transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    };
    return db as unknown as Database;
  }

  private selectBuilder(projection: Projection) {
    const state: SelectState = { table: null, predicate: undefined, orders: [], limit: null };
    const builder = {
      from: (table: Table) => {
        state.table = table;
        return builder;
      },
      where: (predicate: Predicate | undefined) => {
        state.predicate = predicate;
        return builder;
      },
      orderBy: (...orders: OrderSpec[]) => {
        state.orders = orders;
        return builder;
      },
      limit: (limit: number) => {
        state.limit = limit;
        return builder;
      },
      innerJoin: () => {
        throw new Error('InMemoryDatabase no soporta joins');
      },
      then: <T>(resolve: (rows: Row[]) => T, reject?: (error: unknown) => unknown) =>
        Promise.resolve()
          .then(() => this.runSelect(state, projection))
          .then(resolve, reject),
    };
    return builder;
  }

  private runSelect(state: SelectState, projection: Projection): Row[] {
    const table = state.table;
    if (table === null) throw new Error('select sin from');
    let rows = this.rowsOf(table).filter((row) => this.matches(table, row, state.predicate));
    for (const order of [...state.orders].reverse()) {
      const key = this.keyOf(table, order.col);
      const direction = order.__order === 'desc' ? -1 : 1;
      rows = [...rows].sort((left, right) => direction * this.compare(left[key], right[key]));
    }
    if (state.limit !== null) rows = rows.slice(0, state.limit);
    return rows.map((row) => this.project(table, row, projection));
  }

  unique(table: Table, keys: readonly string[]): void {
    let constraints = this.uniqueKeys.get(table);
    if (!constraints) {
      constraints = [];
      this.uniqueKeys.set(table, constraints);
    }
    constraints.push(keys);
  }

  private insertBuilder(table: Table) {
    let pending: Row[] = [];
    let ignoreConflicts = false;
    let inserted: Row[] | null = null;
    const commit = (): Row[] => {
      if (inserted !== null) return inserted;
      const accepted: Row[] = [];
      for (const row of pending) {
        if (this.conflicts(table, row)) {
          if (ignoreConflicts) continue;
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          });
        }
        this.rowsOf(table).push(row);
        accepted.push(row);
      }
      inserted = accepted;
      return accepted;
    };
    const builder = {
      values: (values: Row | Row[]) => {
        const list = Array.isArray(values) ? values : [values];
        pending = list.map((row) => this.withDefaults(table, row));
        return builder;
      },
      onConflictDoNothing: () => {
        ignoreConflicts = true;
        return builder;
      },
      returning: (projection?: Record<string, unknown>) =>
        Promise.resolve().then(() => commit().map((row) => this.project(table, row, projection))),
      then: <T>(resolve: (rows: Row[]) => T, reject?: (error: unknown) => unknown) =>
        Promise.resolve()
          .then(() => commit())
          .then(resolve, reject),
    };
    return builder;
  }

  private conflicts(table: Table, row: Row): boolean {
    const constraints = this.uniqueKeys.get(table) ?? [];
    return constraints.some((keys) =>
      this.rowsOf(table).some((existing) => keys.every((key) => existing[key] === row[key])),
    );
  }

  private updateBuilder(table: Table) {
    let changes: Row = {};
    let updated: Row[] = [];
    const builder = {
      set: (values: Row) => {
        changes = values;
        return builder;
      },
      where: (predicate: Predicate | undefined) => {
        updated = this.rowsOf(table).filter((row) => this.matches(table, row, predicate));
        for (const row of updated) Object.assign(row, changes);
        return builder;
      },
      returning: () => Promise.resolve(updated),
      then: <T>(resolve: (rows: Row[]) => T, reject?: (error: unknown) => unknown) =>
        Promise.resolve(updated).then(resolve, reject),
    };
    return builder;
  }

  private matches(table: Table, row: Row, predicate: Predicate | undefined): boolean {
    if (predicate === undefined) return true;
    switch (predicate.__pred) {
      case 'and':
        return predicate.conds.every((cond) => this.matches(table, row, cond));
      case 'or':
        return predicate.conds.some((cond) => this.matches(table, row, cond));
      case 'isNull':
        return row[this.keyOf(table, predicate.col)] == null;
      case 'isNotNull':
        return row[this.keyOf(table, predicate.col)] != null;
      case 'in':
        return predicate.vals.includes(row[this.keyOf(table, predicate.col)]);
      case 'eq':
        return this.compare(row[this.keyOf(table, predicate.col)], predicate.val) === 0;
      case 'ne':
        return this.compare(row[this.keyOf(table, predicate.col)], predicate.val) !== 0;
      case 'gte':
        return this.compare(row[this.keyOf(table, predicate.col)], predicate.val) >= 0;
      case 'lte':
        return this.compare(row[this.keyOf(table, predicate.col)], predicate.val) <= 0;
    }
  }

  private compare(left: unknown, right: unknown): number {
    const normalize = (value: unknown) => (value instanceof Date ? value.getTime() : value);
    const a = normalize(left);
    const b = normalize(right);
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    return (a as number) < (b as number) ? -1 : 1;
  }

  private project(table: Table, row: Row, projection: Projection): Row {
    if (projection === undefined) return row;
    const projected: Row = {};
    for (const [alias, column] of Object.entries(projection)) {
      projected[alias] = row[this.keyOf(table, column)];
    }
    return projected;
  }

  private withDefaults(table: Table, row: Row): Row {
    const complete: Row = {};
    for (const [key, column] of Object.entries(getTableColumns(table))) {
      if (row[key] !== undefined) {
        complete[key] = row[key];
        continue;
      }
      if (key === 'id') complete[key] = randomUUID();
      else if (key === 'createdAt' || key === 'updatedAt') complete[key] = new Date();
      else if (column.default !== undefined && !(column.default instanceof SQL)) {
        complete[key] = column.default;
      } else complete[key] = null;
    }
    return complete;
  }

  private keyOf(table: Table, column: unknown): string {
    let keys = this.keysByTable.get(table);
    if (!keys) {
      keys = new Map(
        Object.entries(getTableColumns(table)).map(([key, tableColumn]) => [tableColumn, key]),
      );
      this.keysByTable.set(table, keys);
    }
    const key = keys.get(column);
    if (key === undefined) throw new Error('Columna que no pertenece a la tabla consultada');
    return key;
  }

  private rowsOf(table: Table): Row[] {
    let rows = this.store.get(table);
    if (!rows) {
      rows = [];
      this.store.set(table, rows);
    }
    return rows;
  }
}
