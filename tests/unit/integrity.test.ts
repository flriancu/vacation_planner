import { describe, expect, it } from 'vitest';
import { absorb } from '../../src/domain/absorb';
import { nextStamp } from '../../src/domain/clock';
import { deleteRecord, restoreRecord, updateRecord } from '../../src/domain/edit';
import { holidaysBetween } from '../../src/domain/holidays';
import { hasLocalWins, merge } from '../../src/domain/merge';
import { migrate, skippedCount, toFile } from '../../src/domain/migrate';
import { live, typeByKey } from '../../src/domain/schema';
import { swapReminders } from '../../src/domain/swaps';
import { DocBuilder } from '../fixtures/builder';

describe('nextStamp (clock skew)', () => {
  it('is now when the document holds nothing newer', () => {
    const b = new DocBuilder();
    expect(nextStamp(b.doc, Date.UTC(2030, 0, 1))).toBe('2030-01-01T00:00:00.000Z');
  });

  it('never goes below a stamp already in the document, so a later edit beats a fast clock', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    // A phone two hours fast edited the block; the laptop (correct clock) edits it afterwards.
    const phone = updateRecord(b.doc, 'blocks', block.id, { note: 'phone' }, '2027-01-01T12:00:00.000Z');
    const laptopNow = Date.UTC(2027, 0, 1, 10, 0, 5);
    const laptop = updateRecord(phone, 'blocks', block.id, { note: 'laptop' }, nextStamp(phone, laptopNow));
    expect(merge(phone, laptop).blocks[block.id]!.note).toBe('laptop');
    expect(merge(laptop, phone).blocks[block.id]!.note).toBe('laptop');
  });

  it('lets an undo win over a delete stamped by a fast clock', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const deleted = deleteRecord(b.doc, 'blocks', block.id, '2027-01-01T12:00:00.000Z');
    const restored = restoreRecord(deleted, 'blocks', block.id, nextStamp(deleted, Date.UTC(2027, 0, 1, 11)), block);
    expect(merge(deleted, restored).blocks[block.id]!.deleted).toBeUndefined();
  });
});

describe('edit', () => {
  it('brings back a record that was deleted elsewhere when it is edited', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const deletedElsewhere = deleteRecord(b.doc, 'blocks', block.id, '2027-01-01T10:00:00.000Z');
    const edited = updateRecord(deletedElsewhere, 'blocks', block.id, { status: 'approved' }, '2027-01-01T11:00:00.000Z');
    expect(edited.blocks[block.id]!.deleted).toBeUndefined();
    expect(edited.blocks[block.id]!.status).toBe('approved');
  });

  it('keeps id and createdAt even if a patch carries them', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const patch = { note: 'x', id: 'other', createdAt: 'later' } as never;
    const edited = updateRecord(b.doc, 'blocks', block.id, patch, '2027-01-01T11:00:00.000Z');
    expect(edited.blocks[block.id]!.id).toBe(block.id);
    expect(edited.blocks[block.id]!.createdAt).toBe(block.createdAt);
  });

  it('drops the note from a deleted record, and an undo brings it back', () => {
    const b = new DocBuilder();
    const block = { ...b.block('annual', '2027-03-01'), note: 'private' };
    b.doc = { ...b.doc, blocks: { ...b.doc.blocks, [block.id]: block } };
    const deleted = deleteRecord(b.doc, 'blocks', block.id, '2027-01-01T10:00:00.000Z');
    expect(deleted.blocks[block.id]!.note).toBeUndefined();
    expect(restoreRecord(deleted, 'blocks', block.id, '2027-01-01T11:00:00.000Z', block).blocks[block.id]!.note).toBe('private');
  });
});

