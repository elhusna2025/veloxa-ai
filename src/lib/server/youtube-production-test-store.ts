// In-memory transactional store used only by production state-machine tests.
import assert from 'node:assert/strict';
type Row = Record<string, unknown>;
class Ref {
  constructor(readonly firestore: Store, readonly path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Query(this.firestore, `${this.path}/${name}`); }
  async get() {
    const row = this.firestore.rows.get(this.path);
    return { id: this.id, ref: this, exists: row !== undefined, data: () => structuredClone(row) };
  }
}
class Query {
  constructor(readonly store: Store, readonly path: string, readonly sorts?: {
    field: string; low?: string; high?: string; due?: number; limit?: number;
  }) {}
  doc(id: string) { return new Ref(this.store, `${this.path}/${id}`); }
  where(field: string, operation: string, due: number) {
    assert.equal(operation, '<=');
    return new Query(this.store, this.path, { field, due });
  }
  orderBy(field: string) { return new Query(this.store, this.path, { ...this.sorts, field }); }
  startAt(low: string) { return new Query(this.store, this.path, { ...this.sorts!, low }); }
  endAt(high: string) { return new Query(this.store, this.path, { ...this.sorts!, high }); }
  limit(limit: number) { return new Query(this.store, this.path, { ...this.sorts!, limit }); }
  async get() {
    const prefix = this.path + '/';
    let rows = [...this.store.rows].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
    const sorts = this.sorts;
    if (sorts) {
      const key = (row: Row) => row[sorts.field] as string | number;
      rows = rows.filter(([, row]) =>
        (sorts.low === undefined || key(row) >= sorts.low) &&
        (sorts.high === undefined || key(row) <= sorts.high) &&
        (sorts.due === undefined || Number(key(row)) <= sorts.due));
      rows.sort(([, a], [, b]) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
      rows = rows.slice(0, sorts.limit);
    }
    return { docs: await Promise.all(rows.map(([path]) => new Ref(this.store, path).get())) };
  }
}
export class Store {
  rows = new Map<string, Row>();
  writes = 0;
  afterTransaction?: (result: unknown) => void;
  private pending: Promise<unknown> = Promise.resolve();
  collection(path: string) { return new Query(this, path); }
  async runTransaction<T>(callback: (transaction: unknown) => Promise<T>) {
    const run = this.pending.then(async () => {
      const effects: Array<() => void> = [];
      const value = await callback({
        get: (ref: Ref | Query) => { assert.equal(effects.length, 0, 'Firestore reads precede writes'); return ref.get(); },
        create: (ref: Ref, data: Row) => effects.push(() => {
          assert.equal(this.rows.has(ref.path), false);
          this.rows.set(ref.path, structuredClone(data));
        }),
        update: (ref: Ref, data: Row) => effects.push(() => {
          assert.equal(this.rows.has(ref.path), true);
          this.rows.set(ref.path, { ...this.rows.get(ref.path), ...structuredClone(data) });
        }),
        set: (ref: Ref, data: Row) => effects.push(() => this.rows.set(ref.path, structuredClone(data))),
        delete: (ref: Ref) => effects.push(() => this.rows.delete(ref.path)),
      });
      for (const effect of effects) effect();
      this.writes += effects.length;
      this.afterTransaction?.(value);
      return value;
    });
    this.pending = run.catch(() => {});
    return run;
  }
}
