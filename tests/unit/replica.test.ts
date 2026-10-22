import { describe, expect, it } from 'vitest';
import { forgetSavedCopies, LocalReplica, replicaKey, unsavedCopies } from '../../src/sync/Replica';
import { DocBuilder } from '../fixtures/builder';

/** A localStorage stand-in with the parts the copies use. */
class FakeStorage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key = (i: number) => [...this.items.keys()][i] ?? null;
  getItem = (k: string) => this.items.get(k) ?? null;
  setItem = (k: string, v: string) => void this.items.set(k, v);
  removeItem = (k: string) => void this.items.delete(k);
  clear = () => this.items.clear();
}

describe("this device's copies of plans", () => {
  it('says which accounts have changes waiting, so none is forgotten on a shared computer', () => {
    const store = new FakeStorage() as unknown as Storage;
    const doc = new DocBuilder().doc;
    new LocalReplica(replicaKey('alice'), { sub: 'alice', email: 'alice@example.test', name: 'Alice' }, store).write(doc, true);
    new LocalReplica(replicaKey('bob'), { sub: 'bob', email: 'bob@example.test', name: 'Bob' }, store).write(doc, false);
    expect(unsavedCopies(store)).toEqual([{ sub: 'alice', email: 'alice@example.test', name: 'Alice' }]);
  });

  it('forgets copies with nothing unsaved, and keeps the others', () => {
    const store = new FakeStorage() as unknown as Storage;
    const doc = new DocBuilder().doc;
    new LocalReplica(replicaKey('alice'), { sub: 'alice', email: 'a@x', name: 'A' }, store).write(doc, true);
    new LocalReplica(replicaKey('bob'), { sub: 'bob', email: 'b@x', name: 'B' }, store).write(doc, false);
    forgetSavedCopies(store);
    expect(store.getItem(replicaKey('alice'))).not.toBeNull();
    expect(store.getItem(replicaKey('bob'))).toBeNull();
  });

  it('is not blinded by one unreadable copy, and names an account without a name by its address', () => {
    const store = new FakeStorage() as unknown as Storage;
    store.setItem(replicaKey('broken'), '{not json');
    new LocalReplica(replicaKey('maria'), { sub: 'maria', email: 'maria@example.test', name: ' ' }, store).write(
      new DocBuilder().doc,
      true,
    );
    store.setItem(replicaKey('zz-broken'), '{"unsaved":true,"account":{"email":"","name":""}}');
    expect(unsavedCopies(store)).toEqual([{ sub: 'maria', email: 'maria@example.test', name: 'maria' }]);
  });
});