describe('merge with hostile ids', () => {
  it('keeps local-only records named like Object.prototype members', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const local = { ...b.doc, blocks: { ...b.doc.blocks } };
    for (const id of ['constructor', 'toString', '__proto__']) {
      Object.defineProperty(local.blocks, id, { value: { ...block, id }, enumerable: true, configurable: true, writable: true });
    }
    const merged = merge(local, b.doc);
    expect(Object.keys(merged.blocks).sort()).toEqual(['__proto__', 'constructor', 'toString', block.id].sort());
    expect(hasLocalWins(local, b.doc)).toBe(true);
    expect(hasLocalWins(b.doc, b.doc)).toBe(false);
  });
});

/** A plan file with one block, as JSON would give it, changed by `patch`. */
function file(patch: (doc: Record<string, unknown>) => void) {
  const b = new DocBuilder();
  const block = b.block('annual', '2027-03-01');
  const raw = structuredClone(b.doc) as unknown as Record<string, unknown>;
  patch(raw);
  return { raw, blockId: block.id, b };
}
const blocks = (raw: Record<string, unknown>) => raw.blocks as Record<string, Record<string, unknown>>;

describe('migrate checks every record', () => {
  it.each([
    ['an unknown status', (r: Record<string, unknown>) => (r.status = 'maybe')],
    ['an unknown leave type', (r: Record<string, unknown>) => (r.typeId = 'nope')],
    ['an impossible date', (r: Record<string, unknown>) => (r.start = '2027-02-30')],
    ['a date without padding', (r: Record<string, unknown>) => (r.start = '2027-1-1')],
    ['a reversed range', (r: Record<string, unknown>) => (r.end = '2027-02-01')],
    ['a year the holiday rules do not cover', (r: Record<string, unknown>) => ((r.start = '1850-01-01'), (r.end = '1850-01-02'))],
    ['an empty start', (r: Record<string, unknown>) => (r.start = '')],
  ])('sets aside a block with %s, and writes it back unchanged', (_, change) => {
    const { raw, blockId } = file((doc) => change(blocks(doc)[Object.keys(blocks(doc)).at(-1)!]!));
    const doc = migrate(raw);
    expect(doc.blocks[blockId]).toBeUndefined();
    expect(skippedCount(doc)).toBe(1);
    expect(toFile(doc).blocks[blockId]).toEqual(blocks(raw)[blockId]);
  });

  it('repairs what the screens rely on: language, the person, the built-in types', () => {
    const { raw } = file((doc) => {
      (doc.settings as Record<string, unknown>).lang = 'fr';
      for (const p of Object.values(doc.people as Record<string, Record<string, unknown>>)) p.deleted = true;
      const types = doc.leaveTypes as Record<string, Record<string, unknown>>;
      for (const [id, t] of Object.entries(types)) if (t.key === 'annual') delete types[id];
    });
    const doc = migrate(raw);
    expect(doc.settings.lang).toBe('ro');
    expect(live(doc.people)).toHaveLength(1);
    expect(typeByKey(doc, 'annual')).toBeDefined();
  });

  it('makes timestamps that are not timestamps lose every merge', () => {
    const { raw, blockId, b } = file((doc) => {
      const r = blocks(doc)[Object.keys(blocks(doc)).at(-1)!]!;
      r.updatedAt = '~';
      r.note = 'evil';
    });
    const mine = updateRecord(b.doc, 'blocks', blockId, { note: 'mine' }, '2026-06-01T00:00:00.000Z');
    expect(merge(mine, migrate(raw)).blocks[blockId]!.note).toBe('mine');
  });

  it('drops collections that are not objects instead of spreading them into records', () => {
    const { raw } = file((doc) => (doc.blocks = 'oops'));
    expect(migrate(raw).blocks).toEqual({});
  });

  it('keeps a record with id __proto__ as a record', () => {
    const { raw, blockId } = file(() => {});
    const json = JSON.stringify(raw).replace(`"${blockId}":{"`, `"__proto__":{"id":"__proto__","`).replace(`"id":"${blockId}",`, '');
    const doc = migrate(JSON.parse(json));
    expect(Object.hasOwn(doc.blocks, '__proto__')).toBe(true);
  });
});

