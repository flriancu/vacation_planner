import type { ISODate } from '../../src/domain/dates';
import {
  addRecord,
  newPlanDoc,
  typeByKey,
  type Block,
  type BlockStatus,
  type Collections,
  type LeaveTypeKey,
  type Meta,
  type PlanDoc,
  type RecordContext,
} from '../../src/domain/schema';

/** Deterministic ids and timestamps, so tests never depend on the clock. */
export function testContext(): RecordContext {
  let n = 0;
  let t = Date.UTC(2026, 0, 1);
  return {
    get now() {
      t += 1000;
      return new Date(t).toISOString();
    },
    newId: () => `id-${++n}`,
  };
}

/** A small mutable builder over the immutable `addRecord`. */
export class DocBuilder {
  readonly ctx = testContext();
  doc: PlanDoc;
  readonly personId: string;

  constructor() {
    const created = newPlanDoc({ googleSub: 'test-sub', personName: 'Me' }, this.ctx);
    this.doc = created.doc;
    this.personId = created.personId;
  }

  add<K extends keyof Collections>(key: K, data: Omit<Collections[K], keyof Meta>): Collections[K] {
    const { doc, record } = addRecord(this.doc, key, data, this.ctx);
    this.doc = doc;
    return record;
  }

  block(
    type: LeaveTypeKey,
    start: ISODate,
    end: ISODate = start,
    status: BlockStatus = 'approved',
    extra: Partial<Pick<Block, 'swapFor' | 'note'>> = {},
  ): Block {
    const typeId = typeByKey(this.doc, type)!.id;
    return this.add('blocks', { personId: this.personId, typeId, start, end, status, ...extra });
  }

  year(year: number, settings: { annualOpening?: number; excusedQuota?: number; closedCountsAgainstAnnual?: boolean }) {
    return this.add('yearSettings', {
      personId: this.personId,
      year,
      annualOpening: settings.annualOpening ?? 0,
      excusedQuota: settings.excusedQuota ?? 0,
      closedCountsAgainstAnnual: settings.closedCountsAgainstAnnual ?? false,
    });
  }

  dismissSwap(holiday: ISODate) {
    return this.add('dismissals', { personId: this.personId, kind: 'swap', start: holiday, end: holiday });
  }

  /** Replaces a record in place, e.g. to flip a setting after creation. */
  update<K extends keyof Collections>(key: K, record: Collections[K]) {
    this.doc = { ...this.doc, [key]: { ...this.doc[key], [record.id]: record } };
  }
}
