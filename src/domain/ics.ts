import { addDays, overlaps, yearEnd, yearStart, type ISODate } from './dates';
import { live, type Block, type BlockStatus, type PlanDoc, type Stamp } from './schema';

/** One all-day event of the calendar file (IO-2). */
export interface IcsEvent {
  /** Stable across exports, so importing the file again updates the event instead of adding a copy. */
  uid: string;
  start: ISODate;
  /** Inclusive, as blocks are; the file's DTEND is the day after. */
  end: ISODate;
  summary: string;
  description?: string;
  /** Approved leave is settled; ideas and planned leave may still change. */
  confirmed: boolean;
  /** Shown as busy time; an idea is not (others can still book me then). */
  busy: boolean;
  updatedAt: Stamp;
}

/** The domain the event ids are made unique in (RFC 5545: UID is globally unique). */
const UID_DOMAIN = 'concediu.floriniancu.ro';

/** My blocks of `year` with one of `statuses`, earliest first. */
export function blocksForCalendar(doc: PlanDoc, personId: string, year: number, statuses: readonly BlockStatus[]): Block[] {
  return live(doc.blocks)
    .filter((b) => b.personId === personId && statuses.includes(b.status) && overlaps(b.start, b.end, yearStart(year), yearEnd(year)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export const eventUid = (block: Block) => `${block.id}@${UID_DOMAIN}`;

/**
 * An iCalendar file (RFC 5545) with one all-day event per entry: CRLF line ends, text escaped,
 * long lines folded at 75 bytes. SEQUENCE follows the block's last change (in minutes, which
 * fit the 32-bit number calendar apps keep for millennia), so apps that track it take a
 * re-import as an update. `lang` is the language of the file's text (PRODID).
 */
export function toIcs(events: readonly IcsEvent[], calendarName: string, now: Date, lang: 'ro' | 'en' = 'ro'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${UID_DOMAIN}//${lang === 'ro' ? 'Planificator de concediu//RO' : 'Vacation planner//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(calendarName)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${text(e.uid)}`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `LAST-MODIFIED:${stamp(e.updatedAt)}`,
      `SEQUENCE:${Math.max(0, Math.floor(Date.parse(e.updatedAt) / 60_000) || 0)}`,
      `DTSTART;VALUE=DATE:${day(e.start)}`,
      `DTEND;VALUE=DATE:${day(addDays(e.end, 1))}`,
      `SUMMARY:${text(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
      `STATUS:${e.confirmed ? 'CONFIRMED' : 'TENTATIVE'}`,
      `TRANSP:${e.busy ? 'OPAQUE' : 'TRANSPARENT'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const day = (d: ISODate) => d.replaceAll('-', '');

/** `2027-03-01T10:00:00.000Z` → `20270301T100000Z`; a stamp that isn't one becomes the epoch. */
function stamp(s: Stamp): string {
  const t = Date.parse(s);
  return new Date(Number.isFinite(t) ? t : 0)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * TEXT values: backslash, semicolon, comma and line ends are escaped (RFC 5545 §3.3.11); other
 * control characters, which TEXT can't hold, are left out.
 */
function text(s: string): string {
  return (
    s
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
  );
}

const utf8 = new TextEncoder();

/** Lines longer than 75 bytes continue on the next line after one space, never inside a character (§3.1). */
function fold(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = utf8.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}