describe('the edges of the supported years', () => {
  it('has no holidays outside 1900–2099 instead of failing', () => {
    expect(holidaysBetween('2099-12-01', '2100-02-10').size).toBeGreaterThan(0);
    expect(() => holidaysBetween('1899-11-20', '1900-01-10')).not.toThrow();
  });

  it('gives no swap reminders outside the supported years', () => {
    expect(swapReminders(new DocBuilder().doc, 'x', 2100)).toEqual([]);
  });
});

describe('floating days are gone', () => {
  it('drops the old floating type and turns its blocks into annual leave', () => {
    const { raw, blockId } = file((doc) => {
      const types = doc.leaveTypes as Record<string, Record<string, unknown>>;
      types.old = {
        id: 'old',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        key: 'floating',
        name: { ro: 'Zi flotantă', en: 'Floating day' },
        color: '#ffbdda',
        budget: 'floating',
        needsApproval: false,
      };
      blocks(doc)[Object.keys(blocks(doc)).at(-1)!]!.typeId = 'old';
    });
    const doc = migrate(raw);
    expect(doc.leaveTypes.old).toBeUndefined();
    expect(doc.leaveTypes[doc.blocks[blockId]!.typeId]!.key).toBe('annual');
    expect(skippedCount(doc)).toBe(0);
  });
});

describe('timestamps a merge can trust', () => {
  const NOW = Date.UTC(2026, 9, 22);

  it('turns a stamp far in the future into 1970, so it cannot win every merge', () => {
    const { raw, blockId } = file((doc) => (blocks(doc)[Object.keys(blocks(doc)).at(-1)!]!.updatedAt = '9999-12-31T23:59:59.999Z'));
    const doc = migrate(raw, NOW);
    expect(doc.blocks[blockId]!.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(nextStamp(doc, NOW)).toBe(new Date(NOW).toISOString());
  });

  it('keeps a clock a few hours fast, and writes every stamp in UTC', () => {
    const { raw, blockId } = file((doc) => (blocks(doc)[Object.keys(blocks(doc)).at(-1)!]!.updatedAt = '2026-10-22T09:28:42+14:00'));
    expect(migrate(raw, NOW).blocks[blockId]!.updatedAt).toBe('2026-10-21T19:28:42.000Z');
  });
});

describe('an old floating block when the annual-leave type is gone too', () => {
  it('brings the annual type back and keeps the block visible', () => {
    const { raw, blockId } = file((doc) => {
      const types = doc.leaveTypes as Record<string, Record<string, unknown>>;
      for (const t of Object.values(types)) if (t.key === 'annual') t.deleted = true;
      types.old = {
        id: 'old',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        key: 'floating',
        name: { ro: 'Z', en: 'F' },
        color: '#fff',
        budget: 'floating',
        needsApproval: false,
      };
      blocks(doc)[Object.keys(blocks(doc)).at(-1)!]!.typeId = 'old';
    });
    const doc = migrate(raw);
    expect(skippedCount(doc)).toBe(0);
    expect(doc.leaveTypes[doc.blocks[blockId]!.typeId]!.key).toBe('annual');
  });
});

describe('absorb', () => {
  it('is merge for two versions of the same file', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const mine = updateRecord(b.doc, 'blocks', block.id, { note: 'mine' }, '2027-01-01T11:00:00.000Z');
    expect(absorb(b.doc, mine)).toEqual(merge(mine, b.doc));
  });

  it("keeps my settings when taking in the demo's blocks", () => {
    const mine = new DocBuilder();
    const demo = new DocBuilder();
    demo.block('annual', '2027-07-01');
    const fromDemo = {
      ...demo.doc,
      owner: { googleSub: 'demo' },
      settings: { lang: 'en' as const, updatedAt: '2030-01-01T00:00:00.000Z' },
    };
    const out = absorb(mine.doc, fromDemo);
    expect(out.settings.lang).toBe('ro');
    expect(live(out.blocks).map((x) => x.personId)).toEqual([mine.personId]);
  });
});
