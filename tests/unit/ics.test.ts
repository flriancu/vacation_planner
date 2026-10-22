import { describe, expect, it } from 'vitest';
import { blocksForCalendar, eventUid, toIcs, type IcsEvent } from '../../src/domain/ics';
import { DocBuilder } from '../fixtures/builder';

const NOW = new Date(Date.UTC(2027, 2, 1, 10, 0, 0));

const event = (patch: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: 'b1@concediu.floriniancu.ro',
  start: '2027-03-08',
  end: '2027-03-10',
  summary: 'Concediu de odihnă',
  confirmed: true,
  busy: true,
  updatedAt: '2027-02-01T09:30:00.000Z',
  ...patch,
});

/** The SEQUENCE written for a block last changed at `updatedAt`. */
const sequence = (updatedAt: string) => Number(/SEQUENCE:(\d+)/.exec(toIcs([event({ updatedAt })], 'x', NOW))![1]);

describe('toIcs (IO-2)', () => {
  it('writes one all-day event per block, with the end as the day after', () => {
    const ics = toIcs([event()], 'Concedii 2027', NOW);
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTART;VALUE=DATE:20270308');
    expect(lines).toContain('DTEND;VALUE=DATE:20270311');
    expect(lines).toContain('UID:b1@concediu.floriniancu.ro');
    expect(lines).toContain('DTSTAMP:20270301T100000Z');
    expect(lines).toContain('LAST-MODIFIED:20270201T093000Z');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/); // only CRLF line ends
  });

  it('crosses a year end and a month end correctly', () => {
    const ics = toIcs([event({ start: '2027-12-20', end: '2027-12-31' })], 'x', NOW);
    expect(ics).toContain('DTEND;VALUE=DATE:20280101');
  });

  it('escapes text and folds long lines without splitting a character', () => {
    const note = 'Zbor la 6, bagaj; „țânțar” \\ ' + 'ă'.repeat(60) + '\nrândul doi';
    const ics = toIcs([event({ description: note })], 'x', NOW);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('DESCRIPTION:Zbor la 6\\, bagaj\\; „țânțar” \\\\ ' + 'ă'.repeat(60) + '\\nrândul doi');
  });

  it('marks ideas and planned leave as tentative', () => {
    expect(toIcs([event({ confirmed: false })], 'x', NOW)).toContain('STATUS:TENTATIVE');
  });

  it('raises SEQUENCE when the block changes, so re-imports update the event', () => {
    expect(sequence('2027-02-02T00:00:00.000Z')).toBeGreaterThan(sequence('2027-02-01T00:00:00.000Z'));
  });
});

describe('blocksForCalendar', () => {
  it('takes my blocks of the year with the chosen statuses, earliest first', () => {
    const b = new DocBuilder();
    const a = b.block('annual', '2028-08-07', '2028-08-11', 'approved');
    const c = b.block('annual', '2027-12-30', '2028-01-02', 'planned');
    b.block('annual', '2028-05-03', '2028-05-03', 'idea');
    b.block('annual', '2029-01-10', '2029-01-10', 'approved');
    expect(blocksForCalendar(b.doc, b.personId, 2028, ['planned', 'approved'])).toEqual([c, a]);
    expect(eventUid(a)).toBe(`${a.id}@concediu.floriniancu.ro`);
  });

  it('leaves out control characters TEXT cannot hold, and keeps line ends', () => {
    const ics = toIcs([event({ description: 'a\u0000b\u0007c\u000bd\te\nf' })], 'x', NOW);
    expect(ics).toContain('DESCRIPTION:abcd\te\\nf');
  });

  it('shows ideas as free time, and keeps SEQUENCE a 32-bit number for centuries', () => {
    const ics = toIcs([event({ busy: false })], 'x', NOW);
    expect(ics).toContain('TRANSP:TRANSPARENT');
    expect(sequence('2400-01-01T00:00:00.000Z')).toBeLessThan(2 ** 31);
  });
});
