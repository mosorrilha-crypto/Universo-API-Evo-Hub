/**
 * Cliente Supabase falso, em memória, só com a fatia da API do
 * supabase-js que os stores de server/services/*.ts realmente usam
 * (from/select/insert/update/upsert/delete/eq/order/single/maybeSingle).
 * Existe só pra testar isolamento entre tenants sem precisar de um Postgres
 * real — ver server/services/__tests__/tenantIsolation.test.ts.
 */
import { randomUUID } from 'crypto';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class FakeQueryBuilder {
  private filters: Array<[string, any]> = [];
  private wantSelect = false;

  constructor(
    private rows: Row[],
    private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    private payload?: Row,
    private upsertOpts?: { onConflict?: string }
  ) {}

  eq(column: string, value: any) {
    this.filters.push([column, value]);
    return this;
  }

  order() {
    return this;
  }

  select(_columns?: string) {
    this.wantSelect = true;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private run(): { data: Row[] | null; error: null } {
    if (this.op === 'select') {
      return { data: this.rows.filter((row) => this.matches(row)), error: null };
    }
    if (this.op === 'insert') {
      const newRow: Row = { id: randomUUID(), ...this.payload };
      this.rows.push(newRow);
      return { data: [newRow], error: null };
    }
    if (this.op === 'update') {
      const matched = this.rows.filter((row) => this.matches(row));
      matched.forEach((row) => Object.assign(row, this.payload));
      return { data: matched, error: null };
    }
    if (this.op === 'delete') {
      const matched = this.rows.filter((row) => this.matches(row));
      matched.forEach((row) => this.rows.splice(this.rows.indexOf(row), 1));
      return { data: matched, error: null };
    }
    // upsert
    const conflictCols = (this.upsertOpts?.onConflict || '').split(',').filter(Boolean);
    const existing = conflictCols.length
      ? this.rows.find((row) => conflictCols.every((col) => row[col] === this.payload?.[col]))
      : undefined;
    if (existing) {
      Object.assign(existing, this.payload);
      return { data: [existing], error: null };
    }
    const newRow: Row = { ...this.payload };
    this.rows.push(newRow);
    return { data: [newRow], error: null };
  }

  async maybeSingle() {
    const { data, error } = this.run();
    return { data: data?.[0] ?? null, error };
  }

  async single() {
    const { data, error } = this.run();
    if (!data?.[0]) return { data: null, error: { message: 'not found' } };
    return { data: data[0], error };
  }

  then(resolve: (v: { data: Row[] | null; error: null }) => any, reject?: (e: any) => any) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

export function createFakeSupabase(seed: Tables = {}) {
  const tables: Tables = seed;
  return {
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      return {
        select: (columns?: string) => new FakeQueryBuilder(tables[table], 'select').select(columns),
        insert: (payload: Row) => new FakeQueryBuilder(tables[table], 'insert', payload),
        update: (payload: Row) => new FakeQueryBuilder(tables[table], 'update', payload),
        delete: () => new FakeQueryBuilder(tables[table], 'delete'),
        upsert: (payload: Row, opts?: { onConflict?: string }) => new FakeQueryBuilder(tables[table], 'upsert', payload, opts),
      };
    },
    __tables: tables,
  } as any;
}
