import { describe, expect, it } from 'vitest';
import { blockStats } from '../../src/domain/blocks';
import { buildDays } from '../../src/domain/calendar';
import { deleteRecord, updateRecord } from '../../src/domain/edit';
import { DocBuilder } from '../fixtures/builder';
import { demo2027 } from '../fixtures/demo2027';

const stats = (b: DocBuilder, id: string) => blockStats(buildDays(b.doc, b.personId, '2027-07-01', '2028-01-31'), b.doc.blocks[id]!);

describe('blockStats (CAL-7)', () => {
  it('counts working days and the whole break around the block', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-08-09', '2027-08-13', 'planned'); // Mon–Fri before Sun 15 Aug
    expect(stats(b, block.id)).toEqual({ cost: 5, gain: 9, breakStart: '2027-08-07', breakEnd: '2027-08-15' });
  });

  it('costs an idea as if accepted, without charging days already covered', () => {
    const b = demo2027();
    const idea = b.block('annual', '2027-12-24', '2027-12-31', 'idea'); // swap + office-closed days already cover all but 27 Dec
    expect(stats(b, idea.id)).toMatchObject({ cost: 1, gain: 10, breakEnd: '2028-01-02' });
  });

  it('charges only the days where a planned block is the top block', () => {
    const b = new DocBuilder();
    const approved = b.block('annual', '2027-09-06', '2027-09-07', 'approved');
    const planned = b.block('annual', '2027-09-06', '2027-09-10', 'planned');
    expect(stats(b, approved.id).cost).toBe(2);
    expect(stats(b, planned.id).cost).toBe(3);
  });
});

describe('updateRecord / deleteRecord', () => {
  it('patches a record and bumps updatedAt', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-09-06');
    const doc = updateRecord(b.doc, 'blocks', block.id, { status: 'planned', note: 'x' }, '2027-01-01T00:00:00.000Z');
    expect(doc.blocks[block.id]).toMatchObject({
      status: 'planned',
      note: 'x',
      updatedAt: '2027-01-01T00:00:00.000Z',
      createdAt: block.createdAt,
    });
    expect(b.doc.blocks[block.id]!.status).toBe('approved'); // original untouched
  });

  it('deletes by marking, so the record stays for merging', () => {
    const b = new DocBuilder();
    const block = b.block('annual', '2027-09-06');
    const doc = deleteRecord(b.doc, 'blocks', block.id, '2027-01-01T00:00:00.000Z');
    expect(doc.blocks[block.id]).toMatchObject({ deleted: true, updatedAt: '2027-01-01T00:00:00.000Z' });
  });

  it('refuses unknown ids', () => {
    const b = new DocBuilder();
    expect(() => updateRecord(b.doc, 'blocks', 'nope', {}, 'x')).toThrow();
  });
});
