import { describe, expect, it } from 'vitest';
import { deleteRecord, updateRecord } from '../../src/domain/edit';
import { merge } from '../../src/domain/merge';
import { migrate, UnsupportedPlanError } from '../../src/domain/migrate';
import { DocBuilder } from '../fixtures/builder';

const T1 = '2027-01-01T10:00:00.000Z';
const T2 = '2027-01-01T11:00:00.000Z';

describe('merge (DESIGN §4.3)', () => {
  it('keeps records added on either side', () => {
    const base = new DocBuilder();
    const phone = new DocBuilder();
    phone.doc = base.doc;
    const a = base.block('annual', '2027-03-01'); // only on the laptop
    const laptop = base.doc;
    phone.doc = { ...phone.doc, blocks: { ...phone.doc.blocks, x: { ...a, id: 'x', start: '2027-04-01', end: '2027-04-01' } } };
    const merged = merge(laptop, phone.doc);
    expect(Object.keys(merged.blocks).sort()).toEqual([a.id, 'x'].sort());
  });

  it('takes the newer edit of the same record, whichever side it is on', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01', '2027-03-01', 'idea');
    const local = updateRecord(b.doc, 'blocks', block.id, { status: 'planned' }, T2);
    const remote = updateRecord(b.doc, 'blocks', block.id, { status: 'approved' }, T1);
    expect(merge(local, remote).blocks[block.id]!.status).toBe('planned');
    expect(merge(remote, local).blocks[block.id]!.status).toBe('planned');
  });

  it('lets a newer delete win over an older edit', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const deleted = deleteRecord(b.doc, 'blocks', block.id, T2);
    const edited = updateRecord(b.doc, 'blocks', block.id, { note: 'x' }, T1);
    expect(merge(edited, deleted).blocks[block.id]!.deleted).toBe(true);
  });

  it('prefers the remote version on a tie, and merges settings by time', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-03-01');
    const local = { ...updateRecord(b.doc, 'blocks', block.id, { note: 'mine' }, T1), settings: { lang: 'en' as const, updatedAt: T2 } };
    const remote = { ...updateRecord(b.doc, 'blocks', block.id, { note: 'theirs' }, T1), settings: { lang: 'ro' as const, updatedAt: T1 } };
    const merged = merge(local, remote);
    expect(merged.blocks[block.id]!.note).toBe('theirs');
    expect(merged.settings.lang).toBe('en');
  });
});

describe('migrate', () => {
  it('accepts a v1 plan and fills in missing collections', () => {
    const b = new DocBuilder();
    const { dismissals: _, ...withoutDismissals } = b.doc;
    expect(migrate(withoutDismissals).dismissals).toEqual({});
  });

  it('refuses files it cannot read', () => {
    expect(() => migrate(null)).toThrow(UnsupportedPlanError);
    expect(() => migrate({ ...new DocBuilder().doc, schemaVersion: 2 })).toThrow(/schema version 2/);
    expect(() => migrate({ schemaVersion: 1 })).toThrow(UnsupportedPlanError);
  });
});
